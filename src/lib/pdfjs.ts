// IK Computers — Single shared PDF.js setup (bundled worker, works offline)
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Point PDF.js at the Vite-bundled worker so it never touches a CDN / network.
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

export { pdfjsLib };

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** Normalise any rotation into 0 | 90 | 180 | 270 */
export function normalizeRotation(deg: number): number {
  const d = Math.round((deg || 0) / 90) * 90;
  return ((d % 360) + 360) % 360;
}

/**
 * Render one page of a PDF into a JPEG/PNG data URL.
 * `rotation` overrides the page's own rotation (use to bake /Rotate into pixels).
 */
export async function renderPdfPageToDataUrl(
  bytes: Uint8Array,
  pageIndex: number,
  opts: { scale?: number; rotation?: number; mime?: 'image/png' | 'image/jpeg'; quality?: number; doc?: import('pdfjs-dist').PDFDocumentProxy } = {}
): Promise<{ dataUrl: string; widthPt: number; heightPt: number; pxWidth: number; pxHeight: number }> {
  const scale = opts.scale ?? 1.5;
  const mime = opts.mime ?? 'image/png';
  let doc: import('pdfjs-dist').PDFDocumentProxy | null = opts.doc ?? null;
  const ownsDoc = !doc;
  try {
    if (!doc) {
      doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    }
    const page = await doc.getPage(pageIndex + 1);
    const rotation = normalizeRotation(opts.rotation ?? page.rotate);
    const baseVp = page.getViewport({ scale: 1, rotation });
    const vp = page.getViewport({ scale, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.');
    // White background – PDF.js leaves transparency otherwise.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return {
      dataUrl: canvas.toDataURL(mime, opts.quality ?? 0.94),
      widthPt: baseVp.width,
      heightPt: baseVp.height,
      pxWidth: canvas.width,
      pxHeight: canvas.height,
    };
  } finally {
    if (ownsDoc && doc) {
      try {
        await doc.destroy();
      } catch {
        /* ignore */
      }
    }
  }
}
