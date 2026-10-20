import { store, loadLocal, saveSettings, addTx, updateTx, deleteTx, uid, initFirebase, reimportHistory } from './store.js?v=65';
import { TRANSFERS } from './defaults.js?v=65';
import { round, ymd, parseYmd, addDays, weekStart, monthStats, weekStats, weekPaidState, standardWeek, paydaysInMonth, billsTotal, firstTotal, billAmount, categoryAvg, categoryBudget, cardBalance, cardDetail, cycleWindow, rollCardBaseline, billsProjection, cardPlan, paymentSchedule, nextPayday, weekPlan, monthlyIncome, trends, loanStats, investFV, addMonthsYmd } from './calc.js?v=65';

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

const ui = { tab: 'home', month: monthKey(new Date()), filter: 'all', all: false, q: '', planDraft: {}, planLive: true, openCat: null, openLoan: null };
try { ui.planDraft = JSON.parse(localStorage.getItem('plan-draft') || '{}') || {}; } catch { ui.planDraft = {}; }
try { ui.planLive = JSON.parse(localStorage.getItem('plan-live') ?? 'true'); } catch { ui.planLive = true; }
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
  if (pendingPromptShown || !(S().pending || []).length || !$('#sheet').hidden) return;
  pendingPromptShown = true;
  openPending();
}
function render() {
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
      ? `<div><b>${money(bal)}</b><span>${cardRet > 0 ? `Card · ${money(cardRet)} returning` : 'Card balance'}</span></div>`
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
    ? `<div class="rollover">Spend-less plan · ${money(ws.baseBudget)} this week, ${money(ws.trimmedByCard)} freed for the card.</div>`
    : '';
  const rollover = weekly && ws.carryover < 0
    ? `<div class="rollover">You went ${money(-ws.carryover)} over last week, so this week is trimmed to ${money(ws.budget)}. <button class="link" data-act="overage-view">Review overages</button> · <button class="link" data-act="week-reset">Forgive all</button></div>`
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
      <button class="btn block" data-act="track-later">🕗 Track later</button>
      <button class="btn block" data-act="returns-view">↩︎ Returns${(s.returns || []).length ? ` · ${(s.returns || []).length}` : ''}</button>
    </div>
    <button class="btn block ${pend.length ? 'primary' : ''}" data-act="finish-loose" ${pend.length ? '' : 'disabled'} style="margin-top:10px">✓ Finish loose logs${pend.length ? ` (${pend.length})` : ''}</button>
    ${activityBlock()}`;
}

function txRow(t) {
  let icon, label, sub, amt;
  if (t.type === 'income') { icon = '💰'; label = t.note || 'Income'; sub = 'Income'; amt = `<div class="amt in">+${money(t.amount)}</div>`; }
  else if (t.type === 'transfer') { const x = tfer(t.category); const nm = x?.name || t.category; icon = x?.emoji || '🔁'; label = t.note || nm; sub = t.note ? nm : ''; amt = `<div class="amt xfer">${money(t.amount)}</div>`; }
  else { const c = cat(t.category); icon = c ? c.emoji : '🧾'; label = t.note || (c ? c.name : 'Purchase'); sub = c ? c.name : t.category; amt = `<div class="amt">${money(t.amount)}</div>`; }
  const ccDot = (t.type === 'expense' && t.pay === 'credit' ? ' <span class="cc-dot" title="Credit card">💳</span>' : '') + (t.exAvg ? ' <span class="ex-tag" title="Excluded from average">excl. avg</span>' : '');
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


function payoffScheduleHTML(sch) {
  if (!sch.payments.length) return '';
  const thisFri = ymd(nextPayday(new Date(), S().weekStartDay ?? 5));
  const label = (d) => d === thisFri ? 'This Fri' : parseYmd(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
    ${opt('split', 'Split both', `Everyday ${money(o.split.newSpend)} · savings ${money(o.split.newSave)}${o.split.short > 0 ? `, still ${money(o.split.short)} short` : ''}`)}
    ${opt('stretch', 'Stretch payoff', `${money(cp.stretch.perWeek)}/wk over ${cp.stretch.weeks} weeks — pay off a bit later`)}
  </div>`;
}

function cardSection() {
  const s = S(), now = new Date();
  const cc = s.cc, auto = cc.mode !== 'manual';
  const det = cardDetail(s, store.txs);
  const cyc = cycleWindow(now);
  const wp = weekPlan(s, store.txs, now);
  const cp = cardPlan(s, store.txs, now);
  const strat = cc.strategy || 'extra';
  const diff = round((cc.manual || 0) - det.computed);
  const hasEdits = cc.planEdits && Object.keys(cc.planEdits).length > 0;

  const planBlock = wp.cardBalance > 0 ? `
    <div class="week"><span class="muted">Pay off ${money(wp.cardBalance)}</span><b>${money(cp.perWeek)}/Friday</b></div>
    <div class="field" style="margin:8px 0 2px"><label>Pay off by<br><span class="muted" style="font-size:.8rem">${cc.payoffBy ? 'custom date' : 'default: end of this month'}</span></label>
      <input type="date" value="${cc.payoffBy || ''}" min="${today()}" data-cc="payoffBy"></div>
    <details class="collapse"><summary>Where the extra comes from · <b>${{ extra: 'Use leftover', spend: 'Spend less', save: 'Save less', split: 'Split both', stretch: 'Stretch payoff' }[strat] || 'Use leftover'}</b></summary>
      ${strategyPicker(cp, strat)}</details>
    ${payoffScheduleHTML(wp.sch)}
    ${hasEdits ? `<button class="btn block" data-act="cc-edits-reset" style="margin-top:8px">↺ Clear manual payment edits</button>` : ''}
    <hr class="sep">` : '';

  const modeToggle = `<div class="seg">
    <button data-act="cc-mode" data-id="auto" class="${auto ? 'on' : ''}">Auto-track</button>
    <button data-act="cc-mode" data-id="manual" class="${!auto ? 'on' : ''}">Manual</button></div>`;

  let setup;
  if (auto) {
    setup = `
      <div class="field"><label>Starting balance<br><span class="muted" style="font-size:.8rem">${det.asOf ? 'as of ' + shortDate(parseYmd(det.asOf)) : 'set this to start tracking'}</span></label>
        <input type="text" inputmode="decimal" value="${fmtNum(cc.start || '')}" placeholder="0" data-cc="start"></div>
      <div class="ccbreak">
        <div><span>Starting balance</span><b>${money(det.start)}</b></div>
        <div><span>+ purchases since${det.adj ? ' <small>(adjusted)</small>' : ''}</span>
          <span class="ccedit">${det.adj ? '<button class="link" data-act="cc-charges-reset" title="Back to tracked">↺</button>' : ''}<input class="ccinput" type="text" inputmode="decimal" value="${fmtNum(det.credit)}" data-cc="charges"></span></div>
        <div><span>− card payments since</span><b>${money(det.paid)}</b></div>
        ${det.pendRet > 0.005 ? `<div><span>− planned returns</span><b>${money(det.pendRet)}</b></div>` : ''}
        <div class="tot"><span>Current balance</span><b>${money(det.computed)}</b></div></div>
      <button class="btn block" data-act="cc-reset" style="margin-top:8px">↺ Reset balance to actual</button>`;
  } else {
    setup = `
      <div class="field"><label>Your current balance</label><input type="text" inputmode="decimal" value="${fmtNum(cc.manual || '')}" placeholder="0" data-cc="manual"></div>
      <div class="ccbreak"><div class="tot"><span>App estimate</span><b>${money(det.computed)}</b></div>
        <div><span>Difference</span><b class="${diff ? 'negtext' : ''}">${diff === 0 ? 'matches' : (diff > 0 ? '+' : '−') + money(Math.abs(diff)).replace('-', '')}</b></div></div>`;
  }

  // Planned returns that will credit this card — shown right alongside the balance.
  const cardRets = (s.returns || []).filter((r) => (r.pay || 'credit') !== 'cash');
  const retTotal = round(cardRets.reduce((a, r) => a + Math.abs(r.amount || 0), 0));
  const retBlock = cardRets.length ? `
    <button class="retstrip" data-act="returns-view">
      <span class="rs-n">${cardRets.length} planned return${cardRets.length === 1 ? '' : 's'} coming back to this card</span>
      <b>−${money(retTotal)}</b><span class="rs-go">Review ›</span></button>
    <div class="retlist">${cardRets.map((r) => `<div><span>${esc(r.note || cat(r.category)?.name || 'Purchase')}</span><b>−${money(Math.abs(r.amount))}</b></div>`).join('')}</div>` : '';

  return `<div class="card">
    ${wp.cardBalance > 0 ? planBlock : '<div class="note" style="margin:0 0 8px">No balance to pay off right now.</div>'}
    ${retBlock}
    ${modeToggle}
    ${setup}
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
function planValues() {
  const wp = weekPlan(S(), store.txs);
  const rc = wp.rec, d = ui.planDraft || {};
  const hasCard = wp.cardBalance > 0;
  const liveSpend = round(weekStats(S(), store.txs).spent);
  const live = ui.planLive !== false;
  const rec = live ? { ...rc, everyday: liveSpend } : rc;   // live = actual spent; off = budgeted
  const v = (f) => (d[f] !== undefined ? d[f] : rec[f]);
  const pay = v('pay'), bills = v('bills'), groceries = v('groceries'), everyday = v('everyday'), savings = v('savings'), extra = v('extra');
  const leftover = round(pay - bills - groceries - everyday - savings - extra);
  return { wp, hasCard, live, liveSpend, budgetSpend: rc.everyday, pay, bills, groceries, everyday, savings, extra, leftover };
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
  const edited = Object.keys(ui.planDraft || {}).length;
  const stdVal = { pay: st.pay, bills: st.bills, groceries: st.groceries, everyday: st.everyday, savings: st.savings, extra: st.extra };
  const edq = (field) => ui.planDraft[field] !== undefined;    // has a what-if edit?
  // Always show the reset-to-recommended ↺ (consistent columns + resettable even with a custom value).
  const resetBtn = (field) => `<button class="cellx" data-act="plan-reset-field" data-id="${field}" title="Reset to recommended">↺</button>`;
  const erow = (label, field, extra = '') => `<div class="trow"><span>${label}</span><span class="b">${money(stdVal[field])}</span><span class="n"><input class="plancell" data-plan="${field}" type="text" inputmode="decimal" placeholder="0" value="${fmtNum(p[field] || '')}">${resetBtn(field)}<button class="cellx" data-act="plan-clear" data-id="${field}" title="Clear">✕</button></span></div>${extra}`;

  const stratLabel = { extra: 'from leftover', spend: 'spending less', save: 'saving less', split: 'splitting the difference', stretch: 'stretching the payoff', none: '' }[wp.strategy];
  const cardNote = sch.balance > 0
    ? `Card ${money(sch.balance)} · <b>${money(rc.extra)}</b> this Friday${sch.multi ? ` · clear by ${moDay(sch.payoffDate)}` : ''}`
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

  const plannerBody = `
    <div class="card plan-table">
      <div class="trow head"><span></span><span class="b">Standard</span><span class="n">Recommended</span></div>
      ${erow('Paycheck', 'pay')}
      ${erow('To bills account', 'bills', bt.hasBal ? `<div class="rowact"><button class="chipbtn" data-act="plan-bills-needed" data-id="${bt.weeklyNeeded}">Use needed · ${money(bt.weeklyNeeded)}</button></div>` : '')}
      ${erow('Groceries', 'groceries')}
      ${spendCardGroup}
      ${erow('Savings', 'savings')}
      <div class="trow ${p.leftover < 0 ? 'neg' : 'total'}" id="plan-leftover-row"><span>Leftover / extra</span><span class="b">${money(p.hasCard ? st.extra : 0)}</span><span class="n" id="plan-leftover">${money(p.leftover)}</span></div>
    </div>
    <div class="callout ${p.leftover < 0 ? 'bad' : 'good'}" id="plan-callout">${calloutHTML(p.leftover)}</div>
    <button class="btn block" id="plan-reset-btn" data-act="plan-reset" ${edited ? '' : 'hidden'}>↺ Reset to recommended</button>
    ${cardNote ? `<p class="note">${cardNote}</p>` : ''}`;

  // Each area is a collapsible section. The weekly planner is open by default; the
  // rest start collapsed. (Native <details>, so open/closed is remembered per tap.)
  const sec = (title, body, open = false) => `<details class="psec"${open ? ' open' : ''}><summary><span class="psec-t">${title}</span><span class="psec-caret">›</span></summary><div class="psec-body">${body}</div></details>`;
  const billsAcctBody = billsAcctCard(s) + `<button class="btn block" data-act="log-xfer" data-id="bills" style="margin-top:8px">+ Log a transfer to the bills account</button>`;
  const baTag = bt.hasBal ? (bt.covered ? ' · covered' : ' · short ' + money(bt.shortfall)) : '';

  return `${header('Plan', false)}
    ${sec("This week's plan", plannerBody, true)}
    ${sec(`Credit card · ${money(wp.cardBalance)}`, cardSection())}
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
  const spent = round(list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0));
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
    `;
}

// ---------- the sheet (add flow + edit) ----------
let flow = null, edit = null, billEdit = null, track = null, avgCat = null, returnPlan = null;
function closeSheet() { const el = $('#sheet'); el.hidden = true; el.className = 'sheet'; el.innerHTML = ''; flow = null; edit = null; billEdit = null; track = null; returnPlan = null; resetSel(); }

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
    case 'done': if (parseFloat(f.amt) > 0) addPending(f.amt); closeSheet(); render(); if (parseFloat(f.amt) > 0 || f.count) toast('Saved to finish later'); return;
  }
}

// ----- the list of loose logs to finish (also the first-open reminder) -----
function openPending() {
  const pend = (S().pending || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!pend.length) return;
  const rows = pend.map((x) => `<div class="loose-row">
    <button class="loose" data-act="finish-item" data-id="${esc(x.id)}"><div class="emoji">🕗</div>
      <div class="body"><div class="t">${money(x.amount)}</div><div class="s">added ${parseYmd(x.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · tap to finish</div></div><span class="chev">›</span></button>
    <button class="x" data-act="pending-del" data-id="${esc(x.id)}" aria-label="Discard">✕</button></div>`).join('');
  $('#sheet').innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Loose logs to finish</span><button data-act="sheet-close" aria-label="Later">✕</button></div>
    <p class="note" style="margin:0 0 10px">${pend.length} item${pend.length === 1 ? '' : 's'} to finish</p>
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
    <input type="text" inputmode="decimal" data-bh="${esc(h.id)}" data-f="amount" value="${fmtNum(h.amount)}" style="width:100px" placeholder="0">
    <button class="x" data-act="bh-del" data-id="${esc(h.id)}" aria-label="Remove">✕</button></div>`).join('') || '<div class="empty" style="padding:14px">No months logged yet.</div>';
  $('#sheet').innerHTML = `<div class="panel"><div class="head">
      <span style="width:40px"></span><span class="step">Edit ${esc(b.name)}</span><button data-act="bill-done" aria-label="Done">✕</button></div>
    <label class="editlbl">Fixed amount</label>
    <input class="sheet-input" type="text" inputmode="decimal" value="${fmtNum(b.amount)}" data-billfix="amount" ${b.useAvg ? 'disabled' : ''}>
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
  flow = { step: opts.category ? 2 : 1, category: opts.category || null, amt: opts.amt || '', note: '', date: today(), pay: 'credit', count: 0, pendingId: opts.pendingId || null, amtLocked: !!opts.amtLocked, splitting: false, hasTotal: true, total: '', splits: [], vehicle: null };
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
      const askCard = f.category === 'card' && weekPlan(S(), store.txs).sch.multi;
      const wantReturn = !f.splitting && logCat(f.category)?.type === 'expense' && $('#f-ret') && $('#f-ret').checked;
      const tx = flowCommit();
      if (askCard) return openCardAsk(tx);
      render(); toast(savedMsg(tx));
      if (wantReturn) return openReturnPlan(tx);   // jump straight into planning the return
      closeSheet(); return;
    }
    case 'again': { if (!(parseFloat(f.amt) > 0)) return; if (!gasOk(f)) return; const tx = flowCommit(); f.count += 1; f.amt = ''; f.note = ''; f.exAvg = false; f.vehicle = null; f.step = 2; drawFlow(); render(); toast(savedMsg(tx)); return; }
  }
}

// After a card payment while a payoff plan is running, ask if that's the week's payment.
function openCardAsk(tx) {
  flow = null;
  const bal = cardBalance(S(), store.txs);
  const el = $('#sheet');
  el.className = 'sheet';
  el.innerHTML = `<div class="panel"><div class="head"><span style="width:40px"></span><span class="step">Card payment</span><button data-act="cc-ask" data-id="more" aria-label="Close">✕</button></div>
    <div class="q">Paid ${money(tx.amount)} · ${money(bal)} left</div>
    <p class="note" style="margin:0 0 14px">Is that your payment for this week, or will you make more?</p>
    <button class="btn primary block" data-act="cc-ask" data-id="week">That's this week's payment</button>
    <button class="btn block" data-act="cc-ask" data-id="more" style="margin-top:8px">I'll make more this week</button></div>`;
  el.hidden = false;
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
      S().returns = [...(S().returns || []), { id: uid(), txId: r.txId, note: r.note, category: r.category, pay: r.pay, exBudget: !!r.exBudget, orig: r.orig, amount: amt, at: Date.now(), date: today() }];
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
    case 'plan-clear': { (ui.planDraft ||= {})[id] = 0; savePlanDraft(); return render(); }
    case 'cc-reset': {
      const cur = cardDetail(S(), store.txs).computed;
      const v = prompt('Actual current card balance? (re-baselines, stays on auto)', cur);
      if (v == null) return;
      const n = parseFloat(v); if (!(n >= 0)) return toast('Enter a valid balance');
      S().cc = { ...S().cc, start: round(n), asOf: today(), chargesAdj: 0 }; saveSettings(); render(); toast('Balance reset'); return;
    }
    case 'cc-pay-clear': { const e = { ...(S().cc.planEdits || {}) }; delete e[id]; S().cc = { ...S().cc, planEdits: e }; saveSettings(); return render(); }
    case 'cc-edits-reset': { S().cc = { ...S().cc, planEdits: {} }; saveSettings(); return render(); }
    case 'cc-ask': {
      const payday = ymd(nextPayday(new Date(), S().weekStartDay ?? 5));
      // "week" = this week's payment (auto-detect already covers it); "more" = keep
      // this payday in the plan because another payment is coming.
      S().cc = { ...S().cc, paidThrough: id === 'week' ? payday : 'more:' + payday };
      saveSettings(); closeSheet(); render();
      toast(id === 'week' ? "Got it — that's this week's card payment; the rest is split over the weeks left" : "Okay — add the rest when you can");
      return;
    }
    case 'cc-strategy': { S().cc = { ...S().cc, strategy: id }; saveSettings(); return render(); }
    case 'cc-mode': { S().cc = { ...S().cc, mode: id }; saveSettings(); return render(); }
    case 'cc-charges-reset': { S().cc = { ...S().cc, chargesAdj: 0 }; saveSettings(); return render(); }
    case 'catavg-view': return openCatAvg(id);
    case 'avg-toggle': { const t = store.txs.find((x) => x.id === id); if (t) updateTx(id, { exAvg: !t.exAvg }); if (avgCat) openCatAvg(avgCat); return; }
    case 'track-later': return openTrack();
    case 'returns-view': return openReturns();
    case 'return-done': {
      const r = (S().returns || []).find((x) => x.id === id);
      if (r) {
        // Log the refund as a credit so the money stays out of your totals for good.
        if (r.category) addTx({ type: 'expense', category: r.category, amount: -Math.abs(r.amount), pay: r.pay === 'cash' ? 'cash' : 'credit', note: 'Return' + (r.note ? ': ' + r.note : ''), date: today() });
        S().returns = (S().returns || []).filter((x) => x.id !== id); saveSettings();
      }
      render(); openReturns(); toast('Logged as returned'); return;
    }
    case 'return-del': { S().returns = (S().returns || []).filter((x) => x.id !== id); saveSettings(); render(); openReturns(); toast('Removed'); return; }
    case 'finish-loose': return openPending();
    case 'finish-item': { const it = (S().pending || []).find((x) => x.id === id); closeSheet(); if (it) openFlow({ amt: String(it.amount), pendingId: it.id, amtLocked: true }); return; }
    case 'pending-del': { if (confirm('Discard this loose item without logging it?')) { S().pending = (S().pending || []).filter((x) => x.id !== id); saveSettings(); render(); if ((S().pending || []).length) openPending(); else closeSheet(); } return; }
    case 'plan-reset': ui.planDraft = {}; savePlanDraft(); return render();
    case 'plan-reset-field': { if (ui.planDraft) delete ui.planDraft[id]; savePlanDraft(); return render(); }
    case 'plan-bills-needed': { (ui.planDraft ||= {}).bills = round(parseFloat(id) || 0); savePlanDraft(); return render(); }
    case 'plan-live': { ui.planLive = !ui.planLive; savePlanLive(); if (ui.planDraft) delete ui.planDraft.everyday; savePlanDraft(); return render(); }
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
  else if (e.target.dataset.plan) { (ui.planDraft ||= {})[e.target.dataset.plan] = parseNum(e.target.value); savePlanDraft(); planRecalc(); }
});

document.addEventListener('change', (e) => {
  const t = e.target, num = () => parseNum(t.value);
  if (t.id === 'sav-slider') { slideSavings(+t.value); saveSettings(); return; }
  if (t.dataset.set) { S()[t.dataset.set] = num(); saveSettings(); }
  else if (t.hasAttribute('data-billsbal')) { S().billsAcct = { bal: num(), asOf: today() }; saveSettings(); render(); return; }
  else if (t.dataset.cc === 'start') { S().cc = { ...S().cc, start: num(), asOf: today() }; saveSettings(); }
  else if (t.dataset.cc === 'manual') { S().cc = { ...S().cc, manual: num() }; saveSettings(); }
  else if (t.dataset.cc === 'payoffBy') { S().cc = { ...S().cc, payoffBy: t.value || null }; saveSettings(); }
  else if (t.dataset.ccPay) { const e = { ...(S().cc.planEdits || {}) }; if (t.value.trim() === '') delete e[t.dataset.ccPay]; else e[t.dataset.ccPay] = num(); S().cc = { ...S().cc, planEdits: e }; saveSettings(); }
  else if (t.dataset.ovignore) { updateTx(t.dataset.ovignore, { exBudget: !t.checked }); openOverage(); render(); return; }
  else if (t.dataset.cc === 'charges') { const raw = cardDetail(S(), store.txs).rawCredit; S().cc = { ...S().cc, chargesAdj: round(num() - raw) }; saveSettings(); }
  else if (t.dataset.billfix) { S().bills[billEdit].amount = num(); saveSettings(); drawBillEdit(); return; }
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
