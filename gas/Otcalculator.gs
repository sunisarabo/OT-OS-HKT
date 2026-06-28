/**
 * OTCalculator.gs
 * คำนวณ OT 4 ประเภท แยกตามทีม จากข้อมูล Time Attendance
 *
 * ประเภท OT:
 *   1. ก่อนชิฟ  (BEFORE) — clock-in ก่อนเวลากะ ≥ threshold
 *   2. หลังชิฟ  (AFTER)  — clock-out หลังเวลากะ ≥ threshold
 *   3. วันหยุด  (DAYOFF) — มาทำงานวันที่ scheduled = OFF
 *   4. นักขัตฤกษ์ (PH)   — วันนั้นเป็น public holiday
 */

/**
 * คำนวณ OT จากข้อมูล attendance
 * @param {Array} attendance — output ของ readAttendance()
 * @returns {{
 *   total: {before, after, dayoff, ph, all},
 *   byTeam: { [teamCode]: {before, after, dayoff, ph, all, employees:Set} },
 *   byDate: { 'yyyy-MM-dd': {before, after, dayoff, ph, all} },
 *   topEarners: [ {empId, empName, team, before, after, dayoff, ph, all} ],
 *   raw: Array<{date, empId, empName, team, before, after, dayoff, ph}>
 * }}
 */
function calculateOT(attendance) {
  const cfg = getRuntimeConfig();
  const PH_SET = new Set(cfg.PUBLIC_HOLIDAYS);
  const thresholdMs = cfg.OT_MIN_THRESHOLD_MIN * 60 * 1000;

  const total  = { before: 0, after: 0, dayoff: 0, ph: 0, all: 0 };
  const byTeam = {};
  const byDate = {};
  const empMap = {}; // empId → aggregated

  attendance.forEach(function(row) {
    let before = 0, after = 0, dayoff = 0, ph = 0;

    // ─ Phase 2: pre-classified record (จาก RosterReader) ─
    if (row.otCategory !== undefined && row.otCategory !== null) {
      const hrs = row.otHrs || 0;
      if (hrs <= 0) return;
      if (row.otCategory === 'BEFORE')      before = hrs;
      else if (row.otCategory === 'AFTER')  after  = hrs;
      else if (row.otCategory === 'DAYOFF') dayoff = hrs;
      else if (row.otCategory === 'PH')     ph     = hrs;
      else return;
    }
    // ─ Phase 1: timeIn/timeOut format (เดิม) ─
    else if (row.timeIn && row.timeOut) {
      const dateStr = formatDate(row.date, 'yyyy-MM-dd');
      const isPH = PH_SET.has(dateStr);
      const shift = row.shift;
      const isDayOff = (shift === 'OFF' || shift === '' || shift === '-');
      const worked = (row.timeOut - row.timeIn) / 3600000;
      if (isPH) ph = worked;
      else if (isDayOff) dayoff = worked;
      else {
        const sched = _scheduledShiftRange(shift, row.date);
        if (sched) {
          const beforeMs = sched.start - row.timeIn;
          const afterMs  = row.timeOut - sched.end;
          if (beforeMs >= thresholdMs) before = beforeMs / 3600000;
          if (afterMs  >= thresholdMs) after  = afterMs  / 3600000;
        }
      }
    }
    else {
      return; // no usable data
    }

    const subTotal = before + after + dayoff + ph;
    if (subTotal === 0) return;
    const dateStr = formatDate(row.date, 'yyyy-MM-dd');

    // accumulate total
    total.before += before;
    total.after  += after;
    total.dayoff += dayoff;
    total.ph     += ph;
    total.all    += subTotal;

    // by team
    const team = row.team || 'UNKNOWN';
    if (!byTeam[team]) byTeam[team] = { before: 0, after: 0, dayoff: 0, ph: 0, all: 0, employees: {} };
    byTeam[team].before += before;
    byTeam[team].after  += after;
    byTeam[team].dayoff += dayoff;
    byTeam[team].ph     += ph;
    byTeam[team].all    += subTotal;
    if (row.empId) byTeam[team].employees[row.empId] = true;

    // by date
    if (!byDate[dateStr]) byDate[dateStr] = { before: 0, after: 0, dayoff: 0, ph: 0, all: 0 };
    byDate[dateStr].before += before;
    byDate[dateStr].after  += after;
    byDate[dateStr].dayoff += dayoff;
    byDate[dateStr].ph     += ph;
    byDate[dateStr].all    += subTotal;

    // per employee (สำหรับ top earners)
    const key = row.empId || row.empName;
    if (!empMap[key]) empMap[key] = {
      empId: row.empId, empName: row.empName, team: team,
      before: 0, after: 0, dayoff: 0, ph: 0, all: 0
    };
    empMap[key].before += before;
    empMap[key].after  += after;
    empMap[key].dayoff += dayoff;
    empMap[key].ph     += ph;
    empMap[key].all    += subTotal;
  });

  // top earners
  const topEarners = Object.keys(empMap).map(function(k){ return empMap[k]; })
    .sort(function(a, b){ return b.all - a.all; })
    .slice(0, 10);

  // convert employees obj → count
  Object.keys(byTeam).forEach(function(t){
    byTeam[t].employeeCount = Object.keys(byTeam[t].employees).length;
    delete byTeam[t].employees;
  });

  // ─── Weekly OT cap detection (กฎหมายแรงงาน ≤ 36 ชม./สัปดาห์) ──
  const overLimit = _detectWeeklyOverLimit(attendance, PH_SET, thresholdMs);

  return { total: total, byTeam: byTeam, byDate: byDate,
           topEarners: topEarners, overLimit: overLimit };
}

/**
 * ตรวจหาพนักงานที่ OT/สัปดาห์ > WEEKLY_OT_CAP_HOURS
 * จัดสัปดาห์ตาม ISO (จันทร์-อาทิตย์) — default WEEK_START_DAY = 1
 * @returns [{ empId, empName, team, weekStart, weekEnd, weekLabel, otHours, overBy }]
 */
function _detectWeeklyOverLimit(attendance, PH_SET, thresholdMs) {
  const cfg = getRuntimeConfig();
  const CAP = cfg.WEEKLY_OT_CAP_HOURS;
  // empId → weekKey → { hours, weekStart, name, team }
  const bucket = {};

  attendance.forEach(function(row) {
    let ot = 0;

    // Phase 2: pre-classified
    if (row.otCategory !== undefined && row.otCategory !== null) {
      ot = row.otHrs || 0;
    }
    // Phase 1: timeIn/timeOut
    else if (row.timeIn && row.timeOut) {
      const dateStr = formatDate(row.date, 'yyyy-MM-dd');
      const isPH = PH_SET.has(dateStr);
      const shift = row.shift;
      const isDayOff = (shift === 'OFF' || shift === '' || shift === '-');
      const worked = (row.timeOut - row.timeIn) / 3600000;
      if (isPH) ot = worked;
      else if (isDayOff) ot = worked;
      else {
        const sched = _scheduledShiftRange(shift, row.date);
        if (sched) {
          const beforeMs = sched.start - row.timeIn;
          const afterMs  = row.timeOut - sched.end;
          if (beforeMs >= thresholdMs) ot += beforeMs / 3600000;
          if (afterMs  >= thresholdMs) ot += afterMs  / 3600000;
        }
      }
    }
    if (ot <= 0) return;

    const ws = _weekStart(row.date);
    const weekKey = formatDate(ws, 'yyyy-MM-dd');
    const empKey = row.empId || row.empName;

    if (!bucket[empKey]) bucket[empKey] = {};
    if (!bucket[empKey][weekKey]) {
      bucket[empKey][weekKey] = {
        hours: 0, weekStart: ws,
        empId: row.empId, empName: row.empName, team: row.team || 'UNKNOWN'
      };
    }
    bucket[empKey][weekKey].hours += ot;
  });

  // collect over-limit entries
  const result = [];
  Object.keys(bucket).forEach(function(empKey) {
    Object.keys(bucket[empKey]).forEach(function(weekKey) {
      const w = bucket[empKey][weekKey];
      if (w.hours > CAP) {
        const we = new Date(w.weekStart.getTime() + 6 * 86400000);
        result.push({
          empId:     w.empId,
          empName:   w.empName,
          team:      w.team,
          weekStart: w.weekStart,
          weekEnd:   we,
          weekLabel: formatDate(w.weekStart, 'd MMM') + ' - ' + formatDate(we, 'd MMM yy'),
          otHours:   Math.round(w.hours * 10) / 10,
          overBy:    Math.round((w.hours - CAP) * 10) / 10
        });
      }
    });
  });

  // sort by most over-limit first
  result.sort(function(a, b){ return b.overBy - a.overBy; });
  return result;
}

/**
 * Return วันแรกของสัปดาห์ (ปกติ = วันจันทร์)
 */
function _weekStart(date) {
  const cfg = getRuntimeConfig();
  const start = cfg.WEEK_START_DAY;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = (dow - start + 7) % 7;
  return new Date(d.getTime() - diff * 86400000);
}

/**
 * Return { start: Date, end: Date } ของ scheduled shift
 * Night shift จะข้ามวัน
 */
function _scheduledShiftRange(shiftCode, date) {
  const cfg = getRuntimeConfig();
  const code = String(shiftCode || '').toUpperCase();
  const def = cfg.SHIFT_TIMES[code];
  if (!def) return null;

  const [sh, sm] = def.start.split(':').map(Number);
  const [eh, em] = def.end.split(':').map(Number);

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm, 0);
  let end     = new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em, 0);
  if (end <= start) end = new Date(end.getTime() + 24 * 3600000); // ข้ามวัน (Night shift)

  return { start: start, end: end };
}

/**
 * Format Date → string ตาม pattern (Apps Script Utilities)
 */
function formatDate(date, pattern) {
  const cfg = getRuntimeConfig();
  return Utilities.formatDate(date, cfg.TIMEZONE, pattern);
}