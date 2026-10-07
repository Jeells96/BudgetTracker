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
  cc: { start: 0, asOf: null, mode: 'auto', manual: 0, chargesAdj: 0, strategy: 'extra' },
  weekStartDay: 5,                  // day the weekly budget resets (0=Sun … 6=Sat); default Friday
  weekResetAt: null,                // week-start (YYYY-MM-DD) the user cleared the rollover for
  seeded: false                     // spreadsheet history imported?
};

// Money that moves but isn't "spending".
export const TRANSFERS = [
  { id: 'bills',   name: 'Bills account', emoji: '🏦' },
  { id: 'card',    name: 'Credit card',   emoji: '💳' },
  { id: 'savings', name: 'Savings',       emoji: '🐷' }
];
