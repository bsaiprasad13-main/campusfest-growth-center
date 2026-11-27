"""Convert the original attendee dataset (.xlsx) into raw JSON seed files.

Rows are kept exactly as supplied, including duplicates from import retries:
the app's metrics engine applies the dataset's cleaning rules itself, so the
same rules also hold for data that is edited or re-imported later.

Usage: python -I scripts/convert_dataset.py "data/original/Attendee Dataset.xlsx" data/seed
"""
import json
import math
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd

SHEETS = {
    "Event": "event",
    "Targets": "targets",
    "Campaigns": "campaigns",
    "Daily Marketing": "campaign_daily",
    "People": "people",
    "Interest and Engagement": "interactions",
    "Registrations": "registrations",
    "Registration History": "registration_history",
    "Check-ins": "checkins",
}
DATE_ONLY = {"activity_date", "history_start", "history_end"}


def clean(field, v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    if isinstance(v, pd.Timestamp) or isinstance(v, datetime):
        if field in DATE_ONLY:
            return v.strftime("%Y-%m-%d")
        return v.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"  # source timestamps are IST
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    return v


def main(src, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    xl = pd.ExcelFile(src)
    for sheet, name in SHEETS.items():
        df = xl.parse(sheet)
        rows = [{k: clean(k, v) for k, v in r.items()} for r in df.to_dict("records")]
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(rows)} rows")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
