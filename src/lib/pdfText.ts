// IK Computers — PDF text layer extraction (positions + line assembly)
// Used by the AI assistant to find exactly where text lives on a page so it can
// be white-outed and replaced without disturbing the rest of the document.
import { pdfjsLib } from './pdfjs';

export interface TextPart {
  /** char range inside the assembled line text */
  start: number;
  end: number;
  /** normalised rect (0..1) inside the page, origin TOP-LEFT */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfTextLine {
  id: string; // global unique id, e.g. "L12"
  page: number; // 1-based
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number; // points
  rtl: boolean;
  parts: TextPart[];
  /**
   * Where the line came from. Real PDF text layer by default; `'ocr'` when the
   * page is a scan and the box was estimated by Groq vision.
   */
  source?: 'text' | 'ocr';
}

export interface PdfPageText {
  page: number; // 1-based
  widthPt: number;
  heightPt: number;
  lines: PdfTextLine[];
  charCount: number;
}

export interface PdfTextIndex {
  pages: PdfPageText[];
  totalChars: number;
  pageCount: number;
  /** pages that contain no real text layer (scans / photos) */
  scannedPages: number[];
}

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function looksRtl(text: string): boolean {
  return ARABIC_RANGE.test(text);
}

function collapseWithMap(s: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!prevSpace && out.length > 0) {
        out += ' ';
        map.push(i);
        prevSpace = true;
      }
      continue;
    }
    out += ch;
    map.push(i);
    prevSpace = false;
  }
  while (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

/** Build readable lines (with char→rect maps) from raw PDF.js text items. */
function buildLines(
  items: Array<Record<string, unknown>>,
  pageNumber: number,
  viewportTransform: number[],
  viewWidth: number,
  viewHeight: number,
  startLineId: number
): { lines: PdfTextLine[]; nextLineId: number } {
  const lines: PdfTextLine[] = [];
  let lineId = startLineId;

  interface Accum {
    text: string;
    parts: TextPart[];
    baseline: number;
    fontSize: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    lastEndX: number;
    pendingSpace: boolean;
  }
  let cur: Accum | null = null;

  const flush = () => {
    if (!cur) return;
    const text = cur.text.trim();
    if (text) {
      const w = Math.max(0.001, cur.maxX - cur.minX);
      const h = Math.max(0.001, cur.maxY - cur.minY);
      lines.push({
        id: `L${lineId++}`,
        page: pageNumber,
        text,
        x: cur.minX / viewWidth,
        y: cur.minY / viewHeight,
        w: w / viewWidth,
        h: h / viewHeight,
        fontSize: cur.fontSize,
        rtl: looksRtl(text),
        parts: cur.parts,
      });
    }
    cur = null;
  };

  for (const raw of items) {
    const item = raw as unknown as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    };
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    const isBlank = str.trim().length === 0;
    if (!item.transform) continue;

    // PDF text origin -> device space (top-left origin, y grows downwards)
    const m = pdfjsLib.Util.transform(viewportTransform, item.transform);
    const fontH = Math.hypot(m[2], m[3]) || item.height || 10;
    const xDev = m[4];
    const baselineDev = m[5];
    const widthDev = item.width ?? 0;

    const top = baselineDev - fontH * 0.86;
    const height = fontH * 1.16;

    if (isBlank) {
      if (cur) cur.pendingSpace = true;
      continue;
    }

    if (cur && Math.abs(cur.baseline - baselineDev) <= Math.max(2, fontH * 0.55)) {
      // same visual line
      const gap = xDev - cur.lastEndX;
      const needsSpace =
        cur.pendingSpace || gap > Math.max(fontH * 0.22, 1.2) || /^\s/.test(str);
      const glued =
        cur.text.length > 0 && needsSpace && !cur.text.endsWith(' ') && !/^[\s.,;:!?)،۔]/.test(str)
          ? ' '
          : '';
      const start = cur.text.length + glued.length;
      cur.text += glued + str;
      cur.parts.push({
        start,
        end: cur.text.length,
        x: xDev / viewWidth,
        y: top / viewHeight,
        w: widthDev / viewWidth,
        h: height / viewHeight,
      });
      cur.minX = Math.min(cur.minX, xDev);
      cur.maxX = Math.max(cur.maxX, xDev + widthDev);
      cur.minY = Math.min(cur.minY, top);
      cur.maxY = Math.max(cur.maxY, top + height);
      cur.lastEndX = xDev + widthDev;
      cur.fontSize = Math.max(cur.fontSize, fontH);
      cur.pendingSpace = false;
    } else {
      flush();
      cur = {
        text: str,
        parts: [
          {
            start: 0,
            end: str.length,
            x: xDev / viewWidth,
            y: top / viewHeight,
            w: widthDev / viewWidth,
            h: height / viewHeight,
          },
        ],
        baseline: baselineDev,
        fontSize: fontH,
        minX: xDev,
        maxX: xDev + widthDev,
        minY: top,
        maxY: top + height,
        lastEndX: xDev + widthDev,
        pendingSpace: false,
      };
    }
  }
  flush();
  return { lines, nextLineId: lineId };
}

/** Extract every text line (with normalised coordinates) from a PDF. */
export async function extractPdfText(
  bytes: Uint8Array,
  opts: { maxPages?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<PdfTextIndex> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  try {
    const total = doc.numPages;
    const limit = Math.min(total, opts.maxPages ?? total);
    const pages: PdfPageText[] = [];
    const scannedPages: number[] = [];
    let lineId = 1;
    let totalChars = 0;

    for (let p = 1; p <= limit; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const built = buildLines(
        content.items as unknown as Array<Record<string, unknown>>,
        p,
        vp.transform as unknown as number[],
        vp.width,
        vp.height,
        lineId
      );
      lineId = built.nextLineId;
      const charCount = built.lines.reduce((n, l) => n + l.text.length, 0);
      totalChars += charCount;
      if (charCount < 4) scannedPages.push(p);
      pages.push({
        page: p,
        widthPt: vp.width,
        heightPt: vp.height,
        lines: built.lines,
        charCount,
      });
      opts.onProgress?.(p, limit);
    }

    return { pages, totalChars, pageCount: total, scannedPages };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
}

export interface TextMatch {
  line: PdfTextLine;
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

let _measureCtx: CanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx !== undefined) return _measureCtx;
  try {
    _measureCtx =
      typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null;
  } catch {
    _measureCtx = null;
  }
  return _measureCtx;
}

/**
 * Approximate where a character offset sits inside a PDF text run.
 * PDF text items only give us the whole-run advance width, so we measure the
 * prefix with the canvas font and express it as a fraction of the run.
 */
function charFraction(text: string, index: number, fontSize: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return 1;
  const ctx = measureCtx();
  if (!ctx || !text) return text.length ? index / text.length : 0;
  try {
    ctx.font = `${Math.max(1, fontSize * 4)}px Inter, Arial, Helvetica, sans-serif`;
    const total = ctx.measureText(text).width;
    if (total <= 0) return index / text.length;
    return Math.min(1, Math.max(0, ctx.measureText(text.slice(0, index)).width / total));
  } catch {
    return index / text.length;
  }
}

/** Union of the per-item rects covering [start, end) of a line. */
function rectForRange(line: PdfTextLine, start: number, end: number) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const part of line.parts) {
    if (part.end <= start || part.start >= end) continue;
    const partText = line.text.slice(part.start, part.end);
    const localStart = Math.max(0, start - part.start);
    const localEnd = Math.min(partText.length, end - part.start);
    const f0 = charFraction(partText, localStart, line.fontSize);
    const f1 = charFraction(partText, localEnd, line.fontSize);
    const rtl = looksRtl(partText);
    const px1 = rtl ? part.x + part.w * (1 - f1) : part.x + part.w * f0;
    const px2 = rtl ? part.x + part.w * (1 - f0) : part.x + part.w * f1;
    x1 = Math.min(x1, px1);
    y1 = Math.min(y1, part.y);
    x2 = Math.max(x2, px2);
    y2 = Math.max(y2, part.y + part.h);
  }
  if (!Number.isFinite(x1)) {
    return { x: line.x, y: line.y, w: line.w, h: line.h };
  }
  return { x: x1, y: y1, w: Math.max(0.001, x2 - x1), h: Math.max(0.001, y2 - y1) };
}

/** Locate a verbatim excerpt inside the extracted lines of one page. */
export function findTextInPage(page: PdfPageText, needle: string): TextMatch[] {
  const raw = (needle || '').trim();
  if (!raw) return [];
  const matches: TextMatch[] = [];
  const needleCollapsed = collapseWithMap(raw).text.toLowerCase();

  for (const line of page.lines) {
    const collapsed = collapseWithMap(line.text);
    const hay = collapsed.text.toLowerCase();

    // 1) exact raw substring (fast path, keeps original casing/indices)
    let idx = line.text.toLowerCase().indexOf(raw.toLowerCase());
    if (idx >= 0) {
      const r = rectForRange(line, idx, idx + raw.length);
      matches.push({ line, start: idx, end: idx + raw.length, ...r });
      continue;
    }

    // 2) whitespace-tolerant / unicode-tolerant search
    idx = hay.indexOf(needleCollapsed);
    if (idx >= 0) {
      const startOrig = collapsed.map[idx] ?? 0;
      const endOrig =
        (collapsed.map[idx + needleCollapsed.length - 1] ?? startOrig) + 1;
      const r = rectForRange(line, startOrig, endOrig);
      matches.push({ line, start: startOrig, end: endOrig, ...r });
      continue;
    }

    // 3) single-word fuzzy: strip punctuation & compare words
    if (!/\s/.test(raw) && raw.length > 2) {
      const wIdx = collapsed.text
        .split(' ')
        .findIndex((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === needleCollapsed.replace(/[^\p{L}\p{N}]/gu, ''));
      if (wIdx >= 0) {
        const before = collapsed.text.split(' ').slice(0, wIdx).join(' ');
        const startOrig = collapsed.map[before.length ? before.length + 1 : 0] ?? 0;
        const wordLen = collapsed.text.split(' ')[wIdx].length;
        const endOrig = (collapsed.map[Math.min(collapsed.map.length - 1, (before.length ? before.length + 1 : 0) + wordLen - 1)] ?? startOrig) + 1;
        const r = rectForRange(line, startOrig, endOrig);
        matches.push({ line, start: startOrig, end: endOrig, ...r });
      }
    }
  }
  return matches;
}

/** Compact, token-cheap text listing handed to the AI planner. */
export function buildTextDigest(index: PdfTextIndex, maxChars = 9000, maxPages = 12): string {
  const out: string[] = [];
  out.push(
    `TOTAL PAGES: ${index.pageCount}. Coordinates x,y are fractions (0..1) from the TOP-LEFT of the page. Font sizes are in PDF points.`
  );
  let used = out[0].length;

  for (const page of index.pages.slice(0, maxPages)) {
    if (used > maxChars) {
      out.push(`... (${index.pageCount - maxPages} more pages not shown)`);
      break;
    }
    const header = `\nPAGE ${page.page} — ${Math.round(page.widthPt)}x${Math.round(page.heightPt)}pt — ${page.lines.length} text lines`;
    out.push(header);
    used += header.length;
    if (page.lines.length === 0) {
      out.push('(no text layer — scanned image page)');
      continue;
    }
    for (const line of page.lines) {
      const row = `[${line.id}] ${line.text}`;
      if (used + row.length > maxChars) {
        out.push('... (truncated)');
        used = maxChars + 1;
        break;
      }
      out.push(row);
      used += row.length + 1;
    }
  }
  return out.join('\n');
}
