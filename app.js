import { store, loadLocal, saveSettings, addTx, deleteTx, uid, initFirebase, signIn, signOut } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const round = (n) => Math.round(n * 100) / 100;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthKey = (d) => ymd(d).slice(0, 7);
const monthLabel = (k) => parseYmd(k + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const dayLabel = (s) => {
  if (s === today()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Yesterday';
  return parseYmd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};
const weekStart = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }; // Monday

const ui = { tab: 'home', month: monthKey(new Date()), filter: 'all' };

// ---------- data helpers ----------
const S = () => store.settings;
const cat = (id) => S().categories.find((c) => c.id === id);
const monthTxs = () => store.txs.filter((t) => t.date.startsWith(ui.month)).sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));
const expenses = (list) => list.filter((t) => t.type !== 'income');
const spentIn = (list, id) => round(expenses(list).filter((t) => t.category === id).reduce((s, t) => s + t.amount, 0));
const paidSet = () => new Set(S().paid[ui.month] || []);

// ---------- rendering ----------
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#app').innerHTML = { home, bills, activity, settings }[ui.tab]();
}
store.onChange = () => { if (!document.activeElement || !document.activeElement.closest('#app input')) render(); };

function header(title) {
  const months = ui.tab === 'settings' ? '' : `<div class="month">
    <button data-act="prev" aria-label="Previous month">‹</button>
    <button data-act="next" aria-label="Next month">›</button></div>`;
  return `<div class="top"><div><h1>${title}</h1><div class="muted">${monthLabel(ui.month)}</div></div>${months}</div>`;
}

function barClass(spent, budget) { return spent > budget ? 'over' : spent > budget * 0.85 ? 'warn' : ''; }

function home() {
  const list = monthTxs();
  const cats = S().categories;
  const budget = round(cats.reduce((s, c) => s + c.budget, 0));
  const spent = round(expenses(list).reduce((s, t) => s + t.amount, 0));
  const left = round(budget - spent);
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const bills = S().bills, paid = paidSet();
  const billsTotal = round(bills.reduce((s, b) => s + b.amount, 0));
  const expectedSavings = round(S().income - billsTotal - budget);
  const incomeIn = round(list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));

  const isNow = ui.month === monthKey(new Date());
  let week = '';
  if (isNow && S().weeklyBudget > 0) {
    const ws = weekStart(new Date());
    const ids = cats.filter((c) => c.weekly).map((c) => c.id);
    const wSpent = round(expenses(store.txs).filter((t) => t.date >= ws && ids.includes(t.category)).reduce((s, t) => s + t.amount, 0));
    const wLeft = round(S().weeklyBudget - wSpent);
    week = `<h2>This week</h2><div class="card">
      <div class="week"><span class="muted">Everyday spending left</span><b style="${wLeft < 0 ? 'color:var(--bad)' : ''}">${money(wLeft)}</b></div>
      <div class="bar ${barClass(wSpent, S().weeklyBudget)}"><i style="width:${Math.min(100, (wSpent / S().weeklyBudget) * 100)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(wSpent)} of ${money(S().weeklyBudget)} · ${ids.map((i) => esc(cat(i).name)).join(', ')}</div></div>`;
  }

  const catRows = cats.map((c) => {
    const sp = spentIn(list, c.id);
    const inner = c.budget > 0
      ? `<div class="row"><span class="n">${esc(c.name)}</span><span class="a">${money(sp)} / ${money(c.budget)}</span></div>
         <div class="bar ${barClass(sp, c.budget)}"><i style="width:${Math.min(100, (sp / c.budget) * 100)}%"></i></div>`
      : `<div class="row"><span class="n">${esc(c.name)}</span><span class="a">${money(sp)} spent</span></div>`;
    return `<div class="cat"><div class="emoji">${c.emoji}</div><div class="body">${inner}</div></div>`;
  }).join('');

  return `${header('Budget')}
    <div class="card hero">
      <div class="label">Left to spend</div>
      <div class="big ${left < 0 ? 'neg' : ''}">${money(left)}</div>
      <div class="bar ${barClass(spent, budget)}"><i style="width:${pct}%"></i></div>
      <div class="stats">
        <div><b>${money(spent)}</b><span>Spent of ${money(budget)}</span></div>
        <div><b>${paid.size}/${bills.length}</b><span>Bills paid</span></div>
        <div><b>${money(expectedSavings)}</b><span>Planned savings</span></div>
      </div>
    </div>
    <button class="log-btn" data-act="log"><span class="plus">+</span> Log a purchase</button>
    ${week}
    <h2>Categories</h2><div class="card">${catRows}</div>
    <h2>Recent</h2><div class="card">${list.length ? list.slice(0, 5).map(txRow).join('') : '<div class="empty">Nothing logged yet this month.<br>Tap the big button to add your first purchase.</div>'}</div>
    ${incomeIn ? `<p class="note">Income logged this month: ${money(incomeIn)}</p>` : ''}`;
}

function txRow(t) {
  const c = cat(t.category);
  const inc = t.type === 'income';
  return `<button class="tx" data-act="tx" data-id="${esc(t.id)}">
    <div class="emoji">${inc ? '💰' : c ? c.emoji : '🧾'}</div>
    <div class="body"><div class="t">${esc(t.note || (inc ? 'Income' : c ? c.name : 'Purchase'))}</div>
    <div class="s">${esc(inc ? 'Income' : c ? c.name : t.category)} · ${parseYmd(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>
    <div class="amt ${inc ? 'in' : ''}">${inc ? '+' : ''}${money(t.amount)}</div></button>`;
}

function bills() {
  const b = S().bills, paid = paidSet();
  const total = round(b.reduce((s, x) => s + x.amount, 0));
  const paidAmt = round(b.filter((x) => paid.has(x.id)).reduce((s, x) => s + x.amount, 0));
  const sorted = [...b].sort((x, y) => paid.has(x.id) - paid.has(y.id));
  return `${header('Bills')}
    <div class="card hero"><div class="label">Still to pay</div><div class="big">${money(round(total - paidAmt))}</div>
      <div class="bar"><i style="width:${total ? (paidAmt / total) * 100 : 0}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(paidAmt)} paid of ${money(total)}</div></div>
    <h2>This month</h2><div class="card">${sorted.map((x) => `
      <button class="bill ${paid.has(x.id) ? 'paid' : ''}" data-act="bill" data-id="${esc(x.id)}">
        <div class="check">✓</div><div class="body"><div class="n">${esc(x.name)}</div>${x.day ? `<div class="d">Due the ${ordinal(x.day)}</div>` : ''}</div>
        <div class="amt">${money(x.amount)}</div></button>`).join('') || '<div class="empty">No bills yet — add them in Settings.</div>'}</div>`;
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);

function activity() {
  let list = monthTxs();
  if (ui.filter !== 'all') list = list.filter((t) => (ui.filter === 'income' ? t.type === 'income' : t.category === ui.filter && t.type !== 'income'));
  const chips = [['all', 'All'], ...S().categories.map((c) => [c.id, c.emoji + ' ' + c.name]), ['income', '💰 Income']]
    .map(([id, l]) => `<button class="chip ${ui.filter === id ? 'on' : ''}" data-act="filter" data-id="${esc(id)}">${esc(l)}</button>`).join('');
  let html = '', last = '';
  for (const t of list) {
    if (t.date !== last) { if (last) html += '</div>'; html += `<div class="day">${dayLabel(t.date)}</div><div class="card" style="padding:6px 18px">`; last = t.date; }
    html += txRow(t);
  }
  if (last) html += '</div>';
  const total = round(expenses(list).reduce((s, t) => s + t.amount, 0));
  return `${header('Activity')}<div class="chips">${chips}</div>
    ${list.length ? `<p class="note">${list.length} transaction${list.length > 1 ? 's' : ''} · ${money(total)} spent</p>${html}` : '<div class="card empty">Nothing here.</div>'}`;
}

function settings() {
  const s = S();
  const u = store.user;
  return `${header('Settings')}
    <h2>Sync</h2><div class="card">${u
      ? `<div class="field"><label>Signed in as<br><span class="muted">${esc(u.email)}</span></label><button class="btn" data-act="signout">Sign out</button></div>`
      : `<div class="muted">Your data is saved on this device. Sign in to back it up and use it on your phone and computer.</div><button class="btn primary block" data-act="signin">Sign in with Google</button>`}
      ${store.syncError ? `<div class="err">${esc(store.syncError)}</div>` : ''}</div>
    <h2>Monthly plan</h2><div class="card">
      <div class="field"><label>Monthly income</label><input type="number" inputmode="decimal" value="${s.income}" data-set="income"></div>
      <div class="field"><label>Weekly everyday budget<br><span class="muted" style="font-size:.8rem">Categories marked “weekly” below</span></label><input type="number" inputmode="decimal" value="${s.weeklyBudget}" data-set="weeklyBudget"></div></div>
    <h2>Category budgets</h2><div class="card">${s.categories.map((c, i) => `
      <div class="field weekly"><span class="emoji" style="width:36px;height:36px">${c.emoji}</span><label>${esc(c.name)}</label>
        <input type="number" inputmode="decimal" value="${c.budget}" data-cat="${i}" data-field="budget">
        <button class="x" data-act="delcat" data-i="${i}" aria-label="Delete">✕</button>
        <label class="muted" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.weekly ? 'checked' : ''} data-cat="${i}" data-field="weekly"> counts toward weekly budget</label></div>`).join('')}
      <button class="btn block" data-act="addcat">+ Add category</button></div>
    <h2>Monthly bills</h2><div class="card">${s.bills.map((b, i) => `
      <div class="field"><input class="name" type="text" value="${esc(b.name)}" data-bill="${i}" data-field="name">
        <input type="number" inputmode="decimal" value="${b.amount}" data-bill="${i}" data-field="amount" style="width:90px">
        <button class="x" data-act="delbill" data-i="${i}" aria-label="Delete">✕</button></div>`).join('')}
      <button class="btn block" data-act="addbill">+ Add bill</button></div>
    <p class="note">Everything saves automatically.</p>`;
}

// ---------- log a purchase (step-by-step sheet) ----------
let flow = null;
function openFlow() { flow = { step: 1, type: 'expense', amt: '', category: null, note: '', date: today() }; drawFlow(); $('#sheet').hidden = false; }
function closeFlow() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; flow = null; }

function drawFlow() {
  const f = flow, el = $('#sheet');
  const amtNum = parseFloat(f.amt) || 0;
  const steps = f.type === 'income' ? 2 : 3;
  const stepNo = f.type === 'income' && f.step === 3 ? 2 : f.step;
  let body = '';
  if (f.step === 1) {
    body = `<div class="q">How much?</div>
      <div class="seg"><button data-flow="type" data-v="expense" class="${f.type === 'expense' ? 'on' : ''}">Purchase</button><button data-flow="type" data-v="income" class="${f.type === 'income' ? 'on' : ''}">Income</button></div>
      <div class="amount ${amtNum ? '' : 'zero'}">$${esc(f.amt || '0')}</div>
      <div class="pad">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => `<button data-flow="key" data-v="${k}">${k}</button>`).join('')}</div>
      <button class="btn primary block" data-flow="next" ${amtNum ? '' : 'disabled style="opacity:.4"'}>Continue</button>`;
  } else if (f.step === 2) {
    body = `<div class="q">What was it for?</div><div class="cats">${S().categories.map((c) => `<button data-flow="cat" data-v="${esc(c.id)}"><span class="e">${c.emoji}</span>${esc(c.name)}</button>`).join('')}</div>`;
  } else {
    const c = cat(f.category);
    body = `<div class="q">Any details?</div>
      <div class="summary"><div class="emoji" style="background:var(--card)">${f.type === 'income' ? '💰' : c.emoji}</div><div><b>${money(amtNum)}</b><div class="muted">${f.type === 'income' ? 'Income' : esc(c.name)}</div></div></div>
      <input class="sheet-input" id="f-note" type="text" placeholder="${f.type === 'income' ? 'Paycheck, refund…' : 'Wingstop, groceries…'} (optional)" value="${esc(f.note)}" autocomplete="off">
      <input class="sheet-input" id="f-date" type="date" value="${f.date}" max="${today()}">
      <button class="btn primary block" data-flow="save">Save</button>`;
  }
  el.innerHTML = `<div class="panel"><div class="head">
    ${f.step > 1 ? '<button data-flow="back" aria-label="Back">←</button>' : '<span style="width:40px"></span>'}
    <span class="step">Step ${stepNo} of ${steps}</span><button data-flow="close" aria-label="Close">✕</button></div>${body}</div>`;
  if (f.step === 3) setTimeout(() => $('#f-note')?.focus(), 50);
}

function flowClick(btn) {
  const f = flow, v = btn.dataset.v;
  switch (btn.dataset.flow) {
    case 'close': return closeFlow();
    case 'type': f.type = v; return drawFlow();
    case 'key':
      if (v === '⌫') f.amt = f.amt.slice(0, -1);
      else if (v === '.') { if (!f.amt.includes('.')) f.amt = (f.amt || '0') + '.'; }
      else if (!(f.amt.includes('.') && f.amt.split('.')[1].length >= 2) && f.amt.replace('.', '').length < 8) f.amt = f.amt === '0' ? v : f.amt + v;
      return drawFlow();
    case 'next': if (parseFloat(f.amt) > 0) { f.step = f.type === 'income' ? 3 : 2; drawFlow(); } return;
    case 'cat': f.category = v; f.step = 3; return drawFlow();
    case 'back': f.step = f.type === 'income' && f.step === 3 ? 1 : f.step - 1; return drawFlow();
    case 'save': {
      const note = $('#f-note').value.trim(), date = $('#f-date').value || today();
      const tx = { type: f.type, amount: round(parseFloat(f.amt)), category: f.type === 'income' ? 'income' : f.category, note, date };
      addTx(tx);
      ui.month = date.slice(0, 7); ui.tab = 'home';
      const c = cat(tx.category);
      let msg = tx.type === 'income' ? `Added ${money(tx.amount)} income` : `Logged ${money(tx.amount)} · ${c.name}`;
      if (tx.type !== 'income' && c.budget > 0) { const left = round(c.budget - spentIn(monthTxs(), c.id)); msg += left >= 0 ? ` · ${money(left)} left` : ` · ${money(-left)} over`; }
      closeFlow(); render(); toast(msg);
    }
  }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const fl = e.target.closest('[data-flow]');
  if (fl && flow) return flowClick(fl);
  if (e.target === $('#sheet')) return closeFlow();
  const tab = e.target.closest('#tabs button');
  if (tab) { ui.tab = tab.dataset.tab; scrollTo(0, 0); return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'log': return openFlow();
    case 'prev': case 'next': { const d = parseYmd(ui.month + '-01'); d.setMonth(d.getMonth() + (b.dataset.act === 'next' ? 1 : -1)); ui.month = monthKey(d); return render(); }
    case 'filter': ui.filter = id; return render();
    case 'bill': { const set = paidSet(); set.has(id) ? set.delete(id) : set.add(id); S().paid[ui.month] = [...set]; return saveSettings(); }
    case 'tx': { const t = store.txs.find((x) => x.id === id); if (t && confirm(`Delete "${t.note || cat(t.category)?.name || 'this transaction'}" (${money(t.amount)})?`)) deleteTx(id); return; }
    case 'addcat': { const name = prompt('Category name?'); if (name?.trim()) { S().categories.push({ id: uid(), name: name.trim(), emoji: '🏷️', budget: 0, weekly: false }); saveSettings(); } return; }
    case 'delcat': if (confirm(`Delete "${S().categories[i].name}"? Existing transactions are kept.`)) { S().categories.splice(i, 1); saveSettings(); } return;
    case 'addbill': { const name = prompt('Bill name?'); if (name?.trim()) { S().bills.push({ id: uid(), name: name.trim(), amount: 0, day: null }); saveSettings(); } return; }
    case 'delbill': if (confirm(`Delete "${S().bills[i].name}"?`)) { S().bills.splice(i, 1); saveSettings(); } return;
    case 'signin': try { await signIn(); } catch (err) { store.syncError = err.message; render(); } return;
    case 'signout': return signOut();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) { S()[t.dataset.set] = parseFloat(t.value) || 0; saveSettings(); }
  else if (t.dataset.cat) { const c = S().categories[+t.dataset.cat]; c[t.dataset.field] = t.type === 'checkbox' ? t.checked : parseFloat(t.value) || 0; saveSettings(); }
  else if (t.dataset.bill) { const b = S().bills[+t.dataset.bill]; b[t.dataset.field] = t.dataset.field === 'amount' ? parseFloat(t.value) || 0 : t.value; saveSettings(); }
  render();
});

loadLocal();
render();
initFirebase();
