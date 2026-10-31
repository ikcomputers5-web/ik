# IK Computers Studio — Improvement Plan & New Feature Ideas

_A practical review of the current codebase + a prioritized roadmap of new features for the shop._

> **Status (updated):** two of the top ideas below are now **built and shipped on this branch**:
> - **B3 — QR Scan-to-Order** → `Scan & Order Station` module + `/?order=CODE` customer page.
> - **New — Automatic PDF text reading & click-to-edit** → the PDF Editor now reads every line of a PDF on upload and lets you rewrite it in place (plus OCR fallback for scans).
>
> The rest of the roadmap below is still open — see Part 5 for what to build next.

---

## 0. Quick verdict

**What you have is strong.** Nine working modules, real Urdu/Nastaliq handling, local AI (no paid APIs for cutouts), WebRTC mobile keyboard, PDF text-layer AI editing. That is already better than most commercial print-shop software sold in Pakistan.

**What is missing is not more tools — it is the "shop memory" layer.** Right now the app is a set of excellent *individual tools*. It does not remember a customer, a job, a price, or a day's sales. Every honest improvement below points at that gap.

The three highest-value gaps, in order:

| Gap | Why it costs you money today |
|---|---|
| **No job/customer record** | Repeat customers re-explain their work every visit. You cannot prove what you delivered. |
| **No offline resilience** | Load-shedding or a dropped connection mid-compose loses work; the app cannot even open without the server. |
| **No daily cash summary** | You cannot tell at 9 pm whether today was good, or which service actually earns. |

Everything in Part 2 builds on fixing those three.

---

## Part 1 — Fix & polish what already exists

These are not new features. They are small fixes with outsized daily impact.

### 1.1 Reliability (do these first)

| # | Issue | Where | Fix | Effort |
|---|---|---|---|---|
| 1 | **Only the Urdu composer auto-saves.** Every other studio (PDF edits, ID card layout, POS bill, CV, compressor) loses everything on refresh or power cut. | `UrduComposer.tsx:58` has `ik_urdu_composer_autosave_v1`; nothing else persists | A shared `usePersistentState()` hook (localStorage + debounce) applied to each studio's core state | S |
| 2 | **No error boundary.** One bad PDF or corrupt image throws and the whole app goes white — mid-customer. | `App.tsx` | Wrap each module in an `<ErrorBoundary>` with a friendly Urdu/English "this file could not be opened" card and a Reset button | S |
| 3 | **No confirmation on destructive actions.** "Delete page", "clear edits", "reset rates" are one click. | `PdfStudio.tsx`, `ShopUtilitiesHub.tsx` | Confirm dialog for irreversible actions only | S |
| 4 | **Uploads accept any file size.** A 200 MB scan will freeze a low-RAM shop PC. | All `<input type="file">` | Add a size guard (e.g. 40 MB) + a clear message before decoding | S |
| 5 | **State resets when switching modules.** Handoffs exist (`passportIncomingPhoto`, `composerIncomingHtml`) but a half-finished PDF job is lost on navigation. | `App.tsx` module switching | Keep modules mounted (hide instead of unmount) or persist their state | M |
| 6 | **Groq failures are silent or generic.** If the key is invalid, expired, or rate-limited, the user sees a vague error. | `groqClient.ts:53,115,270` | Map 401/429/network to plain messages: "Key expired — re-enter in top bar", "Too many requests, wait 30s" | S |

### 1.2 Offline / load-shedding (the single biggest UX win)

Right now the app is served by `server/index.js` and needs it running. For a shop with 6–8 hours of load-shedding a day, this should be a **PWA**:

- `manifest.webmanifest` + installable on the shop PC and on your phone (own icon on desktop, no browser bar).
- A service worker that caches the app shell + fonts + WASM models (bg-removal, MediaPipe, pdf.js worker) on first load.
- **Result:** the app opens and works with **zero internet**. Only the Groq AI features degrade, and they should show "AI offline — everything else still works".
- Add a tiny offline badge in the top bar so the operator knows why AI buttons are dimmed.

Effort: **M** · Impact: **very high** · Risk: low (cache-only, no data loss risk).

### 1.3 Performance

- **Code-splitting.** All nine studios load up front. `@imgly/background-removal`, `pdfjs-dist`, `peerjs` and MediaPipe are heavy. Use `React.lazy()` per module — first paint should drop noticeably on an old shop PC.
- **First-load size:** check with `npm run build`; aim for the initial chunk under ~300 KB gzipped.
- **Image memory leaks:** object URLs created from `URL.createObjectURL` should be revoked on unmount; long sessions with many passport photos currently grow memory until restart.
- **Big-file PDFs:** process pages on demand rather than rasterising the entire document on open.

### 1.4 Urdu / typography correctness

- Nastaliq needs a guaranteed line-height and no letter-spacing; verify `Gulzar` and `Noto Nastaliq Urdu` both render at 9–14 pt print sizes without clipping descenders in the print sheet.
- **RTL in exported `.DOC`:** Word export often loses bidi ordering. Add `dir="rtl"` + `w:rtl` in the exported HTML wrapper so pasted Urdu keeps shape in MS Word.
- **Numbers:** keep Latin digits for CNIC, phone numbers, and amounts even inside Urdu sentences — mixed Arabic-Indic digits look wrong on official forms.
- **Print margins:** add a "safe print area" guide and let the shop set their printer's non-printable margin once (saved per printer profile).

### 1.5 Code health (quick, keeps the app from rotting)

- **`PdfStudio.tsx` is 1440 lines and `IdCardPageMaker.tsx` is 1072.** Split each into `hooks/` + small presentational components. Future edits become 10× faster and less risky.
- **No tests at all.** You do not need 90% coverage. Add ~15 unit tests on the functions that would silently corrupt a customer's document:
  - `urduEngine.ts` — phonetic mapping, Roman→Urdu transliteration
  - `pdfText.ts` — text-layer extraction and line grouping
  - `pdfOverlay.ts` — coordinate/units conversion (pt vs px vs mm)
  - `imageFilters.ts` — white-balance / toner-saver thresholds
  - `mobileSync.ts` — room code handling
  Use Vitest — it plugs into Vite with almost no config.
- **Type safety:** `tsconfig.json` — enable `"strict": true` incrementally, module by module.
- **Dead duplication:** README has two sections numbered "3️⃣". Minor, but tidy it.

### 1.6 Security & deployment reality check

- The Groq API key lives in `localStorage` and is sent from the browser. That is acceptable for a **single-shop private PC**, but be explicit about it:
  - If the app is on a public Vercel URL, anyone who opens it uses **your** key only if it is stored in code — it is not, so this is fine. But never commit a key.
  - Add a "Forget key" button and a "Test key" button (models call) in `GroqSettingsModal`.
- The Express server sets `Access-Control-Allow-Origin: *`. Fine on a LAN, but if you ever host it publicly, restrict it.
- `express.json({ limit: '25mb' })` — make sure `/api/*` does not accept arbitrary uploads you do not need.

---

## Part 2 — New features (grouped by what they earn you)

I have marked each with **why it matters** and effort. ★ = my top picks.

### A. Shop memory — customers, jobs, money ★★★

**A1. Job Ticket / Order Register** ★
Every piece of work gets a ticket: customer name + phone, service type, quantity, price, status (Received → In Progress → Ready → Delivered), and the file/photo attached.
- One-click "New Job" from **inside any studio** — the current document/image is auto-attached to the ticket.
- Search by phone number: type `0300…` and see every past job for that customer.
- Printable/WhatsApp-able job slip with a token number (`A-014`) — ends the "mera kaam ho gaya?" queue chaos.

**A2. Customer Ledger & Udhaar (اُدھار) Khata** ★
Print shops run on credit. A simple ledger: who owes what, since when, and a "Paid" button.
- Daily/weekly "recovery list" you can WhatsApp in one tap.
- Optional advance-payment field for big jobs (thesis binding, wedding cards).

**A3. Daily Cash Summary & Reports** ★
End-of-day auto summary: jobs completed, total billed, cash vs credit, top service, busiest hour.
- Export a month's CSV for your accountant — no more notebook.
- "Which service actually earns?" chart: composing vs prints vs passport photos vs lamination. This alone often changes a shop's pricing.

**A4. Price Calculator / Quotation Sheet**
Customer asks "100 color copies ka kitna hoga?" → tap the rate card, show a clean quotation, print or WhatsApp it. Converts to a job ticket in one click.

**A5. Rate Card Manager**
The POS already has editable rates (`ik_pos_rates_v1`). Promote it to a proper rate card: per-service, per-size (A4/Legal/A3), color vs B&W, with "customer type" pricing (walk-in / student / bulk).

### B. Customer-facing & WhatsApp ★★★

**B1. WhatsApp Send from Every Module** ★
Rather than only printing, add "Send on WhatsApp" that opens `wa.me` with the shop name, job token, amount and a short Urdu message. Works for: job slip, bill, quotation, recovery reminder, passport-ready notification.

**B2. "Your file is ready" link**
Upload the finished PDF to the server (or a free object store) and send a **short link + QR**. Customer downloads it; no WhatsApp file-size limits, no "please send again".

**B3. QR Scan-to-Order Page**
A stand-sticker with a QR: the customer scans, picks a service (photostat / composing / passport photo), uploads their file from their phone, and it appears **in the shop PC queue instantly** — reusing the WebRTC/WebSocket plumbing you already built for the mobile keyboard. This turns your app into a self-service intake counter.

**B4. Digital Shop Receipt with QR**
Printed receipt with a QR that opens the job status page. Feels modern and kills disputes.

### C. New print-shop tools (high demand in Pakistan)

**C1. Utility Bill / Bank Statement / Form Editor Pack** ★
Already the #1 recurring task at any shop. Built on top of your existing PDF studio:
- One-tap "fill a form" mode: click a blank line, type, auto-fit font size to the field.
- Saved field templates for the forms you see weekly (bank account opening, PTCL/LESCO, school admission, NADRA).
- Restricted "NTS/PPSC/FPSC application form" mode with photo + signature boxes that auto-resize to the required KB and mm — combining your compressor + passport tools in one flow.

**C2. Bank Challan / Fee Challan Printing** ★
Very high volume, very repetitive. A template library + copy-count selector + auto total-in-words (Rupees in words in Urdu and English).

**C3. Rupees in Words**
Small but used constantly: `Rs. 12,450` → `بارہ ہزار چار سو پچاس روپے` and `Twelve Thousand Four Hundred Fifty Rupees Only`. Needed on bills, agreements, affidavits, quotations.

**C4. Wedding / Nikkah Card & Invitation Composer**
Extend the Urdu composer with card layouts (Nikkah nama, wedding card, aqeeqa, condolence banner) with 2/4/8 cards per A4 and bleeding/cut marks. Seasonal but very profitable.

**C5. Banner / Panaflex / Sticker Sizing**
A "large format" mode: input banner size in feet/inches, set DPI, auto-tile the artwork across A4 sheets for cheaper inkjet printing (with glue overlap marks). Shops often do this by hand today.

**C6. Lamination / Binding Job Sheet**
Cheap to build, expected by customers: front sheet, back sheet, spine label, order slip.

**C7. Photo Restoration / Old Photo Reprint**
Real demand: old family photos to enlarge for framing. Use your bg-remover + upscaling + auto-levels + "remove yellow tint" preset, then print to a chosen photo size.

**C8. Typing Speed / Dictation Mode**
For customers who just read out a letter: a big "listen and type" pane — operator types Roman Urdu, auto-converts, and can hit `Tab` to accept suggestions. Mostly UX around what `urduEngine.ts` already does.

**C9. Stamp / Token / Card Design Studio**
Repeat job for shops: "20 visiting cards", "stamp banana hai". A simple 2-side card template (90×55 mm) grid printer, plus a rubber-stamp designer with mirror-output for stamp making.

**C10. Mobile Wallet / Easypaisa QR on the Bill**
Given Pakistan's payment habits, a Jarvis/Easypaisa/JazzCash QR on every printed bill is a small, real upgrade.

### D. AI upgrades (you already pay for Groq)

**D1. Two-way Document Q&A with citations** — "is this stamp paper valid for a rent agreement?" style questions answered **from the uploaded document only**, with the page/line quoted. Prevents hallucinated advice.

**D2. Auto-detect & Fill** — upload a filled sample + a blank copy, and the AI copies the *pattern* (same fields, new values). Extremely strong for recurring forms.

**D3. Urdu → English official translation** with letterhead preservation, and an English → Urdu version that respects official register (`مؤدبانہ گزارش ہے کہ`).

**D4. Spell & grammar check for Urdu** using a local word list first, AI for the rest. Shops get embarrassed by a typo on an affidavit.

**D5. Receipt/Invoice OCR → Job Ticket** — photograph a handwritten slip and turn it into a job entry. Ambitious; do it later.

**D6. AI cost guardrails** — per-day token budget, a visible "AI calls today: 12 / 100" counter, and automatic fallback to local dictionaries when the budget is hit (you already have offline dictionaries to fall back on).

### E. Multi-device & multi-staff

**E1. Two-PC sync.** Many shops have a composing PC and a printing PC. Sync job register + rate card over the LAN (or a tiny hosted backend). Even read-only mirroring is useful.

**E2. Operator accounts.** Owner vs operator: operators cannot see the ledger or change rates. Important the moment you hire.

**E3. Phone as a second screen** — you already have WebRTC pairing for the keyboard. Extend it: phone camera becomes your scanner, phone becomes a remote "print this" trigger.

**E4. Cloud backup + restore** — one button that exports everything (localStorage + job register + rate card) as a single `.json` file, plus optional auto-backup. This protects years of shop history from one dead hard disk.

### F. Small delights that cost almost nothing

- **Keyboard shortcut cheatsheet** overlay (`?` key) — you already have many shortcuts, but they are undiscoverable.
- **Dark/light toggle** — the dark theme is great at night, hard in daylight; print shops often prefer light.
- **Malal / large-UI mode** — one toggle that scales the UI 125% for readability on a 15" monitor.
- **Recent files tray** — last 10 files opened, re-open in one click.
- **"Toner saver" applied by default** for B&W scans, with a visible on/off chip.
- **Urdu-first UI toggle** — currently menus are English-primary with Urdu labels; some operators read only Urdu.
- **Offline "what changed" notes** — a small changelog so the operator knows when a button moved.

---

## Part 3 — Recommended roadmap

### Now (next 1–2 weeks) — reliability and money
1. Error boundaries + persistent state across all modules (1.1)
2. PWA + service worker, installable, offline-capable (1.2)
3. **Job Ticket register** with token numbers and WhatsApp slip (A1, B1)
4. **Daily cash summary** + CSV export (A3)
5. Rupees in words (C3) — a 60-line utility that shows up everywhere

### Next (3–6 weeks) — the shop system
6. Customer ledger / udhaar khata + recovery reminders (A2)
7. Rate card manager + quotation sheet (A4, A5)
8. Form-fill templates for utility bills & bank challans (C1, C2)
9. Code-splitting + Vitest suite for the risky lib functions (1.3, 1.5)
10. Cloud backup / restore (E4)

### Later (quarter) — the differentiator
11. QR scan-to-order intake page (B3)
12. Wedding card composer + banner tiling (C4, C5)
13. Two-PC sync + operator accounts (E1, E2)
14. AI document Q&A with citations, auto-detect & fill (D1, D2)

---

## Part 4 — Three specs, ready to build

### Spec 1: Job Ticket Register (the keystone)

**Data model** (localStorage key `ik_jobs_v1`, later a server table):
```ts
type JobStatus = 'received' | 'working' | 'ready' | 'delivered' | 'cancelled';
type Job = {
  id: string;            // "A-014"
  createdAt: number;
  customer: { name: string; phone: string };
  service: string;       // from rate card
  description: string;
  qty: number;
  price: number;         // rupees
  paid: number;          // supports partial payment
  status: JobStatus;
  dueAt?: number;
  attachment?: string;   // data URL or filename reference
  notes?: string;
};
```
**Screens**
- `Jobs` module: today's board in four columns (Received / Working / Ready / Delivered), drag or tap to advance.
- Search box: name or phone, instant.
- Job detail: itemised, printable slip (55×40 mm or A5), WhatsApp button, "mark paid".
- End-of-day: cash in, credit out, jobs delivered, top service.

**Nice details**
- Auto token per day, resets at midnight.
- Long-press a job to duplicate it (the same customer comes back for 50 more copies).
- "Delivered" jobs auto-hide after 7 days but stay searchable.

### Spec 2: Offline PWA

- Add `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
- Precache: app shell, fonts you bundle, `pdf.worker`, MediaPipe + bg-removal model files.
- Runtime caching: `StaleWhileRevalidate` for models, `NetworkOnly` for `api.groq.com`.
- Show a toast: *"Offline mode — AI features paused, printing works."*
- Add an "Update available — reload" prompt so a deployed fix actually reaches the shop PC without a manual restart.

### Spec 3: Rupees in Words

One pure function, used by bills, quotations, agreements and affidavits:
```
1234567 → "بارہ لاکھ چونتیس ہزار پانچ سو سڑسٹھ روپے"
        → "Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Rupees Only"
```
Use the **Lakh/Crore** system (not millions) for English too — that is how Pakistani customers and banks read it. Add a unit test with ~20 tricky cases (teens, hundreds, exact thousands, paisa).

---

## Part 5 — What I would build first, if you want me to

My recommendation is one coherent slice rather than nine scattered buttons:

> **Job Register + Offline PWA + Rupees in Words + WhatsApp job slip.**

That combination turns nine separate tools into "the shop's system", works during load-shedding, and every new feature after that has somewhere to live.

Tell me which of these you want and I will implement it on this branch:

1. **Only the Job Register** (fastest visible win)
2. **Job Register + offline PWA** (recommended)
3. **Just the offline PWA** (protect the current tools first)
4. **Just the small fixes in Part 1** (1–2 hours of work, low risk)
5. **A different item from Part 2** — name it
