import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const LS_KEY = 'budget-tracker-v1';
const CDN = 'https://www.gstatic.com/firebasejs/11.0.2/';
const clone = (o) => JSON.parse(JSON.stringify(o));

// Everything lives in memory + localStorage so the app is instant and works
// offline. When signed in, it is mirrored to Firestore under users/{uid}.
export const store = {
  settings: clone(DEFAULT_SETTINGS),
  txs: [],
  user: null,
  syncError: null,
  onChange: () => {},
  _fb: null
};

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ settings: store.settings, txs: store.txs })); } catch {}
}

export function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw) {
      store.settings = { ...clone(DEFAULT_SETTINGS), ...raw.settings };
      store.txs = raw.txs || [];
    }
  } catch {}
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function saveSettings() {
  persist();
  store.onChange();
  const fb = store._fb;
  if (fb && store.user) fb.setDoc(fb.doc(fb.db, 'users', store.user.uid, 'meta', 'settings'), store.settings).catch(syncFail);
}

export function addTx(tx) {
  tx.id = uid();
  store.txs.push(tx);
  persist();
  store.onChange();
  const fb = store._fb;
  if (fb && store.user) fb.setDoc(fb.doc(fb.db, 'users', store.user.uid, 'transactions', tx.id), tx).catch(syncFail);
  return tx;
}

export function deleteTx(id) {
  store.txs = store.txs.filter((t) => t.id !== id);
  persist();
  store.onChange();
  const fb = store._fb;
  if (fb && store.user) fb.deleteDoc(fb.doc(fb.db, 'users', store.user.uid, 'transactions', id)).catch(syncFail);
}

function syncFail(e) {
  console.error(e);
  store.syncError = e.code === 'permission-denied'
    ? 'Firestore rules are blocking sync — deploy firestore.rules.'
    : 'Sync problem: ' + (e.message || e);
  store.onChange();
}

// ---- Firebase (loaded lazily so the app still works if it can't load) ----
let initPromise;
export function initFirebase() {
  return (initPromise ||= (async () => {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(CDN + 'firebase-app.js'),
      import(CDN + 'firebase-auth.js'),
      import(CDN + 'firebase-firestore.js')
    ]);
    const app = initializeApp(firebaseConfig);
    const db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
    const a = auth.getAuth(app);
    store._fb = { ...fs, db, auth: a, authMod: auth };
    auth.onAuthStateChanged(a, (u) => onUser(u));
  })().catch((e) => { console.warn('Firebase unavailable, running local-only', e); }));
}

let unsubs = [];
async function onUser(u) {
  unsubs.forEach((f) => f()); unsubs = [];
  store.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
  store.syncError = null;
  store.onChange();
  if (!u) return;
  const fb = store._fb;
  const settingsRef = fb.doc(fb.db, 'users', u.uid, 'meta', 'settings');
  try {
    const snap = await fb.getDoc(settingsRef);
    if (!snap.exists()) {
      // First sign-in: push what's on this device up to the cloud.
      await fb.setDoc(settingsRef, store.settings);
      await Promise.all(store.txs.map((t) => fb.setDoc(fb.doc(fb.db, 'users', u.uid, 'transactions', t.id), t)));
    }
  } catch (e) { syncFail(e); return; }
  unsubs.push(fb.onSnapshot(settingsRef, (s) => {
    if (s.exists()) { store.settings = { ...clone(DEFAULT_SETTINGS), ...s.data() }; persist(); store.onChange(); }
  }, syncFail));
  unsubs.push(fb.onSnapshot(fb.collection(fb.db, 'users', u.uid, 'transactions'), (s) => {
    store.txs = s.docs.map((d) => d.data()); persist(); store.onChange();
  }, syncFail));
}

export async function signIn() {
  await initFirebase();
  const fb = store._fb;
  if (!fb) throw new Error('Firebase could not load');
  const provider = new fb.authMod.GoogleAuthProvider();
  try { await fb.authMod.signInWithPopup(fb.auth, provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked') return fb.authMod.signInWithRedirect(fb.auth, provider);
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
  }
}
export async function signOut() { const fb = store._fb; if (fb) await fb.authMod.signOut(fb.auth); }
