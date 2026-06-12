/**
 * OT Dashboard — Apps Script backend
 *
 * ดึงข้อมูลจาก Google Sheets อัตโนมัติเมื่อ Web App ถูกเปิด:
 *   1) OT LL ย้อนหลัง  — sheets "2025", "2026"
 *   2) OT Yearly       — ชีต 5  (PSA OT — preview mode รอ refine parser)
 *   3) PSA-HKT Flight Feed (API)  — tabs JAN2026..DEC2026 (active flights, excl. Cancelled)
 *
 * รายงานเสริม (ดู Employees.gs + EmployeeReport.html):
 *   - รายงาน OT รายชื่อพนักงาน แยก 3 แผนก KP / LP / LL  →  เปิดที่ <webapp-url>?view=employees
 *
 * Setup:
 *   - Apps Script project: ใส่ Code.gs + Index.html + Employees.gs + EmployeeReport.html
 *   - Share Sheet ทั้งหมดให้ executor account (Me) — รวมไฟล์ "Pax Manpower Issue 02"
 *   - Deploy → Web App → Execute as Me → Anyone with link
 */

// ============= Config =============
const OT_LL_FILE_ID      = '1hUzdm-CPbGrotU_CwG86C5004dCSV_Gguv_cHfLOLDA';
const OT_YEARLY_FILE_ID  = '1zESOKHDpNqbkXxd3YV0EqVHv6JDeyPjKKpjwJsOMVQ0';
const FLIGHT_FEED_FILE_ID= '1Y3ft-vkHQ5Rm2LVmq1Zz_2j8n5T8wLgCJtdBKhqfBAA';
const PSA_SHEET_INDEX    = 4;       // "ชีต 5" = index 4 (0-based) — แก้ถ้าไม่ตรง
const CACHE_TTL_SEC      = 600;     // cache 10 นาที ลด Sheets API calls

// Airline → Team mapping (PSA dashboard team codes)
const TEAM_MAP = {
  EK:'EK', UO:'EK', FY:'EK', '6B':'EK', BY:'EK',
  SQ:'SQ', CX:'SQ', LY:'SQ',
  EY:'EY', AY:'EY', DV:'EY',
  TR:'TR', QP:'TR', '6E':'TR',
  WY:'WY', G9:'WY', '9C':'WY', DK:'WY',
  JQ:'JQ', IT:'JQ', IX:'JQ', AI:'JQ', N0:'JQ',
  TK:'TK', VJ:'TK', SG:'TK', HY:'TK', OD:'TK',
  KC:'KC', LJ:'KC', KE:'KC', OZ:'KC', NO:'KC', AF:'KC',
  QR:'QR', MH:'QR', OM:'QR', DE:'QR',
  AK:'AK', QZ:'AK', '8M':'AK',
  SU:'SU', W5:'SU', B2:'SU',
  '3U':'CHN', '9H':'CHN', AQ:'CHN', CA:'CHN', CZ:'CHN', FM:'CHN',
  HU:'CHN', HO:'CHN', HX:'CHN', MU:'CHN',
  ZF:'CHARTER', EO:'CHARTER', WZ:'CHARTER', N4:'CHARTER', G2:'CHARTER',
  LO:'CHARTER', HH:'CHARTER', H4:'CHARTER', S7:'CHARTER', C6:'CHARTER',
  SV:'SV', WK:'SV', KA:'SV',
  PG:'PG',
  PVT:'PVT', PRIVATE:'PVT'
};
const MONTH_NUM_TO_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_ABBR_UPPER = { JAN:'Jan', FEB:'Feb', MAR:'Mar', APR:'Apr', MAY:'May', JUN:'Jun',
                           JUL:'Jul', AUG:'Aug', SEP:'Sep', OCT:'Oct', NOV:'Nov', DEC:'Dec' };

// ============= doGet =============
function doGet(e) {
  // Route: รายงาน OT รายชื่อพนักงาน KP/LP/LL  →  ?view=employees
  const view = e && e.parameter && e.parameter.view;
  if (view === 'employees') {
    return HtmlService.createHtmlOutputFromFile('EmployeeReport')
      .setTitle('OT รายชื่อพนักงาน — KP / LP / LL')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('OT Dashboard — PSA & LL')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============= Client API =============
/**
 * เรียกจาก HTML: google.script.run.withSuccessHandler(...).getAllData()
 * คืนข้อมูล LL + PSA + Flights ในรูปแบบที่ HTML ใช้ได้ทันที
 */
function getAllData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('OT_ALL_V2');
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      obj.cached = true;
      return obj;
    } catch (e) {}
  }
  const data = {
    LL:      getLLData_(),
    PSA:     getPSAData_(),
    Flights: getFlightData_(),
    fetchedAt: new Date().toISOString(),
    cached:  false,
  };
  try { cache.put('OT_ALL_V2', JSON.stringify(data), CACHE_TTL_SEC); } catch (e) {}
  return data;
}

function clearCache() {
  CacheService.getScriptCache().remove('OT_ALL_V2');
  return { ok: true };
}

// ============= Helpers =============
function hmsToMin_(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 24 * 60); // Excel time fraction (days)
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  const s = String(v).trim();
  if (!s) return 0;
  const m = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 60);
}

function getDayOfMonth_(v) {
  if (v instanceof Date) return v.getDate();
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.getUTCDate();
  }
  const s = String(v || '').trim();
  if (!s) return 0;
  // Thai date format: "1 ม.ค. 2026", "15 พ.ค. 2026" — extract leading day
  const thM = s.match(/^(\d{1,2})\s+[ก-ฮ]/);
  if (thM) return parseInt(thM[1]);
  // ISO or other parsable date
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.getDate();
  // Plain leading number
  const numM = s.match(/^(\d{1,2})/);
  return numM ? parseInt(numM[1]) : 0;
}

function getMonthYear_(v) {
  if (v instanceof Date) return [v.getMonth(), v.getFullYear()];
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return [d.getUTCMonth(), d.getUTCFullYear()];
  }
  const dt = new Date(String(v || ''));
  return isNaN(dt) ? [-1, 0] : [dt.getMonth(), dt.getFullYear()];
}

function weekIndexFromDay_(day) {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

// ============= LL Parser =============
/**
 * Reads OT LL Sheet — tabs "2025", "2026" (per-month detail)
 */
function getLLData_() {
  const result = {};
  try {
    const ss = SpreadsheetApp.openById(OT_LL_FILE_ID);
    ['2025', '2026'].forEach(yr => {
      const sh = ss.getSheetByName(yr);
      if (sh) Object.assign(result, parseLLYearSheet_(sh, yr));
    });
  } catch (e) {
    return { _error: String(e) };
  }
  return result;
}

function parseLLYearSheet_(sheet, year) {
  const values = sheet.getDataRange().getValues();
  const data = {};

  for (let r = 0; r < values.length; r++) {
    const cell = String(values[r][1] || '').trim().toUpperCase();
    const m = cell.match(/^([A-Z]{3})\s*(\d{4})$/);
    if (!m || m[2] !== year) continue;
    const monthAbbr = MONTH_ABBR_UPPER[m[1]];
    if (!monthAbbr) continue;
    const mk = monthAbbr + ' ' + year;

    const nextLabel = String(values[r+1] && values[r+1][1] || '').trim();
    const is2026Layout = nextLabel === 'LL';
    const is2025Layout = /^Week\s*01$/i.test(nextLabel);

    if (!is2026Layout && !is2025Layout) continue;

    let weeks, codeStartCol;

    if (is2026Layout) {
      const llRow = values[r+1] || [];
      const poRow = values[r+2] || [];
      const adRow = values[r+3] || [];
      weeks = [0,1,2,3].map(w => {
        const llV = hmsToMin_(llRow[2+w]);
        const poV = hmsToMin_(poRow[2+w]);
        const adV = hmsToMin_(adRow[2+w]);
        return { week: 'Week 0'+(w+1), LL_min: llV, Porter_min: poV, Admin_min: adV, Total_min: llV+poV+adV };
      });
      codeStartCol = 8;
    } else {
      weeks = [0,1,2,3].map(w => {
        const row = values[r+1+w] || [];
        const llV = hmsToMin_(row[2]);
        const poV = hmsToMin_(row[3]);
        const adV = hmsToMin_(row[4]);
        return { week: 'Week 0'+(w+1), LL_min: llV, Porter_min: poV, Admin_min: adV, Total_min: llV+poV+adV };
      });
      codeStartCol = 7;
    }

    const codes = {};
    for (let w = 0; w < 4; w++) {
      const wLabel = 'Week 0' + (w+1);
      const blockStart = codeStartCol + w * 6;
      codes[wLabel] = {};
      for (let cIdx = 0; cIdx < 8; cIdx++) {
        const codeName = 'A' + (cIdx + 1);
        const rr = r + 2 + cIdx;
        const row = values[rr] || [];
        codes[wLabel][codeName] = {
          LL_min:     hmsToMin_(row[blockStart + 1]),
          Porter_min: hmsToMin_(row[blockStart + 3]),
          Admin_min:  hmsToMin_(row[blockStart + 5]),
        };
      }
    }

    data[mk] = { weeks: weeks, codes: codes };
  }
  return data;
}

// ============= PSA OT (preview mode) =============
function getPSAData_() {
  try {
    const ss = SpreadsheetApp.openById(OT_YEARLY_FILE_ID);
    const sheets = ss.getSheets();
    if (sheets.length <= PSA_SHEET_INDEX) {
      return { _error: 'PSA sheet index ' + PSA_SHEET_INDEX + ' not found (have ' + sheets.length + ' sheets)' };
    }
    const psaSheet = sheets[PSA_SHEET_INDEX];
    const values = psaSheet.getDataRange().getValues();
    return {
      _meta: {
        sheetName: psaSheet.getName(),
        sheetIndex: PSA_SHEET_INDEX,
        rowCount: values.length,
        colCount: values[0] ? values[0].length : 0,
        allSheetNames: sheets.map((s, i) => i + ': ' + s.getName()),
      },
      _preview: values.slice(0, 40),
    };
  } catch (e) {
    return { _error: String(e) };
  }
}

// ============= Flight Feed Parser =============
function getFlightData_() {
  const result = {};
  const debug = { sheetsFound: [], sheetsParsed: 0, totalRowsRead: 0 };
  try {
    const ss = SpreadsheetApp.openById(FLIGHT_FEED_FILE_ID);
    const monthSheets = ss.getSheets().filter(s => /^[A-Z]{3}\d{4}$/.test(s.getName().replace(/\s/g, '')));
    debug.sheetsFound = monthSheets.map(s => s.getName());

    monthSheets.forEach(sh => {
      const name = sh.getName().replace(/\s/g, '').toUpperCase();
      const mm = name.match(/^([A-Z]{3})(\d{4})$/);
      if (!mm) return;
      const monthAbbr = MONTH_ABBR_UPPER[mm[1]];
      if (!monthAbbr) return;
      const mk = monthAbbr + ' ' + mm[2];

      const values = sh.getDataRange().getValues();
      if (values.length < 2) return;
      debug.totalRowsRead += values.length;
      debug.sheetsParsed++;

      const hdr = values[0].map(c => String(c || '').toLowerCase());
      let dateCol = 0;
      let airlineCol = 1;
      let statusCol = -1;
      let typeCol = -1;
      hdr.forEach((h, i) => {
        if (h.indexOf('date') >= 0 || h === 'วันที่') dateCol = i;
        if (h.indexOf('airline') >= 0) airlineCol = i;
        if (h === 'status' || h.indexOf('status ') === 0) statusCol = i;
        if (h.indexOf('type of flight') >= 0) typeCol = i;
      });
      if (statusCol < 0) statusCol = 20;
      if (typeCol < 0)   typeCol = 21;

      const teams = {};
      const flightCounts = [0,0,0,0];
      let cancelledCount = 0;
      let validRows = 0;

      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        if (!row || row.length < 2) continue;
        const dateCell = row[dateCol];
        const airline  = String(row[airlineCol] || '').trim().toUpperCase();
        if (!airline) continue;
        const status   = String(row[statusCol] || '').trim().toLowerCase();
        const flType   = String(row[typeCol]   || '').trim().toLowerCase();
        const day      = getDayOfMonth_(dateCell);
        if (day < 1 || day > 31) continue;
        validRows++;
        if (status === 'cancelled' || flType === 'cancelled') {
          cancelledCount++;
          continue;
        }
        const wIdx = weekIndexFromDay_(day);
        flightCounts[wIdx]++;
        const team = TEAM_MAP[airline];
        if (team) {
          if (!teams[team]) teams[team] = [0,0,0,0];
          teams[team][wIdx]++;
        }
      }
      result[mk] = {
        flightCounts: flightCounts,
        teams: teams,
        cancelled: cancelledCount,
        _diag: { validRows: validRows, dateCol: dateCol, statusCol: statusCol, typeCol: typeCol }
      };
    });
  } catch (e) {
    return { _error: String(e), _debug: debug };
  }
  result._debug = debug;
  return result;
}

// ============= Inspect helper =============
function inspectSheets() {
  ['LL', 'Yearly', 'Flight Feed'].forEach((label, i) => {
    const id = [OT_LL_FILE_ID, OT_YEARLY_FILE_ID, FLIGHT_FEED_FILE_ID][i];
    try {
      const ss = SpreadsheetApp.openById(id);
      console.log('=== ' + label + ' (' + ss.getName() + ') ===');
      ss.getSheets().forEach((s, idx) => {
        console.log('  [' + idx + '] ' + s.getName() + ' — ' + s.getLastRow() + ' rows × ' + s.getLastColumn() + ' cols');
      });
    } catch (e) {
      console.log('=== ' + label + ' ERROR ===\n  ' + e);
    }
  });
}

function testGetAllData() {
  const data = getAllData();
  console.log('LL months: ' + Object.keys(data.LL).length);
  console.log('  → ' + Object.keys(data.LL).join(', '));
  console.log('PSA meta: ' + JSON.stringify(data.PSA._meta || data.PSA._error));
  console.log('Flight months: ' + (data.Flights._error ? data.Flights._error : Object.keys(data.Flights).length));
  if (data.Flights && !data.Flights._error) {
    Object.keys(data.Flights).forEach(mk => {
      const f = data.Flights[mk];
      console.log('  ' + mk + ': active ' + f.flightCounts.reduce((a,b)=>a+b,0) + ' (cancelled ' + f.cancelled + ')');
    });
  }
}
