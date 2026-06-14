import 'dotenv/config';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const TRUCKS = [
  { name: 'Truck 1', id: process.env.TRUCK_1_ID },
  { name: 'Truck 2', id: process.env.TRUCK_2_ID },
  { name: 'Truck 3', id: process.env.TRUCK_3_ID },
  { name: 'Truck 4', id: process.env.TRUCK_4_ID },
  { name: 'Truck 5', id: process.env.TRUCK_5_ID },
  { name: 'Truck 6', id: process.env.TRUCK_6_ID },
];

const TZ = 'America/Los_Angeles';

function getLADateStr(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

function getLADayOfWeek(date) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

// Convert a date+time in LA timezone to a UTC Date object.
// Uses noon on the given date as a DST-safe reference to determine the offset.
function laToUTC(laDateStr, timeStr) {
  const noonUTC = new Date(laDateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(noonUTC);
  const laH = parseInt(parts.find(p => p.type === 'hour').value);
  const laM = parseInt(parts.find(p => p.type === 'minute').value);
  const offsetMin = (laH * 60 + laM) - (12 * 60); // e.g. -480 for PST, -420 for PDT

  const [h, m, s] = timeStr.split(':').map(Number);
  const utcMin = (h * 60 + m) - offsetMin;
  return new Date(new Date(laDateStr + 'T00:00:00Z').getTime() + utcMin * 60000 + s * 1000);
}

function getDateRange(type) {
  const now = new Date();
  const todayStr = getLADateStr(now);

  if (type === 'daily') {
    const yesterdayStr = getLADateStr(new Date(now.getTime() - 86400000));
    return {
      start: laToUTC(yesterdayStr, '00:00:00'),
      end: laToUTC(yesterdayStr, '23:59:59'),
      label: formatDisplayDate(yesterdayStr),
    };
  }

  // Weekly: Monday through today (Sunday)
  const dayOfWeek = getLADayOfWeek(now);
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayStr = getLADateStr(new Date(now.getTime() - daysFromMonday * 86400000));
  return {
    start: laToUTC(mondayStr, '00:00:00'),
    end: laToUTC(todayStr, '23:59:59'),
    label: `${formatDisplayDate(mondayStr)} – ${formatDisplayDate(todayStr)}`,
  };
}

function formatDisplayDate(laDateStr) {
  return new Date(laDateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ,
  });
}

function formatApiDate(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

function metersToMiles(meters) {
  return (meters / 1609.344).toFixed(1);
}

async function fetchTruckDistance(truckId, start, end) {
  const url = `${process.env.OPTIMUS_BASE_URL}/v1/clients/${process.env.OPTIMUS_CLIENT_ID}`
    + `/devices/${truckId}/history`
    + `/${encodeURIComponent(formatApiDate(start))}`
    + `/${encodeURIComponent(formatApiDate(end))}/distance`;

  const res = await fetch(url, {
    headers: { accept: 'application/json', 'api-key': process.env.OPTIMUS_API_KEY },
  });
  if (!res.ok) throw new Error(`API error for truck ${truckId}: ${res.status}`);
  return parseFloat(await res.text()) || 0;
}

function buildEmailHtml(type, label, truckData) {
  const totalMiles = truckData.reduce((s, t) => s + parseFloat(t.miles), 0).toFixed(1);
  const reportType = type === 'daily' ? 'Daily' : 'Weekly';
  const period = type === 'daily' ? 'yesterday' : 'this week';

  const rows = truckData.map((t, i) => `
    <tr style="background-color:${i % 2 === 0 ? '#ffffff' : '#fafbfc'};">
      <td style="padding:14px 24px;color:#1a1a2e;font-size:15px;border-bottom:1px solid #f0f0f0;">${t.name}</td>
      <td style="padding:14px 24px;color:#1a1a2e;font-size:15px;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">${t.miles} mi</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${reportType} Fleet Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:12px 12px 0 0;padding:36px 36px 32px;">
            <p style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Splendid Moving</p>
            <p style="margin:8px 0 0;color:#6b7fad;font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:500;">${reportType} Fleet Report</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#0f3460;padding:10px 36px;">
            <p style="margin:0;color:#8892b0;font-size:13px;">${label}</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;padding:32px 36px 0;">
            <p style="margin:0 0 24px;color:#4a5568;font-size:14px;line-height:1.6;">Here's a summary of how far each truck traveled ${period}.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e8ecf0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background-color:#f8f9fb;">
                  <th style="padding:12px 24px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;border-bottom:1px solid #e8ecf0;">Truck</th>
                  <th style="padding:12px 24px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;border-bottom:1px solid #e8ecf0;">Miles Driven</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr style="background-color:#f8f9fb;border-top:2px solid #e0e4ea;">
                  <td style="padding:16px 24px;color:#1a1a2e;font-size:15px;font-weight:700;">Fleet Total</td>
                  <td style="padding:16px 24px;color:#1a1a2e;font-size:15px;font-weight:700;text-align:right;">${totalMiles} mi</td>
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
</html>`;
}

async function sendReport(type) {
  const { start, end, label } = getDateRange(type);
  console.log(`Fetching ${type} report: ${label}`);

  const truckData = await Promise.all(
    TRUCKS.map(async (truck) => {
      const meters = await fetchTruckDistance(truck.id, start, end);
      const miles = metersToMiles(meters);
      console.log(`  ${truck.name}: ${miles} mi`);
      return { name: truck.name, miles };
    })
  );

  const subject = type === 'daily'
    ? `Daily Fleet Report — ${label}`
    : `Weekly Fleet Report — ${label}`;

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM,
    to: 'info@splendidmoving.com',
    subject,
    html: buildEmailHtml(type, label, truckData),
  });

  if (error) { console.error('Email error:', error); process.exit(1); }
  console.log(`Email sent (${data.id})`);
}

async function run() {
  // Always send daily report
  await sendReport('daily');

  // On Sundays, also send the weekly report
  if (getLADayOfWeek(new Date()) === 0) {
    await sendReport('weekly');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
