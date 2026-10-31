// IK Computers — Direct "click the text and edit it" engine
//
// The AI assistant turns a *sentence* into edits. This module does the other
// half of the job: it takes one real text line that PDF.js found in the file
// and produces the concrete overlays (white-out + replacement text) needed to
// rewrite it in place, keeping the original position, size and direction.
//
// It also owns the two scan-friendly paths:
//   • ocrBoxesToLines()       — AI-read boxes → clickable/editable text lines
//   • buildFreeTextOverlays() — "Cover & Retype": whiteout + retyped text in a
//                               box, working identically on scans and real PDFs
//
// Nothing here mutates the original PDF — every change is an overlay, so it
// stays undoable and the export path is the one already proven by the editor.

import { fitTextOverlay, lineHeightFactor, newOverlayId, type PdfOverlay } from './pdfOverlay';
import { looksRtl, type PdfPageText, type PdfTextLine } from './pdfText';
import type { OcrBox } from './groqClient';

export interface LineEditResult {
  overlays: PdfOverlay[];
  warnings: string[];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface FitRequest {
  value: string;
  kind: 'text_urdu' | 'text_en';
  baseSize: number;
  /** widest the rendered text may be, in points */
  limitPt: number;
  viewW: number;
  viewH: number;
  color: string;
  /** optional vertical ceiling in points (Cover & Retype box height) */
  maxHeightPt?: number;
}

/**
 * The shared shrink loop: start at the original size and step down until the
 * rasterised text fits the width (and, for Cover & Retype, the height) allowed.
 */
function fitReplacement(req: FitRequest): { fitted: PdfOverlay; fontSize: number } {
  const { value, kind, viewW, viewH, limitPt, color, maxHeightPt } = req;
  let fontSize = req.baseSize;

  let fitted = fitTextOverlay(
    {
      id: 'probe',
      pageId: '',
      kind,
      x: 0,
      y: 0,
      w: 0.1,
      h: 0.03,
      text: value,
      fontSize,
      color,
    },
    viewW,
    viewH
  );

  const fits = () =>
    fitted.w * viewW <= limitPt + 0.001 &&
    (maxHeightPt === undefined || fitted.h * viewH <= maxHeightPt + 0.001);

  let guard = 0;
  while (!fits() && fontSize > 5 && guard < 60) {
    fontSize = Math.max(5, fontSize * 0.94);
    fitted = fitTextOverlay({ ...fitted, fontSize }, viewW, viewH);
    guard++;
  }

  return { fitted, fontSize };
}

/**
 * Build the overlays that rewrite one extracted text line.
 * An empty `newText` deletes the line (white-out only).
 */
export function buildLineReplaceOverlays(
  pageInfo: PdfPageText,
  line: PdfTextLine,
  newText: string,
  opts: { color?: string } = {}
): LineEditResult {
  const warnings: string[] = [];
  const viewW = Math.max(1, pageInfo.widthPt);
  const viewH = Math.max(1, pageInfo.heightPt);

  const xPt = line.x * viewW;
  const yPt = line.y * viewH;
  const wPt = Math.max(1, line.w * viewW);
  const hPt = Math.max(1, line.h * viewH);

  const overlays: PdfOverlay[] = [];

  // 1) Cover the old glyphs. Keep the mask tight so neighbouring lines survive.
  const padX = Math.max(0.6, line.fontSize * 0.1);
  const padY = Math.max(0.5, line.fontSize * 0.12);
  const maskX = Math.max(0, xPt - padX);
  const maskY = Math.max(0, yPt - padY);
  const maskW = Math.min(viewW - maskX, wPt + padX * 2);
  const maskH = Math.min(viewH - maskY, hPt + padY * 2);

  overlays.push({
    id: newOverlayId(),
    pageId: '',
    kind: 'whiteout',
    x: maskX / viewW,
    y: maskY / viewH,
    w: Math.max(0.002, maskW / viewW),
    h: Math.max(0.002, maskH / viewH),
    origin: 'manual',
    note: 'text-edit mask',
  });

  const value = (newText ?? '').replace(/\r/g, '');
  if (!value.trim()) return { overlays, warnings };

  const isUrdu = looksRtl(value);
  const kind: PdfOverlay['kind'] = isUrdu ? 'text_urdu' : 'text_en';

  // 2) Type the replacement at the original size, shrinking only when needed.
  const baseSize = Math.min(96, Math.max(5, line.fontSize || 11));
  const roomPt = isUrdu ? xPt + wPt : Math.max(viewW * 0.2, viewW - xPt) - viewW * 0.02;
  const limitPt = Math.max(wPt * 1.35, Math.min(roomPt, viewW * 0.94));

  const color = opts.color || '#000000';
  const { fitted, fontSize } = fitReplacement({
    value,
    kind,
    baseSize,
    limitPt,
    viewW,
    viewH,
    color,
  });

  if (fontSize < baseSize * 0.72) {
    warnings.push(
      `The new text is longer than the original, so it was reduced to ${fontSize.toFixed(
        1
      )} pt to fit the same space.`
    );
  }
  if (fitted.w * viewW > limitPt * 1.02) {
    warnings.push(
      'The replacement is wider than the space available — check it does not overlap nearby text.'
    );
  } else if (fitted.w * viewW > wPt * 1.25) {
    warnings.push(
      'The new text is wider than the original line — check that it does not cover text to its right.'
    );
  }

  // 3) Anchor where the original text sat: right edge for Urdu, left for Latin.
  const padTextX = fontSize * 0.16; // same padding fitTextOverlay adds
  let xNorm = isUrdu ? line.x + line.w - fitted.w + padTextX / viewW : line.x - padTextX / viewW;
  const centreY = line.y + line.h / 2;
  let yNorm = centreY - fitted.h / 2;

  if (xNorm + fitted.w > 1) xNorm = 1 - fitted.w;
  if (yNorm + fitted.h > 1) yNorm = 1 - fitted.h;

  overlays.push({
    ...fitted,
    id: newOverlayId(),
    pageId: '',
    kind,
    text: value,
    fontSize,
    color,
    x: clamp01(xNorm),
    y: clamp01(yNorm),
    origin: 'manual',
    note: 'text-edit',
  });

  return { overlays, warnings };
}

// =====================================================================
// Cover & Retype — free text in a box (works on scans and real PDFs)
// =====================================================================

/**
 * Build the replacement text for a "Cover & Retype" box.
 *
 * The whiteout box already exists on the page (it was placed by the click), so
 * by default only the text overlay is returned — pass `includeWhiteout` when
 * the box still has to be drawn. The text is centred on the box, anchored right
 * for Urdu, and shrunk until it fits inside the box width and height.
 */
export function buildFreeTextOverlays(
  pageInfo: Pick<PdfPageText, 'widthPt' | 'heightPt'>,
  box: { x: number; y: number; w: number; h: number },
  text: string,
  opts: { color?: string; includeWhiteout?: boolean } = {}
): LineEditResult {
  const warnings: string[] = [];
  const viewW = Math.max(1, pageInfo.widthPt);
  const viewH = Math.max(1, pageInfo.heightPt);

  const bx = clamp01(box.x);
  const by = clamp01(box.y);
  const bw = Math.max(0.002, Math.min(box.w, 1 - bx));
  const bh = Math.max(0.002, Math.min(box.h, 1 - by));
  const wPt = Math.max(1, bw * viewW);
  const hPt = Math.max(1, bh * viewH);

  const overlays: PdfOverlay[] = [];

  if (opts.includeWhiteout) {
    overlays.push({
      id: newOverlayId(),
      pageId: '',
      kind: 'whiteout',
      x: bx,
      y: by,
      w: bw,
      h: bh,
      origin: 'manual',
      note: 'cover-retype mask',
    });
  }

  const value = (text ?? '').replace(/\r/g, '');
  if (!value.trim()) return { overlays, warnings };

  const isUrdu = looksRtl(value);
  const kind: PdfOverlay['kind'] = isUrdu ? 'text_urdu' : 'text_en';
  const color = opts.color || '#000000';

  // Start from a size that physically fits the box height, then shrink to width.
  const baseSize = clamp(Math.min((hPt / lineHeightFactor(kind)) * 0.92, hPt * 0.9), 5, 96);
  const limitPt = Math.max(5, wPt);

  const { fitted, fontSize } = fitReplacement({
    value,
    kind,
    baseSize,
    limitPt,
    viewW,
    viewH,
    color,
    maxHeightPt: hPt,
  });

  if (fontSize < baseSize * 0.72) {
    warnings.push(
      `The replacement text was reduced to ${fontSize.toFixed(
        1
      )} pt so it fits inside the covered box.`
    );
  }
  if (fitted.w * viewW > limitPt * 1.02) {
    warnings.push(
      'The replacement is wider than the box — drag the box wider so it hides everything underneath.'
    );
  }

  // Centre the text on the box; right-anchor Urdu, left-anchor English.
  const padTextX = fontSize * 0.16;
  let xNorm = isUrdu ? bx + bw - fitted.w + padTextX / viewW : bx - padTextX / viewW;
  const centreY = by + bh / 2;
  let yNorm = centreY - fitted.h / 2;

  if (xNorm + fitted.w > 1) xNorm = 1 - fitted.w;
  if (yNorm + fitted.h > 1) yNorm = 1 - fitted.h;
  if (xNorm < 0) xNorm = 0;
  if (yNorm < 0) yNorm = 0;

  overlays.push({
    ...fitted,
    id: newOverlayId(),
    pageId: '',
    kind,
    text: value,
    fontSize,
    color,
    x: clamp01(xNorm),
    y: clamp01(yNorm),
    origin: 'manual',
    note: 'cover-retype',
  });

  return { overlays, warnings };
}

// =====================================================================
// AI OCR boxes → editable lines
// =====================================================================

/**
 * Turn position-aware OCR output into normal PdfTextLines so a scanned page
 * behaves exactly like a real text layer: hit-testing, the Text panel, and
 * click-to-edit all work off the same shape.
 */
export function ocrBoxesToLines(
  page: Pick<PdfPageText, 'page' | 'widthPt' | 'heightPt'>,
  boxes: OcrBox[]
): PdfTextLine[] {
  const heightPt = Math.max(1, page.heightPt);
  const lines: PdfTextLine[] = [];

  for (const box of boxes || []) {
    const text = String(box?.text ?? '')
      .replace(/\r/g, '')
      .trim();
    if (!text) continue;
    const w = Math.min(1, Math.max(0.001, box.w));
    const h = Math.min(1, Math.max(0.001, box.h));
    const x = clamp01(Math.min(box.x, 1 - w));
    const y = clamp01(Math.min(box.y, 1 - h));
    // The model gives the visual line height; that is a good proxy for the font size.
    const fontSize = clamp(h * heightPt * 0.9, 5, 72);

    lines.push({
      id: `OCR${lines.length + 1}`,
      page: page.page,
      text,
      x,
      y,
      w,
      h,
      fontSize,
      rtl: looksRtl(text),
      parts: [],
      source: 'ocr',
    });
  }

  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

// =====================================================================
// Merging AI OCR lines into the real text layer
// =====================================================================

/** Does an AI-guessed box sit on top of a real text-layer line? */
export function ocrBoxOverlapsRealLine(a: PdfTextLine, b: PdfTextLine): boolean {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  if (ix <= 0 || iy <= 0) return false;
  const inter = ix * iy;
  const smaller = Math.min(Math.max(0.000001, a.w * a.h), Math.max(0.000001, b.w * b.h));
  return inter / smaller >= 0.35;
}

/**
 * Merge AI OCR lines into the real ones for one page.
 * Real text always wins — an OCR box that overlaps real text is dropped, so
 * re-reading a normal PDF can never damage its click-to-edit lines.
 */
export function mergeOcrIntoLines(real: PdfTextLine[], ocr: PdfTextLine[]): PdfTextLine[] {
  if (ocr.length === 0) return real;
  if (real.length === 0) return ocr;
  const extra = ocr.filter((o) => !real.some((r) => ocrBoxOverlapsRealLine(o, r)));
  if (extra.length === 0) return real;
  return [...real, ...extra].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Which extracted line sits under a normalised (0..1, top-left) point?
 * Uses a small tolerance so the operator does not have to click the exact glyph.
 */
export function hitTestLine(
  pageInfo: PdfPageText | undefined,
  nx: number,
  ny: number
): PdfTextLine | null {
  if (!pageInfo) return null;
  let best: PdfTextLine | null = null;
  let bestArea = Infinity;

  for (const line of pageInfo.lines) {
    const padX = Math.max(0.004, line.h * 0.6);
    const padY = Math.max(0.004, line.h * 0.55);
    const inside =
      nx >= line.x - padX &&
      nx <= line.x + line.w + padX &&
      ny >= line.y - padY &&
      ny <= line.y + line.h + padY;
    if (!inside) continue;
    const area = Math.max(0.000001, line.w * line.h);
    if (area < bestArea) {
      bestArea = area;
      best = line;
    }
  }
  return best;
}

/** Full plain text of one page — used by "Copy page text". */
export function pageToPlainText(pageInfo: PdfPageText): string {
  return pageInfo.lines.map((l) => l.text).join('\n');
}

/** Full plain text of the document — used by "Copy all text". */
export function documentToPlainText(pages: PdfPageText[]): string {
  return pages
    .map((p) => `--- Page ${p.page} ---\n${pageToPlainText(p)}`)
    .join('\n\n');
}

/** Best-effort guess: is this a form label / heading rather than body text? */
export function isLikelyHeading(line: PdfTextLine): boolean {
  return (line.fontSize || 0) >= 15 || (line.text.length <= 42 && /[:：]\s*$/.test(line.text));
}
