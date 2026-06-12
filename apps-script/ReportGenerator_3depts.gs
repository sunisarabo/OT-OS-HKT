/**
 * ReportGenerator — แพตช์จัดกลุ่ม PDF เป็น 3 แผนก KP / LP / LL
 * ============================================================
 * แทนที่ฟังก์ชันเดิม 2 ตัวใน ReportGenerator.gs ด้วยเวอร์ชันนี้:
 *   - _addOTByTeam
 *   - _addEmployeeBreakdown
 * ใช้ dept3ForTeam_() จาก Employees.gs (ต้องติดตั้ง Employees.gs ก่อน)
 *
 * วิธีแก้: เปิด ReportGenerator.gs → หา 2 ฟังก์ชันนี้ → ลบตัวเดิม → วางตัวนี้แทน
 * (อย่าวางซ้ำ จะ error "ประกาศฟังก์ชันซ้ำ")
 */

var DEPT3_LABEL_ = {
  KP: '── KP — การโดยสาร ──',
  LP: '── LP — Porter / PVT ──',
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
