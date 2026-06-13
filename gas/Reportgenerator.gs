/**
 * ReportGenerator.gs (v2 — Google Docs intermediate)
 *
 * ใช้ DocumentApp build ไฟล์ก่อน export เป็น PDF
 * เหตุผล: Drive's HTML→PDF converter ไม่ render Thai shaping ถูก (ตัวซ้ำ, สระเพี้ยน)
 * Docs render native Thai correctly
 */

// ─── Color palette ──────────────────────────────────────────────
const COLOR_NAVY        = '#0a3d7a';
const COLOR_NAVY_LIGHT  = '#e3eaf5';
const COLOR_ORANGE      = '#f29200';
const COLOR_ORANGE_SOFT = '#fff5e0';
const COLOR_RED         = '#d63a3a';
const COLOR_RED_SOFT    = '#ffeaea';
const COLOR_GREEN       = '#2a8d4a';
const COLOR_GREEN_SOFT  = '#e8f5e9';
const COLOR_GRAY        = '#666666';
const COLOR_GRAY_LIGHT  = '#fafbfc';
const COLOR_WHITE       = '#ffffff';
const COLOR_BORDER      = '#e2e6ee';

const FONT_THAI = 'Sarabun';

/**
 * Build Google Doc → return docId + filename
 * @param {string} period
 * @param {Date}   startDate
 * @param {Date}   endDate
 * @param {{ dashboardUrl?: string }} [options]
 * @returns {{ docId, filename, periodLabel, hasData }}
 */
function buildReportDoc(period, startDate, endDate, options) {
  options = options || {};
  const cfg = getRuntimeConfig();

  // ─ 1. Read data ──────────────────────────────────────────────
  const attendance = readAttendance(startDate, endDate);
  const ot         = calculateOT(attendance);
  const flights    = readFlights(startDate, endDate);
  const summary    = readSummaryFull();
  const hasOT      = ot.total.all > 0;
  const hasFlight  = flights.total > 0;
  const hasData    = hasOT || hasFlight;
  const periodLabel = _periodLabel(period, startDate, endDate);
  const filename    = _filename(period, startDate, endDate);

  // ─ 2. Create temp Doc ────────────────────────────────────────
  const doc = DocumentApp.create('_tmp_' + filename.replace(/\.pdf$/, '') + '_' + Date.now());
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

  // ─ 3. Sections ───────────────────────────────────────────────
  _addHeader(body, cfg, periodLabel, options.dashboardUrl);
  _addEmptyStateBanner(body, hasData, period, startDate, endDate);
  _addKPIRow(body, ot, flights, summary, hasData);
  _addOTByTeam(body, ot, summary, cfg);
  _addOverLimitSection(body, ot.overLimit, cfg);
  _addOTTypeBreakdown(body, ot.total);
  _addFlightSection(body, flights);
  _addEmployeeBreakdown(body, summary, cfg);
  _addFooter(doc, cfg, options.dashboardUrl);

  doc.saveAndClose();

  return {
    docId: doc.getId(),
    filename: filename,
    periodLabel: periodLabel.range,
    hasData: hasData
  };
}

// ════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ════════════════════════════════════════════════════════════════
function _addHeader(body, cfg, periodLabel, dashboardUrl) {
  const title = body.appendParagraph('OT Summary Report — ฝ่าย ' + cfg.REPORT_DEPT_CODE);
  title.setAttributes({}).setHeading(DocumentApp.ParagraphHeading.NORMAL);
  _setText(title, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 18, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });

  const sub = body.appendParagraph(cfg.REPORT_DEPT_NAME + ' · รายงานโอที' + periodLabel.kind + ' · ' + periodLabel.range);
  _setText(sub, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 10, FOREGROUND_COLOR: COLOR_GRAY });

  const gen = body.appendParagraph('Generated: ' + formatDate(new Date(), 'yyyy-MM-dd HH:mm') + ' · Timezone: ' + cfg.TIMEZONE);
  _setText(gen, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 8.5, FOREGROUND_COLOR: COLOR_GRAY, ITALIC: true });

  // ─ Dashboard CTA — clickable link box ─
  if (dashboardUrl) {
    const dashPara = body.appendParagraph('');
    const linkText = dashPara.appendText('📊 เปิด Interactive Dashboard — กราฟ + ตาราง filter ได้');
    linkText.setFontFamily(FONT_THAI);
    linkText.setFontSize(11);
    linkText.setBold(true);
    linkText.setForegroundColor('#1565c0');
    linkText.setLinkUrl(dashboardUrl);
    dashPara.setAttributes({
      BACKGROUND_COLOR: COLOR_NAVY_LIGHT,
      SPACING_BEFORE: 6,
      SPACING_AFTER: 4
    });

    // URL ตรงๆ บรรทัดถัดไป (เผื่อ print แล้วต้องพิมพ์)
    const urlPara = body.appendParagraph('');
    const urlText = urlPara.appendText(dashboardUrl);
    urlText.setFontFamily('Courier New');
    urlText.setFontSize(7.5);
    urlText.setForegroundColor(COLOR_GRAY);
    urlText.setLinkUrl(dashboardUrl);
  }

  body.appendHorizontalRule();
}

function _addEmptyStateBanner(body, hasData, period, startDate, endDate) {
  if (hasData) return;
  const cfg = getRuntimeConfig();
  const months = _monthRange(stripTime(startDate), stripTime(endDate));
  const tabsTried = months.map(function(m){
    return _renderTabPattern(cfg.ATTENDANCE_TAB_NAME, m);
  });

  const banner = body.appendParagraph(
    '⚠ ไม่พบข้อมูล Attendance ในช่วงนี้\n\n' +
    'ระบบลองหาจาก tab: ' + tabsTried.join(', ') + ' แต่ไม่พบ หรือ tab ว่างเปล่า\n' +
    'วิธีแก้:\n' +
    '  1. ตรวจสอบว่าได้สร้าง tab ตามรูปแบบใน Config (ATTENDANCE_TAB_NAME)\n' +
    '  2. ตรวจสอบว่าข้อมูล Attendance อยู่ในช่วงวันที่ที่ขอ\n' +
    '  3. ตรวจสอบ ATTENDANCE_SHEET_ID ใน Config.gs\n\n' +
    'รายงานนี้แสดงเฉพาะข้อมูล "จำนวนพนักงาน" จาก Summary sheet เท่านั้น'
  );
  _setText(banner, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 10, FOREGROUND_COLOR: '#7a1212' });
  banner.setAttributes({
    BACKGROUND_COLOR: COLOR_RED_SOFT,
    SPACING_AFTER: 8, SPACING_BEFORE: 4,
    BORDER_COLOR: COLOR_RED, BORDER_WIDTH: 2
  });
}

function _addKPIRow(body, ot, flights, summary, hasData) {
  const otPerEmp = summary.total > 0 ? (ot.total.all / summary.total).toFixed(2) : '0.00';
  const kpis = [
    { label: 'OT รวม',              value: ot.total.all.toFixed(1),     sub: 'ชั่วโมง' },
    { label: 'ไฟลท์ (ไม่รวม CNL)', value: String(flights.operating),    sub: 'ทั้งหมด ' + flights.total + ' · CNL ' + flights.cancelled },
    { label: 'พนักงานทั้งหมด',     value: String(summary.total),         sub: Object.keys(summary.byTeam).length + ' ทีม' },
    { label: 'OT / พนักงาน',         value: otPerEmp,                    sub: 'ชม./คน' }
  ];

  const tbl = body.appendTable([
    kpis.map(function(k){ return k.label; }),
    kpis.map(function(k){ return k.value; }),
    kpis.map(function(k){ return k.sub; })
  ]);

  for (let c = 0; c < 4; c++) {
    const labelCell = tbl.getCell(0, c);
    const valueCell = tbl.getCell(1, c);
    const subCell   = tbl.getCell(2, c);

    [labelCell, valueCell, subCell].forEach(function(cell){
      cell.setBackgroundColor(COLOR_NAVY_LIGHT)
          .setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(8).setPaddingRight(8);
    });
    _setText(labelCell.getChild(0).asParagraph(),
      { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, FOREGROUND_COLOR: COLOR_GRAY });
    _setText(valueCell.getChild(0).asParagraph(),
      { FONT_FAMILY: FONT_THAI, FONT_SIZE: 22, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });
    _setText(subCell.getChild(0).asParagraph(),
      { FONT_FAMILY: FONT_THAI, FONT_SIZE: 8.5, FOREGROUND_COLOR: COLOR_GRAY });
  }
  body.appendParagraph(''); // spacer
}

function _addOverLimitSection(body, overLimit, cfg) {
  if (!overLimit || overLimit.length === 0) {
    const ok = body.appendParagraph('✓ ไม่พบพนักงาน OT เกิน ' + cfg.WEEKLY_OT_CAP_HOURS +
                                     ' ชม./สัปดาห์ (พ.ร.บ.คุ้มครองแรงงาน 2541 มาตรา 26)');
    _setText(ok, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 10, FOREGROUND_COLOR: COLOR_GREEN, BOLD: true });
    ok.setAttributes({ BACKGROUND_COLOR: COLOR_GREEN_SOFT, SPACING_AFTER: 6, SPACING_BEFORE: 6 });
    return;
  }

  const warn = body.appendParagraph(
    '⚠ พบ ' + overLimit.length + ' ราย ที่ OT เกิน ' + cfg.WEEKLY_OT_CAP_HOURS +
    ' ชม./สัปดาห์ (พ.ร.บ.คุ้มครองแรงงาน 2541 มาตรา 26)'
  );
  _setText(warn, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 11, BOLD: true, FOREGROUND_COLOR: '#7a1212' });
  warn.setAttributes({ BACKGROUND_COLOR: COLOR_RED_SOFT, SPACING_AFTER: 4, SPACING_BEFORE: 6 });

  const rows = [['#', 'รหัส', 'ชื่อ', 'ทีม', 'สัปดาห์', 'OT จริง (ชม.)', 'เกิน (ชม.)']];
  overLimit.forEach(function(o, i) {
    rows.push([
      String(i+1), String(o.empId), o.empName, o.team,
      o.weekLabel, o.otHours.toFixed(1), '+' + o.overBy.toFixed(1)
    ]);
  });
  const tbl = body.appendTable(rows);
  _styleDataTable(tbl, false, [false, false, false, false, false, true, true]);

  // Color the over-by column red
  for (let r = 1; r < rows.length; r++) {
    _setText(tbl.getRow(r).getCell(6).getChild(0).asParagraph(),
      { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: COLOR_RED });
  }
}

function _addOTTypeBreakdown(body, total) {
  if (total.all === 0) return; // skip if empty
  _h2(body, 'สัดส่วน OT ตามประเภท');
  const items = [
    { name: 'OT ก่อนชิฟ',    val: total.before, color: '#2e6cc9' },
    { name: 'OT หลังชิฟ',    val: total.after,  color: COLOR_ORANGE },
    { name: 'OT วันหยุด',    val: total.dayoff, color: COLOR_RED },
    { name: 'OT นักขัตฤกษ์', val: total.ph,     color: '#6a3d9a' }
  ];
  const rows = [['ประเภท', 'ชั่วโมง', '%', 'Bar']];
  items.forEach(function(it){
    const pct = (it.val / total.all * 100);
    const barLen = Math.round(pct / 5); // each '█' = 5%
    const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
    rows.push([it.name, it.val.toFixed(1), pct.toFixed(1) + '%', bar]);
  });
  const tbl = body.appendTable(rows);
  _styleDataTable(tbl, false, [false, true, true, false]);

  // Color each bar
  for (let r = 1; r <= items.length; r++) {
    _setText(tbl.getRow(r).getCell(3).getChild(0).asParagraph(),
      { FONT_FAMILY: 'Courier New', FONT_SIZE: 9, FOREGROUND_COLOR: items[r-1].color });
  }
}

function _addFlightSection(body, flights) {
  _h2(body, 'ข้อมูลไฟลท์');
  if (flights.total === 0) {
    const empty = body.appendParagraph('— ไม่มีข้อมูลไฟลท์ในช่วงนี้ —');
    _setText(empty, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 10, ITALIC: true, FOREGROUND_COLOR: COLOR_GRAY });
    return;
  }

  // Status table (left) + Top airlines (right) — render as one wide table 4-col
  const top = Object.keys(flights.byAirline)
    .sort(function(a, b){ return flights.byAirline[b] - flights.byAirline[a]; })
    .slice(0, 8);

  const rows = [['สถานะ', 'จำนวน', 'Airline (Top 8)', 'ไฟลท์']];
  const maxLen = Math.max(5, top.length);
  const statusRows = [
    ['Departure (DEP)', flights.byType.DEP],
    ['Arrival (ARR)',   flights.byType.ARR],
    ['อื่นๆ',           flights.byType.OTHER],
    ['Cancelled (CNL)', flights.cancelled],
    ['ปฏิบัติงานรวม',   flights.operating]
  ];

  for (let i = 0; i < maxLen; i++) {
    const s = statusRows[i] || ['', ''];
    const a = top[i] ? [top[i], flights.byAirline[top[i]]] : ['', ''];
    rows.push([String(s[0]), String(s[1]), String(a[0]), String(a[1])]);
  }
  const tbl = body.appendTable(rows);
  _styleDataTable(tbl, false, [false, true, false, true]);

  // Highlight "ปฏิบัติงานรวม" row
  for (let r = 1; r <= statusRows.length; r++) {
    if (rows[r][0] === 'ปฏิบัติงานรวม') {
      tbl.getRow(r).getCell(0).setBackgroundColor(COLOR_ORANGE_SOFT);
      tbl.getRow(r).getCell(1).setBackgroundColor(COLOR_ORANGE_SOFT);
      _setText(tbl.getRow(r).getCell(0).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true });
      _setText(tbl.getRow(r).getCell(1).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true });
    }
  }
}

function _addFooter(doc, cfg, dashboardUrl) {
  const footer = doc.addFooter();
  const fp = footer.appendParagraph(
    'AOT GA — ' + cfg.REPORT_DEPT_CODE + ' Department · OT Report · ' +
    'Auto-generated ' + formatDate(new Date(), 'yyyy-MM-dd HH:mm') + ' · ' +
    'พ.ร.บ.คุ้มครองแรงงาน 2541 (≤ ' + cfg.WEEKLY_OT_CAP_HOURS + ' ชม./สัปดาห์)'
  );
  _setText(fp, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 8, FOREGROUND_COLOR: COLOR_GRAY, ITALIC: true });

  // ─ Footer link ─
  if (dashboardUrl) {
    const lp = footer.appendParagraph('');
    const linkText = lp.appendText('📊 Interactive Dashboard (click here)');
    linkText.setFontFamily(FONT_THAI);
    linkText.setFontSize(8);
    linkText.setBold(true);
    linkText.setForegroundColor('#1565c0');
    linkText.setLinkUrl(dashboardUrl);
  }
}

// ════════════════════════════════════════════════════════════════
// STYLE HELPERS
// ════════════════════════════════════════════════════════════════
function _h2(body, text) {
  const h = body.appendParagraph(text);
  _setText(h, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 13, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });
  h.setAttributes({ SPACING_BEFORE: 10, SPACING_AFTER: 4 });
}

/**
 * Apply text style to a paragraph (all children)
 */
function _setText(paragraph, style) {
  const attrs = {};
  Object.keys(style).forEach(function(k){
    const key = DocumentApp.Attribute[k];
    if (key !== undefined) attrs[key] = style[k];
  });
  paragraph.setAttributes(attrs);
}

/**
 * @param {Table} table
 * @param {boolean} hasTotalRow — true ถ้า row สุดท้ายคือแถวรวม
 * @param {boolean[]} numCols — true=alignment right (number), false=left
 */
function _styleDataTable(table, hasTotalRow, numCols) {
  const nRows = table.getNumRows();
  for (let r = 0; r < nRows; r++) {
    const isHeader = (r === 0);
    const isTotal = hasTotalRow && (r === nRows - 1);
    const nCells = table.getRow(r).getNumCells();
    for (let c = 0; c < nCells; c++) {
      const cell = table.getCell(r, c);
      cell.setPaddingTop(2.5).setPaddingBottom(2.5).setPaddingLeft(5).setPaddingRight(5);
      const para = cell.getChild(0).asParagraph();

      if (isHeader) {
        cell.setBackgroundColor(COLOR_NAVY);
        _setText(para, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: COLOR_WHITE });
      } else if (isTotal) {
        cell.setBackgroundColor(COLOR_ORANGE_SOFT);
        _setText(para, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: '#1a1a1a' });
      } else {
        cell.setBackgroundColor(r % 2 === 0 ? COLOR_WHITE : COLOR_GRAY_LIGHT);
        _setText(para, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, FOREGROUND_COLOR: '#1a1a1a' });
      }
      // Align num cells right
      if (numCols && numCols[c]) {
        para.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }
  }
  table.setBorderColor(COLOR_BORDER).setBorderWidth(0.5);
}

// ════════════════════════════════════════════════════════════════
// LABELS
// ════════════════════════════════════════════════════════════════
function _periodLabel(period, start, end) {
  const s = _thaiDate(start);
  const e = _thaiDate(end);
  if (period === 'daily')   return { kind: ' รายวัน',     range: s };
  if (period === 'weekly')  return { kind: ' รายสัปดาห์', range: s + ' – ' + e };
  if (period === 'monthly') return { kind: ' รายเดือน',   range: _thaiMonthYear(start) };
  return { kind: '', range: s + ' – ' + e };
}

function _thaiDate(d) {
  const thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + thaiMonths[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

function _thaiMonthYear(d) {
  const thaiMonthsFull = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                          'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return thaiMonthsFull[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

function _filename(period, start, end) {
  const cfg = getRuntimeConfig();
  const code = cfg.REPORT_DEPT_CODE;
  if (period === 'daily')   return 'OT_Daily_'   + code + '_' + formatDate(start, 'yyyy-MM-dd') + '.pdf';
  if (period === 'weekly')  return 'OT_Weekly_'  + code + '_' + formatDate(start, 'yyyy-MM-dd') + '_to_' + formatDate(end, 'yyyy-MM-dd') + '.pdf';
  if (period === 'monthly') return 'OT_Monthly_' + code + '_' + formatDate(start, 'yyyy-MM') + '.pdf';
  return 'OT_Report_' + code + '_' + formatDate(start, 'yyyy-MM-dd') + '.pdf';
}

// ===== 3 แผนก KP/LP/LL (แทน _addOTByTeam/_addEmployeeBreakdown เดิม) =====
var DEPT3_LABEL_ = {
  KP: '── KP — การโดยสาร ──',
  LP: '── LP — บริการผู้โดยสารพิเศษ ──',
  LL: '── LL — ติดตามสัมภาระ ──'
};
var DEPT3_ORDER_ = ['KP', 'LP', 'LL'];

function _addOTByTeam(body, ot, summary, cfg) {
  _h2(body, 'OT แยกรายทีม (KP / LP / LL)');

  var rows = [['ทีม', 'พนักงาน', 'ก่อนชิฟ', 'หลังชิฟ', 'วันหยุด', 'นักขัตฤกษ์', 'รวม (ชม.)']];
  var total = { hc: 0, before: 0, after: 0, dayoff: 0, ph: 0, all: 0 };

  DEPT3_ORDER_.forEach(function (dep) {
    rows.push([DEPT3_LABEL_[dep], '', '', '', '', '', '']);
    var depTeams = cfg.TEAMS.filter(function (t) { return dept3ForTeam_(t.code) === dep; });
    var sub = { hc: 0, all: 0 };
    depTeams.forEach(function (t) {
      var o = ot.byTeam[t.code] || { before: 0, after: 0, dayoff: 0, ph: 0, all: 0 };
      var hc = summary.byTeam[t.code] || t.headcount;
      rows.push([t.name, String(hc),
        o.before.toFixed(1), o.after.toFixed(1), o.dayoff.toFixed(1), o.ph.toFixed(1), o.all.toFixed(1)]);
      total.hc += hc; total.before += o.before; total.after += o.after;
      total.dayoff += o.dayoff; total.ph += o.ph; total.all += o.all;
      sub.hc += hc; sub.all += o.all;
    });
    rows.push(['  รวม ' + dep, String(sub.hc), '', '', '', '', sub.all.toFixed(1)]);
  });

  rows.push(['รวมทั้งหมด', String(total.hc),
    total.before.toFixed(1), total.after.toFixed(1),
    total.dayoff.toFixed(1), total.ph.toFixed(1), total.all.toFixed(1)]);

  var tbl = body.appendTable(rows);
  _styleDataTable(tbl, true, [false, true, true, true, true, true, true]);

  for (var r = 1; r < rows.length - 1; r++) {
    if (rows[r][0].indexOf('──') !== -1) {                 // dept header
      for (var c = 0; c < 7; c++) tbl.getRow(r).getCell(c).setBackgroundColor(COLOR_ORANGE_SOFT);
      _setText(tbl.getRow(r).getCell(0).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, ITALIC: true, FOREGROUND_COLOR: COLOR_ORANGE });
    } else if (rows[r][0].indexOf('  รวม ') === 0) {        // dept subtotal
      for (var c2 = 0; c2 < 7; c2++) tbl.getRow(r).getCell(c2).setBackgroundColor(COLOR_NAVY_LIGHT);
      _setText(tbl.getRow(r).getCell(0).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });
    }
  }
}

function _addEmployeeBreakdown(body, summary, cfg) {
  body.appendPageBreak();
  _h2(body, 'จำนวนพนักงานปัจจุบัน (จากชีต Summary)');

  // ─ (A) by Team — จัดกลุ่ม KP / LP / LL ─
  var teamLabel = body.appendParagraph('แยกตามทีม (KP / LP / LL)');
  _setText(teamLabel, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 11, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });

  var teamRows = [['ทีม', 'แผนก', 'จำนวน']];
  var teamTotal = 0;
  DEPT3_ORDER_.forEach(function (dep) {
    teamRows.push([DEPT3_LABEL_[dep], '', '']);
    var depTeams = cfg.TEAMS.filter(function (t) { return dept3ForTeam_(t.code) === dep; });
    var sub = 0;
    depTeams.forEach(function (t) {
      var n = summary.byTeam[t.code] || 0;
      teamRows.push([t.name, dep, String(n)]);
      teamTotal += n; sub += n;
    });
    teamRows.push(['  รวม ' + dep, '', String(sub)]);
  });
  teamRows.push(['รวมทั้งหมด', '', String(teamTotal)]);

  var teamTbl = body.appendTable(teamRows);
  _styleDataTable(teamTbl, true, [false, false, true]);
  for (var r = 1; r < teamRows.length - 1; r++) {
    if (teamRows[r][0].indexOf('──') !== -1) {
      [0, 1, 2].forEach(function (c) { teamTbl.getRow(r).getCell(c).setBackgroundColor(COLOR_ORANGE_SOFT); });
      _setText(teamTbl.getRow(r).getCell(0).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, ITALIC: true, FOREGROUND_COLOR: COLOR_ORANGE });
    } else if (teamRows[r][0].indexOf('  รวม ') === 0) {
      [0, 1, 2].forEach(function (c) { teamTbl.getRow(r).getCell(c).setBackgroundColor(COLOR_NAVY_LIGHT); });
      _setText(teamTbl.getRow(r).getCell(0).getChild(0).asParagraph(),
        { FONT_FAMILY: FONT_THAI, FONT_SIZE: 9, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });
    }
  }

  body.appendParagraph('');

  // ─ (B) by Position — เหมือนเดิม ─
  var posLabel = body.appendParagraph('แยกตามตำแหน่ง');
  _setText(posLabel, { FONT_FAMILY: FONT_THAI, FONT_SIZE: 11, BOLD: true, FOREGROUND_COLOR: COLOR_NAVY });

  var posRows = [['ตำแหน่ง', 'จำนวน']];
  (summary.positions || []).forEach(function (p) {
    posRows.push([p, String(summary.byPosition[p] || 0)]);
  });
  posRows.push(['รวม', String(summary.total)]);
  var posTbl = body.appendTable(posRows);
  _styleDataTable(posTbl, true, [false, true]);
}
