// IK Computers — Passport / Visa / Stamp Photo Sheet Engine
//
// Everything a print shop needs to lay photo tiles onto real paper:
//   • Standard presets (Pakistan 35×45, US visa 2×2, stamp 25×30 …)
//   • Fully custom millimetre sizes
//   • Exact quantity ("I need 12 copies on this page")
//   • Several different photos on one sheet (family / job applications)
//   • Face-aware placement using the alpha bounding box or MediaPipe landmarks
//   • 300 DPI print output + pixel-exact files for online application portals

import { jsPDF } from 'jspdf';
import { alphaBoundingBox, loadImageElement } from './bgRemoval';

export const PX_PER_MM = 300 / 25.4; // 11.811 px per mm at 300 DPI

export interface PhotoSizePreset {
  id: string;
  label: string;
  urdu: string;
  wMm: number;
  hMm: number;
  note?: string;
}

export const PHOTO_SIZE_PRESETS: PhotoSizePreset[] = [
  { id: 'pk_passport', label: 'Pakistan Passport / NADRA', urdu: 'پاکستان پاسپورٹ', wMm: 35, hMm: 45 },
  { id: 'pk_visa', label: 'Pakistan Visa (2 × 2 in)', urdu: 'پاکستان ویزا', wMm: 50.8, hMm: 50.8 },
  { id: 'us_visa', label: 'US Visa / Green Card (2 × 2 in)', urdu: 'امریکی ویزا', wMm: 50.8, hMm: 50.8 },
  { id: 'uk_visa', label: 'UK / Schengen Visa (35 × 45 mm)', urdu: 'برطانوی ویزا', wMm: 35, hMm: 45 },
  { id: 'canada_visa', label: 'Canada Visa (35 × 45 mm)', urdu: 'کینیڈا ویزا', wMm: 35, hMm: 45 },
  { id: 'saudi_visa', label: 'Saudi / Umrah Visa (2 × 2 in)', urdu: 'سعودی ویزا', wMm: 50.8, hMm: 50.8 },
  { id: 'stamp_small', label: 'Stamp / Ticket Size (25 × 30 mm)', urdu: 'اسٹامپ سائز', wMm: 25, hMm: 30 },
  { id: 'cnic_photo', label: 'CNIC / Form Photo (30 × 40 mm)', urdu: 'شناختی کارڈ فوٹو', wMm: 30, hMm: 40 },
  { id: 'school_form', label: 'School / B-Form Photo (25 × 30 mm)', urdu: 'اسکول فارم فوٹو', wMm: 25, hMm: 30 },
  { id: 'driving_licence', label: 'Driving Licence (35 × 45 mm)', urdu: 'ڈرائیونگ لائسنس', wMm: 35, hMm: 45 },
  { id: 'nts_form', label: 'NTS / PPSC Form Photo (30 × 35 mm)', urdu: 'این ٹی ایس فارم', wMm: 30, hMm: 35 },
  { id: 'custom', label: 'Custom size (mm)', urdu: 'اپنی مرضی کا سائز', wMm: 35, hMm: 45 },
];

export interface PaperPreset {
  id: string;
  label: string;
  wMm: number;
  hMm: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { id: '4x6', label: '4 × 6 in Photo Paper (152 × 102 mm)', wMm: 152.4, hMm: 101.6 },
  { id: '5x7', label: '5 × 7 in Photo Paper (178 × 127 mm)', wMm: 177.8, hMm: 127 },
  { id: 'a4', label: 'A4 Sheet (210 × 297 mm)', wMm: 210, hMm: 297 },
  { id: 'a4_landscape', label: 'A4 Landscape (297 × 210 mm)', wMm: 297, hMm: 210 },
  { id: 'a5', label: 'A5 Sheet (148 × 210 mm)', wMm: 148, hMm: 210 },
  { id: 'letter', label: 'Letter (216 × 279 mm)', wMm: 215.9, hMm: 279.4 },
  { id: '3x4', label: '3.5 × 5 in Photo Paper (127 × 89 mm)', wMm: 127, hMm: 88.9 },
  { id: 'custom_paper', label: 'Custom paper (mm)', wMm: 210, hMm: 297 },
];

export type GuideStyle = 'none' | 'dashed' | 'corner' | 'hairline';

export interface SheetTileSource {
  /** Stable id for React lists. */
  id: string;
  /** Cutout (transparent) or plain photo data URL. */
  src: string;
  /** CSS colour used behind this photo. `transparent` keeps the alpha. */
  bg: string;
  /** How many copies of this photo should appear on the sheet. */
  copies: number;
  /** Extra scale applied on top of the auto face fit (1 = auto). */
  zoom: number;
  /** Vertical nudge, in mm relative to the tile height. */
  offsetY: number;
  /** Optional label printed under the tile (customer name, roll number …). */
  label?: string;
}

export interface SheetSettings {
  photoWmm: number;
  photoHmm: number;
  paperWmm: number;
  paperHmm: number;
  gapMm: number;
  marginMm: number;
  guide: GuideStyle;
  /** Total photos the shopkeeper wants on the page. 0 = fill the page. */
  totalCopies: number;
  /** Use the detected face box to frame the head instead of a plain centre crop. */
  faceAware: boolean;
  dpi: number;
}

export interface SheetLayout {
  cols: number;
  rows: number;
  /** Number of tiles actually placed. */
  placed: number;
  capacity: number;
  overflow: number;
}

export const DEFAULT_SHEET: SheetSettings = {
  photoWmm: 35,
  photoHmm: 45,
  paperWmm: 152.4,
  paperHmm: 101.6,
  gapMm: 2,
  marginMm: 3,
  guide: 'corner',
  totalCopies: 8,
  faceAware: true,
  dpi: 300,
};

export function computeLayout(settings: SheetSettings): SheetLayout {
  const usableW = settings.paperWmm - settings.marginMm * 2;
  const usableH = settings.paperHmm - settings.marginMm * 2;
  const cols = Math.max(1, Math.floor((usableW + settings.gapMm) / (settings.photoWmm + settings.gapMm)));
  const rows = Math.max(1, Math.floor((usableH + settings.gapMm) / (settings.photoHmm + settings.gapMm)));
  const capacity = cols * rows;
  const wanted = settings.totalCopies > 0 ? settings.totalCopies : capacity;
  return {
    cols,
    rows,
    capacity,
    placed: Math.min(wanted, capacity),
    overflow: Math.max(0, wanted - capacity),
  };
}

/** Largest count that still fits on one page (used by the "max" button). */
export function maxCopies(settings: SheetSettings): number {
  const usableW = settings.paperWmm - settings.marginMm * 2;
  const usableH = settings.paperHmm - settings.marginMm * 2;
  const cols = Math.max(1, Math.floor((usableW + settings.gapMm) / (settings.photoWmm + settings.gapMm)));
  const rows = Math.max(1, Math.floor((usableH + settings.gapMm) / (settings.photoHmm + settings.gapMm)));
  return cols * rows;
}

function makeCanvas(wMm: number, hMm: number, dpi: number) {
  const pxPerMm = dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wMm * pxPerMm));
  canvas.height = Math.max(1, Math.round(hMm * pxPerMm));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, pxPerMm };
}

/** Composite a transparent cutout over a solid backdrop colour. */
export async function flattenOnColor(src: string, bg: string): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d')!;
  if (bg && bg !== 'transparent' && bg !== 'none') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  return canvas;
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Estimates the *head* region from the visible subject box.
 *
 * A cut-out portrait is usually shoulders + head, so the head lives in the top
 * ~40% of the subject and is narrower than the shoulders. Framing from this box
 * gives a real passport look (head high, chin near the middle, shoulders cut at
 * the bottom edge) instead of a loose centre crop.
 */
function heuristicFace(box: FaceBox): FaceBox {
  return {
    x: box.x + box.w * 0.22,
    y: box.y + box.h * 0.02,
    w: box.w * 0.56,
    h: box.h * 0.4,
  };
}

export interface BuildSheetOptions {
  settings: SheetSettings;
  sources: SheetTileSource[];
  /** Optional per-source face box; keys are `SheetTileSource.id`. */
  faceBoxes?: Record<string, FaceBox | null>;
  /** Draw a note line at the bottom of the sheet. */
  footer?: string;
  /** JPEG quality for preview only; the PDF keeps full PNG data. */
  previewQuality?: number;
}

export interface BuildSheetResult {
  previewUrl: string;
  canvas: HTMLCanvasElement;
  layout: SheetLayout;
  /** Per-tile placement, handy for the on-screen cut labels. */
  tiles: { x: number; y: number; w: number; h: number; sourceId: string }[];
}

interface PreparedTile {
  id: string;
  canvas: HTMLCanvasElement;
  bg: string;
  zoom: number;
  offsetY: number;
  label?: string;
  face: FaceBox | null;
  naturalW: number;
  naturalH: number;
  copies: number;
}

async function prepareTile(
  source: SheetTileSource,
  faceBox: FaceBox | null
): Promise<PreparedTile | null> {
  try {
    const image = await loadImageElement(source.src);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot create a drawing canvas.');
    ctx.drawImage(image, 0, 0);
    const alphaBox = alphaBoundingBox(canvas);
    // Only trust the heuristic when the image really has a cut-out subject.
    // A plain JPEG must use a straight centre-crop, never a guessed head box.
    const hasCutout =
      Boolean(alphaBox) &&
      Boolean(
        alphaBox &&
          (alphaBox.w < canvas.width * 0.96 || alphaBox.h < canvas.height * 0.96)
      );
    return {
      id: source.id,
      canvas,
      bg: source.bg,
      zoom: source.zoom || 1,
      offsetY: source.offsetY || 0,
      label: source.label,
      face: faceBox || (hasCutout && alphaBox ? heuristicFace(alphaBox) : null),
      naturalW: canvas.width,
      naturalH: canvas.height,
      copies: Math.max(1, Math.round(source.copies || 1)),
    };
  } catch (err) {
    console.warn('IK: a photo could not be prepared for the sheet', err);
    return null;
  }
}

/** Builds the print-ready sheet canvas. */
export async function buildSheet(options: BuildSheetOptions): Promise<BuildSheetResult | null> {
  const { settings, sources } = options;
  const usable = sources.filter((s) => s.src);
  if (usable.length === 0) return null;

  const { canvas, ctx, pxPerMm } = makeCanvas(settings.paperWmm, settings.paperHmm, settings.dpi);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const prepared = (
    await Promise.all(usable.map((s) => prepareTile(s, options.faceBoxes?.[s.id] ?? null)))
  ).filter((t): t is PreparedTile => Boolean(t));
  if (prepared.length === 0) return null;

  const layout = computeLayout(settings);
  const gapPx = settings.gapMm * pxPerMm;
  const tileW = settings.photoWmm * pxPerMm;
  const tileH = settings.photoHmm * pxPerMm;

  // Total width of one row of tiles, so mixed photos stay on the same grid.
  const gridW = layout.cols * tileW + (layout.cols - 1) * gapPx;
  const startX = (canvas.width - gridW) / 2;

  // Pad the subject slightly so the head/shoulders fill the frame nicely.
  const PAD_RATIO = 1.06;

  const tiles: BuildSheetResult['tiles'] = [];
  let index = 0;

  // Round-robin through the sources so "3 photos of A, 5 of B" alternates.
  const queue: PreparedTile[] = [];
  for (const tile of prepared) {
    for (let i = 0; i < tile.copies; i++) queue.push(tile);
  }

  // Never print more tiles than the caller asked for (the last page of a long
  // job is usually short — the old modulo loop padded it with duplicates).
  const count = queue.length === 0 ? 0 : Math.min(layout.placed, queue.length);

  for (let i = 0; i < count; i++) {
    const tile = queue[i % queue.length];
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    if (row >= layout.rows) break;

    const x = startX + col * (tileW + gapPx);
    const y = settings.marginMm * pxPerMm + row * (tileH + gapPx);

    // Backdrop behind this tile
    if (tile.bg && tile.bg !== 'transparent') {
      ctx.fillStyle = tile.bg;
      ctx.fillRect(x, y, tileW, tileH);
    }

    // --- Frame the subject inside the tile -------------------------------
    const face = tile.face;
    let sourceRect: { x: number; y: number; w: number; h: number };

    if (settings.faceAware && face) {
      const targetAspect = tileW / tileH;
      // The head should occupy roughly 55–60% of the finished photo height,
      // with a little air above it — the standard passport composition.
      let cropH = Math.min(tile.canvas.height, face.h * 1.8 * PAD_RATIO);
      let cropW = cropH * targetAspect;
      if (cropW > tile.canvas.width) {
        cropW = tile.canvas.width;
        cropH = cropW / targetAspect;
      }
      cropW /= tile.zoom;
      cropH /= tile.zoom;
      const faceCenterX = face.x + face.w / 2;
      const headTop = face.y - face.h * 0.18;
      let cropX = faceCenterX - cropW / 2;
      let cropY = headTop + (tile.offsetY / 100) * cropH;
      cropX = Math.max(0, Math.min(tile.canvas.width - cropW, cropX));
      cropY = Math.max(0, Math.min(tile.canvas.height - cropH, cropY));
      sourceRect = { x: cropX, y: cropY, w: cropW, h: cropH };
    } else {
      // Classic cover fit, centred.
      const srcAspect = tile.canvas.width / tile.canvas.height;
      const targetAspect = tileW / tileH;
      let sw = tile.canvas.width;
      let sh = tile.canvas.height;
      if (srcAspect > targetAspect) sw = tile.canvas.height * targetAspect;
      else sh = tile.canvas.width / targetAspect;
      sw /= tile.zoom;
      sh /= tile.zoom;
      const sx = (tile.canvas.width - sw) / 2;
      const sy = (tile.canvas.height - sh) / 2 + (tile.offsetY / 100) * sh;
      sourceRect = {
        x: Math.max(0, Math.min(tile.canvas.width - sw, sx)),
        y: Math.max(0, Math.min(tile.canvas.height - sh, sy)),
        w: sw,
        h: sh,
      };
    }

    ctx.drawImage(
      tile.canvas,
      sourceRect.x,
      sourceRect.y,
      sourceRect.w,
      sourceRect.h,
      x,
      y,
      tileW,
      tileH
    );

    // --- Cut guides -------------------------------------------------------
    if (settings.guide === 'dashed') {
      ctx.save();
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.75)';
      ctx.lineWidth = Math.max(1, pxPerMm * 0.18);
      ctx.setLineDash([pxPerMm * 1.6, pxPerMm * 1.2]);
      ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
      ctx.restore();
    } else if (settings.guide === 'hairline') {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, tileW, tileH);
      ctx.restore();
    } else if (settings.guide === 'corner') {
      ctx.save();
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.8)';
      const len = Math.min(tileW, tileH) * 0.16;
      ctx.lineWidth = Math.max(1, pxPerMm * 0.2);
      const corners: [number, number, number, number][] = [
        [x, y, 1, 1],
        [x + tileW, y, -1, 1],
        [x, y + tileH, 1, -1],
        [x + tileW, y + tileH, -1, -1],
      ];
      for (const [cx, cy, dx, dy] of corners) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * len, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (tile.label) {
      ctx.save();
      const fontSize = Math.max(10, Math.round(pxPerMm * 2.4));
      ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.textAlign = 'center';
      ctx.fillText(tile.label, x + tileW / 2, y + tileH - pxPerMm * 0.8);
      ctx.restore();
    }

    tiles.push({ x, y, w: tileW, h: tileH, sourceId: tile.id });
    index++;
  }

  void index;

  if (options.footer) {
    ctx.save();
    const fontSize = Math.max(11, Math.round(pxPerMm * 2.2));
    ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(100, 116, 139, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText(options.footer, settings.marginMm * pxPerMm, canvas.height - pxPerMm * 1.2);
    ctx.restore();
  }

  return {
    previewUrl: canvas.toDataURL('image/jpeg', options.previewQuality ?? 0.92),
    canvas,
    layout,
    tiles,
  };
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, fileName: string) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = fileName;
  a.click();
}

export function downloadCanvasJpg(canvas: HTMLCanvasElement, fileName: string, quality = 0.95) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', quality);
  a.download = fileName;
  a.click();
}

/** A4/photo-paper PDF at true physical size — what the printer expects. */
export function downloadSheetPdf(canvas: HTMLCanvasElement, settings: SheetSettings, fileName: string) {
  const orientation = settings.paperWmm >= settings.paperHmm ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [settings.paperWmm, settings.paperHmm],
    compress: true,
  });
  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    settings.paperWmm,
    settings.paperHmm,
    undefined,
    'FAST'
  );
  pdf.save(fileName);
}

/** Several sheets in one multi-page PDF — what a shop wants for a big order. */
export function downloadMultiPagePdf(
  canvases: HTMLCanvasElement[],
  settings: SheetSettings,
  fileName: string
) {
  if (canvases.length === 0) return;
  const orientation = settings.paperWmm >= settings.paperHmm ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [settings.paperWmm, settings.paperHmm],
    compress: true,
  });
  canvases.forEach((canvas, index) => {
    if (index > 0) pdf.addPage([settings.paperWmm, settings.paperHmm], orientation);
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      settings.paperWmm,
      settings.paperHmm,
      undefined,
      'FAST'
    );
  });
  pdf.save(fileName);
}

/** Splits a total quantity across photos, respecting each photo's weight. */
export function buildCopyQueue(
  photos: { id: string; copies: number }[],
  totalWanted: number
): { id: string; count: number }[] {
  const valid = photos.filter((p) => p.copies > 0);
  if (valid.length === 0) return [];
  const wanted = Math.max(1, Math.round(totalWanted));

  if (valid.length === 1) {
    return [{ id: valid[0].id, count: wanted }];
  }

  const weights = valid.map((p) => Math.max(1, p.copies));
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = valid.map((p, i) => ({
    id: p.id,
    count: Math.max(1, Math.round((weights[i] / sum) * wanted)),
  }));

  // Correct rounding drift so the page really holds `wanted` photos.
  let diff = wanted - shares.reduce((a, b) => a + b.count, 0);
  let guard = 0;
  while (diff !== 0 && guard < 500) {
    const step = diff > 0 ? 1 : -1;
    // Grow the photo that already has the most copies / shrink the biggest one.
    let target = 0;
    for (let i = 1; i < shares.length; i++) {
      if (step > 0 ? shares[i].count < shares[target].count : shares[i].count > shares[target].count) {
        target = i;
      }
    }
    if (step < 0 && shares[target].count <= 1) break;
    shares[target].count += step;
    diff -= step;
    guard++;
  }
  return shares;
}

/** One single photo at exact pixel size (passport portals ask for 413 × 531 etc.). */
export async function buildSinglePhoto(
  src: string,
  bg: string,
  wMm: number,
  hMm: number,
  dpi: number,
  faceBox: FaceBox | null,
  zoom = 1,
  offsetY = 0
): Promise<HTMLCanvasElement | null> {
  const result = await buildSheet({
    settings: {
      ...DEFAULT_SHEET,
      photoWmm: wMm,
      photoHmm: hMm,
      paperWmm: wMm,
      paperHmm: hMm,
      marginMm: 0,
      gapMm: 0,
      guide: 'none',
      totalCopies: 1,
      dpi,
      faceAware: true,
    },
    sources: [{ id: 'single', src, bg, copies: 1, zoom, offsetY }],
    faceBoxes: { single: faceBox },
    previewQuality: 1,
  });
  return result?.canvas ?? null;
}
