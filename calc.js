// All the budget math + the "coach" advice, as pure functions of (settings, transactions, today).
export const round = (n) => Math.round(n * 100) / 100;
const sum = (a) => round(a.reduce((s, x) => s + x, 0));
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const weekStart = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }; // Monday

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

export function weekStats(s, txs, now = new Date()) {
  const ws = weekStart(now);
  const ids = s.categories.filter((c) => c.weekly).map((c) => c.id);
  const spent = sum(txs.filter((t) => t.type === 'expense' && t.date >= ws && ids.includes(t.category)).map((t) => t.amount));
  return { start: ws, ids, spent, budget: s.weeklyBudget, left: round(s.weeklyBudget - spent) };
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
  const b = baseline(s);
  const perWeek = round(bal / weeks);
  const extra = Math.max(0, b.week.extra - s.weeklyBudget);   // leftover once the everyday budget is covered
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

// ---- this week's plan: your spreadsheet "Standard Week" vs. what the numbers say to do now ----
export function weekPlan(s, txs, now = new Date()) {
  const b = baseline(s), ms = monthStats(s, txs, ymd(now).slice(0, 7), now), cp = cardPlan(s, txs, now);
  const billsNow = ms.isCurrent ? round(ms.billsLeft / ms.weeksLeft) : b.week.bills;
  const groceries = b.week.groceries;
  const rows = {
    bills: Math.max(0, billsNow), savings: s.weeklySavings, groceries,
    spending: s.weeklyBudget, card: cp.perWeek
  };
  const leftover = round(s.weeklyPay - rows.bills - rows.savings - rows.groceries - rows.spending - rows.card);
  return { baseline: b.week, rows, leftover };
}

// ---- the coach ----
export function coach(s, txs, now = new Date()) {
  const tips = [];
  const month = ymd(now).slice(0, 7);
  const ms = monthStats(s, txs, month, now), ws = weekStats(s, txs, now), cp = cardPlan(s, txs, now), b = baseline(s);
  const mname = now.toLocaleDateString('en-US', { month: 'long' });
  const nm = (id) => s.categories.find((c) => c.id === id)?.name || id;

  // 1. Bills account
  if (ms.billsLeft > 0) {
    const wk = round(ms.billsLeft / ms.weeksLeft);
    let body = `You still need ${money(ms.billsLeft)} in the bills account to cover all of ${mname}'s ${money(ms.billsTotal)}. Spread over the ${ms.weeksLeft} paycheck${ms.weeksLeft > 1 ? 's' : ''} left, that's ${money(wk)} each.`;
    if (ms.firstLeft > 0) body += ` The 1st-of-month bills (${money(ms.firstTotal)}) are the priority — ${money(ms.firstLeft)} still to go.`;
    tips.push({ icon: '🏦', tone: ms.firstLeft > 0 && ms.day >= 20 ? 'warn' : 'info', title: `Move ${money(wk)} to bills this payday`, body });
  } else {
    tips.push({ icon: '✅', tone: 'good', title: 'Bills are fully funded', body: `You've moved ${money(ms.billsIn)} into the bills account — that covers all ${money(ms.billsTotal)} for ${mname}.` });
  }

  // 2. Everyday spending this week
  if (ws.left < 0) tips.push({ icon: '🚨', tone: 'bad', title: `${money(-ws.left)} over this week`, body: `You've spent ${money(ws.spent)} of your ${money(ws.budget)} everyday budget (${ws.ids.map(nm).join(', ')}). Pausing eating out and "other" for the rest of the week gets you back on track.` });
  else if (ws.spent > ws.budget * 0.8) tips.push({ icon: '⚠️', tone: 'warn', title: `Only ${money(ws.left)} left this week`, body: `You've used ${Math.round((ws.spent / ws.budget) * 100)}% of the everyday budget already.` });
  else tips.push({ icon: '👍', tone: 'good', title: `${money(ws.left)} left for everyday spending`, body: `You're at ${money(ws.spent)} of ${money(ws.budget)} this week. Nice and steady.` });

  // 3. Categories over / near budget
  s.categories.filter((c) => c.budget > 0).forEach((c) => {
    const sp = ms.byCat[c.id];
    if (sp > c.budget) tips.push({ icon: '🔴', tone: 'bad', title: `${c.name} is ${money(sp - c.budget)} over`, body: `${money(sp)} spent against a ${money(c.budget)} budget for ${mname}.` });
    else if (ms.isCurrent && ms.day >= 5) {
      const proj = round((sp / ms.day) * ms.dim);
      if (proj > c.budget * 1.1) tips.push({ icon: '📈', tone: 'warn', title: `${c.name} is on pace to hit ${money(proj)}`, body: `At this rate you'll land ${money(proj - c.budget)} above your ${money(c.budget)} budget by month end. Try about ${money(round((c.budget - sp) / Math.max(1, ms.daysLeft) * 7))} a week from here.` });
    }
  });

  // 4. Credit card
  if (cp.balance > 0) {
    const o = cp.options;
    let body = `To clear ${money(cp.balance)} by the end of ${mname}, put ${money(cp.perWeek)} a week toward it (${cp.weeks} paycheck${cp.weeks > 1 ? 's' : ''} left).`;
    if (cp.need <= 0) body += ` Your leftover ${money(cp.extra)} a week covers that without cutting anything.`;
    else if (o.spend.short <= 0) body += ` Easiest path: spend ${money(o.spend.cut)} less a week (${money(o.spend.newSpend)} instead of ${money(s.weeklyBudget)}).`;
    else body += ` That's tight — see the plan on the Bills tab for ways to split it, or stretch it over ${cp.stretch.weeks} weeks for ${money(cp.stretch.perWeek)} a week.`;
    tips.push({ icon: '💳', tone: cp.need > 0 ? 'warn' : 'info', title: `Card payoff: ${money(cp.perWeek)} a week`, body });
  } else if (s.cc.balance > 0) tips.push({ icon: '🎉', tone: 'good', title: 'Credit card is paid off', body: 'Balance is at $0 — that money can go back to savings.' });

  // 5. Savings
  if (ms.isCurrent && ms.day >= 7) {
    const target = round((s.weeklySavings * ms.day) / 7);
    if (ms.savingsIn < target * 0.75) tips.push({ icon: '🐷', tone: 'info', title: 'Savings is running behind', body: `${money(ms.savingsIn)} moved to savings so far; a steady ${money(s.weeklySavings)}/week would be about ${money(target)} by now. Log transfers with Log → Transfer → Savings.` });
  }

  // 6. Paycheck reality check (last 4 paychecks over $500)
  const checks = txs.filter((t) => t.type === 'income' && t.amount >= 500).sort((a, c) => c.date.localeCompare(a.date)).slice(0, 4);
  if (checks.length === 4) {
    const avg = round(sum(checks.map((t) => t.amount)) / 4);
    if (Math.abs(avg - s.weeklyPay) / s.weeklyPay > 0.05)
      tips.push({ icon: '💵', tone: 'info', title: `Recent paychecks average ${money(avg)}`, body: `That's ${money(Math.abs(avg - s.weeklyPay))} ${avg < s.weeklyPay ? 'below' : 'above'} the ${money(s.weeklyPay)} weekly pay in Settings. Update it if this is the new normal.` });
  }

  // 7. The biggest leak: average over the last 3 months that actually have data
  const prev = [1, 2, 3, 4, 5, 6].map((k) => ymd(new Date(now.getFullYear(), now.getMonth() - k, 1)).slice(0, 7))
    .filter((m) => txs.some((t) => t.date.startsWith(m))).slice(0, 3);
  if (prev.length) {
    const avgs = s.categories.map((c) => ({ c, avg: round(sum(prev.map((m) => sum(txs.filter((t) => t.type === 'expense' && t.category === c.id && t.date.startsWith(m)).map((t) => t.amount)))) / prev.length) }))
      .filter((x) => x.avg >= 150 && x.c.budget < x.avg * 0.5).sort((x, y) => y.avg - x.avg);
    if (avgs[0]) { const { c, avg } = avgs[0];
      tips.push({ icon: '🔍', tone: 'info', title: `${c.name} averages ${money(avg)} a month`, body: `Over your last ${prev.length} months of data — about ${money(round(avg / 4.3))} a week${c.budget ? ` against a ${money(c.budget)} budget` : ' with no budget set'}. It's the best place to find extra money for the card or savings.` }); }
  }

  return { tips, ms, ws, cp, b };
}
