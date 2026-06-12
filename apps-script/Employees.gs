/**
 * Employees.gs — รายงาน OT ระดับรายชื่อพนักงาน แยก 3 แผนก KP / LP / LL
 * ------------------------------------------------------------------
 * เป้าหมาย: ทำรายงานรายละเอียดคล้ายไฟล์ "OT Dashboard - AOTGA" (รายชื่อ + ชั่วโมง)
 *           แต่จัดกลุ่มเป็น 3 แผนกตามที่กำหนด และแยกเป็น "รายสัปดาห์" + "รายเดือน"
 *
 *   KP = การโดยสาร (ทุกทีมสายการบิน + PG + SV + CHINA + Charter + ZF/EO/HH/LO/G2
 *                    + ADMIN DOC + OFFICE + Porter Crewsign)
 *   LP = PORTER / PVT / PRIVATE / VIP
 *   LL = ติดตามสัมภาระ (lOST AND fOUND / PORTER LL / ADMIN LL)
 *
 * แหล่งข้อมูล 2 ไฟล์ (join ด้วย "รหัสพนักงาน"):
 *   1) OT Yearly                — ชั่วโมง OT รายคน รายวัน (pivot: คอลัมน์ = DD/MM/YYYY-กะ/Hrs)
 *   2) Pax Manpower Issue 02    — รหัสพนักงาน → ทีม → แผนก/ตำแหน่ง/สถานะ  (ชีต "Total")
 *
 * วิธีใช้:
 *   - วางไฟล์นี้ในโปรเจกต์ Apps Script เดียวกับ Code.gs / Index.html
 *   - แชร์ทั้ง 2 ไฟล์ให้ executor account (hktadminpsa@aotga.com)
 *   - เปิดรายงานที่  <webapp-url>?view=employees   (ดู doGet ใน Code.gs ที่แก้เพิ่ม)
 *   - เรียกจาก client:  google.script.run.withSuccessHandler(cb).getEmployeeReport()
 *
 * หมายเหตุ: ผู้เขียนไม่สามารถรัน Apps Script แทนได้ — ฟังก์ชัน inspectEmployeeSources()
 *           มีไว้ตรวจโครงสร้างชีตจริงก่อน ถ้าโครงสร้างต่างจากที่ parser คาดไว้ ให้ปรับ
 *           ค่าใน EMP_CFG ด้านล่าง
 */

// ============================ Config ============================
const MAPPING_FILE_ID = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8'; // Pax Manpower Issue 02
// OT_YEARLY_FILE_ID มาจาก Code.gs อยู่แล้ว (1zESOKHDpNqbkXxd3YV0EqVHv6JDeyPjKKpjwJsOMVQ0)

const EMP_CFG = {
  mappingSheet: 'Total',     // ชีตทะเบียนพนักงานหลัก (มีคอลัมน์ รหัสพนักงาน + ทีม)
  statusSheet:  'Lists',     // ชีตสถานะ (รหัสพนักงาน, ..., สถานะ Active/Resigned)
  activeOnly:   false,       // true = แสดงเฉพาะ Active (เหมือนรายงาน PDF)
  cacheTtlSec:  600,
};

// ป้ายชื่อ + สีของ 3 แผนก (ใช้ฝั่ง HTML)
const DEPT_DEFS = [
  { code: 'KP', name: 'KP — การโดยสาร',        color: '#2563eb' },
  { code: 'LP', name: 'LP — Porter / PVT',     color: '#a855f7' },
  { code: 'LL', name: 'LL — ติดตามสัมภาระ',     color: '#0d9488' },
];

// ============================ Classification ============================
/**
 * จัดทีม + แผนกองค์กร → 1 ใน 3 แผนก KP/LP/LL
 * อิงข้อมูลจริงจากไฟล์ Pax Manpower Issue 02 (ชีต Total)
 */
function classifyDept_(team, orgDept) {
  const t = String(team || '').toUpperCase().trim();
  const d = String(orgDept || '');
  // ติดตามสัมภาระ = Lost & Found = LL  (รวม PORTER LL / ADMIN LL)
  if (d.indexOf('ติดตามสัมภาระ') >= 0 || t.indexOf('LOST') >= 0 || t.indexOf('FOUND') >= 0 || /\bLL\b/.test(t)) {
    return 'LL';
  }
  // Porter หลัก / งานบริการผู้โดยสารพิเศษ = LP
  if (t === 'PORTER' || t.indexOf('PVT') >= 0 || t.indexOf('PRIVATE') >= 0 || t.indexOf('VIP') >= 0) {
    return 'LP';
  }
  // ที่เหลือ = การโดยสาร = KP
  return 'KP';
}

/** ทำให้ชื่อทีมสั้นลงเพื่อแสดงผล (sub-team ภายในแผนก) */
function teamLabel_(team) {
  const t = String(team || '').trim();
  if (!t) return '(ไม่ระบุทีม)';
  return t;
}

// ============================ Helpers ============================
function empWeekIndex_(day) {       // 1–7, 8–14, 15–21, 22+ → 0..3 (ตรงกับ dashboard เดิม)
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}
const EMP_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** แปลงค่า cell ชั่วโมงเป็น "นาที" (รองรับ number / Date / "HH:MM") — เหมือน hmsToMin_ ใน Code.gs */
function empToMin_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 24 * 60);
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  const s = String(v).trim();
  if (!s || s === '-') return 0;
  const m = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 60);
}

/** แปลง header คอลัมน์ของ OT Yearly → {date: Date, kind: 'Code'|'Hrs'} หรือ null */
function parseDayHeader_(h) {
  const s = String(h || '');
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})-\d+\/(Code|Hrs)\s*$/);
  if (!m) return null;
  return {
    date: new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)),
    kind: m[4],
  };
}

// ============================ Mapping reader ============================
/**
 * อ่านทะเบียนพนักงานจากไฟล์ Pax Manpower Issue 02 (ชีต Total)
 * คืน: { '2406023': {team, name, orgDept, position, status, dept:'KP'|'LP'|'LL'} , ... }
 */
function getTeamMap_() {
  const out = {};
  const ss = SpreadsheetApp.openById(MAPPING_FILE_ID);

  // -- สถานะ Active/Resigned จากชีต Lists --
  const status = {};
  const ls = ss.getSheetByName(EMP_CFG.statusSheet);
  if (ls) {
    const lv = ls.getDataRange().getValues();
    for (let r = 1; r < lv.length; r++) {
      const code = String(lv[r][0] || '').split('.')[0].trim();
      if (/^\d{6,7}$/.test(code)) status[code] = String(lv[r][4] || '').trim();
    }
  }

  // -- ทะเบียนหลักจากชีต Total --
  const ts = ss.getSheetByName(EMP_CFG.mappingSheet);
  if (!ts) return { _error: 'ไม่พบชีต "' + EMP_CFG.mappingSheet + '" ในไฟล์ mapping' };
  const v = ts.getDataRange().getValues();

  // หา index คอลัมน์ "รหัสพนักงาน" และ "ทีม" จากแถว header (สแกน 5 แถวแรก)
  let codeCol = -1, teamCol = -1, hdrRow = -1;
  for (let r = 0; r < Math.min(5, v.length); r++) {
    for (let c = 0; c < v[r].length; c++) {
      const cell = String(v[r][c] || '').trim();
      if (cell === 'รหัสพนักงาน') codeCol = c;
      if (cell === 'ทีม') teamCol = c;
    }
    if (codeCol >= 0 && teamCol >= 0) { hdrRow = r; break; }
  }
  if (codeCol < 0 || teamCol < 0) return { _error: 'หา column รหัสพนักงาน/ทีม ในชีต Total ไม่เจอ' };

  // คอลัมน์ที่เหลือ (relative กับ codeCol แบบในไฟล์จริง: code, team, คำนำหน้า, ชื่อ, สกุล, แผนก, ตำแหน่ง)
  const nameCol1 = codeCol + 3, nameCol2 = codeCol + 4, orgDeptCol = codeCol + 5, posCol = codeCol + 6;

  for (let r = hdrRow + 1; r < v.length; r++) {
    const code = String(v[r][codeCol] || '').split('.')[0].trim();
    if (!/^\d{7}$/.test(code)) continue;
    const team = String(v[r][teamCol] || '').replace(/\s+/g, ' ').trim();
    const name = [v[r][nameCol1], v[r][nameCol2]].map(x => String(x || '').trim()).filter(Boolean).join(' ');
    const orgDept = String(v[r][orgDeptCol] || '').trim();
    const position = String(v[r][posCol] || '').trim();
    out[code] = {
      team: team,
      name: name,
      orgDept: orgDept,
      position: position,
      status: status[code] || '',
      dept: classifyDept_(team, orgDept),
    };
  }
  return out;
}

// ============================ OT Yearly reader ============================
/**
 * หา + อ่านชีตรายคนรายวันใน OT Yearly แล้วรวมชั่วโมงเป็น "นาที" ต่อ (เดือน, สัปดาห์)
 * คืน: { '2406023': { name, days: { 'YYYY-MM': [w0,w1,w2,w3] (นาที) } }, ... }
 */
function getEmployeeOT_() {
  const ss = SpreadsheetApp.openById(OT_YEARLY_FILE_ID);
  const sheets = ss.getSheets();

  // หา "ชีตรายคน": header มี รหัสพนักงาน + ชื่อ - สกุล + มีคอลัมน์ลักษณะ DD/MM/YYYY-x/Hrs
  let target = null, headerRowIdx = -1, codeCol = -1, dayCols = null;
  for (const sh of sheets) {
    const v = sh.getDataRange().getValues();
    for (let r = 0; r < Math.min(8, v.length); r++) {
      const row = v[r].map(x => String(x || ''));
      const cCol = row.findIndex(x => x.trim() === 'รหัสพนักงาน');
      const hasName = row.some(x => x.indexOf('ชื่อ - สกุล') >= 0 || x.indexOf('ชื่อ-สกุล') >= 0);
      if (cCol < 0 || !hasName) continue;
      // ตรวจว่ามีคอลัมน์ Hrs รายวันไหม
      const dc = [];
      for (let c = 0; c < row.length; c++) {
        const ph = parseDayHeader_(row[c]);
        if (ph && ph.kind === 'Hrs') dc.push({ col: c, date: ph.date });
      }
      if (dc.length > 0) {
        target = { sheet: sh, values: v }; headerRowIdx = r; codeCol = cCol; dayCols = dc;
        break;
      }
    }
    if (target) break;
  }
  if (!target) return { _error: 'ไม่พบชีตรายคนรายวันใน OT Yearly (header รหัสพนักงาน + DD/MM/YYYY/Hrs)' };

  const v = target.values;
  const nameCol = (function () {
    const hdr = v[headerRowIdx].map(x => String(x || ''));
    let i = hdr.findIndex(x => x.indexOf('ชื่อ - สกุล') >= 0 || x.indexOf('ชื่อ-สกุล') >= 0);
    return i >= 0 ? i : codeCol + 1;
  })();

  const result = {};
  for (let r = headerRowIdx + 1; r < v.length; r++) {
    const code = String(v[r][codeCol] || '').split('.')[0].trim();
    if (!/^\d{7}$/.test(code)) continue;
    const name = String(v[r][nameCol] || '').trim();
    const rec = result[code] || { name: name, months: {} };
    for (const dcol of dayCols) {
      const mins = empToMin_(v[r][dcol.col]);
      if (!mins) continue;
      const d = dcol.date;
      const mk = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      if (!rec.months[mk]) rec.months[mk] = [0, 0, 0, 0];
      rec.months[mk][empWeekIndex_(d.getDate())] += mins;
    }
    result[code] = rec;
  }
  return { _data: result, _sheetName: target.sheet.getName(), _days: dayCols.length };
}

// ============================ Combine → Report ============================
/**
 * รายงานหลัก — เรียกจาก client
 * คืนโครงสร้าง:
 * {
 *   months: ['Oct 2025', ... 'May 2026'],
 *   depts:  [{code,name,color}, ...],
 *   report: {
 *     'May 2026': {
 *        KP: { total_min, headcount, teams: { 'EK/UO/..': {total_min, headcount} },
 *              employees: [ {code,name,team,weeks:[m,m,m,m],total_min}, ... ] },
 *        LP: {...}, LL: {...}
 *     }, ...
 *   }
 * }
 */
function getEmployeeReport() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('EMP_REPORT_V1');
  if (cached) { try { const o = JSON.parse(cached); o.cached = true; return o; } catch (e) {} }

  const map = getTeamMap_();
  if (map._error) return { _error: 'mapping: ' + map._error };
  const otRes = getEmployeeOT_();
  if (otRes._error) return { _error: 'OT: ' + otRes._error };
  const ot = otRes._data;

  // รวมรายเดือน → แผนก → ทีม → พนักงาน
  const report = {};
  const monthSet = {};

  Object.keys(ot).forEach(code => {
    const emp = ot[code];
    const info = map[code] || { team: '', name: emp.name, orgDept: '', dept: 'KP', status: '' };
    if (EMP_CFG.activeOnly && info.status && info.status.toLowerCase() !== 'active') return;
    const dept = info.dept;

    Object.keys(emp.months).forEach(mkIso => {           // mkIso = 'YYYY-MM'
      const weeks = emp.months[mkIso];
      const totalMin = weeks.reduce((a, b) => a + b, 0);
      if (totalMin <= 0) return;
      const yr = mkIso.slice(0, 4), mo = parseInt(mkIso.slice(5, 7), 10) - 1;
      const mk = EMP_MONTH_ABBR[mo] + ' ' + yr;          // 'May 2026'
      monthSet[mk] = (yr * 100 + mo);

      if (!report[mk]) report[mk] = {};
      DEPT_DEFS.forEach(d => { if (!report[mk][d.code]) report[mk][d.code] = { total_min: 0, headcount: 0, teams: {}, employees: [] }; });

      const bucket = report[mk][dept];
      const tl = teamLabel_(info.team);
      if (!bucket.teams[tl]) bucket.teams[tl] = { total_min: 0, headcount: 0 };
      bucket.teams[tl].total_min += totalMin;
      bucket.teams[tl].headcount += 1;
      bucket.total_min += totalMin;
      bucket.headcount += 1;
      bucket.employees.push({
        code: code, name: emp.name || info.name, team: tl,
        position: info.position || '', status: info.status || '',
        weeks: weeks.slice(), total_min: totalMin,
      });
    });
  });

  // เรียงพนักงานจากมาก→น้อยในแต่ละแผนก + ใส่ลำดับ
  Object.keys(report).forEach(mk => {
    DEPT_DEFS.forEach(d => {
      const b = report[mk][d.code];
      if (!b) return;
      b.employees.sort((a, z) => z.total_min - a.total_min);
      b.employees.forEach((e, i) => e.rank = i + 1);
    });
  });

  const months = Object.keys(monthSet).sort((a, b) => monthSet[a] - monthSet[b]);
  const out = {
    months: months,
    depts: DEPT_DEFS,
    report: report,
    meta: { sheet: otRes._sheetName, days: otRes._days, mappingCount: Object.keys(map).length, activeOnly: EMP_CFG.activeOnly },
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  try { cache.put('EMP_REPORT_V1', JSON.stringify(out), EMP_CFG.cacheTtlSec); } catch (e) {}
  return out;
}

function clearEmployeeCache() { CacheService.getScriptCache().remove('EMP_REPORT_V1'); return { ok: true }; }

// ============================ Diagnostics ============================
/** รันใน Editor เพื่อตรวจว่า parser เจอชีต/คอลัมน์ถูกไหม ก่อน deploy */
function inspectEmployeeSources() {
  const map = getTeamMap_();
  if (map._error) { console.log('MAP ERROR:', map._error); }
  else {
    const codes = Object.keys(map);
    const byDept = { KP: 0, LP: 0, LL: 0 };
    codes.forEach(c => byDept[map[c].dept]++);
    console.log('Mapping: ' + codes.length + ' คน → KP=' + byDept.KP + ' LP=' + byDept.LP + ' LL=' + byDept.LL);
    console.log('ตัวอย่าง:', JSON.stringify(map[codes[0]]));
  }
  const ot = getEmployeeOT_();
  if (ot._error) { console.log('OT ERROR:', ot._error); }
  else {
    console.log('OT sheet: "' + ot._sheetName + '" — ' + ot._days + ' วัน/คอลัมน์ Hrs, พนักงาน ' + Object.keys(ot._data).length + ' คน');
  }
  const rep = getEmployeeReport();
  if (rep._error) { console.log('REPORT ERROR:', rep._error); return; }
  console.log('Report months: ' + rep.months.join(', '));
  rep.months.forEach(mk => {
    const r = rep.report[mk];
    console.log('  ' + mk + ' → KP ' + (r.KP ? r.KP.headcount : 0) + 'คน/' + Math.round((r.KP ? r.KP.total_min : 0) / 60) + 'ชม.'
      + ' | LP ' + (r.LP ? r.LP.headcount : 0) + 'คน/' + Math.round((r.LP ? r.LP.total_min : 0) / 60) + 'ชม.'
      + ' | LL ' + (r.LL ? r.LL.headcount : 0) + 'คน/' + Math.round((r.LL ? r.LL.total_min : 0) / 60) + 'ชม.');
  });
}
