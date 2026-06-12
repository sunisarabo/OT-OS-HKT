/**
 * DashboardBuilder.gs
 *
 * สร้าง interactive HTML dashboard (Chart.js) บันทึก .html ลง Drive
 * ผู้ใช้คลิกเปิดในเบราว์เซอร์ → กราฟ + filter + tables
 */

/**
 * Build payload object — reusable สำหรับทั้ง file dashboard + Web App
 */
function buildDashboardPayload(period, startDate, endDate) {
  const cfg = getRuntimeConfig();
  const attendance = readAttendance(startDate, endDate);
  const ot         = calculateOT(attendance);
  const flights    = readFlights(startDate, endDate);
  const summary    = readSummaryFull();

  return {
    meta: {
      period:      period,
      startISO:    formatDate(startDate, 'yyyy-MM-dd'),
      endISO:      formatDate(endDate,   'yyyy-MM-dd'),
      generatedAt: formatDate(new Date(),'yyyy-MM-dd HH:mm'),
      department:  cfg.REPORT_DEPT_NAME,
      deptCode:    cfg.REPORT_DEPT_CODE,
      capHours:    cfg.WEEKLY_OT_CAP_HOURS
    },
    teams: cfg.TEAMS.map(function(t){
      const o = ot.byTeam[t.code] || { before: 0, after: 0, dayoff: 0, ph: 0, all: 0 };
      return {
        code: t.code, name: t.name, dept: t.dept,
        headcount: summary.byTeam[t.code] || t.headcount,
        before: o.before, after: o.after, dayoff: o.dayoff, ph: o.ph, all: o.all
      };
    }),
    overLimit:    ot.overLimit || [],
    byDate:       ot.byDate || {},
    topEarners:   ot.topEarners || [],
    flights: {
      total:     flights.total,
      operating: flights.operating,
      cancelled: flights.cancelled,
      byType:    flights.byType,
      byAirline: flights.byAirline
    },
    summary: {
      total:       summary.total,
      byTeam:      summary.byTeam,
      byPosition:  summary.byPosition,
      positions:   summary.positions
    },
    total: ot.total
  };
}

/**
 * @param {string} period
 * @param {Date}   startDate
 * @param {Date}   endDate
 * @returns {{ fileId, fileUrl, filename, savedTo }}
 */
function generateDashboard(period, startDate, endDate) {
  const cfg = getRuntimeConfig();
  const payload = buildDashboardPayload(period, startDate, endDate);
  const html = _dashboardHTML(payload);

  // ─ 2. Save to Drive ──────────────────────────────────────────
  const filename = 'OT_Dashboard_' + cfg.REPORT_DEPT_CODE + '_' +
                   formatDate(startDate, 'yyyy-MM-dd') +
                   (period === 'daily' ? '' : '_to_' + formatDate(endDate, 'yyyy-MM-dd')) + '.html';
  const blob = Utilities.newBlob(html, 'text/html', filename);

  const monthlyFolder = DriveApp.getFolderById(cfg.MONTHLY_FOLDER_ID);
  const sub = _getOrCreateSubFolder(monthlyFolder, formatDate(startDate, 'yyyy-MM'));
  const file = sub.createFile(blob);

  return {
    fileId:   file.getId(),
    fileUrl:  file.getUrl(),
    filename: filename,
    savedTo:  'Monthly/' + formatDate(startDate, 'yyyy-MM') + '/' + filename
  };
}

// ════════════════════════════════════════════════════════════════
// HTML TEMPLATE
// ════════════════════════════════════════════════════════════════
function _dashboardHTML(payload) {
  const dataJson = JSON.stringify(payload).replace(/<\/script>/g, '<\\/script>');
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OT Dashboard — ${payload.meta.deptCode}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', 'Tahoma', sans-serif; background: #eef1f5; color: #1a1a1a; padding: 20px; }
  .container { max-width: 1280px; margin: 0 auto; }
  .hero { background: linear-gradient(135deg, #0a3d7a, #1f5cb0); color: #fff; padding: 22px 28px; border-radius: 12px; display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; box-shadow: 0 4px 14px rgba(10,61,122,0.18); }
  .hero h1 { font-size: 26px; margin-bottom: 4px; }
  .hero .sub { font-size: 13px; opacity: 0.85; }
  .hero .badge { background: rgba(255,255,255,0.15); padding: 10px 16px; border-radius: 8px; text-align: right; font-size: 12px; backdrop-filter: blur(8px); }
  .hero .badge .big { font-size: 17px; font-weight: 700; margin-bottom: 2px; }

  .grid-kpi { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
  .kpi { padding: 16px 18px; border-radius: 10px; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .kpi .label { font-size: 11px; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px; }
  .kpi .value { font-size: 32px; font-weight: 700; line-height: 1.1; margin: 5px 0; }
  .kpi .sub { font-size: 10px; opacity: 0.85; }
  .k1 { background: linear-gradient(135deg, #0a3d7a, #2e6cc9); }
  .k2 { background: linear-gradient(135deg, #2a8d4a, #4ec47a); }
  .k3 { background: linear-gradient(135deg, #c9621a, #f29200); }
  .k4 { background: linear-gradient(135deg, #7a3d8a, #b860c9); }

  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .row.r3 { grid-template-columns: 2fr 1fr; }
  .card { background: #fff; padding: 16px 18px; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
  .card h2 { font-size: 14px; color: #0a3d7a; border-left: 4px solid #f29200; padding-left: 8px; margin-bottom: 10px; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #0a3d7a; color: #fff; padding: 7px 9px; text-align: left; font-weight: 600; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 9px; border-bottom: 1px solid #eaeaea; }
  tr:nth-child(even) td { background: #fafbfc; }
  tr.total td { font-weight: 700; background: #fff5e0; border-top: 2px solid #f29200; }
  tr.dept-hdr td { background: #fff5e0; color: #c9621a; font-weight: 700; font-style: italic; font-size: 11px; }
  tr.overlimit td { background: #ffeaea; color: #7a1212; font-weight: 600; }

  .filter { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; padding: 10px 14px; background: #fff; border-radius: 10px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
  .filter label { font-size: 12px; font-weight: 600; color: #555; }
  .filter select, .filter input { font-family: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid #d1d6dd; border-radius: 6px; }

  .alert { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; font-weight: 600; }
  .alert.danger { background: #ffeaea; border-left: 4px solid #d63a3a; color: #7a1212; }
  .alert.ok { background: #e8f5e9; border-left: 4px solid #2a8d4a; color: #1a5a2a; }
  .alert.warn { background: #fff5e0; border-left: 4px solid #f29200; color: #7a4412; }

  .chart-wrap { height: 260px; position: relative; }
  .chart-wrap.tall { height: 360px; }

  .footer { text-align: center; color: #888; font-size: 11px; margin-top: 18px; padding-top: 10px; border-top: 1px solid #ddd; }

  @media print {
    body { background: #fff; padding: 0; }
    .filter { display: none; }
    .card, .hero, .kpi { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- Hero -->
  <div class="hero">
    <div>
      <h1>OT Performance Dashboard</h1>
      <div class="sub">${payload.meta.department} · ${payload.meta.deptCode}</div>
    </div>
    <div class="badge">
      <div class="big" id="periodBadge">—</div>
      <div>Generated: ${payload.meta.generatedAt}</div>
    </div>
  </div>

  <!-- KPI cards -->
  <div class="grid-kpi" id="kpiRow"></div>

  <!-- Alert (Over-limit) -->
  <div id="alertBox"></div>

  <!-- Filter controls -->
  <div class="filter">
    <label>แผนก:</label>
    <select id="filterDept">
      <option value="ALL">ทั้งหมด</option>
      <option value="PSA">PSA — การโดยสาร</option>
      <option value="LL">LL — ติดตามสัมภาระ</option>
    </select>
    <label>ทีม:</label>
    <select id="filterTeam"><option value="ALL">ทั้งหมด</option></select>
    <label>Sort:</label>
    <select id="sortBy">
      <option value="all">OT รวม (มาก→น้อย)</option>
      <option value="name">ชื่อทีม (A→Z)</option>
      <option value="hc">จำนวนพนักงาน</option>
      <option value="ratio">OT ต่อคน</option>
    </select>
    <button onclick="window.print()" style="margin-left:auto;padding:6px 12px;border:none;background:#0a3d7a;color:#fff;border-radius:6px;cursor:pointer;font-family:inherit;">🖨 พิมพ์</button>
  </div>

  <!-- Charts row 1 -->
  <div class="row">
    <div class="card">
      <h2>OT แยกทีม (Stacked by Type)</h2>
      <div class="chart-wrap tall"><canvas id="chartTeam"></canvas></div>
    </div>
    <div class="card">
      <h2>สัดส่วน OT ตามประเภท</h2>
      <div class="chart-wrap tall"><canvas id="chartType"></canvas></div>
    </div>
  </div>

  <!-- Charts row 2 -->
  <div class="row r3">
    <div class="card">
      <h2>OT รายวัน (Trend)</h2>
      <div class="chart-wrap"><canvas id="chartTrend"></canvas></div>
    </div>
    <div class="card">
      <h2>Top 8 Airlines (ไฟลท์)</h2>
      <div class="chart-wrap"><canvas id="chartAirline"></canvas></div>
    </div>
  </div>

  <!-- OT By Team table -->
  <div class="card" style="margin-bottom:14px;">
    <h2>ตาราง OT แยกทีม</h2>
    <table id="tblTeam">
      <thead><tr>
        <th>ทีม</th><th>แผนก</th><th class="num">พนักงาน</th>
        <th class="num">ก่อนชิฟ</th><th class="num">หลังชิฟ</th>
        <th class="num">วันหยุด</th><th class="num">นักขัตฤกษ์</th>
        <th class="num">รวม (ชม.)</th><th class="num">ชม./คน</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Over-limit table -->
  <div class="card" id="overlimitCard" style="display:none;margin-bottom:14px;">
    <h2>พนักงาน OT เกิน ${payload.meta.capHours} ชม./สัปดาห์</h2>
    <table id="tblOverlimit">
      <thead><tr>
        <th>#</th><th>รหัส</th><th>ชื่อ</th><th>ทีม</th>
        <th>สัปดาห์</th><th class="num">OT จริง</th><th class="num">เกิน</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Employee breakdown -->
  <div class="row">
    <div class="card">
      <h2>พนักงานแยกทีม (จากชีต Summary)</h2>
      <table id="tblEmpTeam"><thead><tr><th>ทีม</th><th>แผนก</th><th class="num">จำนวน</th></tr></thead><tbody></tbody></table>
    </div>
    <div class="card">
      <h2>พนักงานแยกตำแหน่ง</h2>
      <table id="tblEmpPos"><thead><tr><th>ตำแหน่ง</th><th class="num">จำนวน</th></tr></thead><tbody></tbody></table>
    </div>
  </div>

  <div class="footer">
    AOT GA · ${payload.meta.deptCode} Department · OT Dashboard · พ.ร.บ.คุ้มครองแรงงาน 2541 (≤ ${payload.meta.capHours} ชม./สัปดาห์)
  </div>
</div>

<script>
const DATA = ${dataJson};
const COL = { before: '#2e6cc9', after: '#f29200', dayoff: '#d63a3a', ph: '#6a3d9a' };

// ─ Render period badge ──────────────────────────────────────────
document.getElementById('periodBadge').textContent =
  (DATA.meta.startISO === DATA.meta.endISO) ?
    DATA.meta.startISO :
    DATA.meta.startISO + ' → ' + DATA.meta.endISO;

// ─ KPI cards ────────────────────────────────────────────────────
const otPerEmp = DATA.summary.total > 0 ? (DATA.total.all / DATA.summary.total).toFixed(2) : '0.00';
document.getElementById('kpiRow').innerHTML = \`
  <div class="kpi k1"><div class="label">OT รวม</div><div class="value">\${DATA.total.all.toFixed(1)}</div><div class="sub">ชั่วโมง</div></div>
  <div class="kpi k2"><div class="label">ไฟลท์ (ไม่รวม CNL)</div><div class="value">\${DATA.flights.operating}</div><div class="sub">ทั้งหมด \${DATA.flights.total} · CNL \${DATA.flights.cancelled}</div></div>
  <div class="kpi k3"><div class="label">พนักงาน</div><div class="value">\${DATA.summary.total}</div><div class="sub">\${DATA.teams.length} ทีม</div></div>
  <div class="kpi k4"><div class="label">OT / พนักงาน</div><div class="value">\${otPerEmp}</div><div class="sub">ชม./คน</div></div>
\`;

// ─ Alert ────────────────────────────────────────────────────────
const alertBox = document.getElementById('alertBox');
if (DATA.total.all === 0 && DATA.flights.total === 0) {
  alertBox.innerHTML = '<div class="alert warn">⚠ ไม่มีข้อมูล Attendance หรือ Flight ในช่วงนี้ — แสดงเฉพาะจำนวนพนักงานจาก Summary</div>';
} else if (DATA.overLimit.length > 0) {
  alertBox.innerHTML = '<div class="alert danger">⚠ พบ ' + DATA.overLimit.length + ' ราย ที่ OT เกิน ' + DATA.meta.capHours + ' ชม./สัปดาห์ (พ.ร.บ.คุ้มครองแรงงาน 2541 มาตรา 26)</div>';
} else {
  alertBox.innerHTML = '<div class="alert ok">✓ ไม่พบพนักงาน OT เกิน ' + DATA.meta.capHours + ' ชม./สัปดาห์</div>';
}

// ─ Populate filter ──────────────────────────────────────────────
const teamSel = document.getElementById('filterTeam');
DATA.teams.forEach(t => {
  const o = document.createElement('option');
  o.value = t.code; o.textContent = t.name;
  teamSel.appendChild(o);
});

// ─ Filtering & Sorting ──────────────────────────────────────────
function getFilteredTeams() {
  const dept = document.getElementById('filterDept').value;
  const team = document.getElementById('filterTeam').value;
  const sortBy = document.getElementById('sortBy').value;
  let arr = DATA.teams.slice();
  if (dept !== 'ALL') arr = arr.filter(t => t.dept === dept);
  if (team !== 'ALL') arr = arr.filter(t => t.code === team);
  if (sortBy === 'all') arr.sort((a,b) => b.all - a.all);
  else if (sortBy === 'name') arr.sort((a,b) => a.name.localeCompare(b.name));
  else if (sortBy === 'hc') arr.sort((a,b) => b.headcount - a.headcount);
  else if (sortBy === 'ratio') arr.sort((a,b) => (b.all/(b.headcount||1)) - (a.all/(a.headcount||1)));
  return arr;
}

// ─ Charts ───────────────────────────────────────────────────────
let charts = {};
function renderCharts() {
  const teams = getFilteredTeams();

  // Team stacked bar
  if (charts.team) charts.team.destroy();
  charts.team = new Chart(document.getElementById('chartTeam'), {
    type: 'bar',
    data: {
      labels: teams.map(t => t.name),
      datasets: [
        { label: 'ก่อนชิฟ',    data: teams.map(t => t.before), backgroundColor: COL.before },
        { label: 'หลังชิฟ',    data: teams.map(t => t.after),  backgroundColor: COL.after },
        { label: 'วันหยุด',    data: teams.map(t => t.dayoff), backgroundColor: COL.dayoff },
        { label: 'นักขัตฤกษ์', data: teams.map(t => t.ph),     backgroundColor: COL.ph }
      ]
    },
    options: {
      maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { stacked: true }, y: { stacked: true, ticks: { font: { size: 10 } } } },
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // Donut by type
  if (charts.type) charts.type.destroy();
  charts.type = new Chart(document.getElementById('chartType'), {
    type: 'doughnut',
    data: {
      labels: ['ก่อนชิฟ', 'หลังชิฟ', 'วันหยุด', 'นักขัตฤกษ์'],
      datasets: [{
        data: [DATA.total.before, DATA.total.after, DATA.total.dayoff, DATA.total.ph],
        backgroundColor: [COL.before, COL.after, COL.dayoff, COL.ph]
      }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
  });

  // Daily trend
  const dates = Object.keys(DATA.byDate).sort();
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'OT รวม (ชม.)',
        data: dates.map(d => DATA.byDate[d].all),
        borderColor: '#0a3d7a', backgroundColor: 'rgba(46,108,201,0.15)',
        fill: true, tension: 0.3
      }]
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  // Airline
  const airlineEntries = Object.entries(DATA.flights.byAirline).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (charts.airline) charts.airline.destroy();
  charts.airline = new Chart(document.getElementById('chartAirline'), {
    type: 'bar',
    data: { labels: airlineEntries.map(e=>e[0]),
            datasets: [{ data: airlineEntries.map(e=>e[1]), backgroundColor: '#2e6cc9' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

// ─ Tables ───────────────────────────────────────────────────────
function renderTables() {
  const teams = getFilteredTeams();
  const tbodyT = document.querySelector('#tblTeam tbody');
  tbodyT.innerHTML = '';
  let total = { hc:0, before:0, after:0, dayoff:0, ph:0, all:0 };
  let lastDept = '';
  teams.forEach(t => {
    if (t.dept !== lastDept) {
      const r = document.createElement('tr');
      r.className = 'dept-hdr';
      const lbl = t.dept === 'PSA' ? '── การโดยสาร (PSA) ──' : '── ติดตามสัมภาระ (LL) ──';
      r.innerHTML = '<td colspan="9">' + lbl + '</td>';
      tbodyT.appendChild(r);
      lastDept = t.dept;
    }
    total.hc += t.headcount; total.before += t.before; total.after += t.after;
    total.dayoff += t.dayoff; total.ph += t.ph; total.all += t.all;
    const ratio = t.headcount > 0 ? (t.all/t.headcount).toFixed(2) : '—';
    const r = document.createElement('tr');
    r.innerHTML = \`<td>\${t.name}</td><td>\${t.dept}</td><td class="num">\${t.headcount}</td>
      <td class="num">\${t.before.toFixed(1)}</td>
      <td class="num">\${t.after.toFixed(1)}</td>
      <td class="num">\${t.dayoff.toFixed(1)}</td>
      <td class="num">\${t.ph.toFixed(1)}</td>
      <td class="num"><strong>\${t.all.toFixed(1)}</strong></td>
      <td class="num">\${ratio}</td>\`;
    tbodyT.appendChild(r);
  });
  const totalR = document.createElement('tr');
  totalR.className = 'total';
  totalR.innerHTML = \`<td>รวม</td><td></td><td class="num">\${total.hc}</td>
    <td class="num">\${total.before.toFixed(1)}</td>
    <td class="num">\${total.after.toFixed(1)}</td>
    <td class="num">\${total.dayoff.toFixed(1)}</td>
    <td class="num">\${total.ph.toFixed(1)}</td>
    <td class="num">\${total.all.toFixed(1)}</td>
    <td class="num">\${total.hc>0 ? (total.all/total.hc).toFixed(2) : '—'}</td>\`;
  tbodyT.appendChild(totalR);
}

function renderOverLimit() {
  if (!DATA.overLimit.length) return;
  document.getElementById('overlimitCard').style.display = '';
  const tb = document.querySelector('#tblOverlimit tbody');
  DATA.overLimit.forEach((o, i) => {
    const r = document.createElement('tr');
    r.className = 'overlimit';
    r.innerHTML = \`<td>\${i+1}</td><td>\${o.empId||''}</td><td>\${o.empName||''}</td>
      <td>\${o.team||''}</td><td>\${o.weekLabel||''}</td>
      <td class="num">\${o.otHours.toFixed(1)}</td>
      <td class="num"><strong>+\${o.overBy.toFixed(1)}</strong></td>\`;
    tb.appendChild(r);
  });
}

function renderEmployee() {
  // by team
  const tbT = document.querySelector('#tblEmpTeam tbody');
  let lastDept = '';
  let total = 0;
  DATA.teams.forEach(t => {
    if (t.dept !== lastDept) {
      const r = document.createElement('tr');
      r.className = 'dept-hdr';
      const lbl = t.dept === 'PSA' ? '── การโดยสาร (PSA) ──' : '── ติดตามสัมภาระ (LL) ──';
      r.innerHTML = '<td colspan="3">' + lbl + '</td>';
      tbT.appendChild(r);
      lastDept = t.dept;
    }
    const r = document.createElement('tr');
    r.innerHTML = '<td>'+t.name+'</td><td>'+t.dept+'</td><td class="num">'+t.headcount+'</td>';
    tbT.appendChild(r);
    total += t.headcount;
  });
  const tr = document.createElement('tr');
  tr.className = 'total';
  tr.innerHTML = '<td>รวม</td><td></td><td class="num">'+total+'</td>';
  tbT.appendChild(tr);

  // by position
  const tbP = document.querySelector('#tblEmpPos tbody');
  (DATA.summary.positions || []).forEach(p => {
    const r = document.createElement('tr');
    r.innerHTML = '<td>'+p+'</td><td class="num">'+(DATA.summary.byPosition[p]||0)+'</td>';
    tbP.appendChild(r);
  });
  const totR = document.createElement('tr');
  totR.className = 'total';
  totR.innerHTML = '<td>รวม</td><td class="num">'+DATA.summary.total+'</td>';
  tbP.appendChild(totR);
}

// ─ Init ─────────────────────────────────────────────────────────
['filterDept','filterTeam','sortBy'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { renderCharts(); renderTables(); });
});
renderCharts();
renderTables();
renderOverLimit();
renderEmployee();
</script>
</body>
</html>`;
}