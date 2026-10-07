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
export const monthlyIncome = (s) => round(s.weeklyPay * 4);
export const billsTotal = (s) => sum(s.bills.map((b) => b.amount));
export const firstTotal = (s) => sum(s.bills.filter((b) => b.day === 1).map((b) => b.amount));
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

// The everyday budget to actually hold to this week. If the chosen card-payoff
// strategy reduces spending (spend-less or split), that lower number is the budget.
export function effectiveEveryday(s, txs, now = new Date()) {
  const cp = cardPlan(s, txs, now);
  if (cp.balance <= 0) return s.weeklyBudget;
  const strat = s.cc.strategy || 'extra';
  if (strat === 'spend') return cp.options.spend.newSpend;
  if (strat === 'split') return cp.options.split.newSpend;
  return s.weeklyBudget;
}

export function weekStats(s, txs, now = new Date()) {
  const startDay = s.weekStartDay ?? 5;
  const ws = weekStart(now, startDay);
  const end = ymd(addDays(parseYmd(ws), 7));
  const ids = s.categories.filter((c) => c.weekly).map((c) => c.id);
  const spentBetween = (from, to) => sum(txs.filter((t) => t.type === 'expense' && t.date >= from && t.date < to && ids.includes(t.category)).map((t) => t.amount));
  const spent = spentBetween(ws, end);
  const base = effectiveEveryday(s, txs, now);        // strategy-adjusted everyday budget
  const trimmedByCard = round(s.weeklyBudget - base);  // >0 when the card strategy cut spending
  // Roll a previous over-spend into this week (measured against the plan budget,
  // so it doesn't compound with the card trim) unless this week was reset.
  const prevStart = weekStart(addDays(parseYmd(ws), -1), startDay);
  const prevLeft = round(s.weeklyBudget - spentBetween(prevStart, ws));
  const reset = s.weekResetAt === ws;
  const carryover = !reset && prevLeft < 0 ? prevLeft : 0;
  const budget = round(base + carryover);
  return { start: ws, end, ids, spent, baseBudget: base, planBudget: s.weeklyBudget, trimmedByCard, carryover, budget, left: round(budget - spent), reset };
}

// ---- credit card payoff ----
export function cardBalance(s, txs) {
  const { balance, asOf } = s.cc;
  if (!balance) return 0;
  const paid = sum(txs.filter((t) => t.type === 'transfer' && t.category === 'card' && (!asOf || t.date >= asOf)).map((t) => t.amount));
  return Math.max(0, round(balance - paid));
}

export function cardPlan(s, txs, now = new Date()) {
  const bal = cardBalance(s, txs);
  const ms = monthStats(s, txs, ymd(now).slice(0, 7), now);
  const weeks = ms.weeksLeft;
  const sw = standardWeek(s);
  const perWeek = round(bal / weeks);
  const extra = Math.max(0, sw.extra);   // discretionary left once everyday spending is covered
  const need = Math.max(0, round(perWeek - extra));             // what extra can't cover
  const spendCut = Math.min(need, s.weeklyBudget), saveCut = Math.min(need, s.weeklyPay ? s.weeklySavings : 0);
  const half = round(need / 2);
  const stretchWeeks = weeks + 4;
  return {
    balance: bal, weeks, perWeek, extra: round(extra), need,
    options: {
      spend: { cut: round(spendCut), newSpend: round(s.weeklyBudget - spendCut), short: round(need - spendCut) },
      save: { cut: round(saveCut), newSave: round(s.weeklySavings - saveCut), short: round(need - saveCut) },
      split: { spendCut: Math.min(half, s.weeklyBudget), saveCut: Math.min(half, s.weeklySavings), newSpend: round(s.weeklyBudget - Math.min(half, s.weeklyBudget)), newSave: round(s.weeklySavings - Math.min(half, s.weeklySavings)), short: round(need - Math.min(half, s.weeklyBudget) - Math.min(half, s.weeklySavings)) }
    },
    stretch: { weeks: stretchWeeks, perWeek: round(bal / stretchWeeks) }
  };
}

// Standard week (your plan from Settings) vs Recommended week (same pay, but
// adjusts the bills line to catch up what's still owed, and routes the extra
// money to the credit card when there's a balance).
export function weekPlan(s, txs, now = new Date()) {
  const sw = standardWeek(s);
  const ms = monthStats(s, txs, ymd(now).slice(0, 7), now);
  const cp = cardPlan(s, txs, now);

  const pay = sw.pay;                                                // always your settings income
  const bills = ms.isCurrent ? Math.max(0, round(ms.billsLeft / ms.weeksLeft)) : sw.bills;
  const groceries = sw.groceries;
  let everyday = sw.everyday, savings = sw.savings, extra, leftover;
  const strat = cp.balance > 0 ? (s.cc.strategy || 'extra') : 'none';
  const o = cp.options;

  if (cp.balance > 0) {
    // The chosen strategy decides where the card payment comes from.
    if (strat === 'spend') everyday = o.spend.newSpend;
    else if (strat === 'save') savings = o.save.newSave;
    else if (strat === 'split') { everyday = o.split.newSpend; savings = o.split.newSave; }
    extra = strat === 'stretch' ? cp.stretch.perWeek : cp.perWeek;    // Extra line = the card payment
    leftover = round(pay - bills - groceries - everyday - savings - extra);
  } else {
    extra = round(pay - bills - groceries - everyday - savings);      // just spare money
    leftover = 0;
  }

  return {
    standard: sw,
    rec: { pay, bills, groceries, everyday, savings, extra, leftover },
    strategy: strat, cardBalance: cp.balance, cardPerWeek: cp.perWeek, stretchPerWeek: cp.stretch.perWeek,
    stretchWeeks: cp.stretch.weeks, weeksLeft: ms.weeksLeft, billsLeft: ms.billsLeft, isCurrent: ms.isCurrent
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

