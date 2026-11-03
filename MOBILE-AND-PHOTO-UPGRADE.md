# IK Computers — Mobile Link, Background Remover & Passport Sheets

This document covers the work in this branch: what was actually broken, what was
missing for a real phone ↔ counter-PC connection, the rebuilt background remover,
the custom passport-photo sheet maker, and the new shop features.

---

## 1. Mobile / real-time connection — what was needed

The app already had three transports (WebRTC, LAN WebSocket, BroadcastChannel),
but the *connection* was unreliable in practice. These were the real gaps:

| Problem found in the code | Why it hurt | What was added |
| --- | --- | --- |
| `HybridMobileSync.send()` dropped a message when no transport was open yet | A customer who pressed **Send** in the first seconds got “sent” on the phone and nothing on the PC | Messages are now **queued** and flushed as soon as a channel opens (stale queue entries expire after 2 min) |
| No ICE servers configured in PeerJS | Phone on mobile data ↔ PC on shop Wi-Fi often never connected (no STUN/TURN) | Google/Twilio **STUN** defaults, plus optional TURN via `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` |
| PeerJS `unavailable-id` / `disconnected` were swallowed | After a reload the desktop silently stopped accepting phones | Automatic `peer.reconnect()` and a backoff retry for the desktop peer id |
| LAN WebSocket retried at a fixed 3 s forever | Slow recovery on flaky Wi-Fi, log spam | Exponential backoff (1 s → 10 s), reset on successful open |
| No way to know if the link is actually alive | “Connected” was a guess | Round-trip **ping/pong** with a real latency figure, `onStatus()` events, `waitForConnection()` |
| Customer saw “Sent ✓” even if nothing arrived | Confusing at the counter | The phone now waits for the PC's `order_done` acknowledgement and says **“Received by IK Computers”** or **“Sent — awaiting shop confirmation”** |
| Chunk loss was unrecoverable | Broken PDFs on the PC | The PC replies `order_missing`, the phone re-sends; duplicates are still de-duplicated by seq |
| Nobody could tell how to pair | “It doesn't connect” support calls | New **Connect a Phone** module with QR, address picker, connection checklist and a latency test |

### What you must do on the shop PC

1. Run the app (`npm run dev` or `npm start`) on the counter PC, or deploy to Vercel.
2. Open **Connect a Phone** in the sidebar (or **Scan & Order**).
3. Pick the QR target:
   * **This site** → works when the PC has internet (phone can be on 4G).
   * **Shop Wi-Fi (LAN IP)** → works with **no internet at all**; the phone must be on the shop router.
4. Print the sticker once and stick it on the counter.
5. Keep the counter page open — the PC tab *is* the server.

Optional, for very strict networks (mobile carriers that block peer-to-peer),
add a TURN server to `.env`:

```bash
VITE_TURN_URL=turn:your-turn-host:3478
VITE_TURN_USERNAME=shop
VITE_TURN_CREDENTIAL=secret
```

---

## 2. Background remover — why it was not efficient

The old studio called the neural `@imgly/background-removal` model **for every
photo**. That means a ~40 MB model download on first use, several seconds per
photo on a shop PC, and a hard failure when there is no internet. It also had no
edge softening, so cut-outs had a white halo around hair and shoulders.

The new implementation (`src/lib/bgRemoval.ts`) has two engines:

**Instant Cutout (default, fully offline)**

* Builds a wall-colour palette with k-means from the **top and upper sides** of
  the photo only.
  *This fixed a serious bug: sampling the bottom border taught the old logic that
  a customer's shoulders were “background”, so it erased the person.*
* Flood-fills from the border, then builds a **soft alpha ramp** instead of a hard
  mask — this is what removes the halo.
* Despeckle pass, optional matte erosion (“Shrink”), and a box-blur feather.
* Upsamples the matte to full resolution with bilinear filtering.
* **80–140 ms** on a typical photo (measured), versus seconds before.
* Safety net: if the subject fills the whole frame, it returns the original photo
  with a clear warning instead of handing over an empty PNG.

**AI HD (optional)**

* Same neural model as before, but dynamically imported, cached in memory, only
  re-run when the *engine* changes (not on every slider move), with a real
  progress bar and a friendly message if the model cannot be downloaded.

Also new in the studio:

* Live re-processing while dragging tolerance/feather/shrink (debounced).
* **Touch-Up brush with Undo** (previously the brush drew to a hidden canvas and
  never reached the result).
* Drag-and-drop upload, engine badge with the measured time, subject coverage and
  megapixel readout, “Download trimmed PNG” for portal uploads, 7 backdrop
  presets + custom colour, settings remembered between customers.

---

## 3. Custom passport-size photo sheets

The old sheet screen could only pick from four fixed layouts, always filled the
page, and had a fragile transparent-PNG centring step. Rebuilt on top of
`src/lib/photoSheet.ts`:

* **“How many photos do you need?”** — type any number (1–400). The app works out
  the grid, and if the number does not fit on one page it generates **multiple
  pages** automatically (previews, a single multi-page PDF, and a print run).
* **Custom sizes** — photo size in millimetres (any value) and paper size in
  millimetres, plus presets: Pakistan passport/NADRA 35×45, US visa 2×2, UK /
  Schengen, Canada, Saudi/Umrah, CNIC 30×40, NTS 30×35, stamp 25×30, driving
  licence, and papers 4×6, 5×7, 3.5×5, A4 (both orientations), A5, Letter.
* **Several customers on one sheet** — add multiple photos, give each a share of
  the quantity (round-robin), and frame/backdrop each one independently.
* **Face-aware framing** for cut-outs (head high, chin near the centre, shoulders
  cut at the bottom edge), with per-photo zoom and head position.
* **Cut guides**: none / corner marks / dashed / hairline, plus an optional shop
  note printed on the sheet.
* **Single PNG export** at exact portal pixels (35×45 mm at 300 DPI = **413×531**).
* Accurate 300 DPI maths throughout (verified: 4×6 in = 1800×1200 px, 35×45 mm
  tile = 413×531 px).

---

## 4. New features

### Job Tickets & Daily Cash (new module)

* One ticket per counter job: customer, phone, service, copies, details, price,
  paid, status (Pending → Working → Ready → Delivered / Cancelled).
* Prints an 80 mm thermal-style slip with the ticket number, and a full **A4 day
  register** at closing time.
* Live day summary: open jobs, delivered, billing, outstanding cash, and a
  breakdown by service.
* **WhatsApp “your work is ready”** button using the shop's own message.
* CSV export for bookkeeping, plain-text day summary for WhatsApp.
* Shop name / phone / address are editable and used on tickets, print-outs and the
  customer's phone page.
* Tickets arrive automatically from **Scan & Order** (the `+ Ticket` button on a
  received file) so counter staff do not retype anything.

### Connect a Phone (new module)

* One QR with an address selector (this site / shop Wi-Fi IP / custom), printable
  sticker, live device count, transport name and measured latency.
* Connection checklist (secure page, phone linked, LAN address found, internet
  available) and a latency test button.
* Explains the three transports in plain language so staff can fix pairing alone.

### Scan & Order improvements

* Incoming files can go **straight to the Passport Sheet studio** or become a
  **job ticket** in one click.
* Chime when a file arrives (toggleable), real “Received / awaiting confirmation”
  state on the phone, 40 MB limit, live link + latency badge.

### Customer phone page improvements

* Shows the shop's real name and phone number.
* Copy-count picker for print / passport / CNIC jobs.
* Honest progress (“Connecting… 12 s”, then “Received by IK Computers” only when
  the PC confirms).

---

## 5. Files touched

```
src/lib/bgRemoval.ts          NEW  fast offline cutout + AI wrapper + alpha tools
src/lib/photoSheet.ts         NEW  sheet layouts, custom sizes, quantities, PDF
src/lib/jobLedger.ts          NEW  job tickets, day summary, CSV, shop settings
src/lib/mobileSync.ts         REW  queueing, ICE/TURN, ping/pong, reconnect, events
src/lib/orderSync.ts          REW  confirm/ack/missing-chunk recovery, 40 MB
src/components/BackgroundRemoverStudio.tsx  REW
src/components/IdAndPassportStudio.tsx      REW
src/components/JobTicketRegister.tsx        NEW
src/components/MobileConnectHub.tsx         NEW
src/components/ScanOrderStation.tsx         upd
src/components/MobileOrderView.tsx          upd
src/components/UrduComposer.tsx             upd  (live transport/latency status)
src/App.tsx                                 upd  (new modules, hand-offs)
src/index.css                               upd  (multi-page print rules)
```

## 6. Verification done

* `tsc --noEmit` clean, `vite build` succeeds.
* Cut-out engine exercised against synthetic photos (plain wall, noisy wall +
  vignette + white shirt, subject-touching-bottom-edge, subject filling the whole
  frame): correct alpha in all cases, boundary ramp 0 → 85 → 170 → 255, 80–140 ms.
* Sheet engine exercised: 8 tiles per 4×6 in page, white paper between tiles,
  backdrops applied, 413×531 px single photo, empty sheet handled gracefully.
* Quantity maths: 12 photos → 2 pages, 16 split across 3 people → 6/5/5, weighted
  3:1 → 7/3.
