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
  { code: 'LP', name: 'LP - บริการผู้โดยสารพิเศษ',  color: '#a855f7' },
  { code: 'LL', name: 'LL - ติดตามสัมภาระ',  color: '#0d9488' }
];
var EMP3_MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ไฟล์ OT ของ LL (pivot รายคนรายวัน — ชีต "PA") — ใช้แทน roster รายวันที่ระบบเดิมหาไม่เจอ
// ⚠️ ต้องแชร์ไฟล์นี้ให้บัญชีที่รัน Web App ด้วย
var LL_OT_FILE_ID = '1i2c41P5zzHrvvzpJp7RJ9IT349fbWbk4jJMeb0lD5jE';

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

/**
 * หา teamCode ของ record — ถ้าชีทไม่แมปเป็นทีม (ว่าง/UNKNOWN) ให้เปิดจาก master ด้วย empId
 * @param {Object} r record
 * @param {Object} master ผลของ getMasterEmployees()
 */
function resolveTeamCode_(r, master) {
  var tc = r.team ? (normalizeTeamCode(r.team) || String(r.team)) : '';
  if (!tc || tc === 'UNKNOWN') {
    var id = String(r.empId == null ? '' : r.empId).replace(/\.0+$/, '').trim();
    var me = (id && master && master.byId) ? master.byId[id] : null;
    if (me && me.teamCode) tc = me.teamCode;
  }
  return tc || 'UNKNOWN';
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
 * @param {Array} [attendanceOpt] ส่ง attendance ที่อ่านไว้แล้วมาได้ (กันอ่านซ้ำ)
 * @returns {months:[], depts:[], report:{}, meta:{}}
 */
function getEmployeeReport3(startDate, endDate, attendanceOpt) {
  var attendance = attendanceOpt || readAttendance(startDate, endDate);
  var master = getMasterEmployees();
  var llRecs = _readLLPivotRecords(startDate, endDate, master);   // LL จากไฟล์ pivot แยก
  if (llRecs && llRecs.length) attendance = (attendance || []).concat(llRecs);
  var report = {};
  var monthOrder = {};
  var seenEmp = {};

  (attendance || []).forEach(function (r) {
    var hrs = +r.otHrs || 0;
    if (hrs <= 0 || !r.date) return;
    var d = (r.date instanceof Date) ? r.date : new Date(r.date);
    if (isNaN(d)) return;

    var teamCode = resolveTeamCode_(r, master);
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
 * ลำดับการหา: CacheService → ไฟล์ Drive (precompute) → คำนวณสด (ช้า ~10-15 นาที)
 * แนะนำ: รัน precacheMonth3('2026-06') ใน Editor ก่อน 1 ครั้ง แล้วหน้าเว็บจะเปิดเร็วทันที
 */
function getEmployeeReport3ForClient(monthStr, force, quickOnly) {
  var mm = _emp3Month_(monthStr);
  var cache = CacheService.getScriptCache(), ckey = 'EMP3_' + mm.key;
  if (!force) {
    var hit = cache.get(ckey);
    if (hit) { try { var o = JSON.parse(hit); o.cached = true; return o; } catch (e) {} }
    var dv = _emp3DriveRead_(mm.key);
    if (dv) { try { var s0 = JSON.stringify(dv); if (s0.length < 95000) cache.put(ckey, s0, 21600); } catch (e) {} return dv; }
  }
  // ยังไม่ precompute → ไม่คำนวณสด (กันหน้าเว็บค้าง 15 นาที) แจ้งให้ไป precache
  if (quickOnly && !force) {
    return { notReady: true, month: mm.key, months: [], depts: DEPT3_DEFS, report: {}, meta: { records: 0 } };
  }
  var data = getEmployeeReport3(mm.start, mm.end);
  try { _emp3DriveSave_(mm.key, data); } catch (e) {}
  try { var s = JSON.stringify(data); if (s.length < 95000) cache.put(ckey, s, 21600); } catch (e) {}
  return data;
}

/** รันใน Editor ครั้งเดียวต่อเดือน (Workspace จำกัด 30 นาที พอ) → เก็บผลไว้ให้หน้าเว็บอ่านเร็ว */
function precacheMonth3(monthStr) {
  var mm = _emp3Month_(monthStr);
  var data = getEmployeeReport3(mm.start, mm.end);
  _emp3DriveSave_(mm.key, data);
  try { CacheService.getScriptCache().put('EMP3_' + mm.key, JSON.stringify(data).slice(0, 99000), 21600); } catch (e) {}
  var first = data.months[0];
  var r = first ? data.report[first] : {};
  Logger.log('precached ' + mm.key + ' (records ' + (data.meta ? data.meta.records : 0) + ') → ' +
    'KP ' + (((r.KP||{}).headcount)||0) + ' | LP ' + (((r.LP||{}).headcount)||0) + ' | LL ' + (((r.LL||{}).headcount)||0));
  return { ok: true, month: mm.key };
}

function clearEmployee3Cache(monthStr) {
  var mm = _emp3Month_(monthStr);
  try { CacheService.getScriptCache().remove('EMP3_' + mm.key); } catch (e) {}
  var f = _emp3DriveFind_(_emp3CacheName_(mm.key));
  if (f) f.setTrashed(true);
  return { ok: true };
}

// ── helpers: เก็บ/อ่านผลลัพธ์เป็นไฟล์ JSON ใน Drive ──
function _emp3Month_(monthStr) {
  var m = String(monthStr || '').match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { key: m[1] + '-' + ('0' + m[2]).slice(-2), start: new Date(+m[1], +m[2] - 1, 1), end: new Date(+m[1], +m[2], 0) };
  var t = new Date();
  return { key: t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2), start: new Date(t.getFullYear(), t.getMonth(), 1), end: new Date(t.getFullYear(), t.getMonth() + 1, 0) };
}
function _emp3CacheName_(key) { return '_EMP3_cache_' + key + '.json'; }
function _emp3DriveFind_(name) { var it = DriveApp.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function _emp3DriveRead_(key) {
  var f = _emp3DriveFind_(_emp3CacheName_(key));
  if (!f) return null;
  try { var o = JSON.parse(f.getBlob().getDataAsString()); o.cached = true; return o; } catch (e) { return null; }
}
function _emp3DriveSave_(key, data) {
  var name = _emp3CacheName_(key), json = JSON.stringify(data), f = _emp3DriveFind_(name);
  if (f) f.setContent(json); else DriveApp.createFile(name, json, 'application/json');
}

/** route สำหรับ doGet: if (params.view === 'employees') return renderEmployeeReportPage_(); */
function renderEmployeeReportPage_() {
  return HtmlService.createHtmlOutputFromFile('EmployeeReport')
    .setTitle('OT รายชื่อพนักงาน - KP / LP / LL')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Diagnostic — รันใน Editor (ทดสอบ 3 วันล่าสุด เพื่อให้เร็ว ไม่ค้าง) */
function inspectEmployees3() {
  var end = new Date(); end.setDate(end.getDate() - 1);      // เมื่อวาน
  var start = new Date(end.getTime() - 2 * 86400000);         // ย้อนหลัง 3 วัน
  Logger.log('ช่วงทดสอบ: ' + formatDate(start, 'yyyy-MM-dd') + ' ถึง ' + formatDate(end, 'yyyy-MM-dd'));
  var att = readAttendance(start, end);                        // อ่านรอบเดียว
  Logger.log('attendance records: ' + (att ? att.length : 0));
  var d = getEmployeeReport3(start, end, att);                 // ใช้ att ซ้ำ (ไม่อ่านใหม่)
  Logger.log('months: ' + d.months.join(', '));
  d.months.forEach(function (mk) {
    var r = d.report[mk];
    Logger.log('  ' + mk + ' KP ' + ((r.KP||{}).headcount||0) + 'คน/' + ((r.KP||{}).total_hrs||0) + 'ชม.' +
      ' | LP ' + ((r.LP||{}).headcount||0) + 'คน/' + ((r.LP||{}).total_hrs||0) + 'ชม.' +
      ' | LL ' + ((r.LL||{}).headcount||0) + 'คน/' + ((r.LL||{}).total_hrs||0) + 'ชม.');
  });
}

/**
 * Diagnostic — โชว์ทุก teamCode ที่เจอ + การจัดแผนก (KP/LP/LL) + ข้อความทีมดิบ
 * ใช้หาสาเหตุว่าทำไม LP/LL = 0 (record ของ Porter/PVT/LL ถูกจัดไปไหน หรือไม่มีเลย)
 */
function diagTeams3() {
  var end = new Date(); end.setDate(end.getDate() - 1);
  var start = new Date(end.getTime() - 2 * 86400000);
  var att = readAttendance(start, end);
  var master = getMasterEmployees();
  Logger.log('records: ' + (att ? att.length : 0) + '  ช่วง ' + formatDate(start, 'yyyy-MM-dd') + ' ถึง ' + formatDate(end, 'yyyy-MM-dd'));
  var by = {};
  (att || []).forEach(function (r) {
    var tc = resolveTeamCode_(r, master);
    if (!by[tc]) by[tc] = { rec: 0, ot: 0, dept: dept3ForTeam_(tc), raw: {} };
    by[tc].rec++;
    if ((+r.otHrs || 0) > 0) by[tc].ot++;
    if (r.team) by[tc].raw[String(r.team)] = true;
  });
  Logger.log('=== teamCode | dept | records | withOT | rawTeamStrings ===');
  Object.keys(by).sort(function (a, b) { return by[a].dept < by[b].dept ? -1 : 1; }).forEach(function (tc) {
    var b = by[tc];
    Logger.log(b.dept + ' | ' + tc + ' | rec ' + b.rec + ' | OT ' + b.ot + ' | raw=' + Object.keys(b.raw).join(' , '));
  });
}

// ════════════════════════════════════════════════════════════════
// LL — อ่าน OT รายคนจากไฟล์ pivot (ชีต "PA") ของ LL_OT_FILE_ID
// คืน pseudo-records [{date, empId, empName, team, otHrs}] ให้รวมกับ attendance
// ════════════════════════════════════════════════════════════════
function _llHrs_(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return v.getHours() + v.getMinutes() / 60 + v.getSeconds() / 3600;
  if (typeof v === 'number') return v * 24;                 // Excel time fraction
  var s = String(v).trim(); if (!s || s === '-') return 0;
  var m = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (m) return (+m[1]) + (+m[2]) / 60 + ((+m[3]) || 0) / 3600;
  var n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function _emp3Strip_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function _readLLPivotRecords(startDate, endDate, master) {
  var out = [];
  if (!LL_OT_FILE_ID) return out;
  try {
    var ss = SpreadsheetApp.openById(LL_OT_FILE_ID);
    var sheets = ss.getSheets(), sh = null;
    for (var i = 0; i < sheets.length; i++) {
      var nm = sheets[i].getName();
      if (nm.indexOf('PA') === 0 || nm.indexOf('ห้ามแก้') >= 0) { sh = sheets[i]; break; }
    }
    if (!sh) {                                              // fallback: หา sheet ที่มี header
      for (var j = 0; j < sheets.length; j++) {
        var v0 = sheets[j].getDataRange().getValues();
        for (var r0 = 0; r0 < Math.min(6, v0.length); r0++) {
          if (v0[r0].indexOf('รหัสพนักงาน') >= 0) { sh = sheets[j]; break; }
        }
        if (sh) break;
      }
    }
    if (!sh) return out;

    var v = sh.getDataRange().getValues();
    var hr = -1, codeCol = -1, nameCol = -1;
    for (var r = 0; r < Math.min(8, v.length); r++) {
      var idx = v[r].indexOf('รหัสพนักงาน');
      if (idx >= 0) { hr = r; codeCol = idx; var ni = v[r].indexOf('ชื่อ - สกุล'); nameCol = ni >= 0 ? ni : codeCol + 1; break; }
    }
    if (hr < 0) return out;

    var dayCols = [];                                       // {hrsCol, date} — Hrs อยู่คอลัมน์ถัดจากวันที่
    for (var c = 0; c < v[hr].length; c++) {
      var mm = String(v[hr][c] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})-\d/);
      if (mm) dayCols.push({ hrsCol: c + 1, date: new Date(+mm[3], +mm[2] - 1, +mm[1]) });
    }
    var start = _emp3Strip_(startDate), end = _emp3Strip_(endDate);
    for (var rr = hr + 1; rr < v.length; rr++) {
      var code = String(v[rr][codeCol] == null ? '' : v[rr][codeCol]).split('.')[0].trim();
      if (!/^\d{6,8}$/.test(code)) continue;
      var name = String(v[rr][nameCol] || '').trim();
      var me = (master && master.byId) ? master.byId[code] : null;
      var team = (me && me.teamCode) ? me.teamCode : 'LOST_AND_FOUND';
      for (var k = 0; k < dayCols.length; k++) {
        var d = dayCols[k].date;
        if (d < start || d > end) continue;
        var hrs = _llHrs_(v[rr][dayCols[k].hrsCol]);
        if (hrs > 0) out.push({ date: d, empId: code, empName: name, team: team, otHrs: hrs });
      }
    }
  } catch (e) { Logger.log('LL pivot read failed: ' + e.message); }
  return out;
}

// ════════════════════════════════════════════════════════════════
// PRECOMPUTE หลายเดือน + TRIGGER รายคืน
// ════════════════════════════════════════════════════════════════
// เดือนแรกที่มีข้อมูล roster (ปรับได้)
var EMP3_DATA_START = '2025-10';

/** รายการเดือนทั้งหมดที่ควรมี (EMP3_DATA_START → เดือนปัจจุบัน) ใหม่→เก่า */
function _emp3AllMonths_() {
  var sm = EMP3_DATA_START.match(/^(\d{4})-(\d{1,2})$/);
  var s = new Date(+sm[1], +sm[2] - 1, 1), t = new Date();
  var cur = new Date(t.getFullYear(), t.getMonth(), 1), out = [];
  var d = new Date(cur);
  while (d >= s) {
    out.push(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2));
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }
  return out; // newest first
}

/** เดือนที่ยังไม่มีไฟล์ผลใน Drive (ยังไม่ precompute) */
function _emp3MissingMonths_() {
  return _emp3AllMonths_().filter(function (mk) { return !_emp3DriveFind_(_emp3CacheName_(mk)); });
}

/**
 * Backfill — precompute "เดือนที่ยังไม่ได้ทำ" ทีละ 1 เดือน (รันซ้ำได้เรื่อย ๆ ผ่านปุ่ม Run)
 * รันจนกว่า log จะขึ้น "ครบทุกเดือนแล้ว"
 */
function precacheNextMissing3() {
  var miss = _emp3MissingMonths_();
  if (!miss.length) { Logger.log('✓ precompute ครบทุกเดือนแล้ว (' + _emp3AllMonths_().join(', ') + ')'); return { done: true }; }
  var mk = miss[0]; // ใหม่สุดที่ยังขาด
  precacheMonth3(mk);
  Logger.log('เหลืออีก ' + (miss.length - 1) + ' เดือน: ' + miss.slice(1).join(', '));
  return { month: mk, remaining: miss.length - 1 };
}

/** trigger รายคืน: refresh เดือนปัจจุบัน + เติมเดือนเก่าที่ยังขาด 1 เดือน (อยู่ในลิมิต 30 นาที) */
function nightlyPrecache3() {
  var t = new Date();
  var cur = t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2);
  try { precacheMonth3(cur); } catch (e) { Logger.log('nightly cur ' + cur + ': ' + e.message); }
  // เติมเดือนเก่าที่ยังขาด 1 เดือน/คืน
  var miss = _emp3MissingMonths_().filter(function (mk) { return mk !== cur; });
  if (miss.length) {
    try { precacheMonth3(miss[0]); } catch (e) { Logger.log('nightly backfill ' + miss[0] + ': ' + e.message); }
  }
}

/** ติดตั้ง trigger รันทุกคืน ~02:00 (ลบของเดิมก่อนกันซ้ำ) */
function installNightlyTrigger3() {
  removeNightlyTrigger3();
  ScriptApp.newTrigger('nightlyPrecache3').timeBased().everyDays(1).atHour(2).create();
  Logger.log('ติดตั้ง trigger nightlyPrecache3 ทุกวัน ~02:00 แล้ว');
}
function removeNightlyTrigger3() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'nightlyPrecache3') ScriptApp.deleteTrigger(tr);
  });
}

/** ติดตั้ง trigger รายชั่วโมง: เติมเดือนที่ขาดชั่วโมงละ 1 เดือน แล้วลบตัวเองเมื่อครบ (backfill อัตโนมัติ) */
function installHourlyBackfillTrigger3() {
  removeHourlyBackfillTrigger3();
  ScriptApp.newTrigger('hourlyBackfill3').timeBased().everyHours(1).create();
  Logger.log('ติดตั้ง hourlyBackfill3 — เติมเดือนที่ขาดชั่วโมงละ 1 เดือน จนครบแล้วลบตัวเอง');
}
function removeHourlyBackfillTrigger3() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'hourlyBackfill3') ScriptApp.deleteTrigger(tr);
  });
}
function hourlyBackfill3() {
  var miss = _emp3MissingMonths_();
  if (!miss.length) { removeHourlyBackfillTrigger3(); Logger.log('backfill ครบทุกเดือนแล้ว — ลบ trigger'); return; }
  precacheMonth3(miss[0]);
  if (_emp3MissingMonths_().length === 0) removeHourlyBackfillTrigger3();
}

// ════════════════════════════════════════════════════════════════
// PRECOMPUTE แบบ resumable (อ่านทีละสัปดาห์) — กัน "เกินเวลาประมวลผล"
// แต่ละครั้งอ่าน ~7 วัน (~4 นาที) สะสมผลในไฟล์ progress จนครบเดือนแล้ว finalize
// ════════════════════════════════════════════════════════════════
function _emp3JsonRead_(name) {
  var f = _emp3DriveFind_(name); if (!f) return null;
  try { return JSON.parse(f.getBlob().getDataAsString()); } catch (e) { return null; }
}
function _emp3JsonSave_(name, obj) {
  var s = JSON.stringify(obj), f = _emp3DriveFind_(name);
  if (f) f.setContent(s); else DriveApp.createFile(name, s, 'application/json');
}
/** สะสม 1 record ลง acc (flat map: mk|dept|empId → {weeks,total,...}) */
function _emp3AccRecord_(acc, monthOrder, r, master) {
  var hrs = +r.otHrs || 0; if (hrs <= 0 || !r.date) return;
  var d = (r.date instanceof Date) ? r.date : new Date(r.date); if (isNaN(d)) return;
  var teamCode = resolveTeamCode_(r, master);
  var dept = dept3ForTeam_(teamCode);
  var mk = EMP3_MON_ABBR[d.getMonth()] + ' ' + d.getFullYear();
  monthOrder[mk] = d.getFullYear() * 100 + d.getMonth();
  var wi = emp3WeekIndex_(d.getDate());
  var empId = r.empId || r.empName || '?';
  var key = mk + '|' + dept + '|' + empId;
  var e = acc[key];
  if (!e) e = acc[key] = { mk: mk, dept: dept, code: r.empId || '', name: r.empName || '', team: teamDisplayName_(teamCode), weeks: [0,0,0,0], total: 0 };
  e.weeks[wi] += hrs; e.total += hrs;
}
/** สร้าง report object จาก acc (เหมือน output ของ getEmployeeReport3) */
function _emp3BuildReportFromAcc_(acc, monthOrder) {
  var report = {};
  Object.keys(acc).forEach(function (key) {
    var e = acc[key];
    if (!report[e.mk]) report[e.mk] = {};
    if (!report[e.mk][e.dept]) report[e.mk][e.dept] = { total_hrs: 0, headcount: 0, teams: {}, employees: [] };
    var b = report[e.mk][e.dept];
    b.employees.push({ code: e.code, name: e.name, team: e.team,
      weeks: e.weeks.map(function (x) { return Math.round(x * 10) / 10; }),
      total_hrs: Math.round(e.total * 10) / 10 });
    b.headcount += 1; b.total_hrs += e.total;
    if (!b.teams[e.team]) b.teams[e.team] = { total_hrs: 0, headcount: 0 };
    b.teams[e.team].total_hrs += e.total; b.teams[e.team].headcount += 1;
  });
  Object.keys(report).forEach(function (mk) {
    DEPT3_DEFS.forEach(function (dd) {
      var b = report[mk][dd.code]; if (!b) return;
      b.employees.sort(function (a, z) { return z.total_hrs - a.total_hrs; });
      b.total_hrs = Math.round(b.total_hrs * 10) / 10;
      Object.keys(b.teams).forEach(function (t) { b.teams[t].total_hrs = Math.round(b.teams[t].total_hrs * 10) / 10; });
    });
  });
  var months = Object.keys(monthOrder).sort(function (a, b) { return monthOrder[a] - monthOrder[b]; });
  return { months: months, depts: DEPT3_DEFS, report: report, meta: { records: 0 } };
}
function _emp3Finalize_(mm, prog, progName) {
  var data = _emp3BuildReportFromAcc_(prog.acc, prog.monthOrder);
  _emp3DriveSave_(mm.key, data);
  try { CacheService.getScriptCache().put('EMP3_' + mm.key, JSON.stringify(data).slice(0, 99000), 21600); } catch (e) {}
  var f = _emp3DriveFind_(progName); if (f) f.setTrashed(true);
  var first = data.months[0], r = first ? data.report[first] : {};
  Logger.log('✓ FINAL ' + mm.key + ': KP ' + (((r.KP||{}).headcount)||0) + ' | LP ' + (((r.LP||{}).headcount)||0) + ' | LL ' + (((r.LL||{}).headcount)||0));
  return { month: mm.key, done: true };
}
/** precompute เดือนแบบ resumable — เรียกซ้ำได้ แต่ละครั้งทำ 1 สัปดาห์ (~4 นาที) */
function precacheMonthChunked(monthStr) {
  var mm = _emp3Month_(monthStr);
  var y = mm.start.getFullYear(), mo = mm.start.getMonth(), lastDay = mm.end.getDate();
  var chunks = [[1, 7], [8, 14], [15, 21], [22, lastDay]];
  var progName = '_EMP3_prog_' + mm.key + '.json';
  var prog = _emp3JsonRead_(progName) || { next: 0, acc: {}, monthOrder: {} };
  if (prog.next >= chunks.length) return _emp3Finalize_(mm, prog, progName);
  var c = chunks[prog.next];
  var cs = new Date(y, mo, c[0]), ce = new Date(y, mo, c[1]);
  var master = getMasterEmployees();
  var att = readAttendance(cs, ce) || [];
  var ll = _readLLPivotRecords(cs, ce, master) || [];
  var all = att.concat(ll);
  for (var i = 0; i < all.length; i++) _emp3AccRecord_(prog.acc, prog.monthOrder, all[i], master);
  prog.next++;
  Logger.log('precacheMonthChunked ' + mm.key + ': chunk ' + prog.next + '/' + chunks.length + ' (วันที่ ' + c[0] + '-' + c[1] + ', +' + all.length + ' rec)');
  if (prog.next >= chunks.length) return _emp3Finalize_(mm, prog, progName);
  _emp3JsonSave_(progName, prog);
  return { month: mm.key, chunk: prog.next, total: chunks.length, done: false };
}
/** ตัวขับ resumable แบบไม่ต้องใส่ argument — ทำเดือนที่ค้าง/ขาดทีละ 1 สัปดาห์ต่อการรัน */
function chunkedTick3() {
  var months = _emp3AllMonths_();           // ใหม่→เก่า
  for (var i = 0; i < months.length; i++) {  // เดือนที่กำลังทำค้างอยู่ก่อน
    if (_emp3DriveFind_('_EMP3_prog_' + months[i] + '.json')) return precacheMonthChunked(months[i]);
  }
  var miss = _emp3MissingMonths_();
  if (!miss.length) { removeChunkedTrigger3(); Logger.log('✓ chunked backfill ครบทุกเดือนแล้ว'); return { allDone: true }; }
  return precacheMonthChunked(miss[0]);
}
/** trigger ทุก 10 นาที: ทำ 1 สัปดาห์/รอบ จนครบทุกเดือนแล้วลบตัวเอง */
function installChunkedBackfillTrigger3() {
  removeChunkedTrigger3();
  ScriptApp.newTrigger('chunkedTick3').timeBased().everyMinutes(10).create();
  Logger.log('ติดตั้ง chunkedTick3 ทุก 10 นาที — backfill ทีละสัปดาห์จนครบแล้วลบตัวเอง');
}
function removeChunkedTrigger3() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'chunkedTick3') ScriptApp.deleteTrigger(tr);
  });
}

/** ล้าง cache + progress ของทุกเดือน (ไฟล์เก่า/ไม่สมบูรณ์) → ให้ chunkedTick3/trigger สร้างใหม่ทั้งหมด */
function clearAllEmployee3Cache() {
  var months = _emp3AllMonths_(), n = 0;
  months.forEach(function (mk) {
    [_emp3CacheName_(mk), '_EMP3_prog_' + mk + '.json'].forEach(function (nm) {
      var f = _emp3DriveFind_(nm);
      if (f) { f.setTrashed(true); n++; }
    });
  });
  try { CacheService.getScriptCache().removeAll(months.map(function (m) { return 'EMP3_' + m; })); } catch (e) {}
  Logger.log('ล้าง cache/progress ' + n + ' ไฟล์ — รัน chunkedTick3 หรือรอ trigger เพื่อสร้างใหม่ให้ครบ');
  return { cleared: n };
}
