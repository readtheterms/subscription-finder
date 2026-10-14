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


def load_charges(filenames):
    groups = {}
    names = {}

    for filename in filenames:
        with open(filename, newline="") as file:
            reader = csv.DictReader(file)
            for row in reader:
                date = row["Posting Date"]
                description = " ".join(row["Description"].split())
                description = re.sub(r" \d\d/\d\d$", "", description)
                description = re.sub(r"^POS DEBIT ", "", description)
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
    gaps = days_between(dates)
    skipped = 0
    for gap in gaps:
        if 25 <= gap <= 35:
            continue
        if 55 <= gap <= 70:
            skipped += 1
            continue
        return False
    if skipped > len(gaps) * 0.2:
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


def looks_yearly(charges):
    if len(charges) < 2:
        return False

    dates = [date for date, amount in charges]
    for gap in days_between(dates):
        if gap < 350 or gap > 380:
            return False

    amounts = [abs(amount) for date, amount in charges]
    usual = statistics.median(amounts)
    for a in amounts:
        if abs(a - usual) > usual * 0.25:
            return False

    return True


def is_skipped(key):
    for word in SKIP:
        if key.startswith(word):
            return True
    return False


def classify(charges):
    if looks_monthly(charges):
        return "monthly"
    if looks_yearly(charges):
        return "yearly"
    return None


def split_by_price(charges):
    by_price = {}
    for date, amount in charges:
        if amount not in by_price:
            by_price[amount] = []
        by_price[amount].append((date, amount))
    return list(by_price.values())


def latest_date(groups):
    return max(
        parse_date(date)
        for charges in groups.values()
        for date, amount in charges
    )


def find_subscriptions(groups, names):
    latest = latest_date(groups)

    found = []
    for key, charges in groups.items():
        if is_skipped(key):
            continue

        if classify(charges):
            candidates = [charges]
        else:
            candidates = split_by_price(charges)

        for part in candidates:
            period = classify(part)
            if period is None:
                continue
            if period == "yearly" and len(part) < 3 and len(charges) > 40:
                continue

            if period == "monthly":
                cycle, grace = 30, 40
            else:
                cycle, grace = 365, 380

            pairs = sorted((parse_date(d), abs(a)) for d, a in part)
            last, price = pairs[-1]
            active = (latest - last).days <= grace

            found.append({
                "name": names[key],
                "price": price,
                "period": period,
                "last": last,
                "next": last + timedelta(days=cycle),
                "active": active,
            })

    return found


def print_report(subscriptions):
    total = 0

    for sub in subscriptions:
        if sub["active"]:
            print(sub["name"][:30], sub["price"], sub["period"],
                  "next:", sub["next"].date())
            if sub["period"] == "yearly":
                total += sub["price"] / 12
            else:
                total += sub["price"]
        else:
            print(sub["name"][:30], sub["price"], sub["period"],
                  "ended", sub["last"].date())

    print("monthly total:", round(total, 2))


def main():
    filenames = sys.argv[1:]
    if not filenames:
        filenames = ["sample_transactions.csv"]
    groups, names = load_charges(filenames)
    subscriptions = find_subscriptions(groups, names)
    print_report(subscriptions)


main()