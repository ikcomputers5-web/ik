import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  IdCard,
  Camera,
  Printer,
  Download,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import {
  loadImageElement,
  renderFilteredDocumentCanvas,
} from '../lib/imageFilters';

interface IdAndPassportStudioProps {
  incomingPassportPhoto?: string | null;
}

type StudioTab = 'passport' | 'cnic';

export const IdAndPassportStudio: React.FC<IdAndPassportStudioProps> = ({
  incomingPassportPhoto,
}) => {
  const [tab, setTab] = useState<StudioTab>('passport');

  // --- Passport Sheet State ---
  const [photoSrc, setPhotoSrc] = useState<string>('');
  const [photoSizeSpec, setPhotoSizeSpec] = useState<'pk_35x45' | 'visa_2x2' | 'stamp_25x30'>(
    'pk_35x45'
  );
  const [sheetType, setSheetType] = useState<'4x6_8' | 'a4_8' | 'a4_16' | 'a4_30'>('4x6_8');
  const [bgColor, setBgColor] = useState<string>('#0057b7');
  const [cutBorder, setCutBorder] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1.05);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [sheetPreviewUrl, setSheetPreviewUrl] = useState<string>('');

  // --- CNIC Front & Back Copier State ---
  const [cnicFrontRaw, setCnicFrontRaw] = useState<string>('');
  const [cnicBackRaw, setCnicBackRaw] = useState<string>('');
  const [frontRot, setFrontRot] = useState<number>(0);
  const [backRot, setBackRot] = useState<number>(0);
  const [cnicCleanBw, setCnicCleanBw] = useState<boolean>(true);
  const [cnicCopies, setCnicCopies] = useState<1 | 2 | 4>(2);
  const [cnicSheetPreview, setCnicSheetPreview] = useState<string>('');

  useEffect(() => {
    if (incomingPassportPhoto) {
      setPhotoSrc(incomingPassportPhoto);
      setTab('passport');
    }
  }, [incomingPassportPhoto]);

  // Render high-res Passport Sheet Preview
  useEffect(() => {
    if (!photoSrc) {
      setSheetPreviewUrl('');
      return;
    }
    let cancelled = false;
    const buildSheet = async () => {
      const img = await loadImageElement(photoSrc);
      const pxPerMm = 11.811; // 300 DPI!

      const dimsMm =
        photoSizeSpec === 'pk_35x45'
          ? { w: 35, h: 45 }
          : photoSizeSpec === 'visa_2x2'
          ? { w: 50.8, h: 50.8 }
          : { w: 25, h: 30 };

      const sheetMm =
        sheetType === '4x6_8' ? { w: 152.4, h: 101.6 } : { w: 210, h: 297 }; // 6x4 landscape or A4 portrait

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sheetMm.w * pxPerMm);
      canvas.height = Math.round(sheetMm.h * pxPerMm);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Prepare single cropped passport tile
      const tileW = Math.round(dimsMm.w * pxPerMm);
      const tileH = Math.round(dimsMm.h * pxPerMm);
      const tile = document.createElement('canvas');
      tile.width = tileW;
      tile.height = tileH;
      const tCtx = tile.getContext('2d')!;
      tCtx.fillStyle = bgColor;
      tCtx.fillRect(0, 0, tileW, tileH);

      const coverScale = Math.max(tileW / img.width, tileH / img.height) * zoom;
      const dw = img.width * coverScale;
      const dh = img.height * coverScale;
      const dx = (tileW - dw) / 2;
      const dy = (tileH - dh) / 2 + offsetY * 3;
      tCtx.drawImage(img, dx, dy, dw, dh);

      if (cutBorder) {
        tCtx.strokeStyle = '#334155';
        tCtx.lineWidth = 3;
        tCtx.strokeRect(1.5, 1.5, tileW - 3, tileH - 3);
      }

      const gap = Math.round(3.2 * pxPerMm);
      const cols = sheetType === '4x6_8' ? 4 : sheetType === 'a4_8' ? 4 : sheetType === 'a4_16' ? 4 : 5;
      const maxCount =
        sheetType === '4x6_8' ? 8 : sheetType === 'a4_8' ? 8 : sheetType === 'a4_16' ? 16 : 30;
      const rows = Math.ceil(maxCount / cols);

      const gridW = cols * tileW + (cols - 1) * gap;
      const gridH = rows * tileH + (rows - 1) * gap;
      const startX = Math.max(20, Math.round((canvas.width - gridW) / 2));
      const startY = sheetType === '4x6_8' ? Math.max(20, Math.round((canvas.height - gridH) / 2)) : Math.round(12 * pxPerMm);

      let placed = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (placed >= maxCount) break;
          const x = startX + c * (tileW + gap);
          const y = startY + r * (tileH + gap);
          if (x + tileW <= canvas.width && y + tileH <= canvas.height) {
            ctx.drawImage(tile, x, y);
            placed++;
          }
        }
      }

      if (!cancelled) {
        setSheetPreviewUrl(canvas.toDataURL('image/jpeg', 0.95));
      }
    };
    buildSheet();
    return () => {
      cancelled = true;
    };
  }, [photoSrc, photoSizeSpec, sheetType, bgColor, cutBorder, zoom, offsetY]);

  // Render exact-scale A4 CNIC Front & Back Sheet (85.6mm × 54mm NADRA standard!)
  useEffect(() => {
    if (!cnicFrontRaw && !cnicBackRaw) {
      setCnicSheetPreview('');
      return;
    }
    let cancelled = false;
    const buildCnicSheet = async () => {
      const pxPerMm = 8; // crisp A4 canvas
      const a4W = Math.round(210 * pxPerMm);
      const a4H = Math.round(297 * pxPerMm);
      const cardW = Math.round(85.6 * pxPerMm);
      const cardH = Math.round(54.0 * pxPerMm);

      const canvas = document.createElement('canvas');
      canvas.width = a4W;
      canvas.height = a4H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, a4W, a4H);

      let frontCanvas: HTMLCanvasElement | null = null;
      let backCanvas: HTMLCanvasElement | null = null;

      if (cnicFrontRaw) {
        const fImg = await loadImageElement(cnicFrontRaw);
        frontCanvas = renderFilteredDocumentCanvas(fImg, {
          filter: cnicCleanBw ? 'magic_bw' : 'vivid_scan',
          rotation: frontRot,
          contrast: cnicCleanBw ? 12 : 4,
        });
      }
      if (cnicBackRaw) {
        const bImg = await loadImageElement(cnicBackRaw);
        backCanvas = renderFilteredDocumentCanvas(bImg, {
          filter: cnicCleanBw ? 'magic_bw' : 'vivid_scan',
          rotation: backRot,
          contrast: cnicCleanBw ? 12 : 4,
        });
      }

      const marginX = Math.round((a4W - (cardW * 2 + 12 * pxPerMm)) / 2);
      const startY = Math.round(16 * pxPerMm);
      const rowGap = Math.round(12 * pxPerMm);

      for (let i = 0; i < cnicCopies; i++) {
        const y = startY + i * (cardH + rowGap);
        if (frontCanvas) {
          ctx.drawImage(frontCanvas, marginX, y, cardW, cardH);
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(marginX, y, cardW, cardH);
        }
        if (backCanvas) {
          const bx = marginX + cardW + Math.round(12 * pxPerMm);
          ctx.drawImage(backCanvas, bx, y, cardW, cardH);
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, y, cardW, cardH);
        }
      }

      if (!cancelled) {
        setCnicSheetPreview(canvas.toDataURL('image/jpeg', 0.94));
      }
    };
    buildCnicSheet();
    return () => {
      cancelled = true;
    };
  }, [cnicFrontRaw, cnicBackRaw, frontRot, backRot, cnicCleanBw, cnicCopies]);

  const downloadPdfFromSheet = (imgUrl: string, is4x6: boolean, fileName: string) => {
    if (!imgUrl) return;
    if (is4x6) {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [152.4, 101.6] });
      pdf.addImage(imgUrl, 'JPEG', 0, 0, 152.4, 101.6);
      pdf.save(fileName);
    } else {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      pdf.addImage(imgUrl, 'JPEG', 0, 0, 210, 297);
      pdf.save(fileName);
    }
  };

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTab('passport')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'passport' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" /> Passport & Visa Photo Sheet
          </button>
          <button
            onClick={() => setTab('cnic')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'cnic' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <IdCard className="w-3.5 h-3.5" /> CNIC (شناختی کارڈ) Front & Back A4 Copier
          </button>
        </div>

        {(tab === 'passport' ? sheetPreviewUrl : cnicSheetPreview) && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4 text-emerald-400" /> Direct Print Sheet
            </button>
            <button
              onClick={() =>
                tab === 'passport'
                  ? downloadPdfFromSheet(
                      sheetPreviewUrl,
                      sheetType === '4x6_8',
                      `IK-Passport-Sheet-${Date.now()}.pdf`
                    )
                  : downloadPdfFromSheet(
                      cnicSheetPreview,
                      false,
                      `IK-CNIC-A4-${Date.now()}.pdf`
                    )
              }
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
            >
              <Download className="w-4 h-4" /> Download 300-DPI PDF
            </button>
          </div>
        )}
      </div>

      {/* TAB A: PASSPORT PHOTO SHEET MAKER */}
      {tab === 'passport' && (
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 no-print">
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
            <h3 className="font-bold text-white text-base">Passport Sheet Settings</h3>

            <label className="block border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center cursor-pointer">
              <span className="text-xs font-bold text-emerald-400">
                {photoSrc ? 'Change Customer Photo' : '+ Select Portrait / Cutout Photo'}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setPhotoSrc(await readAsDataUrl(f));
                }}
                className="hidden"
              />
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Photo Dimension Standard
              </label>
              <select
                value={photoSizeSpec}
                onChange={(e) => setPhotoSizeSpec(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value="pk_35x45">Pakistan Passport / NADRA (35 × 45 mm)</option>
                <option value="visa_2x2">US / Visa Square (2 × 2 inch)</option>
                <option value="stamp_25x30">Ticket / Stamp Size (25 × 30 mm)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Print Paper & Quantity
              </label>
              <select
                value={sheetType}
                onChange={(e) => setSheetType(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-300 font-semibold"
              >
                <option value="4x6_8">4 × 6 inch Photo Paper (8 Photos)</option>
                <option value="a4_8">A4 Top Row (8 Photos)</option>
                <option value="a4_16">A4 Half Sheet (16 Photos)</option>
                <option value="a4_30">A4 Full Sheet (30 Photos)</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Backdrop Fill (for transparent PNGs):
              </span>
              <div className="flex items-center gap-1.5">
                {['#0057b7', '#ffffff', '#38bdf8', '#dc2626'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setBgColor(c)}
                    style={{ background: c }}
                    className={`w-6 h-6 rounded-full border ${
                      bgColor === c ? 'ring-2 ring-emerald-400 border-white' : 'border-slate-600'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Face Zoom ({Math.round(zoom * 100)}%)
              </label>
              <input
                type="range"
                min={0.85}
                max={1.6}
                step={0.02}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Vertical Head Position</label>
              <input
                type="range"
                min={-40}
                max={40}
                value={offsetY}
                onChange={(e) => setOffsetY(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={cutBorder}
                onChange={(e) => setCutBorder(e.target.checked)}
                className="accent-emerald-500"
              />
              Add Scissor Cut Guide Border
            </label>
          </div>

          <div className="lg:col-span-8 flex items-center justify-center bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            {sheetPreviewUrl ? (
              <img
                src={sheetPreviewUrl}
                alt="Passport Sheet Preview"
                className="max-h-[72vh] w-auto object-contain shadow-2xl rounded bg-white"
              />
            ) : (
              <p className="text-xs text-slate-500">
                Upload a photo (or send a cutout from BG Remover) to generate a 300-DPI Passport
                Sheet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB B: CNIC FRONT & BACK A4 COPIER */}
      {tab === 'cnic' && (
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 no-print">
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
            <div>
              <h3 className="font-bold text-white text-base">
                CNIC Front & Back A4 Sheet (شناختی کارڈ)
              </h3>
              <p className="text-xs text-slate-400">
                Auto-scales WhatsApp photos to exact NADRA ID Card size (85.6 × 54 mm) on A4!
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <label className="block border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-3 text-center cursor-pointer">
                  <span className="text-xs font-bold text-emerald-400 block">
                    {cnicFrontRaw ? '✓ CNIC Front' : '+ Front Side'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setCnicFrontRaw(await readAsDataUrl(f));
                    }}
                    className="hidden"
                  />
                </label>
                {cnicFrontRaw && (
                  <button
                    onClick={() => setFrontRot((r) => (r + 90) % 360)}
                    className="w-full py-1 rounded bg-slate-800 text-[11px] text-slate-300 flex items-center justify-center gap-1"
                  >
                    <RotateCw className="w-3 h-3" /> Rotate Front
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-3 text-center cursor-pointer">
                  <span className="text-xs font-bold text-sky-400 block">
                    {cnicBackRaw ? '✓ CNIC Back' : '+ Back Side'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setCnicBackRaw(await readAsDataUrl(f));
                    }}
                    className="hidden"
                  />
                </label>
                {cnicBackRaw && (
                  <button
                    onClick={() => setBackRot((r) => (r + 90) % 360)}
                    className="w-full py-1 rounded bg-slate-800 text-[11px] text-slate-300 flex items-center justify-center gap-1"
                  >
                    <RotateCw className="w-3 h-3" /> Rotate Back
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Copies on Single A4 Page
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([1, 2, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setCnicCopies(n)}
                    className={`py-2 rounded-xl text-xs font-bold border ${
                      cnicCopies === n
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {n} {n === 1 ? 'Copy' : 'Copies'}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2.5 bg-amber-950/30 border border-amber-700/50 rounded-xl p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cnicCleanBw}
                onChange={(e) => setCnicCleanBw(e.target.checked)}
                className="accent-amber-500 w-4 h-4"
              />
              <div className="text-xs">
                <div className="font-bold text-amber-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> Clean B&W Photostat Toner Saver
                </div>
                <div className="text-slate-400">
                  Whitens dark WhatsApp shadows for clean laser photocopy printing
                </div>
              </div>
            </label>
          </div>

          <div className="lg:col-span-8 flex items-center justify-center bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            {cnicSheetPreview ? (
              <img
                src={cnicSheetPreview}
                alt="CNIC A4 Sheet Preview"
                className="max-h-[72vh] w-auto object-contain shadow-2xl rounded bg-white"
              />
            ) : (
              <p className="text-xs text-slate-500">
                Upload CNIC Front & Back images to lay them out cleanly on 1 A4 page.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Dedicated Clean Print Target */}
      {(tab === 'passport' ? sheetPreviewUrl : cnicSheetPreview) && (
        <div id="ik-print-area" className="hidden print:block bg-white">
          <img
            src={tab === 'passport' ? sheetPreviewUrl : cnicSheetPreview}
            alt="Print Sheet"
            className="w-full h-auto"
          />
        </div>
      )}
    </div>
  );
};
