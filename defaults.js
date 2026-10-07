// Starting budget, taken from Personal_Budget.xlsx ("My Page" tab).
export const DEFAULT_SETTINGS = {
  income: 8376,          // 4 weeks x $2,094 expected pay
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
  bills: [
    { id: 'car',      name: 'Car',         amount: 320.47, day: 12 },
    { id: 'garbage',  name: 'Garbage',     amount: 107.5,  day: 18 },
    { id: 'nwnatural',name: 'NW Natural',  amount: 97,     day: 18 },
    { id: 'allstate', name: 'Allstate',    amount: 224,    day: null },
    { id: 'pge',      name: 'PGE',         amount: 224,    day: null },
    { id: 'house',    name: 'House',       amount: 2354,   day: null },
    { id: 'truck',    name: 'Truck',       amount: 1415,   day: null },
    { id: 'phones',   name: 'Phones',      amount: 200,    day: null },
    { id: 'water',    name: 'Water',       amount: 362,    day: null },
    { id: 'tv',       name: 'TV',          amount: 24,     day: null },
    { id: 'church',   name: 'Church Dues', amount: 70,     day: null },
    { id: 'union',    name: 'Union Dues',  amount: 65,     day: null }
  ],
  paid: {}               // { "2026-10": ["car", ...] }
};
