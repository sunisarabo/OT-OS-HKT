/**
 * Config.gs — OT Report System
 * แก้ค่าใน CONFIG ก่อน deploy
 */

const CONFIG = {
  // ─── Google Drive Folder IDs ─────────────────────────────────
  YEARLY_FOLDER_ID:  '1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp',  // โฟลเดอร์รายปี
  MONTHLY_FOLDER_ID: '1qV5UWoAS6MSkEGm6bVDyCpYLwqugLc0o',  // โฟลเดอร์รายเดือน

  // ─── Google Sheets IDs ───────────────────────────────────────
  FLIGHT_SHEET_ID:    '1Y3ft-vkHQ5Rm2LVmq1Zz_2j8n5T8wLgCJtdBKhqfBAA',  // ข้อมูลไฟลท์
  SUMMARY_SHEET_ID:   '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8',  // Summary / Roster

  // ─── PSA Roster (Phase 2) ────────────────────────────────────
  // Folder ที่มี daily PSA assignment files — drill: year folder → month folder → DDMMM file
  PSA_ROSTER_FOLDER_ID: '1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp',
  // LL monthly file ที่มี daily tabs (DDMMM format)
  LL_ROSTER_FILE_ID:    '1w3UPzG3j6SNgsfxszTdMet_I4gSC2ZD37LE_lGAkVcw',
  // ถ้า LL เปลี่ยนไฟล์ทุกเดือน: paste "2026-04:abc,2026-05:def" (override LL_ROSTER_FILE_ID)
  LL_ROSTER_FILES_BY_MONTH: '',
  // Sheets ใน PSA daily file ที่ต้อง skip (ไม่ใช่ roster ของทีม)
  PSA_SKIP_SHEETS: [
    'MANPOWER',
    'MASTER SMART SHIFT',
    'SHIFTDB',
    'CODE'
  ],

  // ─── Sheet/Tab Names ─────────────────────────────────────────
  // Flight tab — pattern เดียวกับ Attendance (รองรับ {yyyy-MM})
  FLIGHT_TAB_NAME:    'Flights-{yyyy-MM}',
  FLIGHT_TAB_FALLBACK: 'Flights',
  SUMMARY_TAB_NAME:   'Summary',     // ชีต Summary ที่มีจำนวนพนักงานต่อทีม
  ROSTER_TAB_PREFIX:  'Roster',      // เช่น Roster-2026-05

  // ─── Time Attendance ─────────────────────────────────────────
  // ผม Attendance: อยู่ใน Google Sheet หรือ CSV ที่ upload ลง Drive
  // ถ้าใช้ Sheet → ใส่ ID; ถ้า CSV → ใส่ folder ID และให้ตั้งชื่อไฟล์ตาม pattern
  // ใช้ไฟล์เดียวกับ Summary ('Pax Manpower Issue 02') โดย default
  // ถ้า Time Attendance อยู่ในไฟล์อื่น ให้ paste ID ที่นี่
  ATTENDANCE_SHEET_ID: '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8',
  // Tab name — รองรับ 2 แบบ:
  //   ก. ชื่อคงที่ เช่น 'Attendance' → ใช้ tab เดียวสำหรับทุกเดือน
  //   ข. pattern ที่มี {yyyy}, {yyyy-MM}, {MMM} เช่น 'Attendance-{yyyy-MM}'
  //      → ระบบจะ resolve อัตโนมัติตามเดือนของวันที่ที่ขอ
  //   ถ้าหา tab ไม่เจอ → fallback มาที่ ATTENDANCE_TAB_FALLBACK
  ATTENDANCE_TAB_NAME: 'Attendance-{yyyy-MM}',
  ATTENDANCE_TAB_FALLBACK: 'Attendance',
  // คอลัมน์ที่คาดหวังในชีต Attendance (zero-indexed):
  ATTENDANCE_COLS: {
    DATE:      0,  // วันที่ (yyyy-MM-dd หรือ Date)
    EMP_ID:    1,  // รหัสพนักงาน
    EMP_NAME:  2,  // ชื่อ-นามสกุล
    TEAM:      3,  // ทีม (ตรงกับ TEAMS[].code)
    SHIFT:     4,  // กะที่ schedule (M/A/N/OFF/PH)
    TIME_IN:   5,  // เวลาเข้า (HH:mm หรือ Date)
    TIME_OUT:  6   // เวลาออก (HH:mm หรือ Date)
  },

  // ─── เวลา Shift มาตรฐาน (24-hr) ──────────────────────────────
  // ใช้สำหรับคำนวณ OT ก่อน/หลังชิฟ
  SHIFT_TIMES: {
    M: { start: '06:00', end: '14:00' },  // Morning
    A: { start: '14:00', end: '22:00' },  // Afternoon
    N: { start: '22:00', end: '06:00' }   // Night (ข้ามวัน)
  },

  // ─── เกณฑ์ขั้นต่ำในการนับ OT (นาที) ──────────────────────────
  // เช่น clock-in มาก่อนกะ < 15 นาทีไม่นับเป็น OT
  OT_MIN_THRESHOLD_MIN: 15,

  // ─── ขีดจำกัด OT/สัปดาห์ (ตามกฎหมายแรงงาน) ───────────────────
  // พ.ร.บ.คุ้มครองแรงงาน 2541 มาตรา 26: OT ไม่เกิน 36 ชม./สัปดาห์
  WEEKLY_OT_CAP_HOURS: 36,
  // วันแรกของสัปดาห์ (0=Sun, 1=Mon)
  WEEK_START_DAY: 1,

  // ─── รายชื่อทีม (PSA = การโดยสาร, LL = ติดตามสัมภาระ) ─────────
  // headcount จะ override จากชีต Summary ถ้าอ่านได้
  TEAMS: [
    // PSA (การโดยสาร ภูเก็ต) — 21 ทีม
    { code: 'ADMIN_DOC',         name: 'ADMIN DOC',         headcount: 10, dept: 'PSA' },
    { code: 'ADMIN_PORTER',      name: 'ADMIN PORTER',      headcount: 4,  dept: 'PSA' },
    { code: 'AK_QZ_8M',          name: 'AK/QZ/8M',          headcount: 21, dept: 'PSA' },
    { code: 'CHARTER',           name: 'Charter',           headcount: 34, dept: 'PSA' },
    { code: 'CHINA_TEAM',        name: 'CHINA TEAM',        headcount: 53, dept: 'PSA' },
    { code: 'EK_UO_6B_BY_FY',    name: 'EK/UO/6B/BY/FY',    headcount: 33, dept: 'PSA' },
    { code: 'EY_DV_AY',          name: 'EY/DV/AY',          headcount: 33, dept: 'PSA' },
    { code: 'JQ_IT_IX_AI_N0',    name: 'JQ/IT/IX/AI/N0',    headcount: 28, dept: 'PSA' },
    { code: 'KC_LJ_KE_OZ_NO_AF', name: 'KC/LJ/KE/OZ/NO/AF', headcount: 39, dept: 'PSA' },
    { code: 'OFFICE',            name: 'OFFICE',            headcount: 14, dept: 'PSA' },
    { code: 'PG',                name: 'PG',                headcount: 28, dept: 'PSA' },
    { code: 'PORTER',            name: 'PORTER',            headcount: 73, dept: 'PSA' },
    { code: 'PORTER_CREWSIGN',   name: 'Porter Crewsign',   headcount: 14, dept: 'PSA' },
    { code: 'PVT',               name: 'PVT',               headcount: 17, dept: 'PSA' },
    { code: 'QR_MH_OM_DE',       name: 'QR/MH/OM/DE',       headcount: 45, dept: 'PSA' },
    { code: 'SQ_CX_LY',          name: 'SQ/CX/LY',          headcount: 33, dept: 'PSA' },
    { code: 'SU_B2_W5',          name: 'SU/B2/W5',          headcount: 37, dept: 'PSA' },
    { code: 'SV_KA_WK',          name: 'SV/KA/WK',          headcount: 15, dept: 'PSA' },
    { code: 'TK_VJ_SG_HY_OD',    name: 'TK/VJ/SG/HY/OD',    headcount: 24, dept: 'PSA' },
    { code: 'TR_6E_QP',          name: 'TR/6E/QP',          headcount: 47, dept: 'PSA' },
    { code: 'WY_G9_9C_DK',       name: 'WY/G9/9C/DK',       headcount: 25, dept: 'PSA' },
    // LL (ติดตามสัมภาระ ภูเก็ต) — 3 ทีม
    { code: 'ADMIN_LL',          name: 'ADMIN LL',          headcount: 2,  dept: 'LL' },
    { code: 'LOST_AND_FOUND',    name: 'lOST AND fOUND',    headcount: 56, dept: 'LL' },
    { code: 'PORTER_LL',         name: 'PORTER LL',         headcount: 17, dept: 'LL' }
  ],

  // ─── วันนักขัตฤกษ์ (Public Holidays) ─────────────────────────
  // เพิ่ม/แก้ตามปี (yyyy-MM-dd)
  PUBLIC_HOLIDAYS: [
    // วันหยุดนักขัตฤกษ์ พนักงานปฏิบัติงานกะ ปี 2569 (ตามประกาศ AOTGA 403/2568)
    '2026-01-01', // วันขึ้นปีใหม่
    '2026-03-03', // วันมาฆบูชา
    '2026-04-06', // วันจักรี
    '2026-04-13', // วันสงกรานต์
    '2026-04-14', // วันสงกรานต์
    '2026-05-01', // วันแรงงานแห่งชาติ
    '2026-06-03', // วันเฉลิมฯ พระบรมราชินี
    '2026-07-28', // วันเฉลิมฯ ในหลวง รัชกาลที่ 10
    '2026-07-29', // วันอาสาฬหบูชา
    '2026-08-12', // วันเฉลิมฯ พระบรมราชชนนีพันปีหลวง / วันแม่
    '2026-10-13', // วันนวมินทรมหาราช (ร.9)
    '2026-10-23', // วันปิยมหาราช
    '2026-12-05', // วันคล้ายวันพระราชสมภพ ร.9 / วันชาติ / วันพ่อ
    '2026-12-31'  // วันสิ้นปี
  ],

  // ─── ชื่อไฟลท์ status ที่ถือเป็น "ยกเลิก" (case-insensitive) ──
  CANCELLED_FLIGHT_KEYWORDS: ['CNL', 'CANCELLED', 'CANCEL', 'CXL', 'ยกเลิก'],

  // ─── คอลัมน์ที่คาดหวังในชีต Flight ───────────────────────────
  FLIGHT_COLS: {
    DATE:    0,  // วันที่
    FLIGHT:  1,  // เลขไฟลท์
    AIRLINE: 2,  // สายการบิน
    TYPE:    3,  // DEP/ARR
    STATUS:  4,  // OK/CNL/...
    TEAM:    5   // ทีมที่รับผิดชอบ (optional)
  },

  // ─── หัวรายงาน ───────────────────────────────────────────────
  REPORT_DEPT_NAME: 'ฝ่ายการโดยสาร ภูเก็ต',
  REPORT_DEPT_CODE: 'PSA',
  TIMEZONE:         'Asia/Bangkok',
  LOCALE:           'th-TH',

  // ─── Web App URL (สำหรับ link ใน PDF) ────────────────────────
  // ถ้า paste URL ตรงนี้ → ใช้ค่านี้
  // ถ้าเว้นว่าง → ระบบดึงจาก ScriptApp.getService().getUrl() อัตโนมัติ
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwUbcbBuSMjXxFQII-RjyXyRdziSSsfFRt8GWemyPuodoGUg4GiaXm2IsLcprts8MGFFg/exec'
};

/**
 * อ่านค่า config ที่ override จาก Script Properties (สำหรับ deploy ต่าง env)
 */
function getRuntimeConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const cfg = JSON.parse(JSON.stringify(CONFIG)); // deep clone
  Object.keys(props).forEach(function(key) {
    if (key.indexOf('CFG_') === 0) {
      const path = key.substring(4); // CFG_YEARLY_FOLDER_ID → YEARLY_FOLDER_ID
      cfg[path] = props[key];
    }
  });
  return cfg;
}