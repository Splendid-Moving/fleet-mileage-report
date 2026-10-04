"""
Fleet mileage report — daily (every run) + weekly (Sundays).
Pulls distance data from Optimus GPS and emails a summary via Resend.
"""

import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
import requests
import resend

load_dotenv()

# ── Config ──────────────────────────────────────────────────────────────

TZ = ZoneInfo("America/Los_Angeles")

TRUCKS = [
    {"name": "Truck 1", "id": os.environ["TRUCK_1_ID"]},
    {"name": "Truck 2", "id": os.environ["TRUCK_2_ID"]},
    {"name": "Truck 3", "id": os.environ["TRUCK_3_ID"]},
    {"name": "Truck 4", "id": os.environ["TRUCK_4_ID"]},
    {"name": "Truck 5", "id": os.environ["TRUCK_5_ID"]},
    {"name": "Truck 6", "id": os.environ["TRUCK_6_ID"]},
]

OPTIMUS_BASE_URL = os.environ["OPTIMUS_BASE_URL"]
OPTIMUS_API_KEY = os.environ["OPTIMUS_API_KEY"]
OPTIMUS_CLIENT_ID = os.environ["OPTIMUS_CLIENT_ID"]
RESEND_FROM = os.environ["RESEND_FROM"]

resend.api_key = os.environ["RESEND_API_KEY"]

# ── Date helpers ────────────────────────────────────────────────────────

def get_date_range(report_type: str):
    """Return (start, end, label) in UTC for the given report type."""
    now = datetime.now(TZ)
    today = now.date()

    if report_type == "daily":
        yesterday = today - timedelta(days=1)
        start = datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0, tzinfo=TZ)
        end = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, tzinfo=TZ)
        label = format_display_date(yesterday)
    else:
        # Weekly: Monday through today (run on Sunday)
        days_from_monday = (today.weekday())  # Monday=0 already
        monday = today - timedelta(days=days_from_monday)
        start = datetime(monday.year, monday.month, monday.day, 0, 0, 0, tzinfo=TZ)
        end = datetime(today.year, today.month, today.day, 23, 59, 59, tzinfo=TZ)
        label = f"{format_display_date(monday)} – {format_display_date(today)}"

    return start, end, label


def format_display_date(d) -> str:
    return d.strftime("%B %-d, %Y")


def format_api_date(dt: datetime) -> str:
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def meters_to_miles(meters: float) -> str:
    return f"{meters / 1609.344:.1f}"

# ── Optimus API ─────────────────────────────────────────────────────────

def fetch_truck_distance(truck_id: str, start: datetime, end: datetime) -> float:
    url = (
        f"{OPTIMUS_BASE_URL}/v1/clients/{OPTIMUS_CLIENT_ID}"
        f"/devices/{truck_id}/history"
        f"/{format_api_date(start)}/{format_api_date(end)}/distance"
    )
    resp = requests.get(url, headers={"accept": "application/json", "api-key": OPTIMUS_API_KEY})
    resp.raise_for_status()
    try:
        return float(resp.text)
    except ValueError:
        return 0.0

# ── Email ───────────────────────────────────────────────────────────────

def build_email_html(report_type: str, label: str, truck_data: list[dict]) -> str:
    total_miles = sum(float(t["miles"]) for t in truck_data)
    type_label = "Daily" if report_type == "daily" else "Weekly"
    period = "yesterday" if report_type == "daily" else "this week"

    rows = ""
    for i, t in enumerate(truck_data):
        bg = "#ffffff" if i % 2 == 0 else "#fafbfc"
        rows += f"""
        <tr style="background-color:{bg};">
          <td style="padding:14px 24px;color:#1a1a2e;font-size:15px;border-bottom:1px solid #f0f0f0;">{t["name"]}</td>
          <td style="padding:14px 24px;color:#1a1a2e;font-size:15px;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">{t["miles"]} mi</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>{type_label} Fleet Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:12px 12px 0 0;padding:36px 36px 32px;">
            <p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Splendid Moving</p>
            <p style="margin:8px 0 0;color:#6b7fad;font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:500;">{type_label} Fleet Report</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#0f3460;padding:10px 36px;">
            <p style="margin:0;color:#8892b0;font-size:13px;">{label}</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;padding:32px 36px 0;">
            <p style="margin:0 0 24px;color:#4a5568;font-size:14px;line-height:1.6;">Here's a summary of how far each truck traveled {period}.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e8ecf0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background-color:#f8f9fb;">
                  <th style="padding:12px 24px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;border-bottom:1px solid #e8ecf0;">Truck</th>
                  <th style="padding:12px 24px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;border-bottom:1px solid #e8ecf0;">Miles Driven</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
              <tfoot>
                <tr style="background-color:#f8f9fb;border-top:2px solid #e0e4ea;">
                  <td style="padding:16px 24px;color:#1a1a2e;font-size:15px;font-weight:700;">Fleet Total</td>
                  <td style="padding:16px 24px;color:#1a1a2e;font-size:15px;font-weight:700;text-align:right;">{total_miles:.1f} mi</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:28px 36px;">
            <p style="margin:0;color:#b0b8c4;font-size:12px;border-top:1px solid #f0f0f0;padding-top:20px;line-height:1.6;">
              Automated report powered by Optimus GPS &nbsp;·&nbsp; Data reflects Los Angeles time
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

# ── Main ────────────────────────────────────────────────────────────────

def send_report(report_type: str):
    start, end, label = get_date_range(report_type)
    print(f"Fetching {report_type} report: {label}")

    truck_data = []
    for truck in TRUCKS:
        meters = fetch_truck_distance(truck["id"], start, end)
        miles = meters_to_miles(meters)
        print(f"  {truck['name']}: {miles} mi")
        truck_data.append({"name": truck["name"], "miles": miles})

    subject = f"{'Daily' if report_type == 'daily' else 'Weekly'} Fleet Report — {label}"

    result = resend.Emails.send({
        "from": RESEND_FROM,
        "to": "info@splendidmoving.com",
        "subject": subject,
        "html": build_email_html(report_type, label, truck_data),
    })

    print(f"Email sent ({result['id']})")


def main():
    send_report("daily")

    # On Sundays, also send the weekly report
    if datetime.now(TZ).weekday() == 6:  # 6 = Sunday
        send_report("weekly")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
