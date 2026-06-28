# ติดตั้ง รายงาน OT รายชื่อ KP/LP/LL ในโปรเจกต์ "OT Report — PSA"

ใช้ `readAttendance()` + ตรรกะ OT เดิม แล้วจัดกลุ่มใหม่เป็น 3 แผนก (รายสัปดาห์ W1–W4 + รายเดือน)

> โครงสร้างใหม่: แยกเป็น **2 ไฟล์** (โค้ดสั้น วางง่าย ไม่พังตอน copy)
> — `Employees.gs` (server) + `EmployeeReport` (HTML)

## การจัดกลุ่ม
| แผนก | ทีม |
|------|-----|
| **KP** | PSA ทุกทีม ยกเว้น PORTER, PVT |
| **LP** | PORTER + PVT |
| **LL** | ADMIN LL · lOST AND fOUND · PORTER LL (`dept:'LL'` ใน Config) |

แก้เกณฑ์ได้ที่ `dept3ForTeam_()`

## 3 ขั้นตอน

### 1) ไฟล์ Script `Employees`
เปิดไฟล์ **Employees** (สตับ `myFunction`) → ลบทั้งหมด → วางเนื้อหา `apps-script/Employees.gs`

### 2) เพิ่มไฟล์ HTML `EmployeeReport`
Editor → ➕ ข้าง Files → **HTML** → ตั้งชื่อ `EmployeeReport` (ตรงตัว ไม่ต้องใส่ .html)
→ ลบเนื้อหา default → วางเนื้อหา `apps-script/EmployeeReport.html`

### 3) เพิ่ม route ใน `Webapp.gs` → `doGet`
ใต้บรรทัด `const params = e.parameter || {};` เพิ่ม:
```javascript
if (params.view === 'employees') return renderEmployeeReportPage_();
```

## ทดสอบ
1. เลือกฟังก์ชัน **`inspectEmployees3`** → **Run** → ดู **Execution log**
   - เห็น `attendance records: N` + ยอด KP/LP/LL = OK
   - ถ้า 0 records → เดือนที่แล้วไม่มีไฟล์ roster (ปกติ) ลองเดือนที่มีข้อมูล
2. Deploy → เปิด `…/exec?view=employees`
   - หน้าเว็บมี dropdown เลือกเดือน (โหลดทีละเดือนผ่าน `google.script.run`) + ปุ่ม Export CSV / Print

## หมายเหตุ
- OT คิดจาก `otHrs` ของแต่ละ record (รวมทุกประเภท: ก่อน/หลังกะ/วันหยุด/นักขัตฤกษ์)
- สัปดาห์ในเดือน = 1–7 / 8–14 / 15–21 / 22–สิ้นเดือน
- `data/team_mapping.csv` = ผลจัดกลุ่มรายคนตรวจกับ Pax Manpower จริง (836 คน)
