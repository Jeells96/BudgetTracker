# Budget Tracker

A simple, phone-friendly replacement for the Personal Budget spreadsheet. No build step — plain HTML/CSS/JS with Firebase for sign-in and sync.

- **Home**: what's left to spend this month, a big **Log a purchase** button, this week's everyday spending, category progress, recent purchases.
- **Log a purchase**: amount → category → note/date. (Toggle to "Income" for paychecks.)
- **Bills**: how much more to move into the bills account for the 1st and for the whole month, bills by due day, credit card payoff plan.
- **Coach**: plain-English advice, this week's plan next to your spreadsheet's "standard week".
- **Activity**: every transaction, filterable by category; tap one to delete it.
- **Settings**: income, weekly budget, category budgets, bills.

Defaults come from the spreadsheet's "My Page" tab (see `defaults.js`).

## Run locally
    npx http-server . -p 8080

Works immediately and saves to the browser, and syncs through Firestore when it's reachable. All 380 line items from the spreadsheet are imported on first run.

## Firebase setup (one time, for sync)
No sign-in. In the Firebase console: **Firestore Database** → create a database if you haven't, then **Rules** → paste the contents of `firestore.rules` → **Publish**:

    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if true;
        }
      }
    }

Anyone with the site URL can read/write the data. Data lives in `budget/settings` and `transactions/*`.
