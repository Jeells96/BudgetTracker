# Budget Tracker

A simple, phone-friendly replacement for the Personal Budget spreadsheet. No build step — plain HTML/CSS/JS with Firebase for sign-in and sync.

- **Home**: what's left to spend this month, a big **Log a purchase** button, this week's everyday spending, category progress, recent purchases.
- **Log a purchase**: amount → category → note/date. (Toggle to "Income" for paychecks.)
- **Bills**: tap to check bills off each month.
- **Activity**: every transaction, filterable by category; tap one to delete it.
- **Settings**: income, weekly budget, category budgets, bills.

Defaults come from the spreadsheet's "My Page" tab (see `defaults.js`).

## Run locally
    npx http-server . -p 8080

Works immediately and saves to the browser. Sign in with Google (Settings) to sync across devices.

## Firebase setup (one time, for sync)
1. Firebase console → **Authentication** → Sign-in method → enable **Google**. Add your site's domain under *Authorized domains*.
2. **Firestore Database** → create a database.
3. Deploy the rules and (optionally) hosting: `firebase deploy --only firestore:rules,hosting`
