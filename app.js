import { store, loadLocal, saveSettings, addTx, updateTx, deleteTx, uid, initFirebase, reimportHistory } from './store.js?v=4';
import { TRANSFERS } from './defaults.js?v=4';
import { round, ymd, parseYmd, monthStats, weekStats, standardWeek, billsTotal, firstTotal, cardBalance, cardPlan, weekPlan, monthlyIncome } from './calc.js?v=4';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

const today = () => ymd(new Date());
const monthKey = (d) => ymd(d).slice(0, 7);
const monthLabel = (k) => parseYmd(k + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const monthShort = (k) => parseYmd(k + '-01').toLocaleDateString('en-US', { month: 'long' });
const dayLabel = (s) => {
  if (s === today()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Yesterday';
  const d = parseYmd(s);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);

const ui = { tab: 'home', month: monthKey(new Date()), filter: 'all', all: false, q: '' };

// ---------- helpers ----------
const S = () => store.settings;
const cat = (id) => S().categories.find((c) => c.id === id);
const tfer = (id) => TRANSFERS.find((t) => t.id === id);
const sortTx = (a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1);
const monthTxs = () => store.txs.filter((t) => t.date.startsWith(ui.month)).sort(sortTx);
const MS = () => monthStats(S(), store.txs, ui.month);
const barClass = (spent, budget) => (spent > budget ? 'over' : spent > budget * 0.85 ? 'warn' : '');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

// ---------- rendering ----------
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#app').innerHTML = { home, bills, plan: planTab, activity, settings }[ui.tab]();
}
store.onChange = () => { if (!document.activeElement || !document.activeElement.closest('#app input')) render(); };

function header(title, nav = true) {
  const months = !nav ? '' : `<div class="month">
    <button data-act="prev" aria-label="Previous month">‹</button><button data-act="next" aria-label="Next month">›</button></div>`;
  const sub = ui.tab === 'activity' && ui.all ? 'Whole history' : nav ? monthLabel(ui.month) : '';
  return `<div class="top"><div><h1>${title}</h1><div class="muted">${sub}</div></div>${months}</div>`;
}

function home() {
  const s = S(), ms = MS();
  const ws = weekStats(s, store.txs);
  const bal = cardBalance(s, store.txs);
  const weekly = ms.isCurrent && s.weeklyBudget > 0;

  let hero;
  if (weekly) {
    const stat3 = bal > 0
      ? `<div><b>${money(bal)}</b><span>Card balance</span></div>`
      : `<div><b>${money(s.weeklySavings)}</b><span>Weekly savings</span></div>`;
    hero = `<div class="card hero">
      <div class="label">Left to spend this week</div>
      <div class="big ${ws.left < 0 ? 'neg' : ''}">${money(ws.left)}</div>
      <div class="bar ${barClass(ws.spent, ws.budget)}"><i style="width:${pct(ws.spent, ws.budget)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(ws.spent)} of ${money(ws.budget)} · ${ws.ids.map((i) => esc(cat(i)?.name)).join(', ')}</div>
      <div class="stats">
        <div><b>${money(ws.spent)}</b><span>Spent this week</span></div>
        <div><b>${money(ms.billsLeft)}</b><span>Still to bills</span></div>
        ${stat3}
      </div></div>`;
  } else {
    const n = ms.list.filter((t) => t.type === 'expense').length;
    hero = `<div class="card hero">
      <div class="label">Spent in ${monthShort(ui.month)}</div>
      <div class="big">${money(ms.spent)}</div>
      <div class="note" style="margin:8px 0 0">${n} purchase${n === 1 ? '' : 's'}${ms.income ? ` · ${money(ms.income)} income` : ''}</div></div>`;
  }

  const catRows = s.categories.map((c) => {
    const sp = ms.byCat[c.id];
    const inner = c.budget > 0
      ? `<div class="row"><span class="n">${esc(c.name)}</span><span class="a">${money(sp)} / ${money(c.budget)}</span></div>
         <div class="bar ${barClass(sp, c.budget)}"><i style="width:${pct(sp, c.budget)}%"></i></div>`
      : `<div class="row"><span class="n">${esc(c.name)}</span><span class="a">${money(sp)} spent</span></div>`;
    return `<div class="cat"><div class="emoji">${c.emoji}</div><div class="body">${inner}</div></div>`;
  }).join('');
  const recent = monthTxs().slice(0, 5);

  return `${header('Budget')}
    ${hero}
    <button class="log-btn" data-act="log"><span class="plus">+</span> Log a purchase</button>
    <h2>Categories</h2><div class="card">${catRows}</div>
    <h2>Recent</h2><div class="card">${recent.length ? recent.map(txRow).join('') : '<div class="empty">Nothing logged yet this month.<br>Tap the big button to add your first purchase.</div>'}</div>`;
}

function txRow(t) {
  let icon, label, sub, amt;
  if (t.type === 'income') { icon = '💰'; label = t.note || 'Paycheck'; sub = 'Income'; amt = `<div class="amt in">+${money(t.amount)}</div>`; }
  else if (t.type === 'transfer') { const x = tfer(t.category); icon = x?.emoji || '🔁'; label = t.note || 'Transfer'; sub = 'To ' + (x?.name || t.category).toLowerCase(); amt = `<div class="amt xfer">${money(t.amount)}</div>`; }
  else { const c = cat(t.category); icon = c ? c.emoji : '🧾'; label = t.note || (c ? c.name : 'Purchase'); sub = c ? c.name : t.category; amt = `<div class="amt">${money(t.amount)}</div>`; }
  return `<button class="tx" data-act="tx" data-id="${esc(t.id)}"><div class="emoji">${icon}</div>
    <div class="body"><div class="t">${esc(label)}</div><div class="s">${esc(sub)} · ${parseYmd(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>${amt}<span class="chev">›</span></button>`;
}

function bills() {
  const s = S(), ms = MS(), cp = cardPlan(s, store.txs);
  const T = ms.billsTotal, F = ms.billsIn;
  const byDay = [...s.bills].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  const first = byDay.filter((x) => x.day === 1), later = byDay.filter((x) => x.day !== 1);
  const tot = (l) => round(l.reduce((a, x) => a + x.amount, 0));
  const wk = ms.isCurrent && ms.billsLeft > 0 ? round(ms.billsLeft / ms.weeksLeft) : 0;
  const billRow = (x) => `<div class="bill"><div class="d-badge">${x.day}</div><div class="body"><div class="n">${esc(x.name)}</div><div class="d">Auto-pays the ${ordinal(x.day)}</div></div><div class="amt">${money(x.amount)}</div></div>`;

  const milestone = (label, goal, sub) => {
    const need = Math.max(0, round(goal - F));
    return `<div class="card mile"><div class="week"><span class="muted">${label}</span><b style="${need ? '' : 'color:var(--good)'}">${need ? money(need) + ' more' : 'Funded ✓'}</b></div>
      <div class="bar"><i style="width:${pct(F, goal)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(Math.min(F, goal))} of ${money(goal)} · ${sub}</div></div>`;
  };

  return `${header('Bills')}
    <div class="card hero"><div class="label">Still to move into your bills account</div>
      <div class="big">${money(ms.billsLeft)}</div>
      <div class="bar"><i style="width:${pct(F, T)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(F)} moved this month of ${money(T)} total${wk ? ` · about <b>${money(wk)}</b> a paycheck for the ${ms.weeksLeft} left` : ''}</div></div>
    <h2>Milestones</h2>
    ${milestone('Ready for the 1st', ms.firstTotal, 'bills that auto-pay on the 1st')}
    <div style="height:10px"></div>
    ${milestone('Whole month', T, 'every bill this month')}
    <button class="btn block" data-act="log-xfer" data-id="bills">+ Log a transfer to the bills account</button>
    <h2>Due on the 1st · ${money(tot(first))}</h2><div class="card">${first.map(billRow).join('') || '<div class="empty">Nothing due on the 1st.</div>'}</div>
    ${later.length ? `<h2>Later in the month · ${money(tot(later))}</h2><div class="card">${later.map(billRow).join('')}</div>` : ''}
    <p class="note">Bills pay themselves, so there's nothing to check off. Change amounts and due days in Settings.</p>
    ${cardSection(cp)}`;
}

function cardSection(cp) {
  const s = S(), o = cp.options, now = new Date();
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let plan = '';
  if (cp.balance > 0) {
    plan = `<div class="plan"><div class="week"><span class="muted">To clear it by ${eom}</span><b>${money(cp.perWeek)} / week</b></div>
      <div class="note" style="margin:0 0 10px">${cp.weeks} paycheck${cp.weeks > 1 ? 's' : ''} left this month${cp.extra > 0 ? ` · your leftover extra (${money(cp.extra)}/wk) covers part of it` : ''}.</div>`;
    if (cp.need <= 0) plan += `<div class="opt good">✅ No cuts needed — your leftover covers it.</div>`;
    else {
      plan += `<div class="note" style="margin:0 0 8px">You'd still need <b>${money(cp.need)}</b> more per week. Pick a way:</div>
        <div class="opt"><b>Spend less</b><span>Everyday ${money(o.spend.newSpend)}/wk <em>(−${money(o.spend.cut)})</em>${o.spend.short > 0 ? `<br><i>still ${money(o.spend.short)}/wk short</i>` : ''}</span></div>
        <div class="opt"><b>Save less</b><span>Savings ${money(o.save.newSave)}/wk <em>(−${money(o.save.cut)})</em>${o.save.short > 0 ? `<br><i>still ${money(o.save.short)}/wk short</i>` : ''}</span></div>
        <div class="opt"><b>Split it</b><span>Everyday ${money(o.split.newSpend)} + savings ${money(o.split.newSave)} /wk${o.split.short > 0 ? `<br><i>still ${money(o.split.short)}/wk short</i>` : ''}</span></div>
        <div class="opt alt"><b>Or take 2 months</b><span>${money(cp.stretch.perWeek)}/wk over ${cp.stretch.weeks} weeks</span></div>`;
    }
    plan += '</div>';
  }
  return `<h2>Credit card</h2><div class="card">
    <div class="field"><label>Current balance<br><span class="muted" style="font-size:.8rem">Type your balance, then log payments below</span></label>
      <input type="number" inputmode="decimal" value="${cp.balance || ''}" placeholder="0" data-cc="balance"></div>
    ${plan}
    <button class="btn block" data-act="log-xfer" data-id="card">+ Log a card payment</button></div>`;
}

function planTab() {
  const s = S(), wp = weekPlan(s, store.txs);
  const st = wp.standard, rc = wp.rec;
  const row = (label, a, b, cls = '') => `<div class="trow ${cls}"><span>${label}</span><span class="b">${money(a)}</span><span class="n">${money(b)}</span></div>`;
  const notes = [];
  if (wp.usedRecent) notes.push(`<b>Paycheck</b> uses your recent average of ${money(wp.recentPay)} (not the ${money(st.pay)} standard).`);
  if (wp.isCurrent && wp.billsLeft > 0) notes.push(`<b>Bills</b> is ${money(rc.bills)} to catch up the ${money(wp.billsLeft)} still owed this month.`);
  if (wp.cardBalance > 0) notes.push(`<b>Extra</b> goes to clearing the ${money(wp.cardBalance)} card balance by month end.`);

  return `${header('Plan', false)}
    <p class="lead"><b>Standard week</b> is your plan from Settings. <b>Recommended</b> adjusts it for what's actually happening — your recent pay, bills still owed, and the credit card.</p>
    <div class="card plan-table">
      <div class="trow head"><span></span><span class="b">Standard week</span><span class="n">Recommended</span></div>
      ${row('Paycheck', st.pay, rc.pay)}
      ${row('To bills account', st.bills, rc.bills)}
      ${row('Groceries', st.groceries, rc.groceries)}
      ${row('Everyday spending', st.everyday, rc.everyday)}
      ${row('Savings', st.savings, rc.savings)}
      ${row('Extra / credit card', st.extra, rc.extra)}
      <div class="trow ${rc.leftover < 0 ? 'neg' : 'total'}"><span>Leftover</span><span class="b">${money(0)}</span><span class="n">${money(rc.leftover)}</span></div>
    </div>
    ${rc.leftover < 0
      ? `<div class="callout bad">You're <b>${money(-rc.leftover)}</b> short this week. Trim everyday spending or savings, or stretch the card payoff — see the Bills tab.</div>`
      : `<div class="callout good">You've got <b>${money(rc.leftover)}</b> to spare this week beyond the plan.</div>`}
    ${notes.length ? `<ul class="why">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : '<p class="note">Right now the recommended week matches your standard week.</p>'}`;
}

function activityList() {
  let list = (ui.all ? [...store.txs] : monthTxs()).sort(sortTx);
  if (ui.filter === 'income') list = list.filter((t) => t.type === 'income');
  else if (ui.filter === 'transfer') list = list.filter((t) => t.type === 'transfer');
  else if (ui.filter !== 'all') list = list.filter((t) => t.type === 'expense' && t.category === ui.filter);
  const q = ui.q.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.note + ' ' + (cat(t.category)?.name || t.category)).toLowerCase().includes(q) || String(t.amount).includes(q));
  const spent = round(list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0));
  if (!list.length) return '<div class="card empty">Nothing here.</div>';
  let html = '', last = '';
  for (const t of list) {
    if (t.date !== last) { if (last) html += '</div>'; html += `<div class="day">${dayLabel(t.date)}</div><div class="card" style="padding:6px 18px">`; last = t.date; }
    html += txRow(t);
  }
  return `<p class="note">${list.length} line item${list.length > 1 ? 's' : ''} · ${money(spent)} spent · tap any to edit</p>${html}</div>`;
}

function activity() {
  const chips = [['all', 'All'], ...S().categories.map((c) => [c.id, c.emoji + ' ' + c.name]), ['income', '💰 Income'], ['transfer', '🔁 Transfers']]
    .map(([id, l]) => `<button class="chip ${ui.filter === id ? 'on' : ''}" data-act="filter" data-id="${esc(id)}">${esc(l)}</button>`).join('');
  return `${header('Activity', !ui.all)}
    <div class="searchrow"><input id="q" class="sheet-input" type="search" placeholder="Search purchases…" value="${esc(ui.q)}" autocomplete="off">
    <button class="chip ${ui.all ? 'on' : ''}" data-act="all">Whole history</button></div>
    <div class="chips">${chips}</div><div id="actlist">${activityList()}</div>`;
}

function settings() {
  const s = S(), sw = standardWeek(s);
  const poolBase = round(s.weeklyPay - sw.bills - sw.groceries - s.weeklyBudget);
  const syncText = { local: 'Saved on this device only', connecting: 'Connecting…', synced: 'Synced to the cloud ✓', error: 'Not syncing' }[store.sync];
  return `${header('Settings', false)}
    <h2>Weekly plan</h2><div class="card planner">
      <div class="field"><label>Weekly pay<br><span class="muted" style="font-size:.8rem">= ${money(monthlyIncome(s))} a month</span></label><input type="number" inputmode="decimal" value="${s.weeklyPay}" data-set="weeklyPay"></div>
      <div class="prow"><span>− Bills account <span class="muted">(total ÷ 4)</span></span><b>${money(sw.bills)}</b></div>
      <div class="prow"><span>− Groceries <span class="muted">(budget ÷ 4)</span></span><b>${money(sw.groceries)}</b></div>
      <div class="field"><label>− Everyday spending</label><input type="number" inputmode="decimal" value="${s.weeklyBudget}" data-set="weeklyBudget"></div>
      <div class="prow total"><span>Leftover to divide</span><b id="pool" class="${poolBase < 0 ? 'negtext' : ''}">${money(poolBase)}</b></div>
      <div class="splitrow"><div class="splitlabel"><span>🐷 Savings</span><b id="sav-amt">${money(sw.savings)}</b></div>
        <input type="range" id="sav-slider" min="0" max="${Math.max(5, Math.ceil(poolBase))}" step="5" value="${sw.savings}"></div>
      <div class="prow"><span>💳 Extra spending <span class="muted">(auto)</span></span><b id="extra-amt" class="${sw.extra < 0 ? 'negtext' : ''}">${money(sw.extra)}</b></div>
      ${poolBase < 0 ? `<div class="err">Your pay doesn't cover bills + groceries + everyday spending — nothing left to save.</div>` : ''}
      <div class="note">Drag to move money between savings and extra spending. This sets the “standard week” on the Plan tab.</div></div>
    <h2>Category budgets (monthly)</h2><div class="card">${s.categories.map((c, i) => `
      <div class="field weekly"><span class="emoji" style="width:36px;height:36px">${c.emoji}</span><label>${esc(c.name)}</label>
        <input type="number" inputmode="decimal" value="${c.budget}" data-cat="${i}" data-field="budget">
        <button class="x" data-act="delcat" data-i="${i}" aria-label="Delete">✕</button>
        <label class="muted" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.weekly ? 'checked' : ''} data-cat="${i}" data-field="weekly"> counts toward weekly everyday budget</label></div>`).join('')}
      <button class="btn block" data-act="addcat">+ Add category</button></div>
    <h2>Bills &amp; due days</h2><div class="card">
      <div class="field bill-head"><span style="flex:1">Bill</span><span style="width:84px;text-align:right">Amount</span><span style="width:52px;text-align:center">Day</span><span style="width:32px"></span></div>
      ${s.bills.map((b, i) => `
      <div class="field"><input class="name" type="text" value="${esc(b.name)}" data-bill="${i}" data-field="name">
        <input type="number" inputmode="decimal" value="${b.amount}" data-bill="${i}" data-field="amount" style="width:84px">
        <input type="number" inputmode="numeric" min="1" max="31" value="${b.day}" data-bill="${i}" data-field="day" style="width:52px;text-align:center">
        <button class="x" data-act="delbill" data-i="${i}" aria-label="Delete">✕</button></div>`).join('')}
      <button class="btn block" data-act="addbill">+ Add bill</button>
      <div class="note">Day = the day of the month the bill auto-pays. Bills on day 1 make up your “ready for the 1st” goal (${money(firstTotal(s))}). Total: ${money(billsTotal(s))}.</div></div>
    <h2>Sync &amp; data</h2><div class="card"><div class="field"><label>${syncText}</label></div>
      ${store.syncError ? `<div class="err">${esc(store.syncError)}</div>` : ''}
      <button class="btn block" data-act="reimport">Re-import spreadsheet history</button></div>
    <p class="note">Everything saves automatically.</p>`;
}

// ---------- the sheet (add flow + edit) ----------
let flow = null, edit = null;
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; flow = null; edit = null; }

// ----- add a purchase (step-by-step) -----
function openFlow(preset = {}) {
  flow = { step: 1, type: 'expense', amt: '', category: null, note: '', date: today(), ...preset };
  drawFlow(); $('#sheet').hidden = false;
}
const flowSteps = (f) => (f.type === 'income' || f.preset ? 2 : 3);

function drawFlow() {
  const f = flow, el = $('#sheet');
  const amtNum = parseFloat(f.amt) || 0;
  const stepNo = f.step === 3 && flowSteps(f) === 2 ? 2 : f.step;
  let body = '';
  if (f.step === 1) {
    const seg = f.preset ? '' : `<div class="seg">${[['expense', 'Purchase'], ['income', 'Income'], ['transfer', 'Transfer']].map(([v, l]) => `<button data-flow="type" data-v="${v}" class="${f.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const title = f.preset ? (f.category === 'card' ? 'Card payment — how much?' : 'Move how much to bills?') : 'How much?';
    body = `<div class="q">${title}</div>${seg}
      <div class="amount ${amtNum ? '' : 'zero'}">$${esc(f.amt || '0')}</div>
      <div class="pad">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => `<button data-flow="key" data-v="${k}">${k}</button>`).join('')}</div>
      <button class="btn primary block" data-flow="next" ${amtNum ? '' : 'disabled style="opacity:.4"'}>Continue</button>`;
  } else if (f.step === 2) {
    const items = f.type === 'transfer' ? TRANSFERS : S().categories;
    body = `<div class="q">${f.type === 'transfer' ? 'Where did it go?' : 'What was it for?'}</div><div class="cats">${items.map((c) => `<button data-flow="cat" data-v="${esc(c.id)}"><span class="e">${c.emoji}</span>${esc(c.name)}</button>`).join('')}</div>`;
  } else {
    const label = f.type === 'income' ? 'Income' : f.type === 'transfer' ? 'To ' + tfer(f.category).name.toLowerCase() : cat(f.category).name;
    const icon = f.type === 'income' ? '💰' : f.type === 'transfer' ? tfer(f.category).emoji : cat(f.category).emoji;
    body = `<div class="q">Any details?</div>
      <div class="summary"><div class="emoji" style="background:var(--card)">${icon}</div><div><b>${money(amtNum)}</b><div class="muted">${esc(label)}</div></div></div>
      <input class="sheet-input" id="f-note" type="text" placeholder="${f.type === 'income' ? 'Paycheck, refund…' : f.type === 'transfer' ? 'Note' : 'Wingstop, groceries…'} (optional)" value="${esc(f.note)}" autocomplete="off">
      <input class="sheet-input" id="f-date" type="date" value="${f.date}" max="${today()}">
      <button class="btn primary block" data-flow="save">Save</button>`;
  }
  el.innerHTML = `<div class="panel"><div class="head">
    ${f.step > 1 ? '<button data-flow="back" aria-label="Back">←</button>' : '<span style="width:40px"></span>'}
    <span class="step">Step ${stepNo} of ${flowSteps(f)}</span><button data-flow="close" aria-label="Close">✕</button></div>${body}</div>`;
  if (f.step === 3) setTimeout(() => $('#f-note')?.focus(), 50);
}

function flowClick(btn) {
  const f = flow, v = btn.dataset.v;
  switch (btn.dataset.flow) {
    case 'close': return closeSheet();
    case 'type': f.type = v; f.category = null; return drawFlow();
    case 'key':
      if (v === '⌫') f.amt = f.amt.slice(0, -1);
      else if (v === '.') { if (!f.amt.includes('.')) f.amt = (f.amt || '0') + '.'; }
      else if (!(f.amt.includes('.') && f.amt.split('.')[1].length >= 2) && f.amt.replace('.', '').length < 8) f.amt = f.amt === '0' ? v : f.amt + v;
      return drawFlow();
    case 'next': if (parseFloat(f.amt) > 0) { f.step = f.type === 'income' ? 3 : f.preset ? 3 : 2; if (f.type === 'income') f.category = 'income'; drawFlow(); } return;
    case 'cat': f.category = v; f.step = 3; return drawFlow();
    case 'back': f.step = f.step === 3 && flowSteps(f) === 2 ? 1 : f.step - 1; return drawFlow();
    case 'save': {
      const note = $('#f-note').value.trim(), date = $('#f-date').value || today();
      const tx = { type: f.type, amount: round(parseFloat(f.amt)), category: f.type === 'income' ? 'income' : f.category, note, date };
      addTx(tx);
      ui.month = date.slice(0, 7);
      if (ui.tab === 'settings') ui.tab = 'home';
      closeSheet(); render(); toast(savedMsg(tx));
    }
  }
}

function savedMsg(tx) {
  const ms = MS();
  if (tx.type === 'income') return `Added ${money(tx.amount)} income`;
  if (tx.type === 'transfer') return tx.category === 'bills' ? `Moved ${money(tx.amount)} to bills · ${ms.billsLeft ? money(ms.billsLeft) + ' still needed' : 'fully funded ✓'}`
    : tx.category === 'card' ? `Paid ${money(tx.amount)} on the card · ${money(cardBalance(S(), store.txs))} left` : `Saved ${money(tx.amount)}`;
  const c = cat(tx.category); let msg = `Logged ${money(tx.amount)} · ${c?.name || tx.category}`;
  if (c && c.budget > 0) { const left = round(c.budget - ms.byCat[c.id]); msg += left >= 0 ? ` · ${money(left)} left` : ` · ${money(-left)} over`; }
  return msg;
}

// ----- edit an existing item (single form) -----
function openEdit(tx) {
  edit = { ...tx };
  drawEdit(); $('#sheet').hidden = false;
}
function syncEditInputs() {
  const a = $('#e-amt'), n = $('#e-note'), d = $('#e-date');
  if (a) edit.amount = parseFloat(a.value) || 0;
  if (n) edit.note = n.value;
  if (d) edit.date = d.value || edit.date;
}
function drawEdit() {
  const e = edit, el = $('#sheet');
  const items = e.type === 'transfer' ? TRANSFERS : S().categories;
  const picker = e.type === 'income' ? '' : `<label class="editlbl">${e.type === 'transfer' ? 'Destination' : 'Category'}</label>
    <div class="cats edit">${items.map((c) => `<button data-edit="cat" data-v="${esc(c.id)}" class="${e.category === c.id ? 'on' : ''}"><span class="e">${c.emoji}</span>${esc(c.name)}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Edit item</span><button data-edit="close" aria-label="Close">✕</button></div>
    <div class="seg">${[['expense', 'Purchase'], ['income', 'Income'], ['transfer', 'Transfer']].map(([v, l]) => `<button data-edit="type" data-v="${v}" class="${e.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="editlbl">Amount</label>
    <input class="sheet-input" id="e-amt" type="number" inputmode="decimal" value="${e.amount}">
    ${picker}
    <label class="editlbl">Note</label>
    <input class="sheet-input" id="e-note" type="text" value="${esc(e.note || '')}" placeholder="Note" autocomplete="off">
    <label class="editlbl">Date</label>
    <input class="sheet-input" id="e-date" type="date" value="${e.date}" max="${today()}">
    <button class="btn primary block" data-edit="save">Save changes</button>
    <button class="btn danger block" data-edit="delete">Delete</button></div>`;
}
function editClick(btn) {
  const e = edit, v = btn.dataset.v;
  switch (btn.dataset.edit) {
    case 'close': return closeSheet();
    case 'type': syncEditInputs(); e.type = v; e.category = v === 'income' ? 'income' : v === 'transfer' ? 'bills' : (cat(e.category) ? e.category : S().categories[0].id); return drawEdit();
    case 'cat': syncEditInputs(); e.category = v; return drawEdit();
    case 'save': {
      syncEditInputs();
      if (!(e.amount > 0)) return toast('Enter an amount');
      const patch = { type: e.type, amount: round(e.amount), category: e.type === 'income' ? 'income' : e.category, note: (e.note || '').trim(), date: e.date };
      updateTx(e.id, patch);
      ui.month = e.date.slice(0, 7);
      closeSheet(); render(); toast('Changes saved');
      return;
    }
    case 'delete': {
      if (confirm(`Delete "${e.note || cat(e.category)?.name || tfer(e.category)?.name || 'this item'}" (${money(e.amount)})?`)) { deleteTx(e.id); closeSheet(); render(); toast('Deleted'); }
      return;
    }
  }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- live savings slider (no full re-render while dragging) ----------
function slideSavings(val) {
  const s = S(), sw = standardWeek(s);
  const poolBase = round(s.weeklyPay - sw.bills - sw.groceries - s.weeklyBudget);
  const sav = Math.max(0, Math.min(val, Math.max(0, poolBase)));
  s.weeklySavings = sav;
  const ex = round(poolBase - sav);
  if ($('#sav-amt')) $('#sav-amt').textContent = money(sav);
  const exEl = $('#extra-amt');
  if (exEl) { exEl.textContent = money(ex); exEl.classList.toggle('negtext', ex < 0); }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const fe = e.target.closest('[data-edit]'); if (fe && edit) return editClick(fe);
  const fl = e.target.closest('[data-flow]'); if (fl && flow) return flowClick(fl);
  if (e.target === $('#sheet')) return closeSheet();
  const tab = e.target.closest('#tabs button');
  if (tab) { ui.tab = tab.dataset.tab; scrollTo(0, 0); return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'log': return openFlow();
    case 'log-xfer': return openFlow({ type: 'transfer', category: id, preset: true });
    case 'prev': case 'next': { const d = parseYmd(ui.month + '-01'); d.setMonth(d.getMonth() + (b.dataset.act === 'next' ? 1 : -1)); ui.month = monthKey(d); return render(); }
    case 'filter': ui.filter = id; return render();
    case 'all': ui.all = !ui.all; return render();
    case 'tx': { const t = store.txs.find((x) => x.id === id); if (t) openEdit(t); return; }
    case 'addcat': { const name = prompt('Category name?'); if (name?.trim()) { S().categories.push({ id: uid(), name: name.trim(), emoji: '🏷️', budget: 0, weekly: false }); saveSettings(); } return; }
    case 'delcat': if (confirm(`Delete "${S().categories[i].name}"? Existing transactions are kept.`)) { S().categories.splice(i, 1); saveSettings(); } return;
    case 'addbill': { const name = prompt('Bill name?'); if (name?.trim()) { S().bills.push({ id: uid(), name: name.trim(), amount: 0, day: 1 }); saveSettings(); } return; }
    case 'delbill': if (confirm(`Delete "${S().bills[i].name}"?`)) { S().bills.splice(i, 1); saveSettings(); } return;
    case 'reimport': { const n = reimportHistory(); toast(n ? `Restored ${n} line items` : 'Everything is already imported'); return; }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#actlist').innerHTML = activityList(); }
  else if (e.target.id === 'sav-slider') slideSavings(+e.target.value);
});

document.addEventListener('change', (e) => {
  const t = e.target, num = () => parseFloat(t.value) || 0;
  if (t.id === 'sav-slider') { slideSavings(+t.value); saveSettings(); return; }
  if (t.dataset.set) { S()[t.dataset.set] = num(); saveSettings(); }
  else if (t.dataset.cc) { S().cc = { balance: num(), asOf: today() }; saveSettings(); }
  else if (t.dataset.cat) { const c = S().categories[+t.dataset.cat]; c[t.dataset.field] = t.type === 'checkbox' ? t.checked : num(); saveSettings(); }
  else if (t.dataset.bill) {
    const b = S().bills[+t.dataset.bill], f = t.dataset.field;
    b[f] = f === 'name' ? t.value : f === 'day' ? Math.min(31, Math.max(1, Math.round(num()) || 1)) : num(); saveSettings();
  } else return;
  render();
});

loadLocal();
render();
initFirebase();
