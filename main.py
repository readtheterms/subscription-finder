import sys
import csv
import re
from datetime import datetime, timedelta
import statistics


def make_key(description):
    letters = re.sub(r"[^a-z]", "", description.lower())
    return letters[:15]


def days_between(dates):
    parsed = sorted(datetime.strptime(d, "%m/%d/%Y") for d in dates)
    gaps = []
    for i in range(1, len(parsed)):
        gaps.append((parsed[i] - parsed[i - 1]).days)
    return gaps

SKIP = ["discover", "capitalone", "chasecredit", "zelle", "onlinetransfer"]
    
def looks_monthly(charges):
    if len(charges) < 3:
        return False

    dates = [date for date, amount in charges]
    for gap in days_between(dates):
        if gap < 25 or gap > 35:
            return False

    amounts = [abs(amount) for date, amount in charges]
    usual = statistics.median(amounts)
    close = 0
    for a in amounts:
        if abs(a - usual) <= usual * 0.25:
            close += 1
    if close < len(amounts) * 0.8:
        return False

    return True


groups = {}
names = {}

filename = sys.argv[1] if len(sys.argv) > 1 else "sample_transactions.csv"

with open(filename, newline="") as file:
    reader = csv.DictReader(file)
    for row in reader:
        date = row["Posting Date"]
        description = " ".join(row["Description"].split())
        description = re.sub(r" \d\d/\d\d$", "", description)
        amount = float(row["Amount"])
        if amount >= 0:
            continue

        key = make_key(description)
        if key not in groups:
            groups[key] = []
            names[key] = description
        groups[key].append((date, amount))

latest = max(
    datetime.strptime(date, "%m/%d/%Y")
    for charges in groups.values()
    for date, amount in charges
)

total = 0

for key, charges in groups.items():
    skip = False
    for word in SKIP:
        if key.startswith(word):
            skip = True
    if skip or not looks_monthly(charges):
        continue

    pairs = sorted((datetime.strptime(d, "%m/%d/%Y"), abs(a)) for d, a in charges)
    last, price = pairs[-1]
    days_ago = (latest - last).days

    if days_ago <= 40:
        next_charge = last + timedelta(days=30)
        print(names[key][:30], price, "next:", next_charge.date())
        total += price
    else:
        print(names[key][:30], price, "ended", last.date())

print("monthly total:", round(total, 2))