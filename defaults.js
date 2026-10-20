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
  seeded: false,                    // spreadsheet history imported?
  // Loans / payoff planner (seeded from Loans.xlsx). Each loan keeps its original
  // terms plus a current `balance` as of `asOf` — the actual balance from your real
  // statement, so past extra payments are already baked in ("my progress"). Going
  // forward:
  //   extra      = a flat extra you plan to add to EVERY future payment (0 = none)
  //   extras     = one-off overrides per due date { 'YYYY-MM-DD': amount } (blank = $0;
  //                you can always go back and set one). An override wins over `extra`.
  finance: DEFAULT_FINANCE()
};

// Loans as of 2026-10-20, balances taken straight from Loans.xlsx (latest payment
// on or before that date). Rates/payments/terms are the loan originals.
function DEFAULT_FINANCE() {
  return {
    loans: [
      { id: 'car',     name: 'Car',     sub: 'KIA', lender: 'Gesa',     emoji: '🚗', principal: 11742.67, rate: 0.0299, payment: 321.04, start: '2026-01-09', balance: 2791.90,   asOf: '2026-10-09', extra: 0, extras: {} },
      { id: 'truck',   name: 'Truck',   sub: '',    lender: 'IBEW',     emoji: '🛻', principal: 28867,    rate: 0.0549, payment: 413.71, start: '2023-09-01', balance: 0,         asOf: '2026-10-01', extra: 0, extras: {} },
      { id: 'trailer', name: 'Trailer', sub: '',    lender: 'Peak',     emoji: '🚐', principal: 29102.80, rate: 0.0749, payment: 306.94, start: '2025-08-08', balance: 2431.56,   asOf: '2026-10-08', extra: 0, extras: {} },
      { id: 'house',   name: 'House',   sub: '',    lender: 'Citizens', emoji: '🏠', principal: 312000,   rate: 0.0325, payment: 1357.84, start: '2020-01-01', balance: 265882.77, asOf: '2026-10-01', extra: 0, extras: {} }
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
