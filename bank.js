/**
 * Banking (Plaid) — every part of it lazy.
 *
 * app.js only imports this module when you tap something in the Banking panel,
 * and nothing here runs on import. The app's start-up path is untouched: no
 * extra scripts, no sign-in prompt, no behaviour change unless you opt in.
 *
 * Imported charges land in an inbox you review. Nothing reaches your weekly
 * budget or the card plan until you give it a category and accept it.
 */
import { fbReady } from './store.js?v=81';
import { firebaseConfig } from './firebase-config.js?v=81';

const FB = 'https://www.gstatic.com/firebasejs/11.0.2/';
const LINK_JS = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
const REGION = 'us-central1';

// ---------- lazy SDK ----------
let _parts = null;
async function parts() {
  if (_parts) return _parts;
  // Reuse the Firestore handle store.js already started. Calling getFirestore()
  // ourselves could race its initializeFirestore() and break sync for the app.
  const fb = await fbReady;
  if (!fb) throw new Error('The cloud connection is offline, so banking is unavailable right now.');
  const [appMod, authM, fnM] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-functions.js')
  ]);
  const app = appMod.getApps()[0] || appMod.initializeApp(firebaseConfig);
  _parts = { fb, authM, auth: authM.getAuth(app), fnM, fns: fnM.getFunctions(app, REGION) };
  return _parts;
}

function friendly(e) {
  const code = String((e && e.code) || '').replace('functions/', '');
  const msg = String((e && e.message) || '');
  if (code === 'unauthenticated') return 'Sign in first.';
  if (code === 'not-found') return 'The banking functions are not deployed yet — run “Deploy functions” on GitHub, then try again.';
  if (code === 'internal' && /PLAID|secret/i.test(msg)) return 'Plaid keys are missing — add PLAID_CLIENT_ID and PLAID_SECRET, then redeploy.';
  if (code === 'permission-denied') return 'Firestore refused that. Check the rules.';
  return msg || 'Something went wrong.';
}

async function call(name, data) {
  const { fnM, fns } = await parts();
  try { return (await fnM.httpsCallable(fns, name)(data || {})).data; }
  catch (e) { console.error(name, e); throw new Error(friendly(e)); }
}

// ---------- who you are ----------
export async function user() {
  const { auth } = await parts();
  if (auth.authStateReady) { try { await auth.authStateReady(); } catch {} }
  return auth.currentUser || null;
}

export async function signIn() {
  const { authM, auth } = await parts();
  const provider = new authM.GoogleAuthProvider();
  try {
    return (await authM.signInWithPopup(auth, provider)).user;
  } catch (e) {
    const code = String((e && e.code) || '');
    if (/popup-closed-by-user|cancelled-popup-request/.test(code)) throw new Error('Sign-in was cancelled.');
    // Safari blocks the popup often enough that a redirect is the real path.
    if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(code)) {
      sessionStorage.setItem('bankRedirect', '1');
      await authM.signInWithRedirect(auth, provider);
      return null;
    }
    if (/unauthorized-domain/.test(code)) throw new Error('Add jeells96.github.io under Firebase → Authentication → Settings → Authorized domains.');
    throw new Error(friendly(e));
  }
}

/** Picks sign-in back up after a redirect. Safe to call any time. */
export async function resumeSignIn() {
  if (sessionStorage.getItem('bankRedirect') !== '1') return null;
  sessionStorage.removeItem('bankRedirect');
  const { authM, auth } = await parts();
  try { const r = await authM.getRedirectResult(auth); return (r && r.user) || null; }
  catch (e) { console.error(e); return null; }
}

export async function signOutNow() { const { authM, auth } = await parts(); await authM.signOut(auth); }

// ---------- Plaid Link ----------
let _link = null;
function linkJs() {
  return (_link ||= new Promise((res, rej) => {
    if (window.Plaid) return res(window.Plaid);
    const s = document.createElement('script');
    s.src = LINK_JS;
    s.onload = () => (window.Plaid ? res(window.Plaid) : rej(new Error('Plaid Link failed to load.')));
    s.onerror = () => rej(new Error("Couldn't reach Plaid. Check your connection."));
    document.head.appendChild(s);
  }));
}

function openLink(Plaid, cfg) {
  return new Promise((resolve, reject) => {
    const done = (fn) => { try { sessionStorage.removeItem('plaidLinkToken'); } catch {} fn(); };
    let opened = false;
    const handler = Plaid.create({
      ...cfg,
      onLoad: () => { opened = true; },
      onEvent: (name) => { if (name) opened = true; },
      onSuccess: async (public_token) => {
        try { const r = await call('exchangePublicToken', { public_token }); done(() => resolve({ linked: r })); }
        catch (e) { done(() => reject(e)); }
      },
      onExit: (err, meta) => {
        if (err) {
          const detail = err.display_message || err.error_message || err.error_code || 'Your bank closed the connection.';
          return done(() => reject(new Error(detail + (err.error_code ? ` (${err.error_code})` : ''))));
        }
        // Backing out isn't an error, but it isn't silence either — say which.
        done(() => resolve({ exited: true, status: (meta && meta.status) || (opened ? 'closed' : 'never opened') }));
      }
    });
    handler.open();
    // If Link never paints, the tap looks like it did nothing. Say so instead.
    setTimeout(() => { if (!opened) done(() => resolve({ exited: true, status: 'never opened' })); }, 12000);
  });
}

/** Fetch Link's script ahead of the tap, so opening is instant. */
export function preload() { linkJs().catch(() => {}); }

/** Opens Plaid Link. Resolves with {itemId, accounts}, or null if you backed out. */
export async function connect() {
  if (!(await user())) throw new Error('Sign in first.');
  const { link_token } = await call('createLinkToken');
  try { sessionStorage.setItem('plaidLinkToken', link_token); } catch {}
  return openLink(await linkJs(), { token: link_token });
}

/** US Bank sends you out to its own site; this picks Link back up on the way in. */
export async function resumeOAuth() {
  let token, back;
  try {
    token = sessionStorage.getItem('plaidLinkToken');
    back = sessionStorage.getItem('plaidOAuthRedirect');
  } catch { return null; }
  if (!token || !back) return null;
  try { sessionStorage.removeItem('plaidOAuthRedirect'); } catch {}
  return openLink(await linkJs(), { token, receivedRedirectUri: back });
}

// A popup-based OAuth hand-back (desktop) messages the opener instead.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data && e.data.plaidOAuth) {
      try { sessionStorage.setItem('plaidOAuthRedirect', e.data.plaidOAuth); } catch {}
    }
  });
}

// ---------- accounts & imports ----------
export const listItems = () => call('listItems');
export const setRoles = (itemId, roles) => call('setAccountRoles', { itemId, roles });
export const recentActivity = (days) => call('recentActivity', { days });
export const unlink = (itemId) => call('removeItem', { itemId });
export const syncNow = () => call('syncTransactions');

export async function inbox() {
  const u = await user();
  if (!u) return [];
  const { fb } = await parts();
  const q = fb.query(fb.collection(fb.db, 'users', u.uid, 'inbox'), fb.orderBy('date', 'desc'), fb.limit(300));
  return (await fb.getDocs(q)).docs.map((d) => d.data());
}

export async function dropInbox(id) {
  const u = await user();
  if (!u) return;
  const { fb } = await parts();
  await fb.deleteDoc(fb.doc(fb.db, 'users', u.uid, 'inbox', id));
}

// ---------- category guess ----------
// Plaid's own label, mapped to your categories. Only ever a starting guess —
// the review queue makes you confirm before anything counts.
const MAP = {
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  FOOD_AND_DRINK: 'eating-out',
  TRANSPORTATION_GAS: 'gas',
  TRANSPORTATION: 'gas',
  PERSONAL_CARE: 'personal',
  GENERAL_MERCHANDISE: 'other',
  ENTERTAINMENT: 'other',
  INCOME: 'income',
  TRANSFER_IN: 'income',
  LOAN_PAYMENTS: 'bills',
  RENT_AND_UTILITIES: 'bills'
};

export function suggest(it, categories) {
  const key = String(it.plaidCategory || '');
  const guess = MAP[key] || MAP[key.split('_').slice(0, 2).join('_')] || MAP[key.split('_')[0]];
  if (it.type === 'income') return 'income';
  if (guess && categories.some((c) => c.id === guess)) return guess;
  if (guess === 'bills' || guess === 'income') return guess;
  return null;
}
