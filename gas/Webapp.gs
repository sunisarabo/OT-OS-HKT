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
  // เปิด /exec เปล่า ๆ → หน้ารายชื่อ (เร็ว เพราะอ่าน cache) แทน Dashboard (ที่อ่าน roster สด ช้า)
  if (!params.period && !params.date && !params.start && !params.end && !params.month) return renderEmployeeReportPage_();
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
  .wa-control .wa-tab.on { background:#fff !important; color:#0a3d7a !important; }

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
  <img src="data:image/png;base64,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" alt="AOTGA" style="height:30px;background:#fff;border-radius:4px;padding:2px 6px;margin-right:10px;vertical-align:middle"><span class="title">📊 OT Dashboard — ${cfg.REPORT_DEPT_CODE}</span>
  <button id="waTabDash" class="wa-tab on" onclick="waShowDash()">📊 ภาพรวม</button>
  <button id="waTabEmp" class="wa-tab" onclick="waShowEmp()">👥 รายชื่อพนักงาน</button>
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

<div id="waDashView">
${bodyContent}
</div>
<iframe id="waEmpView" src="" style="display:none;width:100%;height:calc(100vh - 58px);border:0"></iframe>

<script>
  const WA_BASE = ${JSON.stringify(baseUrl)};
  function waShowEmp(){
    var f=document.getElementById('waEmpView');
    if(!f.getAttribute('src')) f.setAttribute('src', WA_BASE + '?view=employees');
    f.style.display='block';
    document.getElementById('waDashView').style.display='none';
    document.getElementById('waTabEmp').classList.add('on');
    document.getElementById('waTabDash').classList.remove('on');
  }
  function waShowDash(){
    document.getElementById('waEmpView').style.display='none';
    document.getElementById('waDashView').style.display='block';
    document.getElementById('waTabDash').classList.add('on');
    document.getElementById('waTabEmp').classList.remove('on');
  }

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