/**
 * Code.gs — OT Report System
 * Entry point + menu + triggers
 *
 * เมนู:
 *   • Daily OT Report (เมื่อวาน)
 *   • OT Report — 3 วันย้อนหลัง
 *   • OT Report — 7 วันย้อนหลัง (สัปดาห์)
 *   • OT Report — กำหนดช่วงเอง
 *   • Monthly OT Report (เดือนที่แล้ว / เดือนนี้)
 *   ───
 *   • Setup Weekly Trigger (ทุกวันพุธ 06:00)
 *   • Remove All Triggers
 */

// ─── onOpen menu ────────────────────────────────────────────────
function onOpen() {
  const ui = _safeUi();
  if (!ui) return; // running standalone or triggered context
  ui.createMenu('OT Report')
    .addItem('📅 Daily OT (วันนี้)',          'runDailyToday')
    .addItem('📅 Daily OT (เมื่อวาน)',        'runDailyYesterday')
    .addItem('📅 OT 3 วันย้อนหลัง',           'runRange3Days')
    .addItem('📅 OT 7 วันย้อนหลัง (สัปดาห์)', 'runRange7Days')
    .addItem('📅 OT — กำหนดช่วงเอง',         'runCustomRange')
    .addSeparator()
    .addItem('📆 Monthly OT (เดือนที่แล้ว)',  'runMonthlyLast')
    .addItem('📆 Monthly OT (เดือนนี้)',      'runMonthlyCurrent')
    .addSeparator()
    .addItem('🌐 Get Web App URL',             'getWebAppUrl')
    .addItem('⚙ Setup Weekly Trigger (พุธ 06:00)', 'installWeeklyTrigger')
    .addItem('⚙ Remove All Triggers',         'removeAllTriggers')
    .addToUi();
}

/**
 * Return SpreadsheetApp.getUi() ถ้ามี context — null ถ้าไม่มี (standalone / trigger)
 */
function _safeUi() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

// ─── Public entry points ────────────────────────────────────────
function runDailyToday() {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  _runAndNotify('daily', today, today);
}

function runDailyYesterday() {
  const y = _yesterday();
  _runAndNotify('daily', y, y);
}

function runRange3Days() {
  const end = _yesterday();
  const start = new Date(end.getTime() - 2 * 86400000); // 3 วันรวมเมื่อวาน
  _runAndNotify('weekly', start, end);
}

function runRange7Days() {
  const end = _yesterday();
  const start = new Date(end.getTime() - 6 * 86400000);
  _runAndNotify('weekly', start, end);
}

function runCustomRange() {
  const ui = _safeUi();
  if (!ui) {
    Logger.log('runCustomRange ใช้ได้เฉพาะใน UI mode — ใช้ runCustomRangeProgrammatic("yyyy-MM-dd","yyyy-MM-dd") แทน');
    throw new Error('runCustomRange ต้องเรียกจาก Sheet menu — จาก Editor ใช้ runCustomRangeProgrammatic() แทน');
  }
  const r1 = ui.prompt('OT Report — กำหนดช่วง', 'วันเริ่มต้น (yyyy-MM-dd):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const r2 = ui.prompt('OT Report — กำหนดช่วง', 'วันสิ้นสุด (yyyy-MM-dd):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;

  const s = _parseDateInput(r1.getResponseText());
  const e = _parseDateInput(r2.getResponseText());
  if (!s || !e) { ui.alert('รูปแบบวันที่ไม่ถูกต้อง — ใช้ yyyy-MM-dd'); return; }
  if (s > e)    { ui.alert('วันเริ่มต้องมาก่อนวันสิ้นสุด'); return; }
  const days = Math.round((e - s) / 86400000) + 1;
  const period = (days === 1) ? 'daily' : (days <= 31 ? 'weekly' : 'monthly');
  _runAndNotify(period, s, e);
}

/**
 * Programmatic version — ใช้รันจาก Editor / trigger / clasp
 * @param {string} startStr 'yyyy-MM-dd'
 * @param {string} endStr   'yyyy-MM-dd'
 */
function runCustomRangeProgrammatic(startStr, endStr) {
  const s = _parseDateInput(startStr);
  const e = _parseDateInput(endStr);
  if (!s || !e) throw new Error('รูปแบบวันที่ไม่ถูกต้อง — ใช้ yyyy-MM-dd');
  if (s > e)    throw new Error('วันเริ่มต้องมาก่อนวันสิ้นสุด');
  const days = Math.round((e - s) / 86400000) + 1;
  const period = (days === 1) ? 'daily' : (days <= 31 ? 'weekly' : 'monthly');
  return _runAndNotify(period, s, e);
}

function runMonthlyLast() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const end   = new Date(t.getFullYear(), t.getMonth(), 0);
  _runAndNotify('monthly', start, end);
}

function runMonthlyCurrent() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), 1);
  const end   = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  _runAndNotify('monthly', start, end);
}

// ─── Scheduled trigger ──────────────────────────────────────────
/**
 * Weekly trigger — Wed 06:00 → สร้าง weekly PDF ของ 7 วันที่แล้ว
 */
function weeklyTriggerHandler() {
  const end = _yesterday();
  const start = new Date(end.getTime() - 6 * 86400000);
  const result = generateAndSavePDF('weekly', start, end);
  Logger.log('Weekly trigger: ' + JSON.stringify(result));
}

function installWeeklyTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger('weeklyTriggerHandler')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
    .atHour(6)
    .create();
  const msg = '✓ ติดตั้ง trigger เรียบร้อย — รัน Weekly OT ทุกวันพุธ 06:00';
  const ui = _safeUi();
  if (ui) ui.alert(msg); else Logger.log(msg);
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t){ ScriptApp.deleteTrigger(t); });
  const ui = _safeUi();
  if (ui) ui.alert('✓ ลบ triggers ทั้งหมดแล้ว');
}

// ─── Helpers ────────────────────────────────────────────────────
function _runAndNotify(period, start, end) {
  const ui = _safeUi();
  try {
    const result = generateAndSavePDF(period, start, end);
    const dashLine = result.dashboardUrl ? '\nDashboard: ' + result.dashboardUrl : '';
    const dataWarn = result.hasData ? '' : '\n⚠ ไม่พบข้อมูล Attendance — ดูคำอธิบายใน PDF';

    const msg = '✓ สร้าง PDF เรียบร้อย\n' +
      'ไฟล์: ' + result.filename + dataWarn + '\n' +
      'บันทึกที่:\n• ' + result.savedTo.join('\n• ') + '\n' +
      'PDF: ' + result.fileUrl + dashLine;
    Logger.log(msg);

    if (ui) ui.alert(
      result.hasData ? '✓ สร้าง PDF เรียบร้อย' : '⚠ สร้าง PDF แต่ไม่มีข้อมูล Attendance',
      'ไฟล์: ' + result.filename + '\n\nบันทึกที่:\n• ' + result.savedTo.join('\n• ') +
      '\n\n📄 PDF: ' + result.fileUrl +
      (result.dashboardUrl ? '\n📊 Dashboard: ' + result.dashboardUrl : '') +
      (result.hasData ? '' : '\n\n⚠ ระบบหา Attendance tab ไม่เจอ — ดู Apps Script → Executions สำหรับรายละเอียด'),
      ui.ButtonSet.OK);
    return result;
  } catch (e) {
    const err = e.stack || e.message;
    Logger.log('ERROR: ' + err);
    if (ui) ui.alert('⚠ Error', e.message + '\n\nดู Apps Script → Executions สำหรับ stack trace', ui.ButtonSet.OK);
    throw e;
  }
}

function _yesterday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
}

function _parseDateInput(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  return isNaN(d.getTime()) ? null : d;
}