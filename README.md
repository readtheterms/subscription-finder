# Subscription Finder

I wanted to know what I was paying for every month without scrolling through a year of bank transactions. This is a Python script that reads a bank statement CSV and finds the recurring monthly charges, so it can tell me which subscriptions I have, what each costs, when the next charge is coming, and what the total is.

It was built against Chase's CSV export, so it expects the columns `Posting Date`, `Description`, and `Amount`.

## Running it

You only need Python 3. There are no packages to install.

    python main.py

With no argument it reads `sample_transactions.csv`, which is made-up data. To run it on your own statement:

    python main.py your_statement.csv

The output looks like this:

    SPOTIFY USA 877-778-1161 NY 11.99 next: 2026-11-12
    NETFLIX.COM LOS GATOS CA 17.99 next: 2026-11-04
    APPLE.COM/BILL ONE APPLE PARK  2.99 next: 2026-10-21
    PLANET FITNESS CLUB FEES PPD I 24.99 ended 2026-06-02
    monthly total: 32.97

## How it works

Bank descriptions are messy. They have extra spaces, a purchase date stuck on the end, and merchant names that change a little from one charge to the next. So the script cleans each description and then builds a key from its first 15 letters, ignoring case, digits, and symbols. Charges with the same key are grouped together as one merchant.

A group counts as a monthly subscription if:

- it has at least 3 charges
- every gap between charges is 25 to 35 days
- at least 80% of the charges are within 25% of the median amount

The amount rule is loose on purpose. A price increase or a one-time extra fee (my gym once bundled an annual fee into a single charge) shouldn't hide a real subscription.

A subscription is active if its last charge is within 40 days of the newest date in the file. Otherwise it is listed as ended. The next charge date is the last charge plus 30 days, so it is an estimate.

Deposits and refunds are ignored. Zelle, bank transfers, and credit card payments repeat every month too, but they aren't subscriptions, so they are skipped using a short list of name prefixes in `SKIP`.

## Limits

- It only finds monthly charges. Yearly or weekly ones are missed.
- If a merchant changes the name on the statement, the old and new names show up as separate entries, and only the newest one is marked active.
- The 15-letter key can merge different merchants that start the same way, or split one merchant whose name changes early. I picked 15 by trying it on real data.
- The skip list is hand-written, so a credit card I haven't listed would show up as a subscription.
- It has only been tried on one person's Chase export.

## Privacy

Real statements are never committed. `.gitignore` blocks every `.csv` file except the sample.