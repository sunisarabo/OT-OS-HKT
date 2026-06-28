/**
 * DataReader.gs
 * อ่านข้อมูลจาก Google Sheets (Attendance / Flight / Summary)
 */

// ─── Attendance ─────────────────────────────────────────────────
/**
 * อ่านข้อมูล attendance — ลอง 2 sources ตามลำดับ:
 *   1. Roster files (PSA daily + LL monthly) — Phase 2
 *   2. Attendance tab pattern (Attendance-yyyy-MM) — Phase 1 fallback
 */
function readAttendance(startDate, endDate) {
  // Phase 2: ลอง roster ก่อน
  try {
    const rosterRecords = readRosterAttendance(startDate, endDate);
    if (rosterRecords && rosterRecords.length > 0) {
      Logger.log('readAttendance: ใช้ roster source (' + rosterRecords.length + ' records)');
      // Forward stats (already attached on array)
      return rosterRecords;
    }
  } catch (e) {
    Logger.log('readAttendance: roster failed → fallback to tab: ' + e.message);
  }

  // Phase 1 fallback: Attendance tab
  return _readAttendanceFromTab(startDate, endDate);
}

/**
 * Fallback: อ่านจาก Attendance-{yyyy-MM} tab (Phase 1)
 */
function _readAttendanceFromTab(startDate, endDate) {
  const cfg = getRuntimeConfig();
  const ss = SpreadsheetApp.openById(cfg.ATTENDANCE_SHEET_ID);
  const start = stripTime(startDate);
  const end   = stripTime(endDate);

  // หา list ของเดือนที่ครอบคลุม
  const months = _monthRange(start, end);

  const rows = [];
  const tabsTried = [];
  months.forEach(function(monthDate) {
    const sh = _resolveAttendanceSheet(ss, monthDate, cfg, tabsTried);
    if (!sh) return; // ข้าม - log แล้ว

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    const data = sh.getRange(2, 1, lastRow - 1, 7).getValues();
    const C = cfg.ATTENDANCE_COLS;

    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const date = toDate(r[C.DATE]);
      if (!date) continue;
      const d = stripTime(date);
      if (d < start || d > end) continue;

      rows.push({
        date:    d,
        empId:   String(r[C.EMP_ID] || '').trim(),
        empName: String(r[C.EMP_NAME] || '').trim(),
        team:    normalizeTeamCode(String(r[C.TEAM] || '').trim()),
        shift:   String(r[C.SHIFT] || '').trim().toUpperCase(),
        timeIn:  toTime(r[C.TIME_IN], date),
        timeOut: toTime(r[C.TIME_OUT], date)
      });
    }
  });

  // ─ sort by date (สำหรับ Sort ตามวันที่) ─
  rows.sort(function(a, b){ return a.date - b.date; });
  if (rows.length === 0) {
    Logger.log('readAttendance: ไม่พบข้อมูลใน tabs ที่ลอง: ' + tabsTried.join(', '));
  }
  return rows;
}

/**
 * Resolve attendance sheet สำหรับเดือนที่ระบุ:
 *   1. ลอง pattern จาก ATTENDANCE_TAB_NAME
 *   2. fallback มาที่ ATTENDANCE_TAB_FALLBACK
 *   3. หา fuzzy โดย scan tabs ทั้งหมด
 */
function _resolveAttendanceSheet(ss, monthDate, cfg, tabsTried) {
  // (1) pattern-based
  const tabName = _renderTabPattern(cfg.ATTENDANCE_TAB_NAME, monthDate);
  tabsTried.push(tabName);
  let sh = ss.getSheetByName(tabName);
  if (sh) return sh;

  // (2) fallback
  if (cfg.ATTENDANCE_TAB_FALLBACK) {
    tabsTried.push(cfg.ATTENDANCE_TAB_FALLBACK);
    sh = ss.getSheetByName(cfg.ATTENDANCE_TAB_FALLBACK);
    if (sh) return sh;
  }

  // (3) fuzzy: หา tab ที่ขึ้นต้นด้วยส่วนคงที่ของ pattern + มี yyyy-MM
  const ym = formatDate(monthDate, 'yyyy-MM');
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    const name = allSheets[i].getName();
    if (name.indexOf(ym) !== -1 && name.toLowerCase().indexOf('att') !== -1) {
      return allSheets[i];
    }
  }
  return null;
}

/**
 * แทน {yyyy}, {yyyy-MM}, {MM}, {MMM}, {MMMM} ใน tab pattern
 */
function _renderTabPattern(pattern, date) {
  if (!pattern) return '';
  return pattern
    .replace('{yyyy-MM}', formatDate(date, 'yyyy-MM'))
    .replace('{yyyy}',    formatDate(date, 'yyyy'))
    .replace('{MMMM}',    formatDate(date, 'MMMM'))
    .replace('{MMM}',     formatDate(date, 'MMM'))
    .replace('{MM}',      formatDate(date, 'MM'));
}

/**
 * Return array ของวันที่แรกของแต่ละเดือนระหว่าง start..end (inclusive)
 */
function _monthRange(start, end) {
  const out = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

// ─── Flights ────────────────────────────────────────────────────
/**
 * อ่านข้อมูลไฟลท์ และกรองที่ "ยกเลิก" ออก
 * Return: { total, operating, cancelled, byAirline, byType, byTeam }
 */
function readFlights(startDate, endDate) {
  // Phase 2: ลองอ่านจาก PSA daily files ก่อน (มี flight info อยู่แล้ว)
  try {
    const f = readPSAFlights(startDate, endDate);
    if (f && f.total > 0) {
      Logger.log('readFlights: ใช้ PSA daily source (' + f.operating + '/' + f.total + ' flights)');
      return f;
    }
  } catch (e) {
    Logger.log('readFlights: PSA source failed → fallback to tab: ' + e.message);
  }

  // Fallback: dedicated Flight sheet (Phase 1)
  return _readFlightsFromTab(startDate, endDate);
}

function _readFlightsFromTab(startDate, endDate) {
  const cfg = getRuntimeConfig();
  const ss = SpreadsheetApp.openById(cfg.FLIGHT_SHEET_ID);
  const C = cfg.FLIGHT_COLS;
  const cancelKw = cfg.CANCELLED_FLIGHT_KEYWORDS.map(function(k){ return k.toUpperCase(); });
  const start = stripTime(startDate);
  const end   = stripTime(endDate);
  const months = _monthRange(start, end);

  let total = 0, cancelled = 0, operating = 0;
  const byAirline = {};
  const byType    = { DEP: 0, ARR: 0, OTHER: 0 };
  const byTeam    = {};

  months.forEach(function(monthDate) {
    const tabName = _renderTabPattern(cfg.FLIGHT_TAB_NAME, monthDate);
    let sh = ss.getSheetByName(tabName);
    if (!sh && cfg.FLIGHT_TAB_FALLBACK) sh = ss.getSheetByName(cfg.FLIGHT_TAB_FALLBACK);
    if (!sh) {
      // fuzzy
      const ym = formatDate(monthDate, 'yyyy-MM');
      const all = ss.getSheets();
      for (let i = 0; i < all.length; i++) {
        const nm = all[i].getName();
        if (nm.indexOf(ym) !== -1 && nm.toLowerCase().indexOf('flight') !== -1) {
          sh = all[i]; break;
        }
      }
    }
    if (!sh) { Logger.log('readFlights: ไม่พบ tab สำหรับ ' + formatDate(monthDate, 'yyyy-MM')); return; }

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    const lastCol = Math.max(sh.getLastColumn(), 6);
    const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const date = toDate(r[C.DATE]);
      if (!date) continue;
      const d = stripTime(date);
      if (d < start || d > end) continue;

      total++;
      const status = String(r[C.STATUS] || '').trim().toUpperCase();
      const isCancelled = cancelKw.some(function(k){ return status.indexOf(k) !== -1; });
      if (isCancelled) { cancelled++; continue; }
      operating++;

      const airline = String(r[C.AIRLINE] || '').trim() || 'UNKNOWN';
      byAirline[airline] = (byAirline[airline] || 0) + 1;

      const type = String(r[C.TYPE] || '').trim().toUpperCase();
      if (type === 'DEP' || type === 'D') byType.DEP++;
      else if (type === 'ARR' || type === 'A') byType.ARR++;
      else byType.OTHER++;

      const team = normalizeTeamCode(String(r[C.TEAM] || '').trim());
      if (team) byTeam[team] = (byTeam[team] || 0) + 1;
    }
  });

  return { total: total, operating: operating, cancelled: cancelled,
           byAirline: byAirline, byType: byType, byTeam: byTeam };
}

function _emptyFlights() {
  return { total: 0, operating: 0, cancelled: 0,
           byAirline: {}, byType: { DEP: 0, ARR: 0, OTHER: 0 }, byTeam: {} };
}

// ─── Summary (Employee count per team) ──────────────────────────
/**
 * อ่านชีต Summary เพื่อดึงจำนวนพนักงานต่อทีม
 * Return: { TEAM_CODE: headcount, ... }
 */
function readSummary() {
  const cfg = getRuntimeConfig();
  let ss;
  try {
    ss = SpreadsheetApp.openById(cfg.SUMMARY_SHEET_ID);
  } catch (e) {
    Logger.log('readSummary: cannot open ' + cfg.SUMMARY_SHEET_ID + ' — fallback to CONFIG');
    return _fallbackHeadcount();
  }
  const sh = ss.getSheetByName(cfg.SUMMARY_TAB_NAME);
  if (!sh) {
    Logger.log('readSummary: no tab "' + cfg.SUMMARY_TAB_NAME + '" — fallback');
    return _fallbackHeadcount();
  }

  const data = sh.getDataRange().getValues();
  const result = {};
  // คาดหวัง: col A = ชื่อฝ่าย / col B = ชื่อทีม / col C = จำนวน  (skip header)
  for (let i = 1; i < data.length; i++) {
    const teamName = String(data[i][1] || '').trim();
    const headcount = parseInt(data[i][2], 10);
    if (!teamName || isNaN(headcount)) continue;
    const code = normalizeTeamCode(teamName);
    if (code) result[code] = headcount;
  }

  // เติมทีมที่ไม่เจอจาก fallback
  cfg.TEAMS.forEach(function(t){
    if (!(t.code in result)) result[t.code] = t.headcount;
  });
  return result;
}

function _fallbackHeadcount() {
  const cfg = getRuntimeConfig();
  const result = {};
  cfg.TEAMS.forEach(function(t){ result[t.code] = t.headcount; });
  return result;
}

/**
 * อ่าน Summary แบบเต็ม 3 มิติ — return:
 *   { byPosition:    { 'Passenger Services Agent': 370, ... },
 *     byTeam:        { 'AK_QZ_8M': 21, ... },
 *     byTeamPosition: { 'AK_QZ_8M': { 'Passenger Services Agent': 16, ... }, ... },
 *     positions:     [ 'Passenger Services Agent', ... ]  // ordered
 *     total:         708 }
 *
 * Layout ที่คาดหวัง (ตาม Pax Manpower Issue 02 → Summary):
 *   col A-C: แผนก / ตำแหน่ง / จำนวน  (มิติตำแหน่ง)
 *   col F-I: แผนก / ตำแหน่ง / ทีม / จำนวน  (มิติทีม×ตำแหน่ง)
 *   col L-N: แผนก / ทีม / จำนวน  (มิติทีม)
 */
function readSummaryFull() {
  const cfg = getRuntimeConfig();
  const result = {
    byPosition: {}, byTeam: {}, byTeamPosition: {},
    positions: [], total: 0
  };

  let ss, sh;
  try {
    ss = SpreadsheetApp.openById(cfg.SUMMARY_SHEET_ID);
    sh = ss.getSheetByName(cfg.SUMMARY_TAB_NAME);
  } catch (e) {
    Logger.log('readSummaryFull: ' + e.message + ' — fallback');
    return _fallbackSummaryFull();
  }
  if (!sh) return _fallbackSummaryFull();

  const data = sh.getDataRange().getValues();
  const positionSeen = {};

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    // ─ มิติตำแหน่ง (col A=แผนก, B=ตำแหน่ง, C=จำนวน) ─
    const pos = String(r[1] || '').trim();
    const n   = parseInt(r[2], 10);
    if (pos && !isNaN(n) && pos !== 'ตำแหน่ง') {
      result.byPosition[pos] = (result.byPosition[pos] || 0) + n;
      if (!positionSeen[pos]) { positionSeen[pos] = true; result.positions.push(pos); }
    }

    // ─ มิติทีม×ตำแหน่ง (col F=แผนก, G=ตำแหน่ง, H=ทีม, I=จำนวน) ─
    const posTP  = String(r[6] || '').trim();
    const teamTP = String(r[7] || '').trim();
    const nTP    = parseInt(r[8], 10);
    if (posTP && teamTP && !isNaN(nTP) && teamTP !== 'ทีม') {
      const code = normalizeTeamCode(teamTP);
      if (code) {
        if (!result.byTeamPosition[code]) result.byTeamPosition[code] = {};
        result.byTeamPosition[code][posTP] = (result.byTeamPosition[code][posTP] || 0) + nTP;
      }
    }

    // ─ มิติทีม (col L=แผนก, M=ทีม, N=จำนวน) ─
    const teamT = String(r[12] || '').trim();
    const nT    = parseInt(r[13], 10);
    if (teamT && !isNaN(nT) && teamT !== 'ทีม') {
      const code = normalizeTeamCode(teamT);
      if (code) result.byTeam[code] = (result.byTeam[code] || 0) + nT;
    }
  }

  // total
  result.total = Object.keys(result.byPosition).reduce(function(s, k){ return s + result.byPosition[k]; }, 0);

  // เติมทีมที่ยังไม่มี
  cfg.TEAMS.forEach(function(t){
    if (!(t.code in result.byTeam)) result.byTeam[t.code] = t.headcount;
  });

  return result;
}

function _fallbackSummaryFull() {
  const cfg = getRuntimeConfig();
  const out = { byPosition: {}, byTeam: {}, byTeamPosition: {}, positions: [], total: 0 };
  cfg.TEAMS.forEach(function(t){ out.byTeam[t.code] = t.headcount; out.total += t.headcount; });
  return out;
}

// ════════════════════════════════════════════════════════════════
// MASTER EMPLOYEES LOOKUP — สำหรับ resolve ID/Team จากชื่อ
// ════════════════════════════════════════════════════════════════
let _masterEmpCache = null;

/**
 * อ่านชีต Total ใน Pax Manpower → return lookup table
 * - byFirstName: 'PREECHA' → { empId, team, dept, fullName }
 * - byId:        '2607183' → { empId, team, dept, fullName }
 * Cache ในตัวแปร module (clear ทุก execution)
 */
function getMasterEmployees() {
  if (_masterEmpCache) return _masterEmpCache;
  const cfg = getRuntimeConfig();

  let ss, sh;
  try {
    ss = SpreadsheetApp.openById(cfg.SUMMARY_SHEET_ID);
    sh = ss.getSheetByName('Total');
  } catch (e) {
    Logger.log('getMasterEmployees: ' + e.message);
    return { byFirstName: {}, byId: {}, list: [] };
  }
  if (!sh) return { byFirstName: {}, byId: {}, list: [] };

  const data = sh.getDataRange().getValues();
  // Columns (verified):
  //   1=empId, 2=team, 4=ชื่อไทย, 6=dept, 7=ตำแหน่ง, 10=Name (EN), 13=status
  const byFirstName = {};
  const byId = {};
  const list = [];
  const cancelKw = new Set(['RESIGNED', 'TERMINATED']);

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const idRaw = r[1];
    if (idRaw === null || idRaw === undefined || idRaw === '') continue;
    const empId = String(idRaw).replace(/\.0*$/, '').trim();
    if (!/^\d{6,8}$/.test(empId.replace(/\D/g, ''))) continue;

    const status = String(r[13] || '').trim().toUpperCase();
    if (cancelKw.has(status)) continue;

    const team = String(r[2] || '').trim();
    const dept = String(r[6] || '').trim();
    const nameEN = String(r[10] || '').trim();
    const nameTH = String(r[4] || '').trim();

    // First name extraction
    let firstName = '';
    if (nameEN) {
      const parts = nameEN.replace(/^(MR|MRS|MS|MISS)\.?\s+/i, '').split(/\s+/);
      if (parts[0]) firstName = parts[0].toUpperCase();
    }
    if (!firstName && nameTH) {
      const thParts = nameTH.split(/\s+/);
      firstName = (thParts[1] || thParts[0]).toUpperCase();
    }

    // Determine team code via normalize
    const teamCode = normalizeTeamCode(team);
    const deptCode = dept.indexOf('ติดตามสัมภาระ') !== -1 ? 'LL' : 'PSA';

    const emp = {
      empId: empId,
      team: team,
      teamCode: teamCode,
      dept: deptCode,
      firstName: firstName,
      fullNameEN: nameEN,
      fullNameTH: nameTH
    };
    byId[empId] = emp;
    if (firstName && !byFirstName[firstName]) byFirstName[firstName] = emp;
    list.push(emp);
  }

  _masterEmpCache = { byFirstName: byFirstName, byId: byId, list: list };
  Logger.log('getMasterEmployees: ' + list.length + ' active employees');
  return _masterEmpCache;
}

// ─── Helpers ────────────────────────────────────────────────────
/**
 * แปลงชื่อ/code ทีมเป็น CODE มาตรฐาน
 * เช่น "AK/QZ/8M" → "AK_QZ_8M"
 */
function normalizeTeamCode(raw) {
  if (!raw) return null;
  const cfg = getRuntimeConfig();
  const upper = raw.toUpperCase().trim();
  // ลอง match ตรงกับ name หรือ code
  for (let i = 0; i < cfg.TEAMS.length; i++) {
    const t = cfg.TEAMS[i];
    if (t.code === upper) return t.code;
    if (t.name.toUpperCase() === upper) return t.code;
  }
  // ลอง normalize: replace / and space with _
  const normalized = upper.replace(/[\/\s\-]+/g, '_');
  for (let i = 0; i < cfg.TEAMS.length; i++) {
    if (cfg.TEAMS[i].code === normalized) return cfg.TEAMS[i].code;
  }
  Logger.log('normalizeTeamCode: ไม่รู้จักทีม "' + raw + '"');
  return null;
}

/**
 * แปลง value → Date (รองรับ Date object หรือ string)
 */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s) return null;
  // ลอง parse yyyy-MM-dd หรือ d/M/yyyy
  let d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * ตัด time ออก → Date เที่ยงคืน
 */
function stripTime(d) {
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * แปลง time-string (HH:mm) หรือ Date → Date object ที่มี time
 * baseDate = วันที่อ้างอิง
 */
function toTime(v, baseDate) {
  if (!v) return null;
  if (v instanceof Date) {
    // ถ้าเป็น full date ใช้เลย ถ้าเป็น time-only (เช่น 1899-12-30) merge กับ baseDate
    if (v.getFullYear() < 1950) {
      const base = baseDate || new Date();
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(),
                      v.getHours(), v.getMinutes(), v.getSeconds());
    }
    return v;
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const base = baseDate || new Date();
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(),
                    parseInt(m[1], 10), parseInt(m[2], 10),
                    m[3] ? parseInt(m[3], 10) : 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}