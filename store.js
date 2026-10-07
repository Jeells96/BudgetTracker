import { firebaseConfig } from './firebase-config.js?v=3';
import { DEFAULT_SETTINGS } from './defaults.js?v=3';
import { HISTORY } from './history.js?v=3';

const LS_KEY = 'budget-tracker-v2';
const CDN = 'https://www.gstatic.com/firebasejs/11.0.2/';
const clone = (o) => JSON.parse(JSON.stringify(o));

// Everything lives in memory + localStorage so the app is instant and works offline.
// When Firebase loads, it is mirrored to Firestore (open rules, no sign-in):
//   budget/settings      -> settings
//   transactions/{id}    -> one doc per line item
export const store = {
  settings: clone(DEFAULT_SETTINGS),
  txs: [],
  sync: 'local',          // 'local' | 'connecting' | 'synced' | 'error'
  syncError: null,
  onChange: () => {},
  _fb: null
};

function normalize(s) {
  const out = { ...clone(DEFAULT_SETTINGS), ...s };
  if (s && s.weeklyPay == null && s.income) out.weeklyPay = round2(s.income / 4);
  out.bills = out.bills.map((b) => ({ ...b, day: b.day || 1 }));
  out.cc = out.cc || { balance: 0, asOf: null };
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ settings: store.settings, txs: store.txs })); } catch {}
}

export function loadLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw) { store.settings = normalize(raw.settings); store.txs = raw.txs || []; }
  } catch {}
  // First run: bring in every line item from the spreadsheet.
  if (!store.settings.seeded && store.txs.length === 0) {
    store.txs = clone(HISTORY);
    store.settings.seeded = true;
    persist();
  }
}

// Add back any spreadsheet rows that are missing (never duplicates — ids are fixed).
export function reimportHistory() {
  const have = new Set(store.txs.map((t) => t.id));
  const missing = HISTORY.filter((h) => !have.has(h.id));
  missing.forEach((t) => { store.txs.push(clone(t)); cloudSet(t); });
  persist(); store.onChange();
  return missing.length;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function fail(e) {
  console.error(e);
  store.sync = 'error';
  store.syncError = e.code === 'permission-denied'
    ? 'Firestore is refusing access — paste the open rules from the README into Firestore → Rules → Publish.'
    : 'Sync problem: ' + (e.message || e);
  store.onChange();
}
function cloudSet(tx) { const fb = store._fb; if (fb) fb.setDoc(fb.doc(fb.db, 'transactions', tx.id), tx).catch(fail); }

export function saveSettings() {
  persist(); store.onChange();
  const fb = store._fb;
  if (fb) fb.setDoc(fb.doc(fb.db, 'budget', 'settings'), store.settings).catch(fail);
}
export function addTx(tx) {
  tx.id = uid(); store.txs.push(tx); persist(); store.onChange(); cloudSet(tx); return tx;
}
export function deleteTx(id) {
  store.txs = store.txs.filter((t) => t.id !== id); persist(); store.onChange();
  const fb = store._fb;
  if (fb) fb.deleteDoc(fb.doc(fb.db, 'transactions', id)).catch(fail);
}

async function pushAll(fb, txs) {
  for (let i = 0; i < txs.length; i += 400) {
    const batch = fb.writeBatch(fb.db);
    txs.slice(i, i + 400).forEach((t) => batch.set(fb.doc(fb.db, 'transactions', t.id), t));
    await batch.commit();
  }
}

export async function initFirebase() {
  store.sync = 'connecting'; store.onChange();
  try {
    const [{ initializeApp }, fs] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-firestore.js')]);
    const db = fs.initializeFirestore(initializeApp(firebaseConfig), { localCache: fs.persistentLocalCache() });
    const fb = { ...fs, db };
    const sref = fb.doc(db, 'budget', 'settings');

    // Settings: the cloud copy wins; if there isn't one yet, upload this device's.
    fb.onSnapshot(sref, (s) => {
      if (s.metadata.fromCache && !s.exists()) return;
      if (s.exists()) { store.settings = normalize(s.data()); persist(); }
      else fb.setDoc(sref, store.settings).catch(fail);
      store._fb = fb; store.sync = 'synced'; store.syncError = null; store.onChange();
    }, fail);

    // Transactions: same idea — if the cloud is empty, upload the local copy (incl. the imported history).
    let first = true;
    fb.onSnapshot(fb.collection(db, 'transactions'), (s) => {
      if (s.metadata.fromCache && s.empty) return;
      if (first && s.empty) { first = false; pushAll(fb, store.txs).catch(fail); return; }
      first = false;
      store.txs = s.docs.map((d) => d.data()); persist(); store.onChange();
    }, fail);
  } catch (e) { console.warn('Firebase unavailable, running local-only', e); store.sync = 'local'; store.onChange(); }
}
