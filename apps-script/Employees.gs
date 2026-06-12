/**
 * Employees.gs — รายงาน OT รายชื่อพนักงาน แยก 3 แผนก KP / LP / LL
 * ===================================================================
 * ต่อยอดระบบ "OT Report — PSA" โดยใช้ readAttendance() + ตรรกะ OT เดิม
 * แล้วจัดกลุ่มใหม่เป็น 3 แผนก + แยกรายสัปดาห์ (W1-W4) และรายเดือน รายชื่อรายคน
 *
 *   KP = การโดยสาร (PSA ทุกทีม ยกเว้น PORTER, PVT)
 *   LP = PORTER + PVT
 *   LL = ติดตามสัมภาระ (ADMIN LL / lOST AND fOUND / PORTER LL)
 *
 * ติดตั้ง 3 จุด (ดู INTEGRATION.md):
 *   1) วางไฟล์นี้แทนไฟล์ Employees (สตับเดิม)
 *   2) เพิ่มไฟล์ HTML ชื่อ EmployeeReport (เนื้อหาจาก EmployeeReport.html)
 *   3) ใน Webapp.gs > doGet เพิ่ม:
 *        if (params.view === 'employees') return renderEmployeeReportPage_();
 *
 * ตรวจก่อนใช้: รัน inspectEmployees3() ใน Editor แล้วดู Execution log
 */

var DEPT3_DEFS = [
  { code: 'KP', name: 'KP - การโดยสาร',     color: '#2563eb' },
  { code: 'LP', name: 'LP - Porter / PVT',  color: '#a855f7' },
  { code: 'LL', name: 'LL - ติดตามสัมภาระ',  color: '#0d9488' }
];
var EMP3_MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** teamCode (Config) -> 'KP' | 'LP' | 'LL' */
function dept3ForTeam_(teamCode) {
  var t = String(teamCode || '').toUpperCase().trim();
  if (!t) return 'KP';
  var cfg = getRuntimeConfig();
  var def = null;
  for (var i = 0; i < cfg.TEAMS.length; i++) {
    if (cfg.TEAMS[i].code === t) { def = cfg.TEAMS[i]; break; }
  }
  if (def && def.dept === 'LL') return 'LL';
  if (/LOST|FOUND|_LL$|^LL/.test(t)) return 'LL';
  if (t === 'PORTER' || t === 'PVT' || t.indexOf('PRIVATE') >= 0 || t.indexOf('VIP') >= 0) return 'LP';
  return 'KP';
}

/** teamCode -> ชื่อแสดงผล (จาก Config) */
function teamDisplayName_(teamCode) {
  var t = String(teamCode || '').toUpperCase().trim();
  var cfg = getRuntimeConfig();
  for (var i = 0; i < cfg.TEAMS.length; i++) {
    if (cfg.TEAMS[i].code === t) return cfg.TEAMS[i].name;
  }
  return teamCode || '(ไม่ระบุทีม)';
}

/** สัปดาห์ของเดือนจากเลขวัน: 1-7,8-14,15-21,22+ */
function emp3WeekIndex_(day) {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

/**
 * รวม OT รายคน -> แผนก(KP/LP/LL) -> ทีม -> สัปดาห์/เดือน
 * @returns {months:[], depts:[], report:{}, meta:{}}
 */
function getEmployeeReport3(startDate, endDate) {
  var attendance = readAttendance(startDate, endDate);
  var report = {};
  var monthOrder = {};
  var seenEmp = {};

  (attendance || []).forEach(function (r) {
    var hrs = +r.otHrs || 0;
    if (hrs <= 0 || !r.date) return;
    var d = (r.date instanceof Date) ? r.date : new Date(r.date);
    if (isNaN(d)) return;

    var teamCode = r.team ? (normalizeTeamCode(r.team) || r.team) : 'UNKNOWN';
    var dept = dept3ForTeam_(teamCode);
    var mk = EMP3_MON_ABBR[d.getMonth()] + ' ' + d.getFullYear();
    monthOrder[mk] = d.getFullYear() * 100 + d.getMonth();
    var wi = emp3WeekIndex_(d.getDate());

    if (!report[mk]) report[mk] = {};
    if (!report[mk][dept]) report[mk][dept] = { total_hrs: 0, headcount: 0, teams: {}, employees: [] };
    var bucket = report[mk][dept];

    var empId = r.empId || r.empName || '?';
    var ekey = mk + '|' + dept + '|' + empId;
    var idx = seenEmp[ekey];
    if (idx === undefined) {
      idx = bucket.employees.length;
      seenEmp[ekey] = idx;
      var tn = teamDisplayName_(teamCode);
      bucket.employees.push({ code: r.empId || '', name: r.empName || '', team: tn, weeks: [0,0,0,0], total_hrs: 0 });
      bucket.headcount += 1;
      if (!bucket.teams[tn]) bucket.teams[tn] = { total_hrs: 0, headcount: 0 };
      bucket.teams[tn].headcount += 1;
    }
    var emp = bucket.employees[idx];
    emp.weeks[wi] += hrs;
    emp.total_hrs += hrs;
    bucket.total_hrs += hrs;
    bucket.teams[emp.team].total_hrs += hrs;
  });

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
  return { months: months, depts: DEPT3_DEFS, report: report,
           meta: { records: (attendance || []).length } };
}

/**
 * เรียกจากหน้าเว็บ (google.script.run) — รับ 'YYYY-MM' หรือว่าง (= เดือนปัจจุบัน)
 */
function getEmployeeReport3ForClient(monthStr) {
  var start, end;
  var m = String(monthStr || '').match(/^(\d{4})-(\d{1,2})$/);
  if (m) { start = new Date(+m[1], +m[2] - 1, 1); end = new Date(+m[1], +m[2], 0); }
  else { var t = new Date(); start = new Date(t.getFullYear(), t.getMonth(), 1); end = new Date(t.getFullYear(), t.getMonth() + 1, 0); }
  return getEmployeeReport3(start, end);
}

/** route สำหรับ doGet: if (params.view === 'employees') return renderEmployeeReportPage_(); */
function renderEmployeeReportPage_() {
  return HtmlService.createHtmlOutputFromFile('EmployeeReport')
    .setTitle('OT รายชื่อพนักงาน - KP / LP / LL')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Diagnostic — รันใน Editor */
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
    Logger.log('  ' + mk + ' KP ' + ((r.KP||{}).headcount||0) + 'คน/' + ((r.KP||{}).total_hrs||0) + 'ชม.' +
      ' | LP ' + ((r.LP||{}).headcount||0) + 'คน/' + ((r.LP||{}).total_hrs||0) + 'ชม.' +
      ' | LL ' + ((r.LL||{}).headcount||0) + 'คน/' + ((r.LL||{}).total_hrs||0) + 'ชม.');
  });
}
