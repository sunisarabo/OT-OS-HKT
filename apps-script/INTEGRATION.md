# ติดตั้ง Employees.gs ในโปรเจกต์ "OT Report — PSA"

ฟีเจอร์: รายงาน **OT รายชื่อพนักงาน แยก 3 แผนก KP / LP / LL** (รายสัปดาห์ W1–W4 + รายเดือน)
ต่อยอดจากระบบเดิม โดย **ใช้ `readAttendance()` + ตรรกะ OT เดิม** แล้วจัดกลุ่มใหม่

> Project: `OT Report — PSA` (id `1P4yLmgTFD1TCMwB4UwoApU_3bZ1MgJF3uMWLF2TPIOF5OwHvGawU-ckh`)

## การจัดกลุ่ม (อิง `Config.TEAMS[].dept` + รหัสทีม)
| แผนก | ทีม |
|------|-----|
| **KP** | PSA ทุกทีม **ยกเว้น** PORTER, PVT (รวม ADMIN DOC, ADMIN PORTER, Porter Crewsign, OFFICE, สายการบินทั้งหมด, PG, SV, CHINA, Charter) |
| **LP** | PORTER + PVT |
| **LL** | ADMIN LL · lOST AND fOUND · PORTER LL (`dept: 'LL'` ใน Config) |

แก้เกณฑ์ได้ที่ฟังก์ชัน `dept3ForTeam_()` ใน `Employees.gs`

## 2 ขั้นตอนติดตั้ง

### 1) วางโค้ดในไฟล์ `Employees`
เปิดไฟล์ **Employees** (สตับเดิม `function myFunction(){}`) → ลบทิ้ง → วางเนื้อหา `apps-script/Employees.gs` ทั้งไฟล์

### 2) เพิ่ม route ใน `Webapp.gs` → `doGet`
เพิ่ม **1 บรรทัด** ใต้ `const params = e.parameter || {};` (บรรทัด ~23):

```javascript
function doGet(e) {
  e = e || {};
  const params = e.parameter || {};
  if (params.view === 'employees') return renderEmployeeReportPage_(e);   // ◀ เพิ่มบรรทัดนี้
  let period = params.period || 'daily';
  // ...โค้ดเดิมต่อจากนี้...
```

## ทดสอบก่อน Deploy
1. ใน Editor เลือกฟังก์ชัน **`inspectEmployees3`** → **Run** → ดู **Execution log**
   - ควรเห็น `attendance records: N` และยอด `KP/LP/LL คน/ชม.` รายเดือน
   - ถ้า `attendance records: 0` แปลว่าช่วงเวลาเริ่มต้น (เดือนที่แล้ว) ไม่มีไฟล์ roster — ปกติ ลองเดือนที่มีข้อมูล
2. Deploy เดิม (หรือ New deployment) แล้วเปิด:
   - `…/exec?view=employees` (ค่าเริ่มต้น: Oct 2025 → ปัจจุบัน เลือกเดือนบนหน้าได้)
   - หรือเจาะจงเดือน: `…/exec?view=employees&month=2026-05`
   - หรือช่วง: `…/exec?view=employees&start=2026-05-01&end=2026-05-31`

## หมายเหตุ
- OT คิดจาก `otHrs` ของแต่ละ record (เหมือน `calculateOT`) — รวมทุกประเภท (ก่อน/หลังกะ/วันหยุด/นักขัตฤกษ์)
- สัปดาห์ในเดือน = วันที่ 1–7 / 8–14 / 15–21 / 22–สิ้นเดือน (ตรงกับ dashboard PSA/LL เดิม)
- มีปุ่ม **Export CSV** (แยกตามแผนก+เดือนที่เลือก) และ **Print / PDF** ในหน้า
- `data/team_mapping.csv` = ผลจัดกลุ่มรายคนที่ตรวจกับไฟล์ Pax Manpower จริง (836 คน) ใช้ตรวจทานได้
