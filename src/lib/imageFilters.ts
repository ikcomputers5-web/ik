// IK Computers — Print-Shop Document Enhancer, Toner-Saver Shadow Remover,
// Signature Transparent Extractor & Portal KB Compressor

export type DocFilterMode =
  | 'original'
  | 'magic_bw'
  | 'grayscale_photostat'
  | 'cnic_photostat'
  | 'vivid_scan';

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

export function renderFilteredDocumentCanvas(
  img: HTMLImageElement,
  options: {
    filter: DocFilterMode;
    rotation?: number; // 0, 90, 180, 270
    brightness?: number; // -50 to +50
    contrast?: number; // -50 to +50
    maxDimension?: number;
  }
): HTMLCanvasElement {
  const rot = ((options.rotation || 0) % 360 + 360) % 360;
  const maxDim = options.maxDimension || 2000;

  let srcW = img.naturalWidth || img.width;
  let srcH = img.naturalHeight || img.height;
  if (Math.max(srcW, srcH) > maxDim) {
    const scale = maxDim / Math.max(srcW, srcH);
    srcW = Math.round(srcW * scale);
    srcH = Math.round(srcH * scale);
  }

  const swap = rot === 90 || rot === 270;
  const outW = swap ? srcH : srcW;
  const outH = swap ? srcW : srcH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  const brightness = options.brightness || 0;
  const contrast = options.contrast || 0;

  if (options.filter === 'original' && brightness === 0 && contrast === 0) {
    return canvas;
  }

  const imageData = ctx.getImageData(0, 0, outW, outH);
  const data = imageData.data;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  if (options.filter === 'original') {
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = data[i + c] + brightness * 2;
        v = contrastFactor * (v - 128) + 128;
        data[i + c] = Math.max(0, Math.min(255, v));
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  if (options.filter === 'magic_bw') {
    // Adaptive illumination block grid (removes WhatsApp camera shadows -> pure white paper!)
    const lum = new Uint8Array(outW * outH);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      lum[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    const blockSize = 24;
    const gridW = Math.ceil(outW / blockSize);
    const gridH = Math.ceil(outH / blockSize);
    const bgGrid = new Float32Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        let maxVal = 120;
        let sum = 0;
        let count = 0;
        const y0 = gy * blockSize;
        const x0 = gx * blockSize;
        const y1 = Math.min(outH, y0 + blockSize);
        const x1 = Math.min(outW, x0 + blockSize);
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const v = lum[y * outW + x];
            if (v > maxVal) maxVal = v;
            sum += v;
            count++;
          }
        }
        const mean = count > 0 ? sum / count : 200;
        bgGrid[gy * gridW + gx] = 0.65 * maxVal + 0.35 * mean;
      }
    }

    const threshShift = brightness * 0.4;
    for (let y = 0; y < outH; y++) {
      const gy = Math.min(gridH - 1, Math.floor(y / blockSize));
      for (let x = 0; x < outW; x++) {
        const gx = Math.min(gridW - 1, Math.floor(x / blockSize));
        const p = y * outW + x;
        const localBg = Math.max(60, bgGrid[gy * gridW + gx]);
        const normalized = (lum[p] / localBg) * 255 + threshShift;
        let out: number;
        if (normalized > 218) {
          out = 255; // Pure toner-free white paper
        } else if (normalized < 145) {
          out = Math.max(0, (normalized - 80) * 0.5);
        } else {
          // Smooth crisp edge transition for Urdu Nastaliq curves
          out = Math.round(((normalized - 145) / (218 - 145)) * 255);
        }
        out = Math.max(0, Math.min(255, contrastFactor * (out - 128) + 128));
        const idx = p * 4;
        data[idx] = out;
        data[idx + 1] = out;
        data[idx + 2] = out;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  if (options.filter === 'cnic_photostat') {
    // Portrait-Safe NADRA CNIC Photostat Filter:
    // Whitens card background/shadows while preserving smooth facial halftones on ID portraits!
    const lum = new Uint8Array(outW * outH);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      lum[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    const blockSize = 32;
    const gridW = Math.ceil(outW / blockSize);
    const gridH = Math.ceil(outH / blockSize);
    const bgGrid = new Float32Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        let maxV = 140;
        const y1 = Math.min(outH, (gy + 1) * blockSize);
        const x1 = Math.min(outW, (gx + 1) * blockSize);
        for (let y = gy * blockSize; y < y1; y += 3) {
          for (let x = gx * blockSize; x < x1; x += 3) {
            const v = lum[y * outW + x];
            if (v > maxV) maxV = v;
          }
        }
        bgGrid[gy * gridW + gx] = maxV;
      }
    }

    for (let y = 0; y < outH; y++) {
      const gy = Math.min(gridH - 1, Math.floor(y / blockSize));
      for (let x = 0; x < outW; x++) {
        const gx = Math.min(gridW - 1, Math.floor(x / blockSize));
        const p = y * outW + x;
        const localWhite = Math.max(95, bgGrid[gy * gridW + gx]);
        let norm = (lum[p] / localWhite) * 255 + brightness * 1.8;
        // Soft gamma curve keeps CNIC portrait face clear & readable!
        norm = Math.pow(Math.max(0, Math.min(255, norm)) / 255, 0.88) * 255;
        if (norm > 228) norm = 255;
        let out = contrastFactor * 1.15 * (norm - 132) + 138;
        out = Math.max(0, Math.min(255, Math.round(out)));
        const idx = p * 4;
        data[idx] = out;
        data[idx + 1] = out;
        data[idx + 2] = out;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  if (options.filter === 'grayscale_photostat') {
    for (let i = 0; i < data.length; i += 4) {
      let g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + brightness * 2;
      g = contrastFactor * 1.25 * (g - 135) + 145;
      if (g > 232) g = 255;
      g = Math.max(0, Math.min(255, g));
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // 'vivid_scan' — Whiten paper background while keeping blue stamps & color photos rich
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightness * 2;
    let g = data[i + 1] + brightness * 2;
    let b = data[i + 2] + brightness * 2;
    const lumVal = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lumVal > 202 && sat < 28) {
      r = 255;
      g = 255;
      b = 255;
    } else {
      r = contrastFactor * 1.18 * (r - 128) + 128;
      g = contrastFactor * 1.18 * (g - 128) + 128;
      b = contrastFactor * 1.18 * (b - 128) + 128;
    }
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Extracts handwritten signatures or rubber stamps into crisp transparent PNGs
export function extractSignatureToTransparentCanvas(
  img: HTMLImageElement,
  threshold = 185
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= threshold) {
      d[i + 3] = 0;
    } else {
      const alpha = Math.min(255, Math.round(((threshold - lum) / Math.max(1, threshold * 0.45)) * 255));
      // Deepen ink slightly for clean stamp/signature contrast
      d[i] = Math.max(0, Math.round(r * 0.78));
      d[i + 1] = Math.max(0, Math.round(g * 0.78));
      d[i + 2] = Math.max(0, Math.round(b * 0.85));
      d[i + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Compress image to hit target KB for PPSC / FPSC / NADRA / NTS online portals
export async function compressToTargetKB(
  img: HTMLImageElement,
  targetKB: number,
  maxWidth: number
): Promise<{ dataUrl: string; sizeKB: number; width: number; height: number; quality: number }> {
  const targetBytes = targetKB * 1024;
  let scale = Math.min(1, maxWidth / (img.naturalWidth || img.width));

  let bestUrl = '';
  let bestSize = Infinity;
  let bestW = 0;
  let bestH = 0;
  let bestQ = 0.85;

  for (let pass = 0; pass < 5; pass++) {
    const w = Math.max(80, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(80, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    let lo = 0.12;
    let hi = 0.94;
    for (let iter = 0; iter < 7; iter++) {
      const mid = (lo + hi) / 2;
      const url = canvas.toDataURL('image/jpeg', mid);
      const approxBytes = Math.round(((url.length - 'data:image/jpeg;base64,'.length) * 3) / 4);
      bestUrl = url;
      bestSize = approxBytes;
      bestW = w;
      bestH = h;
      bestQ = mid;
      if (approxBytes > targetBytes) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    if (bestSize <= targetBytes) break;
    scale *= 0.76;
  }

  return {
    dataUrl: bestUrl,
    sizeKB: Math.round((bestSize / 1024) * 10) / 10,
    width: bestW,
    height: bestH,
    quality: Math.round(bestQ * 100),
  };
}
