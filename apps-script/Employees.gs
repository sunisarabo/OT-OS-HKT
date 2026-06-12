/**
 * Employees.gs — รายงาน OT รายชื่อพนักงาน แยก 3 แผนก KP / LP / LL
 * ===================================================================
 * ต่อยอดจากระบบ "OT Report — PSA" เดิม โดย "ใช้ readAttendance() + ตรรกะ OT เดิม"
 * แล้วจัดกลุ่มใหม่เป็น 3 แผนก + แยกรายสัปดาห์ (W1–W4) และรายเดือน รายชื่อรายคน
 *
 *   KP = การโดยสาร (PSA ทุกทีม ยกเว้น PORTER, PVT)
 *   LP = PORTER + PVT  (Porter / บริการผู้โดยสารพิเศษ)
 *   LL = ติดตามสัมภาระ (ADMIN LL / lOST AND fOUND / PORTER LL)
 *
 * เปิดรายงาน:  <web-app-url>?view=employees&period=monthly&month=2026-05
 *   (ต้องเพิ่ม 1 บรรทัดใน Webapp.gs → doGet, ดู INTEGRATION.md)
 *
 * วิธีติดตั้ง: วางทั้งไฟล์นี้แทนไฟล์ Employees (สตับเดิม) แล้วเพิ่ม route ใน doGet
 * ตรวจก่อนใช้จริง: รัน inspectEmployees3() ใน Editor → ดู Execution log
 */

// ────────── การจัดกลุ่ม 3 แผนก ──────────
/** teamCode (Config) → 'KP' | 'LP' | 'LL' */
function dept3ForTeam_(teamCode) {
  var t = String(teamCode || '').toUpperCase().trim();
  if (!t) return 'KP';
  var cfg = getRuntimeConfig();
  var def = null;
  for (var i = 0; i < cfg.TEAMS.length; i++) {
    if (cfg.TEAMS[i].code === t) { def = cfg.TEAMS[i]; break; }
  }
  // ทีมในแผนก LL (ติดตามสัมภาระ) → LL
  if (def && def.dept === 'LL') return 'LL';
  if (/LOST|FOUND|_LL$|^LL/.test(t)) return 'LL';
  // PORTER หลัก + PVT → LP
  if (t === 'PORTER' || t === 'PVT' || t.indexOf('PRIVATE') >= 0 || t.indexOf('VIP') >= 0) return 'LP';
  return 'KP';
}

/** teamCode → ชื่อแสดงผล (จาก Config) */
function teamDisplayName_(teamCode) {
  var t = String(teamCode || '').toUpperCase().trim();
  var cfg = getRuntimeConfig();
  for (var i = 0; i < cfg.TEAMS.length; i++) {
    if (cfg.TEAMS[i].code === t) return cfg.TEAMS[i].name;
  }
  return teamCode || '(ไม่ระบุทีม)';
}

var DEPT3_DEFS = [
  { code: 'KP', name: 'KP — การโดยสาร',     color: '#2563eb' },
  { code: 'LP', name: 'LP — Porter / PVT',  color: '#a855f7' },
  { code: 'LL', name: 'LL — ติดตามสัมภาระ',  color: '#0d9488' }
];

/** สัปดาห์ของเดือนจากเลขวัน (ตรงกับ dashboard PSA/LL): 1-7,8-14,15-21,22+ */
function _emp3WeekIndex(day) {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}
var _EMP3_MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ────────── สร้างรายงาน (server) ──────────
/**
 * รวม OT รายคน → แผนก(KP/LP/LL) → ทีม → สัปดาห์/เดือน
 * @returns {{months:[], depts:[], report:{ 'May 2026': { KP:{total_hrs,headcount,teams,employees[]}, LP, LL } }, meta }}
 */
function getEmployeeReport3(startDate, endDate) {
  var attendance = readAttendance(startDate, endDate);   // ใช้ readers + ตรรกะ OT เดิม
  var report = {};
  var monthOrder = {};
  var seenEmp = {};   // mk|dept|empId → index ใน employees[]

  (attendance || []).forEach(function (r) {
    var hrs = +r.otHrs || 0;
    if (hrs <= 0 || !r.date) return;
    var d = (r.date instanceof Date) ? r.date : new Date(r.date);
    if (isNaN(d)) return;

    var teamCode = r.team ? (normalizeTeamCode(r.team) || r.team) : 'UNKNOWN';
    var dept = dept3ForTeam_(teamCode);
    var mk = _EMP3_MON_ABBR[d.getMonth()] + ' ' + d.getFullYear();
    monthOrder[mk] = d.getFullYear() * 100 + d.getMonth();
    var wi = _emp3WeekIndex(d.getDate());

    if (!report[mk]) report[mk] = {};
    if (!report[mk][dept]) report[mk][dept] = { total_hrs: 0, headcount: 0, teams: {}, employees: [] };
    var bucket = report[mk][dept];

    var empId = r.empId || r.empName || '?';
    var ekey = mk + '|' + dept + '|' + empId;
    var idx = seenEmp[ekey];
    if (idx === undefined) {
      idx = bucket.employees.length;
      seenEmp[ekey] = idx;
      bucket.employees.push({
        code: r.empId || '', name: r.empName || '', team: teamDisplayName_(teamCode),
        teamCode: teamCode, weeks: [0, 0, 0, 0], total_hrs: 0
      });
      bucket.headcount += 1;
      var tn = teamDisplayName_(teamCode);
      if (!bucket.teams[tn]) bucket.teams[tn] = { total_hrs: 0, headcount: 0 };
      bucket.teams[tn].headcount += 1;
    }
    var emp = bucket.employees[idx];
    emp.weeks[wi] += hrs;
    emp.total_hrs += hrs;
    bucket.total_hrs += hrs;
    bucket.teams[emp.team].total_hrs += hrs;
  });

  // เรียงรายคนมาก→น้อยในแต่ละแผนก + ปัดทศนิยม
  Object.keys(report).forEach(function (mk) {
    DEPT3_DEFS.forEach(function (dd) {
      var b = report[mk][dd.code];
      if (!b) return;
      b.employees.forEach(function (e) {
        e.weeks = e.weeks.map(function (x) { return Math.round(x * 10) / 10; });
        e.total_hrs = Math.round(e.total_hrs * 10) / 10;
      });
      b.employees.sort(function (a, z) { return z.total_hrs - a.total_hrs; });
      b.total_hrs = Math.round(b.total_hrs * 10) / 10;
      Object.keys(b.teams).forEach(function (t) { b.teams[t].total_hrs = Math.round(b.teams[t].total_hrs * 10) / 10; });
    });
  });

  var months = Object.keys(monthOrder).sort(function (a, b) { return monthOrder[a] - monthOrder[b]; });
  return {
    months: months, depts: DEPT3_DEFS, report: report,
    meta: { records: (attendance || []).length, start: String(startDate), end: String(endDate) }
  };
}

// ────────── หน้าเว็บ (เรียกจาก doGet ?view=employees) ──────────
/**
 * เพิ่มใน Webapp.gs → doGet ต้นฟังก์ชัน:
 *   if ((e.parameter||{}).view === 'employees') return renderEmployeeReportPage_(e);
 */
function renderEmployeeReportPage_(e) {
  e = e || {}; var p = e.parameter || {};
  var start, end;
  if (p.start && p.end) { start = _wa_parseDate(p.start); end = _wa_parseDate(p.end); }
  else if (p.month && /^(\d{4})-(\d{1,2})$/.test(p.month)) {
    var m = p.month.match(/^(\d{4})-(\d{1,2})$/);
    start = new Date(+m[1], +m[2] - 1, 1); end = new Date(+m[1], +m[2], 0);
  } else {
    // ค่าเริ่มต้น: ทั้งช่วงข้อมูลที่มี (Oct 2025 → ปัจจุบัน) เพื่อให้เห็นทุกเดือน
    var t = new Date();
    start = new Date(2025, 9, 1); end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  }
  var data = getEmployeeReport3(start, end);
  var json = JSON.stringify(data).replace(/<\/script>/g, '<\\/script>');
  var html = EMP3_PAGE_HTML.replace('/*__DATA__*/', 'var REPORT = ' + json + ';');
  return HtmlService.createHtmlOutput(html)
    .setTitle('OT รายชื่อพนักงาน — KP / LP / LL')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ────────── Diagnostics ──────────
function inspectEmployees3() {
  var t = new Date();
  var start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  var end   = new Date(t.getFullYear(), t.getMonth(), 0);
  var att = readAttendance(start, end);
  Logger.log('attendance records: ' + (att ? att.length : 0));
  var d = getEmployeeReport3(start, end);
  Logger.log('months: ' + d.months.join(', '));
  d.months.forEach(function (mk) {
    var r = d.report[mk];
    Logger.log('  ' + mk + ' → KP ' + ((r.KP || {}).headcount || 0) + 'คน/' + ((r.KP || {}).total_hrs || 0) + 'ชม.' +
      ' | LP ' + ((r.LP || {}).headcount || 0) + 'คน/' + ((r.LP || {}).total_hrs || 0) + 'ชม.' +
      ' | LL ' + ((r.LL || {}).headcount || 0) + 'คน/' + ((r.LL || {}).total_hrs || 0) + 'ชม.');
  });
}

// ────────── HTML template (server-rendered, embed REPORT) ──────────
var EMP3_PAGE_HTML = [
'<!doctype html><html lang="th"><head><meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>OT รายชื่อ KP/LP/LL</title>',
'<style>',
':root{--bg:#f7f7f5;--card:#fff;--txt:#1a1a18;--txt2:#5f5e5a;--txt3:#8a8a82;--br:rgba(0,0,0,.12);--soft:#f2f3f5;',
'--font:-apple-system,BlinkMacSystemFont,"Segoe UI","Sarabun",sans-serif;--KP:#2563eb;--LP:#a855f7;--LL:#0d9488}',
'*{box-sizing:border-box;margin:0;padding:0}body{font-family:var(--font);background:var(--bg);color:var(--txt);padding:14px}',
'.wrap{max-width:1180px;margin:0 auto}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}',
'h1{font-size:20px;font-weight:600}.sub{font-size:12.5px;color:var(--txt2);margin-top:3px}',
'.deptbar{display:flex;background:var(--card);border:.5px solid var(--br);border-radius:9px;padding:3px;gap:2px}',
'.deptbtn{padding:7px 18px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:600;color:var(--txt2)}',
'.deptbtn.on.KP{background:var(--KP);color:#fff}.deptbtn.on.LP{background:var(--LP);color:#fff}.deptbtn.on.LL{background:var(--LL);color:#fff}',
'.actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}',
'.btn{padding:7px 13px;border:.5px solid var(--br);border-radius:8px;background:var(--card);cursor:pointer;font-family:var(--font);font-size:12px;font-weight:500}',
'.btn:hover{background:var(--soft)}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;overflow-x:auto}',
'.tab{padding:6px 14px;border:.5px solid var(--br);border-radius:8px;background:var(--card);cursor:pointer;font-size:12.5px;color:var(--txt2);white-space:nowrap;font-family:var(--font)}',
'.tab.on{background:#e6f1fb;color:#185fa5;border-color:transparent;font-weight:500}',
'.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
'@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr)}.head{flex-direction:column}}',
'.metric{background:var(--card);border:.5px solid var(--br);border-radius:9px;padding:12px 14px}',
'.metric .l{font-size:11.5px;color:var(--txt2);margin-bottom:5px}.metric .v{font-size:19px;font-weight:600}.metric .s{font-size:11px;color:var(--txt3);margin-top:2px}',
'.card{background:var(--card);border:.5px solid var(--br);border-radius:11px;padding:14px 16px;margin-bottom:14px;overflow:hidden}',
'.teamhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:9px;border-bottom:.5px solid var(--br)}',
'.teamname{font-size:14px;font-weight:600}.teamsum{font-size:12px;color:var(--txt2)}.tw{overflow-x:auto}',
'table{width:100%;border-collapse:collapse;font-size:12.5px}th{font-size:11px;font-weight:500;color:var(--txt2);text-align:left;padding:7px 9px;border-bottom:.5px solid var(--br);background:var(--soft);white-space:nowrap}',
'td{padding:6px 9px;border-bottom:.5px solid var(--br);white-space:nowrap}td.num,th.num{text-align:right}tr:hover td{background:var(--soft)}.tot td{font-weight:600;background:var(--soft)}',
'.bar{display:flex;align-items:center;gap:8px}.barbg{height:6px;border-radius:3px;background:var(--br);flex:1;min-width:46px}.barfill{height:6px;border-radius:3px}',
'.empty{text-align:center;padding:40px 20px;color:var(--txt2);font-size:13px}',
'@media print{.actions,.deptbar,.tabs,.btn{display:none!important}.card{break-inside:avoid;border:1px solid #cbd5e1}th{background:#f1f5f9!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
'</style></head><body><div class="wrap">',
'<div class="head"><div><h1>รายงาน OT รายชื่อพนักงาน</h1><div class="sub" id="sub"></div></div><div class="deptbar" id="deptbar"></div></div>',
'<div class="actions"><button class="btn" onclick="exportCsv()">⬇ Export CSV</button><button class="btn" onclick="window.print()">🖨 Print / PDF</button><span class="sub" id="meta" style="margin-left:auto;align-self:center"></span></div>',
'<div class="tabs" id="months"></div><div class="metrics" id="metrics" style="display:none"></div><div id="content"></div></div>',
'<script>/*__DATA__*/',
'var dept="KP",month=null,DC={KP:"#2563eb",LP:"#a855f7",LL:"#0d9488"};',
'function fmt(h){if(!h)return "0";return (Math.round(h*10)/10).toLocaleString("en-US",{maximumFractionDigits:1});}',
'function esc(s){return String(s==null?"":s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}',
'function dObj(){return (REPORT.report[month]&&REPORT.report[month][dept])||null;}',
'function deptbar(){document.getElementById("deptbar").innerHTML=REPORT.depts.map(function(x){return "<button class=\\"deptbtn "+x.code+(x.code===dept?" on":"")+"\\" onclick=\\"setDept(\'"+x.code+"\')\\">"+x.code+"</button>";}).join("");}',
'function setDept(c){dept=c;deptbar();render();}',
'function months(){document.getElementById("months").innerHTML=REPORT.months.map(function(m){return "<button class=\\"tab"+(m===month?" on":"")+"\\" onclick=\\"setMonth(\'"+m+"\')\\">"+m+"</button>";}).join("");}',
'function setMonth(m){month=m;months();render();}',
'function metric(l,v,s){return "<div class=\\"metric\\"><div class=\\"l\\">"+l+"</div><div class=\\"v\\">"+v+"</div><div class=\\"s\\">"+(s||"")+"</div></div>";}',
'function render(){var info=REPORT.depts.filter(function(x){return x.code===dept})[0]||{name:dept};',
'document.getElementById("sub").textContent=info.name+" · "+month+" · รายสัปดาห์ (W1–W4) + รวมเดือน (ชม.)";',
'var b=dObj(),mx=document.getElementById("metrics");',
'if(!b||!b.employees.length){mx.style.display="none";document.getElementById("content").innerHTML="<div class=\\"card empty\\">ไม่มีข้อมูล OT ของแผนก "+dept+" ในเดือน "+month+"</div>";return;}',
'var teams=Object.keys(b.teams).sort(function(a,c){return b.teams[c].total_hrs-b.teams[a].total_hrs;});var top=b.employees[0];',
'mx.style.display="grid";mx.innerHTML=metric("OT รวม — "+dept,fmt(b.total_hrs)+" ชม.",b.headcount+" คน")+metric("พนักงานที่ทำ OT",b.headcount+" คน",teams.length+" ทีมย่อย")+metric("สูงสุดรายคน",top?esc(top.name):"-",top?fmt(top.total_hrs)+" ชม.":"")+metric("ทีมสูงสุด",teams[0]||"-",teams[0]?fmt(b.teams[teams[0]].total_hrs)+" ชม.":"");',
'var col=DC[dept],html="";teams.forEach(function(tn){var emps=b.employees.filter(function(e){return e.team===tn});if(!emps.length)return;var tt=b.teams[tn];var maxv=Math.max.apply(null,emps.map(function(e){return e.total_hrs;}))||1;',
'html+="<div class=\\"card\\"><div class=\\"teamhead\\"><div class=\\"teamname\\" style=\\"color:"+col+"\\">"+esc(tn)+"</div><div class=\\"teamsum\\">"+emps.length+" คน · รวม "+fmt(tt.total_hrs)+" ชม.</div></div><div class=\\"tw\\"><table><thead><tr><th>ลำดับ</th><th>รหัส</th><th>ชื่อ - สกุล</th><th class=\\"num\\">W1</th><th class=\\"num\\">W2</th><th class=\\"num\\">W3</th><th class=\\"num\\">W4</th><th class=\\"num\\">รวมเดือน</th></tr></thead><tbody>";',
'emps.forEach(function(e,i){html+="<tr><td>"+(i+1)+"</td><td style=\\"color:var(--txt2)\\">"+esc(e.code)+"</td><td>"+esc(e.name)+"</td><td class=\\"num\\">"+(e.weeks[0]?fmt(e.weeks[0]):"-")+"</td><td class=\\"num\\">"+(e.weeks[1]?fmt(e.weeks[1]):"-")+"</td><td class=\\"num\\">"+(e.weeks[2]?fmt(e.weeks[2]):"-")+"</td><td class=\\"num\\">"+(e.weeks[3]?fmt(e.weeks[3]):"-")+"</td><td class=\\"num\\"><div class=\\"bar\\"><div class=\\"barbg\\"><div class=\\"barfill\\" style=\\"width:"+Math.round(e.total_hrs/maxv*100)+"%;background:"+col+"\\"></div></div><span style=\\"min-width:46px;text-align:right;font-weight:600\\">"+fmt(e.total_hrs)+"</span></div></td></tr>";});',
'var wt=[0,0,0,0];emps.forEach(function(e){for(var k=0;k<4;k++)wt[k]+=e.weeks[k];});html+="<tr class=\\"tot\\"><td colspan=3>รวมทีม "+esc(tn)+"</td><td class=\\"num\\">"+fmt(wt[0])+"</td><td class=\\"num\\">"+fmt(wt[1])+"</td><td class=\\"num\\">"+fmt(wt[2])+"</td><td class=\\"num\\">"+fmt(wt[3])+"</td><td class=\\"num\\">"+fmt(tt.total_hrs)+"</td></tr></tbody></table></div></div>";});',
'document.getElementById("content").innerHTML=html;}',
'function exportCsv(){var b=dObj();if(!b)return;var rows=[["รายงาน OT รายชื่อ — แผนก "+dept,"เดือน "+month],["ลำดับ","รหัสพนักงาน","ชื่อ - สกุล","ทีม","W1","W2","W3","W4","รวมเดือน(ชม.)"]];',
'var teams=Object.keys(b.teams).sort(function(a,c){return b.teams[c].total_hrs-b.teams[a].total_hrs;});teams.forEach(function(tn){b.employees.filter(function(e){return e.team===tn}).forEach(function(e,i){rows.push([i+1,e.code,e.name,tn,fmt(e.weeks[0]),fmt(e.weeks[1]),fmt(e.weeks[2]),fmt(e.weeks[3]),fmt(e.total_hrs)]);});});',
'rows.push(["","","","รวมแผนก "+dept,"","","","",fmt(b.total_hrs)]);',
'var csv=rows.map(function(r){return r.map(function(c){var s=String(c==null?"":c);return /[",\\n]/.test(s)?\'"\'+s.replace(/"/g,\'""\')+\'"\':s;}).join(",");}).join("\\n");',
'var blob=new Blob(["\\ufeff"+csv],{type:"text/csv;charset=utf-8;"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="OT-"+dept+"_"+month.replace(" ","-")+".csv";a.click();URL.revokeObjectURL(a.href);}',
'(function(){if(!REPORT.months.length){document.getElementById("content").innerHTML="<div class=\\"card empty\\">ไม่พบข้อมูล OT ในช่วงที่เลือก — ลองเพิ่ม ?month=2026-05</div>";document.getElementById("meta").textContent="records: "+(REPORT.meta?REPORT.meta.records:0);deptbar();return;}',
'month=REPORT.months[REPORT.months.length-1];document.getElementById("meta").textContent="records: "+(REPORT.meta?REPORT.meta.records:0);deptbar();months();render();})();',
'<\/script></body></html>'
].join('\n');
