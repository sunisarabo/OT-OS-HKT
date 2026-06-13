/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RosterReader.gs (Phase 2)
 * ════════════════════════════════════════════════════════════════════════════
 *  อ่านข้อมูลจาก:
 *    1. PSA Daily Assignment files (folder → year → month → DDMMM file → per-team sheets)
 *    2. LL Monthly file (daily tabs DDMMM)
 *
 *  Output: array ของ records พร้อม pre-classified OT
 *    { date, empId, empName, team, dept, otHrs, otCategory, status }
 *      otCategory: 'BEFORE' | 'AFTER' | 'DAYOFF' | 'PH' | null
 *      status: 'WORKING' | 'OFF' | 'SICK' | 'VAC'
 *
 *  รวม fixes จาก SmartShiftBot_OT_Fixes (Bug #1-4):
 *    - Date object handling
 *    - Single-digit hour ("8-12")
 *    - "HH:MM-HH:MM" format
 *    - Night shift OT classification (22-06 + OT 06-09 → AFTER, not BEFORE)
 * ════════════════════════════════════════════════════════════════════════════
 */

var MONTH_ABB = ['', 'JAN','FEB','MAR','APR','MAY','JUN',
                     'JUL','AUG','SEP','OCT','NOV','DEC'];

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════
/**
 * อ่าน roster records ในช่วงวันที่ — รวม PSA + LL
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array<Record>}
 */
function readRosterAttendance(startDate, endDate) {
  const cfg = getRuntimeConfig();
  const PH = new Set(cfg.PUBLIC_HOLIDAYS);

  const start = stripTime(startDate);
  const end   = stripTime(endDate);
  const records = [];

  // Track files found per day (สำคัญสำหรับ debug + dashboard status)
  const filesFound = []; // [{date, psaFile, llTab, psaRecords, llRecords}]

  let cur = new Date(start);
  while (cur <= end) {
    const dayStatus = {
      date: formatDate(cur, 'yyyy-MM-dd'),
      dateLabel: formatDate(cur, 'd MMM'),
      psaFile: null,
      llTab: null,
      psaRecords: 0,
      llRecords: 0
    };

    // PSA
    try {
      const psaFile = _findPSADailyFile(cur, cfg);
      if (psaFile) {
        dayStatus.psaFile = psaFile.getName();
        const psa = readPSADailyForDate(cur, cfg);
        dayStatus.psaRecords = psa.length;
        psa.forEach(function(r){ records.push(r); });
      }
    } catch (e) {
      Logger.log('PSA ' + dayStatus.date + ': ' + e.message);
    }
    // LL
    try {
      const ll = readLLDailyForDate(cur, cfg);
      if (ll.length > 0) {
        dayStatus.llTab = formatDate(cur, 'ddMMM').toUpperCase();
        dayStatus.llRecords = ll.length;
        ll.forEach(function(r){ records.push(r); });
      }
    } catch (e) {
      Logger.log('LL ' + dayStatus.date + ': ' + e.message);
    }
    filesFound.push(dayStatus);
    cur = new Date(cur.getTime() + 86400000);
  }

  // Master lookup — fill in empId/team for records ที่ไม่มี
  const master = getMasterEmployees();

  records.forEach(function(r) {
    // Resolve missing empId/team via master name lookup
    if (!r.empId && r.empName) {
      const fnUp = r.empName.split(/\s+/)[0].toUpperCase();
      const emp = master.byFirstName[fnUp];
      if (emp) {
        r.empId = emp.empId;
        // ถ้า team ของ record ว่าง หรือ generic เกินไป → ใช้ของ master
        if (!r.team || r.team === 'UNKNOWN') r.team = emp.teamCode || r.team;
      }
    }

    // Classify OT (CrewSign บางตัว pre-classified แล้วผ่าน _otCategoryHint)
    const cls = _classifyRecord(r, PH);
    r.otHrs      = cls.otHrs;
    r.otCategory = r._otCategoryHint || cls.otCategory;
    r.status     = cls.status;
    delete r._otCategoryHint;
  });

  // Attach status (non-iterable property)
  records._filesFound = filesFound;
  records._stats = {
    daysScanned: filesFound.length,
    daysWithPSA: filesFound.filter(function(f){ return f.psaFile;}).length,
    daysWithLL:  filesFound.filter(function(f){ return f.llTab; }).length,
    daysMissing: filesFound.filter(function(f){ return !f.psaFile && !f.llTab;}).length
  };

  Logger.log('readRosterAttendance: ' + records.length + ' records, ' +
             records.filter(function(r){return r.otHrs > 0;}).length + ' with OT, ' +
             records._stats.daysWithPSA + '/' + records._stats.daysScanned + ' days have PSA file');
  return records;
}

// ════════════════════════════════════════════════════════════════
// PSA DAILY FILE
// ════════════════════════════════════════════════════════════════
function readPSADailyForDate(date, cfg) {
  cfg = cfg || getRuntimeConfig();
  const file = _findPSADailyFile(date, cfg);
  if (!file) return [];

  const ss = SpreadsheetApp.openById(file.getId());
  const records = [];
  const skipSet = new Set((cfg.PSA_SKIP_SHEETS || []).map(function(s){return s.toUpperCase();}));

  // ─ Group sheets by team — ถ้ามี REV variant ให้ใช้ตัว REV ล่าสุด ───
  const allSheets = ss.getSheets();
  const sheetsByTeam = {};     // teamCode → [{sheet, name, revOrder}]
  const noTeamSheets = [];     // sheets ที่ไม่ map กับทีม (still process)

  allSheets.forEach(function(sh) {
    const name = sh.getName().trim();
    const nameUp = name.toUpperCase();
    if (skipSet.has(nameUp)) return;
    if (skipSet.has(nameUp.replace(/\s+/g, ' '))) return;

    // Skip ShiftDB/Code/Master patterns ที่อาจไม่อยู่ใน config skip
    if (/^(SHIFT\s*DB|CODE|MASTER\s*SMART|MANPOWER)$/i.test(name)) return;

    const teamCode = _inferTeamFromSheetName(name);
    const revOrder = _extractRevOrder(name);

    if (teamCode) {
      if (!sheetsByTeam[teamCode]) sheetsByTeam[teamCode] = [];
      sheetsByTeam[teamCode].push({ sheet: sh, name: name, revOrder: revOrder });
    } else {
      noTeamSheets.push({ sheet: sh, name: name });
    }
  });

  // ─ เลือกแผ่นที่ดีที่สุดต่อทีม — REV สูงสุดชนะ ─
  const sheetsToProcess = [];
  Object.keys(sheetsByTeam).forEach(function(team) {
    const candidates = sheetsByTeam[team];
    // Sort by revOrder DESC (REV 1 > REV 0 > no REV [-1])
    candidates.sort(function(a, b) { return b.revOrder - a.revOrder; });
    const winner = candidates[0];
    sheetsToProcess.push(winner.sheet);
    if (candidates.length > 1) {
      const skipped = candidates.slice(1).map(function(c){ return '"'+c.name+'"';}).join(', ');
      Logger.log('  📋 Team ' + team + ': ใช้ "' + winner.name + '" (skip ' + skipped + ')');
    }
  });

  // ─ Add non-team sheets (PVT, etc. ถ้ามี) ─
  noTeamSheets.forEach(function(item) { sheetsToProcess.push(item.sheet); });

  // ─ Process selected sheets ─
  sheetsToProcess.forEach(function(sh) {
    try {
      _extractRecordsFromPSASheet(sh, date, records);
    } catch (e) {
      Logger.log('  ⚠ PSA "' + sh.getName() + '": ' + e.message);
    }
  });

  return records;
}

/**
 * แยก REV order จากชื่อ sheet
 *   "EK"            → -1 (no REV)
 *   "EK REV"        → 0  (no number = REV 0)
 *   "EK REV 01"     → 1
 *   "CHN REV1"      → 1
 *   "EK REV 02"     → 2
 */
function _extractRevOrder(name) {
  const up = String(name).toUpperCase();
  if (up.indexOf('REV') === -1) return -1;
  const m = up.match(/REV\.?\s*0?(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * อ่าน flight count จาก PSA daily files
 * Flight numbers อยู่ใน row 3 cols I+ (รูปแบบ "SQ726/725" = 2 flights)
 * Cancelled flights detect จากแถวถัดไป (XX, CNL marker)
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {{ total, operating, cancelled, byAirline, byType, byTeam }}
 */
function readPSAFlights(startDate, endDate) {
  const cfg = getRuntimeConfig();
  const start = stripTime(startDate);
  const end   = stripTime(endDate);
  const cancelKw = (cfg.CANCELLED_FLIGHT_KEYWORDS || ['CNL','CANCELLED']).map(function(k){return k.toUpperCase();});

  let total = 0, operating = 0, cancelled = 0;
  const byAirline = {};
  const byType    = { DEP: 0, ARR: 0, OTHER: 0 };
  const byTeam    = {};

  let cur = new Date(start);
  while (cur <= end) {
    try {
      const file = _findPSADailyFile(cur, cfg);
      if (file) {
        const ss = SpreadsheetApp.openById(file.getId());
        const skipSet = new Set((cfg.PSA_SKIP_SHEETS || []).map(function(s){return s.toUpperCase();}));

        // Same REV-preference grouping
        const grouped = {};
        ss.getSheets().forEach(function(sh) {
          const name = sh.getName().trim();
          const nameUp = name.toUpperCase();
          if (skipSet.has(nameUp)) return;
          if (/^(SHIFT\s*DB|CODE|MASTER\s*SMART|MANPOWER)$/i.test(name)) return;
          const teamCode = _inferTeamFromSheetName(name);
          if (!teamCode) return;
          if (!grouped[teamCode]) grouped[teamCode] = [];
          grouped[teamCode].push({ sheet: sh, name: name, revOrder: _extractRevOrder(name) });
        });
        Object.keys(grouped).forEach(function(team) {
          grouped[team].sort(function(a, b){ return b.revOrder - a.revOrder; });
          const sh = grouped[team][0].sheet;
          _extractFlightsFromSheet(sh, team, cancelKw,
            function(flight, isCancelled, type, airline) {
              total++;
              if (isCancelled) { cancelled++; return; }
              operating++;
              byAirline[airline] = (byAirline[airline] || 0) + 1;
              if (type === 'DEP') byType.DEP++;
              else if (type === 'ARR') byType.ARR++;
              else byType.OTHER++;
              if (team) byTeam[team] = (byTeam[team] || 0) + 1;
            });
        });
      }
    } catch (e) {
      Logger.log('readPSAFlights ' + formatDate(cur, 'yyyy-MM-dd') + ': ' + e.message);
    }
    cur = new Date(cur.getTime() + 86400000);
  }

  return { total: total, operating: operating, cancelled: cancelled,
           byAirline: byAirline, byType: byType, byTeam: byTeam };
}

/**
 * Extract flights from one per-team sheet
 * Pattern (verified from real files):
 *   Row 3 cols I+: flight numbers "SQ726/725", "EY410/411", "FY3600/FY3601"
 *   "/" = pair of inbound+outbound → count as 2 flights
 *   "REMARK" / "#REF!" / blank → end of flight section
 *   ARR/DEP type inferred from STA/STD row (row 4 typically) — "A" prefix = arrival, "D" prefix = departure
 */
function _extractFlightsFromSheet(sheet, teamCode, cancelKw, onFlight) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 3) return;

  // หาแถวที่มี flight numbers — สแกน row 2-4
  let flightRow = -1;
  for (let r = 1; r <= Math.min(4, rows.length - 1); r++) {
    let count = 0;
    for (let c = 8; c < rows[r].length; c++) {
      const v = String(rows[r][c] || '').trim();
      if (_looksLikeFlight(v)) count++;
    }
    if (count >= 2) { flightRow = r; break; }
  }
  if (flightRow < 0) return;

  // หา STA/STD row (อยู่ใต้ flightRow 1-3 แถว)
  let staStdRow = -1;
  for (let r = flightRow + 1; r < Math.min(flightRow + 5, rows.length); r++) {
    const firstCell = String(rows[r][7] || '').toUpperCase();
    if (firstCell.indexOf('STA') !== -1 || firstCell.indexOf('STD') !== -1) {
      staStdRow = r; break;
    }
  }

  // หา CNL marker row (next row หลัง STA/STD หรือใต้ flightRow)
  let cnlRow = -1;
  for (let r = flightRow + 1; r < Math.min(flightRow + 10, rows.length); r++) {
    for (let c = 8; c < rows[r].length; c++) {
      const v = String(rows[r][c] || '').trim().toUpperCase();
      if (cancelKw.some(function(k){ return v === k || v.indexOf(k) >= 0; })) {
        cnlRow = r; r = rows.length; break;
      }
    }
  }

  // Scan row 3 cols I+ for flight numbers
  for (let c = 8; c < rows[flightRow].length; c++) {
    const v = String(rows[flightRow][c] || '').trim();
    if (!v || !_looksLikeFlight(v)) continue;
    if (/REMARK|#REF/i.test(v)) break;

    // Detect airline prefix (first 2-3 letters)
    const airlineMatch = v.match(/^([A-Z]{2,3})/i);
    const airline = airlineMatch ? airlineMatch[1].toUpperCase() : 'OTHER';

    // "SQ726/725" → first = ARR pair, second = DEP (or vice versa)
    // Count as 2 flights
    const parts = v.split('/').filter(function(p){ return p.trim().length > 0; });
    const flightCount = Math.max(1, parts.length);

    // Check cancelled
    let isCancelled = false;
    if (cnlRow >= 0) {
      const cnlVal = String(rows[cnlRow][c] || '').trim().toUpperCase();
      if (cancelKw.some(function(k){ return cnlVal.indexOf(k) >= 0; })) isCancelled = true;
    }

    // Type: 2 flights = 1 ARR + 1 DEP (typical)
    for (let i = 0; i < flightCount; i++) {
      const type = (i === 0) ? 'ARR' : 'DEP';
      onFlight(parts[i] || v, isCancelled, type, airline);
    }
  }
}

function _looksLikeFlight(v) {
  if (!v) return false;
  const s = String(v).trim().toUpperCase();
  if (s.length < 3) return false;
  if (/REMARK|#REF|^FLIGHT$/.test(s)) return false;
  // Pattern: 2-3 letter airline + digits, optionally /more
  return /^[A-Z0-9]{2,4}\d{2,5}(\/[A-Z0-9]*\d+)?$/.test(s) ||
         /^[A-Z]{2,3}\d{2,5}/.test(s);
}

function _findPSADailyFile(date, cfg) {
  // ─ ใช้ cache (ลด Drive folder drilling) ──────────────────────
  const cacheKey = 'psa_file_' + formatDate(date, 'yyyyMMdd');
  const cache = _safeCache();
  if (cache) {
    const cachedId = cache.get(cacheKey);
    if (cachedId === '__MISS__') return null; // เคย scan แล้วไม่เจอ
    if (cachedId) {
      try { return DriveApp.getFileById(cachedId); }
      catch (e) { /* file gone, refresh */ }
    }
  }

  // Cold path — drill folders
  const folder = DriveApp.getFolderById(cfg.PSA_ROSTER_FOLDER_ID);
  const yearSub = _getSubFolderByName(folder, String(date.getFullYear()));
  const workFolder = yearSub || folder;
  const monthFolder = _findMonthFolder(workFolder, date);
  if (!monthFolder) {
    if (cache) try { cache.put(cacheKey, '__MISS__', 3600); } catch (e) {}
    return null;
  }
  const file = _findDayFile(monthFolder, date);
  if (cache) {
    try { cache.put(cacheKey, file ? file.getId() : '__MISS__', 21600); /* 6h */ }
    catch (e) {}
  }
  return file;
}

function _safeCache() {
  try { return CacheService.getScriptCache(); }
  catch (e) { return null; }
}

/**
 * ลบ cache (เรียกเมื่อมี roster files ใหม่ → ต้อง re-scan)
 * เรียกผ่าน menu หรือ runManual
 */
function clearRosterCache() {
  const cache = _safeCache();
  if (!cache) { Logger.log('CacheService unavailable'); return; }
  // Cache ไม่มี API list keys — เลย clear ทั้งหมดผ่าน removeAll
  // เก็บ keys ใน Properties Service เพื่อ track (optional)
  // วิธีง่าย: ลบ key ในช่วง 30 วันล่าสุด
  const today = new Date();
  const keys = [];
  for (let i = -7; i < 60; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    keys.push('psa_file_' + formatDate(d, 'yyyyMMdd'));
  }
  cache.removeAll(keys);
  Logger.log('Cleared ' + keys.length + ' PSA file cache entries');
}

function _getSubFolderByName(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

function _findMonthFolder(parent, date) {
  const mIdx = date.getMonth();
  const shortM = MONTH_ABB[mIdx + 1];
  const yr2 = String(date.getFullYear()).slice(2);
  const mm = (mIdx + 1 < 10 ? '0' : '') + (mIdx + 1);
  const patterns = [
    new RegExp('^' + mm + '\\.?\\s*' + shortM + yr2 + '$', 'i'),
    new RegExp('^' + shortM + '\\s*' + yr2 + '$', 'i'),
    new RegExp('^' + shortM + '\\s*' + date.getFullYear() + '$', 'i'),
    new RegExp(shortM, 'i')
  ];
  const it = parent.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const nm = f.getName();
    for (let p = 0; p < patterns.length; p++) {
      if (patterns[p].test(nm)) return f;
    }
  }
  return null;
}

function _findDayFile(folder, date) {
  const d = date.getDate();
  const dPad = (d < 10 ? '0' : '') + d;
  const shortM = MONTH_ABB[date.getMonth() + 1];
  const yr2 = String(date.getFullYear()).slice(2);
  const patterns = [
    new RegExp('^' + dPad + shortM + yr2 + '(\\.|$)', 'i'),
    new RegExp('^' + dPad + shortM + '(\\.|$)', 'i'),
    new RegExp('^' + d + shortM + yr2 + '(\\.|$)', 'i'),
    new RegExp('^' + d + shortM + '(\\.|$)', 'i')
  ];
  const mimes = [
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  let best = null;
  for (let m = 0; m < mimes.length; m++) {
    const it = folder.getFilesByType(mimes[m]);
    while (it.hasNext()) {
      const f = it.next();
      const nm = f.getName();
      for (let p = 0; p < patterns.length; p++) {
        if (patterns[p].test(nm)) {
          if (!best || p < best.priority) best = { file: f, priority: p };
        }
      }
    }
  }
  return best ? best.file : null;
}

function _extractRecordsFromPSASheet(sheet, date, out) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return;

  const team = _inferTeamFromSheetName(sheet.getName());
  const sheetNameUp = sheet.getName().toUpperCase();

  // Pass −1: PORTER CREW SIGN (special compound shift+OT string in col A)
  if (/CREW\s*SIGN|CREWSIGN/.test(sheetNameUp)) {
    _extractCrewsignRecords(rows, team, date, out);
    return;
  }

  // Pass 0: REV01 format (EK REV 01 / TR REV 01 / CHN REV1 etc.)
  const revDet = _detectRevFormat(rows);
  if (revDet) {
    for (let r = revDet.startRow; r < rows.length; r++) {
      _extractRevRow(rows[r], revDet, team, date, out);
    }
    return;
  }

  // Pass 1: ID-based detection
  const det = _detectColsPSA(rows) || _detectColsByDataScan(rows);
  const seenIds = {};
  if (det && det.id >= 0) {
    for (let r = det.startRow; r < rows.length; r++) {
      const row = rows[r];
      const idRaw = row[det.id];
      if (idRaw === null || idRaw === undefined || idRaw === '') continue;
      const digits = String(idRaw).replace(/\.0*$/, '').replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 8) continue;
      if (seenIds[digits]) continue;
      seenIds[digits] = true;

      const empName = det.name >= 0 ? String(row[det.name] || '').trim() : '';
      out.push({
        date: stripTime(date),
        empId: digits,
        empName: empName,
        team: team || '',
        dept: 'PSA',
        shift: _normalizeShift(row[det.time]),
        ot:    _normalizeText(det.ot >= 0 ? row[det.ot] : ''),
        remark: _normalizeText(det.remark >= 0 ? row[det.remark] : '')
      });
    }
  }

  // Pass 2: Name-based (PORTER/CREWSIGN/ADMIN — sheets without IDs)
  const nameDet = _detectColsByName(rows);
  if (nameDet) {
    const seenNames = {};
    for (let r = nameDet.startRow; r < rows.length; r++) {
      const row = rows[r];
      _extractNameRow(row, nameDet, team, date, out, seenNames);
      if (nameDet.name2 >= 0) {
        _extractNameRow(row, {
          name: nameDet.name2, time: nameDet.time2,
          ot: nameDet.ot2, remark: nameDet.remark2
        }, team, date, out, seenNames);
      }
    }
  }
}

function _extractNameRow(row, det, team, date, out, seenNames) {
  if (det.name < 0 || det.time < 0) return;
  const nameRaw = String(row[det.name] || '').trim();
  if (!nameRaw || nameRaw.length < 2) return;
  // skip if looks like ID
  if (/^\d{6,8}$/.test(nameRaw.replace(/\.0*$/, '').replace(/\D/g, ''))) return;
  const fn = nameRaw.split(/\s+/)[0].toUpperCase();
  const skipFn = { NAME:1, STAFF:1, TRAINEE:1, TOTAL:1, NO:1, 'NO.':1,
                   POSITION:1, POS:1, 'POS.':1, SCHEDULE:1, SCHED:1,
                   SHIFT:1, TIME:1, OT:1, REMARK:1 };
  if (skipFn[fn]) return;
  const key = fn;
  if (seenNames[key]) return;
  seenNames[key] = true;

  out.push({
    date: stripTime(date),
    empId: '',
    empName: nameRaw,
    team: team || '',
    dept: 'PSA',
    shift: _normalizeShift(row[det.time]),
    ot:    _normalizeText(det.ot >= 0 ? row[det.ot] : ''),
    remark: _normalizeText(det.remark >= 0 ? row[det.remark] : '')
  });
}

/**
 * เดาทีมจากชื่อ sheet — รองรับ REV suffix และ alias เช่น WYWK, CHN
 */
function _inferTeamFromSheetName(sheetName) {
  // Strip REV suffix ก่อน match
  let stripped = sheetName.trim().toUpperCase()
    .replace(/\s*REV\s*\.?\s*0?\d*\s*$/i, '')   // "EK REV 01" → "EK"
    .replace(/\s*REV\s*\.?\s*$/i, '')           // "JQ REV" → "JQ"
    .trim();
  const up = stripped;

  // ── Hardcoded aliases (sheet name → team code) ──
  const ALIASES = {
    'WYWK':         'WY_G9_9C_DK',
    'WY':           'WY_G9_9C_DK',
    'CHN':          'CHINA_TEAM',
    'CHINA':        'CHINA_TEAM',
    'CHINA TEAM':   'CHINA_TEAM',
    'EK':           'EK_UO_6B_BY_FY',
    'EY':           'EY_DV_AY',
    'JQ':           'JQ_IT_IX_AI_N0',
    'KE':           'KC_LJ_KE_OZ_NO_AF',
    'KC':           'KC_LJ_KE_OZ_NO_AF',
    'QR':           'QR_MH_OM_DE',
    'SQ':           'SQ_CX_LY',
    'SU':           'SU_B2_W5',
    'SV':           'SV_KA_WK',
    'TK':           'TK_VJ_SG_HY_OD',
    'TR':           'TR_6E_QP',
    'AK':           'AK_QZ_8M',
    'PG':           'PG',
    'PVT':          'PVT',
    'CHARTER':      'CHARTER',
    'PORTER':       'PORTER',
    'ADMIN DOC':    'ADMIN_DOC',
    'ADMIN DOCUMENT': 'ADMIN_DOC',
    'ADMIN PORTER': 'ADMIN_PORTER',
    'OFFICE':       'OFFICE',
    'LOST AND FOUND': 'LOST_AND_FOUND',
    'LL':           'LOST_AND_FOUND',
    'PORTER LL':    'PORTER_LL',
    'ADMIN LL':     'ADMIN_LL'
  };
  if (ALIASES[up]) return ALIASES[up];

  // ลอง match กับทุกทีมใน config
  const cfg = getRuntimeConfig();
  for (let i = 0; i < cfg.TEAMS.length; i++) {
    const t = cfg.TEAMS[i];
    if (up === t.name.toUpperCase() || up === t.code) return t.code;
    // partial match (e.g. sheet "EK" matches team "EK/UO/6B/BY/FY")
    const teamParts = t.name.split(/[\/\s]/).filter(function(s){return s.length > 0;});
    for (let j = 0; j < teamParts.length; j++) {
      if (up === teamParts[j].toUpperCase() && teamParts[j].length >= 2) {
        return t.code;
      }
    }
  }

  // Special substring handling
  if (up.indexOf('CREWSIGN') !== -1 || up.indexOf('CREW SIGN') !== -1) return 'PORTER_CREWSIGN';
  if (up.indexOf('ADMIN DOC') !== -1) return 'ADMIN_DOC';
  if (up.indexOf('ADMIN PORTER') !== -1) return 'ADMIN_PORTER';
  if (up.indexOf('CHINA') !== -1 || up === 'CHN') return 'CHINA_TEAM';
  if (/\bPORTER\b/.test(up)) return 'PORTER';
  if (/^WY/.test(up)) return 'WY_G9_9C_DK';
  return null;
}

// ════════════════════════════════════════════════════════════════
// LL MONTHLY FILE
// ════════════════════════════════════════════════════════════════
function readLLDailyForDate(date, cfg) {
  cfg = cfg || getRuntimeConfig();
  const fileId = _resolveLLFileId(date, cfg);
  if (!fileId) return [];

  let ss;
  try { ss = SpreadsheetApp.openById(fileId); }
  catch (e) { Logger.log('LL openById failed: ' + e.message); return []; }

  const tabName = _findLLDayTabName(ss, date);
  if (!tabName) return [];

  const sh = ss.getSheetByName(tabName);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];

  const det = _detectLLHeader(rows);
  if (!det) return [];

  const records = [];
  const seen = {};
  for (let r = det.startRow; r < rows.length; r++) {
    const row = rows[r];
    const name = det.name >= 0 ? String(row[det.name] || '').trim() : '';
    const pos  = det.pos  >= 0 ? String(row[det.pos]  || '').trim() : '';
    if (!name) continue;
    const nameUp = name.toUpperCase();
    if (nameUp === 'NAME' || nameUp === 'POSITION' || nameUp === 'NO' ||
        nameUp === 'TOTAL' || nameUp === 'SCHEDULE') continue;
    if (pos && pos.toUpperCase() === 'TRAINEE') continue;

    const key = nameUp.replace(/\s+/g, '');
    if (seen[key]) continue;
    seen[key] = true;

    // Map LL position → team code
    const teamCode = _llPosToTeamCode(pos);

    records.push({
      date: stripTime(date),
      empId: '',
      empName: name,
      team: teamCode || 'LOST_AND_FOUND',
      dept: 'LL',
      shift: _normalizeShift(det.sched >= 0 ? row[det.sched] : ''),
      ot:    _normalizeText(det.ot >= 0 ? row[det.ot] : ''),
      remark: _normalizeText(det.remark >= 0 ? row[det.remark] : '')
    });
  }
  return records;
}

function _resolveLLFileId(date, cfg) {
  if (cfg.LL_ROSTER_FILES_BY_MONTH) {
    const key = formatDate(date, 'yyyy-MM');
    const entries = String(cfg.LL_ROSTER_FILES_BY_MONTH).split(',');
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i].split(':');
      if (p[0].trim() === key) return p[1].trim();
    }
  }
  return cfg.LL_ROSTER_FILE_ID || null;
}

function _findLLDayTabName(ss, date) {
  const d = date.getDate();
  const dPad = (d < 10 ? '0' : '') + d;
  const shortM = MONTH_ABB[date.getMonth() + 1];
  const yr2 = String(date.getFullYear()).slice(2);
  const patterns = [
    new RegExp('^' + dPad + shortM + yr2 + '$', 'i'),
    new RegExp('^' + dPad + shortM + '$', 'i'),
    new RegExp('^' + d + shortM + yr2 + '$', 'i'),
    new RegExp('^' + d + shortM + '$', 'i')
  ];
  const sheets = ss.getSheets();
  for (let p = 0; p < patterns.length; p++) {
    for (let i = 0; i < sheets.length; i++) {
      if (patterns[p].test(sheets[i].getName().trim())) return sheets[i].getName();
    }
  }
  return null;
}

function _detectLLHeader(rows) {
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const hdrs = rows[r].map(function(v){ return String(v||'').trim().toUpperCase(); });
    let nameCol = -1, posCol = -1, schedCol = -1, remarkCol = -1, otCol = -1;
    for (let c = 0; c < hdrs.length; c++) {
      const h = hdrs[c];
      if (nameCol < 0 && (h === 'NAME' || h === 'STAFF NAME')) nameCol = c;
      if (posCol < 0 && (h === 'POSITION' || h === 'POS.' || h === 'POS')) posCol = c;
      if (schedCol < 0 && (h === 'SCHEDULE' || h === 'SCHED' || h === 'SHIFT' || h === 'TIME')) schedCol = c;
      if (remarkCol < 0 && (h === 'REMARK' || h === 'RE')) remarkCol = c;
      if (otCol < 0 && (h === 'OT TIME' || h === 'OT')) otCol = c;
    }
    if (nameCol >= 0 && posCol >= 0 && schedCol >= 0) {
      return { name: nameCol, pos: posCol, sched: schedCol,
               remark: remarkCol, ot: otCol, startRow: r + 1 };
    }
  }
  return null;
}

function _llPosToTeamCode(pos) {
  const up = String(pos || '').toUpperCase();
  if (up.indexOf('ADMIN') !== -1) return 'ADMIN_LL';
  if (up.indexOf('PORTER') !== -1) return 'PORTER_LL';
  return 'LOST_AND_FOUND';
}

// ════════════════════════════════════════════════════════════════
// COLUMN DETECTION (PSA per-team sheets)
// ════════════════════════════════════════════════════════════════
function _detectColsPSA(rows) {
  const maxScan = Math.min(15, rows.length);
  for (let r = 0; r < maxScan; r++) {
    const hdrs = rows[r].map(function(v){ return String(v||'').trim().toUpperCase(); });
    let idCol = -1, nameCol = -1, timeCol = -1, otCol = -1, remarkCol = -1;
    for (let c = 0; c < hdrs.length; c++) {
      const h = hdrs[c];
      if (idCol < 0 && (h === 'ID' || h === 'EMPID' || h === 'EMP ID' || h === 'รหัส')) idCol = c;
      if (nameCol < 0 && (h === 'NAME' || h === 'STAFF NAME')) nameCol = c;
      if (timeCol < 0 && (h === 'TIME' || h === 'SHIFT' || h === 'SCHEDULE' || h === 'SCHED')) timeCol = c;
      if (otCol < 0 && h === 'OT') otCol = c;
      if (remarkCol < 0 && h === 'REMARK') remarkCol = c;
    }
    if (idCol < 0) continue;
    if (timeCol < 0) timeCol = idCol + 3;
    if (otCol < 0)     otCol = timeCol + 2;
    if (remarkCol < 0) remarkCol = timeCol + 3;
    let dataStart = r + 1;
    for (let rr = r + 1; rr < Math.min(r + 8, rows.length); rr++) {
      const idRaw = rows[rr][idCol];
      if (idRaw && /^\d{6,8}$/.test(String(idRaw).replace(/\.0*$/, '').replace(/\D/g, ''))) {
        dataStart = rr; break;
      }
    }
    return { id: idCol, name: nameCol, time: timeCol, ot: otCol,
             remark: remarkCol, startRow: dataStart };
  }
  return null;
}

function _detectColsByDataScan(rows) {
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const v = rows[r][c];
      if (v === null || v === undefined || v === '') continue;
      const digits = String(v).replace(/\.0*$/, '').replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 8) continue;
      for (let tc = c + 1; tc < Math.min(c + 8, rows[r].length); tc++) {
        const tv = String(rows[r][tc] || '').trim().toUpperCase();
        if (_isShiftLike(tv)) {
          return { id: c, name: c + 2, time: tc, ot: tc + 2,
                   remark: tc + 3, startRow: r };
        }
      }
    }
  }
  return null;
}

function _detectColsByName(rows) {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const hdrs = rows[r].map(function(v){ return String(v||'').trim().toUpperCase(); });
    let nameCol = -1, timeCol = -1, otCol = -1, remarkCol = -1;
    for (let c = 0; c < hdrs.length; c++) {
      const h = hdrs[c];
      if (nameCol < 0 && (h === 'NAME' || h === 'STAFF NAME' || h === 'STAFF')) nameCol = c;
      if (timeCol < 0 && (h === 'SCHEDULE' || h === 'SCHED' || h === 'SHIFT')) timeCol = c;
      if (otCol < 0 && h === 'OT') otCol = c;
      if (remarkCol < 0 && (h === 'REMARK' || h === 'RE')) remarkCol = c;
    }
    if (timeCol < 0) {
      for (let c = 0; c < hdrs.length; c++) {
        if (hdrs[c] === 'TIME') { timeCol = c; break; }
      }
    }
    if (nameCol < 0 || timeCol < 0) continue;

    let name2 = -1, time2 = -1, ot2 = -1, remark2 = -1;
    for (let c = otCol + 1; c < hdrs.length; c++) {
      if (hdrs[c] === 'NAME' || hdrs[c] === 'STAFF NAME' || hdrs[c] === 'STAFF') {
        name2 = c;
        for (let c2 = c + 1; c2 < hdrs.length; c2++) {
          if (time2 < 0 && (hdrs[c2] === 'SCHEDULE' || hdrs[c2] === 'SCHED' || hdrs[c2] === 'SHIFT')) time2 = c2;
          if (ot2 < 0 && hdrs[c2] === 'OT') ot2 = c2;
          if (remark2 < 0 && (hdrs[c2] === 'REMARK' || hdrs[c2] === 'RE')) remark2 = c2;
        }
        break;
      }
    }
    return { name: nameCol, time: timeCol, ot: otCol, remark: remarkCol,
             name2: name2, time2: time2, ot2: ot2, remark2: remark2,
             startRow: r + 1 };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// PORTER CREW SIGN — special compound shift+OT string in col A
// ════════════════════════════════════════════════════════════════
/**
 * อ่าน PORTER CREW SIGN sheet
 * Layout:
 *   Row 12: "SHIFT | STAFF NAME | (blank) | REMARK"
 *   Row 13+ data
 *
 * Col A patterns:
 *   "09-18/OT DAY OFF"       → OT day off 9 hrs
 *   "08-18 RE13-23 /OT10-13" → shift 13-23, OT BEFORE 10-13 (3h)
 *   "07-19"                  → shift 07-19, no OT
 *   " OT 11-13/13-23"        → shift 13-23, OT BEFORE 11-13
 *   "06-18 /RE:09-21/ OT 21-23" → shift 09-21, OT AFTER 21-23
 */
function _extractCrewsignRecords(rows, team, date, out) {
  if (rows.length < 13) return;

  // Find header row (look for "SHIFT" or "STAFF NAME" header)
  let hdrRow = -1;
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const cells = (rows[r] || []).map(function(v){ return String(v||'').trim().toUpperCase(); });
    if ((cells[0] === 'SHIFT' || cells[0] === 'TIME') && cells[1].indexOf('NAME') !== -1) {
      hdrRow = r; break;
    }
  }
  if (hdrRow < 0) hdrRow = 11; // default row 12 (index 11)

  const master = getMasterEmployees();

  for (let r = hdrRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const shiftStrRaw = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const remark = String(row[3] || '').trim();
    if (!name) continue;
    if (name.length < 2) continue;

    const parsed = _parseCrewsignShiftStr(shiftStrRaw);
    // Stop processing เมื่อเจอ row ที่ไม่มี shift และไม่มี marker
    if (!parsed.shift && !parsed.ot && !shiftStrRaw) {
      // Could still be a valid Off entry — if remark has data
      if (!remark) continue;
    }

    // Master lookup
    const fnUp = name.split(/\s+/)[0].toUpperCase();
    const emp = master.byFirstName[fnUp] || null;

    out.push({
      date: stripTime(date),
      empId: emp ? emp.empId : '',
      empName: name,
      team: 'PORTER_CREWSIGN',
      dept: 'PSA',
      shift: parsed.shift,
      ot: parsed.ot,
      remark: remark,
      // Pre-classified OT category (override default)
      _otCategoryHint: parsed.otCategory
    });
  }
}

/**
 * Parse compound CrewSign shift string in col A
 * Return: { shift, ot, otCategory }
 */
function _parseCrewsignShiftStr(s) {
  s = String(s || '').trim();
  if (!s) return { shift: '', ot: '', otCategory: null };

  const sUp = s.toUpperCase();

  // Pattern 1: "X-Y/OT DAY OFF"
  const dayOff = s.match(/^(\d{1,2})[\.:]?(\d{0,2})\s*[-–]\s*(\d{1,2})[\.:]?(\d{0,2})\s*\/?\s*OT\s+DAY\s+OFF/i);
  if (dayOff) {
    const ot = _fmtHHRange(dayOff[1], dayOff[2], dayOff[3], dayOff[4]);
    return { shift: 'OFF', ot: ot, otCategory: 'DAYOFF' };
  }

  // Find RE shift (rescheduled) — has precedence over base shift
  let actualShift = '';
  const reMatch = s.match(/RE\s*:?\s*(\d{1,2})[\.:]?(\d{0,2})\s*[-–]\s*(\d{1,2})[\.:]?(\d{0,2})/i);
  if (reMatch) {
    actualShift = _fmtHHRange(reMatch[1], reMatch[2], reMatch[3], reMatch[4]);
  }

  // Find OT
  let otStr = '';
  const otMatch = s.match(/OT\s*:?\s*(\d{1,2})[\.:]?(\d{0,2})\s*[-–]\s*(\d{1,2})[\.:]?(\d{0,2})/i);
  if (otMatch) {
    otStr = _fmtHHRange(otMatch[1], otMatch[2], otMatch[3], otMatch[4]);
  }

  // If no RE, try base shift (first X-Y that's not OT prefix)
  if (!actualShift) {
    // Strip OT segment first to avoid match
    const sNoOT = s.replace(/OT\s*:?\s*\d{1,2}[\.:]?\d{0,2}\s*[-–]\s*\d{1,2}[\.:]?\d{0,2}/gi, '');
    const baseMatch = sNoOT.match(/(?:^|\s|\/)\s*(\d{1,2})[\.:]?(\d{0,2})\s*[-–]\s*(\d{1,2})[\.:]?(\d{0,2})/);
    if (baseMatch) {
      actualShift = _fmtHHRange(baseMatch[1], baseMatch[2], baseMatch[3], baseMatch[4]);
    }
  }

  // OT side detection: BEFORE if OT END ≤ shift START, AFTER if OT START ≥ shift END
  let otCategory = null;
  if (otStr && actualShift && actualShift !== 'OFF') {
    const otRange = _parseShiftRange(otStr);
    const sftRange = _parseShiftRange(actualShift);
    if (otRange && sftRange) {
      otCategory = _classifyOTPrePost(sftRange, otRange);
    }
  }

  // Off detection
  if (/^OFF/i.test(sUp) || /VAC|^SL$|^MC$/.test(sUp)) {
    return { shift: 'OFF', ot: otStr, otCategory: otCategory };
  }

  return { shift: actualShift, ot: otStr, otCategory: otCategory };
}

function _fmtHHRange(h1, m1, h2, m2) {
  const _p2 = function(s) { s = String(s || '0'); return s.length === 1 ? '0' + s : s.length === 0 ? '00' : s; };
  return _p2(h1) + (m1 ? ':'+_p2(m1) : '') + '-' + _p2(h2) + (m2 ? ':'+_p2(m2) : '');
}

/**
 * Detect REV01 format ที่ใช้ในไฟล์ใหม่ (มี Position + IN/OUT/Total Hrs sub-headers)
 * Layout:
 *   Row 3 (index 2): "ID | Position | NAME | SHIFT | time | ... | OT | ... | REMARK | FLIGHT"
 *   Row 6 (index 5): sub-headers "IN | OUT | Total Hrs | IN | OUT | Total Hrs | IN | OUT | Total Hrs"
 *   Row 7 (index 6): example/skip
 *   Row 8+ (index 7+): data
 */
function _detectRevFormat(rows) {
  if (rows.length < 9) return null;

  // ─ Scan rows 2-5 (idx 1-4) เพื่อหา header row ที่มี ID + NAME + SHIFT/TIME ─
  let hdrIdx = -1;
  let r3 = null;
  for (let r = 1; r <= Math.min(5, rows.length - 1); r++) {
    const cells = (rows[r] || []).map(function(v){ return String(v||'').trim().toUpperCase(); });
    let hasId = false, hasName = false, hasTimeOrShift = false;
    for (let c = 0; c < cells.length; c++) {
      if (cells[c] === 'ID') hasId = true;
      if (cells[c] === 'NAME' || cells[c] === 'STAFF NAME') hasName = true;
      if (cells[c] === 'SHIFT' || cells[c] === 'TIME' || cells[c] === 'SCHEDULE' || cells[c] === 'SCHED') hasTimeOrShift = true;
    }
    if (hasId && hasName) {
      hdrIdx = r;
      r3 = cells;
      break;
    }
  }
  if (hdrIdx < 0 || !r3) return null;

  // ─ Locate column indices จาก header ─
  let idCol = -1, posCol = -1, nameCol = -1, shiftCol = -1;
  for (let c = 0; c < r3.length; c++) {
    if (idCol < 0 && r3[c] === 'ID') idCol = c;
    if (posCol < 0 && (r3[c] === 'POSITION' || r3[c] === 'POS.' || r3[c] === 'POS' ||
                       (r3[c] && r3[c].indexOf('POSITION') === 0))) posCol = c;
    if (nameCol < 0 && (r3[c] === 'NAME' || r3[c] === 'STAFF NAME' ||
                        (r3[c] && r3[c].indexOf('NAME') === 0))) nameCol = c;
    if (shiftCol < 0 && (r3[c] === 'SHIFT' || (r3[c] && r3[c].indexOf('SHIFT') === 0))) shiftCol = c;
  }
  if (idCol < 0 || nameCol < 0) return null;

  // ─ Check row hdrIdx+3 (sub-headers IN/OUT) ─ ถ้าไม่มีก็ยังลอง REV format
  const subIdx = hdrIdx + 3; // typical: header row 3 (idx 2), sub row 6 (idx 5)
  const subRow = (rows[subIdx] || []).map(function(v){ return String(v||'').trim().toUpperCase(); });
  let schedIn = -1, schedOut = -1, schedHrs = -1;
  let otIn = -1, otOut = -1, otHrs = -1;
  let hasInOutSub = false;
  for (let c = 0; c < subRow.length; c++) {
    if (subRow[c] === 'IN' && subRow[c+1] === 'OUT') {
      hasInOutSub = true;
      if (schedIn < 0)        { schedIn = c; schedOut = c+1; schedHrs = c+2; }
      else if (otIn < 0)      { otIn = c;   otOut   = c+1; otHrs    = c+2; }
    }
  }

  // ─ ถ้าไม่มี IN/OUT sub-headers (WYWK style) — derive จาก row 3 ─
  if (!hasInOutSub) {
    // Find TIME, RE SKED, OT col in header row
    let timeCol = -1, reskedCol = -1, otCol = -1, remarkCol = -1;
    for (let c = 0; c < r3.length; c++) {
      if (timeCol < 0 && (r3[c] === 'TIME' || r3[c] === 'SCHEDULE' || r3[c] === 'SCHED')) timeCol = c;
      if (reskedCol < 0 && /^RE\s*SKED|^RE-?SKED|RE\s*SCHED/.test(r3[c])) reskedCol = c;
      if (otCol < 0 && r3[c] === 'OT') otCol = c;
      if (remarkCol < 0 && r3[c] === 'REMARK') remarkCol = c;
    }
    if (timeCol < 0 || otCol < 0) return null;

    return {
      isRev: true,
      isSimpleRev: true,
      id: idCol, position: posCol, name: nameCol, shiftCode: shiftCol,
      timeCol: timeCol, reskedCol: reskedCol, otCol: otCol,
      remark: remarkCol,
      startRow: hdrIdx + 2  // ข้าม sub-row ที่ว่างหรือ example
    };
  }

  // ─ Standard REV format (EK/TR/JQ with Position + IN/OUT/Total Hrs) ─
  // REMARK col — usually right after OT Total Hrs
  let remarkCol = otHrs + 1;
  for (let c = (otHrs > 0 ? otHrs + 1 : 12); c < r3.length; c++) {
    if (r3[c] === 'REMARK') { remarkCol = c; break; }
  }

  return {
    isRev: true,
    id: idCol, position: posCol, name: nameCol, shiftCode: shiftCol,
    schedIn: schedIn, schedOut: schedOut, schedHrs: schedHrs,
    otIn: otIn, otOut: otOut, otHrs: otHrs,
    remark: remarkCol,
    startRow: subIdx + 2   // data starts 2 rows below sub-header (skip example row)
  };
}

/**
 * แยกหนึ่ง row ของ REV format → record format ที่ classifier เข้าใจ
 */
function _extractRevRow(row, det, team, date, out) {
  const idRaw = row[det.id];
  if (idRaw === null || idRaw === undefined || idRaw === '') return;
  const digits = String(idRaw).replace(/\.0*$/, '').replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 8) return;

  const name = String(row[det.name] || '').trim();
  const remark = _normalizeText(row[det.remark]);

  // ─ WYWK / Simple REV format (TIME/RE SKED/OT cols เก็บ string range) ─
  if (det.isSimpleRev) {
    const timeStr   = _normalizeShift(row[det.timeCol]);
    const reskedStr = det.reskedCol >= 0 ? _normalizeShift(row[det.reskedCol]) : '';
    const otStr     = det.otCol     >= 0 ? _normalizeText(row[det.otCol])     : '';
    // ใช้ RE SKED ถ้ามี ไม่งั้นใช้ TIME
    const shiftStr = reskedStr || timeStr;
    out.push({
      date: stripTime(date),
      empId: digits,
      empName: name,
      team: team || '',
      dept: 'PSA',
      shift: shiftStr,
      ot: otStr,
      remark: remark
    });
    return;
  }

  // ─ Standard REV format (EK/TR/JQ with IN/OUT sub-cols) ─
  const schedIn  = _timeOfDayHHMM(row[det.schedIn]);
  const schedOut = _timeOfDayHHMM(row[det.schedOut]);
  let shiftStr = '';
  if (schedIn && schedOut) {
    shiftStr = schedIn + '-' + schedOut;
  } else {
    const sc = String(row[det.shiftCode] || '').trim().toUpperCase();
    const remUp = remark.toUpperCase();
    if (/OFF/.test(sc) || /OFF/.test(remUp)) shiftStr = 'OFF';
    else if (/SL|SICK/.test(remUp)) shiftStr = '';
  }

  const otIn  = _timeOfDayHHMM(row[det.otIn]);
  const otOut = _timeOfDayHHMM(row[det.otOut]);
  let otStr = '';
  if (otIn && otOut && (otIn !== otOut || _timeOfDayHHMM(row[det.otHrs]))) {
    otStr = otIn + '-' + otOut;
  }

  out.push({
    date: stripTime(date),
    empId: digits,
    empName: name,
    team: team || '',
    dept: 'PSA',
    shift: shiftStr,
    ot: otStr,
    remark: remark
  });
}

/**
 * แปลง value (Date / "04:00" / "0400") → "HH:MM" string หรือ ''
 */
function _timeOfDayHHMM(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    const h = v.getHours();
    const m = v.getMinutes();
    return _pad2(h) + ':' + _pad2(m);
  }
  const s = String(v).trim();
  if (!s) return '';
  // "04:00" or "4:30" or "04.30"
  let m = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return _pad2(parseInt(m[1], 10)) + ':' + _pad2(parseInt(m[2], 10));
  // "0400"
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) return m[1] + ':' + m[2];
  // Try parse as number (e.g. 0.167 = 04:00 in Sheets time)
  const n = Number(s);
  if (!isNaN(n) && n > 0 && n < 1) {
    const totalMin = Math.round(n * 24 * 60);
    return _pad2(Math.floor(totalMin / 60)) + ':' + _pad2(totalMin % 60);
  }
  return '';
}

function _isShiftLike(up) {
  if (!up) return false;
  if (up === 'X' || up === 'XX' || up === 'OFF' || up === 'VAC' || up === 'SICK' || up === 'SL') return true;
  return /^\d{1,2}[\.:]?\d{0,2}[-–]\d{1,2}/.test(up) || /^\d{4}[-–]\d{2,4}/.test(up);
}

// ════════════════════════════════════════════════════════════════
// VALUE NORMALIZATION
// ════════════════════════════════════════════════════════════════
function _normalizeShift(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    return _pad2(v.getHours()) + _pad2(v.getMinutes());
  }
  return String(v).trim();
}
function _normalizeText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return _pad2(v.getHours()) + _pad2(v.getMinutes());
  return String(v).trim();
}
function _pad2(n) { return (n < 10 ? '0' : '') + n; }

// ════════════════════════════════════════════════════════════════
// OT PARSING (with FIXES from SmartShiftBot_OT_Fixes)
// ════════════════════════════════════════════════════════════════
/**
 * Parse OT range → ชั่วโมง decimal (รองรับทุก format ที่เคยเป็น bug)
 */
function _parseOTHours(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (v > 0 && v < 1) return 0;
    if (v >= 1 && v <= 14) return Math.round(v * 10) / 10;
    return 0;
  }
  if (v instanceof Date) return 0;
  let s = String(v).trim().toUpperCase();
  if (!s || s === '-' || s === 'NO OT' || s === 'NOOT' || s === 'VAC' ||
      s === 'X' || s === 'CW' || /^C\/W/.test(s)) return 0;
  if (/^\d{1,2}[\.:]\d{2}(?::\d{2})?$/.test(s) && s.indexOf('-') < 0) return 0;
  s = s.replace(/^OT\s+/i, '');
  const m = s.match(/^(\d{1,2})[\.:]?(\d{2})?\s*[-–]\s*(\d{1,2})[\.:]?(\d{2})?\b/);
  if (!m) return 0;
  const sh = parseInt(m[1], 10), sm = m[2] ? parseInt(m[2], 10) : 0;
  const eh = parseInt(m[3], 10), em = m[4] ? parseInt(m[4], 10) : 0;
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return 0;
  let sMin = sh * 60 + sm, eMin = eh * 60 + em;
  if (eMin <= sMin) eMin += 1440;
  const hrs = (eMin - sMin) / 60;
  return (hrs > 0 && hrs <= 14) ? Math.round(hrs * 10) / 10 : 0;
}

function _parseShiftRange(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return null;
  let s = String(v).trim().toUpperCase();
  s = s.replace(/^D(?=\d)/, '');
  if (s === 'X' || s === 'XX' || s === 'OFF' || s === 'SICK' || s === 'SL' ||
      s === 'VAC' || s === 'BL' || s === 'MC') return null;
  const m = s.match(/^(\d{1,2})[\.:]?(\d{2})?\s*[-–]\s*(\d{1,2})[\.:]?(\d{2})?/);
  if (!m) return null;
  const sh = parseInt(m[1], 10), sm = m[2] ? parseInt(m[2], 10) : 0;
  const eh = parseInt(m[3], 10), em = m[4] ? parseInt(m[4], 10) : 0;
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

function _parseOTRange(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().toUpperCase().replace(/^OT\s+/i, '');
  const m = s.match(/^(\d{1,2})[\.:]?(\d{2})?\s*[-–]\s*(\d{1,2})[\.:]?(\d{2})?/);
  if (!m) return null;
  const sh = parseInt(m[1], 10), sm = m[2] ? parseInt(m[2], 10) : 0;
  const eh = parseInt(m[3], 10), em = m[4] ? parseInt(m[4], 10) : 0;
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

/**
 * Bug #4 fix: night shift OT 06-09 → POST (not PRE)
 */
function _classifyOTPrePost(shift, ot) {
  const TOL = 30;
  let sStart = shift.start, sEnd = shift.end;
  if (sEnd <= sStart) sEnd += 1440;

  function normEnd(s, e) { return e <= s ? e + 1440 : e; }
  const positions = [
    { s: ot.start,        e: normEnd(ot.start, ot.end) },
    { s: ot.start + 1440, e: normEnd(ot.start + 1440, ot.end + 1440) }
  ];
  let best = null;
  positions.forEach(function(p) {
    const distPre  = sStart - p.e;
    const distPost = p.s - sEnd;
    if (distPre >= -TOL) {
      const d = Math.abs(distPre);
      if (!best || d < best.dist) best = { type: 'BEFORE', dist: d };
    }
    if (distPost >= -TOL) {
      const d = Math.abs(distPost);
      if (!best || d < best.dist) best = { type: 'AFTER', dist: d };
    }
  });
  return best ? best.type : 'AFTER'; // default to AFTER if unclear
}

// ════════════════════════════════════════════════════════════════
// CLASSIFY RECORD
// ════════════════════════════════════════════════════════════════
function _classifyRecord(r, PH_SET) {
  const dateStr = formatDate(r.date, 'yyyy-MM-dd');
  const isPH = PH_SET.has(dateStr);

  const shift = (r.shift || '').toString();
  const ot    = (r.ot    || '').toString();
  const remark = (r.remark || '').toString();
  const shiftUp = shift.toUpperCase();
  const otUp    = ot.toUpperCase();
  const remarkUp = remark.toUpperCase();

  // ─ Sick ─
  if (/SICK|SL|MC/.test(remarkUp) || /SICK|^SL$|^MC$/.test(shiftUp) ||
      /^SL$|^SICK$|^MC$/.test(otUp) || /ลาป่วย/.test(remark)) {
    return { otHrs: 0, otCategory: null, status: 'SICK' };
  }

  // ─ Vacation / Leave ─
  if (/VAC|^BL$|LEAVE/.test(shiftUp) || /^BL$|^VAC$|VACATION/.test(otUp) ||
      /\bBL\b|VACATION/.test(remarkUp)) {
    return { otHrs: 0, otCategory: null, status: 'VAC' };
  }

  const otHrs = _parseOTHours(ot);
  const hasOT = otHrs > 0;
  const hasDPrefix = /^D\d/.test(shiftUp);
  const shiftNorm = shiftUp.replace(/^D(?=\d)/, '');
  const isOff = shiftNorm === 'X' || shiftNorm === 'XX' || shiftNorm === 'OFF' ||
                /^OFF\b/.test(shiftNorm) || shiftNorm === '' || shiftNorm === '0' ||
                (hasDPrefix && !hasOT);

  // ─ Off without OT ─
  if (isOff && !hasOT) {
    return { otHrs: 0, otCategory: null, status: 'OFF' };
  }

  // ─ Off with OT ─ (มาทำในวันหยุด)
  if (isOff && hasOT) {
    return { otHrs: otHrs, otCategory: isPH ? 'PH' : 'DAYOFF', status: 'WORKING' };
  }

  // ─ D-prefix + OT ─
  if (hasDPrefix && hasOT) {
    return { otHrs: otHrs, otCategory: isPH ? 'PH' : 'DAYOFF', status: 'WORKING' };
  }

  // ─ Working day ─
  // ถ้าเป็น PH ที่มี OT → PH
  if (isPH && hasOT) {
    return { otHrs: otHrs, otCategory: 'PH', status: 'WORKING' };
  }

  // Normal working day with OT
  if (hasOT) {
    const shiftRange = _parseShiftRange(shiftNorm);
    const otRange    = _parseOTRange(ot);
    let cat = 'AFTER';
    if (shiftRange && otRange) {
      cat = _classifyOTPrePost(shiftRange, otRange);
    } else if (!shiftRange) {
      // shift parse ไม่ได้ แต่มี OT → ถือว่า DAYOFF
      cat = isPH ? 'PH' : 'DAYOFF';
    }
    return { otHrs: otHrs, otCategory: cat, status: 'WORKING' };
  }

  // ─ Just working, no OT ─
  return { otHrs: 0, otCategory: null, status: 'WORKING' };
}