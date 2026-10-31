import { store, loadLocal, saveSettings, addTx, updateTx, deleteTx, uid, initFirebase, reimportHistory } from './store.js?v=97';
import { TRANSFERS } from './defaults.js?v=97';
import { round, ymd, parseYmd, addDays, weekStart, monthStats, weekStats, weekPaidState, standardWeek, weeklyGoal, planTxsFor, paydaysInMonth, billsTotal, firstTotal, billAmount, categoryAvg, categoryBudget, cardBalance, cardDetail, cycleWindow, rollCardBaseline, billsProjection, cardPlan, paymentSchedule, nextPayday, weekPlan, monthlyIncome, trends, loanStats, investFV, addMonthsYmd, txNet } from './calc.js?v=97';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
// Text-box number formatting: show thousands separators, parse back by stripping them.
const fmtNum = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const parseNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

const today = () => ymd(new Date());
const monthKey = (d) => ymd(d).slice(0, 7);
const monthLabel = (k) => parseYmd(k + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const monthShort = (k) => parseYmd(k + '-01').toLocaleDateString('en-US', { month: 'long' });
const dayLabel = (s) => {
  if (s === today()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Yesterday';
  return parseYmd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);
// Dates always show the year.
const moDay = (s) => parseYmd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const moYr = (s) => parseYmd(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

const ui = { tab: 'home', month: monthKey(new Date()), filter: 'all', all: false, q: '', planDraft: {}, planLive: true, openCat: null, openLoan: null, weekOff: 0 };
try { ui.planDraft = JSON.parse(localStorage.getItem('plan-draft') || '{}') || {}; } catch { ui.planDraft = {}; }
// Plans used to be one shared scratchpad; they are now kept per week. Anything
// in the old flat shape belongs to whatever week it was typed in, i.e. this one.
if (Object.values(ui.planDraft).some((v) => typeof v === 'number')) {
  const old = {};
  Object.entries(ui.planDraft).forEach(([k, v]) => { if (typeof v === 'number') old[k] = v; });
  ui.planDraft = { [weekStart(new Date(), 5)]: old };
}
try { ui.planLive = JSON.parse(localStorage.getItem('plan-live') ?? 'true'); } catch { ui.planLive = true; }
// Paycheck row: the spending account's real balance by default, the planned
// figure on request. What's actually in the account is the more useful number.
try { ui.payLive = JSON.parse(localStorage.getItem('pay-live') ?? 'true'); } catch { ui.payLive = true; }
const savePayLive = () => { try { localStorage.setItem('pay-live', JSON.stringify(!!ui.payLive)); } catch {} };

// Which collapsibles are open. render() rebuilds the DOM, so without this a
// section closes itself the moment anything inside it changes a value.
try { ui.open = JSON.parse(localStorage.getItem('open-sections') || '{}') || {}; } catch { ui.open = {}; }
const saveOpen = () => { try { localStorage.setItem('open-sections', JSON.stringify(ui.open || {})); } catch {} };
const isOpen = (key, dflt = false) => (ui.open && ui.open[key] !== undefined ? !!ui.open[key] : dflt);
const openAttr = (key, dflt = false) => `data-dkey="${key}"${isOpen(key, dflt) ? ' open' : ''}`;
document.addEventListener('toggle', (e) => {
  const k = e.target && e.target.dataset && e.target.dataset.dkey;
  if (!k) return;
  (ui.open ||= {})[k] = e.target.open;
  saveOpen();
}, true);
const savePlanDraft = () => { try { localStorage.setItem('plan-draft', JSON.stringify(ui.planDraft || {})); } catch {} };
const savePlanLive = () => { try { localStorage.setItem('plan-live', JSON.stringify(!!ui.planLive)); } catch {} };

// ---------- multi-select + live totaller ----------
// Every purchase row carries a checkbox, always ready — tap any to add them up.
// The running total never persists: leaving the view (closing a sheet or switching
// tabs) clears it.
const sel = { ids: new Set() };
const selTotal = () => round([...sel.ids].reduce((a, id) => { const t = store.txs.find((x) => x.id === id); return a + (t ? t.amount : 0); }, 0));
function renderSelBar() {
  const el = $('#seltotal'); if (!el) return;
  if (sel.ids.size === 0) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="selbar">
    <span class="selcount">${sel.ids.size} selected</span><span class="seltot">${money(selTotal())}</span>
    <button class="selclear" data-act="sel-done">Clear</button></div>`;
}
function resetSel() { if (!sel.ids.size) { renderSelBar(); return; } sel.ids.clear(); renderSelBar(); }

// ---------- helpers ----------
const S = () => store.settings;
const cat = (id) => S().categories.find((c) => c.id === id);
const cb = (c) => categoryBudget(S(), store.txs, c);   // effective category budget (avg for gas when on)
const tfer = (id) => TRANSFERS.find((t) => t.id === id);
// Order by when it was entered (newest first), not by the purchase date.
const entryTime = (t) => (t.at != null ? t.at : parseYmd(t.date).getTime());
const sortTx = (a, b) => entryTime(b) - entryTime(a) || (b.id > a.id ? 1 : -1);
const monthTxs = () => store.txs.filter((t) => t.date.startsWith(ui.month)).sort(sortTx);
const MS = () => monthStats(S(), store.txs, ui.month);
const barClass = (spent, budget) => (spent > budget ? 'over' : spent > budget * 0.85 ? 'warn' : '');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

// ---------- rendering ----------
let pendingPromptShown = false;
function maybePendingPrompt() {
  if (pendingPromptShown || !$('#sheet').hidden) return;
  if (!(S().pending || []).length && !bankUI.progress.length) return;
  pendingPromptShown = true;
  openPending();
}
function render() {
  if (!bankUI.booted && S().bankOn) { bankUI.booted = true; bankUI.on = true; setTimeout(bankAuto, 0); }
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#app').innerHTML = ({ home, plan: planTab, finance, settings }[ui.tab] || home)();
}
store.onChange = () => { if (!document.activeElement || !document.activeElement.closest('#app input')) render(); };

function header(title, nav = true) {
  const months = !nav ? '' : `<div class="month">
    <button data-act="prev" aria-label="Previous month">‹</button><button data-act="next" aria-label="Next month">›</button></div>`;
  const sub = nav ? monthLabel(ui.month) : '';
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
    const cardRet = round((s.returns || []).filter((r) => (r.pay || 'credit') !== 'cash').reduce((a, r) => a + Math.abs(r.amount || 0), 0));
    const stat3 = bal > 0
      ? `<div><b>${money(bal)}</b><span>${cardRet > 0 ? `Card · ${money(cardRet)} to return` : 'Card balance'}</span></div>`
      : `<div><b>${money(s.weeklySavings)}</b><span>Weekly savings</span></div>`;
    hero = `<button class="card hero tappable" data-act="week">
      <div class="label">Left to spend this week <span class="hint">tap for breakdown ›</span></div>
      <div class="big ${ws.left < 0 ? 'neg' : ''}">${money(ws.left)}</div>
      <div class="bar ${barClass(ws.spent, ws.budget)}"><i style="width:${pct(ws.spent, ws.budget)}%"></i></div>
      <div class="note" style="margin:8px 0 0">${money(ws.spent)} of ${money(ws.budget)}${ws.carryover < 0 ? ` <span class="negtext">(incl. ${money(ws.carryover)} rolled over)</span>` : ''} · ${ws.ids.map((i) => esc(cat(i)?.name)).join(', ')}</div>
      <div class="stats">
        <div><b>${money(ws.spent)}</b><span>Spent this week</span></div>
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
    ? `<div class="rollover">Weekly ${money(ws.planBudget)} − ${money(ws.trimmedByCard)} freed for the card = <b>${money(ws.baseBudget)}</b> to spend this week.</div>`
    : '';
  const rollover = weekly && ws.overage > 0 && !ws.reset
    ? `<div class="rollover">You went ${money(ws.overage)} over last week. It's on the card, spread across the paydays you have left. <button class="link" data-act="overage-view">Review</button> · <button class="link" data-act="week-reset">Forgive</button></div>`
    : '';
  const forgivenNote = weekly && ws.forgiven > 0
    ? `<div class="rollover info">Last week's ${money(ws.forgiven)} over-spend is forgiven — it isn't trimming this week. <button class="link" data-act="week-unreset">Bring the penalty back</button></div>`
    : '';

  const estIncome = monthlyIncome(s, ui.month);
  const neutralBar = (name, act) => act === 'goto' || name === 'Income' || name === 'Savings';
  const moneyRow = (emoji, name, spent, total, act, id, hasBudget, open = false) => {
    const inner = hasBudget
      ? `<div class="row"><span class="n">${esc(name)}</span><span class="a">${money(spent)} / ${money(total)}</span></div>
         <div class="bar ${neutralBar(name, act) ? '' : barClass(spent, total)}"><i style="width:${pct(spent, total)}%"></i></div>`
      : `<div class="row"><span class="n">${esc(name)}</span><span class="a">${money(spent)} spent</span></div>`;
    return `<button class="cat ${open ? 'open' : ''}" data-act="${act}" data-id="${esc(id)}"><div class="emoji">${emoji}</div><div class="body">${inner}</div><span class="chev">›</span></button>`;
  };
  // "Other" is the weekly-spending pool: the weekly budget (standard, ignoring any
  // card adjustment) minus the budgets of weekly categories that have their own
  // (e.g. Gas). Weekly categories WITHOUT a budget (e.g. Jaren) roll into Other as
  // sub-tiers instead of getting their own row.
  const paychecks = paydaysInMonth(ui.month, s.weekStartDay ?? 5);    // 4 or 5 this month
  const weeklyCats = s.categories.filter((c) => c.weekly);
  const budgetedWeeklySum = round(weeklyCats.reduce((a, c) => a + (cb(c) > 0 ? cb(c) : 0), 0));
  const rolled = weeklyCats.filter((c) => cb(c) <= 0);                 // unbudgeted weekly → Other
  const rolledIds = new Set(rolled.map((c) => c.id));
  const otherBudget = Math.max(0, round(s.weeklyBudget * paychecks - budgetedWeeklySum));
  const otherSpent = round(rolled.reduce((a, c) => a + (ms.byCat[c.id] || 0), 0));

  // Tapping a category expands its month's line items inline (not a jump to Activity).
  const monthList = monthTxs();
  const txsFor = (key) => (key === 'income' ? monthList.filter((t) => t.type === 'income')
    : key === 'savings' ? monthList.filter((t) => t.type === 'transfer' && t.category === 'savings')
    : monthList.filter((t) => t.type === 'expense' && t.category === key)).sort(sortTx);
  // Header shown atop a dropdown: how far under/over budget this month.
  // goodOver = over the number is a good thing (income, savings).
  const dropHead = (spent, total, goodOver) => {
    if (!(total > 0)) return `<div class="du-note">${money(spent)} this month</div>`;
    const diff = round(total - spent);
    if (goodOver) return diff > 0.005
      ? `<div class="du-note">${money(diff)} to go · ${money(spent)} of ${money(total)}</div>`
      : `<div class="du-note good">${money(-diff)} over target · ${money(spent)} of ${money(total)}</div>`;
    return diff >= -0.005
      ? `<div class="du-note good">${money(diff)} under budget · ${money(spent)} of ${money(total)}</div>`
      : `<div class="du-note bad">${money(-diff)} over budget · ${money(spent)} of ${money(total)}</div>`;
  };
  const exRow = (emoji, name, spent, total, key, hasBudget, goodOver = false) => {
    const open = ui.openCat === key;
    let drop = '';
    if (open) { const l = txsFor(key); drop = `<div class="catdrop">${dropHead(spent, total, goodOver)}${l.length ? l.map(txRow).join('') : '<div class="empty">Nothing this month.</div>'}</div>`; }
    return moneyRow(emoji, name, spent, total, 'cat-toggle', key, hasBudget, open) + drop;
  };

  // The credit-card balance owed is committed against your weekly spending, so it
  // counts toward "Other" used (shown with the math), not as free spending room.
  const cardOwed = bal > 0 ? round(bal) : 0;
  const otherUsed = round(otherSpent + cardOwed);

  // Other's dropdown: the math (spending + card owed), then the weekly sub-tiers.
  const otherDrop = () => {
    const left = round(otherBudget - otherUsed);
    const math = cardOwed > 0
      ? `${money(otherSpent)} spent + ${money(cardOwed)} card owed = ${money(otherUsed)} of ${money(otherBudget)}`
      : `${money(otherSpent)} of ${money(otherBudget)}`;
    const head = `<div class="du-note ${left < 0 ? 'bad' : 'good'}">${math} · ${left < 0 ? money(-left) + ' over' : money(left) + ' left'}</div>`;
    const groups = rolled.map((c) => ({ c, txs: monthList.filter((t) => t.type === 'expense' && t.category === c.id).sort(sortTx), total: round(ms.byCat[c.id] || 0) })).filter((g) => g.txs.length);
    const subs = groups.map((g) => `<div class="subtier"><span>${g.c.emoji} ${esc(g.c.name)}</span><b>${money(g.total)}</b></div>${g.txs.map(txRow).join('')}`).join('');
    const cardSub = cardOwed > 0 ? `<div class="subtier"><span>💳 Credit card owed</span><b class="negtext">${money(cardOwed)}</b></div>` : '';
    const empty = (!subs && !cardSub) ? '<div class="empty">Nothing in other weekly spending yet.</div>' : '';
    return `<div class="catdrop">${head}${subs}${cardSub}${empty}</div>`;
  };
  const otherRow = weeklyCats.length
    ? moneyRow('🧾', 'Other', otherUsed, otherBudget, 'cat-toggle', '__other', true, ui.openCat === '__other') + (ui.openCat === '__other' ? otherDrop() : '')
    : '';

  const savingsTarget = round(s.weeklySavings * paychecks);
  const list = [
    exRow('💰', 'Income', ms.income, estIncome, 'income', true, true),
    ...s.categories.filter((c) => !rolledIds.has(c.id)).map((c) => { const bud = cb(c); return exRow(c.emoji, c.name, ms.byCat[c.id], bud, c.id, bud > 0); }),
    otherRow,
    exRow('🐷', 'Savings', ms.savingsIn, savingsTarget, 'savings', savingsTarget > 0, true),
    moneyRow('🏦', 'Bills account', ms.billsIn, ms.billsTotal, 'goto', 'plan', true)
  ].join('');

  return `${header('Budget')}
    ${hero}
    ${cardTrim}
    ${rollover}
    ${forgivenNote}
    <button class="log-btn" data-act="log"><span class="plus">+</span> Log a purchase</button>
    <h2>${monthShort(ui.month)} · ${paychecks} paychecks</h2><div class="card">${list}</div>
    <div class="twobtn" style="margin-top:16px">
      <button class="btn block ${pend.length ? 'primary' : ''}" data-act="finish-loose">🕗 Loose logs${pend.length ? ` · ${pend.length}` : ''}</button>
      <button class="btn block" data-act="returns-view">↩︎ Returns${(s.returns || []).length ? ` · ${(s.returns || []).length}` : ''}</button>
    </div>
    ${activityBlock()}`;
}

function txRow(t) {
  let icon, label, sub, amt;
  if (t.type === 'income') { icon = '💰'; label = t.note || 'Income'; sub = 'Income'; amt = `<div class="amt in">+${money(t.amount)}</div>`; }
  else if (t.type === 'transfer') { const x = tfer(t.category); const nm = x?.name || t.category; icon = x?.emoji || '🔁'; label = t.note || nm; sub = t.note ? nm : ''; amt = `<div class="amt xfer">${money(t.amount)}</div>`; }
  else { const c = cat(t.category); icon = c ? c.emoji : '🧾'; label = t.note || (c ? c.name : 'Purchase'); sub = c ? c.name : t.category; amt = `<div class="amt">${money(t.amount)}</div>`; }
  const ccDot = (t.type === 'expense' && t.pay === 'credit' ? ' <span class="cc-dot" title="Credit card">💳</span>' : '')
    + (t.returned > 0 ? ' <span class="ex-tag ret">returning</span>' : '')
    + (t.exAvg ? ' <span class="ex-tag" title="Excluded from average">excl. avg</span>' : '');
  const dateStr = parseYmd(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const picked = sel.ids.has(t.id);
  return `<div class="tx${picked ? ' selected' : ''}">
    <button class="selbox${picked ? ' on' : ''}" data-act="tx-toggle" data-id="${esc(t.id)}" aria-label="Select for total"></button>
    <button class="tx-main" data-act="tx" data-id="${esc(t.id)}"><div class="emoji">${icon}</div>
    <div class="body"><div class="t">${esc(label)}${ccDot}</div><div class="s">${sub ? esc(sub) + ' · ' : ''}${dateStr}</div></div>${amt}<span class="chev">›</span></button></div>`;
}

function billsAcctCard(s, now = new Date()) {
  const bp = billsProjection(s, store.txs, now);
  const asOfLabel = bp.hasBal ? 'as of ' + shortDate(parseYmd(bp.asOf)) + (bp.staleDays >= 1 ? ` · ${bp.staleDays} day${bp.staleDays === 1 ? '' : 's'} ago` : '') : 'enter your bank balance to start';
  const firstLabel = parseYmd(bp.firstDue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const verdict = !bp.hasBal ? ''
    : bp.covered
      ? `<b class="goodtext">Covered · ${money(bp.surplus)} to spare</b>`
      : `<b class="negtext">Short ${money(bp.shortfall)}</b>`;

  const upRows = bp.upList.length
    ? bp.upList.map((b) => `<div><span>${b.when === 'first' ? '🔴 ' : ''}${esc(b.name)}${b.when === 'first' ? ` · ${firstLabel}` : ' · ' + ordinal(b.day)}</span><b>${money(b.amount)}</b></div>`).join('')
    : `<div><span class="muted">Nothing due before ${firstLabel}</span><b>${money(0)}</b></div>`;

  const lessLump = bp.overfund > 0.005 ? ` · ${money(bp.overfund)} total` : '';
  const compare = !bp.hasBal ? '' : `
    <div class="ccbreak" style="margin-top:10px">
      <div><span>Weekly transfer needed</span><b>${money(bp.weeklyNeeded)}</b></div>
      <div><span>On the table (your plan)</span><b>${money(bp.onTable)}</b></div>
      <div class="tot"><span>${bp.diff > 0.005 ? 'Transfer more' : bp.diff < -0.005 ? 'You can move less' : 'Right on plan'}</span>
        <b class="${bp.diff > 0.005 ? 'negtext' : 'goodtext'}">${Math.abs(bp.diff) < 0.005 ? '—' : money(Math.abs(bp.diff)) + '/wk' + lessLump}</b></div>
    </div>`;

  const staleNote = bp.hasBal && bp.staleDays >= 3
    ? `<div class="rollover" style="margin-top:8px">Balance is ${bp.staleDays} days old — re-enter it.</div>`
    : '';

  return `<div class="card">
    <div class="field"><label>Bills account balance<br><span class="muted" style="font-size:.8rem">${asOfLabel}</span></label>
      <input type="text" inputmode="decimal" value="${bp.hasBal ? fmtNum(bp.bal) : ''}" placeholder="0" data-billsbal></div>
    ${staleNote}
    ${bp.hasBal ? `<div class="week" style="margin-top:2px"><span class="muted">${bp.fridays} Friday${bp.fridays === 1 ? '' : 's'} left in ${bp.monthName}</span>${verdict}</div>
    <div class="ccbreak" style="margin-top:8px">
      ${upRows}
      <div class="tot"><span>Need by ${firstLabel}</span><b>${money(bp.upcoming)}</b></div>
    </div>
    ${compare}
    <div class="note" style="margin:8px 0 0">${bp.covered
      ? `Covered through ${bp.nextMonthName} 1st · ${money(bp.surplus)} to spare.`
      : `Move ${money(bp.weeklyNeeded)} each of the ${bp.fridays} Friday${bp.fridays === 1 ? '' : 's'} left to cover the ${money(bp.shortfall)} gap.`}</div>`
    : `<div class="note" style="margin:8px 0 0">Enter your bills-account balance to see the weekly transfer needed.</div>`}
  </div>`;
}


/**
 * Mark this payday's card payment finished, or re-open it, at any time.
 *
 * The question used to be asked once, right after logging a payment, and never
 * again — so changing your mind, or deciding later that you're done for the
 * week, had no way of being said.
 */
function weekDoneRow() {
  const s = S();
  const w = weekPaidState(s, store.txs, new Date(), s.weekStartDay ?? 5);
  const when = parseYmd(w.payday).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const marked = s.cc.paidThrough === w.payday;
  const more = s.cc.paidThrough === 'more:' + w.payday;

  if (marked || (w.paid && !more)) {
    return `<div class="note" style="margin-top:10px">${w.amount > 0.005
      ? `${money(w.amount)} paid towards the card for ${when}.`
      : `Marked done for ${when} without a payment.`}
      <button class="link" data-act="cc-week-more">I'll put more towards it</button></div>`;
  }
  return `<button class="btn block" data-act="cc-week-done" style="margin-top:8px">✓ Done paying the card for ${when}</button>
    ${more ? `<div class="note">You said more was coming this week${w.amount > 0.005 ? ` — ${money(w.amount)} so far` : ''}.</div>` : ''}`;
}

function payoffScheduleHTML(sch) {
  if (!sch.payments.length) return '';
  const thisFri = ymd(nextPayday(new Date(), S().weekStartDay ?? 5));
  const dated = (d) => parseYmd(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const label = (d) => d === thisFri ? `This ${dated(d)}` : dated(d);
  const rows = sch.payments.map((p) => {
    const tag = p.paid ? ' <span class="paidtag">✓ paid</span>' : (p.manual ? ' <span class="mantag">edited</span>' : '');
    const revert = p.manual ? `<button class="link" data-act="cc-pay-clear" data-id="${p.date}" title="Back to auto">↺</button>` : '';
    return `<div class="sch-row${p.paid ? ' paid' : ''}${p.manual ? ' man' : ''}"><span>${label(p.date)}${tag}</span>
      <span class="ccedit">${revert}<input class="ccinput" type="text" inputmode="decimal" value="${fmtNum(p.amount)}" data-cc-pay="${p.date}"></span></div>`;
  }).join('');
  const endD = sch.payoffDate || sch.end;
  const head = `<div class="week"><span class="muted">Payoff plan · ${sch.weeks} payment${sch.weeks === 1 ? '' : 's'}</span><b class="goodtext">clear by ${parseYmd(endD).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</b></div>`;
  return `<div class="plan">
    ${head}
    <div class="sched">${rows}</div></div>`;
}

function strategyPicker(cp, strategy) {
  const opt = (id, title, desc, disabled) => `<button class="strat ${strategy === id ? 'on' : ''}" data-act="cc-strategy" data-id="${id}" ${disabled ? 'disabled' : ''}>
    <span class="radio"></span><span class="st-body"><b>${title}</b><span class="muted">${desc}</span></span></button>`;
  const o = cp.options;
  const covered = cp.need <= 0;
  return `<div class="stratlist">
    ${opt('extra', 'Use leftover', covered ? `Your leftover covers ${money(cp.perWeek)}/wk — no change needed.` : `Leftover covers ${money(cp.extra)}/wk; you'd still be ${money(cp.need)} short.`)}
    ${opt('spend', 'Spend less', `Everyday ${money(cp.extra + cp.need)} → ${money(o.spend.newSpend)}/wk${o.spend.short > 0 ? `, still ${money(o.spend.short)} short` : ''}`)}
    ${opt('save', 'Save less', `Savings → ${money(o.save.newSave)}/wk${o.save.short > 0 ? `, still ${money(o.save.short)} short` : ''}`)}
    ${opt('split', 'Split both', `Everyday ${money(o.split.newSpend)} · savings ${money(o.split.newSave)}${
      o.split.short > 0 ? `, still ${money(o.split.short)} short` : o.split.over > 0 ? `, ${money(o.split.over)} extra off the card` : ''}`)}
    ${strategy === 'split' ? `<div class="splitpct">
      ${[['spend', 'Spending', o.split.pct.spend, o.split.newSpend, o.split.spendCut],
         ['save', 'Savings', o.split.pct.save, o.split.newSave, o.split.saveCut]]
        .map(([k, label, pct, left, cut]) => `<div class="sp-row"><label>${label}<div class="sp-s">${money(cut)} to the card</div></label>
          <input type="text" inputmode="decimal" value="${fmtNum(pct)}" data-splitpct="${k}" aria-label="${label} percent"><span>%</span>
          <input type="text" inputmode="decimal" value="${fmtNum(left)}" data-splitamt="${k}" aria-label="${label} left"></div>`).join('')}
      <div class="note">How much of each goes to the card. 100% leaves nothing; the box on the right is what you'd have left, and setting either one moves the other. Together they need to cover ${money(cp.need)} this week${o.split.short > 0 ? ` — still ${money(o.split.short)} short` : o.split.over > 0 ? `, and ${money(o.split.over)} over goes straight off the card` : ''}.</div>
    </div>` : ''}
    ${opt('stretch', 'Stretch payoff', `${money(cp.stretch.perWeek)}/wk over ${cp.stretch.weeks} weeks — pay off a bit later`)}
  </div>`;
}

function cardSection() {
  const s = S(), now = new Date();
  const cc = s.cc, auto = cc.mode !== 'manual';
  const det = cardDetail(s, store.txs);
  const cyc = cycleWindow(now);
  const wp = weekPlan(s, store.txs, now);
  const cp = wp.cp;          // the same figures the weekly plan is built from
  const strat = cc.strategy || 'extra';
  const diff = round((cc.manual || 0) - det.computed);

  // Does the log agree with the bank? Loose card charges count: the bank has
  // already billed them, they just aren't categorised yet.
  const rec = cardReconcile();
  const agrees = rec && Math.abs(rec.diff) < 0.01;
  const recStrip = !rec ? '' : `<div class="recstrip ${agrees ? 'ok' : ''}">
    <div class="rs-n">
      <div><b>${esc(rec.name || 'Your card')}</b> says <b>${money(rec.bank)}</b></div>
      <div class="rs-m">Your log ${money(rec.computed)}${rec.loose ? ` + ${money(rec.loose)} not finished` : ''} = ${money(rec.ours)}${
        rec.pend && Math.abs(Math.abs(rec.diff) - rec.pend) < 0.02
          ? `<br>The ${money(rec.pend)} gap is exactly what's pending — the bank hasn't posted it yet, so this will settle itself.`
          : ''}</div>
    </div>
    ${agrees ? '<b class="rs-ok">In step ✓</b>'
      : `<button class="btn tiny" data-act="cc-match">Off by ${money(Math.abs(rec.diff))} · Match</button>`}
  </div>`;
  const hasEdits = cc.planEdits && Object.keys(cc.planEdits).length > 0;

  const planBlock = wp.cardBalance > 0 ? `
    <div class="week"><span class="muted">Pay off ${money(cp.balance)}</span><b>${money(cp.perWeek)}/Friday</b></div>
    ${wp.owed - cp.balance > 0.005 ? `<div class="note" style="margin:2px 0 8px">You owe ${money(wp.owed)}. ${money(round(wp.owed - cp.balance))} of that is this week's budgeted spending, which your weekly budget already covers, so the paydown plan works on the rest.</div>` : ''}
    <div class="field" style="margin:8px 0 2px"><label>Pay off by<br><span class="muted" style="font-size:.8rem">${cc.payoffBy ? 'custom date' : 'default: end of this month'}</span></label>
      <input type="date" value="${cc.payoffBy || ''}" min="${today()}" data-cc="payoffBy"></div>
    <details class="collapse" ${openAttr('cc-strategy')}><summary>Where the extra comes from · <b>${{ extra: 'Use leftover', spend: 'Spend less', save: 'Save less', split: 'Split both', stretch: 'Stretch payoff' }[strat] || 'Use leftover'}</b></summary>
      ${strategyPicker(cp, strat)}</details>
    ${payoffScheduleHTML(wp.sch)}
    ${weekDoneRow()}
    ${hasEdits ? `<button class="btn block" data-act="cc-edits-reset" style="margin-top:8px">↺ Clear manual payment edits</button>` : ''}
    <hr class="sep">` : '';

  // One place to say what the card is, and the working underneath it. There used
  // to be five ways in here to move this number — a starting balance, an editable
  // "purchases since", a reset button, a mode toggle and Match — most of which
  // did the same thing by different routes.
  const setup = auto ? `
      <div class="field"><label>What the card actually is<br><span class="muted" style="font-size:.8rem">${det.asOf ? 'last set ' + shortDate(parseYmd(det.asOf)) : 'type it once and tracking takes over'}</span></label>
        <input type="text" inputmode="decimal" value="${fmtNum(cc.start || '')}" placeholder="0" data-cc="start"></div>
      <div class="ccbreak">
        <div><span>Set to</span><b>${money(det.start)}</b></div>
        <div><span>+ purchases since${det.adj ? ' <small>(incl. ' + money(det.adj) + ' matched)</small>' : ''}</span><b>${money(det.credit)}</b></div>
        <div><span>− card payments since</span><b>${money(det.paid)}</b></div>
        ${det.pendRet > 0.005 ? `<div><span>− planned returns</span><b>${money(det.pendRet)}</b></div>` : ''}
        <div class="tot"><span>Current balance</span><b>${money(det.computed)}</b></div></div>`
    : `
      <div class="field"><label>Your current balance<br><span class="muted" style="font-size:.8rem">tracking is off; this is the number used</span></label>
        <input type="text" inputmode="decimal" value="${fmtNum(cc.manual || '')}" placeholder="0" data-cc="manual"></div>
      <div class="ccbreak"><div class="tot"><span>What tracking would say</span><b>${money(det.computed)}</b></div>
        <div><span>Difference</span><b class="${diff ? 'negtext' : ''}">${diff === 0 ? 'matches' : (diff > 0 ? '+' : '−') + money(Math.abs(diff)).replace('-', '')}</b></div></div>`;

  const modeToggle = `<button class="link ccmode" data-act="cc-mode" data-id="${auto ? 'manual' : 'auto'}">${
    auto ? 'Turn off tracking and just type the balance' : 'Track it from your purchases instead'}</button>`;

  // Planned returns that will credit this card — shown right alongside the balance.
  const cardRets = (s.returns || []).filter((r) => (r.pay || 'credit') !== 'cash');
  const retTotal = round(cardRets.reduce((a, r) => a + Math.abs(r.amount || 0), 0));
  const retBlock = cardRets.length ? `
    <button class="retstrip" data-act="returns-view">
      <span class="rs-n">${cardRets.length} return${cardRets.length === 1 ? '' : 's'} still to make</span>
      <b>${money(retTotal)}</b><span class="rs-go">Review ›</span></button>` : '';

  return `<div class="card">
    ${recStrip}
    ${wp.cardBalance > 0 ? planBlock : '<div class="note" style="margin:0 0 8px">No balance to pay off right now.</div>'}
    ${retBlock}
    ${setup}
    ${modeToggle}
    <div class="note">Statement closes the ${ordinal(cyc.endDay)} · cycle ${shortDate(parseYmd(cyc.start))} – ${shortDate(parseYmd(cyc.end))}</div>
    <button class="btn block" data-act="log-xfer" data-id="card">+ Log a card payment</button></div>`;
}

// The monthly bills list (due on the 1st, then later), used in the Plan tab.
function billsListHTML(s) {
  const byDay = [...s.bills].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  const first = byDay.filter((x) => x.day === 1), later = byDay.filter((x) => x.day !== 1);
  const tot = (l) => round(l.reduce((a, x) => a + billAmount(x), 0));
  const billRow = (x) => `<div class="bill"><div class="d-badge">${x.day}</div><div class="body"><div class="n">${esc(x.name)}</div><div class="d">Auto-pays the ${ordinal(x.day)}${x.useAvg && x.history && x.history.length ? ' · 12-mo avg' : ''}</div></div><div class="amt">${money(billAmount(x))}</div></div>`;
  return `<div class="bill-sub">Due on the 1st · ${money(tot(first))}</div><div class="card">${first.map(billRow).join('') || '<div class="empty">Nothing due on the 1st.</div>'}</div>
    ${later.length ? `<div class="bill-sub">Later in the month · ${money(tot(later))}</div><div class="card">${later.map(billRow).join('')}</div>` : ''}
    `;
}

// Merge the (persisted) what-if draft over the computed recommendation.
// Spending is "live": its recommended value is what you've actually spent this week
// (so a reset snaps it to reality, freeing the rest of the budget to leftover).
const planNow = () => addDays(new Date(), (ui.weekOff || 0) * 7);
const planKey = () => weekStart(planNow(), S().weekStartDay ?? 5);

// The edits for the week on screen. Seeded from what was saved for that week, so
// stepping back shows the plan that week actually had, not this week's numbers.
function planEdits() {
  const k = planKey();
  if (!ui.planDraft[k]) ui.planDraft[k] = { ...((S().weekPlans || {})[k] || {}) };
  return ui.planDraft[k];
}

// Committed on change rather than per keystroke: this syncs to every device.
function commitPlan() {
  const k = planKey(), e = { ...planEdits() };
  const all = { ...(S().weekPlans || {}) };
  if (Object.keys(e).length) all[k] = e; else delete all[k];
  S().weekPlans = all;
  saveSettings(false);   // no redraw: this fires on blur, mid-tap
}

function planWeekLabel() {
  const a = parseYmd(weekStart(planNow(), S().weekStartDay ?? 5));
  const b = addDays(a, 6);
  const sameYear = a.getFullYear() === b.getFullYear();
  const f = (d, yr) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(yr ? { year: 'numeric' } : {}) });
  return `${f(a, !sameYear)} – ${f(b, true)}`;
}

function planWeekSub() {
  const o = ui.weekOff || 0;
  if (o === 0) return 'This week';
  if (o === -1) return 'Last week';
  if (o === 1) return 'Next week';
  return o < 0 ? `${-o} weeks ago` : `In ${o} weeks`;
}

function planValues() {
  const now = planNow();
  const wp = weekPlan(S(), store.txs, now);
  const rc = wp.rec, d = planEdits();
  const hasCard = wp.cardBalance > 0;
  const liveSpend = round(weekStats(S(), store.txs, now).spent);
  const live = ui.planLive !== false;
  let rec = live ? { ...rc, everyday: liveSpend } : rc;   // live = actual spent; off = budgeted
  // Only this week can show a live balance; a past or future week has none.
  const sa = S().spendAcct || {};
  const liveBal = (ui.weekOff === 0 && typeof sa.bal === 'number') ? round(sa.bal) : null;
  const payLive = ui.payLive !== false && liveBal != null;
  if (payLive) rec = { ...rec, pay: liveBal };
  const v = (f) => (d[f] !== undefined ? d[f] : rec[f]);
  const pay = v('pay'), bills = v('bills'), groceries = v('groceries'), everyday = v('everyday'), savings = v('savings'), extra = v('extra');
  const leftover = round(pay - bills - groceries - everyday - savings - extra);
  return { wp, hasCard, live, liveSpend, budgetSpend: rc.everyday, payLive, liveBal, spendName: sa.name,
    pay, bills, groceries, everyday, savings, extra, leftover };
}

function calloutHTML(leftover) {
  return leftover < 0
    ? `You're <b>${money(-leftover)}</b> short this week — trim a line above or change your card strategy.`
    : `You've got <b>${money(leftover)}</b> left over this week after everything.`;
}

// Live update of the derived cells while the user edits — no save, no full re-render.
function planRecalc() {
  const p = planValues();
  const cb = $('#plan-combined'); if (cb) cb.textContent = money(round(p.everyday + p.extra));
  const lo = $('#plan-leftover'); if (lo) lo.textContent = money(p.leftover);
  const loRow = $('#plan-leftover-row'); if (loRow) { loRow.classList.toggle('neg', p.leftover < 0); loRow.classList.toggle('total', p.leftover >= 0); }
  const co = $('#plan-callout'); if (co) { co.className = 'callout ' + (p.leftover < 0 ? 'bad' : 'good'); co.innerHTML = calloutHTML(p.leftover); }
  const rb = $('#plan-reset-btn'); if (rb) rb.hidden = false;
}

function planTab() {
  const s = S(), p = planValues(), wp = p.wp, st = wp.standard, rc = wp.rec, sch = wp.sch, bt = wp.bt;
  const edited = Object.keys(planEdits()).length;
  const stdVal = { pay: st.pay, bills: st.bills, groceries: st.groceries, everyday: st.everyday, savings: st.savings, extra: st.extra };
  const edq = (field) => planEdits()[field] !== undefined;    // has a what-if edit?
  // Always show the reset-to-recommended ↺ (consistent columns + resettable even with a custom value).
  const resetBtn = (field) => `<button class="cellx" data-act="plan-reset-field" data-id="${field}" title="Reset to recommended">↺</button>`;
  const erow = (label, field, extra = '') => `<div class="trow"><span>${label}</span><span class="b">${money(stdVal[field])}</span><span class="n"><input class="plancell" data-plan="${field}" type="text" inputmode="decimal" placeholder="0" value="${fmtNum(p[field] || '')}">${resetBtn(field)}<button class="cellx" data-act="plan-clear" data-id="${field}" title="Clear">✕</button></span></div>${extra}`;

  const goal = weeklyGoal(s);
  const goalRow = `<div class="goalrow ${goal != null ? 'on' : ''}">
    <div class="g-n">Weekly spending goal<div class="g-s">${goal != null
      ? 'Yours — overrides the card trim and every strategy'
      : `Working it out for you · ${money(wp.rec.everyday)} this week`}</div></div>
    <input type="text" inputmode="decimal" placeholder="auto" value="${goal != null ? fmtNum(goal) : ''}" data-weeklygoal>
    ${goal != null ? '<button class="cellx" data-act="goal-clear" title="Back to automatic">↺</button>' : ''}</div>`;

  const weekNav = `<div class="weeknav">
    <button data-act="plan-week" data-id="-1" aria-label="Previous week">‹</button>
    <div class="wk"><div class="wk-r">${planWeekLabel()}</div><div class="wk-s">${planWeekSub()}</div></div>
    <button data-act="plan-week" data-id="1" aria-label="Next week">›</button></div>
    ${ui.weekOff ? '<button class="btn block" data-act="plan-week" data-id="0" style="margin:0 0 12px">Back to this week</button>' : ''}`;

  const stratLabel = { extra: 'from leftover', spend: 'spending less', save: 'saving less', split: 'splitting the difference', stretch: 'stretching the payoff', none: '' }[wp.strategy];
  // Show what the card paydown is actually made of.
  const cuts = [
    wp.spendCut > 0.005 ? `${money(wp.spendCut)} less spending` : '',
    wp.saveCut > 0.005 ? `${money(wp.saveCut)} less saving` : '',
    wp.fromLeftover > 0.005 ? `${money(wp.fromLeftover)} of your leftover` : ''
  ].filter(Boolean).join(' + ');
  const cardNote = wp.cardBalance > 0
    ? `Card paydown <b>${money(rc.extra)}</b>${cuts ? ` = ${cuts}` : ' from your leftover'} · balance ${money(sch.balance)}`
    : '';

  // Indented editable sub-row (used inside the merged Spending + card group).
  // `std` lets us override the Standard-week value (a perfect standard week has no card debt).
  const subrow = (label, field, std = stdVal[field]) => `<div class="trow sub"><span>↳ ${label}</span><span class="b">${money(std)}</span><span class="n"><input class="plancell" data-plan="${field}" type="text" inputmode="decimal" placeholder="0" value="${fmtNum(p[field] || '')}">${resetBtn(field)}<button class="cellx" data-act="plan-clear" data-id="${field}" title="Clear">✕</button></span></div>`;

  // Live toggle: Spending shows what you've actually spent this week (live) or your
  // planned budget. Tapping flips between the two; the Recommended/reset follows it.
  const liveChip = `<div class="rowact"><button class="chipbtn ${p.live ? 'on' : ''}" data-act="plan-live">${p.live ? `⚡ Live · ${money(p.liveSpend)} spent — tap for budget` : `📋 Budget · ${money(p.budgetSpend)} — tap for live`}</button></div>`;

  // Spending + credit card: one pool, with the spend and card-paydown pieces inside it.
  // A perfect standard week stays within the spending budget and carries no card
  // balance, so the card-paydown Standard column is 0 (the spare shows up in Leftover).
  const spendCardGroup = p.hasCard
    ? `<div class="trow grouphdr"><span>Spending + credit card</span><span class="b">${money(st.everyday)}</span><span class="n" id="plan-combined">${money(p.everyday + p.extra)}</span></div>
       ${subrow('Spending', 'everyday')}
       ${liveChip}
       ${subrow('Card paydown', 'extra', 0)}`
    : `${erow('Everyday spending', 'everyday', liveChip)}${erow('Extra', 'extra')}`;

  // Where the trimmed spending number actually comes from.
  const pw = weekStats(s, store.txs);
  const trimNote = pw.trimmedByCard > 0
    ? `<p class="note">Weekly ${money(pw.planBudget)} − ${money(pw.trimmedByCard)} freed for the card = <b>${money(pw.baseBudget)}</b> to spend.</p>`
    : '';
  const plannerBody = `
    ${weekNav}
    ${goalRow}
    <div class="card plan-table">
      <div class="trow head"><span></span><span class="b">Standard</span><span class="n">Recommended</span></div>
      ${erow('Paycheck', 'pay', p.liveBal == null ? '' : `<div class="rowact"><button class="chipbtn ${p.payLive ? 'on' : ''}" data-act="pay-live">${
        p.payLive ? `🏦 ${esc(p.spendName || 'Spending')} · ${money(p.liveBal)} — tap for your paycheck`
                  : `📋 Paycheck · ${money(st.pay)} — tap for the account balance`}</button></div>`)}
      ${erow('To bills account', 'bills', bt.hasBal ? `<div class="rowact"><button class="chipbtn" data-act="plan-bills-needed" data-id="${bt.weeklyNeeded}">Use needed · ${money(bt.weeklyNeeded)}</button></div>` : '')}
      ${erow('Groceries', 'groceries')}
      ${spendCardGroup}
      ${erow('Savings', 'savings')}
      <div class="trow ${p.leftover < 0 ? 'neg' : 'total'}" id="plan-leftover-row"><span>Leftover / extra</span><span class="b">${money(p.hasCard ? st.extra : 0)}</span><span class="n" id="plan-leftover">${money(p.leftover)}</span></div>
    </div>
    <div class="callout ${p.leftover < 0 ? 'bad' : 'good'}" id="plan-callout">${calloutHTML(p.leftover)}</div>
    <button class="btn block" id="plan-reset-btn" data-act="plan-reset" ${edited ? '' : 'hidden'}>↺ Reset to recommended</button>
    ${trimNote}
    ${cardNote ? `<p class="note">${cardNote}</p>` : ''}`;

  // Each area is a collapsible section. The weekly planner is open by default; the
  // rest start collapsed. (Native <details>, so open/closed is remembered per tap.)
  const sec = (title, body, open = false) => `<details class="psec" ${openAttr('psec-' + title.replace(/[^a-z]/gi, '').slice(0, 20), open)}><summary><span class="psec-t">${title}</span><span class="psec-caret">›</span></summary><div class="psec-body">${body}</div></details>`;
  const billsAcctBody = billsAcctCard(s) + `<button class="btn block" data-act="log-xfer" data-id="bills" style="margin-top:8px">+ Log a transfer to the bills account</button>`;
  const baTag = bt.hasBal ? (bt.covered ? ' · covered' : ' · short ' + money(bt.shortfall)) : '';

  return `${header('Plan', false)}
    ${sec("This week's plan", plannerBody, true)}
    ${sec(`Credit card · ${money(cardBalance(s, store.txs))}`, cardSection())}
    ${sec(`Bills account${baTag}`, billsAcctBody)}
    ${sec(`Monthly bills · ${money(billsTotal(s))}`, billsListHTML(s))}`;
}

// ---------- Finance: loan payoff planner + investment what-if ----------
const loanById = (id) => S().finance.loans.find((l) => l.id === id);

function finance() {
  const now = new Date();
  const loans = S().finance.loans.filter((l) => !l.deleted);
  const stats = loans.map((l) => [l, loanStats(l, now)]);
  const active = stats.filter(([, st]) => !st.paidOff);
  const paidCount = stats.length - active.length;
  const totalDebt = round(active.reduce((a, [, st]) => a + st.balance, 0));
  const totalInterest = round(active.reduce((a, [, st]) => a + st.interestRemaining, 0));
  const totalSaved = round(active.reduce((a, [, st]) => a + Math.max(0, st.interestSaved), 0));
  return `${header('Finance', false)}
    <div class="finhero">
      <div class="fh-label">Total debt</div>
      <div class="fh-big">${money(totalDebt)}</div>
      <div class="fh-sub">${active.length} active loan${active.length === 1 ? '' : 's'}${paidCount ? ` · ${paidCount} paid off` : ''}</div>
      <div class="fh-grid">
        <div><span>Interest left</span><b>${money(totalInterest)}</b></div>
        <div><span>Saving with extra</span><b class="goodtext">${totalSaved > 0 ? money(totalSaved) : '—'}</b></div>
      </div>
    </div>
    <h2>Loans</h2>
    ${stats.map(([l, st]) => financeLoanCard(l, st)).join('')}
    <button class="btn block" data-act="loan-add" style="margin-top:4px">+ Add a loan</button>
    ${financeInvest(now)}`;
}

function financeLoanCard(loan, st) {
  const open = ui.openLoan === loan.id, paid = st.paidOff;
  const head = `<button class="loan-head" data-act="loan-toggle" data-id="${loan.id}">
    <div class="emoji">${loan.emoji || '💵'}</div>
    <div class="body">
      <div class="row"><span class="n">${esc(loan.name)}</span><span class="a">${paid ? '<b class="goodtext">Paid off</b>' : money(st.balance)}</span></div>
      <div class="bar"><i style="width:${st.paidPct}%"></i></div>
      <div class="du-note">${paid ? `Paid off${loan.lender ? ` · ${esc(loan.lender)}` : ''}` : `${Math.round(st.paidPct)}% paid · ${moYr(st.payoff)}${loan.lender ? ` · ${esc(loan.lender)}` : ''}`}</div>
    </div><span class="chev ${open ? 'down' : ''}">›</span></button>`;
  if (!open) return `<div class="card loan ${paid ? 'done' : ''}">${head}</div>`;

  const extra = loan.extra || 0;
  // Schedule: current month at the top; earlier months collapse into a dropdown
  // (still editable there, e.g. to mark a month you didn't actually pay extra).
  // With an "extra every month" scenario, each upcoming month shows the proposed
  // extra as a PENDING suggestion with ✓ (lock it) / ✕ (skip) / type a custom amount.
  // Locked months are stored per-date, so changing the scenario never touches them.
  const mStart = ymd(new Date()).slice(0, 7) + '-01';
  const pivot = (() => { const i = st.rows.findIndex((r) => r.date >= mStart); return i < 0 ? st.rows.length : i; })();
  const pastRows = st.rows.slice(Math.max(0, pivot - 12), pivot);
  const futRows = st.rows.slice(pivot, pivot + 18);
  const moreFut = st.rows.length - (pivot + 18);
  const exCell = (r) => {
    const locked = loan.extras[r.date] != null;
    const pending = r.future && !locked && extra > 0;
    const val = locked ? fmtNum(loan.extras[r.date]) : (pending ? fmtNum(extra) : '');
    const inp = `<input class="fin-num${pending ? ' pending' : ''}" type="text" inputmode="decimal" placeholder="0" value="${val}" data-loanpay="${loan.id}|${r.date}">`;
    if (pending) return `<span class="exwrap">${inp}<button class="exbtn ok" data-act="loan-lock" data-id="${loan.id}|${r.date}" title="Confirm this month">✓</button><button class="exbtn no" data-act="loan-skip" data-id="${loan.id}|${r.date}" title="No extra this month">✕</button></span>`;
    if (r.future && locked) return `<span class="exwrap">${inp}<button class="exbtn rev" data-act="loan-unlock" data-id="${loan.id}|${r.date}" title="Back to the scenario">↺</button></span>`;
    return inp;
  };
  const schRow = (r) => `<div class="loan-row${r.future ? '' : ' past'}${(r.future && loan.extras[r.date] != null) ? ' locked' : ''}">
      <span class="d">${moDay(r.date)}</span><span class="p">${money(r.payment)}</span>
      <span class="x">${exCell(r)}</span>
      <span class="bb">${money(r.balance)}</span></div>`;
  const pastWrap = pastRows.length ? `<details class="loan-pastwrap"><summary>↕ Show ${pastRows.length} earlier payment${pastRows.length === 1 ? '' : 's'}</summary>${pastRows.map(schRow).join('')}</details>` : '';
  const schRows = pastWrap + futRows.map(schRow).join('');
  const savedBox = extra > 0 && st.monthsSaved > 0
    ? `<div class="savebox"><div><span>Interest saved</span><b class="goodtext">${money(st.interestSaved)}</b></div><div><span>Sooner</span><b>${st.monthsSaved} pmt${st.monthsSaved === 1 ? '' : 's'}</b></div><div><span>vs. minimum</span><b>${moYr(st.basePayoff)}</b></div></div>`
    : `<div class="du-note">Minimum pace · debt-free ${moYr(st.basePayoff)} · ${money(st.baseInterest)} interest</div>`;

  return `<div class="card loan open">${head}
    <div class="loan-body">
      <div class="loan-stats">
        <div><span>Balance</span><b>${money(st.balance)}</b></div>
        <div><span>Rate</span><b>${(loan.rate * 100).toFixed(2)}%</b></div>
        <div><span>Payment</span><b>${money(loan.payment)}</b></div>
      </div>
      <div class="finfield"><label>Extra per month</label>
        <span class="finwrap"><input class="fin-num" type="text" inputmode="decimal" placeholder="0" value="${fmtNum(extra || '')}" data-loanextra="${loan.id}">${extra > 0 ? `<button class="cellx" data-act="loan-extra-reset" data-id="${loan.id}" title="Clear">✕</button>` : ''}</span></div>
      ${savedBox}
      <div class="loan-summary">
        <div><span>Debt-free</span><b>${moYr(st.payoff)}</b></div>
        <div><span>Payments left</span><b>${st.months}</b></div>
        <div><span>Interest left</span><b>${money(st.interestRemaining)}</b></div>
      </div>
      <div class="loan-schhdr">Schedule</div>
      <div class="loan-sch">
        <div class="loan-row head"><span class="d">Due</span><span class="p">Payment</span><span class="x">Extra</span><span class="bb">Balance</span></div>
        ${schRows}
      </div>
      ${moreFut > 0 ? `<p class="note">+ ${moreFut} more payment${moreFut === 1 ? '' : 's'} through ${moYr(st.payoff)}.</p>` : ''}
      <div class="finfield" style="margin-top:12px"><label>Balance correction</label>
        <input class="fin-num" type="text" inputmode="decimal" value="${fmtNum(round(st.balance))}" data-loanbal="${loan.id}"></div>
      <button class="btn block danger" data-act="loan-delete" data-id="${loan.id}" style="margin-top:6px">🗑 Delete this loan</button>
    </div></div>`;
}

function financeInvest(now) {
  const iv = S().finance.invest, res = investFV(iv.monthly, iv.years, iv.rate);
  const presets = [['401(k)', 0.07], ['Roth IRA', 0.07], ['HYSA', 0.04]];
  const chips = presets.map(([n, r]) => `<button class="chip ${Math.abs((iv.rate || 0) - r) < 1e-9 ? 'on' : ''}" data-act="inv-preset" data-id="${r}">${n} · ${(r * 100).toFixed(0)}%</button>`).join('');
  return `<h2>Invest instead?</h2>
    <div class="card">
      <div class="chips" style="margin:0 -18px 10px;padding-inline:18px">${chips}</div>
      <div class="finfield"><label>Monthly contribution</label><input class="fin-num" type="text" inputmode="decimal" value="${fmtNum(iv.monthly)}" data-inv="monthly"></div>
      <div class="finrow2">
        <div class="finfield"><label>Years</label><input class="fin-num" type="text" inputmode="decimal" value="${fmtNum(iv.years)}" data-inv="years"></div>
        <div class="finfield"><label>Return %</label><input class="fin-num" type="text" inputmode="decimal" value="${fmtNum(round(iv.rate * 100))}" data-inv="rate"></div>
      </div>
      <div class="invout">
        <div class="big">${money(res.fv)}</div>
        <div class="note">after ${iv.years} year${iv.years === 1 ? '' : 's'} · ${money(res.contributed)} in · <span class="goodtext">${money(res.growth)} growth</span></div>
      </div>
    </div>`;
}

function activityList() {
  let list = (ui.all ? [...store.txs] : monthTxs()).sort(sortTx);
  if (ui.filter === 'income') list = list.filter((t) => t.type === 'income');
  else if (ui.filter === 'transfer') list = list.filter((t) => t.type === 'transfer');
  else if (ui.filter !== 'all') list = list.filter((t) => t.type === 'expense' && t.category === ui.filter);
  const q = ui.q.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.note + ' ' + (cat(t.category)?.name || t.category)).toLowerCase().includes(q) || String(t.amount).includes(q));
  const spent = round(list.filter((t) => t.type === 'expense').reduce((a, t) => a + txNet(t), 0));
  if (!list.length) return '<div class="card empty">Nothing here.</div>';
  // Flat list in the order entered (newest first), each row shows its own date.
  return `<p class="note">${list.length} item${list.length > 1 ? 's' : ''} · ${money(spent)}</p>
    <div class="card" style="padding:6px 18px">${list.map(txRow).join('')}</div>`;
}

// The activity log, folded into the Home tab (search + filters + full list).
function activityBlock() {
  const chips = [['all', 'All'], ...S().categories.map((c) => [c.id, c.emoji + ' ' + c.name]), ['income', '💰 Income'], ['transfer', '🏦 Bills/Savings/Card']]
    .map(([id, l]) => `<button class="chip ${ui.filter === id ? 'on' : ''}" data-act="filter" data-id="${esc(id)}">${esc(l)}</button>`).join('');
  return `<div class="acthead"><h2>Activity</h2>${ui.all ? '<span class="muted">Whole history</span>' : ''}</div>
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
      <div class="field"><label>Weekly pay<br><span class="muted" style="font-size:.8rem">= ${money(monthlyIncome(s))} a month</span></label><input type="text" inputmode="decimal" value="${fmtNum(s.weeklyPay)}" data-set="weeklyPay"></div>
      <div class="prow"><span>− Bills account <span class="muted">(total ÷ 4)</span></span><b>${money(sw.bills)}</b></div>
      <div class="prow"><span>− Groceries <span class="muted">(budget ÷ 4)</span></span><b>${money(sw.groceries)}</b></div>
      <div class="field"><label>− Everyday spending</label><input type="text" inputmode="decimal" value="${fmtNum(s.weeklyBudget)}" data-set="weeklyBudget"></div>
      <div class="prow total"><span>Leftover to divide</span><b id="pool" class="${poolBase < 0 ? 'negtext' : ''}">${money(poolBase)}</b></div>
      <div class="splitrow"><div class="splitlabel"><span>🐷 Savings</span><b id="sav-amt">${money(sw.savings)}</b></div>
        <input type="range" id="sav-slider" min="0" max="${Math.max(5, Math.ceil(poolBase))}" step="5" value="${sw.savings}"></div>
      <div class="prow"><span>💳 Extra spending <span class="muted">(auto)</span></span><b id="extra-amt" class="${sw.extra < 0 ? 'negtext' : ''}">${money(sw.extra)}</b></div>
      ${poolBase < 0 ? `<div class="err">Your pay doesn't cover bills + groceries + everyday spending — nothing left to save.</div>` : ''}
      <div class="note">Sets your standard week.</div></div>
    <h2>Week</h2><div class="card">
      <div class="field"><label>Week starts on<br><span class="muted" style="font-size:.8rem">When the weekly budget resets</span></label>
        <select data-set="weekStartDay">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${(+s.weekStartDay) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      </div>
    <h2>Category budgets (monthly)</h2><div class="card">${s.categories.map((c, i) => {
      const avgRow = c.id === 'gas' ? `<label class="muted avgline" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.useAvg ? 'checked' : ''} data-catavg="${i}"> use 12-month average${c.useAvg ? ` (${money(categoryAvg(store.txs, c.id))}) <button class="link" data-act="catavg-view" data-id="${esc(c.id)}">see breakdown ›</button>` : ''}</label>` : '';
      return `<div class="field weekly"><span class="emoji" style="width:36px;height:36px">${c.emoji}</span><label>${esc(c.name)}</label>
        <input type="text" inputmode="decimal" value="${fmtNum(c.useAvg ? categoryAvg(store.txs, c.id) : c.budget)}" ${c.useAvg ? 'disabled title="Using 12-month average"' : ''} data-cat="${i}" data-field="budget">
        <button class="x" data-act="delcat" data-i="${i}" aria-label="Delete">✕</button>
        <label class="muted" style="flex-basis:100%;font-size:.8rem;padding-left:46px"><input type="checkbox" ${c.weekly ? 'checked' : ''} data-cat="${i}" data-field="weekly"> counts toward weekly everyday budget</label>
        ${avgRow}</div>`;
    }).join('')}
      <button class="btn block" data-act="addcat">+ Add category</button></div>
    <h2>Bills &amp; due days</h2><div class="card">
      <div class="field bill-head"><span style="flex:1">Bill</span><span style="width:84px;text-align:right">Amount</span><span style="width:46px;text-align:center">Day</span><span style="width:64px"></span></div>
      ${s.bills.map((b, i) => `
      <div class="field"><input class="name" type="text" value="${esc(b.name)}" data-bill="${i}" data-field="name">
        <input type="text" inputmode="decimal" value="${fmtNum(b.useAvg ? billAmount(b) : b.amount)}" ${b.useAvg ? 'disabled title="Using 12-month average"' : ''} data-bill="${i}" data-field="amount" style="width:84px">
        <input type="number" inputmode="numeric" min="1" max="31" value="${b.day}" data-bill="${i}" data-field="day" style="width:46px;text-align:center">
        <button class="btn mini ${b.useAvg ? 'on' : ''}" data-act="billedit" data-i="${i}" aria-label="Edit history">📝</button>
        <button class="x" data-act="delbill" data-i="${i}" aria-label="Delete">✕</button></div>`).join('')}
      <button class="btn block" data-act="addbill">+ Add bill</button>
      <div class="note">Due on the 1st · ${money(firstTotal(s))} of ${money(billsTotal(s))} total</div></div>
    <h2>Sync &amp; data</h2><div class="card"><div class="field"><label>${syncText}</label></div>
      ${store.syncError ? `<div class="err">${esc(store.syncError)}</div>` : ''}
      <button class="btn block" data-act="reimport">Re-import spreadsheet history</button></div>
    ${bankBlock()}
    `;
}

// ---------- Banking (Plaid) ----------
// Strictly opt-in. The bank.js module, the Firebase Auth SDK and Plaid Link are
// all fetched on demand, so until you tap in here the app loads and behaves
// exactly as it always has. Imports wait in a review queue: nothing reaches the
// weekly budget or the card plan until you give it a category and accept it.
let bank = null;
const bankUI = { on: false, booted: false, busy: '', user: undefined, items: [], inbox: [], pick: {}, billq: [], billpick: {}, err: '', progress: [] };

// What each linked bank is called, card first — that's the order they're asked
// in, so the list reads top to bottom as it works.
function syncQueue() {
  return bankUI.items.slice()
    .map((it) => ({
      itemId: it.itemId,
      card: Object.values(it.roles || {}).includes('card'),
      name: (it.accounts || []).map((a) => a.name).join(', ') || 'Bank',
    }))
    .sort((a, b) => (a.card ? 0 : 1) - (b.card ? 0 : 1));
}

// Re-draw whatever is on screen that shows progress.
function progressTick() {
  render();
  if (pendingOpen) drawPending();
}

// Ask each bank in turn so the app can name the one it's waiting on.
async function syncAll(b) {
  bankUI.progress = syncQueue().map((q) => ({ ...q, state: 'waiting', added: 0 }));
  progressTick();
  let total = 0;
  for (const step of bankUI.progress) {
    step.state = 'working';
    progressTick();
    try {
      const r = await b.syncNow(step.itemId);
      step.added = r.added || 0;
      step.state = (r.failed && r.failed.length) ? 'failed' : 'done';
      total += step.added;
      // Show what arrived from this bank before asking the next one.
      await bankLoad(false);
    } catch (e) {
      step.state = 'failed';
      step.err = (e && e.message) || String(e);
    }
    progressTick();
  }
  setTimeout(() => { bankUI.progress = []; progressTick(); }, 2500);
  return total;
}

// The strip that shows it working, used on the loose-logs sheet and in Settings.
function progressHTML() {
  if (!bankUI.progress.length) return '';
  const icon = { waiting: '<span class="pdot"></span>', working: '<span class="spin"></span>',
                 done: '<span class="pok">✓</span>', failed: '<span class="pbad">!</span>' };
  return `<div class="syncbox">${bankUI.progress.map((p) => `<div class="syncrow">
    ${icon[p.state]}<span class="sr-n">${esc(p.name)}</span>
    <span class="sr-s">${p.state === 'working' ? 'checking…'
      : p.state === 'waiting' ? 'queued'
      : p.state === 'failed' ? (p.err ? 'failed' : 'failed')
      : p.added ? `${p.added} new` : 'up to date'}</span></div>`).join('')}</div>`;
}
const SYNC_EVERY = 45 * 1000;   // every open; the guard is only against a reload loop

// Once a bank is linked this runs by itself: the panel is already open and new
// activity is pulled in the background. Kicked off from render() so it waits for
// settings to arrive from the cloud, and never blocks the first paint.
async function bankAuto() {
  try {
    await bankLoad(true);
    if (!bankUI.user || !bankUI.items.length) return render();
    if (Date.now() - (+S().bankSyncAt || 0) < SYNC_EVERY) return render();
    bankUI.busy = 'sync';
    const b = await bankMod();
    const added = await syncAll(b);
    S().bankSyncAt = Date.now(); saveSettings();
    if (added) toast(`${added} new from your bank`);
  } catch (e) {
    // Never let a banking problem disturb the rest of the app.
    bankUI.err = (e && e.message) || String(e);
  }
  render();
}
const bankMod = async () => (bank ||= await import('./bank.js?v=97'));

async function bankRun(key, fn) {
  bankUI.busy = key; bankUI.err = ''; render();
  try { await fn(); } catch (e) { bankUI.err = (e && e.message) || String(e); }
  bankUI.busy = ''; render();
  if (bankUI.err) toast(bankUI.err);
}

// Re-reads everything: who you are, what's linked, what's waiting.
async function bankLoad(resume) {
  const b = await bankMod();
  if (resume) { const u = await b.resumeSignIn(); if (u) toast('Signed in'); }
  bankUI.user = await b.user();
  if (!bankUI.user) { bankUI.items = []; bankUI.inbox = []; return; }
  if (resume) {
    const r = await b.resumeOAuth();
    if (r && r.linked) { const n = (r.linked.accounts || []).length; toast(`Linked ${n} account${n === 1 ? '' : 's'}`); }
  }
  b.preload();   // have Link's script ready before the tap, not after
  const [res, box] = await Promise.all([b.listItems(), b.inbox()]);
  bankUI.items = res.items || [];
  if (bankUI.items.length && !S().bankOn) { S().bankOn = true; saveSettings(); }

  // Banks linked before webhooks existed need pointing at it once. New ones are
  // already pointed there by the link token.
  if (bankUI.items.length && !S().webhooksAt) {
    try {
      const r = await b.registerWebhooks();
      S().webhooksAt = Date.now(); saveSettings(false);
      if (r.registered) console.log('webhooks registered for', r.registered, 'bank(s)');
    } catch (e) { console.warn('webhook registration failed', e); }
  }

  // Card charges become loose logs by themselves — you turn each one into a real
  // transaction when you're ready, and nothing counts until you do. A refund or a
  // card payment isn't a purchase, so it goes to the review queue instead.
  const box2 = await autoFile(b, box);
  const map = S().txMatch || {};
  const known = (it) => !!map[billKey(it.note)] || looksLikeIncome(it);
  // A card-routed account sends its purchases to loose logs; anything with a
  // standing rule, and anything Plaid itself calls income, is handled instead.
  const loose = box2.filter((it) => it.route === 'card' && (it.type === 'expense' || known(it)));
  const billsIn = box2.filter((it) => it.route === 'bills' && it.type === 'expense');
  bankUI.inbox = box2.filter((it) => it.route !== 'bills'
    && !(it.route === 'card' && (it.type === 'expense' || known(it))));
  if (loose.length) await adoptCardCharges(b, loose);
  bankUI.billq = billsIn.length ? await adoptBillCharges(b, billsIn) : [];
  bankUI.billq.forEach((it) => {
    const k = billKey(it.note) || it.id;
    if (bankUI.billpick[k] === undefined) bankUI.billpick[k] = guessBill(it.note);
  });
  bankBalanceSync();

  bankUI.inbox.forEach((it) => {
    if (bankUI.pick[it.id] !== undefined) return;
    const g = b.suggest(it, S().categories);
    bankUI.pick[it.id] = g === 'income' ? 'i' : g === 'bills' ? 't:bills' : g ? 'e:' + g : '';
  });
}

/**
 * A standing rule for one merchant, learned the first time you file it.
 *   'i'        paycheque or other money in
 *   't:<id>'   a transfer: bills, savings, card
 *   '__skip'   never worth recording
 * Purchases deliberately never make a rule — those are yours to categorise.
 */
function applyTxRule(rule, it) {
  if (!rule || rule === '__skip') return false;
  const base = { amount: it.amount, date: it.date, note: it.note || '' };
  if (rule === 'i') { addTx({ ...base, type: 'income', category: 'income', src: 'bank' }); return true; }
  if (rule.startsWith('t:')) { addTx({ ...base, type: 'transfer', category: rule.slice(2), src: 'bank' }); return true; }
  if (rule.startsWith('e:')) { addTx({ ...base, type: 'expense', category: rule.slice(2), pay: it.pay || 'credit', src: 'bank' }); return true; }
  return false;
}

// A paycheque looks like a paycheque. Money arriving that Plaid itself calls
// income needs no rule to be recognised.
const sameMoney = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 0.01;
const nearDate = (a, b, days) => Math.abs(parseYmd(a) - parseYmd(b)) <= days * 86400000;

// Did you already log this yourself, before the bank caught up? Same money,
// within a few days, and going the same way. A transfer can match either
// direction, since one movement shows up as out of one account and into another.
function matchExisting(it, used) {
  return store.txs.find((t) => {
    if (t.plaidId || used.has(t.id)) return false;
    if (!sameMoney(t.amount, it.amount) || !nearDate(t.date, it.date, 4)) return false;
    if (t.type === 'transfer') return true;
    return (t.type === 'income') === (it.type === 'income');
  });
}

/**
 * Handles what the app can work out for itself, before anything reaches a queue.
 *
 * Money ARRIVING is the clearest signal there is: onto the card it's a payment,
 * into the bills account it's a bills transfer. The matching withdrawal is
 * dropped with it, so one movement between two of your own accounts is recorded
 * once rather than twice.
 *
 * Returns what's left for the normal routing.
 */
async function autoFile(b, box) {
  const used = new Set(), handled = [], rest = [];

  for (const it of box) {
    const hit = matchExisting(it, used);
    if (hit) {
      used.add(hit.id);
      updateTx(hit.id, { plaidId: it.plaidId || it.id });
      handled.push(it);
    } else rest.push(it);
  }
  const alreadyLogged = handled.length;

  const arrivals = [], others = [];
  for (const it of rest) {
    if (it.type !== 'income') { others.push(it); continue; }
    if (it.pay === 'credit') arrivals.push({ it, cat: 'card' });
    else if (it.route === 'bills') arrivals.push({ it, cat: 'bills' });
    else others.push(it);
  }

  let filed = 0;
  for (const a of arrivals) {
    addTx({ type: 'transfer', category: a.cat, amount: a.it.amount, date: a.it.date, note: a.it.note || '', src: 'bank' });
    handled.push(a.it);
    filed++;
    const i = others.findIndex((o) => o.type === 'expense' && sameMoney(o.amount, a.it.amount) && nearDate(o.date, a.it.date, 3));
    if (i >= 0) handled.push(others.splice(i, 1)[0]);
  }

  if (handled.length) await Promise.all(handled.map((it) => b.dropInbox(it.id).catch(() => {})));
  if (alreadyLogged) toast(`${alreadyLogged} already logged by you`);
  if (filed) toast(`${filed} transfer${filed === 1 ? '' : 's'} recognised`);
  return others;
}

const payerKeys = () => (S().incomePayers || []).map(billKey).filter(Boolean);
const fromPayer = (note) => { const k = billKey(note); return !!k && payerKeys().some((p) => k.includes(p) || p.includes(k)); };

// Money in that Plaid calls income, or that comes from somewhere you've said
// pays you. The payer match is a contains, since a deposit's description
// carries batch numbers and dates that change every time.
const looksLikeIncome = (it) => it.type === 'income'
  && (['INCOME', 'TRANSFER_IN'].includes(String(it.plaidCategory || '')) || fromPayer(it.note));

// srcId keeps a charge from arriving twice if a sync overlaps.
async function adoptCardCharges(b, loose) {
  const have = new Set((S().pending || []).map((p) => p.srcId).filter(Boolean));
  const fresh = loose.filter((it) => !have.has(it.id));
  const map = S().txMatch || {};

  // Anything with a standing rule is filed now; the rest become loose logs.
  const add = [];
  let filed = 0;
  for (const it of fresh) {
    const rule = map[billKey(it.note)] || (fromPayer(it.note) && it.type === 'income' ? 'i' : null)
      || (looksLikeIncome(it) ? 'i' : null);
    if (!rule) { add.push(it); continue; }
    if (applyTxRule(rule, it)) filed++;
  }
  if (add.length) {
    S().pending = [...(S().pending || []), ...add.map((it) => ({
      id: uid(), srcId: it.id, amount: it.amount, date: it.date, note: it.note || '',
      source: 'plaid', account: it.account || null, pend: !!it.pending
    }))];
  }
  if (add.length || filed) saveSettings();
  if (filed) toast(`Filed ${filed} by rule`);
  // Clear them from the inbox either way, so a retry can't duplicate them.
  await Promise.all(loose.map((it) => b.dropInbox(it.id).catch(() => {})));
  if (add.length) toast(`${add.length} card charge${add.length === 1 ? '' : 's'} to finish`);
}

/**
 * What the bank would call this account's balance.
 *
 * Pending cuts both ways: a pending charge on a card ADDS to what you owe, a
 * pending debit on a checking account TAKES AWAY from what you have. Treating
 * them the same puts a chequing balance out by double the pending.
 */
function bankBalance(v, role) {
  const cur = +v.current || 0, pend = +v.pending || 0;
  if (role === 'card' || v.type === 'credit') return round(cur + pend);
  // Depository: the bank's own headline figure already nets pending off.
  if (typeof v.available === 'number') return round(v.available);
  return round(cur - pend);
}

// Mirrors what the banks actually say: the bills balance stands in for typing it
// by hand, and the card balance is kept beside the log so the two can be compared
// rather than silently overwriting what you've recorded.
function bankBalanceSync() {
  // The ROLE says where an account's transactions go. The TYPE says what the
  // account is. A chequing account routed to loose logs is still chequing, and
  // its balance has no business being added to what you owe on a card.
  let bills = null, spend = null, spendName = null;
  let card = null, cardPend = null, cardName = null;
  bankUI.items.forEach((it) => Object.entries(it.roles || {}).forEach(([acct, role]) => {
    const v = (it.balances || {})[acct];
    if (!v || typeof v.current !== 'number' || role === 'off') return;
    if (v.type === 'credit') {
      card = round((card || 0) + (+v.current || 0));
      cardPend = round((cardPend || 0) + (+v.pending || 0));
      cardName = v.name || cardName;
    } else if (role === 'bills') {
      bills = round((bills || 0) + bankBalance(v, role));
    } else {
      // Everything else you spend out of: the day-to-day account.
      spend = round((spend || 0) + bankBalance(v, role));
      spendName = v.name || spendName;
    }
  }));
  let dirty = false;
  if (bills != null && (S().billsAcct || {}).bal !== bills) { S().billsAcct = { bal: bills, asOf: today() }; dirty = true; }
  const sa = S().spendAcct || {};
  if (spend != null && sa.bal !== spend) { S().spendAcct = { bal: spend, name: spendName, asOf: today() }; dirty = true; }
  const pb = S().cc.plaidBal || {};
  if (card != null && (pb.amount !== card || pb.pending !== (cardPend || 0))) {
    S().cc = { ...S().cc, plaidBal: { amount: card, pending: cardPend || 0, asOf: today(), name: cardName } };
    dirty = true;
  }
  if (dirty) saveSettings();
}

// What the card should read if every loose card charge were finished. Those are
// real charges the bank has already counted, so leaving them out would make the
// log look permanently behind.
function cardReconcile() {
  const s = S();
  const pb = s.cc.plaidBal;
  if (!pb || typeof pb.amount !== 'number') return null;
  // The bank's posted balance leaves pending out, while your loose logs include
  // it, so the pending total has to be added back for the two sides to mean the
  // same thing: everything charged, posted or not.
  const posted = pb.amount;
  const pend = +pb.pending || 0;
  const bank = posted;
  const computed = cardDetail(s, store.txs).computed;
  const loose = round((s.pending || []).filter((p) => p.source === 'plaid').reduce((n, p) => n + (+p.amount || 0), 0));
  const ours = round(computed + loose);
  return { posted, pend, bank, asOf: pb.asOf, name: pb.name, computed, loose, ours, diff: round(bank - ours) };
}

const ROLE_OPTS = [
  ['card', '🕗 Charges → loose logs'],
  ['review', '📥 Review queue'],
  ['bills', '🏦 Bills → 12-month averages'],
  ['off', '🚫 Ignore']
];

// Merchant names wobble between months ("PG&E 10/01" vs "PGE"), so match on the
// letters and digits alone.
const billKey = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
function guessBill(note) {
  const k = billKey(note);
  if (!k) return '';
  const hit = S().bills.find((b) => { const bk = billKey(b.name); return bk && (k.startsWith(bk) || bk.startsWith(k)); });
  return hit ? hit.id : '';
}

// The first sync brings back every month at once, so the queue asks per
// merchant, not per payment: one answer files years of it.
function billGroups() {
  const g = new Map();
  bankUI.billq.forEach((it) => {
    const k = billKey(it.note) || it.id;
    if (!g.has(k)) g.set(k, { key: k, note: it.note || 'Payment', items: [] });
    g.get(k).items.push(it);
  });
  return [...g.values()].sort((a, b) => b.items.length - a.items.length);
}

// One month of one bill, recorded so billAmount() can average the last 12.
function applyBillHistory(billId, ym, amount) {
  const b = S().bills.find((x) => x.id === billId);
  if (!b) return false;
  b.history = Array.isArray(b.history) ? b.history : [];
  const hit = b.history.find((h) => h.month === ym);
  if (hit) hit.amount = round(amount);
  else b.history.push({ id: uid(), month: ym, amount: round(amount) });
  return true;
}

// Anything whose merchant you've already matched files itself; the rest queue up.
async function adoptBillCharges(b, items) {
  const map = S().billMatch || {};
  const left = [];
  let filed = 0;
  for (const it of items) {
    const target = map[billKey(it.note)];
    if (!target) { left.push(it); continue; }
    if (target !== '__skip' && applyBillHistory(target, it.date.slice(0, 7), it.amount)) filed++;
    await b.dropInbox(it.id).catch(() => {});
  }
  if (filed) { saveSettings(); toast(`Filed ${filed} bill payment${filed === 1 ? '' : 's'}`); }
  return left;
}

function bankBlock() {
  const b = bankUI, err = b.err ? `<div class="err">${esc(b.err)}</div>` : '';
  const off = (k) => (b.busy === k ? ' disabled style="opacity:.5"' : '');

  if (!b.on) return `<h2>Banking</h2><div class="card">
    <div class="note">Pull card and bank activity in automatically instead of typing every purchase. Imports wait in a review queue — nothing counts until you approve it.</div>
    <button class="btn block" data-act="bank-open">🏦 Set up automatic import</button></div>`;

  const synced = +S().bankSyncAt || 0;

  if (b.user === undefined) return `<h2>Banking</h2><div class="card">${err}<div class="field"><label class="muted">Checking…</label></div></div>`;

  if (!b.user) return `<h2>Banking</h2><div class="card">${err}
    <div class="note">Banking needs a sign-in so only you can reach your accounts. Everything else keeps working signed out, exactly as it does now.</div>
    <button class="btn block primary" data-act="bank-signin"${off('signin')}>${b.busy === 'signin' ? 'Opening…' : 'Sign in with Google'}</button></div>`;

  const accts = b.items.length
    ? b.items.map((it) => `<div class="bankgrp">${(it.accounts || []).map((a) => {
        const role = (it.roles || {})[a.account_id] || 'off';
        const bal = (it.balances || {})[a.account_id];
        const hasBal = bal && typeof bal.current === 'number';
        const pend = bal && +bal.pending || 0;
        const owes = role === 'card' || (bal && bal.type === 'credit');
        const net = hasBal ? bankBalance(bal, role) : 0;
        const sum = !pend ? '' : ` ${owes ? '+' : '−'} ${money(pend)} pending`;
        return `<div class="acct">
          <div class="nm">${esc(a.name)}${a.mask ? ` ••${esc(a.mask)}` : ''}</div>
          <div class="sub">${hasBal
            ? `bank says ${money(bal.current)}${sum} = <b>${money(net)}</b>${bal.scanned === false ? ' · pending not read' : ''}`
            : 'no balance yet — tap “Check for new activity”'}</div>
          <select data-acct-role="${esc(it.itemId)}|${esc(a.account_id)}">
            ${ROLE_OPTS.map(([v, l]) => `<option value="${v}" ${role === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>`;
      }).join('')}<button class="unlink" data-act="bank-unlink" data-id="${esc(it.itemId)}">Unlink this bank</button></div>`).join('')
    : '<div class="note">No banks linked yet.</div>';

  const opts = (picked) => '<option value="">Category…</option>'
    + S().categories.map((c) => `<option value="e:${esc(c.id)}" ${picked === 'e:' + c.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')
    + `<option value="i" ${picked === 'i' ? 'selected' : ''}>💰 Income</option>`
    + TRANSFERS.map((t) => `<option value="t:${esc(t.id)}" ${picked === 't:' + t.id ? 'selected' : ''}>${t.emoji} ${esc(t.name)}</option>`).join('');

  const rows = b.inbox.map((it) => `<div class="qrow">
    <div class="top"><span class="nm">${esc(it.note || 'Purchase')}</span><span class="amt">${money(it.amount)}</span></div>
    <div class="sub">${esc(shortDate(parseYmd(it.date)))}${it.account ? ' · ' + esc(it.account) : ''}${it.pending ? ' · pending' : ''}</div>
    <select data-inbox-cat="${esc(it.id)}">${opts(bankUI.pick[it.id] || '')}</select>
    <div class="acts">
      <button class="btn" data-act="inbox-accept" data-id="${esc(it.id)}"${off('row-' + it.id)}>✓ Add</button>
      <button class="btn" data-act="inbox-drop" data-id="${esc(it.id)}">Ignore</button>
    </div></div>`).join('');

  const billOpts = (picked) => '<option value="">Which bill?…</option>'
    + S().bills.map((x) => `<option value="${esc(x.id)}" ${picked === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    + `<option value="__skip" ${picked === '__skip' ? 'selected' : ''}>Not a bill — ignore these</option>`;

  const billRows = billGroups().map((g) => {
    const amts = g.items.map((x) => x.amount);
    const lo = Math.min(...amts), hi = Math.max(...amts);
    const span = lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
    return `<div class="qrow">
      <div class="top"><span class="nm">${esc(g.note)}</span><span class="amt">${span}</span></div>
      <div class="sub">${g.items.length} month${g.items.length === 1 ? '' : 's'}</div>
      <select data-billq="${esc(g.key)}">${billOpts(bankUI.billpick[g.key] || '')}</select>
      <div class="acts">
        <button class="btn" data-act="billq-drop" data-id="${esc(g.key)}">Not a bill — ignore these</button>
      </div></div>`;
  }).join('');

  const payers = S().incomePayers || [];
  const payerBox = `<div class="subhead">Income from</div>
    <div class="note">Deposits from these are logged as income without asking. Matched loosely, so batch numbers and dates on the end don't matter.</div>
    ${payers.map((n, i) => `<div class="acct row"><div class="nm">${esc(n)}</div>
      <button class="btn tiny" data-act="payer-del" data-i="${i}">Remove</button></div>`).join('')
      || '<div class="note">Nobody listed — deposits will wait in the review queue.</div>'}
    <button class="btn block" data-act="payer-add">+ Add who pays you</button>`;

  const rules = Object.entries(S().txMatch || {});
  const ruleLabel = (r) => r === 'i' ? '💰 Income'
    : r === '__skip' ? '🚫 Ignored'
    : r.startsWith('t:') ? ((TRANSFERS.find((x) => x.id === r.slice(2)) || {}).emoji || '🏦') + ' ' + ((TRANSFERS.find((x) => x.id === r.slice(2)) || {}).name || r.slice(2))
    : ((S().categories.find((c) => c.id === r.slice(2)) || {}).name || r.slice(2));
  const ruleRows = !rules.length ? '' : `<div class="subhead">Automatic rules · ${rules.length}</div>
    <div class="note">Learned when you filed one of these. Paycheques and transfers file themselves; purchases always wait for you.</div>
    ${rules.map(([k, r]) => `<div class="acct row"><div class="nm">${esc(k)}<div class="sub">${ruleLabel(r)}</div></div>
      <button class="btn tiny" data-act="rule-del" data-id="${esc(k)}">Forget</button></div>`).join('')}`;

  // The queues are what you act on, so they stay in the open; everything that
  // is set once and forgotten goes behind a summary.
  const setup = `<details class="psec" ${openAttr('bank-setup')}>
    <summary><span class="psec-t">Accounts &amp; rules</span><span class="psec-caret">›</span></summary>
    <div class="psec-body">
    <div class="acct row"><div class="nm">Signed in as ${esc(b.user.email || b.user.displayName || 'you')}</div>
      <button class="btn tiny" data-act="bank-signout"${off('signout')}>Sign out</button></div>
    ${accts}
    ${b.items.length && !b.items.some((it) => Object.values(it.roles || {}).includes('bills'))
      ? '<div class="note">No account is set to <b>Bills → 12-month averages</b> yet, so nothing is filling in your bills account balance or their averages.</div>' : ''}
    ${b.items.length ? '<div class="note">Set your card to <b>Charges → loose logs</b>: each one lands in the 🕗 list on Home with its price and merchant, and only counts once you finish it. Set your bills account to <b>Bills → 12-month averages</b> — those payments never count as purchases, they just fill in each bill\'s history and keep the account balance current.</div>' : ''}
    <button class="btn block" data-act="bank-connect"${off('connect')}>${b.busy === 'connect' ? 'Opening…' : '+ Connect a bank'}</button>
    ${payerBox}
    ${ruleRows}
    </div></details>`;

  return `<h2>Banking</h2><div class="card">${err}
    ${progressHTML()}
    ${synced ? `<div class="note" style="margin:0 0 10px">Imports on its own when you open the app. Last checked ${new Date(synced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</div>` : ''}
    <button class="btn block" data-act="bank-sync"${off('sync')}>${b.busy === 'sync' ? 'Checking…' : '⟳ Check for new activity'}</button>
    <button class="btn block" data-act="bank-activity">🔎 Browse all bank activity</button>
    ${setup}
    </div>
    ${b.inbox.length ? `<h2>To review · ${b.inbox.length}</h2><div class="card">
      <div class="note">Give each one a category to add it. Nothing here counts toward your budget yet.</div>
      ${rows}</div>` : ''}
    ${b.billq.length ? `<h2>Which bill? · ${b.billq.length}</h2><div class="card">
      <div class="note">Match a merchant once and every future month files itself. These build each bill's 12-month average — they never count as purchases.</div>
      ${billRows}</div>` : ''}`;
}

// Answering a merchant writes the rule; adoption then files every month of it,
// here and in every sync from now on.
function billqRule(key, pick) {
  bankRun('row-' + key, async () => {
    const b = await bankMod();
    S().billMatch = { ...(S().billMatch || {}), [key]: pick };
    saveSettings();
    bankUI.billq = await adoptBillCharges(b, bankUI.billq);
    delete bankUI.billpick[key];
    toast(pick === '__skip' ? 'Ignoring these from now on' : 'Matched — future months file themselves');
  });
}

// Everything the banks have, whatever its account is set to do. Read-only until
// you tap a row, which opens the normal log flow already filled in.
let activity = null;
function openActivity(days, acct, fresh) {
  activity = { days: days || 30, acct: acct || 'all', rows: null, err: '', fresh: !!fresh };
  drawActivity();
  $('#sheet').hidden = false;
  bankRun('activity', async () => {
    const b = await bankMod();
    try { activity.rows = (await b.recentActivity(activity.days, fresh)).transactions || []; }
    catch (e) { activity.err = (e && e.message) || String(e); }
    activity.fresh = false;
    drawActivity();
  });
}

function drawActivity() {
  const a = activity;
  if (!a) return;
  const pick = [7, 30, 90, 365].map((d) => `<button class="chip ${a.days === d ? 'on' : ''}" data-act="activity-days" data-id="${d}">${d === 365 ? '1 year' : d + ' days'}</button>`).join('');
  const names = [...new Set((a.rows || []).map((t) => t.account))].sort();
  const accts = names.length < 2 ? '' : `<div class="chips">${
    [['all', 'All accounts'], ...names.map((n) => [n, n])]
      .map(([v, l]) => `<button class="chip ${a.acct === v ? 'on' : ''}" data-act="activity-acct" data-id="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const rows = (a.rows || []).filter((t) => a.acct === 'all' || t.account === a.acct);
  const body = a.err ? `<div class="err">${esc(a.err)}</div>`
    : !a.rows ? `<div class="empty" style="padding:22px">${a.fresh ? 'Asking your bank for the latest…' : 'Loading…'}</div>`
    : !rows.length ? '<div class="empty" style="padding:22px">Nothing here in this period.</div>'
    : rows.map((t) => `<button class="actrow" data-act="activity-log" data-id="${esc(t.id)}">
        <div class="ar-b"><div class="ar-t">${esc(t.name || 'Transaction')}</div>
          <div class="ar-s">${esc(shortDate(parseYmd(t.date)))} · ${esc(t.account)}${t.pending ? ' · pending' : ''}</div></div>
        <b class="ar-a ${t.outgoing ? '' : 'in'}">${t.outgoing ? '' : '+'}${money(t.amount)}</b></button>`).join('');
  $('#sheet').innerHTML = `<div class="panel"><div class="head">
      <span style="width:40px"></span><span class="step">All bank activity</span><button data-act="sheet-close" aria-label="Close">✕</button></div>
    <div class="chips">${pick}</div>
    ${accts}
    <p class="note" style="margin:0 0 8px">${a.rows ? `${rows.length} transaction${rows.length === 1 ? '' : 's'} · ` : ''}Tap one to log it. Looking here never changes what gets imported.</p>
    <button class="btn block" data-act="activity-fresh" style="margin:0 0 10px">↻ Ask the bank for the latest</button>
    ${body}</div>`;
  $('#sheet').className = 'sheet';
}

function inboxAccept(id) {
  const it = bankUI.inbox.find((x) => x.id === id);
  if (!it) return;
  const v = bankUI.pick[id];
  if (!v) return toast('Pick a category first');
  const kind = v === 'i' ? { type: 'income', category: 'income' }
    : v.startsWith('t:') ? { type: 'transfer', category: v.slice(2) }
    : { type: 'expense', category: v.slice(2) };
  bankRun('row-' + id, async () => {
    const b = await bankMod();
    addTx({ ...kind, amount: it.amount, date: it.date, note: it.note || '', pay: it.pay || 'credit' });
    await b.dropInbox(id);
    bankUI.inbox = bankUI.inbox.filter((x) => x.id !== id);
    delete bankUI.pick[id];
    toast('Added');
  });
}

// ---------- the sheet (add flow + edit) ----------
let flow = null, edit = null, billEdit = null, track = null, avgCat = null, returnPlan = null;
function closeSheet() { const el = $('#sheet'); el.hidden = true; el.className = 'sheet'; el.innerHTML = ''; flow = null; edit = null; billEdit = null; track = null; returnPlan = null; activity = null; pendingOpen = false; resetSel(); }

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
    case 'done': {
      const any = parseFloat(f.amt) > 0;
      if (any) addPending(f.amt);
      closeSheet(); render();
      if (any || f.count) toast('Saved to finish later');
      return openPending();
    }
  }
}

// ----- the list of loose logs to finish (also the first-open reminder) -----
let pendingOpen = false;
function openPending() {
  pendingOpen = true;
  drawPending();
  $('#sheet').hidden = false;
}

function drawPending() {
  const pend = (S().pending || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const rows = !pend.length ? '' : pend.map((x) => `<div class="loose-row">${x.source === 'plaid' && x.note
    ? `<button class="x" data-act="pending-ignore" data-id="${esc(x.id)}" title="Always ignore ${esc(x.note)}" aria-label="Always ignore">🚫</button>` : ''}
    <button class="loose" data-act="finish-item" data-id="${esc(x.id)}"><div class="emoji">🕗</div>
      <div class="body"><div class="t">${money(x.amount)}${x.note ? ` · ${esc(x.note)}` : ''}</div><div class="s">${
        x.source === 'plaid' ? esc(x.account || 'from your bank') : 'added'
      } · ${parseYmd(x.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${x.pend ? ' · pending' : ''} · tap to finish</div></div><span class="chev">›</span></button>
    <button class="x" data-act="pending-del" data-id="${esc(x.id)}" aria-label="Discard">✕</button></div>`).join('');
  $('#sheet').innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Loose logs to finish</span><button data-act="sheet-close" aria-label="Later">✕</button></div>
    ${progressHTML()}
    <p class="note" style="margin:0 0 10px">${pend.length
      ? `${pend.length} item${pend.length === 1 ? '' : 's'} to finish — tap one to give it a category.`
      : 'Nothing waiting. Card purchases land here on their own; add a price now and finish it later.'}</p>
    ${rows}
    <button class="btn block" data-act="track-later" style="margin-top:12px">+ Note a price for later</button>
    <button class="btn block" data-act="sheet-close" style="margin-top:8px">Done</button></div>`;
  $('#sheet').className = 'sheet';
}

// ----- edit a bill: fixed amount, past-month history, 12-month average -----
const monthLabelShort = (ym) => parseYmd(ym + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const prevYm = (ym) => { const d = parseYmd(ym + '-01'); d.setMonth(d.getMonth() - 1); return ymd(d).slice(0, 7); };
function openBillEdit(i) { billEdit = i; drawBillEdit(); $('#sheet').hidden = false; }
function drawBillEdit() {
  const b = S().bills[billEdit];
  if (!b) return closeSheet();
  const hist = (b.history || []).slice().sort((a, c) => c.month.localeCompare(a.month));
  const every = Math.max(1, Math.round(+b.everyMonths || 1));
  const avg = billAmount({ ...b, useAvg: true });
  const rows = hist.map((h) => `<div class="field">
    <input type="month" data-bh="${esc(h.id)}" data-f="month" value="${esc(h.month)}" max="${today().slice(0, 7)}">
    <input type="text" inputmode="decimal" data-bh="${esc(h.id)}" data-f="amount" value="${fmtNum(h.amount)}" style="width:100px" placeholder="0">
    <button class="x" data-act="bh-del" data-id="${esc(h.id)}" aria-label="Remove">✕</button></div>`).join('') || '<div class="empty" style="padding:14px">No months logged yet.</div>';
  $('#sheet').innerHTML = `<div class="panel"><div class="head">
      <span style="width:40px"></span><span class="step">Edit ${esc(b.name)}</span><button data-act="bill-done" aria-label="Done">✕</button></div>
    <label class="editlbl">Amount each time it arrives</label>
    <input class="sheet-input" type="text" inputmode="decimal" value="${fmtNum(b.amount)}" data-billfix="amount" ${b.useAvg ? 'disabled' : ''}>
    <label class="editlbl">How often it arrives</label>
    <select class="sheet-input" data-billevery>
      ${[[1, 'Every month'], [2, 'Every other month'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Once a year']]
        .map(([v, l]) => `<option value="${v}" ${every === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    ${every > 1 ? `<div class="note" style="margin:2px 2px 10px">Budgeted at <b>${money(billAmount(b))}</b> a month — ${money(b.useAvg ? billAmount({ ...b, everyMonths: 1 }) : b.amount)} spread over ${every} months.</div>` : ''}
    <label class="paytoggle" style="display:flex;align-items:center;gap:10px;margin:12px 2px 4px"><input type="checkbox" data-billavg ${b.useAvg ? 'checked' : ''}> Use 12-month average${b.history && b.history.length ? ` <b style="margin-left:auto">${money(avg)}</b>` : ''}</label>
    <div class="note" style="margin:2px 2px 10px">${b.useAvg ? `Using the average of the last ${Math.min(Math.round(12 / every), hist.length)} statement${hist.length === 1 ? '' : 's'}${every > 1 ? ' — a year of service' : ''}.` : 'Turn on to use the average of the months below instead of the fixed amount.'}</div>
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
  flow = { step: opts.category ? 2 : 1, category: opts.category || null, amt: opts.amt || '', note: opts.note || '', date: opts.date || today(), pay: 'credit', count: 0, pendingId: opts.pendingId || null, amtLocked: !!opts.amtLocked, splitting: false, hasTotal: true, total: '', splits: [], vehicle: null };
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
    const isGas = c.id === 'gas';
    const ph = c.type === 'income' ? 'Paycheck, refund…' : c.type === 'transfer' ? 'Note (optional)' : 'What was it? (e.g. Wingstop)';
    const payToggle = c.type === 'expense' ? `<div class="seg paytoggle">
      <button data-flow="pay" data-v="credit" class="${f.pay !== 'cash' ? 'on' : ''}">💳 Credit card</button>
      <button data-flow="pay" data-v="cash" class="${f.pay === 'cash' ? 'on' : ''}">💵 Debit / cash</button></div>` : '';
    const exToggle = c.type === 'expense' && c.useAvg ? `<label class="exrow"><input type="checkbox" id="f-ex" ${f.exAvg ? 'checked' : ''}> Exclude from the ${esc(c.name)} average <span class="muted">(unusual trip)</span></label>` : '';
    const shownAmt = f.splitting ? (f.hasTotal ? round(parseFloat(f.total) || 0) : round(f.splits.reduce((a, x) => a + x, 0))) : amtNum;
    const splitNote = f.splitting ? `<div class="muted">${esc(c.name)} · ${f.splits.length} charges</div>` : `<div class="muted">${esc(c.name)}</div>`;
    const single = f.pendingId || f.splitting;
    // Gas: must pick which vehicle. Truck/Car are one-tap; Other needs a typed note.
    const vehPick = isGas ? `<div class="q" style="margin-top:4px">Which vehicle?</div>
      <div class="seg paytoggle">
        <button data-flow="veh" data-v="Truck" class="${f.vehicle === 'Truck' ? 'on' : ''}">🛻 Truck</button>
        <button data-flow="veh" data-v="Car" class="${f.vehicle === 'Car' ? 'on' : ''}">🚗 Car</button>
        <button data-flow="veh" data-v="Other" class="${f.vehicle === 'Other' ? 'on' : ''}">➕ Other</button></div>` : '';
    const noteField = isGas
      ? (f.vehicle === 'Other' ? `<input class="sheet-input" id="f-note" type="text" placeholder="Which vehicle / what for?" value="${esc(f.note)}" autocomplete="off">` : '')
      : `<input class="sheet-input" id="f-note" type="text" placeholder="${ph}" value="${esc(f.note)}" autocomplete="off">`;
    const gasReady = !isGas || (f.vehicle && f.vehicle !== 'Other') || (f.vehicle === 'Other');
    const saveDis = gasReady ? '' : 'disabled style="opacity:.4"';
    body = `<div class="q">${isGas ? 'Gas details' : 'Add a description'}</div>
      <div class="summary"><div class="emoji" style="background:var(--card)">${c.emoji}</div><div><b>${money(shownAmt)}</b>${splitNote}</div></div>
      ${vehPick}
      ${noteField}
      <input class="sheet-input" id="f-date" type="date" value="${f.date}" max="${today()}">
      ${payToggle}
      ${exToggle}
      ${c.type === 'expense' && !f.splitting ? `<label class="exrow"><input type="checkbox" id="f-ret" ${f.returning ? 'checked' : ''}> ↩︎ A return is coming <span class="muted">(set it up after saving)</span></label>` : ''}
      ${single
        ? `<button class="btn primary block" data-flow="save" ${saveDis}>${f.splitting ? `Save ${f.splits.length} charges` : 'Save &amp; log it'}</button>`
        : `<div class="twobtn"><button class="btn block" data-flow="again" ${saveDis}>+ Add another</button><button class="btn primary block" data-flow="save" ${saveDis}>Save</button></div>
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
  if (f.pendingId) {
    // Filing an imported paycheque or transfer teaches the rule, so the next one
    // files itself. Purchases never do: those stay yours to categorise.
    const src = (S().pending || []).find((x) => x.id === f.pendingId);
    if (src && src.source === 'plaid' && result) {
      // It came off the card, so a balance stated that day already covers it.
      updateTx(result.id, { src: 'bank' });
      result.src = 'bank';
    }
    if (src && src.source === 'plaid' && src.note && (c.type === 'income' || c.type === 'transfer')) {
      const k = billKey(src.note);
      if (k) {
        S().txMatch = { ...(S().txMatch || {}), [k]: c.type === 'income' ? 'i' : 't:' + c.id };
        toast(`${src.note} will file itself from now on`);
      }
    }
    S().pending = (S().pending || []).filter((x) => x.id !== f.pendingId);
    saveSettings();
  }
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

// Gas must have a vehicle chosen; "Other" needs a typed description.
function gasOk(f) {
  if (f.category !== 'gas') return true;
  if (!f.vehicle) { toast('Pick a vehicle for the gas'); return false; }
  if (f.vehicle === 'Other') { const n = $('#f-note') ? $('#f-note').value.trim() : (f.note || '').trim(); if (!n) { toast('Add a description for “Other”'); return false; } }
  return true;
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
    case 'veh': {
      if ($('#f-note')) f.note = $('#f-note').value;
      if ($('#f-date')) f.date = $('#f-date').value || f.date;
      f.vehicle = v;
      if (v !== 'Other') f.note = v;
      else if (f.note === 'Truck' || f.note === 'Car') f.note = '';
      return drawFlow();
    }
    case 'back': f.step = (f.amtLocked && f.step === 3) ? 1 : f.step - 1; if (f.step < 1) f.step = 1; return drawFlow();
    case 'save': {
      if (!f.splitting && !(parseFloat(f.amt) > 0)) return;
      if (!gasOk(f)) return;
      const wantReturn = !f.splitting && logCat(f.category)?.type === 'expense' && $('#f-ret') && $('#f-ret').checked;
      const tx = flowCommit();
      render(); toast(savedMsg(tx));
      if (wantReturn) return openReturnPlan(tx);   // jump straight into planning the return
      closeSheet(); return;
    }
    case 'again': { if (!(parseFloat(f.amt) > 0)) return; if (!gasOk(f)) return; const tx = flowCommit(); f.count += 1; f.amt = ''; f.note = ''; f.exAvg = false; f.vehicle = null; f.step = 2; drawFlow(); render(); toast(savedMsg(tx)); return; }
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
  if (a) edit.amount = parseNum(a.value);
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
    <input class="sheet-input" id="e-amt" type="text" inputmode="decimal" value="${fmtNum(e.amount)}">
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
    ${e.type === 'expense' ? `<button class="btn block" data-edit="return">↩︎ Plan a return</button>` : ''}
    <button class="btn danger block" data-edit="delete">Delete</button></div>`;
}
function editClick(btn) {
  const e = edit, v = btn.dataset.v;
  switch (btn.dataset.edit) {
    case 'close': return closeSheet();
    case 'type': syncEditInputs(); e.type = v; e.category = v === 'income' ? 'income' : v === 'transfer' ? 'bills' : (cat(e.category) ? e.category : S().categories[0].id); return drawEdit();
    case 'cat': syncEditInputs(); e.category = v; return drawEdit();
    case 'pay': syncEditInputs(); e.pay = v; return drawEdit();
    case 'return': syncEditInputs(); return openReturnPlan(e);
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

// ----- plan a return (full, partial, or more) tied to a purchase -----
function openReturnPlan(tx) {
  returnPlan = { txId: tx.id || null, orig: round(tx.amount), amount: round(tx.amount), note: tx.note || '', category: tx.category, pay: tx.pay || 'credit', exBudget: !!tx.exBudget, picking: false };
  edit = null; flow = null; drawReturnPlan(); $('#sheet').hidden = false;
}
function drawReturnPlan() {
  const r = returnPlan, el = $('#sheet');
  if (r.picking) {
    // Pick a different logged purchase to return instead.
    const list = store.txs.filter((t) => t.type === 'expense').sort(sortTx).slice(0, 40);
    const rows = list.map((t) => { const c = cat(t.category); return `<button class="tx-main" data-ret="pick" data-id="${esc(t.id)}" style="width:100%">
      <div class="emoji">${c ? c.emoji : '🧾'}</div><div class="body"><div class="t">${esc(t.note || (c ? c.name : 'Purchase'))}</div><div class="s">${c ? esc(c.name) + ' · ' : ''}${moDay(t.date)}</div></div><div class="amt">${money(t.amount)}</div></button>`; }).join('') || '<div class="empty">No purchases to choose from.</div>';
    el.innerHTML = `<div class="panel"><div class="head"><button data-ret="unpick" aria-label="Back">←</button><span class="step">Pick the purchase</span><button data-ret="close" aria-label="Close">✕</button></div>
      ${rows}
      <button class="btn block" data-ret="unpick" style="margin-top:12px">← Back</button></div>`;
    return;
  }
  const c = cat(r.category), full = Math.abs(r.amount - r.orig) < 0.005;
  const what = r.note ? `“${esc(r.note)}”` : (c ? esc(c.name) : 'this purchase');
  el.innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Plan a return</span><button data-ret="close" aria-label="Close">✕</button></div>
    <p class="note" style="margin:0 0 12px">${what} · ${money(r.orig)}</p>
    <label class="editlbl">Amount to return <span class="muted">(can be more than the purchase)</span></label>
    <input class="sheet-input" id="ret-amt" type="text" inputmode="decimal" value="${fmtNum(r.amount)}">
    <div class="seg"><button data-ret="full" class="${full ? 'on' : ''}">Full · ${money(r.orig)}</button><button data-ret="partial" class="${full ? '' : 'on'}">Other amount</button></div>
    <button class="btn block" data-ret="pickstart" style="margin-top:10px">↩︎ Returning something else? Pick a purchase</button>
    <button class="btn primary block" data-ret="save" style="margin-top:10px">Add to returns</button></div>`;
}
function returnClick(btn) {
  const r = returnPlan;
  switch (btn.dataset.ret) {
    case 'close': return closeSheet();
    case 'full': r.amount = r.orig; return drawReturnPlan();
    case 'partial': { const a = $('#ret-amt'); if (a) { a.focus(); a.select(); } return; }
    case 'pickstart': { r.picking = true; return drawReturnPlan(); }
    case 'unpick': { r.picking = false; return drawReturnPlan(); }
    case 'pick': {
      const t = store.txs.find((x) => x.id === btn.dataset.id);
      if (t) { r.txId = t.id; r.orig = round(t.amount); r.amount = round(t.amount); r.note = t.note || ''; r.category = t.category; r.pay = t.pay || 'credit'; r.exBudget = !!t.exBudget; }
      r.picking = false; return drawReturnPlan();
    }
    case 'save': {
      const a = $('#ret-amt'), amt = round(parseNum(a ? a.value : r.amount));
      if (!(amt > 0)) return toast('Enter an amount');
      // The offset lives on the purchase (capped at it) so it cancels that purchase
      // and nothing else; `returns` is just the reminder that it hasn't happened yet.
      if (r.txId) updateTx(r.txId, { returned: Math.min(amt, r.orig) });
      S().returns = [...(S().returns || []), { id: uid(), txId: r.txId, note: r.note, category: r.category, pay: r.pay, orig: r.orig, amount: amt, at: Date.now(), date: today() }];
      saveSettings(); closeSheet(); render(); toast('Added to returns');
      return;
    }
  }
}

// ----- the returns list: purchases you're planning to take back -----
function openReturns() {
  const rets = (S().returns || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const total = round(rets.reduce((a, x) => a + (x.amount || 0), 0));
  const rows = rets.length ? rets.map((x) => {
    const c = cat(x.category), partial = x.amount < x.orig - 0.005;
    const label = x.note ? esc(x.note) : (c ? esc(c.name) : 'Purchase');
    return `<div class="loose-row">
      <div class="loose"><div class="emoji">↩︎</div>
        <div class="body"><div class="t">${money(x.amount)}${partial ? ` <span class="muted" style="font-weight:500">of ${money(x.orig)}</span>` : ''}</div>
          <div class="s">${label}${c ? ` · ${c.emoji}` : ''}${x.pay === 'cash' ? ' · debit/cash' : ' · card'} · added ${moDay(x.date || today())}</div></div></div>
      <button class="btn mini good" data-act="return-done" data-id="${esc(x.id)}" aria-label="Mark returned" title="Mark returned">✓</button>
      <button class="x" data-act="return-del" data-id="${esc(x.id)}" aria-label="Remove">✕</button></div>`;
  }).join('') : '<div class="empty" style="padding:14px">Nothing to return.</div>';
  $('#sheet').innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Planned returns</span><button data-act="sheet-close" aria-label="Close">✕</button></div>
    ${rets.length ? `<p class="note" style="margin:0 0 10px">${rets.length} to return · ${money(total)}</p>` : ''}
    ${rows}
    <button class="btn block" data-act="sheet-close" style="margin-top:12px">Close</button></div>`;
  $('#sheet').className = 'sheet';
  $('#sheet').hidden = false;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500);
}

// ----- this month, week by week -----
const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Last week's over-spend that penalizes this week — review each purchase and
// forgive (ignore) the ones you don't want carried over.
function openOverage() {
  const s = S(), now = new Date(), startDay = s.weekStartDay ?? 5;
  const ws = weekStart(now, startDay);
  const prevStart = weekStart(addDays(parseYmd(ws), -1), startDay);
  const ids = s.categories.filter((c) => c.weekly).map((c) => c.id);
  const items = store.txs.filter((t) => t.type === 'expense' && ids.includes(t.category) && t.date >= prevStart && t.date < ws).sort(sortTx);
  const over = round(-weekStats(s, store.txs, now).carryover);     // live: reflects what's ignored
  const rows = items.length ? items.map((t) => {
    const c = cat(t.category);
    return `<label class="ovrow ${t.exBudget ? 'off' : ''}">
      <input type="checkbox" data-ovignore="${t.id}" ${t.exBudget ? '' : 'checked'}>
      <span class="ovbody"><b>${money(t.amount)}</b> <span class="muted">${esc(t.note || (c ? c.name : t.category))} · ${shortDate(parseYmd(t.date))}</span></span>
      <span class="ovtag">${t.exBudget ? 'ignored' : 'counts'}</span></label>`;
  }).join('') : '<div class="empty">No weekly-budget purchases last week.</div>';

  $('#sheet').innerHTML = `<div class="panel sheet-page"><div class="head">
      <button class="backbtn" data-act="sheet-close" aria-label="Back">←</button><span class="step">Last week's overage</span><span style="width:28px"></span></div>
    <div class="card hero" style="box-shadow:none;padding:4px 0">
      <div class="label">Carrying over into this week</div>
      <div class="big ${over > 0 ? 'neg' : ''}">${over > 0 ? '−' + money(over) : money(0)}</div>
      <div class="note" style="margin:8px 0 0">Uncheck any purchase to forgive it — it stops counting toward last week's budget, so it won't trim this week.</div></div>
    <div class="card">${rows}</div>
    ${over > 0 ? '<button class="btn block" data-act="week-reset" style="margin-top:12px">Forgive the entire overage</button>' : ''}</div>`;
  $('#sheet').className = 'sheet page';
  $('#sheet').hidden = false;
}

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
    // Breakdown is about spending only — leave out income, bills transfers,
    // savings transfers and card payments.
    const txsIn = store.txs.filter((t) => t.type === 'expense' && t.date >= from && t.date < to).sort(sortTx);
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
      <div class="note" style="margin:8px 0 0">${money(ws.spent)} of ${money(ws.budget)} everyday budget${ws.trimmedByCard > 0 ? ` <span class="muted">(spend-less card plan: trimmed ${money(ws.trimmedByCard)})</span>` : ''}${ws.carryover < 0 ? ` <span class="negtext">(incl. ${money(ws.carryover)} rolled over)</span>` : ''}</div></div>
    <h2>Week by week</h2><div class="card" style="padding:4px 18px">${weekRows}</div>
    <h2>This week by category</h2><div class="card">${catRows}</div></div>`;
  $('#sheet').className = 'sheet page';
  $('#sheet').hidden = false;
}

// ----- the purchases behind a category's 12-month average -----
function openCatAvg(id) {
  const c = cat(id); if (!c) return;
  avgCat = id;
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
    const rows = gas.filter((t) => t.date.slice(0, 7) === m).map((t) => `<button class="avg-tx ${t.exAvg ? 'skip' : ''}" data-act="avg-toggle" data-id="${t.id}">
      <span class="d">${parseYmd(t.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${t.note ? ' · ' + esc(t.note) : ''}</span>
      <span class="a">${money(t.amount)} <span class="ex-tag ${t.exAvg ? 'off' : ''}">${t.exAvg ? 'excluded · include' : 'exclude'}</span></span></button>`).join('');
    return `<div class="avg-month"><div class="avg-mhead"><b>${label}</b>${tag}</div>${rows}</div>`;
  }).join('');

  const range = used.size ? ` from ${parseYmd([...used].sort()[0] + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}–${parseYmd([...used].sort().slice(-1)[0] + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}` : '';
  $('#sheet').innerHTML = `<div class="panel sheet-page"><div class="head">
      <button class="backbtn" data-act="sheet-close" aria-label="Back">←</button><span class="step">${esc(c.name)} average</span><span style="width:28px"></span></div>
    <div class="card hero" style="box-shadow:none;padding:4px 0">
      <div class="label">12-month average</div>
      <div class="big">${money(avg)}</div>
      <div class="note" style="margin:8px 0 0">Average of ${used.size} month${used.size === 1 ? '' : 's'}${range}. The current month and excluded trips aren't counted. <b>Tap any purchase to exclude it</b> (or add it back) — the log and your gas spending don't change, only the average.</div></div>
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
  const fr = e.target.closest('[data-ret]'); if (fr && returnPlan) return returnClick(fr);
  if (e.target === $('#sheet')) return closeSheet();
  const tab = e.target.closest('#tabs button');
  if (tab) { if (sel.ids.size) resetSel(); ui.tab = tab.dataset.tab; scrollTo(0, 0); return render(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'log': return openFlow();
    case 'log-xfer': return openFlow({ category: id });
    case 'week': resetSel(); return openWeek();
    case 'sel-done': { resetSel(); if (!$('#sheet').hidden) return openWeek(); return render(); }
    case 'tx-toggle': {
      const now = sel.ids.has(id) ? (sel.ids.delete(id), false) : (sel.ids.add(id), true);
      b.classList.toggle('on', now);
      const row = b.closest('.tx'); if (row) row.classList.toggle('selected', now);
      return renderSelBar();
    }
    case 'loan-toggle': { ui.openLoan = ui.openLoan === id ? null : id; return render(); }
    case 'loan-extra-reset': { const l = loanById(id); if (l) { l.extra = 0; saveSettings(); } return render(); }
    case 'loan-lock': { const [lid, date] = id.split('|'); const l = loanById(lid); if (l) { l.extras = { ...(l.extras || {}), [date]: Math.max(0, round(l.extra || 0)) }; saveSettings(); } return render(); }
    case 'loan-skip': { const [lid, date] = id.split('|'); const l = loanById(lid); if (l) { l.extras = { ...(l.extras || {}), [date]: 0 }; saveSettings(); } return render(); }
    case 'loan-unlock': { const [lid, date] = id.split('|'); const l = loanById(lid); if (l) { const ex = { ...(l.extras || {}) }; delete ex[date]; l.extras = ex; saveSettings(); } return render(); }
    case 'loan-delete': { const l = loanById(id); if (l && confirm(`Delete ${l.name}? This hides it from Finance.`)) { l.deleted = true; ui.openLoan = null; saveSettings(); render(); } return; }
    case 'loan-add': {
      const name = prompt('Loan name?'); if (!name || !name.trim()) return;
      const bal = Math.max(0, parseNum(prompt('Current balance?', '0')));
      const rate = Math.max(0, parseNum(prompt('Annual interest rate % (e.g. 5.5)?', '0'))) / 100;
      const payment = Math.max(0, parseNum(prompt('Monthly payment?', '0')));
      S().finance.loans.push({ id: uid(), name: name.trim(), lender: '', emoji: '💵', principal: round(bal), rate, payment: round(payment), start: today(), adjust: 0, extra: 0, extras: {} });
      ui.openLoan = S().finance.loans[S().finance.loans.length - 1].id; saveSettings(); return render();
    }
    case 'inv-preset': { S().finance.invest.rate = parseFloat(id) || 0; saveSettings(); return render(); }
    case 'week-reset': { S().weekResetAt = weekStats(S(), store.txs).start; saveSettings(); closeSheet(); return render(); }
    case 'week-unreset': { S().weekResetAt = null; saveSettings(); closeSheet(); return render(); }
    case 'overage-view': return openOverage();
    case 'plan-clear': { planEdits()[id] = 0; savePlanDraft(); commitPlan(); return render(); }
    case 'cc-match': {
      const r = cardReconcile();
      if (!r || Math.abs(r.diff) < 0.01) return;
      S().cc = { ...S().cc, chargesAdj: round((S().cc.chargesAdj || 0) + r.diff) };
      saveSettings(); render();
      return toast(`Card matched to ${money(r.bank)}`);
    }
    case 'cc-week-done': {
      const w = weekPaidState(S(), store.txs, new Date(), S().weekStartDay ?? 5);
      S().cc = { ...S().cc, paidThrough: w.payday };
      saveSettings(); render();
      return toast("Done for this week — the rest is spread over the weeks left");
    }
    case 'cc-week-more': {
      const w = weekPaidState(S(), store.txs, new Date(), S().weekStartDay ?? 5);
      S().cc = { ...S().cc, paidThrough: 'more:' + w.payday };
      saveSettings(); render();
      return toast('Reopened — add the rest when you can');
    }
    case 'cc-pay-clear': { const e = { ...(S().cc.planEdits || {}) }; delete e[id]; S().cc = { ...S().cc, planEdits: e }; saveSettings(); return render(); }
    case 'cc-edits-reset': { S().cc = { ...S().cc, planEdits: {} }; saveSettings(); return render(); }
    case 'cc-strategy': { S().cc = { ...S().cc, strategy: id }; saveSettings(); return render(); }
    case 'cc-mode': { S().cc = { ...S().cc, mode: id }; saveSettings(); return render(); }
    case 'catavg-view': return openCatAvg(id);
    case 'avg-toggle': { const t = store.txs.find((x) => x.id === id); if (t) updateTx(id, { exAvg: !t.exAvg }); if (avgCat) openCatAvg(avgCat); return; }
    case 'track-later': return openTrack();
    case 'returns-view': return openReturns();
    case 'return-done': {
      // The purchase was already cancelled when you flagged it, so nothing moves —
      // this just ticks it off the reminder list.
      S().returns = (S().returns || []).filter((x) => x.id !== id); saveSettings();
      render(); openReturns(); toast('Returned'); return;
    }
    case 'return-del': {
      // Not returning it after all — the purchase counts again.
      const r = (S().returns || []).find((x) => x.id === id);
      if (r && r.txId) updateTx(r.txId, { returned: 0 });
      S().returns = (S().returns || []).filter((x) => x.id !== id); saveSettings();
      render(); openReturns(); toast('Back in your spending'); return;
    }
    case 'finish-loose': return openPending();
    case 'finish-item': { const it = (S().pending || []).find((x) => x.id === id); closeSheet(); if (it) openFlow({ amt: String(it.amount), pendingId: it.id, amtLocked: true, note: it.note || '', date: it.date }); return; }
    case 'pending-ignore': {
      const it = (S().pending || []).find((x) => x.id === id);
      if (!it) return;
      if (!confirm(`Ignore "${it.note}" from now on? It won't appear again.`)) return;
      const k = billKey(it.note);
      if (k) S().txMatch = { ...(S().txMatch || {}), [k]: '__skip' };
      S().pending = (S().pending || []).filter((x) => x.id !== id);
      saveSettings(); render();
      if ((S().pending || []).length) openPending(); else closeSheet();
      return toast(`Ignoring ${it.note} from now on`);
    }
    case 'pending-del': { if (confirm('Discard this loose item without logging it?')) { S().pending = (S().pending || []).filter((x) => x.id !== id); saveSettings(); render(); if ((S().pending || []).length) openPending(); else closeSheet(); } return; }
    case 'plan-week': {
      const d = +id;
      ui.weekOff = d === 0 ? 0 : (ui.weekOff || 0) + d;
      return render();   // each week keeps its own plan now, so nothing to clear
    }
    case 'goal-clear': S().weeklyGoal = null; saveSettings(); return render();
    case 'plan-reset': ui.planDraft[planKey()] = {}; savePlanDraft(); commitPlan(); return render();
    case 'plan-reset-field': { delete planEdits()[id]; savePlanDraft(); commitPlan(); return render(); }
    case 'plan-bills-needed': { planEdits().bills = round(parseFloat(id) || 0); savePlanDraft(); commitPlan(); return render(); }
    case 'pay-live': { ui.payLive = !ui.payLive; savePayLive(); delete planEdits().pay; savePlanDraft(); commitPlan(); return render(); }
    case 'plan-live': { ui.planLive = !ui.planLive; savePlanLive(); delete planEdits().everyday; savePlanDraft(); commitPlan(); return render(); }
    case 'trends': return openTrends();
    case 'sheet-close': return closeSheet();
    case 'goto': ui.tab = id; scrollTo(0, 0); return render();
    case 'cat-filter': { ui.filter = id; ui.all = false; ui.tab = 'home'; render(); const el = $('#actlist'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    case 'cat-toggle': ui.openCat = ui.openCat === id ? null : id; return render();
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
    case 'bank-open': bankUI.on = true; return bankRun('open', () => bankLoad(true));
    case 'bank-signin': return bankRun('signin', async () => { const b = await bankMod(); if (await b.signIn()) toast('Signed in'); await bankLoad(false); });
    case 'bank-signout': return bankRun('signout', async () => { const b = await bankMod(); await b.signOutNow(); bankUI.user = null; bankUI.items = []; bankUI.inbox = []; toast('Signed out'); });
    case 'bank-connect': return bankRun('connect', async () => {
      const b = await bankMod();
      const r = await b.connect();
      if (r && r.linked) {
        const n = (r.linked.accounts || []).length;
        toast(`Linked ${n} account${n === 1 ? '' : 's'}`);
        await bankLoad(false);
      } else if (r && r.exited) {
        bankUI.err = r.status === 'never opened'
          ? "Plaid Link didn't open. If your browser blocked a pop-up, allow it for this site and try again."
          : `Closed before a bank was linked (${r.status}).`;
      }
    });
    case 'bank-sync': return bankRun('sync', async () => {
      const b = await bankMod();
      const added = await syncAll(b);
      S().bankSyncAt = Date.now(); saveSettings();
      const bad = bankUI.progress.filter((p) => p.state === 'failed');
      if (bad.length) bankUI.err = `${bad.map((p) => p.name).join(', ')} couldn't be read.`;
      toast(added ? `${added} new to review` : 'Nothing new');
    });
    case 'bank-unlink': {
      if (!confirm('Unlink this bank? Anything you already accepted stays in your log.')) return;
      return bankRun('unlink', async () => { const b = await bankMod(); await b.unlink(id); await bankLoad(false); toast('Unlinked'); });
    }
    case 'billq-drop': return billqRule(id, '__skip');
    case 'payer-add': {
      const n = prompt('Who pays you? (part of the name is enough)');
      if (n && n.trim()) { S().incomePayers = [...(S().incomePayers || []), n.trim()]; saveSettings(); }
      return;
    }
    case 'payer-del': {
      const list = [...(S().incomePayers || [])];
      list.splice(i, 1);
      S().incomePayers = list; saveSettings(); render();
      return;
    }
    case 'rule-del': {
      const m = { ...(S().txMatch || {}) };
      delete m[id];
      S().txMatch = m; saveSettings(); render();
      return toast('Rule forgotten');
    }
    case 'bank-activity': return openActivity(30);
    case 'activity-days': { if (activity) openActivity(+id, activity.acct); return; }
    case 'activity-fresh': { if (activity) openActivity(activity.days, activity.acct, true); return; }
    case 'activity-acct': { if (activity) { activity.acct = id; drawActivity(); } return; }
    case 'activity-log': {
      const t = (activity && activity.rows || []).find((x) => x.id === id);
      if (!t) return;
      closeSheet();
      return openFlow({ amt: String(t.amount), note: t.name || '', date: t.date });
    }
    case 'inbox-accept': return inboxAccept(id);
    case 'inbox-drop': return bankRun('row-' + id, async () => {
      const b = await bankMod(); await b.dropInbox(id);
      bankUI.inbox = bankUI.inbox.filter((x) => x.id !== id); delete bankUI.pick[id];
    });
    case 'reimport': { const n = reimportHistory(); toast(n ? `Restored ${n} line items` : 'Everything is already imported'); return; }
  }
});

// Select the whole value when a numeric field is focused, so typing replaces it
// (no need to delete a leftover 0).
document.addEventListener('focusin', (e) => {
  if (e.target.matches('input.plancell, input.ccinput, input.fin-num, input.sheet-input, input[data-billsbal], input[data-cc], input[data-set], input[data-cat], input[data-bill], input[data-bh]')) {
    try { e.target.select(); } catch {}
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; $('#actlist').innerHTML = activityList(); }
  else if (e.target.id === 'sav-slider') slideSavings(+e.target.value);
  else if (e.target.dataset.plan) { planEdits()[e.target.dataset.plan] = parseNum(e.target.value); savePlanDraft(); planRecalc(); }
});

document.addEventListener('change', (e) => {
  const t = e.target, num = () => parseNum(t.value);
  if (t.hasAttribute('data-weeklygoal')) {
    const v = String(t.value).trim();
    S().weeklyGoal = v === '' ? null : Math.max(0, parseNum(v));
    saveSettings(false);
    planRecalc();
    // Refresh the row in place rather than redrawing the page under the tap.
    const row = $('.goalrow');
    if (row) {
      const on = weeklyGoal(S()) != null;
      row.classList.toggle('on', on);
      const sub = row.querySelector('.g-s');
      if (sub) sub.textContent = on ? 'Yours — overrides the card trim and every strategy' : 'Working it out for you';
    }
    return;
  }
  if (t.dataset.plan) { planEdits()[t.dataset.plan] = parseNum(t.value); savePlanDraft(); commitPlan(); return; }
  if (t.dataset.inboxCat) { bankUI.pick[t.dataset.inboxCat] = t.value; return; }
  if (t.dataset.billq) {
    bankUI.billpick[t.dataset.billq] = t.value;
    if (t.value) billqRule(t.dataset.billq, t.value);   // saves on pick, no second tap
    return;
  }
  if (t.dataset.acctRole) {
    const [itemId, acct] = t.dataset.acctRole.split('|');
    const item = bankUI.items.find((x) => x.itemId === itemId);
    if (item) {
      item.roles = { ...(item.roles || {}), [acct]: t.value };
      bankRun('roles', async () => { const b = await bankMod(); await b.setRoles(itemId, item.roles); await bankLoad(false); });
    }
    return;
  }
  if (t.id === 'sav-slider') { slideSavings(+t.value); saveSettings(); return; }
  if (t.dataset.set) { S()[t.dataset.set] = num(); saveSettings(); }
  else if (t.hasAttribute('data-billsbal')) { S().billsAcct = { bal: num(), asOf: today() }; saveSettings(); render(); return; }
  else if (t.dataset.cc === 'start') { S().cc = { ...S().cc, start: num(), asOf: today(), asOfAt: Date.now(), chargesAdj: 0 }; saveSettings(); }
  else if (t.dataset.cc === 'manual') { S().cc = { ...S().cc, manual: num() }; saveSettings(); }
  else if (t.dataset.splitpct || t.dataset.splitamt) {
    const side = t.dataset.splitpct || t.dataset.splitamt;
    const budget = side === 'spend' ? (S().weeklyBudget || 0) : (S().weeklySavings || 0);
    // The right-hand box is what you keep, so the percentage is how much of the
    // budget giving that away leaves behind.
    const pct = t.dataset.splitpct
      ? parseNum(t.value)
      : (budget > 0 ? ((budget - parseNum(t.value)) / budget) * 100 : 0);
    const v = Math.max(0, Math.min(100, round(pct)));
    S().cc = { ...S().cc, splitPct: { ...(S().cc.splitPct || { spend: 50, save: 50 }), [side]: v } };
    saveSettings(false); render(); return;
  }
  else if (t.dataset.cc === 'payoffBy') { S().cc = { ...S().cc, payoffBy: t.value || null }; saveSettings(); }
  else if (t.dataset.ccPay) { const e = { ...(S().cc.planEdits || {}) }; if (t.value.trim() === '') delete e[t.dataset.ccPay]; else e[t.dataset.ccPay] = num(); S().cc = { ...S().cc, planEdits: e }; saveSettings(); }
  else if (t.dataset.ovignore) { updateTx(t.dataset.ovignore, { exBudget: !t.checked }); openOverage(); render(); return; }
  else if (t.dataset.billfix) { S().bills[billEdit].amount = num(); saveSettings(); drawBillEdit(); return; }
  else if (t.hasAttribute('data-billevery')) { S().bills[billEdit].everyMonths = Math.max(1, Math.round(+t.value || 1)); saveSettings(); drawBillEdit(); render(); return; }
  else if (t.hasAttribute('data-billavg')) { S().bills[billEdit].useAvg = t.checked; saveSettings(); drawBillEdit(); render(); return; }
  else if (t.dataset.bh) { const h = (S().bills[billEdit].history || []).find((x) => x.id === t.dataset.bh); if (h) { h[t.dataset.f] = t.dataset.f === 'amount' ? num() : (t.value || h.month); saveSettings(); drawBillEdit(); } return; }
  else if (t.dataset.loanextra) { const l = loanById(t.dataset.loanextra); if (l) { l.extra = Math.max(0, num()); saveSettings(); } }
  else if (t.dataset.loanbal) { const l = loanById(t.dataset.loanbal); if (l) { const cur = loanStats(l, new Date()).balance; l.adjust = round((l.adjust || 0) + (Math.max(0, num()) - cur)); saveSettings(); } }
  else if (t.dataset.loanpay) { const [lid, date] = t.dataset.loanpay.split('|'); const l = loanById(lid); if (l) { const ex = { ...(l.extras || {}) }; if (t.value.trim() === '') delete ex[date]; else ex[date] = Math.max(0, num()); l.extras = ex; saveSettings(); } }
  else if (t.dataset.inv) { const iv = S().finance.invest, f = t.dataset.inv; iv[f] = f === 'rate' ? Math.max(0, num()) / 100 : Math.max(0, num()); saveSettings(); }
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
