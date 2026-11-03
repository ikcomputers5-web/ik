// IK Computers — Fast Local Background Segmentation & Matting Engine
//
// Two engines are exposed:
//   1. `fastCutout()`  — 100% offline, no model download, ~80-250 ms on a shop PC.
//                        Border-colour palette + flood fill + alpha feathering.
//                        Excellent for studio/passport photos shot against a wall.
//   2. `aiCutout()`    — the neural ONNX model (@imgly). Slower and needs a one-time
//                        model download, but handles cluttered backgrounds.
//
// Both return a canvas that already contains a soft, de-fringed alpha channel, so
// the composited passport photo no longer has jagged edges or a white halo.

export interface CutoutOptions {
  /** 0 = remove only the exact wall colour, 100 = very aggressive. Default 42. */
  tolerance?: number;
  /** Edge softening in *analysis* pixels (0 = hard edge, 3 = very soft). Default 1.4. */
  feather?: number;
  /** Erode the matte by N analysis pixels to kill the wall halo. Default 1. */
  shrink?: number;
  /** Remove tiny stray foreground islands (dust, hair wisps). Default true. */
  despeckle?: boolean;
  /** Longest side used for the analysis pass. Default 720. */
  maxAnalysis?: number;
}

export interface CutoutResult {
  /** Full-resolution cutout with transparency. */
  canvas: HTMLCanvasElement;
  /**
   * True when the engine could not find a background (the photo fills the whole
   * frame). The canvas is then returned untouched, and the UI should suggest the
   * AI HD engine instead of silently handing over an empty image.
   */
  failed?: boolean;
  /** Bounding box (full-res pixels) of the visible subject, or null when empty. */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** Milliseconds spent inside the engine (useful for the UI badge). */
  ms: number;
  /** Rough coverage of the subject (0..1) — sanity check for a failed cutout. */
  coverage: number;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened.'));
    img.src = src;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the image.'));
    }, type);
  });
}

function drawScaled(
  img: HTMLImageElement,
  maxSide: number
): { canvas: HTMLCanvasElement; scale: number; w: number; h: number } {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, scale, w, h };
}

/**
 * Builds the wall-colour palette from the *safe* border band.
 *
 * The bottom edge is deliberately excluded: in a passport photo the customer's
 * shoulders normally touch the bottom of the frame, and sampling there taught
 * the old engine that a red shirt was "background" — it then erased the person.
 * The top edge and the upper part of the sides are almost always wall.
 */
function buildBorderPalette(data: Uint8ClampedArray, w: number, h: number, k = 6): number[][] {
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const sideLimit = Math.round(h * 0.62); // sides: ignore the shoulder zone
  const samples: number[] = [];
  const step = Math.max(1, Math.round((w + h) / 300));

  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const a = data[i + 3];
    if (a < 24) return; // already transparent
    samples.push(data[i], data[i + 1], data[i + 2]);
  };

  // Top edge (full width, a few rows deep)
  for (let x = 0; x < w; x += step) {
    for (let r = 0; r < ring; r++) push(x, r);
  }
  // Left and right edges, upper part only
  for (let y = 0; y < sideLimit; y += step) {
    for (let r = 0; r < ring; r++) {
      push(r, y);
      push(w - 1 - r, y);
    }
  }

  const count = samples.length / 3;
  if (count === 0) return [[255, 255, 255]];

  const centroids: number[][] = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * (count / k)) * 3;
    centroids.push([samples[idx], samples[idx + 1], samples[idx + 2]]);
  }

  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  for (let iter = 0; iter < 6; iter++) {
    sums.fill(0);
    counts.fill(0);
    for (let p = 0; p < count; p++) {
      const r = samples[p * 3];
      const g = samples[p * 3 + 1];
      const b = samples[p * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - centroids[c][0];
        const dg = g - centroids[c][1];
        const db = b - centroids[c][2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      sums[best * 3] += r;
      sums[best * 3 + 1] += g;
      sums[best * 3 + 2] += b;
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = [
          sums[c * 3] / counts[c],
          sums[c * 3 + 1] / counts[c],
          sums[c * 3 + 2] / counts[c],
        ];
      }
    }
  }

  // Drop stray clusters (a bit of hair or strap caught in the sample band).
  const minShare = count * 0.08;
  const kept = centroids.filter((_, i) => counts[i] >= minShare);
  return kept.length > 0 ? kept : centroids.filter((_, i) => counts[i] > 0);
}

function distToPalette(r: number, g: number, b: number, palette: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    // Perceptual weighting, normalised so 255 is the maximum distance.
    const d = Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
    if (d < best) best = d;
  }
  return best;
}

function boxBlurAlpha(alpha: Uint8ClampedArray, w: number, h: number, radius: number) {
  if (radius <= 0) return;
  const tmp = new Uint8ClampedArray(alpha.length);
  const r = Math.round(radius);
  const span = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += alpha[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      const outIdx = row + Math.min(w - 1, Math.max(0, x - r));
      const inIdx = row + Math.min(w - 1, Math.max(0, x + r + 1));
      sum += alpha[inIdx] - alpha[outIdx];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      alpha[y * w + x] = sum / span;
      const outIdx = Math.min(h - 1, Math.max(0, y - r)) * w + x;
      const inIdx = Math.min(h - 1, Math.max(0, y + r + 1)) * w + x;
      sum += tmp[inIdx] - tmp[outIdx];
    }
  }
}

function erodeMask(mask: Uint8ClampedArray, w: number, h: number, iterations: number) {
  for (let it = 0; it < iterations; it++) {
    const copy = new Uint8ClampedArray(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (copy[i] === 0) continue;
        const min =
          copy[i - 1] < copy[i + 1] ? copy[i - 1] : copy[i + 1];
        const min2 = copy[i - w] < copy[i + w] ? copy[i - w] : copy[i + w];
        mask[i] = Math.min(min, min2);
      }
    }
  }
}

/** Removes tiny foreground islands (dust / stray hairs) that survive the flood fill. */
function despeckleMask(mask: Uint8ClampedArray, w: number, h: number) {
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  const minArea = Math.max(24, Math.round(w * h * 0.0016));

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start]) continue;
    const component: number[] = [];
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      component.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < w - 1 && mask[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && mask[idx - w] && !visited[idx - w]) {
        visited[idx - w] = 1;
        stack.push(idx - w);
      }
      if (y < h - 1 && mask[idx + w] && !visited[idx + w]) {
        visited[idx + w] = 1;
        stack.push(idx + w);
      }
      if (component.length > 60000) break; // big component, no need to keep scanning
    }
    if (component.length < minArea) {
      for (const idx of component) mask[idx] = 0;
    }
  }
}

/**
 * Fast offline cutout. Plain-wall portraits are done in well under 300 ms and
 * the result is a genuinely soft matte instead of the hard, halo-heavy mask the
 * old version produced.
 */
export function fastCutout(img: HTMLImageElement, options: CutoutOptions = {}): CutoutResult {
  const t0 = performance.now();
  const tolerance = options.tolerance ?? 42;
  const feather = options.feather ?? 1.4;
  const shrink = Math.round(options.shrink ?? 1);
  const despeckle = options.despeckle ?? true;
  const maxAnalysis = options.maxAnalysis ?? 720;

  const { canvas: small, w, h } = drawScaled(img, maxAnalysis);
  const ctxSmall = small.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctxSmall.getImageData(0, 0, w, h);
  const data = imageData.data;

  const palette = buildBorderPalette(data, w, h, 6);
  const threshold = Math.max(14, tolerance * 0.55);

  // Per-pixel: is this close to one of the border (wall) colours?
  const distances = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    distances[p] = distToPalette(data[i], data[i + 1], data[i + 2], palette);
  }

  const flood = (threshold: number): { bg: Uint8Array; removed: number } => {
  const bg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;

  const seed = (x: number, y: number) => {
    const p = y * w + x;
    if (!bg[p] && distances[p] <= threshold) {
      bg[p] = 1;
      stack[sp++] = p;
    }
  };
  // Seed only from the top edge and the upper sides — never the bottom, where
  // the subject's shoulders normally sit.
  for (let x = 0; x < w; x++) seed(x, 0);
  const sideSeedLimit = Math.round(h * 0.7);
  for (let y = 0; y < sideSeedLimit; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && !bg[p - 1] && distances[p - 1] <= threshold) {
      bg[p - 1] = 1;
      stack[sp++] = p - 1;
    }
    if (x < w - 1 && !bg[p + 1] && distances[p + 1] <= threshold) {
      bg[p + 1] = 1;
      stack[sp++] = p + 1;
    }
    if (y > 0 && !bg[p - w] && distances[p - w] <= threshold) {
      bg[p - w] = 1;
      stack[sp++] = p - w;
    }
    if (y < h - 1 && !bg[p + w] && distances[p + w] <= threshold) {
      bg[p + w] = 1;
      stack[sp++] = p + w;
    }
  }

    let removed = 0;
    for (let i = 0; i < bg.length; i++) if (bg[i]) removed++;
    return { bg, removed };
  };

  // A photo where the subject fills the frame can be over-removed; in that case
  // retry with a stricter colour threshold, then give up rather than hand the
  // customer an empty rectangle.
  let { bg, removed } = flood(threshold);
  if (removed / (w * h) > 0.9) {
    const strict = Math.max(10, threshold * 0.55);
    const retry = flood(strict);
    if (retry.removed / (w * h) < removed / (w * h)) {
      bg = retry.bg;
      removed = retry.removed;
    }
  }

  // Alpha = inverse background, plus a soft band where the colour is *almost*
  // the wall colour. This is what removes the classic white halo around hair.
  const alphaSmall = new Uint8ClampedArray(w * h);
  const softBand = Math.max(6, threshold * 0.55);
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) {
      alphaSmall[p] = 0;
      continue;
    }
    const d = distances[p];
    if (d >= threshold + softBand) alphaSmall[p] = 255;
    else alphaSmall[p] = Math.round(((d - threshold) / softBand) * 255);
  }

  if (despeckle) despeckleMask(alphaSmall, w, h);
  if (shrink > 0) erodeMask(alphaSmall, w, h, shrink);
  boxBlurAlpha(alphaSmall, w, h, feather);

  // Upsample the matte to the full-resolution photo (bilinear), and apply it.
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const outCtx = out.getContext('2d', { willReadFrequently: true })!;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(img, 0, 0, sw, sh);

  const fullData = outCtx.getImageData(0, 0, sw, sh);
  const fd = fullData.data;
  const xRatio = (w - 1) / Math.max(1, sw - 1);
  const yRatio = (h - 1) / Math.max(1, sh - 1);

  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;

  const colX = new Int32Array(sw);
  const colFrac = new Float32Array(sw);
  for (let x = 0; x < sw; x++) {
    const sx = x * xRatio;
    colX[x] = Math.min(w - 1, sx | 0);
    colFrac[x] = sx - colX[x];
  }

  for (let y = 0; y < sh; y++) {
    const sy = y * yRatio;
    const y0 = Math.min(h - 1, sy | 0);
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = sy - y0;
    const row0 = y0 * w;
    const row1 = y1 * w;
    const outRow = y * sw * 4;

    for (let x = 0; x < sw; x++) {
      const x0 = colX[x];
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = colFrac[x];

      const top = alphaSmall[row0 + x0] * (1 - wx) + alphaSmall[row0 + x1] * wx;
      const bottom = alphaSmall[row1 + x0] * (1 - wx) + alphaSmall[row1 + x1] * wx;
      const a = top * (1 - wy) + bottom * wy;

      const idx = outRow + x * 4;
      if (a <= 1) {
        fd[idx + 3] = 0;
      } else {
        fd[idx + 3] = a;
        if (a > 26) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  outCtx.putImageData(fullData, 0, 0);

  const bbox =
    maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

  const coverage = bbox ? (bbox.w * bbox.h) / (sw * sh) : 0;
  const removedFraction = removed / (w * h);

  // Sanity check: a portrait whose "subject" is a thin sliver while almost the
  // whole frame was removed means we ate the person. Return the original image
  // untouched and let the shopkeeper switch engines, instead of an empty PNG.
  const failed = !bbox || (removedFraction > 0.8 && coverage < 0.35);

  if (failed) {
    const fallback = outCtx.createImageData(sw, sh);
    fallback.data.set(fd);
    for (let i = 3; i < fallback.data.length; i += 4) fallback.data[i] = 255;
    outCtx.putImageData(fallback, 0, 0);
    return {
      canvas: out,
      bbox: { x: 0, y: 0, w: sw, h: sh },
      ms: Math.round(performance.now() - t0),
      coverage: 1,
      failed: true,
    };
  }

  return { canvas: out, bbox, ms: Math.round(performance.now() - t0), coverage };
}

/** Reads the visible bounding box of an existing cutout (transparent PNG). */
export function alphaBoundingBox(canvas: HTMLCanvasElement): CutoutResult['bbox'] {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
}

/** Crops transparent padding away (used before laying photos on a sheet). */
export function trimTransparent(canvas: HTMLCanvasElement, pad = 0): HTMLCanvasElement {
  const bbox = alphaBoundingBox(canvas);
  if (!bbox) return canvas;
  const x = Math.max(0, bbox.x - pad);
  const y = Math.max(0, bbox.y - pad);
  const w = Math.min(canvas.width - x, bbox.w + pad * 2);
  const h = Math.min(canvas.height - y, bbox.h + pad * 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

// ---------------------------------------------------------------------------
// Neural engine (optional HD path)
// ---------------------------------------------------------------------------

export type AiQuality = 'fast' | 'best';

const aiBlobCache = new Map<string, string>();

function hashKey(src: string, quality: AiQuality): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(src.length / 4096));
  for (let i = 0; i < src.length; i += step) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${quality}:${src.length}:${hash >>> 0}`;
}

let localDatasetAvailable: boolean | null = null;

/** Uses a local copy of the model files when the shop server ships them. */
async function resolvePublicPath(): Promise<string | undefined> {
  if (localDatasetAvailable === null) {
    try {
      const res = await fetch('/bg-data/resources.json', { method: 'GET' });
      const json = res.ok ? await res.json() : null;
      localDatasetAvailable = Boolean(json && Object.keys(json).length > 0);
    } catch {
      localDatasetAvailable = false;
    }
  }
  return localDatasetAvailable ? '/bg-data/' : undefined;
}

export interface AiCutoutOptions {
  quality?: AiQuality;
  onProgress?: (text: string, percent: number) => void;
}

export async function aiCutout(
  srcUrl: string,
  opts: AiCutoutOptions = {}
): Promise<{ canvas: HTMLCanvasElement; cached: boolean; ms: number }> {
  const quality = opts.quality ?? 'fast';
  const key = hashKey(srcUrl, quality);
  const t0 = performance.now();

  const cachedUrl = aiBlobCache.get(key);
  if (cachedUrl) {
    const img = await loadImageElement(cachedUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return { canvas, cached: true, ms: Math.round(performance.now() - t0) };
  }

  const { removeBackground } = await import('@imgly/background-removal');
  const publicPath = await resolvePublicPath();

  const blob = await removeBackground(srcUrl, {
    model: quality === 'best' ? 'medium' : 'small',
    ...(publicPath ? { publicPath } : {}),
    progress: (stage: string, current: number, total: number) => {
      if (!opts.onProgress) return;
      if (!total) {
        opts.onProgress(stage.replace('fetch:', 'Downloading '), -1);
        return;
      }
      const pct = Math.min(100, Math.round((current / total) * 100));
      const label = stage.startsWith('fetch:')
        ? `Downloading AI model ${pct}%`
        : `AI segmentation ${pct}%`;
      opts.onProgress(label, pct);
    },
  });

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);

    // Keep a bounded cache of the last few cutouts so changing the backdrop is instant.
    if (aiBlobCache.size >= 4) {
      const firstKey = aiBlobCache.keys().next().value;
      if (firstKey) {
        const old = aiBlobCache.get(firstKey);
        aiBlobCache.delete(firstKey);
        if (old) URL.revokeObjectURL(old);
      }
    }
    aiBlobCache.set(key, url);
    return { canvas, cached: false, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** True when the device looks too weak for the neural model. */
export function isLowPowerDevice(): boolean {
  const cores = (navigator as any).hardwareConcurrency || 4;
  const mem = (navigator as any).deviceMemory || 4;
  return cores <= 4 && mem <= 4 && /Android|iPhone|iPad/i.test(navigator.userAgent);
}
