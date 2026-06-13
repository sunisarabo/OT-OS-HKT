# เพิ่มลิงก์ "รายชื่อพนักงาน" บนแถบ Dashboard (Webapp.gs)

ในฟังก์ชัน `_wa_wrapWithSwitcher` หาแถวนี้ (ในส่วน template `<div class="wa-control">`):

```html
<span class="title">📊 OT Dashboard — ${cfg.REPORT_DEPT_CODE}</span>
```

เพิ่มบรรทัดนี้ **ต่อท้าย** (baseUrl มีอยู่แล้วในฟังก์ชันนี้):

```html
<a href="${baseUrl}?view=employees" target="_top" style="color:#fff;text-decoration:underline;font-size:12px;font-weight:700;margin-right:14px">👥 รายชื่อ KP/LP/LL</a>
```

→ จะได้ปุ่มลิงก์บน Dashboard กดไปหน้ารายชื่อพนักงานได้ (และหน้ารายชื่อมีปุ่ม "📊 Dashboard ภาพรวม" กดกลับ)
