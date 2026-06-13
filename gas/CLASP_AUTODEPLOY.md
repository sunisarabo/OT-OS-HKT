# Auto-deploy: push repo → clasp push เข้า Apps Script อัตโนมัติ

Workflow: `.github/workflows/clasp-deploy.yml`
ทำงานเมื่อมี push เข้า repo และไฟล์ใน `gas/` เปลี่ยน → รัน `clasp push` ลงโปรเจกต์ OT (`1P4yLmg…`)

## ตั้งครั้งเดียว: ใส่ secret CLASPRC_JSON
clasp เก็บ token ล็อกอินไว้ที่ `~/.clasprc.json` บนเครื่องที่ `clasp login` แล้ว

1. ดูเนื้อหา token (รันบนเครื่อง Mac ที่ login clasp ไว้):
   ```bash
   cat ~/.clasprc.json
   ```
2. ก๊อปทั้งก้อน (ทั้ง JSON)
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `CLASPRC_JSON`
   - Secret: วางเนื้อหา `~/.clasprc.json` ทั้งหมด
4. เสร็จ — ครั้งต่อไปที่ไฟล์ใน `gas/` ถูก push เข้า repo จะ deploy เองอัตโนมัติ
   (ดูสถานะที่แท็บ **Actions** ของ repo)

> หมายเหตุความปลอดภัย: `~/.clasprc.json` มี OAuth refresh token — เก็บเป็น GitHub Secret เท่านั้น (repo เป็น private) อย่า commit ลงโค้ด
> ถ้า token หมดอายุ/เปลี่ยน ให้ `clasp login` ใหม่แล้วอัปเดต secret
> Deploy เว็บแอปเวอร์ชันใหม่ยังต้องทำใน Apps Script UI (clasp push อัปเดตโค้ด ส่วน /dev ใช้โค้ดล่าสุดเสมอ)
