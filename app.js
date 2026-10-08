import { store, loadLocal, saveSettings, addTx, updateTx, deleteTx, uid, initFirebase, reimportHistory } from './store.js?v=28';
import { TRANSFERS } from './defaults.js?v=28';
import { round, ymd, parseYmd, addDays, weekStart, monthStats, weekStats, standardWeek, billsTotal, firstTotal, billAmount, categoryAvg, categoryBudget, cardBalance, cardDetail, cycleWindow, rollCardBaseline, cardPlan, weekPlan, monthlyIncome, trends } from './calc.js?v=28';

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

const ui = { tab: 'home', month: monthKey(new Date()), filter: 'all', all: false, q: '', planDraft: null };

// ---------- helpers ----------
const S = () => store.settings;
const cat = (id) => S().categories.find((c) => c.id === id);
const cb = (c) => categoryBudget(S(), store.txs, c);   // effective category budget (avg for gas when on)
const tfer = (id) => TRANSFERS.find((t) => t.id === id);
const sortTx = (a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1);
const monthTxs = () => store.txs.filter((t) => t.date.startsWith(ui.month)).sort(sortTx);
const MS = () => monthStats(S(), store.txs, ui.month);
const barClass = (spent, budget) => (spent > budget ? 'over' : spent > budget * 0.85 ? 'warn' : '');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

// ---------- rendering ----------
let pendingPromptShown = false;
function maybePendingPrompt() {
  if (pendingPromptShown || !(S().pending || []).length || !$('#sheet').hidden) return;
  pendingPromptShown = true;
  openPending();
}
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
  const pend = s.pending || [];
  const ws = weekStats(s, store.txs);
  const bal = cardBalance(s, store.txs);
  const weekly = ms.isCurrent && s.weeklyBudget > 0;

  let hero;
  if (weekly) {
    const stat3 = bal > 0
      ? `<div><b>${money(bal)}</b><span>Card balance</span></div>`
      : `<div><b>${money(s.weeklySavings)}</b><span>Weekly savings</span></div>`;
    hero = `<button class="card hero tappable" data-act="week">
      <div class="label">Left to spend this week <span class="hint">tap for breakdown ›</span></div>
      <div class="big ${ws.left < 0 ? 'neg' : ''}">${money(ws.left)}</div>
      <div class="bar ${barClass(ws.spent, ws.budget)}"><i style="width:${pct(ws.spent, ws.budget)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(ws.spent)} of ${money(ws.budget)}${ws.carryover < 0 ? ` <span class="negtext">(incl. ${money(ws.carryover)} rolled over)</span>` : ''} · ${ws.ids.map((i) => esc(cat(i)?.name)).join(', ')}</div>
      <div class="stats">
        <div><b>${money(ws.spent)}</b><span>Spent this week</span></div>
        <div><b>${money(ms.billsLeft)}</b><span>Still to bills</span></div>
        ${stat3}
      </div></button>`;
  } else {
    const n = ms.list.filter((t) => t.type === 'expense').length;
    hero = `<div class="card hero">
      <div class="label">Spent in ${monthShort(ui.month)}</div>
      <div class="big">${money(ms.spent)}</div>
      <div class="note" style="margin:8px 0 0">${n} purchase${n === 1 ? '' : 's'}${ms.income ? ` · ${money(ms.income)} income` : ''}</div></div>`;
  }
  const cardTrim = weekly && ws.trimmedByCard > 0
    ? `<div class="rollover info">Everyday budget is ${money(ws.baseBudget)} this week — trimmed ${money(ws.trimmedByCard)} to pay off your card. <button class="link" data-act="goto" data-id="bills">Change strategy</button></div>`
    : '';
  const rollover = weekly && ws.carryover < 0
    ? `<div class="rollover">You went ${money(-ws.carryover)} over last week, so this week is trimmed to ${money(ws.budget)}. <button class="link" data-act="week-reset">Reset to ${money(ws.baseBudget)}</button></div>`
    : '';

  const estIncome = monthlyIncome(s);
  const moneyRow = (emoji, name, spent, total, act, id, hasBudget) => {
    const inner = hasBudget
      ? `<div class="row"><span class="n">${esc(name)}</span><span class="a">${money(spent)} / ${money(total)}</span></div>
         <div class="bar ${act === 'goto' || name === 'Income' ? '' : barClass(spent, total)}"><i style="width:${pct(spent, total)}%"></i></div>`
      : `<div class="row"><span class="n">${esc(name)}</span><span class="a">${money(spent)} spent</span></div>`;
    return `<button class="cat" data-act="${act}" data-id="${esc(id)}"><div class="emoji">${emoji}</div><div class="body">${inner}</div><span class="chev">›</span></button>`;
  };
  const list = [
    moneyRow('💰', 'Income', ms.income, estIncome, 'cat-filter', 'income', true),
    ...s.categories.map((c) => { const bud = cb(c); return moneyRow(c.emoji, c.name, ms.byCat[c.id], bud, 'cat-filter', c.id, bud > 0); }),
    moneyRow('🏦', 'Bills account', ms.billsIn, ms.billsTotal, 'goto', 'bills', true)
  ].join('');
  const recent = monthTxs().slice(0, 5);

  return `${header('Budget')}
    ${hero}
    ${cardTrim}
    ${rollover}
    <button class="log-btn" data-act="log"><span class="plus">+</span> Log a purchase</button>
    <h2>This month</h2><div class="card">${list}</div>
    <h2>Recent</h2><div class="card">${recent.length ? recent.map(txRow).join('') : '<div class="empty">Nothing logged yet this month.<br>Tap the big button to add your first purchase.</div>'}</div>
    <div class="twobtn" style="margin-top:16px">
      <button class="btn block" data-act="track-later">🕗 Track later</button>
      <button class="btn block ${pend.length ? 'primary' : ''}" data-act="finish-loose" ${pend.length ? '' : 'disabled'}>✓ Finish loose logs${pend.length ? ` (${pend.length})` : ''}</button>
    </div>`;
}

function txRow(t) {
  let icon, label, sub, amt;
  if (t.type === 'income') { icon = '💰'; label = t.note || 'Paycheck'; sub = 'Income'; amt = `<div class="amt in">+${money(t.amount)}</div>`; }
  else if (t.type === 'transfer') { const x = tfer(t.category); icon = x?.emoji || '🔁'; label = t.note || 'Transfer'; sub = 'To ' + (x?.name || t.category).toLowerCase(); amt = `<div class="amt xfer">${money(t.amount)}</div>`; }
  else { const c = cat(t.category); icon = c ? c.emoji : '🧾'; label = t.note || (c ? c.name : 'Purchase'); sub = c ? c.name : t.category; amt = `<div class="amt">${money(t.amount)}</div>`; }
  const ccDot = (t.type === 'expense' && t.pay === 'credit' ? ' <span class="cc-dot" title="Credit card">💳</span>' : '') + (t.exAvg ? ' <span class="ex-tag" title="Excluded from average">excl. avg</span>' : '');
  return `<button class="tx" data-act="tx" data-id="${esc(t.id)}"><div class="emoji">${icon}</div>
    <div class="body"><div class="t">${esc(label)}${ccDot}</div><div class="s">${esc(sub)} · ${parseYmd(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></div>${amt}<span class="chev">›</span></button>`;
}

function bills() {
  const s = S(), ms = MS(), cp = cardPlan(s, store.txs);
  const T = ms.billsTotal, F = ms.billsIn;
  const byDay = [...s.bills].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  const first = byDay.filter((x) => x.day === 1), later = byDay.filter((x) => x.day !== 1);
  const tot = (l) => round(l.reduce((a, x) => a + billAmount(x), 0));
  const wk = ms.isCurrent && ms.billsLeft > 0 ? round(ms.billsLeft / ms.weeksLeft) : 0;
  const billRow = (x) => `<div class="bill"><div class="d-badge">${x.day}</div><div class="body"><div class="n">${esc(x.name)}</div><div class="d">Auto-pays the ${ordinal(x.day)}${x.useAvg && x.history && x.history.length ? ' · 12-mo avg' : ''}</div></div><div class="amt">${money(billAmount(x))}</div></div>`;

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
  const strat = s.cc.strategy || 'extra';
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let plan = '';
  if (cp.balance > 0) {
    const shortNote = (sh) => (sh > 0 ? ` <span class="negtext">still ${money(sh)}/wk short</span>` : '');
    const opt = (id, title, desc) => `<button class="strat ${strat === id ? 'on' : ''}" data-act="cc-strategy" data-id="${id}">
      <span class="radio"></span><span class="st-body"><b>${title}</b><span>${desc}</span></span></button>`;
    plan = `<div class="plan">
      <div class="week"><span class="muted">${strat === 'stretch' ? 'Paid off in about 2 months' : `To clear it by ${eom}`}</span><b>${money(strat === 'stretch' ? cp.stretch.perWeek : cp.perWeek)} / week</b></div>
      <div class="note" style="margin:0 0 10px">${cp.weeks} paycheck${cp.weeks > 1 ? 's' : ''} left this month · your ${money(cp.extra)}/wk leftover covers ${cp.need <= 0 ? 'all of it' : `part of it (${money(cp.need)}/wk short)`}.</div>
      <div class="pickhdr">Choose how to pay it off:</div>
      ${opt('extra', 'Use my leftover only', cp.need <= 0 ? `Your ${money(cp.extra)}/wk covers it — no cuts.` : `Put ${money(cp.extra)}/wk toward it;${shortNote(cp.need)}`)}
      ${opt('spend', 'Spend less', `Everyday → ${money(o.spend.newSpend)}/wk (−${money(o.spend.cut)})${shortNote(o.spend.short)}`)}
      ${opt('save', 'Save less', `Savings → ${money(o.save.newSave)}/wk (−${money(o.save.cut)})${shortNote(o.save.short)}`)}
      ${opt('split', 'Split spending & savings', `Everyday ${money(o.split.newSpend)} + savings ${money(o.split.newSave)}/wk${shortNote(o.split.short)}`)}
      ${opt('stretch', 'Take 2 months', `${money(cp.stretch.perWeek)}/wk over ${cp.stretch.weeks} weeks — easiest, slower`)}
      <div class="note" style="margin:8px 0 0">Your pick shows as the <b>Recommended</b> column on the Plan tab.</div></div>`;
  }
  const cc = s.cc, auto = cc.mode !== 'manual';
  const det = cardDetail(s, store.txs);
  const cyc = cycleWindow(now);
  const diff = round((cc.manual || 0) - det.computed);
  const modeToggle = `<div class="seg">
    <button data-act="cc-mode" data-id="auto" class="${auto ? 'on' : ''}">Auto-track</button>
    <button data-act="cc-mode" data-id="manual" class="${!auto ? 'on' : ''}">Manual</button></div>`;

  let setup;
  if (auto) {
    setup = `
      <div class="field"><label>Starting balance<br><span class="muted" style="font-size:.8rem">${det.asOf ? 'as of ' + shortDate(parseYmd(det.asOf)) : 'set this to start tracking'}</span></label>
        <input type="number" inputmode="decimal" value="${cc.start || ''}" placeholder="0" data-cc="start"></div>
      <div class="ccbreak">
        <div><span>Starting balance</span><b>${money(det.start)}</b></div>
        <div><span>+ purchases since${det.adj ? ' <small>(adjusted)</small>' : ''}</span>
          <span class="ccedit">${det.adj ? '<button class="link" data-act="cc-charges-reset" title="Back to tracked">↺</button>' : ''}<input class="ccinput" type="number" inputmode="decimal" value="${det.credit}" data-cc="charges"></span></div>
        <div><span>− card payments since</span><b>${money(det.paid)}</b></div>
        <div class="tot"><span>Current balance</span><b>${money(det.computed)}</b></div></div>`;
  } else {
    setup = `
      <div class="field"><label>Your current balance</label><input type="number" inputmode="decimal" value="${cc.manual || ''}" placeholder="0" data-cc="manual"></div>
      <div class="ccbreak"><div class="tot"><span>App estimate</span><b>${money(det.computed)}</b></div>
        <div><span>Difference</span><b class="${diff ? 'negtext' : ''}">${diff === 0 ? 'matches' : (diff > 0 ? '+' : '−') + money(Math.abs(diff)).replace('-', '')}</b></div></div>`;
  }

  return `<h2>Credit card</h2><div class="card">
    ${modeToggle}
    ${setup}
    <div class="note">Statement closes the ${ordinal(cyc.endDay)} · this cycle ${shortDate(parseYmd(cyc.start))} – ${shortDate(parseYmd(cyc.end))}. New purchases default to credit card when you log them.</div>
    ${plan}
    <button class="btn block" data-act="log-xfer" data-id="card">+ Log a card payment</button></div>`;
}

// Merge the (ephemeral) what-if draft over the computed recommendation.
function planValues() {
  const wp = weekPlan(S(), store.txs);
  const rc = wp.rec, d = ui.planDraft || {};
  const v = (f) => (d[f] !== undefined ? d[f] : rc[f]);
  const pay = v('pay'), bills = v('bills'), groceries = v('groceries'), everyday = v('everyday'), savings = v('savings');
  const hasCard = wp.cardBalance > 0;
  const extra = hasCard ? v('extra') : round(pay - bills - groceries - everyday - savings);
  const leftover = hasCard ? round(pay - bills - groceries - everyday - savings - extra) : 0;
  return { wp, hasCard, pay, bills, groceries, everyday, savings, extra, leftover };
}

function calloutHTML(leftover) {
  return leftover < 0
    ? `You're <b>${money(-leftover)}</b> short this week. Trim everyday spending or savings, or stretch the card payoff on the Bills tab.`
    : `You've got <b>${money(leftover)}</b> to spare this week beyond the plan.`;
}

// Live update of the derived cells while the user edits — no save, no full re-render.
function planRecalc() {
  const p = planValues();
  const ex = $('#plan-extra'); if (ex) ex.textContent = money(p.extra);
  const lo = $('#plan-leftover'); if (lo) lo.textContent = money(p.leftover);
  const loRow = $('#plan-leftover-row'); if (loRow) { loRow.classList.toggle('neg', p.leftover < 0); loRow.classList.toggle('total', p.leftover >= 0); }
  const co = $('#plan-callout'); if (co) { co.className = 'callout ' + (p.leftover < 0 ? 'bad' : 'good'); co.innerHTML = calloutHTML(p.leftover); }
  const rb = $('#plan-reset-btn'); if (rb) rb.hidden = false;
}

function planTab() {
  const s = S(), p = planValues(), wp = p.wp, st = wp.standard;
  const stratName = { extra: 'use your leftover', spend: 'spend less', save: 'save less', split: 'split spending & savings', stretch: 'take 2 months' }[wp.strategy];
  const edited = ui.planDraft && Object.keys(ui.planDraft).length;
  // editable recommended cell
  const erow = (label, field, val) => `<div class="trow"><span>${label}</span><span class="b">${money(st[field])}</span><span class="n"><input class="plancell" data-plan="${field}" type="number" inputmode="decimal" value="${val}"></span></div>`;

  const extraRow = p.hasCard
    ? erow('Extra / credit card', 'extra', p.extra)
    : `<div class="trow"><span>Extra / credit card</span><span class="b">${money(st.extra)}</span><span class="n" id="plan-extra">${money(p.extra)}</span></div>`;

  return `${header('Plan', false)}
    <p class="lead"><b>Standard week</b> is your plan from Settings. <b>Recommended</b> keeps your pay the same, catches up bills still owed, and pays the card off your way${wp.cardBalance > 0 ? ` (${stratName})` : ''}. Tap any Recommended number to try a what-if — it resets when you leave this tab.</p>
    <div class="card plan-table">
      <div class="trow head"><span></span><span class="b">Standard week</span><span class="n">Recommended</span></div>
      ${erow('Paycheck', 'pay', p.pay)}
      ${erow('To bills account', 'bills', p.bills)}
      ${erow('Groceries', 'groceries', p.groceries)}
      ${erow('Everyday spending', 'everyday', p.everyday)}
      ${erow('Savings', 'savings', p.savings)}
      ${extraRow}
      <div class="trow ${p.leftover < 0 ? 'neg' : 'total'}" id="plan-leftover-row"><span>Leftover</span><span class="b">${money(0)}</span><span class="n" id="plan-leftover">${money(p.leftover)}</span></div>
    </div>
    <div class="callout ${p.leftover < 0 ? 'bad' : 'good'}" id="plan-callout">${calloutHTML(p.leftover)}</div>
    <button class="btn block" id="plan-reset-btn" data-act="plan-reset" ${edited ? '' : 'hidden'}>↺ Reset to recommended</button>
    <p class="note">${p.hasCard ? `Extra / credit card is your ${stratName} payment (change the strategy on the Bills tab). Edits here are just what-ifs and never save.` : `Extra / credit card is spare money — edits here are just what-ifs and never save.`}</p>`;
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
    <button class="chip" data-act="trends">📈 Trends</button>
    <button class="chip ${ui.all ? 'on' : ''}" data-act="all">All</button></div>
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
    <h2>Week</h2><div class="card">
      <div class="field"><label>Week starts on<br><span class="muted" style="font-size:.8rem">When the weekly budget resets</span></label>
        <select data-set="weekStartDay">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${(+s.weekStartDay) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="note">Going over one week trims the next week's budget to compensate. You can reset it from the home screen any time.</div></div>
    <h2>Category budgets (monthly)</h2><div class="card">${s.categories.map((c, i) => {
      const avgRow = c.id === 'gas' ? `<label class="muted avgline" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.useAvg ? 'checked' : ''} data-catavg="${i}"> use 12-month average${c.useAvg ? ` (${money(categoryAvg(store.txs, c.id))}) <button class="link" data-act="catavg-view" data-id="${esc(c.id)}">see breakdown ›</button>` : ''}</label>` : '';
      return `<div class="field weekly"><span class="emoji" style="width:36px;height:36px">${c.emoji}</span><label>${esc(c.name)}</label>
        <input type="number" inputmode="decimal" value="${c.useAvg ? categoryAvg(store.txs, c.id) : c.budget}" ${c.useAvg ? 'disabled title="Using 12-month average"' : ''} data-cat="${i}" data-field="budget">
        <button class="x" data-act="delcat" data-i="${i}" aria-label="Delete">✕</button>
        <label class="muted" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.weekly ? 'checked' : ''} data-cat="${i}" data-field="weekly"> counts toward weekly everyday budget</label>
        ${avgRow}</div>`;
    }).join('')}
      <button class="btn block" data-act="addcat">+ Add category</button></div>
    <h2>Bills &amp; due days</h2><div class="card">
      <div class="field bill-head"><span style="flex:1">Bill</span><span style="width:84px;text-align:right">Amount</span><span style="width:46px;text-align:center">Day</span><span style="width:64px"></span></div>
      ${s.bills.map((b, i) => `
      <div class="field"><input class="name" type="text" value="${esc(b.name)}" data-bill="${i}" data-field="name">
        <input type="number" inputmode="decimal" value="${b.useAvg ? billAmount(b) : b.amount}" ${b.useAvg ? 'disabled title="Using 12-month average"' : ''} data-bill="${i}" data-field="amount" style="width:84px">
        <input type="number" inputmode="numeric" min="1" max="31" value="${b.day}" data-bill="${i}" data-field="day" style="width:46px;text-align:center">
        <button class="btn mini ${b.useAvg ? 'on' : ''}" data-act="billedit" data-i="${i}" aria-label="Edit history">📝</button>
        <button class="x" data-act="delbill" data-i="${i}" aria-label="Delete">✕</button></div>`).join('')}
      <button class="btn block" data-act="addbill">+ Add bill</button>
      <div class="note">Tap 📝 to log past months and use a 12-month average. Bills on day 1 make up your “ready for the 1st” goal (${money(firstTotal(s))}). Total: ${money(billsTotal(s))}.</div></div>
    <h2>Sync &amp; data</h2><div class="card"><div class="field"><label>${syncText}</label></div>
      ${store.syncError ? `<div class="err">${esc(store.syncError)}</div>` : ''}
      <button class="btn block" data-act="reimport">Re-import spreadsheet history</button></div>
    <p class="note">Everything saves automatically.</p>`;
}

// ---------- the sheet (add flow + edit) ----------
let flow = null, edit = null, billEdit = null, track = null;
function closeSheet() { const el = $('#sheet'); el.hidden = true; el.className = 'sheet'; el.innerHTML = ''; flow = null; edit = null; billEdit = null; track = null; }

// ----- "track later": capture a price only, to finish with category/description later -----
const keypad = () => `<div class="pad">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => `<button data-${track ? 'track' : 'flow'}="key" data-v="${k}">${k}</button>`).join('')}</div>`;
function addPending(amt) {
  const a = round(parseFloat(amt) || 0);
  if (!(a > 0)) return;
  S().pending = [...(S().pending || []), { id: uid(), amount: a, date: today() }];
  saveSettings();
}
function openTrack() { track = { amt: '', count: 0 }; drawTrack(); $('#sheet').hidden = false; }
function drawTrack() {
  const f = track, amtNum = parseFloat(f.amt) || 0, dis = amtNum ? '' : 'disabled style="opacity:.4"';
  $('#sheet').innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Track later</span><button data-track="close" aria-label="Close">✕</button></div>
    <div class="q">Just the price</div>
    <p class="note" style="margin:0 0 10px">Saved aside to finish (category + details) later — not logged yet.</p>
    <div class="amount ${amtNum ? '' : 'zero'}">$${esc(f.amt || '0')}</div>
    ${keypad()}
    <div class="twobtn"><button class="btn block" data-track="more" ${dis}>+ Add more</button><button class="btn primary block" data-track="done" ${dis}>Done</button></div>
    ${f.count ? `<p class="note" style="text-align:center;margin-bottom:0">${f.count} saved to finish later</p>` : ''}</div>`;
}
function trackClick(btn) {
  const f = track, v = btn.dataset.v;
  switch (btn.dataset.track) {
    case 'close': return closeSheet();
    case 'key':
      f.amt = typeAmount(f.amt, v);
      return refreshAmount(f.amt, '[data-track="more"],[data-track="done"]');
    case 'more': if (parseFloat(f.amt) > 0) { addPending(f.amt); f.count += 1; f.amt = ''; drawTrack(); render(); toast('Saved to finish later'); } return;
    case 'done': if (parseFloat(f.amt) > 0) addPending(f.amt); closeSheet(); render(); if (parseFloat(f.amt) > 0 || f.count) toast('Saved to finish later'); return;
  }
}

// ----- the list of loose logs to finish (also the first-open reminder) -----
function openPending() {
  const pend = (S().pending || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!pend.length) return;
  const rows = pend.map((x) => `<div class="loose-row">
    <button class="loose" data-act="finish-item" data-id="${esc(x.id)}"><div class="emoji">🕗</div>
      <div class="body"><div class="t">${money(x.amount)}</div><div class="s">added ${parseYmd(x.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · tap to finish</div></div><span class="chev">›</span></button>
    <button class="x" data-act="pending-del" data-id="${esc(x.id)}" aria-label="Discard">✕</button></div>`).join('');
  $('#sheet').innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Loose logs to finish</span><button data-act="sheet-close" aria-label="Later">✕</button></div>
    <p class="note" style="margin:0 0 10px">${pend.length} item${pend.length === 1 ? '' : 's'} captured as price-only. Tap one to add its category and details and log it.</p>
    ${rows}
    <button class="btn block" data-act="sheet-close" style="margin-top:12px">Later</button></div>`;
  $('#sheet').className = 'sheet';
  $('#sheet').hidden = false;
}

// ----- edit a bill: fixed amount, past-month history, 12-month average -----
const monthLabelShort = (ym) => parseYmd(ym + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const prevYm = (ym) => { const d = parseYmd(ym + '-01'); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); };
function openBillEdit(i) { billEdit = i; drawBillEdit(); $('#sheet').hidden = false; }
function drawBillEdit() {
  const b = S().bills[billEdit];
  if (!b) return closeSheet();
  const hist = (b.history || []).slice().sort((a, c) => c.month.localeCompare(a.month));
  const avg = billAmount({ ...b, useAvg: true });
  const rows = hist.map((h) => `<div class="field">
    <input type="month" data-bh="${esc(h.id)}" data-f="month" value="${esc(h.month)}" max="${today().slice(0, 7)}">
    <input type="number" inputmode="decimal" data-bh="${esc(h.id)}" data-f="amount" value="${h.amount}" style="width:100px" placeholder="0">
    <button class="x" data-act="bh-del" data-id="${esc(h.id)}" aria-label="Remove">✕</button></div>`).join('') || '<div class="empty" style="padding:14px">No months logged yet.</div>';
  $('#sheet').innerHTML = `<div class="panel"><div class="head">
      <span style="width:40px"></span><span class="step">Edit ${esc(b.name)}</span><button data-act="bill-done" aria-label="Done">✕</button></div>
    <label class="editlbl">Fixed amount</label>
    <input class="sheet-input" type="number" inputmode="decimal" value="${b.amount}" data-billfix="amount" ${b.useAvg ? 'disabled' : ''}>
    <label class="paytoggle" style="display:flex;align-items:center;gap:10px;margin:12px 2px 4px"><input type="checkbox" data-billavg ${b.useAvg ? 'checked' : ''}> Use 12-month average${b.history && b.history.length ? ` <b style="margin-left:auto">${money(avg)}</b>` : ''}</label>
    <div class="note" style="margin:2px 2px 10px">${b.useAvg ? `Using the average of the last ${Math.min(12, hist.length)} month${hist.length === 1 ? '' : 's'}.` : 'Turn on to use the average of the months below instead of the fixed amount.'}</div>
    <label class="editlbl">Past months</label>
    ${rows}
    <button class="btn block" data-act="bh-add">+ Add a month</button>
    <button class="btn primary block" data-act="bill-done">Done</button></div>`;
}

// Categories you can log into: your spending categories, then Income + money moves.
const SPECIAL_CATS = [
  { id: 'income', name: 'Income', emoji: '💰', type: 'income' },
  { id: 'bills', name: 'Bills', emoji: '🏦', type: 'transfer' },
  { id: 'savings', name: 'Savings', emoji: '🐷', type: 'transfer' },
  { id: 'card', name: 'Credit card', emoji: '💳', type: 'transfer' }
];
const logCats = () => [...S().categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, type: 'expense', useAvg: !!c.useAvg })), ...SPECIAL_CATS];
const logCat = (id) => logCats().find((c) => c.id === id);

// ----- add entries (category first, then amount → description; Save or Add another) -----
function openFlow(opts = {}) {
  flow = { step: opts.category ? 2 : 1, category: opts.category || null, amt: opts.amt || '', note: '', date: today(), pay: 'credit', count: 0, pendingId: opts.pendingId || null, amtLocked: !!opts.amtLocked, splitting: false, hasTotal: true, total: '', splits: [] };
  drawFlow(); $('#sheet').hidden = false;
}

function drawFlow() {
  const f = flow, el = $('#sheet');
  const c = f.category ? logCat(f.category) : null;
  const amtNum = parseFloat(f.amt) || 0;
  let body, title;
  if (f.step === 1) {
    title = 'Pick a category';
    body = `<div class="q">What's it for?</div>
      <div class="cats">${logCats().map((x) => `<button data-flow="cat" data-v="${esc(x.id)}"><span class="e">${x.emoji}</span>${esc(x.name)}</button>`).join('')}</div>`;
  } else if (f.step === 2 && f.splitting) {
    // Several charges that share one description/category. Optionally they add up to a set total.
    const total = round(parseFloat(f.total) || 0);
    const allocated = round(f.splits.reduce((a, x) => a + x, 0));
    const remaining = round(total - allocated);
    const subNum = parseFloat(f.amt) || 0;
    title = 'Split into charges';
    const chips = f.splits.map((x, j) => `<button class="splitchip" data-flow="delsplit" data-i="${j}">${money(x)} <span class="x-mini">✕</span></button>`).join('');
    const addDis = (subNum > 0 && (!f.hasTotal || subNum <= remaining + 0.001)) ? '' : 'disabled style="opacity:.4"';
    const nextDis = (f.splits.length && (!f.hasTotal || remaining === 0)) ? '' : 'disabled style="opacity:.4"';
    const stat = f.hasTotal
      ? `<div class="splitstat"><div><span>Order total</span><b>${money(total)}</b></div><div><span>Remaining</span><b class="${remaining < 0 ? 'negtext' : remaining === 0 ? 'goodtext' : ''}">${money(remaining)}</b></div></div>`
      : `<div class="splitstat"><div><span>Charges</span><b>${f.splits.length}</b></div><div><span>So far</span><b>${money(allocated)}</b></div></div>`;
    body = `<div class="q">Split into charges</div>
      <div class="catpill"><span class="e">${c.emoji}</span>${esc(c.name)}</div>
      ${stat}
      ${chips ? `<div class="splitchips">${chips}</div>` : `<p class="note" style="margin:2px 2px 8px">${f.hasTotal ? 'Enter each charge — they must add up to the total.' : 'Enter each charge; they all share one description & category.'}</p>`}
      <div class="amount ${subNum ? '' : 'zero'}">$${esc(f.amt || '0')}</div>
      <div class="pad">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => `<button data-flow="key" data-v="${k}">${k}</button>`).join('')}</div>
      <div class="twobtn"><button class="btn block" data-flow="addsplit" ${addDis}>+ Add charge</button><button class="btn primary block" data-flow="splitnext" ${nextDis}>Continue</button></div>
      <button class="btn block" data-flow="cancelsplit" style="margin-top:8px">Cancel</button>`;
  } else if (f.step === 2) {
    const isExpense = c.type === 'expense';
    title = isExpense ? 'Step 2 of 3' : 'Step 2 of 2';
    const dis = amtNum ? '' : 'disabled style="opacity:.4"';
    const actions = isExpense
      ? `<button class="btn primary block" data-flow="next" ${dis}>Continue</button>
         <label class="exrow" style="justify-content:center"><input type="checkbox" id="f-splittotal" checked> First amount is the order total</label>
         <button class="btn block" data-flow="startsplit" ${dis}>⊟ Split into charges (e.g. Amazon)</button>`
      : `<div class="twobtn"><button class="btn block" data-flow="again" ${dis}>+ Add another</button><button class="btn primary block" data-flow="save" ${dis}>Save</button></div>
         ${f.count ? `<p class="note" style="text-align:center;margin-bottom:0">${f.count} added under ${esc(c.name)} so far</p>` : ''}`;
    body = `<div class="q">How much?</div>
      <div class="catpill"><span class="e">${c.emoji}</span>${esc(c.name)}${f.count ? ` · item ${f.count + 1}` : ''}</div>
      <div class="amount ${amtNum ? '' : 'zero'}">$${esc(f.amt || '0')}</div>
      <div class="pad">${['1','2','3','4','5','6','7','8','9','.','0','⌫'].map((k) => `<button data-flow="key" data-v="${k}">${k}</button>`).join('')}</div>
      ${actions}`;
  } else {
    title = 'Step 3 of 3';
    const ph = c.type === 'income' ? 'Paycheck, refund…' : c.type === 'transfer' ? 'Note (optional)' : 'What was it? (e.g. Wingstop)';
    const payToggle = c.type === 'expense' ? `<div class="seg paytoggle">
      <button data-flow="pay" data-v="credit" class="${f.pay !== 'cash' ? 'on' : ''}">💳 Credit card</button>
      <button data-flow="pay" data-v="cash" class="${f.pay === 'cash' ? 'on' : ''}">💵 Debit / cash</button></div>` : '';
    const exToggle = c.type === 'expense' && c.useAvg ? `<label class="exrow"><input type="checkbox" id="f-ex" ${f.exAvg ? 'checked' : ''}> Exclude from the ${esc(c.name)} average <span class="muted">(unusual trip)</span></label>` : '';
    const shownAmt = f.splitting ? (f.hasTotal ? round(parseFloat(f.total) || 0) : round(f.splits.reduce((a, x) => a + x, 0))) : amtNum;
    const splitNote = f.splitting ? `<div class="muted">${esc(c.name)} · ${f.splits.length} charges</div>` : `<div class="muted">${esc(c.name)}</div>`;
    const single = f.pendingId || f.splitting;
    body = `<div class="q">Add a description</div>
      <div class="summary"><div class="emoji" style="background:var(--card)">${c.emoji}</div><div><b>${money(shownAmt)}</b>${splitNote}</div></div>
      <input class="sheet-input" id="f-note" type="text" placeholder="${ph}" value="${esc(f.note)}" autocomplete="off">
      <input class="sheet-input" id="f-date" type="date" value="${f.date}" max="${today()}">
      ${payToggle}
      ${exToggle}
      ${single
        ? `<button class="btn primary block" data-flow="save">${f.splitting ? `Save ${f.splits.length} charges` : 'Save &amp; log it'}</button>`
        : `<div class="twobtn"><button class="btn block" data-flow="again">+ Add another</button><button class="btn primary block" data-flow="save">Save</button></div>
      ${f.count ? `<p class="note" style="text-align:center;margin-bottom:0">${f.count} added under ${esc(c.name)} so far</p>` : `<p class="note" style="text-align:center;margin-bottom:0">“Add another” keeps ${esc(c.name)} selected for the next item.</p>`}`}`;
  }
  el.innerHTML = `<div class="panel"><div class="head">
    ${f.step > 1 ? '<button data-flow="back" aria-label="Back">←</button>' : '<span style="width:40px"></span>'}
    <span class="step">${title}</span><button data-flow="close" aria-label="Close">✕</button></div>${body}</div>`;
  if (f.step === 3) setTimeout(() => $('#f-note')?.focus(), 50);
}

// Build + save the current entry; returns the tx (for the toast).
function flowCommit() {
  const f = flow, c = logCat(f.category);
  const note = $('#f-note') ? $('#f-note').value.trim() : f.note;
  const date = $('#f-date') ? ($('#f-date').value || today()) : f.date;
  f.date = date;
  if ($('#f-ex')) f.exAvg = $('#f-ex').checked;
  const decorate = (tx) => { if (c.type === 'expense') { tx.pay = f.pay === 'cash' ? 'cash' : 'credit'; if (c.useAvg && f.exAvg) tx.exAvg = true; } return tx; };
  const mk = (amount) => decorate({ type: c.type, amount: round(amount), category: c.type === 'income' ? 'income' : c.id, note, date });
  let result;
  if (f.splitting && f.splits.length) {
    // log each charge separately so they match the credit-card statement line items
    f.splits.forEach((amt) => addTx(mk(amt)));
    result = { ...mk(f.splits.reduce((a, x) => a + x, 0)), _count: f.splits.length };
  } else {
    result = mk(parseFloat(f.amt));
    addTx(result);
  }
  if (f.pendingId) { S().pending = (S().pending || []).filter((x) => x.id !== f.pendingId); saveSettings(); }
  ui.month = date.slice(0, 7);
  if (ui.tab === 'settings') ui.tab = 'home';
  return result;
}

// Keypad helpers — update the amount in place so the panel doesn't flash on each tap.
function typeAmount(amt, v) {
  if (v === '⌫') return amt.slice(0, -1);
  if (v === '.') return amt.includes('.') ? amt : (amt || '0') + '.';
  if (amt.includes('.') && amt.split('.')[1].length >= 2) return amt;
  if (amt.replace('.', '').length >= 8) return amt;
  return amt === '0' ? v : amt + v;
}
function refreshAmount(amt, actionSelector) {
  const amtNum = parseFloat(amt) || 0;
  const el = $('.amount');
  if (el) { el.textContent = '$' + (amt || '0'); el.classList.toggle('zero', !amtNum); }
  document.querySelectorAll(actionSelector).forEach((btn) => { btn.disabled = !amtNum; btn.style.opacity = amtNum ? '' : '.4'; });
}

function flowClick(btn) {
  const f = flow, v = btn.dataset.v;
  switch (btn.dataset.flow) {
    case 'close': return closeSheet();
    case 'cat': {
      f.category = v;
      if (f.amtLocked) {
        const c = logCat(v);
        if (c.type === 'expense') { f.step = 3; return drawFlow(); }
        const tx = flowCommit(); closeSheet(); render(); toast(savedMsg(tx)); return;  // non-expense: nothing more to enter
      }
      f.step = 2; return drawFlow();
    }
    case 'key':
      f.amt = typeAmount(f.amt, v);
      if (f.splitting) {  // live update + enable "Add charge" (capped at Remaining only when there's a total)
        const remaining = round((parseFloat(f.total) || 0) - f.splits.reduce((a, x) => a + x, 0)), sub = parseFloat(f.amt) || 0;
        const el = $('.amount'); if (el) { el.textContent = '$' + (f.amt || '0'); el.classList.toggle('zero', !sub); }
        const add = $('[data-flow="addsplit"]'); if (add) { const ok = sub > 0 && (!f.hasTotal || sub <= remaining + 0.001); add.disabled = !ok; add.style.opacity = ok ? '' : '.4'; }
        return;
      }
      return refreshAmount(f.amt, '[data-flow="next"],[data-flow="save"],[data-flow="again"],[data-flow="startsplit"]');  // live update, no panel rebuild
    case 'next': if (parseFloat(f.amt) > 0) { f.step = 3; drawFlow(); } return;
    case 'startsplit': {
      if (!(parseFloat(f.amt) > 0)) return;
      f.hasTotal = $('#f-splittotal') ? $('#f-splittotal').checked : true;
      if (f.hasTotal) { f.total = f.amt; f.splits = []; }       // first amount is the order total
      else { f.total = ''; f.splits = [round(parseFloat(f.amt))]; }  // first amount is just the first charge
      f.splitting = true; f.amt = ''; return drawFlow();
    }
    case 'addsplit': { const remaining = round((parseFloat(f.total) || 0) - f.splits.reduce((a, x) => a + x, 0)), sub = round(parseFloat(f.amt) || 0); if (sub > 0 && (!f.hasTotal || sub <= remaining + 0.001)) { f.splits.push(sub); f.amt = ''; drawFlow(); } return; }
    case 'delsplit': f.splits.splice(+btn.dataset.i, 1); return drawFlow();
    case 'splitnext': { const remaining = round((parseFloat(f.total) || 0) - f.splits.reduce((a, x) => a + x, 0)); if (f.splits.length && (!f.hasTotal || remaining === 0)) { f.step = 3; drawFlow(); } return; }
    case 'cancelsplit': f.splitting = false; f.amt = f.hasTotal ? f.total : ''; f.total = ''; f.splits = []; return drawFlow();
    case 'pay': { if ($('#f-note')) f.note = $('#f-note').value; if ($('#f-date')) f.date = $('#f-date').value || f.date; if ($('#f-ex')) f.exAvg = $('#f-ex').checked; f.pay = v; return drawFlow(); }
    case 'back': f.step = (f.amtLocked && f.step === 3) ? 1 : f.step - 1; if (f.step < 1) f.step = 1; return drawFlow();
    case 'save': { if (!f.splitting && !(parseFloat(f.amt) > 0)) return; const tx = flowCommit(); closeSheet(); render(); toast(savedMsg(tx)); return; }
    case 'again': { if (!(parseFloat(f.amt) > 0)) return; const tx = flowCommit(); f.count += 1; f.amt = ''; f.note = ''; f.exAvg = false; f.step = 2; drawFlow(); render(); toast(savedMsg(tx)); return; }
  }
}

function savedMsg(tx) {
  const ms = MS();
  if (tx._count) return `Logged ${tx._count} charges · ${money(tx.amount)} total · ${cat(tx.category)?.name || ''}`;
  if (tx.type === 'income') return `Added ${money(tx.amount)} income`;
  if (tx.type === 'transfer') return tx.category === 'bills' ? `Moved ${money(tx.amount)} to bills · ${ms.billsLeft ? money(ms.billsLeft) + ' still needed' : 'fully funded ✓'}`
    : tx.category === 'card' ? `Paid ${money(tx.amount)} on the card · ${money(cardBalance(S(), store.txs))} left` : `Saved ${money(tx.amount)}`;
  const c = cat(tx.category); let msg = `Logged ${money(tx.amount)} · ${c?.name || tx.category}`;
  if (c) { const bud = cb(c); if (bud > 0) { const left = round(bud - ms.byCat[c.id]); msg += left >= 0 ? ` · ${money(left)} left` : ` · ${money(-left)} over`; } }
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
  const ex = $('#e-ex'); if (ex) edit.exAvg = ex.checked;
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
    ${e.type === 'expense' ? `<label class="editlbl">Paid with</label><div class="seg paytoggle">
      <button data-edit="pay" data-v="credit" class="${(e.pay || 'credit') !== 'cash' ? 'on' : ''}">💳 Credit card</button>
      <button data-edit="pay" data-v="cash" class="${e.pay === 'cash' ? 'on' : ''}">💵 Debit / cash</button></div>` : ''}
    ${e.type === 'expense' && cat(e.category)?.useAvg ? `<label class="exrow"><input type="checkbox" id="e-ex" ${e.exAvg ? 'checked' : ''}> Exclude from the ${esc(cat(e.category).name)} average <span class="muted">(unusual trip)</span></label>` : ''}
    <button class="btn primary block" data-edit="save">Save changes</button>
    <button class="btn danger block" data-edit="delete">Delete</button></div>`;
}
function editClick(btn) {
  const e = edit, v = btn.dataset.v;
  switch (btn.dataset.edit) {
    case 'close': return closeSheet();
    case 'type': syncEditInputs(); e.type = v; e.category = v === 'income' ? 'income' : v === 'transfer' ? 'bills' : (cat(e.category) ? e.category : S().categories[0].id); return drawEdit();
    case 'cat': syncEditInputs(); e.category = v; return drawEdit();
    case 'pay': syncEditInputs(); e.pay = v; return drawEdit();
    case 'save': {
      syncEditInputs();
      if (!(e.amount > 0)) return toast('Enter an amount');
      const patch = { type: e.type, amount: round(e.amount), category: e.type === 'income' ? 'income' : e.category, note: (e.note || '').trim(), date: e.date };
      if (e.type === 'expense') { patch.pay = e.pay === 'cash' ? 'cash' : 'credit'; patch.exAvg = !!e.exAvg; }
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

// ----- this month, week by week -----
const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function openWeek() {
  const s = S(), now = new Date();
  const startDay = s.weekStartDay ?? 5;
  const ws = weekStats(s, store.txs, now);
  const ms = monthStats(s, store.txs, ui.month, now);
  const [y, m] = ui.month.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1), nextMonth = new Date(y, m, 1);

  // Build each week window overlapping this month, clipped to the month.
  const weeks = [];
  let wkStart = parseYmd(weekStart(monthStart, startDay)), n = 1;
  while (wkStart < nextMonth) {
    const wkEnd = addDays(wkStart, 7);
    const from = ymd(wkStart < monthStart ? monthStart : wkStart);
    const to = ymd(wkEnd > nextMonth ? nextMonth : wkEnd);
    const txsIn = store.txs.filter((t) => t.date >= from && t.date < to).sort(sortTx);
    const spent = round(txsIn.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0));
    const everyday = round(txsIn.filter((t) => t.type === 'expense' && ws.ids.includes(t.category)).reduce((a, t) => a + t.amount, 0));
    weeks.push({ n, startYmd: ymd(wkStart), from, to, spent, everyday, txsIn, isNow: ymd(wkStart) === ws.start });
    wkStart = wkEnd; n++;
  }

  const weekRows = weeks.map((w) => {
    const rng = `${shortDate(parseYmd(w.from))} – ${shortDate(addDays(parseYmd(w.to), -1))}`;
    const body = w.txsIn.length ? w.txsIn.map(txRow).join('') : '<div class="empty">Nothing this week.</div>';
    return `<details class="wk-week"${w.isNow ? ' open' : ''}><summary>
      <span class="wk-left"><span class="wk-n">Week ${w.n}${w.isNow ? ' · now' : ''}</span><span class="wk-range">${rng}</span></span>
      <span class="wk-amt"><b>${money(w.spent)}</b><span>${money(w.everyday)} everyday</span></span><span class="caret">▸</span></summary>
      <div class="wk-body">${body}</div></details>`;
  }).join('');

  const catRows = s.categories.map((c) => {
    const wk = round(store.txs.filter((t) => t.type === 'expense' && t.category === c.id && t.date >= ws.start && t.date < ws.end).reduce((a, t) => a + t.amount, 0));
    return `<div class="wk-cat"><div class="emoji">${c.emoji}</div>
      <div class="body"><span class="n">${esc(c.name)}</span>${c.weekly ? '<span class="tag">weekly</span>' : ''}</div>
      <div class="wk-nums"><div><b>${money(wk)}</b><span>week</span></div><div><b class="muted">${money(ms.byCat[c.id])}${cb(c) ? ` / ${money(cb(c))}` : ''}</b><span>month</span></div></div></div>`;
  }).join('');

  $('#sheet').innerHTML = `<div class="panel sheet-page"><div class="head">
      <button class="backbtn" data-act="sheet-close" aria-label="Back">←</button><span class="step">${monthShort(ui.month)} · weekly</span><span style="width:28px"></span></div>
    <div class="card hero" style="box-shadow:none;padding:4px 0">
      <div class="label">Left to spend this week</div>
      <div class="big ${ws.left < 0 ? 'neg' : ''}">${money(ws.left)}</div>
      <div class="bar ${barClass(ws.spent, ws.budget)}"><i style="width:${pct(ws.spent, ws.budget)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(ws.spent)} of ${money(ws.budget)} everyday budget${ws.carryover < 0 ? ` <span class="negtext">(incl. ${money(ws.carryover)} rolled over)</span>` : ''}</div></div>
    <h2>Week by week</h2><div class="card" style="padding:4px 18px">${weekRows}</div>
    <h2>This week by category</h2><div class="card">${catRows}</div></div>`;
  $('#sheet').className = 'sheet page';
  $('#sheet').hidden = false;
}

// ----- the purchases behind a category's 12-month average -----
function openCatAvg(id) {
  const c = cat(id); if (!c) return;
  const now = new Date(), cur = ymd(now).slice(0, 7);
  const gas = store.txs.filter((t) => t.type === 'expense' && t.category === id).sort(sortTx);
  // counted monthly totals (non-excluded, completed months), to find the 12 months used
  const by = {};
  gas.filter((t) => !t.exAvg && t.date.slice(0, 7) < cur).forEach((t) => { const m = t.date.slice(0, 7); by[m] = round((by[m] || 0) + t.amount); });
  const used = new Set(Object.keys(by).sort().slice(-12));
  const avg = used.size ? round([...used].reduce((a, m) => a + by[m], 0) / used.size) : 0;

  // group all gas purchases by month, newest first
  const months = [...new Set(gas.map((t) => t.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
  const sections = months.map((m) => {
    const inAvg = used.has(m);
    const label = parseYmd(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const tag = inAvg ? `<span class="mtag in">in average · ${money(by[m])}</span>` : m === cur ? '<span class="mtag">this month · not counted yet</span>' : '<span class="mtag">not counted</span>';
    const rows = gas.filter((t) => t.date.slice(0, 7) === m).map((t) => `<div class="avg-tx ${t.exAvg ? 'skip' : ''}">
      <span class="d">${parseYmd(t.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${t.note ? ' · ' + esc(t.note) : ''}</span>
      <span class="a">${money(t.amount)}${t.exAvg ? ' <span class="ex-tag">excluded</span>' : ''}</span></div>`).join('');
    return `<div class="avg-month"><div class="avg-mhead"><b>${label}</b>${tag}</div>${rows}</div>`;
  }).join('');

  const range = used.size ? ` from ${parseYmd([...used].sort()[0] + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}–${parseYmd([...used].sort().slice(-1)[0] + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}` : '';
  $('#sheet').innerHTML = `<div class="panel sheet-page"><div class="head">
      <button class="backbtn" data-act="sheet-close" aria-label="Back">←</button><span class="step">${esc(c.name)} average</span><span style="width:28px"></span></div>
    <div class="card hero" style="box-shadow:none;padding:4px 0">
      <div class="label">12-month average</div>
      <div class="big">${money(avg)}</div>
      <div class="note" style="margin:8px 0 0">Average of ${used.size} month${used.size === 1 ? '' : 's'}${range}. The current month and excluded trips aren't counted.</div></div>
    ${sections || '<div class="card empty">No gas purchases logged yet.</div>'}</div>`;
  $('#sheet').className = 'sheet page';
  $('#sheet').hidden = false;
}

// ----- monthly trends -----
function openTrends() {
  const t = trends(S(), store.txs);
  const max = Math.max(1, ...t.months.map((m) => m.spent));
  const tile = (label, val) => `<div class="tile"><b>${money(val)}</b><span>${label}</span></div>`;
  const rows = t.months.map((m) => {
    const label = parseYmd(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const sub = [`Saved ${money(m.savings)}`, `Income ${money(m.income)}`, `Bills ${money(m.bills)}`].concat(m.card ? [`Card ${money(m.card)}`] : []).join(' · ');
    return `<div class="tr-month"><div class="tr-top"><span>${label}</span><b>${money(m.spent)} spent</b></div>
      <div class="bar"><i style="width:${pct(m.spent, max)}%"></i></div>
      <div class="tr-sub">${sub}</div></div>`;
  }).join('');
  $('#sheet').innerHTML = `<div class="panel sheet-page"><div class="head">
    <button class="backbtn" data-act="sheet-close" aria-label="Back">← Back</button><span class="step">Monthly trends</span><span style="width:40px"></span></div>
    <p class="lead">Averages across ${t.count} month${t.count === 1 ? '' : 's'} of data.</p>
    <div class="tiles">${tile('Avg spent / mo', t.avg.spent)}${tile('Avg saved / mo', t.avg.savings)}${tile('Avg income / mo', t.avg.income)}</div>
    <div class="tiles" style="margin-top:8px">${tile('Avg to bills / mo', t.avg.bills)}${tile('Avg card paid / mo', t.avg.card)}</div>
    <h2>By month</h2><div class="card">${rows || '<div class="empty">No data yet.</div>'}</div></div>`;
  $('#sheet').className = 'sheet page';
  $('#sheet').hidden = false;
}

// Carry the card balance across statement cycles (folds each closed cycle into
// the starting balance). Runs at startup and on interaction; cheap no-op when
// the baseline is already current.
let rolling = false;
function maybeRollCard() {
  if (rolling) return;
  const rolled = rollCardBaseline(store.settings, store.txs);
  if (rolled) { rolling = true; store.settings.cc = rolled; saveSettings(); rolling = false; }
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
  maybeRollCard();
  const fe = e.target.closest('[data-edit]'); if (fe && edit) return editClick(fe);
  const fl = e.target.closest('[data-flow]'); if (fl && flow) return flowClick(fl);
  const ft = e.target.closest('[data-track]'); if (ft && track) return trackClick(ft);
  if (e.target === $('#sheet')) return closeSheet();
  const tab = e.target.closest('#tabs button');
  if (tab) { if (tab.dataset.tab !== 'plan') ui.planDraft = null; ui.tab = tab.dataset.tab; scrollTo(0, 0); return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'log': return openFlow();
    case 'log-xfer': return openFlow({ category: id });
    case 'week': return openWeek();
    case 'week-reset': { S().weekResetAt = weekStats(S(), store.txs).start; saveSettings(); return render(); }
    case 'cc-strategy': { S().cc = { ...S().cc, strategy: id }; saveSettings(); return render(); }
    case 'cc-mode': { S().cc = { ...S().cc, mode: id }; saveSettings(); return render(); }
    case 'cc-charges-reset': { S().cc = { ...S().cc, chargesAdj: 0 }; saveSettings(); return render(); }
    case 'catavg-view': return openCatAvg(id);
    case 'track-later': return openTrack();
    case 'finish-loose': return openPending();
    case 'finish-item': { const it = (S().pending || []).find((x) => x.id === id); closeSheet(); if (it) openFlow({ amt: String(it.amount), pendingId: it.id, amtLocked: true }); return; }
    case 'pending-del': { if (confirm('Discard this loose item without logging it?')) { S().pending = (S().pending || []).filter((x) => x.id !== id); saveSettings(); render(); if ((S().pending || []).length) openPending(); else closeSheet(); } return; }
    case 'plan-reset': ui.planDraft = null; return render();
    case 'trends': return openTrends();
    case 'sheet-close': return closeSheet();
    case 'goto': ui.planDraft = null; ui.tab = id; scrollTo(0, 0); return render();
    case 'cat-filter': ui.planDraft = null; ui.filter = id; ui.all = false; ui.tab = 'activity'; scrollTo(0, 0); return render();
    case 'prev': case 'next': { const d = parseYmd(ui.month + '-01'); d.setMonth(d.getMonth() + (b.dataset.act === 'next' ? 1 : -1)); ui.month = monthKey(d); return render(); }
    case 'filter': ui.filter = id; return render();
    case 'all': ui.all = !ui.all; return render();
    case 'tx': { const t = store.txs.find((x) => x.id === id); if (t) openEdit(t); return; }
    case 'addcat': { const name = prompt('Category name?'); if (name?.trim()) { S().categories.push({ id: uid(), name: name.trim(), emoji: '🏷️', budget: 0, weekly: false }); saveSettings(); } return; }
    case 'delcat': if (confirm(`Delete "${S().categories[i].name}"? Existing transactions are kept.`)) { S().categories.splice(i, 1); saveSettings(); } return;
    case 'addbill': { const name = prompt('Bill name?'); if (name?.trim()) { S().bills.push({ id: uid(), name: name.trim(), amount: 0, day: 1, history: [], useAvg: false }); saveSettings(); } return; }
    case 'delbill': if (confirm(`Delete "${S().bills[i].name}"?`)) { S().bills.splice(i, 1); saveSettings(); } return;
    case 'billedit': return openBillEdit(i);
    case 'bill-done': closeSheet(); return render();
    case 'bh-add': {
      const b = S().bills[billEdit]; b.history = b.history || [];
      const months = b.history.map((h) => h.month).sort();
      const def = months.length ? prevYm(months[0]) : today().slice(0, 7);
      b.history.push({ id: uid(), month: def, amount: 0 });
      saveSettings(); return drawBillEdit();
    }
    case 'bh-del': { const b = S().bills[billEdit]; b.history = (b.history || []).filter((h) => h.id !== id); saveSettings(); return drawBillEdit(); }
    case 'reimport': { const n = reimportHistory(); toast(n ? `Restored ${n} line items` : 'Everything is already imported'); return; }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#actlist').innerHTML = activityList(); }
  else if (e.target.id === 'sav-slider') slideSavings(+e.target.value);
  else if (e.target.dataset.plan) { (ui.planDraft ||= {})[e.target.dataset.plan] = parseFloat(e.target.value) || 0; planRecalc(); }
});

document.addEventListener('change', (e) => {
  const t = e.target, num = () => parseFloat(t.value) || 0;
  if (t.id === 'sav-slider') { slideSavings(+t.value); saveSettings(); return; }
  if (t.dataset.set) { S()[t.dataset.set] = num(); saveSettings(); }
  else if (t.dataset.cc === 'start') { S().cc = { ...S().cc, start: num(), asOf: today() }; saveSettings(); }
  else if (t.dataset.cc === 'manual') { S().cc = { ...S().cc, manual: num() }; saveSettings(); }
  else if (t.dataset.cc === 'charges') { const raw = cardDetail(S(), store.txs).rawCredit; S().cc = { ...S().cc, chargesAdj: round(num() - raw) }; saveSettings(); }
  else if (t.dataset.billfix) { S().bills[billEdit].amount = num(); saveSettings(); drawBillEdit(); return; }
  else if (t.hasAttribute('data-billavg')) { S().bills[billEdit].useAvg = t.checked; saveSettings(); drawBillEdit(); render(); return; }
  else if (t.dataset.bh) { const h = (S().bills[billEdit].history || []).find((x) => x.id === t.dataset.bh); if (h) { h[t.dataset.f] = t.dataset.f === 'amount' ? num() : (t.value || h.month); saveSettings(); drawBillEdit(); } return; }
  else if (t.dataset.catavg) { S().categories[+t.dataset.catavg].useAvg = t.checked; saveSettings(); }
  else if (t.dataset.cat) { const c = S().categories[+t.dataset.cat]; c[t.dataset.field] = t.type === 'checkbox' ? t.checked : num(); saveSettings(); }
  else if (t.dataset.bill) {
    const b = S().bills[+t.dataset.bill], f = t.dataset.field;
    b[f] = f === 'name' ? t.value : f === 'day' ? Math.min(31, Math.max(1, Math.round(num()) || 1)) : num(); saveSettings();
  } else return;
  render();
});

let interacted = false;
document.addEventListener('pointerdown', () => { interacted = true; }, true);

loadLocal();
maybeRollCard();
render();
maybePendingPrompt();                                   // from localStorage, if any
setTimeout(() => { if (!interacted) maybePendingPrompt(); pendingPromptShown = true; }, 3000);  // catch cloud-synced pending unless the user is already busy
initFirebase();
