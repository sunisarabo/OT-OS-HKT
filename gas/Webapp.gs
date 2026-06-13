/**
 * WebApp.gs — Apps Script Web App handler
 *
 * Deploy steps:
 *   1. Editor → Deploy → New deployment
 *   2. Type: Web app
 *   3. Execute as: Me
 *   4. Who has access: ตามต้องการ (Anyone, Anyone with link, Domain only)
 *   5. Deploy → ได้ URL: https://script.google.com/macros/s/{ID}/exec
 *
 * URL parameters:
 *   ?period=daily              → เมื่อวาน
 *   ?period=daily&date=2026-05-25
 *   ?period=weekly             → 7 วันล่าสุด
 *   ?period=weekly&start=2026-05-19&end=2026-05-25
 *   ?period=monthly            → เดือนที่แล้ว
 *   ?period=monthly&month=2026-04
 *   ?period=range&start=...&end=...
 */

function doGet(e) {
  e = e || {};
  const params = e.parameter || {};
  if (params.view === 'employees') return renderEmployeeReportPage_();
  let period = params.period || 'daily';
  let startDate, endDate;

  // ─ Resolve date range from params ────────────────────────────
  if (period === 'daily') {
    const d = params.date ? _wa_parseDate(params.date) : _wa_yesterday();
    startDate = endDate = d;
  } else if (period === 'weekly') {
    if (params.start && params.end) {
      startDate = _wa_parseDate(params.start);
      endDate   = _wa_parseDate(params.end);
    } else if (params.end) {
      endDate = _wa_parseDate(params.end);
      startDate = new Date(endDate.getTime() - 6 * 86400000);
    } else {
      endDate = _wa_yesterday();
      startDate = new Date(endDate.getTime() - 6 * 86400000);
    }
  } else if (period === 'monthly') {
    if (params.month) {
      const m = params.month.match(/^(\d{4})-(\d{1,2})$/);
      if (m) {
        startDate = new Date(parseInt(m[1]), parseInt(m[2]) - 1, 1);
        endDate   = new Date(parseInt(m[1]), parseInt(m[2]),     0);
      }
    }
    if (!startDate) {
      const t = new Date();
      startDate = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      endDate   = new Date(t.getFullYear(), t.getMonth(),     0);
    }
  } else if (period === 'range' && params.start && params.end) {
    startDate = _wa_parseDate(params.start);
    endDate   = _wa_parseDate(params.end);
  } else {
    startDate = endDate = _wa_yesterday();
    period = 'daily';
  }

  // ─ Build dashboard ───────────────────────────────────────────
  try {
    const cfg = getRuntimeConfig();
    const payload = buildDashboardPayload(period, startDate, endDate);
    const innerHtml = _dashboardHTML(payload);

    // เพิ่ม period switcher UI ด้านบน + iframe-friendly wrapper
    const fullHtml = _wa_wrapWithSwitcher(innerHtml, period, startDate, endDate, cfg);

    return HtmlService.createHtmlOutput(fullHtml)
      .setTitle('OT Dashboard — ' + cfg.REPORT_DEPT_CODE)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>' +
      '<style>body{font-family:Sarabun,Tahoma,sans-serif;padding:30px;color:#1a1a1a}' +
      'h2{color:#d63a3a}pre{background:#f5f5f5;padding:14px;border-radius:6px;overflow:auto;font-size:12px}</style>' +
      '</head><body><h2>⚠ Dashboard Error</h2><pre>' +
      String(err.stack || err.message).replace(/[<>]/g, function(c){ return c==='<'?'&lt;':'&gt;'; }) +
      '</pre></body></html>'
    );
  }
}

/**
 * Wrap dashboard inside a control bar — period switcher + auto refresh
 */
function _wa_wrapWithSwitcher(innerHtml, period, startDate, endDate, cfg) {
  // ดึง body ออกจาก innerHtml เพื่อใส่ control bar ก่อน
  const bodyMatch = innerHtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
  const bodyContent = bodyMatch ? bodyMatch[1] : innerHtml;
  const headMatch = innerHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/);
  const headContent = headMatch ? headMatch[1] : '';

  const startISO = formatDate(startDate, 'yyyy-MM-dd');
  const endISO   = formatDate(endDate,   'yyyy-MM-dd');
  const baseUrl  = ScriptApp.getService().getUrl(); // current Web App URL

  return `<!DOCTYPE html>
<html lang="th">
<head>
${headContent}
<style>
  /* ── Loading overlay ─────────────────────────────────────── */
  #waLoading {
    position: fixed; inset: 0; background: rgba(255,255,255,0.97);
    z-index: 99999; display: flex; flex-direction: column;
    align-items: center; justify-content: center; font-family: 'Sarabun', sans-serif;
    transition: opacity 0.3s; }
  #waLoading.waHide { opacity: 0; pointer-events: none; }
  #waLoading .waSpinner {
    width: 56px; height: 56px; border: 6px solid #e0e6f0;
    border-top-color: #0a3d7a; border-radius: 50%;
    animation: waSpin 0.9s linear infinite; margin-bottom: 18px; }
  @keyframes waSpin { to { transform: rotate(360deg); } }
  #waLoading .waMsg { font-size: 18px; color: #0a3d7a; font-weight: 700; margin-bottom: 6px; }
  #waLoading .waSub { font-size: 13px; color: #666; max-width: 400px; text-align: center; }

  /* ── Control bar ─────────────────────────────────────────── */
  .wa-control { position: sticky; top: 0; z-index: 100; background: #0a3d7a; color: #fff;
    padding: 12px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex;
    gap: 10px; align-items: center; flex-wrap: wrap; font-family: 'Sarabun', sans-serif; }
  .wa-control label { font-size: 12px; font-weight: 600; }
  .wa-control select, .wa-control input { font-family: inherit; font-size: 13px;
    padding: 7px 10px; border: 1px solid rgba(255,255,255,0.4); border-radius: 5px;
    background: rgba(255,255,255,0.15); color: #fff; }
  .wa-control select option { color: #1a1a1a; }
  .wa-control button { background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.3);
    padding: 7px 12px; border-radius: 5px; cursor: pointer; font-family: inherit;
    font-size: 12px; font-weight: 600; transition: all 0.15s; }
  .wa-control button:hover { background: rgba(255,255,255,0.25); }
  .wa-control .title { font-size: 14px; font-weight: 700; margin-right: 14px; }

  /* ── Primary "ดึงข้อมูล" button — ใหญ่ + ส้ม + pulse ─────── */
  #waApplyBtn {
    background: linear-gradient(135deg, #f29200, #ff7d00) !important;
    color: #fff !important; border: none !important;
    padding: 11px 22px !important; font-size: 14px !important;
    font-weight: 700 !important; box-shadow: 0 3px 10px rgba(242,146,0,0.4);
    border-radius: 6px !important; }
  #waApplyBtn:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(242,146,0,0.55); }
  #waApplyBtn.waNeedsApply {
    animation: waPulse 1.2s ease-in-out infinite; }
  @keyframes waPulse {
    0%, 100% { box-shadow: 0 3px 10px rgba(242,146,0,0.4); transform: scale(1); }
    50%       { box-shadow: 0 6px 20px rgba(242,146,0,0.85); transform: scale(1.05); }
  }

  .wa-hint { font-size: 11px; color: rgba(255,255,255,0.65); font-style: italic;
    margin-left: 4px; display: none; }
  .wa-hint.show { display: inline; color: #ffd07a; }

  body { padding-top: 0 !important; }
</style>
</head>
<body>

<!-- Loading overlay — แสดงทุกครั้งที่ navigate -->
<div id="waLoading">
  <div class="waSpinner"></div>
  <div class="waMsg">⏳ กำลังโหลดข้อมูล...</div>
  <div class="waSub">กำลังดึงจาก PSA Daily Assignment + LL Monthly · อาจใช้เวลา 10-30 วินาที</div>
</div>

<div class="wa-control">
  <span class="title">📊 OT Dashboard — ${cfg.REPORT_DEPT_CODE}</span>
  <label>ช่วง:</label>
  <select id="waPeriod" onchange="waPeriodChange()">
    <option value="daily"   ${period==='daily'?'selected':''}>รายวัน</option>
    <option value="weekly"  ${period==='weekly'?'selected':''}>รายสัปดาห์</option>
    <option value="monthly" ${period==='monthly'?'selected':''}>รายเดือน</option>
    <option value="range"   ${period==='range'?'selected':''}>กำหนดเอง</option>
  </select>
  <label>จาก:</label>
  <input type="date" id="waStart" value="${startISO}">
  <label id="waEndLabel">ถึง:</label>
  <input type="date" id="waEnd"   value="${endISO}">

  <button id="waApplyBtn" onclick="waApply()">📥 ดึงข้อมูล</button>
  <span id="waHint" class="wa-hint">← กดปุ่มนี้เพื่อโหลดข้อมูลตามที่เลือก</span>

  <span style="margin:0 6px;opacity:0.4;">|</span>
  <button onclick="waToday()">วันนี้</button>
  <button onclick="waQuick(1)">เมื่อวาน</button>
  <button onclick="waQuick(3)">3 วัน</button>
  <button onclick="waQuick(7)">7 วัน</button>
  <button onclick="waThisWeek()">สัปดาห์นี้</button>
  <button onclick="waLastWeek()">สัปดาห์ที่แล้ว</button>
  <button onclick="waThisMonth()">เดือนนี้</button>
  <button onclick="waLastMonth()">เดือนที่แล้ว</button>
  <button onclick="window.print()" title="พิมพ์">🖨</button>

  <!-- Thai year display -->
  <div style="width:100%;margin-top:6px;font-size:11px;color:rgba(255,255,255,0.8);">
    <span id="waThaiRange">—</span>
  </div>
</div>

${bodyContent}

<script>
  const WA_BASE = ${JSON.stringify(baseUrl)};

  function waShowLoading() {
    const el = document.getElementById('waLoading');
    if (el) { el.classList.remove('waHide'); el.style.display = 'flex'; }
  }
  function waHideLoading() {
    const el = document.getElementById('waLoading');
    if (el) el.classList.add('waHide');
  }

  function waApply() {
    const period = document.getElementById('waPeriod').value;
    const start  = document.getElementById('waStart').value;
    const end    = document.getElementById('waEnd').value;
    if (!start) { alert('กรุณาเลือกวันที่เริ่มต้น'); return; }

    let url = WA_BASE + '?period=' + period;
    if (period === 'daily') {
      url += '&date=' + start;
    } else if (period === 'monthly') {
      url += '&month=' + start.slice(0,7);
    } else {
      const e = end || start;
      if (new Date(e) < new Date(start)) {
        alert('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น');
        return;
      }
      url += '&start=' + start + '&end=' + e;
    }

    // Show loading overlay + navigate
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  function waQuick(days) {
    const end = new Date(); end.setDate(end.getDate() - 1);
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const fmt = function(d){ return d.toISOString().slice(0,10); };
    const period = (days === 1) ? 'daily' : 'weekly';
    let url = WA_BASE + '?period=' + period;
    if (days === 1) url += '&date=' + fmt(end);
    else            url += '&start=' + fmt(start) + '&end=' + fmt(end);
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  // วันนี้ (today's PSA file)
  function waToday() {
    const t = new Date();
    const fmt = function(d){ return d.toISOString().slice(0,10); };
    const url = WA_BASE + '?period=daily&date=' + fmt(t);
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  function waFmtDate(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // สัปดาห์นี้ (จันทร์-อาทิตย์ ที่อยู่ในสัปดาห์ปัจจุบัน)
  function waThisWeek() {
    const t = new Date();
    const dow = t.getDay(); // 0=Sun
    const monOffset = (dow === 0 ? -6 : 1 - dow);
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() + monOffset);
    const sun = new Date(mon.getTime() + 6 * 86400000);
    const url = WA_BASE + '?period=weekly&start=' + waFmtDate(mon) + '&end=' + waFmtDate(sun);
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  function waLastWeek() {
    const t = new Date();
    const dow = t.getDay();
    const monOffset = (dow === 0 ? -6 : 1 - dow);
    const thisMon = new Date(t.getFullYear(), t.getMonth(), t.getDate() + monOffset);
    const lastMon = new Date(thisMon.getTime() - 7 * 86400000);
    const lastSun = new Date(lastMon.getTime() + 6 * 86400000);
    const url = WA_BASE + '?period=weekly&start=' + waFmtDate(lastMon) + '&end=' + waFmtDate(lastSun);
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  function waThisMonth() {
    const t = new Date();
    const url = WA_BASE + '?period=monthly&month=' +
                t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  function waLastMonth() {
    const t = new Date();
    const last = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const url = WA_BASE + '?period=monthly&month=' +
                last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0');
    waShowLoading();
    setTimeout(function(){ window.top.location.href = url; }, 50);
  }

  // Thai date with พ.ศ. year
  function waThaiDate(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + ((d.getFullYear() + 543) % 100);
  }

  function waUpdateThaiRange() {
    const period = document.getElementById('waPeriod').value;
    const start  = document.getElementById('waStart').value;
    const end    = document.getElementById('waEnd').value;
    const el = document.getElementById('waThaiRange');
    if (!el || !start) return;
    if (period === 'daily') {
      el.textContent = '📅 ' + waThaiDate(start);
    } else if (period === 'monthly') {
      const d = new Date(start);
      const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                      'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
      el.textContent = '📅 ' + months[d.getMonth()] + ' ' + ((d.getFullYear() + 543) % 100);
    } else {
      el.textContent = '📅 ' + waThaiDate(start) + ' – ' + waThaiDate(end || start);
    }
  }

  // Pulse "ดึงข้อมูล" button when user changes any input
  function waMarkDirty() {
    document.getElementById('waApplyBtn').classList.add('waNeedsApply');
    document.getElementById('waHint').classList.add('show');
  }

  // เปลี่ยน period → auto-adjust วันที่ (start+end เห็นเสมอ)
  function waPeriodChange() {
    const period  = document.getElementById('waPeriod').value;
    const startEl = document.getElementById('waStart');
    const endEl   = document.getElementById('waEnd');
    const endLabel = document.getElementById('waEndLabel');
    // Always visible — เลือกได้ทั้งสองช่องตลอดเวลา
    endEl.style.display = '';
    endLabel.style.display = '';

    if (period === 'daily') {
      // sync end = start
      endEl.value = startEl.value;
    } else if (period === 'monthly') {
      const d = new Date(startEl.value || new Date());
      d.setDate(1);
      startEl.value = d.toISOString().slice(0,10);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      endEl.value = lastDay.toISOString().slice(0,10);
    } else if (period === 'weekly') {
      const sd = new Date(startEl.value);
      if (!isNaN(sd.getTime())) {
        const ed = new Date(sd.getTime() + 6 * 86400000);
        endEl.value = ed.toISOString().slice(0,10);
      }
    }
    // 'range' (กำหนดเอง) — ให้ user เลือกเอง ไม่ปรับ
    waUpdateThaiRange();
  }

  // เปลี่ยน start วันที่ → ถ้าเป็น weekly auto-set end = start+6
  document.getElementById('waStart').addEventListener('change', function() {
    if (document.getElementById('waPeriod').value === 'weekly') {
      const sd = new Date(this.value);
      if (!isNaN(sd.getTime())) {
        const ed = new Date(sd.getTime() + 6 * 86400000);
        document.getElementById('waEnd').value = ed.toISOString().slice(0,10);
      }
    }
    waMarkDirty();
  });

  // Mark dirty when other inputs change → highlight "ดึงข้อมูล" button
  document.getElementById('waPeriod').addEventListener('change', function(){ waMarkDirty(); waUpdateThaiRange(); });
  document.getElementById('waEnd').addEventListener('change', function(){ waMarkDirty(); waUpdateThaiRange(); });
  document.getElementById('waStart').addEventListener('input', waUpdateThaiRange);
  document.getElementById('waEnd').addEventListener('input', waUpdateThaiRange);

  // Enter key on date input → trigger apply
  ['waStart','waEnd'].forEach(function(id){
    document.getElementById(id).addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); waApply(); }
    });
  });

  // Initial: ซ่อน "To" ถ้าเป็น daily/monthly + ซ่อน loading overlay
  waPeriodChange();
  waUpdateThaiRange();
  window.addEventListener('load', function() {
    setTimeout(waHideLoading, 100);
  });
  // Safety: hide overlay หลัง 30 วินาที แม้ load event ไม่ trigger
  setTimeout(waHideLoading, 30000);
</script>
</body>
</html>`;
}

// ─── Helpers ────────────────────────────────────────────────────
function _wa_yesterday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
}

function _wa_parseDate(s) {
  if (!s) return _wa_yesterday();
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return _wa_yesterday();
  const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  return isNaN(d.getTime()) ? _wa_yesterday() : d;
}

/**
 * Helper สำหรับ print URL ของ Web App หลัง deploy
 * รัน manually ใน editor → ดู URL ใน Logs
 */
function getWebAppUrl() {
  try {
    const url = ScriptApp.getService().getUrl();
    Logger.log('Web App URL: ' + url);
    Logger.log('Examples:');
    Logger.log('  Daily:   ' + url + '?period=daily');
    Logger.log('  Weekly:  ' + url + '?period=weekly');
    Logger.log('  Monthly: ' + url + '?period=monthly');
    Logger.log('  Custom:  ' + url + '?period=range&start=2026-05-01&end=2026-05-25');
    const ui = _safeUi && _safeUi();
    if (ui) ui.alert('Web App URL', url, ui.ButtonSet.OK);
    return url;
  } catch (e) {
    Logger.log('ยังไม่ได้ deploy เป็น Web App — ไป Editor → Deploy → New deployment → Web app');
    return null;
  }
}