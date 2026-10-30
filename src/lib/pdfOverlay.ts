// IK Computers — Overlay model, text measurement + WYSIWYG rasterisation
// Everything a user sees in the browser preview is produced by the very same
// rasteriser that writes the final PDF, so the exported file matches 1:1.

export type OverlayKind = 'whiteout' | 'text_urdu' | 'text_en' | 'image';

export interface PdfOverlay {
  id: string;
  pageId: string;
  kind: OverlayKind;
  /** normalised 0..1 inside the displayed page, origin TOP-LEFT */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  /** font size in PDF points */
  fontSize?: number;
  color?: string;
  imageDataUrl?: string;
  origin?: 'manual' | 'ai';
  note?: string;
}

export const URDU_FONT_STACK = '"Noto Nastaliq Urdu", "Gulzar", "Noto Naskh Arabic", serif';
export const LATIN_FONT_STACK = 'Inter, Arial, Helvetica, sans-serif';

/** px per PDF point used when rasterising text overlays (≈216 DPI) */
export const TEXT_RASTER_SCALE = 3;

export function isTextKind(kind: OverlayKind): boolean {
  return kind === 'text_urdu' || kind === 'text_en';
}

export function fontSpecFor(kind: OverlayKind, px: number): string {
  const stack = kind === 'text_urdu' ? URDU_FONT_STACK : LATIN_FONT_STACK;
  return `${Math.max(1, px)}px ${stack}`;
}

export function lineHeightFactor(kind: OverlayKind): number {
  return kind === 'text_urdu' ? 2.05 : 1.32;
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

/** Width/height (in PDF points) a text overlay needs so nothing is clipped. */
export function measureTextOverlay(
  overlay: Pick<PdfOverlay, 'kind' | 'text' | 'fontSize'>
): { wPt: number; hPt: number } {
  const kind = overlay.kind;
  const fs = Math.max(4, overlay.fontSize || 12);
  const lines = ((overlay.text ?? '').replace(/\r/g, '').split('\n') || ['']).slice(0, 40);
  const lineH = fs * lineHeightFactor(kind);
  const padX = fs * 0.16;
  const padY = fs * 0.1;

  let maxW = fs * 1.4;
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = fontSpecFor(kind, fs * TEXT_RASTER_SCALE);
    for (const ln of lines) {
      const w = ctx.measureText(ln || ' ').width / TEXT_RASTER_SCALE;
      if (w > maxW) maxW = w;
    }
  }
  return {
    wPt: Math.max(maxW + padX * 2, fs * 1.6),
    hPt: Math.max(lines.length * lineH + padY * 2, lineH),
  };
}

/** Snap a text overlay's normalised box to its measured text size. */
export function fitTextOverlay(overlay: PdfOverlay, viewW: number, viewH: number): PdfOverlay {
  if (!isTextKind(overlay.kind) || viewW <= 0 || viewH <= 0) return overlay;
  const { wPt, hPt } = measureTextOverlay(overlay);
  return { ...overlay, w: wPt / viewW, h: hPt / viewH };
}

const rasterCache = new Map<string, string>();
const RASTER_CACHE_LIMIT = 240;

/** Rasterise a text overlay into a transparent PNG (data URL) + its size in pt. */
export function rasterizeTextOverlay(
  overlay: Pick<PdfOverlay, 'kind' | 'text' | 'fontSize' | 'color'>,
  viewW: number,
  viewH: number
): { dataUrl: string; wPt: number; hPt: number } | null {
  if (!isTextKind(overlay.kind) || typeof document === 'undefined') return null;
  const kind = overlay.kind;
  const fs = Math.max(4, overlay.fontSize || 12);
  const text = overlay.text ?? '';
  if (!text.trim()) return null;

  const { wPt, hPt } = measureTextOverlay({ kind, text, fontSize: fs });
  const key = `${kind}|${fs}|${overlay.color || '#000'}|${wPt.toFixed(2)}x${hPt.toFixed(2)}|${text}`;
  const cached = rasterCache.get(key);
  if (cached) return { dataUrl: cached, wPt, hPt };

  const S = TEXT_RASTER_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(wPt * S));
  canvas.height = Math.max(2, Math.ceil(hPt * S));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = fontSpecFor(kind, fs * S);
  ctx.fillStyle = overlay.color || '#000000';
  ctx.textBaseline = 'top';
  const isRtl = kind === 'text_urdu';
  ctx.direction = isRtl ? 'rtl' : 'ltr';
  ctx.textAlign = isRtl ? 'right' : 'left';

  const lineH = fs * lineHeightFactor(kind) * S;
  const padX = fs * 0.16 * S;
  const padY = fs * 0.1 * S;
  const x = isRtl ? canvas.width - padX : padX;
  const lines = text.replace(/\r/g, '').split('\n');
  lines.forEach((ln, i) => {
    ctx.fillText(ln, x, padY + i * lineH + fs * 0.06 * S);
  });

  let dataUrl = '';
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  if (rasterCache.size > RASTER_CACHE_LIMIT) rasterCache.clear();
  rasterCache.set(key, dataUrl);
  return { dataUrl, wPt, hPt };
}

/**
 * Map a normalised rect from the "intrinsic" page view (what PDF text extraction
 * reports) into the *displayed* view after the user applies an extra rotation.
 */
export function rotateNormalizedRect(
  rect: { x: number; y: number; w: number; h: number },
  fromW: number,
  fromH: number,
  extraDeg: number
): { x: number; y: number; w: number; h: number } {
  const deg = ((Math.round((extraDeg || 0) / 90) * 90) % 360 + 360) % 360;
  if (deg === 0) return rect;
  const W = deg % 180 === 0 ? fromW : fromH;
  const H = deg % 180 === 0 ? fromH : fromW;
  const px1 = rect.x * fromW;
  const py1 = rect.y * fromH;
  const px2 = px1 + rect.w * fromW;
  const py2 = py1 + rect.h * fromH;

  const map = (ux: number, uy: number): [number, number] => {
    if (deg === 90) return [fromH - uy, ux];
    if (deg === 180) return [fromW - ux, fromH - uy];
    return [uy, fromW - ux]; // 270
  };
  const [dx1, dy1] = map(px1, py1);
  const [dx2, dy2] = map(px2, py2);
  const nx1 = Math.min(dx1, dx2) / W;
  const ny1 = Math.min(dy1, dy2) / H;
  const nx2 = Math.max(dx1, dx2) / W;
  const ny2 = Math.max(dy1, dy2) / H;
  return { x: nx1, y: ny1, w: Math.max(0.001, nx2 - nx1), h: Math.max(0.001, ny2 - ny1) };
}

export function newOverlayId(): string {
  return `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Make sure the browser actually has the Nastaliq / Latin faces ready. */
export async function ensureOverlayFonts(): Promise<void> {
  if (typeof document === 'undefined' || !(document as Document).fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`700 32px "Noto Nastaliq Urdu"`),
      document.fonts.load(`400 32px "Noto Nastaliq Urdu"`),
      document.fonts.load(`400 32px "Noto Naskh Arabic"`),
      document.fonts.load(`400 32px "Gulzar"`),
      document.fonts.load(`400 32px Inter`),
    ]);
    await document.fonts.ready;
  } catch {
    /* fonts are best-effort */
  }
}
