import csv

with open("Chase8770_Activity_20261014.csv", newline="") as file:
    reader = csv.DictReader(file)
    for row in reader:
        date = row["Posting Date"]
        description = row["Description"]
        amount = row["Amount"]
        print(date, description, amount)