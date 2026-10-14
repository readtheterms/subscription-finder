# Subscription Finder

I wanted to know what I was paying for every month without scrolling through a year of bank transactions. This reads a bank statement CSV and finds the recurring charges, so it can tell me which subscriptions I have, what each costs, when the next charge is coming, and what the monthly total is.

There are two versions that do the same thing: a Python script, and a web page that runs entirely in the browser.

![The web version showing five active subscriptions and a monthly total](docs/screenshot.png)

## Web version

**Live page:** https://readtheterms.github.io/subscription-finder/

Choose a CSV and the page prints a receipt of your active subscriptions with a monthly total. Ended ones are collapsed at the bottom. The file is read in your browser with JavaScript. It is never uploaded, and there is no server.

To run it locally, serve the `docs` folder:

    python -m http.server 8000 --directory docs

then open http://localhost:8000. Opening `docs/index.html` directly also works. Try `docs/sample_transactions.csv`, which is made-up data.

It looks at the header row to find the date, description, and amount columns, so it is not tied to Chase. It also handles a separate Debit column, dates like `10/13/2026` or `2026-10-13`, amounts like `$1,234.50`, cards that list purchases as positive numbers, and files with no header row at all. `docs/samples/` has the same fake transactions in several bank-style layouts. Those layouts were written from memory and have not been checked against real exports.

Merchant names are shown as company names (`SPOTIFY USA 877-778-1161 NY` becomes `Spotify`) using a list of well-known companies plus some cleanup for the rest. The cleanup is a guess, so an unknown merchant can keep a city in its name.

The logic is in `docs/finder.js`, and each function there matches one in `main.py`. I checked it by running both on the same CSVs and comparing the output line by line.

## Python version

You only need Python 3. There are no packages to install.

    python main.py

With no argument it reads `sample_transactions.csv`, which is made-up data. To run it on your own statement:

    python main.py your_statement.csv

It expects Chase's columns: `Posting Date`, `Description`, and `Amount`. The output looks like this:

    SPOTIFY USA 877-778-1161 NY 11.99 monthly next: 2026-11-12
    NETFLIX.COM LOS GATOS CA 17.99 monthly next: 2026-11-04
    APPLE.COM/BILL ONE APPLE PARK  2.99 monthly next: 2026-10-21
    PLANET FITNESS CLUB FEES PPD I 24.99 monthly ended 2026-06-02
    DROPBOX*ANNUAL PLAN DROPBOX.CO 119.88 yearly next: 2027-08-14
    PAYPAL *GAMESTORE 555-555-0100 134.99 yearly next: 2027-09-03
    monthly total: 54.21

## How it works

Bank descriptions are messy. They have extra spaces, a purchase date stuck on the end, and merchant names that change a little from one charge to the next. So the script cleans each description and then builds a key from its first 15 letters, ignoring case, digits, and symbols. Charges with the same key are grouped together as one merchant.

A group counts as a monthly subscription if:

- it has at least 3 charges
- every gap between charges is 25 to 35 days, or 55 to 70 days for a skipped month, and no more than 20% of the gaps are skipped months
- at least 80% of the charges are within 25% of the median amount

The amount rule is loose on purpose. A price increase or a one-time extra fee (my gym once bundled an annual fee into a single charge) shouldn't hide a real subscription.

A group counts as a yearly subscription if it has at least 2 charges, every gap is 350 to 380 days, and every charge is within 25% of the median amount.

If a merchant's charges don't look like a subscription as a whole, the script splits them by exact price and checks each price separately. That is how a yearly charge hiding inside a merchant with many other purchases (like a PayPal gamestore) gets found.

A monthly subscription is active if its last charge is within 40 days of the newest date in the file, and a yearly one within 380 days. Otherwise it is listed as ended. The next charge date is the last charge plus 30 days (365 for yearly), so it is an estimate. Yearly prices count as 1/12 in the monthly total.

Deposits and refunds are ignored. Zelle, bank transfers, and credit card payments repeat every month too, but they aren't subscriptions, so they are skipped using a short list of name prefixes in `SKIP`.

## Limits

- It only finds monthly and yearly charges. Weekly ones are missed.
- If a merchant changes the name on the statement, the old and new names show up as separate entries, and only the newest one is marked active.
- The 15-letter key can merge different merchants that start the same way, or split one merchant whose name changes early. I picked 15 by trying it on real data.
- The skip list is hand-written, so a credit card I haven't listed would show up as a subscription.
- The Python script only reads Chase's column names. The web version handles other layouts, but those layouts haven't been checked against real exports from other banks.
- Dates are read as month/day/year. A file with day/month/year dates would be read wrong.
- It has only been tried on one person's Chase exports.

## Privacy

Real statements are never committed. `.gitignore` blocks every `.csv` file except the made-up samples in `sample_transactions.csv`, `docs/sample_transactions.csv`, and `docs/samples/`. The web version never sends your file anywhere. The only network request it makes is loading the Papa Parse CSV library from a CDN.
