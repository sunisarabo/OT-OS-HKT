/**
 * PDFExporter.gs (v3)
 *
 * Workflow:
 *   1. Generate Dashboard HTML  → ได้ URL
 *   2. Build Google Doc พร้อม clickable Dashboard link
 *   3. Export Doc → PDF
 *   4. Save PDF + Dashboard ลง Drive
 *   5. Cleanup temp Doc
 */

/**
 * @param {string} period 'daily'|'weekly'|'monthly'
 * @param {Date}   startDate
 * @param {Date}   endDate
 * @param {{ withDashboard: boolean }} [options]
 * @returns {{ fileId, fileUrl, filename, savedTo, dashboardUrl, hasData }}
 */
function generateAndSavePDF(period, startDate, endDate, options) {
  options = options || {};
  const cfg = getRuntimeConfig();
  const savedTo = [];

  // ─ 1. Generate Dashboard FIRST (เพื่อให้ได้ URL ก่อน build PDF) ─
  let dashboardUrl = null;
  if (options.withDashboard !== false) {
    try {
      const dash = generateDashboard(period, startDate, endDate);
      dashboardUrl = dash.fileUrl;
      savedTo.push(dash.savedTo);
    } catch (e) {
      Logger.log('Dashboard generation failed: ' + e.message);
    }
  }

  // ─ 2. Build Doc — ส่ง dashboardUrl ให้ embed ใน header ──────
  const docInfo = buildReportDoc(period, startDate, endDate, { dashboardUrl: dashboardUrl });
  const docFile = DriveApp.getFileById(docInfo.docId);

  // ─ 3. Export Doc → PDF ──────────────────────────────────────
  const pdfBlob = docFile.getAs('application/pdf').setName(docInfo.filename);

  // ─ 4. Save PDF ไปยัง Monthly (+ Yearly ถ้า monthly) ────────
  const monthlyFolder = DriveApp.getFolderById(cfg.MONTHLY_FOLDER_ID);
  const monthSub = _getOrCreateSubFolder(monthlyFolder, formatDate(startDate, 'yyyy-MM'));
  const pdfFile = monthSub.createFile(pdfBlob);
  savedTo.push('Monthly/' + formatDate(startDate, 'yyyy-MM') + '/' + docInfo.filename);

  if (period === 'monthly') {
    const yearlyFolder = DriveApp.getFolderById(cfg.YEARLY_FOLDER_ID);
    const yearSub = _getOrCreateSubFolder(yearlyFolder, formatDate(startDate, 'yyyy'));
    yearSub.createFile(pdfFile.getBlob());
    savedTo.push('Yearly/' + formatDate(startDate, 'yyyy') + '/' + docInfo.filename);
  }

  // ─ 5. Cleanup temp Doc ──────────────────────────────────────
  docFile.setTrashed(true);

  return {
    fileId:       pdfFile.getId(),
    fileUrl:      pdfFile.getUrl(),
    filename:     docInfo.filename,
    savedTo:      savedTo,
    dashboardUrl: dashboardUrl,
    hasData:      docInfo.hasData
  };
}

function _getOrCreateSubFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}