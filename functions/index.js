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

// 'sandbox' is fake data, 'production' is your real accounts. Set by the
// dropdown on the Deploy functions action, so switching needs no code change.
// Plaid retired the old Development environment, so this is the whole switch.
const PLAID_ENV = process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';

// Blank means "don't send one". Sending a redirect_uri Plaid hasn't got on file
// fails /link/token/create outright, so it has to be clearable without a deploy.
const REDIRECT_URI = (process.env.PLAID_REDIRECT_URI || '').trim();

setGlobalOptions({ region: 'us-central1', maxInstances: 3 });
const withSecrets = { secrets: [PLAID_CLIENT_ID, PLAID_SECRET] };

function plaid() {
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: { headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID.value(),
      'PLAID-SECRET': PLAID_SECRET.value(),
    } },
  }));
}

/**
 * Plaid puts the useful part in response.data. Without this it reaches the
 * browser as a bare "internal", which hides the one thing worth knowing —
 * INVALID_API_KEYS, INVALID_FIELD, and so on.
 */
function plaidError(e, what) {
  const d = (e && e.response && e.response.data) || {};
  const code = d.error_code || 'PLAID_ERROR';
  const msg = d.error_message || e.message || 'request failed';
  console.error(what, code, msg, JSON.stringify(d));
  return new HttpsError('failed-precondition', `${what}: ${msg} (${code})`);
}

const uidOf = (req) => {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
};
const itemsCol = (uid) => db.collection('plaidItems').doc(uid).collection('items');

/**
 * What each linked account is for:
 *   card    - charges arrive as loose "track later" logs, you finish them yourself
 *   review  - transactions wait in the review queue for a category
 *   bills    - matched to a bill to build its 12-month average, and keeps the
 *              bills account balance current. Takes the full backfill on purpose.
 *   off     - ignored entirely
 */
const ROLES = new Set(['card', 'review', 'bills', 'off']);
const defaultRole = (a) => (a && a.type === 'credit' ? 'card' : a && a.type === 'depository' ? 'review' : 'off');

/** Step 1 — hand Plaid Link a short-lived token so it can open. */
exports.createLinkToken = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  let res;
  try {
    res = await plaid().linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'Budget',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      ...(REDIRECT_URI ? { redirect_uri: REDIRECT_URI } : {}),
    });
  } catch (e) { throw plaidError(e, 'Could not start Plaid Link'); }
  return { link_token: res.data.link_token, env: PLAID_ENV, redirect: REDIRECT_URI || null };
});

/** Step 2 — swap the one-time public_token for a lasting access_token we keep. */
exports.exchangePublicToken = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const publicToken = req.data && req.data.public_token;
  if (!publicToken) throw new HttpsError('invalid-argument', 'Missing public_token.');

  const api = plaid();
  let ex, inst;
  try { ex = await api.itemPublicTokenExchange({ public_token: publicToken }); }
  catch (e) { throw plaidError(e, 'Could not finish linking'); }
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;

  try { inst = await api.accountsGet({ access_token: accessToken }); }
  catch (e) { throw plaidError(e, 'Linked, but could not read the accounts'); }

  // Capture balances now. They used to be written only by a sync, so a card
  // linked minutes ago had nothing for the log to be compared against.
  const balances = {};
  inst.data.accounts.forEach((a) => {
    balances[a.account_id] = {
      name: a.name, mask: a.mask || null,
      current: a.balances.current, available: a.balances.available,
    };
  });
  const accounts = inst.data.accounts.map((a) => ({
    account_id: a.account_id, name: a.name, mask: a.mask,
    type: a.type, subtype: a.subtype,
  }));

  const roles = {};
  accounts.forEach((a) => { roles[a.account_id] = defaultRole(a); });

  await itemsCol(uid).doc(itemId).set({
    accessToken, itemId, accounts, roles, balances,
    startDate: new Date().toISOString().slice(0, 10),
    institution: (inst.data.item && inst.data.item.institution_id) || null,
    cursor: null, linkedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { itemId, accounts, roles };
});

/** What's linked, without ever handing the browser an access token. */
exports.listItems = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const items = await itemsCol(uid).get();
  return {
    items: items.docs.map((d) => {
      const v = d.data();
      return {
        itemId: v.itemId,
        institution: v.institution || null,
        accounts: v.accounts || [],
        roles: v.roles || {},
        balances: v.balances || {},
        syncedAt: v.syncedAt ? v.syncedAt.toMillis() : null,
      };
    }),
  };
});

/** Unlink a bank. Tells Plaid to stop syncing, then forgets the token. */
exports.removeItem = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const itemId = req.data && req.data.itemId;
  if (!itemId) throw new HttpsError('invalid-argument', 'Missing itemId.');
  const ref = itemsCol(uid).doc(itemId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such linked bank.');
  // Best effort: if Plaid already dropped it, forgetting our copy is what matters.
  try { await plaid().itemRemove({ access_token: snap.data().accessToken }); }
  catch (e) { console.warn('itemRemove failed, dropping locally anyway', e.message); }
  await ref.delete();
  return { removed: itemId };
});

/**
 * Every transaction across every linked account, for looking through. Uses
 * /transactions/get rather than the sync cursor, so browsing can never cost you
 * an import or skip one.
 */
exports.recentActivity = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const days = Math.min(365, Math.max(1, +(req.data && req.data.days) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const day = (d) => d.toISOString().slice(0, 10);

  const api = plaid();
  const items = await itemsCol(uid).get();
  const out = [];

  for (const doc of items.docs) {
    const item = doc.data();
    const names = {};
    (item.accounts || []).forEach((a) => { names[a.account_id] = a.name + (a.mask ? ' \u2022\u2022' + a.mask : ''); });
    try {
      let offset = 0, total = 1;
      while (offset < total && out.length < 500) {
        const res = await api.transactionsGet({
          access_token: item.accessToken, start_date: day(start), end_date: day(end),
          options: { count: 100, offset },
        });
        total = res.data.total_transactions;
        if (!res.data.transactions.length) break;
        res.data.transactions.forEach((t) => out.push({
          id: t.transaction_id,
          date: t.date,
          name: t.merchant_name || t.name || '',
          amount: Math.abs(t.amount),
          outgoing: t.amount >= 0,
          pending: !!t.pending,
          account: names[t.account_id] || 'Account',
          role: (item.roles || {})[t.account_id] || null,
        }));
        offset += res.data.transactions.length;
      }
    } catch (e) {
      const d = (e && e.response && e.response.data) || {};
      console.error('recentActivity failed for', doc.id, d.error_code || e.message);
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { days, transactions: out };
});

/** Point each account at what it's for. No Plaid call, so no secrets needed. */
exports.setAccountRoles = onCall(async (req) => {
  const uid = uidOf(req);
  const { itemId, roles } = req.data || {};
  if (!itemId || !roles || typeof roles !== 'object') throw new HttpsError('invalid-argument', 'Missing itemId or roles.');
  const clean = {};
  for (const [acct, role] of Object.entries(roles)) if (ROLES.has(role)) clean[acct] = role;
  await itemsCol(uid).doc(itemId).update({ roles: clean });
  return { roles: clean };
});

/** Step 3 — pull new/changed/removed transactions and mirror them into the app. */
exports.syncTransactions = onCall(withSecrets, async (req) => {
  const uid = uidOf(req);
  const api = plaid();
  const items = await itemsCol(uid).get();
  if (items.empty) return { added: 0, modified: 0, removed: 0, accounts: 0 };

  // Imports land in an inbox, NOT straight into your transactions. Nothing touches
  // the weekly budget or the card plan until you accept and categorise it.
  const txCol = db.collection('users').doc(uid).collection('inbox');
  let added = 0, modified = 0, removed = 0;
  const failed = [];

  for (const itemDoc of items.docs) {
   // One dead item must not stop the others. Switching between sandbox and
   // production invalidates the tokens from the environment you left, and those
   // banks are still listed until you unlink them.
   try {
    const item = itemDoc.data();
    const roles = item.roles || {};
    const roleFor = (accountId) => roles[accountId]
      || defaultRole((item.accounts || []).find((a) => a.account_id === accountId));

    // Balances first, so the bills account stays honest even when it has no new
    // activity to report.
    const balances = {};
    try {
      const bal = await api.accountsGet({ access_token: item.accessToken });
      bal.data.accounts.forEach((a) => {
        balances[a.account_id] = {
          name: a.name, mask: a.mask || null,
          current: a.balances.current, available: a.balances.available,
        };
      });
    } catch (e) { console.warn('balance refresh failed', e.message); }

    let cursor = item.cursor || undefined;
    let more = true;

    while (more) {
      let res;
      try {
        res = await api.transactionsSync({ access_token: item.accessToken, cursor, count: 250 });
      } catch (e) { throw plaidError(e, 'Could not read transactions'); }
      const d = res.data;

      const batch = db.batch();
      // You were already up to date when you linked, so card and review accounts
      // start from that day. A bills account is the exception: its whole job is
      // the 12-month average, so it takes everything Plaid still has.
      const wanted = (t) => {
        const r = roleFor(t.account_id);
        if (r === 'bills') return 'bills';
        if (r !== 'card' && r !== 'review') return null;
        if (item.startDate && t.date < item.startDate) return null;
        return r;
      };
      for (const t of d.added) { const r = wanted(t); if (!r) continue; batch.set(txCol.doc('plaid_' + t.transaction_id), shape(t, item, r), { merge: true }); added++; }
      for (const t of d.modified) { const r = wanted(t); if (!r) continue; batch.set(txCol.doc('plaid_' + t.transaction_id), shape(t, item, r), { merge: true }); modified++; }
      for (const r of d.removed) { batch.delete(txCol.doc('plaid_' + r.transaction_id)); removed++; }
      await batch.commit();

      cursor = d.next_cursor;
      more = d.has_more;
    }
    await itemDoc.ref.update({ cursor: cursor || null, balances, syncedAt: admin.firestore.FieldValue.serverTimestamp() });
   } catch (e) {
     const d = (e && e.response && e.response.data) || {};
     console.error('item sync failed', itemDoc.id, d.error_code || e.message);
     failed.push({ itemId: itemDoc.id, code: d.error_code || 'SYNC_FAILED', message: d.error_message || e.message });
   }
  }
  return { added, modified, removed, accounts: items.size, failed };
});

/**
 * Plaid's shape -> the app's. Plaid reports money out as positive, which already
 * matches. Category is left null: you assign it when you accept the item, and
 * that is what keeps the weekly budget and card trim honest.
 */
function shape(t, item, route) {
  const acct = (item.accounts || []).find((a) => a.account_id === t.account_id);
  const isCard = acct && acct.type === 'credit';
  return {
    id: 'plaid_' + t.transaction_id,
    plaidId: t.transaction_id,
    route,                                // 'card' -> track later, 'review' -> queue
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
