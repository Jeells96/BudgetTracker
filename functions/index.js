/**
 * Plaid bridge.
 *
 * The browser never sees the Plaid secret or an access_token. It calls these
 * functions with its Firebase ID token; callable functions hand us a verified
 * request.auth.uid, so a caller can only ever reach their own data.
 *
 * Access tokens live in /plaidItems/{uid}/items/{itemId}, which firestore.rules
 * denies to every client. The Admin SDK bypasses rules, so only this code reads them.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

admin.initializeApp();
const db = admin.firestore();

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID');
const PLAID_SECRET = defineSecret('PLAID_SECRET');
const PLAID_ENV = defineSecret('PLAID_ENV');            // 'sandbox' | 'production'

setGlobalOptions({ region: 'us-central1', maxInstances: 3 });
const withSecrets = { secrets: [PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV] };

function plaid() {
  const env = (PLAID_ENV.value() || 'sandbox').trim();
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env] || PlaidEnvironments.sandbox,
    baseOptions: { headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID.value(),
      'PLAID-SECRET': PLAID_SECRET.value(),
    } },
  }));
}

const uidOf = (req) => {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
};
const itemsCol = (uid) => db.collection('plaidItems').doc(uid).collection('items');

/** Step 1 — hand Plaid Link a short-lived token so it can open. */
exports.createLinkToken = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const res = await plaid().linkTokenCreate({
    user: { client_user_id: uid },
    client_name: 'Budget',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    // Required for OAuth banks (US Bank is one). Must match the dashboard entry.
    redirect_uri: 'https://jeells96.github.io/BudgetTracker/plaid-oauth.html',
  });
  return { link_token: res.data.link_token };
});

/** Step 2 — swap the one-time public_token for a lasting access_token we keep. */
exports.exchangePublicToken = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const publicToken = req.data && req.data.public_token;
  if (!publicToken) throw new HttpsError('invalid-argument', 'Missing public_token.');

  const api = plaid();
  const ex = await api.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;

  const inst = await api.accountsGet({ access_token: accessToken });
  const accounts = inst.data.accounts.map((a) => ({
    account_id: a.account_id, name: a.name, mask: a.mask,
    type: a.type, subtype: a.subtype,
  }));

  await itemsCol(uid).doc(itemId).set({
    accessToken, itemId, accounts,
    institution: (inst.data.item && inst.data.item.institution_id) || null,
    cursor: null, linkedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { itemId, accounts };
});

/** Step 3 — pull new/changed/removed transactions and mirror them into the app. */
exports.syncTransactions = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const api = plaid();
  const items = await itemsCol(uid).get();
  if (items.empty) return { added: 0, modified: 0, removed: 0, accounts: 0 };

  const txCol = db.collection('users').doc(uid).collection('transactions');
  let added = 0, modified = 0, removed = 0;

  for (const itemDoc of items.docs) {
    const item = itemDoc.data();
    let cursor = item.cursor || undefined;
    let more = true;

    while (more) {
      const res = await api.transactionsSync({
        access_token: item.accessToken, cursor, count: 250,
      });
      const d = res.data;

      const batch = db.batch();
      for (const t of d.added) { batch.set(txCol.doc('plaid_' + t.transaction_id), shape(t, item), { merge: true }); added++; }
      for (const t of d.modified) { batch.set(txCol.doc('plaid_' + t.transaction_id), shape(t, item), { merge: true }); modified++; }
      for (const r of d.removed) { batch.delete(txCol.doc('plaid_' + r.transaction_id)); removed++; }
      await batch.commit();

      cursor = d.next_cursor;
      more = d.has_more;
    }
    await itemDoc.ref.update({ cursor: cursor || null, syncedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  return { added, modified, removed, accounts: items.size };
});

/**
 * Plaid's shape -> the app's. Amounts are positive for money out (Plaid's sign
 * convention already matches). Category is left null so it lands in the review
 * queue: you assign it, which is what keeps the weekly budget honest.
 */
function shape(t, item) {
  const acct = (item.accounts || []).find((a) => a.account_id === t.account_id);
  const isCard = acct && acct.type === 'credit';
  return {
    id: 'plaid_' + t.transaction_id,
    plaidId: t.transaction_id,
    type: t.amount >= 0 ? 'expense' : 'income',
    amount: Math.abs(t.amount),
    date: t.date,
    note: t.merchant_name || t.name || '',
    pay: isCard ? 'credit' : 'cash',
    category: null,                       // you categorise it on import
    account: acct ? (acct.name + (acct.mask ? ' ••' + acct.mask : '')) : null,
    pending: !!t.pending,
    source: 'plaid',
    at: Date.parse(t.date) || Date.now(),
    plaidCategory: (t.personal_finance_category && t.personal_finance_category.primary) || null,
  };
}
