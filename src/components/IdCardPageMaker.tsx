import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  IdCard,
  Printer,
  Download,
  RotateCw,
  ArrowLeftRight,
  Crop,
  Sparkles,
  Upload,
  Check,
  X,
  ClipboardPaste,
  Trash2,
} from 'lucide-react';
import {
  DocFilterMode,
  loadImageElement,
  renderFilteredDocumentCanvas,
} from '../lib/imageFilters';

interface CropRect {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

interface CardSideState {
  rawUrl: string;
  rotation90: number; // 0, 90, 180, 270
  fineTilt: number; // -15..+15 deg
  crop: CropRect;
}

const DEFAULT_SIDE: CardSideState = {
  rawUrl: '',
  rotation90: 0,
  fineTilt: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

type LayoutStyle = 'side_by_side' | 'stacked_vertical' | 'duplex_2page';
type SizePreset = 'exact_100' | 'medium_110' | 'large_125';
type VerticalSlot = 'top' | 'middle' | 'bottom_half' | 'custom';

export const IdCardPageMaker: React.FC = () => {
  const [front, setFront] = useState<CardSideState>({ ...DEFAULT_SIDE });
  const [back, setBack] = useState<CardSideState>({ ...DEFAULT_SIDE });
  const [activePasteTarget, setActivePasteTarget] = useState<'front' | 'back'>('front');

  // Interactive Crop Modal state
  const [cropEditingSide, setCropEditingSide] = useState<'front' | 'back' | null>(null);
  const [tempCrop, setTempCrop] = useState<CropRect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [tempRot90, setTempRot90] = useState<number>(0);
  const [tempTilt, setTempTilt] = useState<number>(0);
  const [rotatedPreviewForCrop, setRotatedPreviewForCrop] = useState<string>('');

  // Print Sheet Settings
  const [layout, setLayout] = useState<LayoutStyle>('side_by_side');
  const [copies, setCopies] = useState<1 | 2 | 3 | 4 | 8>(2);
  const [sizePreset, setSizePreset] = useState<SizePreset>('exact_100');
  const [verticalSlot, setVerticalSlot] = useState<VerticalSlot>('top');
  const [customTopMm, setCustomTopMm] = useState<number>(16);
  const [filterMode, setFilterMode] = useState<DocFilterMode>('cnic_photostat');
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(8);
  const [roundedCorners, setRoundedCorners] = useState<boolean>(true);
  const [showBorder, setShowBorder] = useState<boolean>(true);
  const [crossWatermark, setCrossWatermark] = useState<string>('');

  // Rendered A4 sheet page(s)
  const [page1Url, setPage1Url] = useState<string>('');
  const [page2Url, setPage2Url] = useState<string>('');

  const cropStageRef = useRef<HTMLDivElement | null>(null);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });

  // Support Ctrl+V direct paste from WhatsApp Web!
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((it) => it.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      const url = await fileToDataUrl(file);
      if (activePasteTarget === 'front') {
        setFront({ ...DEFAULT_SIDE, rawUrl: url });
        setActivePasteTarget('back'); // Auto-advance to Back Side for super fast workflow!
      } else {
        setBack({ ...DEFAULT_SIDE, rawUrl: url });
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activePasteTarget]);

  // Handle uploading both Front & Back at the same time
  const handleBulkUploadBoth = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files[0]) {
      const u1 = await fileToDataUrl(files[0]);
      setFront({ ...DEFAULT_SIDE, rawUrl: u1 });
    }
    if (files[1]) {
      const u2 = await fileToDataUrl(files[1]);
      setBack({ ...DEFAULT_SIDE, rawUrl: u2 });
    }
    e.target.value = '';
  };

  // Render cropped, straightened, and photostat-filtered single card canvas
  const renderCardCanvas = useCallback(
    async (side: CardSideState): Promise<HTMLCanvasElement | null> => {
      if (!side.rawUrl) return null;
      const img = await loadImageElement(side.rawUrl);

      // Step 1: Apply 90° rotation + fine tilt onto base canvas
      const swap = side.rotation90 % 180 !== 0;
      const baseW = swap ? img.height : img.width;
      const baseH = swap ? img.width : img.height;
      const rotCanvas = document.createElement('canvas');
      rotCanvas.width = baseW;
      rotCanvas.height = baseH;
      const rCtx = rotCanvas.getContext('2d')!;
      rCtx.fillStyle = '#ffffff';
      rCtx.fillRect(0, 0, baseW, baseH);
      rCtx.save();
      rCtx.translate(baseW / 2, baseH / 2);
      rCtx.rotate(((side.rotation90 + side.fineTilt) * Math.PI) / 180);
      rCtx.drawImage(img, -img.width / 2, -img.height / 2);
      rCtx.restore();

      // Step 2: Crop according to side.crop
      const cx = Math.round(side.crop.x * baseW);
      const cy = Math.round(side.crop.y * baseH);
      const cw = Math.max(20, Math.round(side.crop.w * baseW));
      const ch = Math.max(20, Math.round(side.crop.h * baseH));

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cw;
      croppedCanvas.height = ch;
      const cCtx = croppedCanvas.getContext('2d')!;
      cCtx.drawImage(rotCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

      // Step 3: Apply Smart Photostat / Toner Saver Filter
      const croppedImg = await loadImageElement(croppedCanvas.toDataURL('image/jpeg', 0.96));
      return renderFilteredDocumentCanvas(croppedImg, {
        filter: filterMode,
        rotation: 0,
        brightness,
        contrast,
        maxDimension: 1400,
      });
    },
    [filterMode, brightness, contrast]
  );

  // Build preview image inside Crop Modal when rotating/tilting
  useEffect(() => {
    if (!cropEditingSide) {
      setRotatedPreviewForCrop('');
      return;
    }
    const side = cropEditingSide === 'front' ? front : back;
    if (!side.rawUrl) return;
    let cancelled = false;
    (async () => {
      const img = await loadImageElement(side.rawUrl);
      const swap = tempRot90 % 180 !== 0;
      const w = swap ? img.height : img.width;
      const h = swap ? img.width : img.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(((tempRot90 + tempTilt) * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (!cancelled) setRotatedPreviewForCrop(c.toDataURL('image/jpeg', 0.9));
    })();
    return () => {
      cancelled = true;
    };
  }, [cropEditingSide, front, back, tempRot90, tempTilt]);

  // Draw rounded-corner card helper
  const drawCardOnSheet = (
    ctx: CanvasRenderingContext2D,
    cardCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    radiusPx: number
  ) => {
    ctx.save();
    if (roundedCorners) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radiusPx);
      ctx.clip();
    }
    ctx.drawImage(cardCanvas, x, y, w, h);

    if (crossWatermark.trim()) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(-0.32);
      ctx.font = `bold ${Math.round(h * 0.075)}px sans-serif`;
      ctx.fillStyle = 'rgba(220, 38, 38, 0.32)';
      ctx.textAlign = 'center';
      ctx.fillText(crossWatermark.trim().toUpperCase(), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    if (showBorder) {
      ctx.save();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      if (roundedCorners) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radiusPx);
        ctx.stroke();
      } else {
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    }
  };

  // Render complete high-DPI A4 Sheet live preview
  useEffect(() => {
    if (!front.rawUrl && !back.rawUrl) {
      setPage1Url('');
      setPage2Url('');
      return;
    }
    let cancelled = false;
    const generateSheets = async () => {
      const pxPerMm = 9.5; // High-crisp A4 ~240 DPI
      const a4W = Math.round(210 * pxPerMm);
      const a4H = Math.round(297 * pxPerMm);

      const cardMm =
        sizePreset === 'exact_100'
          ? { w: 85.6, h: 54.0 }
          : sizePreset === 'medium_110'
          ? { w: 94.0, h: 59.3 }
          : { w: 107.0, h: 67.5 };

      const cardW = Math.round(cardMm.w * pxPerMm);
      const cardH = Math.round(cardMm.h * pxPerMm);
      const cornerR = Math.round(3.2 * pxPerMm);
      const gapMm = sizePreset === 'large_125' ? 6 : 10;
      const gapPx = Math.round(gapMm * pxPerMm);

      const [frontCard, backCard] = await Promise.all([
        renderCardCanvas(front),
        renderCardCanvas(back),
      ]);

      const sheet1 = document.createElement('canvas');
      sheet1.width = a4W;
      sheet1.height = a4H;
      const ctx1 = sheet1.getContext('2d')!;
      ctx1.fillStyle = '#ffffff';
      ctx1.fillRect(0, 0, a4W, a4H);

      const getStartY = (totalBlockHeight: number) => {
        if (verticalSlot === 'top') return Math.round(15 * pxPerMm);
        if (verticalSlot === 'middle') return Math.max(40, Math.round((a4H - totalBlockHeight) / 2));
        if (verticalSlot === 'bottom_half') return Math.round(154 * pxPerMm); // Starts right below A4 midpoint!
        return Math.round(customTopMm * pxPerMm);
      };

      if (layout === 'side_by_side') {
        // If 8 copies -> 2 pairs per row? Wait: 2 cards = 171mm wide, fits 1 pair (Front+Back) per row, up to 4 rows = 4 pairs; for 8 copies we compact slightly to fit 5 rows or 2x4!
        const effectiveCardW = copies === 8 ? Math.round(82 * pxPerMm) : cardW;
        const effectiveCardH = copies === 8 ? Math.round(51.5 * pxPerMm) : cardH;
        const rowGap = copies === 8 ? Math.round(4 * pxPerMm) : gapPx;
        const rows = copies === 8 ? 5 : copies; // up to 4 pairs cleanly, or 8 single/compact

        if (copies === 8) {
          // 8 pairs: 4 rows × 2 pairs? 4 cards across would exceed 210mm unless landscape, so draw 4 rows on Page 1 + 4 rows on Page 2 OR compact 2x4! Let's fit 4 rows cleanly on Page 1 & 4 on Page 2 OR 5 rows! Actually 54mm * 5 = 270mm (5 copies on 1 A4!). For 8 copies let's scale to 68×43mm so all 8 Front+Back pairs fit on ONE single A4 sheet (2 columns of pairs or 8 rows? 8 rows * 34mm = 272mm, OR 2 pairs per row at 46mm width)! Let's draw 4 rows × 2 columns of stacked mini pairs or 52×33mm so ALL 8 copies fit on 1 A4!
          const w8 = Math.round(46 * pxPerMm);
          const h8 = Math.round(29 * pxPerMm);
          const g8 = Math.round(3.5 * pxPerMm);
          const rowTotalW = w8 * 4 + g8 * 3;
          const sx = Math.round((a4W - rowTotalW) / 2);
          const sy = Math.round(16 * pxPerMm);
          for (let i = 0; i < 8; i++) {
            const r = Math.floor(i / 2);
            const pairCol = i % 2;
            const px = sx + pairCol * (w8 * 2 + g8 * 2);
            const py = sy + r * (h8 + Math.round(8 * pxPerMm));
            if (frontCard) drawCardOnSheet(ctx1, frontCard, px, py, w8, h8, Math.round(cornerR * 0.6));
            if (backCard)
              drawCardOnSheet(ctx1, backCard, px + w8 + g8, py, w8, h8, Math.round(cornerR * 0.6));
          }
        } else {
          const pairW = effectiveCardW * 2 + gapPx;
          const startX = Math.max(20, Math.round((a4W - pairW) / 2));
          const totalH = rows * effectiveCardH + (rows - 1) * rowGap;
          const startY = getStartY(totalH);

          for (let r = 0; r < copies; r++) {
            const y = startY + r * (effectiveCardH + rowGap);
            if (frontCard) {
              drawCardOnSheet(ctx1, frontCard, startX, y, effectiveCardW, effectiveCardH, cornerR);
            }
            if (backCard) {
              drawCardOnSheet(
                ctx1,
                backCard,
                startX + effectiveCardW + gapPx,
                y,
                effectiveCardW,
                effectiveCardH,
                cornerR
              );
            }
          }
        }
        if (!cancelled) {
          setPage1Url(sheet1.toDataURL('image/jpeg', 0.95));
          setPage2Url('');
        }
      } else if (layout === 'stacked_vertical') {
        // Front on top, Back directly underneath (centered column or 2 columns for 2+ copies)
        const cols = copies >= 2 ? 2 : 1;
        const pairH = cardH * 2 + Math.round(6 * pxPerMm);
        const rowsCount = Math.ceil(Math.min(copies, 4) / cols);
        const totalW = cols * cardW + (cols - 1) * gapPx;
        const totalH = rowsCount * pairH + (rowsCount - 1) * gapPx;
        const startX = Math.round((a4W - totalW) / 2);
        const startY = getStartY(totalH);

        let drawn = 0;
        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < cols; c++) {
            if (drawn >= Math.min(copies, 4)) break;
            const x = startX + c * (cardW + gapPx);
            const y = startY + r * (pairH + gapPx);
            if (frontCard) drawCardOnSheet(ctx1, frontCard, x, y, cardW, cardH, cornerR);
            if (backCard)
              drawCardOnSheet(
                ctx1,
                backCard,
                x,
                y + cardH + Math.round(6 * pxPerMm),
                cardW,
                cardH,
                cornerR
              );
            drawn++;
          }
        }
        if (!cancelled) {
          setPage1Url(sheet1.toDataURL('image/jpeg', 0.95));
          setPage2Url('');
        }
      } else {
        // Duplex 2-Page Mode: Page 1 has Fronts, Page 2 has Backs mirrored horizontally so double-sided A4 flip lines up 100%!
        const sheet2 = document.createElement('canvas');
        sheet2.width = a4W;
        sheet2.height = a4H;
        const ctx2 = sheet2.getContext('2d')!;
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(0, 0, a4W, a4H);

        const cols = copies >= 2 ? 2 : 1;
        const count = Math.min(copies, 4);
        const rowsCount = Math.ceil(count / cols);
        const totalW = cols * cardW + (cols - 1) * gapPx;
        const totalH = rowsCount * cardH + (rowsCount - 1) * gapPx;
        const startX = Math.round((a4W - totalW) / 2);
        const startY = getStartY(totalH);

        let drawn = 0;
        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < cols; c++) {
            if (drawn >= count) break;
            const xFront = startX + c * (cardW + gapPx);
            // Mirror X on Page 2 for exact duplex back-to-front registration!
            const xBack = a4W - xFront - cardW;
            const y = startY + r * (cardH + gapPx);
            if (frontCard) drawCardOnSheet(ctx1, frontCard, xFront, y, cardW, cardH, cornerR);
            if (backCard) drawCardOnSheet(ctx2, backCard, xBack, y, cardW, cardH, cornerR);
            drawn++;
          }
        }
        if (!cancelled) {
          setPage1Url(sheet1.toDataURL('image/jpeg', 0.95));
          setPage2Url(sheet2.toDataURL('image/jpeg', 0.95));
        }
      }
    };

    generateSheets();
    return () => {
      cancelled = true;
    };
  }, [
    front,
    back,
    layout,
    copies,
    sizePreset,
    verticalSlot,
    customTopMm,
    roundedCorners,
    showBorder,
    crossWatermark,
    renderCardCanvas,
  ]);

  const handleOpenCropModal = (which: 'front' | 'back') => {
    const s = which === 'front' ? front : back;
    if (!s.rawUrl) return;
    setTempCrop({ ...s.crop });
    setTempRot90(s.rotation90);
    setTempTilt(s.fineTilt);
    setCropEditingSide(which);
  };

  const handleSaveCrop = () => {
    if (!cropEditingSide) return;
    const updater = (prev: CardSideState): CardSideState => ({
      ...prev,
      crop: { ...tempCrop },
      rotation90: tempRot90,
      fineTilt: tempTilt,
    });
    if (cropEditingSide === 'front') setFront(updater);
    else setBack(updater);
    setCropEditingSide(null);
  };

  // Drag-draw crop rectangle directly on image inside Crop Modal
  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropStageRef.current) return;
    const rect = cropStageRef.current.getBoundingClientRect();
    const startX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const startY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const onMove = (ev: MouseEvent) => {
      const curX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const curY = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.max(0.08, Math.abs(curX - startX));
      const h = Math.max(0.08, Math.abs(curY - startY));
      setTempCrop({ x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDownloadPdf = () => {
    if (!page1Url) return;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.addImage(page1Url, 'JPEG', 0, 0, 210, 297);
    if (page2Url) {
      pdf.addPage('a4', 'portrait');
      pdf.addImage(page2Url, 'JPEG', 0, 0, 210, 297);
    }
    pdf.save(`IK-ID-Card-A4-${Date.now()}.pdf`);
  };

  const handleDownloadJpg = () => {
    if (!page1Url) return;
    const a = document.createElement('a');
    a.href = page1Url;
    a.download = `IK-ID-Card-Page-${Date.now()}.jpg`;
    a.click();
  };

  const swapFrontBack = () => {
    const tmp = front;
    setFront(back);
    setBack(tmp);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top Action Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <IdCard className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Front & Back ID Card (CNIC) A4 Page Maker
              <span className="urdu-nastaliq text-emerald-400 text-xs font-normal">
                شناختی کارڈ فرنٹ اور بیک پیج میکر
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Tip: Copy CNIC image from WhatsApp Web and press <strong>Ctrl + V</strong> directly!
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-300 cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Select Both Front & Back
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleBulkUploadBoth}
              className="hidden"
            />
          </label>

          {(front.rawUrl || back.rawUrl) && (
            <>
              <button
                onClick={swapFrontBack}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1"
                title="Swap Front & Back Sides"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-sky-400" /> Swap Sides
              </button>

              <button
                onClick={handleDownloadJpg}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" /> JPG
              </button>

              <button
                onClick={handleDownloadPdf}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow"
              >
                <Download className="w-4 h-4" /> Save A4 PDF
              </button>

              <button
                onClick={() => window.print()}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
              >
                <Printer className="w-4 h-4" /> Print A4 Page
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-12 gap-6 no-print">
        {/* Left Controls Panel */}
        <div className="xl:col-span-5 space-y-4">
          {/* Front & Back Card Drop / Paste Slots */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* FRONT SLOT */}
            <div
              onClick={() => setActivePasteTarget('front')}
              className={`bg-slate-900 rounded-2xl p-3.5 border-2 transition cursor-pointer ${
                activePasteTarget === 'front'
                  ? 'border-emerald-500 shadow-lg shadow-emerald-950/40'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider">
                  1. ID Front Side
                </span>
                {activePasteTarget === 'front' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                    <ClipboardPaste className="w-2.5 h-2.5" /> Ctrl+V Ready
                  </span>
                )}
              </div>

              {front.rawUrl ? (
                <div className="space-y-2">
                  <img
                    src={front.rawUrl}
                    alt="ID Front"
                    className="w-full h-28 object-contain bg-slate-950 rounded-lg border border-slate-800"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenCropModal('front');
                      }}
                      className="py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center justify-center gap-1"
                    >
                      <Crop className="w-3 h-3" /> Crop
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFront((p) => ({ ...p, rotation90: (p.rotation90 + 90) % 360 }));
                      }}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1"
                    >
                      <RotateCw className="w-3 h-3" /> 90°
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFront({ ...DEFAULT_SIDE });
                      }}
                      className="py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-[11px] flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <label className="h-32 border-2 border-dashed border-slate-700 hover:border-emerald-400 rounded-xl flex flex-col items-center justify-center text-center p-3 cursor-pointer">
                  <Upload className="w-5 h-5 text-emerald-400 mb-1" />
                  <span className="text-xs font-bold text-slate-200">Upload Front</span>
                  <span className="text-[10px] text-slate-500 mt-0.5">or click & press Ctrl+V</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFront({ ...DEFAULT_SIDE, rawUrl: await fileToDataUrl(f) });
                        setActivePasteTarget('back');
                      }
                    }}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* BACK SLOT */}
            <div
              onClick={() => setActivePasteTarget('back')}
              className={`bg-slate-900 rounded-2xl p-3.5 border-2 transition cursor-pointer ${
                activePasteTarget === 'back'
                  ? 'border-sky-500 shadow-lg shadow-sky-950/40'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-extrabold text-sky-400 uppercase tracking-wider">
                  2. ID Back Side
                </span>
                {activePasteTarget === 'back' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 flex items-center gap-1">
                    <ClipboardPaste className="w-2.5 h-2.5" /> Ctrl+V Ready
                  </span>
                )}
              </div>

              {back.rawUrl ? (
                <div className="space-y-2">
                  <img
                    src={back.rawUrl}
                    alt="ID Back"
                    className="w-full h-28 object-contain bg-slate-950 rounded-lg border border-slate-800"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenCropModal('back');
                      }}
                      className="py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-300 text-[11px] font-bold flex items-center justify-center gap-1"
                    >
                      <Crop className="w-3 h-3" /> Crop
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBack((p) => ({ ...p, rotation90: (p.rotation90 + 90) % 360 }));
                      }}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1"
                    >
                      <RotateCw className="w-3 h-3" /> 90°
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBack({ ...DEFAULT_SIDE });
                      }}
                      className="py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-[11px] flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <label className="h-32 border-2 border-dashed border-slate-700 hover:border-sky-400 rounded-xl flex flex-col items-center justify-center text-center p-3 cursor-pointer">
                  <Upload className="w-5 h-5 text-sky-400 mb-1" />
                  <span className="text-xs font-bold text-slate-200">Upload Back</span>
                  <span className="text-[10px] text-slate-500 mt-0.5">or click & press Ctrl+V</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setBack({ ...DEFAULT_SIDE, rawUrl: await fileToDataUrl(f) });
                    }}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Layout & Copies Configuration */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
            <div>
              <label className="block font-bold text-slate-200 mb-1.5">
                Page Arrangement Style
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'side_by_side', label: 'Side-by-Side [F][B]' },
                  { id: 'stacked_vertical', label: 'Top & Bottom' },
                  { id: 'duplex_2page', label: '2-Page Duplex' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setLayout(opt.id as LayoutStyle)}
                    className={`py-2 px-2 rounded-xl font-bold border transition ${
                      layout === opt.id
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-200 mb-1.5">
                Number of Copies on A4 Sheet
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {([1, 2, 3, 4, 8] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setCopies(n)}
                    className={`py-2 rounded-xl font-bold border ${
                      copies === n
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {n}x
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Card Size Scale</label>
                <select
                  value={sizePreset}
                  onChange={(e) => setSizePreset(e.target.value as SizePreset)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-white"
                >
                  <option value="exact_100">Exact NADRA 1:1 (85.6×54mm)</option>
                  <option value="medium_110">110% Enlarged (94×59mm)</option>
                  <option value="large_125">125% Large Copy (107×67mm)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Position on A4 Paper
                </label>
                <select
                  value={verticalSlot}
                  onChange={(e) => setVerticalSlot(e.target.value as VerticalSlot)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-emerald-300 font-semibold"
                >
                  <option value="top">Top of A4 (Standard)</option>
                  <option value="middle">Center of A4</option>
                  <option value="bottom_half">Bottom Half (Reuse Paper!)</option>
                  <option value="custom">Custom Top Margin (mm)</option>
                </select>
              </div>
            </div>

            {verticalSlot === 'custom' && (
              <div>
                <label className="block text-slate-400 mb-1">
                  Top Margin: <strong>{customTopMm} mm</strong>
                </label>
                <input
                  type="range"
                  min={5}
                  max={210}
                  value={customTopMm}
                  onChange={(e) => setCustomTopMm(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Photostat Enhancement & Toner Saver Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> Photostat Image Enhancer & Toner Saver
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['cnic_photostat', '✨ Face-Safe CNIC B&W'],
                  ['magic_bw', 'Sharp Text B&W'],
                  ['vivid_scan', 'Clean Color Card'],
                  ['original', 'Original Unfiltered'],
                ] as [DocFilterMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setFilterMode(m)}
                  className={`py-2 px-2.5 rounded-xl font-semibold border text-left ${
                    filterMode === m
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-slate-400 mb-1">Lighten / Darken ({brightness})</label>
                <input
                  type="range"
                  min={-35}
                  max={35}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Ink Sharpness ({contrast})</label>
                <input
                  type="range"
                  min={-25}
                  max={45}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roundedCorners}
                  onChange={(e) => setRoundedCorners(e.target.checked)}
                  className="accent-emerald-500"
                />
                Rounded ID Corners
              </label>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBorder}
                  onChange={(e) => setShowBorder(e.target.checked)}
                  className="accent-emerald-500"
                />
                Card Cut Outline
              </label>
            </div>

            <input
              type="text"
              value={crossWatermark}
              onChange={(e) => setCrossWatermark(e.target.value)}
              placeholder="Optional security stamp e.g. 'FOR BANK ACCOUNT ONLY'"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
            />
          </div>
        </div>

        {/* Right Live A4 Sheet Preview */}
        <div className="xl:col-span-7 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center">
          {page1Url ? (
            <div className="space-y-6 flex flex-col items-center">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Live A4 Print Sheet Preview (210 × 297 mm)
              </div>
              <img
                src={page1Url}
                alt="A4 ID Card Page 1"
                className="max-h-[73vh] w-auto object-contain bg-white shadow-2xl rounded-sm border border-slate-700"
              />
              {page2Url && (
                <>
                  <div className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                    Page 2 — Duplex Mirrored Back Side
                  </div>
                  <img
                    src={page2Url}
                    alt="A4 ID Card Page 2"
                    className="max-h-[73vh] w-auto object-contain bg-white shadow-2xl rounded-sm border border-slate-700"
                  />
                </>
              )}
            </div>
          ) : (
            <div className="text-center max-w-sm space-y-2">
              <IdCard className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-300">
                Upload or Paste (Ctrl+V) Front & Back ID Card Images
              </h3>
              <p className="text-xs text-slate-500">
                Supports NADRA CNIC, Smart Card, Driving License, Student Card, or Employee ID —
                cropped, cleaned & scaled to exact A4 millimeter dimensions!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Card Crop & Straighten Modal */}
      {cropEditingSide && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 no-print">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">
                  Crop & Straighten {cropEditingSide === 'front' ? 'Front' : 'Back'} ID Card
                </h3>
                <p className="text-xs text-slate-400">
                  Click and drag across the ID card below to trim away surrounding table/background!
                </p>
              </div>
              <button
                onClick={() => setCropEditingSide(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setTempRot90((r) => (r + 90) % 360)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center gap-1"
              >
                <RotateCw className="w-3.5 h-3.5" /> Rotate 90°
              </button>

              <div className="flex items-center gap-2 text-slate-300 flex-1">
                <span>Straighten Tilt ({tempTilt}°):</span>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={tempTilt}
                  onChange={(e) => setTempTilt(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
              </div>

              <button
                onClick={() => {
                  setTempCrop({ x: 0, y: 0, w: 1, h: 1 });
                  setTempTilt(0);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                Full Image
              </button>
            </div>

            <div className="flex justify-center bg-slate-950 rounded-xl p-3 overflow-hidden">
              {rotatedPreviewForCrop && (
                <div
                  ref={cropStageRef}
                  onMouseDown={handleCropMouseDown}
                  className="relative inline-block cursor-crosshair select-none"
                >
                  <img
                    src={rotatedPreviewForCrop}
                    alt="Drag to crop ID card"
                    className="max-h-[52vh] w-auto block opacity-60"
                    draggable={false}
                  />
                  {/* Highlighted Active Crop Window */}
                  <div
                    style={{
                      left: `${tempCrop.x * 100}%`,
                      top: `${tempCrop.y * 100}%`,
                      width: `${tempCrop.w * 100}%`,
                      height: `${tempCrop.h * 100}%`,
                    }}
                    className="absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCropEditingSide(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCrop}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Apply Card Crop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Clean A4 Print Area */}
      {page1Url && (
        <div id="ik-print-area" className="hidden print:block bg-white">
          <img
            src={page1Url}
            alt="Print Page 1"
            style={{ width: '210mm', height: '297mm', pageBreakAfter: page2Url ? 'always' : 'auto' }}
          />
          {page2Url && (
            <img
              src={page2Url}
              alt="Print Page 2"
              style={{ width: '210mm', height: '297mm' }}
            />
          )}
        </div>
      )}
    </div>
  );
};
