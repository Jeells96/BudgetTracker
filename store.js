import { firebaseConfig } from './firebase-config.js?v=94';
import { DEFAULT_SETTINGS } from './defaults.js?v=94';
import { HISTORY } from './history.js?v=94';

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
  out.bills = out.bills.map((b) => ({ ...b, day: b.day || 1, everyMonths: Math.max(1, Math.round(+b.everyMonths || 1)), history: Array.isArray(b.history) ? b.history : [], useAvg: !!b.useAvg }));
  out.pending = Array.isArray(s && s.pending) ? s.pending : [];
  // Your own weekly spending goal (null = let the app work it out).
  out.weeklyGoal = (s && s.weeklyGoal != null && s.weeklyGoal !== '') ? +s.weeklyGoal : null;
  // What was planned for each week, keyed by that week's start date.
  out.weekPlans = (s && s.weekPlans && typeof s.weekPlans === 'object') ? s.weekPlans : {};
  out.returns = Array.isArray(s && s.returns) ? s.returns : [];
  const cc = (s && s.cc) || {};
  out.cc = {
    start: cc.start ?? cc.balance ?? 0,
    asOf: cc.asOf ?? null,
    asOfAt: +cc.asOfAt || 0,        // the moment a stated balance was given
    mode: cc.mode || 'auto',
    manual: cc.manual ?? cc.balance ?? 0,
    chargesAdj: cc.chargesAdj || 0,
    strategy: cc.strategy || 'extra',
    // Shares of the week's shortfall taken from each side of a "split".
    splitPct: (cc.splitPct && typeof cc.splitPct === 'object')
      ? { spend: +cc.splitPct.spend || 0, save: +cc.splitPct.save || 0 } : { spend: 50, save: 50 },
    paidThrough: cc.paidThrough ?? null,
    payoffBy: cc.payoffBy ?? null,
    planEdits: (cc.planEdits && typeof cc.planEdits === 'object') ? cc.planEdits : {},
    // What the bank itself says, kept beside the log rather than replacing it.
    plaidBal: (cc.plaidBal && typeof cc.plaidBal === 'object')
      ? { ...cc.plaidBal, pending: +cc.plaidBal.pending || 0 } : null
  };
  const ba = (s && s.billsAcct) || {};
  out.billsAcct = { bal: ba.bal ?? null, asOf: ba.asOf ?? null };
  // Learned "this merchant is that bill" matches, so a bill only gets mapped once.
  out.billMatch = (s && s.billMatch && typeof s.billMatch === 'object') ? s.billMatch : {};
  // Standing rules for imported activity: paycheques, transfers, things to ignore.
  out.txMatch = (s && s.txMatch && typeof s.txMatch === 'object') ? s.txMatch : {};
  // Who pays you. Matched loosely, since deposit descriptions carry batch numbers.
  out.incomePayers = Array.isArray(s && s.incomePayers) ? s.incomePayers : ['Arctic Sheet Metal'];
  // The day-to-day account's live balance, mirrored from the bank.
  out.spendAcct = (s && s.spendAcct && typeof s.spendAcct === 'object') ? s.spendAcct : { bal: null, name: null, asOf: null };
  out.bankOn = !!(s && s.bankOn);
  out.bankSyncAt = (s && +s.bankSyncAt) || 0;
  out.webhooksAt = (s && +s.webhooksAt) || 0;
  out.finance = normalizeFinance(s && s.finance);
  return out;
}

// Keep the loan planner in sync with the hardcoded defaults (so newly-added loans
// appear) while preserving the user's own edits: current balance, planned extras, etc.
function normalizeFinance(fin) {
  fin = fin || {};
  const def = clone(DEFAULT_SETTINGS).finance;
  const stored = {};
  (Array.isArray(fin.loans) ? fin.loans : []).forEach((l) => { if (l && l.id) stored[l.id] = l; });
  const loans = def.loans.map((d) => {
    const u = stored[d.id] || {};
    return {
      ...d,
      name: u.name || d.name, lender: u.lender ?? d.lender,
      rate: u.rate != null ? u.rate : d.rate,
      payment: u.payment != null ? u.payment : d.payment,
      adjust: u.adjust != null ? u.adjust : d.adjust,
      extra: u.extra != null ? u.extra : d.extra,
      extras: (u.extras && typeof u.extras === 'object') ? u.extras : d.extras,
      deleted: !!u.deleted
    };
  });
  // Keep any custom loans the user added that aren't part of the defaults.
  (Array.isArray(fin.loans) ? fin.loans : []).forEach((l) => { if (l && l.id && !def.loans.find((d) => d.id === l.id)) loans.push(l); });
  const iv = fin.invest || {};
  return { loans, invest: { monthly: iv.monthly != null ? iv.monthly : def.invest.monthly, years: iv.years != null ? iv.years : def.invest.years, rate: iv.rate != null ? iv.rate : def.invest.rate } };
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

// Banking reuses this exact Firestore handle. Resolves with null if Firebase
// never came up, so a caller gets an answer instead of hanging forever.
let _fbResolve;
export const fbReady = new Promise((r) => { _fbResolve = r; });

function fail(e) {
  console.error(e);
  store.sync = 'error';
  store.syncError = e.code === 'permission-denied'
    ? 'Firestore is refusing access — paste the open rules from the README into Firestore → Rules → Publish.'
    : 'Sync problem: ' + (e.message || e);
  store.onChange();
}
function cloudSet(tx) { const fb = store._fb; if (fb) fb.setDoc(fb.doc(fb.db, 'transactions', tx.id), tx).catch(fail); }

// rerender=false persists and syncs without redrawing. Redrawing from a field's
// change event destroys whatever the user was reaching for, so the tap that
// caused the blur lands on nothing.
export function saveSettings(rerender = true) {
  persist(); if (rerender) store.onChange();
  const fb = store._fb;
  if (fb) fb.setDoc(fb.doc(fb.db, 'budget', 'settings'), store.settings).catch(fail);
}
export function addTx(tx) {
  tx.id = uid(); if (tx.at == null) tx.at = Date.now(); store.txs.push(tx); persist(); store.onChange(); cloudSet(tx); return tx;
}
export function updateTx(id, patch) {
  const t = store.txs.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  persist(); store.onChange(); cloudSet(t);
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
    _fbResolve(fb);
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
  } catch (e) { console.warn('Firebase unavailable, running local-only', e); _fbResolve(null); store.sync = 'local'; store.onChange(); }
}
