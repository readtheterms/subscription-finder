# Subscription Finder

I wanted to know what I was paying for every month without scrolling through a year of bank transactions. This reads a bank statement CSV and finds the recurring charges, so it can tell me which subscriptions I have, what each costs, when the next charge is coming, and what the monthly and yearly totals are.

There are two versions that do the same job: a Python script, and a web page that runs entirely in the browser.

![The web version showing five active subscriptions, a due-soon tag, and monthly and yearly totals](docs/screenshot.png)

## Web version

**Live page:** https://readtheterms.github.io/subscription-finder/

No bank CSV handy? Click **Try sample data** on the page to load made-up transactions.

Choose a CSV and the page prints a receipt of your active subscriptions. Ended ones are collapsed at the bottom. The file is read in your browser with JavaScript. It is never uploaded, and there is no server.

What you can do on the page:

- **Add several files.** Each file you choose is added to the list, and each is read on its own, so they can come from different banks. **Clear** starts over.
- **Hide a row.** Click a row to gray it out and leave it out of the totals, for charges that repeat but are not really subscriptions. Click it again to count it. Hiding resets when you load new files.
- **Sort** by date or by price. Clicking the same button again reverses the order.
- **Read the tags.** `DUE SOON` means the estimated next charge is within 7 days of today. `OVERDUE` means the expected date passed and no new charge showed up.
- **Check the totals.** The monthly total counts yearly plans as 1/12 of their price. The yearly total is the monthly prices times 12 plus the yearly prices. Hidden and ended rows are left out of both.

File names are shown with a 4-digit account number masked, so `Chase9113_Activity_20261014.csv` appears as `Chase••••_Activity_20261014.csv`.

To run it locally, serve the `docs` folder:

    python -m http.server 8000 --directory docs

then open http://localhost:8000. The sample button needs the page to be served like this (or the live page), because it loads the sample over the network. Opening `docs/index.html` directly still works for choosing your own files.

### Other banks

It looks at the header row to find the date, description, and amount columns, so it is not tied to Chase. It also handles a separate Debit column, dates like `10/13/2026` or `2026-10-13`, amounts like `$1,234.50`, cards that list purchases as positive numbers, and files with no header row at all. `docs/samples/` has the same fake transactions in several bank-style layouts. Those layouts were written from memory and have not been checked against real exports.

### Company names

Merchant names are shown as company names (`SPOTIFY USA 877-778-1161 NY` becomes `Spotify`). They come from a hand-written list of subscription services, banks, and shops in `docs/finder.js`, plus the 2014 Fortune 500 in `docs/companies.js`, plus some cleanup for everything else. The cleanup is a guess, so an unknown merchant can keep a city in its name.

### Code

The detection logic is in `docs/finder.js`, and each function there matches one in `main.py`. I checked it by running both on the same CSVs and comparing the output line by line. `docs/app.js` is the page itself.

The web version has gone beyond the script in a few ways: more banks, a longer skip list, company names, and the page features above. So the two can differ on messy files. `main.py` is the original, and the web version is the one I keep improving.

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

A monthly subscription is active if its last charge is within 40 days of the newest date in the file, and a yearly one within 380 days. Otherwise it is listed as ended. The next charge date is the last charge plus 30 days (365 for yearly), so it is an estimate.

Deposits and refunds are ignored. Zelle, bank transfers, and some credit card payments repeat every month too, but they aren't subscriptions, so they are skipped using a short list of name prefixes in `SKIP`. Anything not on that list still shows up, and in the web version you can hide it with a click.

## Limits

- It only finds monthly and yearly charges. Weekly ones are missed.
- If a merchant changes the name on the statement, the old and new names show up as separate entries, and only the newest one is marked active.
- The 15-letter key can merge different merchants that start the same way, or split one merchant whose name changes early. I picked 15 by trying it on real data.
- The skip list is hand-written, so a lender or card I haven't listed shows up as a subscription. Bills like rent, insurance, and utilities can also show up, since they repeat monthly too.
- If two files cover the same dates, the same transaction is counted twice. That can hide a real subscription, so avoid overlapping exports.
- Dates are read as month/day/year. A file with day/month/year dates would be read wrong.
- `DUE SOON` uses today's date from your computer, while `OVERDUE` compares against the newest date in the file.
- The Python script only reads Chase's column names. The web version handles other layouts, but those layouts haven't been checked against real exports from other banks.
- It has only been tried on a few people's Chase exports.

## Privacy

Real statements are never committed. `.gitignore` blocks every `.csv` file except the made-up samples in `sample_transactions.csv`, `docs/sample_transactions.csv`, and `docs/samples/`. The web version never sends your file anywhere. The only network request it makes is loading the Papa Parse CSV library from a CDN, and the sample button's request for the sample file from the site itself.

## License

MIT. See `LICENSE`.
