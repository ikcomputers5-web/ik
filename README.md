# 🖥️ IK Computers — All-in-One Print, Urdu Composing & Digital Shop Studio

A complete, unified web studio built specifically for **IK Computers** (Physical Composing, Laser Printing, Photostat & Digital Services Shop).

---

## ✨ Key Modules Included

### 1. 📝 Urdu & English Composing Studio (`آئی کے اردو کمپوزنگ اسٹوڈیو`)
- **📱 Live Mobile Urdu Keyboard Pairing (WebSocket + QR Code)**:
  - Click **"Use Mobile Keyboard"** in the Urdu Composer → scan the QR code on your smartphone!
  - Type or use **Voice-to-Urdu Mic** on your phone's native Urdu keyboard (Gboard / iOS / Samsung Urdu) — every word appears **live at the PC cursor** in real time!
- **💡 Multi-Layer Smart Urdu Word & Phrase Suggestions**:
  - Instant built-in Urdu dictionary + Pakistani official phrase bigrams (`بخدمت جناب`, `مؤدبانہ گزارش ہے کہ`, `شناختی کارڈ نمبر`, `عین نوازش ہوگی`) + Roman-to-Urdu (`darkhwast` → `درخواست`, `guzarish` → `گزارش`) + custom learned shop vocabulary + **Groq AI live context suggestions**!
  - Pick suggestions with click, `Tab`, or `Alt + 1..8`.
- **3 Desktop Input Modes**:
  - **Phonetic Urdu (InPage style)** + Interactive On-Screen Urdu Keyboard (`Ctrl + Space` quick toggle)
  - **Roman Urdu → اردو** auto-transliteration
  - **English**
- **Stamp Paper Mode (`اسٹامپ پیپر`)**:
  - Adjustable top blank margin (`1.5"` – `5.5"`) so affidavits (`بیانِ حلفی`) and agreements (`اقرار نامہ` / `کرایہ نامہ`) print cleanly below the Rs. 100 / 1200 stamp header!
- **8 Ready-to-Print Pakistani Shop Templates**:
  - School/College Application, Police Lost CNIC Report, WAPDA/LESCO Meter Application, Stamp Paper Affidavit (`بیانِ حلفی`), Rent Agreement (`کرایہ نامہ`), Vehicle Sale Iqrarnama, Public Notice, and Formal English Application.
- **Offline Bundled Urdu Fonts**: `Noto Nastaliq Urdu`, `Gulzar Nastaliq`, `Noto Naskh Arabic`.
- **Export & Print**: Clean `Ctrl+P` Print Sheet + `.DOC` Word Export + Auto-save (load-shedding safe!).

### 2. 🪪 Dedicated Front & Back ID Card (CNIC) A4 Page Maker (`شناختی کارڈ فرنٹ بیک پیج میکر`)
- **Direct WhatsApp Web `Ctrl + V` Paste**: Copy customer Front & Back ID card photos directly from WhatsApp Web and press `Ctrl + V` — auto-advances from Front to Back!
- **Interactive Card Crop & Straighten**: Drag-crop away surrounding table/bedsheet, rotate `90°`, and straighten tilt (`-15°` to `+15°`).
- **Face-Safe CNIC Photostat Enhancer**: Special NADRA portrait-safe B&W filter whitens shadows/glare while keeping the person's portrait face clear and text crisp!
- **All Pakistani Print Shop Layouts**:
  - **Side-by-Side (`[Front] [Back]`)**, **Top & Bottom Stacked**, or **2-Page Mirrored Duplex**
  - **`1x`, `2x`, `3x`, `4x`, or `8x` copies** on a single A4 page
  - **Exact NADRA 1:1 (`85.6 × 54 mm`)**, **110% Enlarged**, or **125% Large**
  - **Paper Saver Position**: Print at **Top**, **Center**, or **Bottom Half of A4** (reuse half-printed A4 sheets!)
  - Optional security stamp line (e.g. `FOR BANK VERIFICATION ONLY`), rounded card corners, 1-click A4 Print & 300-DPI PDF/JPG download.

### 3. 📄 Visual PDF Studio (Edit, Whiteout, Merge & Split)
- **Visual PDF Page Editor**:
  - **Whiteout / Eraser Box**: Cover old dates, names, or form text cleanly on any PDF.
  - **Add Urdu Nastaliq or English Text**: Place connected Nastaliq Urdu or English text anywhere on existing PDF pages.
  - **Place Signatures, Stamps, or Photos**: Drag & resize onto forms.
  - **Rotate / Delete Pages** & optional **Page Numbering**.
- **Merge Multiple PDFs** & **Split / Extract Specific Page Ranges**.

### 3. 🖼️ Image → PDF & WhatsApp Document Cleaner (`Toner Saver`)
- **Magic B&W Toner Saver Filter**: Removes dark gray camera shadows from customer WhatsApp document photos so laser printers print crisp black text on pure white backgrounds without wasting toner!
- Multi-image reorder, rotate `90°`, brightness/contrast, `1 / 2 / 4 images per A4 or Legal page`.

### 4. ✂️ 100% Local AI Background Remover & Signature Extractor
- **AI Neural HD Cutout**: Runs locally via WebAssembly/ONNX — no paid BG-removal API needed!
- **Signature & Stamp Transparent Extractor**: Turn photos of signatures/stamps on paper into transparent PNGs to place onto PDFs.
- **1-Click Passport Backdrop Colors** (Passport Blue `#0057b7`, Sky Blue, Pure White, Red) + Touch-Up Eraser + **1-Click Send to Passport Sheet Maker**.

### 5. 🪪 Passport Photo Sheet & CNIC Front/Back A4 Copier
- **300-DPI Passport Photo Sheet**: Pakistan Passport / NADRA (`35×45 mm`), US Visa (`2×2 in`), Stamp size on **`4×6"` Photo Paper (8 pcs)** or **`A4` (8, 16, or 30 pcs)** with scissor cut lines.
- **CNIC (`شناختی کارڈ`) Front & Back A4 Copier**: Drop Front + Back WhatsApp photos → auto-scales to exact real-world NADRA ID size (`85.6 × 54 mm`), cleans gray shadows, and prints `1, 2, or 4 copies` on a single A4 sheet!

### 6. 🎓 Quick CV / Resume Builder
- Modern Corporate & Classic Pakistani Official CV (with Father's Name, CNIC, Domicile, Marital Status, Qualification Table) + **Groq AI Career Objective Polisher**.

### 7. 🤖 Groq AI Hub, `<20KB` Portal Compressor & Shop POS Bill Counter
- **Groq API Key Support**: Powers AI Urdu/English Document Writer, **Photo-to-Text Vision OCR** (extracts Urdu & English text from photographed papers!), Roman-Urdu converter, and translator.
- **Online Portal KB Compressor**: Compress JPGs to exact `≤ 15KB / 20KB / 30KB / 50KB / 100KB` for PPSC, FPSC, NTS, NADRA Pak-ID & Passport uploads.
- **IK Computers Quick Bill & Cash Receipt Printer**: Editable shop service rates + printable customer receipt.

---

## ☁️ Deploying to Vercel (1-Click Ready!)

This project is pre-configured for **Vercel** (`vercel.json` + serverless `/api/*` + WebRTC Peer-to-Peer Mobile Keyboard Sync):

1. Push / merge this branch to your GitHub repo (`ikcomputers5-web/ik`).
2. Go to [vercel.com/new](https://vercel.com/new) and import `ikcomputers5-web/ik`.
3. Click **Deploy** (Build Command: `npm run build`, Output Directory: `dist` — auto-detected from `vercel.json`).
4. Even on Vercel (`https://your-shop.vercel.app`), scanning the **Mobile Keyboard QR Code** pairs your phone directly to your Shop PC over **WebRTC Cloud Sync**!

---

## 🚀 Running Locally on Your Shop PC (IK Computers)

```bash
npm install
npm run dev
```

Open **`http://localhost:5173`** on your shop PC.
To type Urdu from your mobile phone, make sure your phone and PC are on the same shop Wi-Fi, click **"Use Mobile Keyboard"** inside the Urdu Composer, and scan the QR code!

For production mode:
```bash
npm run build
npm start
```
