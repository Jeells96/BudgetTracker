// Starting budget, taken from Personal_Budget.xlsx ("My Page" tab).
export const DEFAULT_SETTINGS = {
  weeklyPay: 2094,       // "Expected pay" — the sheet's monthly income is this x 4
  weeklySavings: 250,    // "Standard Week" savings
  weeklyBudget: 250,     // "WEEKLY: Others, Gas, Eating Out"
  categories: [
    { id: 'groceries',  name: 'Groceries',      emoji: '🛒', budget: 500, weekly: false },
    { id: 'gas',        name: 'Gas',            emoji: '⛽', budget: 120, weekly: true  },
    { id: 'eating-out', name: 'Eating Out',     emoji: '🍔', budget: 0,   weekly: true  },
    { id: 'jaren',      name: 'Jaren',          emoji: '🙋‍♂️', budget: 0,   weekly: false },
    { id: 'savannah',   name: 'Savannah',       emoji: '🙋‍♀️', budget: 0,   weekly: false },
    { id: 'personal',   name: 'Personal Items', emoji: '💄', budget: 0,   weekly: false },
    { id: 'other',      name: 'Other',          emoji: '🧾', budget: 0,   weekly: true  }
  ],
  // `day` = day of the month the bill is auto-paid. The sheet's "First of Month"
  // total (Allstate + PGE + House + Truck + Phones = $4,417) is the day-1 group.
  // Day-less bills in the sheet other than those five are set to the 15th — adjust in Settings.
  bills: [
    { id: 'allstate', name: 'Allstate',    amount: 224,    day: 1 },
    { id: 'pge',      name: 'PGE',         amount: 224,    day: 1 },
    { id: 'house',    name: 'House',       amount: 2354,   day: 1 },
    { id: 'truck',    name: 'Truck',       amount: 1415,   day: 1 },
    { id: 'phones',   name: 'Phones',      amount: 200,    day: 1 },
    { id: 'car',      name: 'Car',         amount: 320.47, day: 12 },
    { id: 'garbage',  name: 'Garbage',     amount: 107.5,  day: 18 },
    { id: 'nwnatural',name: 'NW Natural',  amount: 97,     day: 18 },
    { id: 'water',    name: 'Water',       amount: 362,    day: 15 },
    { id: 'tv',       name: 'TV',          amount: 24,     day: 15 },
    { id: 'church',   name: 'Church Dues', amount: 70,     day: 15 },
    { id: 'union',    name: 'Union Dues',  amount: 65,     day: 15 }
  ],
  // Credit card tracking:
  //  start  = balance when you last baselined it; asOf = the date that applies from
  //  mode   = 'auto' (app computes balance from logged credit charges) or 'manual'
  //  manual = your typed current balance (used when mode = manual)
  //  payoffBy = custom "pay off by" date (YYYY-MM-DD) or null for end of month
  //  planEdits = manual per-payday payment overrides { 'YYYY-MM-DD': amount }
  cc: { start: 0, asOf: null, mode: 'auto', manual: 0, chargesAdj: 0, strategy: 'extra', paidThrough: null, payoffBy: null, planEdits: {} },
  // Bills account: a manual balance you type from your real bank whenever you check,
  // with the date you entered it. Not tied to logged transfers.
  billsAcct: { bal: null, asOf: null },
  weekStartDay: 5,                  // day the weekly budget resets (0=Sun … 6=Sat); default Friday
  weekResetAt: null,                // week-start (YYYY-MM-DD) the user cleared the rollover for
  pending: [],                      // "track later" items: price only, not yet logged {id, amount, date}
  returns: [],                      // purchases flagged to return {id, txId, note, category, pay, orig, amount, at, date}
  seeded: false,                    // spreadsheet history imported?
  // Loans / payoff planner (seeded from Loans.xlsx). Each loan keeps its original
  // terms and its recorded extra payments; the current balance is DERIVED by
  // amortizing from the start date applying the scheduled payment + those extras, so
  // you can go back and change which months you actually paid extra and the balance
  // re-figures itself.
  //   extras  = per-due-date extra payments { 'YYYY-MM-DD': amount }. Past entries are
  //             what you actually paid (seeded from the sheet) — edit or delete any you
  //             didn't make. A blank date means no extra that month.
  //   extra   = a flat extra applied to EVERY future payment (a quick "pay $X more/mo"
  //             scenario; 0 = none). A per-date entry overrides it.
  //   adjust  = one-time balance correction for statement quirks (e.g. an escrow bump),
  //             so the derived balance matches your real statement.
  //   deleted = hide a loan you don't want tracked.
  finance: DEFAULT_FINANCE()
};

// Loans from Loans.xlsx. Balances derive from these terms + recorded extras; `adjust`
// pins the derived balance to the real statement as of Oct 2026.
function DEFAULT_FINANCE() {
  const houseExtras = {};                       // the $100/mo you actually paid, Aug 2024 → Oct 2026
  let hy = 2024, hm = 8;
  while (hy < 2026 || (hy === 2026 && hm <= 10)) {
    houseExtras[`${hy}-${String(hm).padStart(2, '0')}-01`] = 100;
    hm++; if (hm > 12) { hm = 1; hy++; }
  }
  return {
    loans: [
      { id: 'car',     name: 'Car',     sub: 'KIA', lender: 'Gesa',     emoji: '🚗', principal: 11742.67, rate: 0.0299, payment: 321.04188852945856, start: '2026-01-09', adjust: 0,       extra: 0, extras: { '2026-10-09': 6000 } },
      { id: 'truck',   name: 'Truck',   sub: '',    lender: 'IBEW',     emoji: '🛻', principal: 28867,    rate: 0.0549, payment: 413.71367515129634, start: '2023-09-01', adjust: 0,       extra: 0, extras: { '2026-04-01': 1415, '2026-07-01': 6000, '2026-08-01': 6000, '2026-09-01': 3989.96 } },
      { id: 'trailer', name: 'Trailer', sub: '',    lender: 'Peak',     emoji: '🚐', principal: 29102.80, rate: 0.0749, payment: 306.9430570308452,  start: '2025-08-08', adjust: -83.40, extra: 0, extras: { '2026-04-08': 1000, '2026-05-08': 1000, '2026-06-08': 22000 } },
      { id: 'house',   name: 'House',   sub: '',    lender: 'Citizens', emoji: '🏠', principal: 312000,   rate: 0.0325, payment: 1357.8437155058275, start: '2020-01-01', adjust: 3697.65, extra: 0, extras: houseExtras }
    ],
    // Investment what-if: monthly contribution, horizon, expected annual return.
    invest: { monthly: 500, years: 20, rate: 0.07 }
  };
}

// Money that moves but isn't "spending".
export const TRANSFERS = [
  { id: 'bills',   name: 'Bills account', emoji: '🏦' },
  { id: 'card',    name: 'Credit card',   emoji: '💳' },
  { id: 'savings', name: 'Savings',       emoji: '🐷' }
];
