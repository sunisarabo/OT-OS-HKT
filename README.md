# OT Dashboard — รายงาน OT รายชื่อพนักงาน แยก 3 แผนก (KP / LP / LL)

ส่วนเสริมของ OT Dashboard (AOTGA HKT) ที่เพิ่ม **รายงาน OT ระดับรายชื่อพนักงาน**
คล้ายไฟล์ตัวอย่าง *"OT Dashboard - AOTGA"* แต่จัดกลุ่มเป็น **3 แผนก** และแยกเป็น
**รายสัปดาห์ (W1–W4) + รายเดือน**

| แผนก | ความหมาย | ทีมที่รวมอยู่ |
|------|----------|----------------|
| **KP** | การโดยสาร | EK/UO/6B/BY/FY · SQ/CX/LY · EY/DV/AY · TR/6E/QP · WY/G9/9C/DK · JQ/IT/IX/AI/N0 · TK/VJ/SG/HY/OD · KC/LJ/KE/OZ/NO/AF · QR/MH/OM/DE · AK/QZ/8M · SU/B2/W5 · CHINA TEAM · Charter · ZF/EO/HH/LO/G2 · PG · SV/KA/WK · ADMIN DOC · ADMIN PORTER · OFFICE · Porter Crewsign |
| **LP** | Porter / บริการผู้โดยสารพิเศษ | PORTER · PVT (PRIVATE / VIP) |
| **LL** | ติดตามสัมภาระ | lOST AND fOUND · PORTER LL · ADMIN LL |

## ไฟล์ในโปรเจกต์

| ไฟล์ | บทบาท |
|------|--------|
| `apps-script/Code.gs` | backend เดิม + เพิ่ม route `?view=employees` |
| `apps-script/Index.html` | แดชบอร์ดเดิม (PSA/LL) — *ใช้ไฟล์เดิมของคุณในโปรเจกต์ Apps Script ได้เลย ไม่ได้ผูกกับฟีเจอร์ใหม่* |
| `apps-script/Employees.gs` | **ใหม่** — อ่าน 2 ไฟล์ แล้ว join เป็นรายงานรายชื่อ KP/LP/LL |
| `apps-script/EmployeeReport.html` | **ใหม่** — หน้าเว็บรายงาน (toggle แผนก, แท็บเดือน, ตารางรายชื่อ, Export CSV, Print) |
| `data/team_mapping.csv` | **ผลลัพธ์ที่ตรวจสอบแล้ว** — รหัสพนักงาน → ทีม → KP/LP/LL (836 คน) |

## แหล่งข้อมูล (join ด้วย "รหัสพนักงาน")

1. **OT Yearly** (`1zESOKHDpNqbkXxd3YV0EqVHv6JDeyPjKKpjwJsOMVQ0`)
   — ชั่วโมง OT รายคน **รายวัน** (ชีต pivot: คอลัมน์ = `DD/MM/YYYY-กะ/Hrs`)
2. **Pax Manpower Issue 02** (`1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8`)
   — ชีต **`Total`** = รหัสพนักงาน → ทีม / แผนก / ตำแหน่ง · ชีต **`Lists`** = สถานะ Active/Resigned

> โค้ดจัดกลุ่ม KP/LP/LL อยู่ที่ฟังก์ชัน `classifyDept_()` ใน `Employees.gs`
> (ติดตามสัมภาระ→LL, PORTER/PVT→LP, ที่เหลือ→KP)

## วิธีติดตั้ง

1. เปิดโปรเจกต์ Apps Script เดิม (ที่มี `Code.gs`, `Index.html`)
2. เพิ่มไฟล์ **`Employees.gs`** และ **`EmployeeReport.html`**
3. แทนที่ `doGet` ใน `Code.gs` ด้วยเวอร์ชันในไฟล์นี้ (เพิ่ม route `?view=employees`)
4. **แชร์ไฟล์ "Pax Manpower Issue 02" และ "OT Yearly" ให้บัญชีที่รัน Web App** (hktadminpsa@aotga.com)
5. Deploy → Web App → Execute as Me → Anyone with link
6. เปิดรายงานที่ `https://<webapp-url>?view=employees`

ลิงก์จากแดชบอร์ดหลัก (ออปชัน) — เพิ่มปุ่มใน `Index.html`:
```html
<a class="btn" target="_blank"
   href="<?= ScriptApp.getService().getUrl() ?>?view=employees">รายชื่อ KP/LP/LL</a>
```

## ✅ ตรวจก่อนใช้งานจริง (สำคัญ)

ผู้พัฒนาไม่สามารถรัน Apps Script แทนได้ จึงตรวจ classification จากไฟล์ mapping จริงแล้ว
(`data/team_mapping.csv`) แต่ **ตัวเลขชั่วโมง OT รายคน** ต้องให้ระบบดึงสด ดังนั้น:

1. ใน Apps Script Editor เปิด `Employees.gs` → รัน **`inspectEmployeeSources()`** → ดู Log
   - ควรเห็น `Mapping: ... → KP=… LP=… LL=…`
   - ควรเห็น `OT sheet: "<ชื่อชีต>" — NNN วัน, พนักงาน NNN คน`
   - ควรเห็นยอดรวมรายเดือนของแต่ละแผนก
2. ถ้าหา **ชีตรายคน** ใน OT Yearly ไม่เจอ (header ต้องมี `รหัสพนักงาน` + `ชื่อ - สกุล`
   + คอลัมน์ `DD/MM/YYYY-x/Hrs`) — ปรับ logic ใน `getEmployeeOT_()` ให้ตรงโครงสร้างจริง
3. ถ้าชีต/คอลัมน์ของไฟล์ mapping เปลี่ยน — ปรับ `EMP_CFG.mappingSheet` / `statusSheet`
4. ตั้ง `EMP_CFG.activeOnly = true` หากต้องการแสดงเฉพาะพนักงาน Active (เหมือนรายงาน PDF)

## สรุปจำนวนพนักงานต่อแผนก (จากไฟล์ mapping จริง — ชีต Total, 836 คน)

```
KP = 655   (CHINA 58 · QR 57 · TR 51 · EY 49 · SQ 48 · SU 43 · KC 42 · EK 39 ·
            Charter 37 · PG 37 · JQ 34 · WY 33 · AK 26 · TK 25 · SV 17 · OFFICE 16 ·
            Porter Crewsign 15 · ADMIN DOC 11 · ADMIN PORTER 4 · (ไม่ระบุทีม) 13)
LP =  94   (PORTER 76 · PVT 18)
LL =  87   (lOST AND fOUND 68 · PORTER LL 17 · ADMIN LL 2)
```
