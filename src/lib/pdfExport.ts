// IK Computers — PDF export pipeline (vector where possible, flattened when rotated)
import { PDFDocument, degrees, rgb, StandardFonts, type PDFPage } from 'pdf-lib';
import { isTextKind, rasterizeTextOverlay, type PdfOverlay } from './pdfOverlay';

export interface ExportPageMeta {
  id: string;
  originalIndex: number;
  /** extra rotation added by the user on top of the PDF's own /Rotate */
  extraRotation: number;
  /** intrinsic (already rotated) page size in points */
  baseW: number;
  baseH: number;
}

export function normalizeDeg(deg: number): number {
  const d = Math.round((deg || 0) / 90) * 90;
  return ((d % 360) + 360) % 360;
}

export function pageViewSize(meta: ExportPageMeta): { w: number; h: number } {
  return normalizeDeg(meta.extraRotation) % 180 !== 0
    ? { w: meta.baseH, h: meta.baseW }
    : { w: meta.baseW, h: meta.baseH };
}

async function drawOverlaysOnPage(
  outDoc: PDFDocument,
  page: PDFPage,
  items: PdfOverlay[],
  vs: { w: number; h: number }
): Promise<void> {
  if (items.length === 0) return;
  const mb = page.getMediaBox();
  const rectFor = (o: PdfOverlay, w: number, h: number) => ({
    x: mb.x + o.x * vs.w,
    y: mb.y + vs.h * (1 - o.y) - h * vs.h,
    width: w * vs.w,
    height: h * vs.h,
  });

  for (const o of items) {
    if (o.kind === 'whiteout') {
      const r = rectFor(o, o.w, o.h);
      page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: rgb(1, 1, 1) });
    } else if (o.kind === 'image' && o.imageDataUrl) {
      const r = rectFor(o, o.w, o.h);
      const embedded = o.imageDataUrl.startsWith('data:image/png')
        ? await outDoc.embedPng(o.imageDataUrl)
        : await outDoc.embedJpg(o.imageDataUrl);
      page.drawImage(embedded, r);
    } else if (isTextKind(o.kind)) {
      const raster = rasterizeTextOverlay(o, vs.w, vs.h);
      if (!raster) continue;
      const r = rectFor(o, raster.wPt / vs.w, raster.hPt / vs.h);
      const png = await outDoc.embedPng(raster.dataUrl);
      page.drawImage(png, r);
    }
  }
}

export interface BuildEditedPdfOptions {
  pdfBytes: Uint8Array;
  pages: ExportPageMeta[];
  overlays: PdfOverlay[];
  addPageNumbers?: boolean;
  /**
   * Renders a page (with a baked rotation) to a JPEG data URL.
   * Only needed for rotated pages that carry edits — those are flattened so the
   * output is pixel-perfect with the on-screen preview.
   */
  renderRotatedPage?: (pageIndex: number, rotationDeg: number) => Promise<string>;
}

export async function buildEditedPdf(opts: BuildEditedPdfOptions): Promise<Uint8Array> {
  const { pages, overlays, addPageNumbers = false, renderRotatedPage } = opts;
  const src = await PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pages.length; i++) {
    const pageMeta = pages[i];
    const vs = pageViewSize(pageMeta);
    const items = overlays.filter((o) => o.pageId === pageMeta.id);
    const srcPage = src.getPage(pageMeta.originalIndex);
    const total = normalizeDeg(srcPage.getRotation().angle + pageMeta.extraRotation);
    const needsFlatten = total !== 0 && (items.length > 0 || addPageNumbers) && Boolean(renderRotatedPage);

    if (needsFlatten && renderRotatedPage) {
      const dataUrl = await renderRotatedPage(pageMeta.originalIndex, total);
      const newPage = out.addPage([vs.w, vs.h]);
      const img = await out.embedJpg(dataUrl);
      newPage.drawImage(img, { x: 0, y: 0, width: vs.w, height: vs.h });
      await drawOverlaysOnPage(out, newPage, items, vs);
      if (addPageNumbers) {
        const label = `Page ${i + 1} of ${pages.length}`;
        const tw = helv.widthOfTextAtSize(label, 9);
        newPage.drawText(label, {
          x: (vs.w - tw) / 2,
          y: 14,
          size: 9,
          font: helv,
          color: rgb(0.35, 0.35, 0.35),
        });
      }
    } else {
      const [copied] = await out.copyPages(src, [pageMeta.originalIndex]);
      copied.setRotation(degrees(total));
      out.addPage(copied);
      if (total === 0) {
        await drawOverlaysOnPage(out, copied, items, vs);
        if (addPageNumbers) {
          const label = `Page ${i + 1} of ${pages.length}`;
          const tw = helv.widthOfTextAtSize(label, 9);
          const mb = copied.getMediaBox();
          copied.drawText(label, {
            x: mb.x + (vs.w - tw) / 2,
            y: mb.y + 14,
            size: 9,
            font: helv,
            color: rgb(0.35, 0.35, 0.35),
          });
        }
      }
    }
  }

  return out.save();
}
