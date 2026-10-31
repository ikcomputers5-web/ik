# 🖥️ IK Computers — All-in-One Print, Urdu Composing & Digital Shop Studio

A complete, unified web studio built specifically for **IK Computers** (Physical Composing, Laser Printing, Photostat & Digital Services Shop).

---

## ✨ Key Modules Included

### 0. 📲 Scan & Order Station (`کیو آر سے فائل وصول کریں`) — NEW
- **Customer sends the file, not a WhatsApp photo of it.** Print a QR sticker once, stick it on the counter. The customer scans it with their phone camera, picks the service (Print / Photostat, PDF edit, Composing, Passport photo, CNIC copy, Scan), chooses the file and taps send.
- **The file lands directly in the shop PC queue** — with the customer's name, phone number, the service they chose and any instructions.
- **Live transfer, no upload server needed**: files stream over the same hybrid transport as the mobile keyboard (WebRTC → shop LAN WebSocket → same-tab), so it also works on a hosted Vercel deployment.
- **Chunked + deduplicated transfer** (32 KB base64 chunks, 25 MB limit, live % progress, ordering-safe) — a dropped packet or a duplicate over two transports can never corrupt a customer file.
- **One-click hand-off**: PDF orders open straight in the PDF Editor (text already read), image orders open straight in the Image → PDF toner-saver cleaner.
- **Printable QR sticker** with shop name and Urdu instructions, copy-link for WhatsApp, and a station code you can regenerate anytime.
- Files live only in the browser tab: save anything you want to keep before refreshing.

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

### 3. 📄 Visual PDF Studio + 🤖 AI PDF Assistant (Edit, Replace, Merge & Split)
- **Visual PDF Page Editor**:
  - **Whiteout / Eraser Box**: Cover old dates, names, or form text cleanly on any PDF.
  - **✏️ Cover & Retype (`ڈھانپیں اور لکھیں`)** — the tool for phone photos and scans that have **no text layer at all**:
    - Press `R` (or click the tool), then click straight on the old text. A whiteout box (`26% × 5%`) is placed exactly there and a typing card opens in **free-text mode** — nothing has to exist in the PDF for this to work.
    - Type the replacement (Urdu or English — RTL is detected automatically), press `Apply`, and the new text is placed inside the box, right-anchored for Urdu, auto-shrunk until it fits, and typed at the same baseline as the old value.
    - `Delete box` removes the cover and the text together; **one `Ctrl+Z` undoes the whole action** (box + text = a single history step). `Esc` cancels before anything is written.
    - Works identically on real text-layer PDFs and on scanned images.
  - **Add Urdu Nastaliq or English Text**: Place real Nastaliq Urdu or English text anywhere on existing PDF pages (rasterised at ≈216 DPI so ligatures stay perfect in print).
  - **Place Signatures, Stamps, or Photos**: Drag & scale onto forms.
  - **Drag & Drop** any PDF straight onto the page, **Rotate / Delete / Re-order Pages**, optional **Page Numbering**.
  - **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y`), `Delete` to remove the selected edit, `Esc` to cancel a tool.
  - **True WYSIWYG** — the on-screen preview is produced by the exact same rasteriser that writes the final PDF, so what you see is what prints. Rotated pages are flattened at 260 DPI so they print correctly too.
- **📖 Automatic Text Reading + Click-to-Edit** — the moment you open a PDF, every line of its text layer is read in the background:
  - Open the **Text** panel to see the whole document as editable lines — search for a name, date or number across pages, then click a line and rewrite it.
  - Or pick the **Edit Text** tool and click straight on the page: the old glyphs are covered and the new text is typed in the same position, at the same size and direction (right-aligned for Urdu, left-aligned for English) — fully undoable with `Ctrl + Z`.
  - Long replacements are shrunk automatically to fit, with an honest warning when they may overlap neighbouring text.
  - `Enter` applies, `Shift+Enter` adds a line, `Esc` cancels; empty text deletes the line.
  - Copy all text or download the document text as `.txt` (useful for typing jobs).
- **🔍 Position-aware AI OCR — scans become click-to-edit (NEW)**:
  - Scanned pages (no text layer) are detected per page. The page card offers **“Read page with AI (OCR)”** and, once read, **“Re-read with AI”** with a live line count.
  - The AI returns **every visual line with its own box** (`{text, x, y, w, h}` fractions of the page, one object per line, price column kept separate from the description column, Urdu script preserved exactly).
  - Those boxes become real editable lines (`source: 'ocr'`, ids `OCR1…`), so the **Edit Text tool, the Text panel, search and the AI assistant all work on a scan exactly like on a real PDF** — click “2,200”, type “2,500”, Apply.
  - AI lines carry an amber **`approx position`** badge (with a tooltip) because the box is an estimate — check it before printing. Real text-layer lines always win: re-reading a normal PDF can never damage its click-to-edit lines.
  - After reading, the Text panel opens by itself and scrolls to the first AI line, so the operator immediately sees the page is editable.
  - Clicking **Edit Text** on a page with no text layer no longer dead-ends — it offers **Cover & Retype** and **Read page with AI** as one-click actions.
- **AI PDF Assistant (Groq)** — the shop's own "type an order" editor:
  - Upload the customer PDF and simply write, in **English / Roman Urdu / Urdu**:
    - `Replace the name Ahmed with Bilal` → the AI finds that exact text, white-outs it and types the new name in the same place, same size.
    - `Remove the phone number` → white-outs just that line.
    - `Add "For Bank Verification Only" at the bottom` → places new text exactly where asked.
  - The assistant reads the PDF's real text layer (line positions + font sizes), shows a **review list of proposed changes**, and only touches the document when you press **Apply** (fully undoable).
  - Also answers questions ("what does this document say?") and warns honestly when text cannot be found or when the PDF is a scan with no text layer.
  - Needs a free **Groq API key** (top bar → *Add Groq Key*); the key stays in the browser.
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
- **Retired-model proof model handling**: Groq removes model IDs without warning (the Llama 4 vision models were pulled). The app now asks `GET /models` for the live list, tries only models your key can actually use, **skips any retired ID automatically**, remembers the winning vision model (`ik_groq_vision_model_v1`) and puts it first next time. A dead `smartModel`/`fastModel` degrades to a working model instead of failing.
  - After **Test connection** the settings window lists every model as a **clickable chip** — 👁 marks the ones that can read photos/scans. Tap a chip to use it for Vision / Composing / Word suggestions; it is saved instantly and shown as `Vision: qwen/qwen3.8-27b ✓`.
  - Friendly, actionable errors: bad key → *“Your Groq key is invalid or expired…”*, throttled → *“Groq is rate-limiting. Wait 30 seconds…”*, nothing usable → *“No vision model is available on this key…”* with a shortcut to Groq settings.
- **Online Portal KB Compressor**: Compress JPGs to exact `≤ 15KB / 20KB / 30KB / 50KB / 100KB` for PPSC, FPSC, NTS, NADRA Pak-ID & Passport uploads.
- **IK Computers Quick Bill & Cash Receipt Printer**: Editable shop service rates + printable customer receipt.

---

## ☁️ Deploying to Vercel (1-Click Ready!)

This project is pre-configured for **Vercel** (`vercel.json` + serverless `/api/*` + WebRTC Peer-to-Peer Mobile Keyboard Sync):

1. Push / merge this branch to your GitHub repo (`ikcomputers5-web/ik`).
2. Go to [vercel.com/new](https://vercel.com/new) and import `ikcomputers5-web/ik`.
3. Click **Deploy** (Build Command: `npm run build`, Output Directory: `dist` — auto-detected from `vercel.json`).
4. Even on Vercel (`https://your-shop.vercel.app`), scanning the **Mobile Keyboard QR Code** pairs your phone directly to your Shop PC over **WebRTC Cloud Sync** — and the same transport carries the **Scan & Order** file queue.

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
