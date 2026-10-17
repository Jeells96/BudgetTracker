// All the budget math + the "coach" advice, as pure functions of (settings, transactions, today).
export const round = (n) => Math.round(n * 100) / 100;
const sum = (a) => round(a.reduce((s, x) => s + x, 0));
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Start of the week that `d` falls in, for a configurable first-day (0=Sun … 6=Sat; default Friday).
export const weekStart = (d, startDay = 5) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() - startDay + 7) % 7)); return ymd(x); };

export const weeklyPay = (s) => s.weeklyPay;
// How many paydays (weekStartDay, e.g. Fridays) fall in a given month — 4 or 5.
// This is the real number of paychecks / weekly periods, so monthly figures stay
// accurate on short and long months instead of a flat ×4.
export function paydaysInMonth(month, startDay = 5) {
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= dim; d++) if (new Date(y, m - 1, d).getDay() === startDay) n++;
  return n;
}
export const monthlyIncome = (s, month = ymd(new Date()).slice(0, 7)) => round(s.weeklyPay * paydaysInMonth(month, s.weekStartDay ?? 5));
// A bill's effective monthly cost: the 12-month average of logged amounts when
// "use average" is on and there's history, otherwise its fixed amount.
export function billAmount(b) {
  const h = Array.isArray(b.history) ? b.history.filter((x) => x && x.month) : [];
  if (b.useAvg && h.length) {
    const vals = [...h].sort((a, c) => a.month.localeCompare(c.month)).slice(-12).map((x) => +x.amount || 0);
    return round(vals.reduce((a, v) => a + v, 0) / vals.length);
  }
  return b.amount || 0;
}
export const billsTotal = (s) => sum(s.bills.map(billAmount));
export const firstTotal = (s) => sum(s.bills.filter((b) => b.day === 1).map(billAmount));

// Average monthly spend for a category, over the last up to 12 completed months
// of logged data (the current partial month is excluded). Used for the gas budget.
export function categoryAvg(txs, id, now = new Date()) {
  const cur = ymd(now).slice(0, 7);
  const by = {};
  txs.filter((t) => t.type === 'expense' && t.category === id && !t.exAvg).forEach((t) => { const m = t.date.slice(0, 7); by[m] = (by[m] || 0) + t.amount; });
  const months = Object.keys(by).filter((m) => m < cur).sort().slice(-12);
  return months.length ? round(months.reduce((a, m) => a + by[m], 0) / months.length) : 0;
}
// A category's effective budget: its rolling average when useAvg is on, else the fixed budget.
export function categoryBudget(s, txs, c, now = new Date()) {
  return c.useAvg ? categoryAvg(txs, c.id, now) : (c.budget || 0);
}
export const budgetTotal = (s) => sum(s.categories.map((c) => c.budget));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// The spreadsheet's own numbers ("My Page"): monthly income = weekly pay x 4,
// expected savings = income - bills - category budgets, bills per week = bills / 4.
export function baseline(s) {
  const bills = billsTotal(s), income = monthlyIncome(s), budgets = budgetTotal(s);
  const billsWk = round(bills / 4), groceriesWk = round((s.categories.find((c) => c.id === 'groceries')?.budget || 0) / 4);
  return {
    income, bills, budgets, firstOfMonth: firstTotal(s),
    expectedSavings: round(income - bills - budgets),
    billsPerWeek: billsWk, leftoverAfterBills: round(s.weeklyPay - billsWk),
    // "Standard Week" panel
    week: { pay: s.weeklyPay, bills: billsWk, savings: s.weeklySavings, groceries: groceriesWk,
            extra: round(s.weeklyPay - billsWk - s.weeklySavings - groceriesWk) }
  };
}

// The settings-driven "standard week": take-home pay split into commitments and
// a leftover pool that divides between savings and extra spending.
// Per-paycheck plan on a STEADY 4-paycheck cadence (your spreadsheet model), so the
// weekly plan and the card payoff don't change just because a month has a 5th Friday.
// A 5th paycheck is treated as a bonus (extra money for savings), handled in the
// monthly views — not here. Monthly bills/groceries ÷ 4 = the standing weekly set-aside.
export function standardWeek(s) {
  const pay = s.weeklyPay;
  const bills = round(billsTotal(s) / 4);
  const groceries = round((s.categories.find((c) => c.id === 'groceries')?.budget || 0) / 4);
  const everyday = s.weeklyBudget;
  const pool = round(pay - bills - groceries - everyday);          // leftover for savings + extra
  const savings = Math.max(0, Math.min(s.weeklySavings, Math.max(0, pool)));
  const extra = round(pool - savings);
  return { pay, bills, groceries, everyday, pool, savings, extra };
}

export function monthStats(s, txs, month, now = new Date()) {
  const list = txs.filter((t) => t.date.startsWith(month));
  const exp = list.filter((t) => t.type === 'expense');
  const byCat = {};
  s.categories.forEach((c) => { byCat[c.id] = sum(exp.filter((t) => t.category === c.id).map((t) => t.amount)); });
  const moved = (id) => sum(list.filter((t) => t.type === 'transfer' && t.category === id).map((t) => t.amount));
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const isCurrent = ymd(now).startsWith(month);
  const isPast = !isCurrent && month < ymd(now).slice(0, 7);
  const day = isCurrent ? now.getDate() : isPast ? dim : 0;
  const daysLeft = isCurrent ? dim - day + 1 : isPast ? 0 : dim;
  const bills = billsTotal(s), first = firstTotal(s);
  const billsIn = moved('bills');
  return {
    list, byCat, dim, day, daysLeft, isCurrent, isPast,
    weeksLeft: Math.max(1, Math.ceil(daysLeft / 7)),
    spent: sum(exp.map((t) => t.amount)), budget: budgetTotal(s),
    income: sum(list.filter((t) => t.type === 'income').map((t) => t.amount)),
    billsIn, cardPaid: moved('card'), savingsIn: moved('savings'),
    billsTotal: bills, billsLeft: Math.max(0, round(bills - billsIn)),
    firstTotal: first, firstLeft: Math.max(0, round(first - billsIn))
  };
}

// The everyday spending budget held to each week (the card no longer trims it —
// everyday money flows to the card, but the budget amount itself is unchanged).
// Your everyday weekly budget after the card strategy. "Spend less" / "Split" cut
// it to free money for the card; the cut amount is what goes to the card that week.
export function effectiveEveryday(s, txs = [], now = new Date()) {
  const base = s.weeklyBudget;
  const strat = s.cc && s.cc.strategy;
  if (strat !== 'spend' && strat !== 'split') return base;
  const cp = cardPlan(s, txs, now);
  if (cp.balance <= 0) return base;
  if (strat === 'spend') return cp.options.spend.newSpend;
  if (strat === 'split') return cp.options.split.newSpend;
  return base;
}

export function weekStats(s, txs, now = new Date()) {
  const startDay = s.weekStartDay ?? 5;
  const ws = weekStart(now, startDay);
  const end = ymd(addDays(parseYmd(ws), 7));
  const ids = s.categories.filter((c) => c.weekly).map((c) => c.id);
  const spentBetween = (from, to) => sum(txs.filter((t) => t.type === 'expense' && !t.exBudget && t.date >= from && t.date < to && ids.includes(t.category)).map((t) => t.amount));
  const spent = spentBetween(ws, end);
  const base = effectiveEveryday(s, txs, now);               // budget after the card trim
  const trimmedByCard = Math.max(0, round(s.weeklyBudget - base));
  // Roll a previous over-spend (vs the same trimmed budget) into this week unless reset.
  const prevStart = weekStart(addDays(parseYmd(ws), -1), startDay);
  const prevLeft = round(base - spentBetween(prevStart, ws));
  const reset = s.weekResetAt === ws;
  const carryover = !reset && prevLeft < 0 ? prevLeft : 0;
  const overage = prevLeft < 0 ? round(-prevLeft) : 0;        // last week's over-spend (raw)
  const forgiven = reset && overage > 0 ? overage : 0;        // over-spend you chose to forgive
  const budget = round(base + carryover);
  return { start: ws, end, ids, spent, baseBudget: base, planBudget: s.weeklyBudget, trimmedByCard, carryover, overage, forgiven, budget, left: round(budget - spent), reset };
}

// ---- credit card ----
// Statement closes on the 15th (30-day months) or 16th (31-day months).
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const closeDay = (y, m) => (daysIn(y, m) >= 31 ? 16 : 15);
export function cycleWindow(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const thisClose = closeDay(y, m);
  let startD, endD;
  if (d <= thisClose) {
    const pm = m - 1 < 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    startD = new Date(pm.y, pm.m, closeDay(pm.y, pm.m) + 1);
    endD = new Date(y, m, thisClose);
  } else {
    startD = new Date(y, m, thisClose + 1);
    const nm = m + 1 > 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
    endD = new Date(nm.y, nm.m, closeDay(nm.y, nm.m));
  }
  return { start: ymd(startD), end: ymd(endD), endDay: endD.getDate() };
}

// What the app computes the balance to be: starting balance + credit-card
// purchases logged since the baseline date − card payments since then.
export function cardDetail(s, txs) {
  const start = s.cc.start || 0, asOf = s.cc.asOf;
  const rawCredit = asOf ? sum(txs.filter((t) => t.type === 'expense' && t.pay !== 'cash' && t.date >= asOf).map((t) => t.amount)) : 0;
  const adj = s.cc.chargesAdj || 0;                 // manual correction; new purchases still add on top
  const credit = round(rawCredit + adj);
  const paid = asOf ? sum(txs.filter((t) => t.type === 'transfer' && t.category === 'card' && t.date >= asOf).map((t) => t.amount)) : 0;
  return { start, asOf, rawCredit, adj, credit, paid, computed: Math.max(0, round(start + credit - paid)) };
}
export const cardComputed = (s, txs) => cardDetail(s, txs).computed;

// Carry the balance across statement cycles: once a statement has closed, fold
// that cycle's net charges into the starting balance and advance the baseline to
// the new cycle. The Current balance is unchanged — only "purchases since" resets
// to the new cycle. Returns a new cc to save, or null if nothing to roll.
export function rollCardBaseline(s, txs, now = new Date()) {
  const cc = s.cc;
  if (!cc || !cc.asOf) return null;
  const cyc = cycleWindow(now).start;
  if (cc.asOf >= cyc) return null;                 // baseline already in the current cycle
  const creditBefore = sum(txs.filter((t) => t.type === 'expense' && t.pay !== 'cash' && t.date >= cc.asOf && t.date < cyc).map((t) => t.amount));
  const paidBefore = sum(txs.filter((t) => t.type === 'transfer' && t.category === 'card' && t.date >= cc.asOf && t.date < cyc).map((t) => t.amount));
  const newStart = Math.max(0, round((cc.start || 0) + creditBefore + (cc.chargesAdj || 0) - paidBefore));
  return { ...cc, start: newStart, asOf: cyc, chargesAdj: 0 };
}

// The balance the rest of the app uses: computed in auto mode, your typed number in manual.
export function cardBalance(s, txs) {
  return s.cc.mode === 'manual' ? Math.max(0, round(s.cc.manual || 0)) : cardComputed(s, txs);
}

// Payment-plan balance: everyday credit purchases are already funded by the
// weekly spending allocation. They must NOT re-amortize card payments when
// logged. Only the credit-funded portion of a COMPLETED week's overspend is
// added to the payment plan, starting with the following week.
// The actual card balance (cardBalance) still includes every credit purchase.
export function paymentPlanBalance(s, txs, now = new Date()) {
  const actual = cardBalance(s, txs);
  if (s.cc.mode === 'manual' || !s.cc.asOf) return actual;
  const ids = new Set(s.categories.filter(c => c.weekly).map(c => c.id));
  const startOfCurrentWeek = weekStart(now, s.weekStartDay ?? 5);
  const weeks = new Map();
  for (const t of txs) {
    if (t.type !== 'expense' || t.exBudget || !ids.has(t.category)) continue;
    const wk = weekStart(parseYmd(t.date), s.weekStartDay ?? 5);
    const item = weeks.get(wk) || { spent: 0, credit: 0 };
    item.spent += t.amount;
    if (t.pay !== 'cash' && t.date >= s.cc.asOf) item.credit += t.amount;
    weeks.set(wk, item);
  }
  let protectedCharges = 0;
  for (const [wk, item] of weeks) {
    const excess = wk < startOfCurrentWeek
      ? Math.max(0, round(item.spent - s.weeklyBudget)) : 0;
    protectedCharges += Math.max(0, round(item.credit - Math.min(item.credit, excess)));
  }
  return Math.max(0, round(actual - protectedCharges));
}

// ---- paydays ----
// The upcoming payday on-or-after today (today counts if today is a payday).
export function nextPayday(now = new Date(), startDay = 5) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((startDay - d.getDay() + 7) % 7));
  return d;
}
// The next payday strictly AFTER today (what this payday's funding must last until).
export function nextPaydayAfter(now = new Date(), startDay = 5) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let off = (startDay - d.getDay() + 7) % 7; if (off === 0) off = 7;
  d.setDate(d.getDate() + off);
  return d;
}

// Forward look at the bills account from a MANUAL balance you typed (as of a date).
// The goal is to have the NEXT 1st-of-month bills funded before the 1st, so the
// horizon runs from the as-of date through that 1st: the bills still due this month
// PLUS next month's 1st-of-month group. The Fridays left this month are the chances
// to fund them, so it gives the weekly transfer needed and compares it to your plan.
export function billsProjection(s, txs = [], now = new Date()) {
  const startDay = s.weekStartDay ?? 5;
  const acct = s.billsAcct || {};
  const hasBal = acct.bal != null && acct.asOf;
  // Forward-looking from TODAY (so "Fridays left" and "bills still due" are current),
  // even if the balance you typed is a few days old. We flag that staleness instead.
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const refDay = ref.getDate();
  const staleDays = hasBal ? Math.round((ref - parseYmd(acct.asOf)) / 86400000) : 0;
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const firstDue = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);   // next 1st-of-month
  const monthName = ref.toLocaleDateString('en-US', { month: 'long' });
  const nextMonthName = firstDue.toLocaleDateString('en-US', { month: 'long' });
  // This month's bills still to come (day not yet passed), then next month's 1st group.
  const upList = s.bills.filter((b) => b.day > refDay).sort((a, b) => a.day - b.day)
    .map((b) => ({ name: b.name, day: b.day, amount: round(billAmount(b)), when: 'this' }));
  const firstBills = round(firstTotal(s));
  if (firstBills > 0.005) upList.push({ name: `${nextMonthName} 1st bills`, day: 1, amount: firstBills, when: 'first' });
  const upcoming = sum(upList.map((b) => b.amount));
  // Fridays (paydays) left this month — the chances to move money in before the 1st.
  // If you've already made this week's bills transfer, don't count this Friday.
  const base = nextPayday(ref, startDay);
  const prevP = ymd(addDays(base, -7));
  const movedThisWeek = sum(txs.filter((t) => t.type === 'transfer' && t.category === 'bills' && t.date > prevP && t.date <= ymd(base)).map((t) => t.amount));
  let d = movedThisWeek > 0.005 ? addDays(base, 7) : base;
  let fridays = 0, guard = 0;
  while (d <= monthEnd && guard++ < 10) { fridays++; d = addDays(d, 7); }
  const bal = hasBal ? round(acct.bal) : 0;
  const shortfall = Math.max(0, round(upcoming - bal));
  const surplus = Math.max(0, round(bal - upcoming));
  const weeklyNeeded = fridays > 0 ? round(shortfall / fridays) : shortfall;
  const onTable = standardWeek(s).bills;
  const diff = round(weeklyNeeded - onTable);
  // If you stick to your plan (move onTable every Friday), where do you end up vs
  // what's needed by the 1st? Positive = overfunded by this much (you can move less).
  const overfund = round(bal + onTable * fridays - upcoming);
  return {
    hasBal, asOf: acct.asOf, staleDays, bal, monthName, nextMonthName, monthEnd: ymd(monthEnd), firstDue: ymd(firstDue), refDay,
    upcoming: round(upcoming), firstBills, upList,
    fridays, shortfall, surplus, weeklyNeeded, onTable, diff, overfund, covered: shortfall <= 0.005
  };
}

// Is this week's payday already covered? True when you've made a card payment in
// the run-up to it (the app "just knows"), unless you told it more is coming for
// this payday. Returns { paid, payday, amount } for the upcoming payday.
export function weekPaidState(s, txs, now = new Date(), startDay = 5) {
  const base = nextPayday(now, startDay);
  const payday = ymd(base);
  const prevPayday = ymd(addDays(base, -7));
  const amount = sum(txs.filter((t) => t.type === 'transfer' && t.category === 'card' && t.date > prevPayday && t.date <= payday).map((t) => t.amount));
  const flag = s.cc && s.cc.paidThrough;
  if (flag === 'more:' + payday) return { paid: false, payday, amount: round(amount) };   // you said more is coming
  const paid = flag === payday || amount > 0.005;                                          // explicitly marked, or auto-detected
  return { paid, payday, amount: round(amount) };
}
// The first payday the card plan still has to pay. Normally the upcoming payday,
// but if this week's payday is already covered it's the next one — so an over/
// underpayment this week redistributes across what's left.
export function firstUnpaidPayday(s, txs, now = new Date(), startDay = 5) {
  const w = weekPaidState(s, txs, now, startDay);
  return w.paid ? addDays(parseYmd(w.payday), 7) : parseYmd(w.payday);
}
// Paydays (weekStartDay) remaining this month, from `from` onward.
export function paydaysLeft(now = new Date(), startDay = 5, from = null) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  let d = from || nextPayday(now, startDay), n = 0, guard = 0;
  while (d <= end && guard++ < 10) { n++; d = addDays(d, 7); }
  return Math.max(1, n);
}
// Remaining UNPAID paydays this month (skips a week you've already paid for).
export function remainingPaydays(s, txs, now = new Date(), startDay = 5) {
  return paydaysLeft(now, startDay, firstUnpaidPayday(s, txs, now, startDay));
}
// A dated payment schedule: the balance split evenly across `weeks` paydays,
// starting from `start` (a Date; defaults to the upcoming payday). Splitting the
// remaining balance each step self-corrects rounding — no stranded penny at the end.
export function paymentSchedule(bal, weeks, now = new Date(), startDay = 5, start = null) {
  const payments = [];
  if (bal > 0 && weeks > 0) {
    let rem = round(bal), d = start || nextPayday(now, startDay);
    for (let i = 0; i < weeks && rem > 0.005; i++) {
      const amount = round(rem / (weeks - i));
      payments.push({ date: ymd(d), amount });
      rem = round(rem - amount);
      d = addDays(d, 7);
    }
  }
  return { payments, weeks: payments.length, multi: payments.length > 1, payoffDate: payments.length ? payments[payments.length - 1].date : null };
}

// Card payoff: spread the CURRENT balance across the paydays left this month. The
// money comes from your leftover; if that's short, the strategy frees more (spend/
// save/split) or you stretch it longer. Everyday spending is committed, NOT a source.
// Over/underpaying one week redistributes automatically: the balance already reflects
// the payment, and the divisor drops the week you marked paid.
// When the card should be paid off by: your custom date if set, else the end of
// this month (+4 weeks if the "stretch" strategy is picked).
export function payoffEnd(s, now = new Date()) {
  if (s.cc && s.cc.payoffBy) return parseYmd(s.cc.payoffBy);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return (s.cc && s.cc.strategy === 'stretch') ? addDays(monthEnd, 28) : monthEnd;
}
// Every payday from the first unpaid one through the payoff-by date (at least one).
export function paydayDates(s, txs, now = new Date(), startDay = 5) {
  const start = firstUnpaidPayday(s, txs, now, startDay);
  const end = payoffEnd(s, now);
  const dates = []; let d = new Date(start);
  while (dates.length < 60) { dates.push(ymd(d)); const nd = addDays(d, 7); if (nd > end) break; d = nd; }
  return dates;
}
// The dated payoff schedule: manual per-payday edits (cc.planEdits) are honored, and
// the rest of the balance is split evenly over the remaining auto paydays. A payday
// you've already covered this week shows on top as a completed row.
export function cardSchedule(s, txs, now = new Date()) {
  const startDay = s.weekStartDay ?? 5;
  const bal = paymentPlanBalance(s, txs, now);
  const dates = paydayDates(s, txs, now, startDay);
  const edits = (s.cc && s.cc.planEdits) || {};
  const man = {}; let manualSum = 0;
  for (const dt of dates) if (edits[dt] != null) { man[dt] = Math.max(0, round(edits[dt])); manualSum += man[dt]; }
  const autoCount = dates.filter((dt) => man[dt] == null).length;       // paydays still auto-split
  const autoPerWeek = autoCount > 0 ? round(Math.max(0, bal - manualSum) / autoCount) : 0;
  let remAuto = Math.max(0, round(bal - manualSum));
  let autoLeft = autoCount;
  const payments = [];
  for (const dt of dates) {
    if (man[dt] != null) payments.push({ date: dt, amount: man[dt], manual: true });
    else { const amt = autoLeft > 0 ? round(remAuto / autoLeft) : 0; payments.push({ date: dt, amount: amt }); remAuto = round(remAuto - amt); autoLeft--; }
  }
  const wps = weekPaidState(s, txs, now, startDay);
  if (wps.paid && (wps.amount > 0.005 || edits[wps.payday] != null)) {
    const amt = edits[wps.payday] != null ? Math.max(0, round(edits[wps.payday])) : wps.amount;
    payments.unshift({ date: wps.payday, amount: amt, paid: true, manual: edits[wps.payday] != null });
  }
  const upcoming = payments.filter((p) => !p.paid);
  return {
    payments, balance: bal, weeks: upcoming.length, multi: upcoming.length > 1,
    firstPay: upcoming.length ? upcoming[0].amount : 0,
    autoWeeks: autoCount, autoPerWeek,                                  // ongoing weekly rate (skips paid/zeroed weeks)
    payoffDate: upcoming.length ? upcoming[upcoming.length - 1].date : null,
    end: ymd(payoffEnd(s, now))
  };
}

export function cardPlan(s, txs, now = new Date()) {
  const bal = paymentPlanBalance(s, txs, now);
  const sch = cardSchedule(s, txs, now);
  const sw = standardWeek(s);
  // Size everything off the actual ongoing weekly payment (balance ÷ the paydays
  // still left to auto-pay — skips a week you've already paid or zeroed out).
  const weeks = Math.max(1, sch.autoWeeks);
  const perWeek = sch.autoPerWeek;
  const extra = Math.max(0, sw.extra);                 // leftover after everyday spending
  const need = Math.max(0, round(perWeek - extra));    // what leftover can't cover
  const spendCut = Math.min(need, s.weeklyBudget), saveCut = Math.min(need, s.weeklySavings);
  const half = round(need / 2);
  const stretchWeeks = weeks + 4;
  return {
    balance: bal, weeks, perWeek, extra: round(extra), need,
    options: {
      spend: { cut: round(spendCut), newSpend: round(s.weeklyBudget - spendCut), short: round(need - spendCut) },
      save: { cut: round(saveCut), newSave: round(s.weeklySavings - saveCut), short: round(need - saveCut) },
      split: { newSpend: round(s.weeklyBudget - Math.min(half, s.weeklyBudget)), newSave: round(s.weeklySavings - Math.min(half, s.weeklySavings)), short: round(need - Math.min(half, s.weeklyBudget) - Math.min(half, s.weeklySavings)) }
    },
    stretch: { weeks: stretchWeeks, perWeek: round(bal / stretchWeeks) }
  };
}

// Standard week (your plan from Settings) vs Recommended week:
//  - "To bills account" = what to move this payday to stay covered to next Friday
//  - The card payment comes from your chosen strategy; everyday spending stays put
export function weekPlan(s, txs, now = new Date()) {
  const sw = standardWeek(s);
  const bt = billsProjection(s, txs, now);
  const ms = monthStats(s, txs, ymd(now).slice(0, 7), now);
  const cp = cardPlan(s, txs, now);
  const startDay = s.weekStartDay ?? 5;

  const pay = sw.pay;
  const bills = sw.bills;   // the plan's "To bills account" stays your standard amount
  const groceries = sw.groceries;
  let everyday = sw.everyday, savings = sw.savings, extra, leftover;
  const strat = cp.balance > 0 ? (s.cc.strategy || 'extra') : 'none';
  const o = cp.options;

  const sch = cardSchedule(s, txs, now);
  if (cp.balance > 0) {
    if (strat === 'spend') everyday = o.spend.newSpend;
    else if (strat === 'save') savings = o.save.newSave;
    else if (strat === 'split') { everyday = o.split.newSpend; savings = o.split.newSave; }
    extra = sch.autoPerWeek;                                        // ongoing weekly card payment (skips a paid/zeroed week)
    leftover = round(pay - bills - groceries - everyday - savings - extra);
  } else {
    extra = round(pay - bills - groceries - everyday - savings);     // just spare money
    leftover = 0;
  }

  return {
    standard: sw,
    rec: { pay, bills, groceries, everyday, savings, extra, leftover },
    strategy: strat, cardBalance: cp.balance, cardPerWeek: cp.perWeek, stretchWeeks: cp.stretch.weeks,
    bt, sch, isCurrent: ms.isCurrent
  };
}

// Month-by-month totals for the Trends view, plus averages across months with data.
export function trends(s, txs) {
  const by = {};
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = (by[m] ||= { month: m, spent: 0, savings: 0, income: 0, bills: 0, card: 0 });
    if (t.type === 'expense') b.spent += t.amount;
    else if (t.type === 'income') b.income += t.amount;
    else if (t.category === 'savings') b.savings += t.amount;
    else if (t.category === 'bills') b.bills += t.amount;
    else if (t.category === 'card') b.card += t.amount;
  }
  const months = Object.values(by).map((b) => ({
    month: b.month, spent: round(b.spent), savings: round(b.savings), income: round(b.income), bills: round(b.bills), card: round(b.card)
  })).sort((a, b) => b.month.localeCompare(a.month));
  const n = months.length || 1;
  const avg = (k) => round(months.reduce((a, m) => a + m[k], 0) / n);
  return { months, avg: { spent: avg('spent'), savings: avg('savings'), income: avg('income'), bills: avg('bills'), card: avg('card') }, count: months.length };
}

