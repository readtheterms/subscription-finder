import csv
import re
import statistics
import sys
from datetime import datetime, timedelta

SKIP = ["discover", "capitalone", "chasecredit", "zelle", "onlinetransfer"]


def make_key(description):
    letters = re.sub(r"[^a-z]", "", description.lower())
    return letters[:15]


def parse_date(text):
    return datetime.strptime(text, "%m/%d/%Y")


def days_between(dates):
    parsed = sorted(parse_date(d) for d in dates)
    gaps = []
    for i in range(1, len(parsed)):
        gaps.append((parsed[i] - parsed[i - 1]).days)
    return gaps


def load_charges(filename):
    groups = {}
    names = {}

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

    return groups, names


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


def is_skipped(key):
    for word in SKIP:
        if key.startswith(word):
            return True
    return False


def find_subscriptions(groups, names):
    latest = max(
        parse_date(date)
        for charges in groups.values()
        for date, amount in charges
    )

    found = []
    for key, charges in groups.items():
        if is_skipped(key) or not looks_monthly(charges):
            continue

        pairs = sorted((parse_date(d), abs(a)) for d, a in charges)
        last, price = pairs[-1]
        active = (latest - last).days <= 40

        found.append({
            "name": names[key],
            "price": price,
            "last": last,
            "active": active,
        })

    return found


def print_report(subscriptions):
    total = 0

    for sub in subscriptions:
        if sub["active"]:
            next_charge = sub["last"] + timedelta(days=30)
            print(sub["name"][:30], sub["price"], "next:", next_charge.date())
            total += sub["price"]
        else:
            print(sub["name"][:30], sub["price"], "ended", sub["last"].date())

    print("monthly total:", round(total, 2))


def main():
    filename = sys.argv[1] if len(sys.argv) > 1 else "sample_transactions.csv"
    groups, names = load_charges(filename)
    subscriptions = find_subscriptions(groups, names)
    print_report(subscriptions)


main()