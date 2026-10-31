// IK Computers — Direct "click the text and edit it" engine
//
// The AI assistant turns a *sentence* into edits. This module does the other
// half of the job: it takes one real text line that PDF.js found in the file
// and produces the concrete overlays (white-out + replacement text) needed to
// rewrite it in place, keeping the original position, size and direction.
//
// Nothing here mutates the original PDF — every change is an overlay, so it
// stays undoable and the export path is the one already proven by the editor.

import { fitTextOverlay, newOverlayId, type PdfOverlay } from './pdfOverlay';
import { looksRtl, type PdfPageText, type PdfTextLine } from './pdfText';

export interface LineEditResult {
  overlays: PdfOverlay[];
  warnings: string[];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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
  const padX = Math.max(0.6, line.fontSize * 0.10);
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

  let fontSize = baseSize;
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
      color: opts.color || '#000000',
    },
    viewW,
    viewH
  );

  let guard = 0;
  while (fitted.w * viewW > limitPt && fontSize > 5 && guard < 40) {
    fontSize = Math.max(5, fontSize * 0.94);
    fitted = fitTextOverlay({ ...fitted, fontSize }, viewW, viewH);
    guard++;
  }

  if (fontSize < baseSize * 0.72) {
    warnings.push(
      `The new text is longer than the original, so it was reduced to ${fontSize.toFixed(
        1
      )} pt to fit the same space.`
    );
  }
  if (fitted.w * viewW > limitPt * 1.02) {
    warnings.push('The replacement is wider than the space available — check it does not overlap nearby text.');
  } else if (fitted.w * viewW > wPt * 1.25) {
    warnings.push('The new text is wider than the original line — check that it does not cover text to its right.');
  }

  // 3) Anchor where the original text sat: right edge for Urdu, left for Latin.
  const padTextX = (fontSize * 0.16); // same padding fitTextOverlay adds
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
    color: opts.color || '#000000',
    x: clamp01(xNorm),
    y: clamp01(yNorm),
    origin: 'manual',
    note: 'text-edit',
  });

  return { overlays, warnings };
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
