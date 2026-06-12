# OT Report — รายงาน OT รายชื่อพนักงาน แยก 3 แผนก (KP / LP / LL)

ส่วนเสริมของระบบ **"OT Report — PSA"** (Apps Script) ที่เพิ่ม
**รายงาน OT ระดับรายชื่อพนักงาน** แยก **3 แผนก** และ **รายสัปดาห์ (W1–W4) + รายเดือน**
— โดยใช้ตัวอ่านข้อมูล/ตรรกะ OT เดิม (`readAttendance()`) แล้วจัดกลุ่มใหม่

| แผนก | ทีม |
|------|-----|
| **KP** | PSA ทุกทีม ยกเว้น PORTER, PVT (ADMIN DOC/PORTER, Porter Crewsign, OFFICE, สายการบิน, PG, SV, CHINA, Charter ฯลฯ) |
| **LP** | PORTER + PVT |
| **LL** | ADMIN LL · lOST AND fOUND · PORTER LL |

## ไฟล์
| ไฟล์ | บทบาท |
|------|--------|
| `apps-script/Employees.gs` | **โค้ดหลัก** — วางแทนไฟล์ `Employees` (สตับ) ในโปรเจกต์ · server `getEmployeeReport3()` + หน้าเว็บ `?view=employees` |
| `apps-script/INTEGRATION.md` | ขั้นตอนติดตั้ง + แก้ `doGet` 1 บรรทัด + วิธีทดสอบ |
| `data/team_mapping.csv` | ผลจัดกลุ่มรายคนที่ตรวจกับ Pax Manpower จริง (836 คน: KP 655 · LP 94 · LL 87) |

## เริ่มที่นี่
อ่าน **`apps-script/INTEGRATION.md`** — ติดตั้ง 2 ขั้น (วาง `Employees.gs` + เพิ่ม 1 บรรทัดใน `doGet`)
แล้วรัน `inspectEmployees3()` เพื่อตรวจ ก่อนเปิด `…/exec?view=employees`

## หมายเหตุการพัฒนา
- โปรเจกต์จริง = `OT Report — PSA` (มี Config/Datareader/Otcalculator/Reportgenerator/Webapp ฯลฯ)
- ผมเขียนแก้โค้ดเข้า Apps Script ให้อัตโนมัติไม่ได้ (เครื่องมือในระบบเป็น Google Drive เท่านั้น
  ไม่มี Apps Script API / clasp) จึงส่งเป็นโค้ดให้วาง + คู่มือติดตั้ง
- ตรรกะการจัดกลุ่ม KP/LP/LL อยู่ที่ `dept3ForTeam_()` — อิง `Config.TEAMS[].dept` ที่มีอยู่แล้ว
