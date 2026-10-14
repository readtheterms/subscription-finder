import csv
import re

with open("Chase8770_Activity_20261014.csv", newline="") as file:
    reader = csv.DictReader(file)
    for row in reader:
        date = row["Posting Date"]
        description = " ".join(row["Description"].split())
        description = re.sub(r" \d\d/\d\d$", "", description)
        amount = row["Amount"]
        print(date, description, amount)