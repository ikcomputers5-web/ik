import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import {
  FileUp,
  Type,
  Eraser,
  ImagePlus,
  RotateCw,
  Trash2,
  Download,
  Layers,
  Scissors,
  Move,
  ArrowUp,
  ArrowDown,
  Hash,
  Plus,
} from 'lucide-react';
import { PHONETIC_KEY_MAP } from '../lib/urduEngine';

// Configure local Vite-bundled PDF.js worker (works 100% offline!)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type PdfTab = 'editor' | 'merge' | 'split';
type EditorTool = 'move' | 'whiteout' | 'text_urdu' | 'text_en';

interface OverlayItem {
  id: string;
  pageIndex: number;
  kind: 'whiteout' | 'text_urdu' | 'text_en' | 'image';
  x: number; // normalized 0..1 relative to rendered page width
  y: number; // normalized 0..1 relative to rendered page height
  w: number; // normalized width (for whiteout/image)
  h: number; // normalized height (for whiteout/image)
  text?: string;
  fontSize?: number;
  color?: string;
  imageDataUrl?: string;
}

interface PageMeta {
  originalIndex: number; // 0-based index in original PDF
  rotation: number; // extra degrees 0, 90, 180, 270
  thumbUrl: string;
  width: number;
  height: number;
}

export const PdfStudio: React.FC = () => {
  const [activeTab, setActiveTab] = useState<PdfTab>('editor');

  // --- Visual PDF Editor State ---
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
  const [activePagePreview, setActivePagePreview] = useState<string>('');
  const [tool, setTool] = useState<EditorTool>('move');
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [textColor, setTextColor] = useState<string>('#000000');
  const [fontSize, setFontSize] = useState<number>(20);
  const [addPageNumbers, setAddPageNumbers] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  // Dragging state for overlays
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const imgOverlayInputRef = useRef<HTMLInputElement | null>(null);

  // --- Merge PDFs State ---
  const [mergeFiles, setMergeFiles] = useState<
    { id: string; name: string; bytes: Uint8Array; pageCount: number }[]
  >([]);

  // --- Split PDF State ---
  const [splitPdf, setSplitPdf] = useState<{
    name: string;
    bytes: Uint8Array;
    pageCount: number;
  } | null>(null);
  const [splitRange, setSplitRange] = useState<string>('1');

  // Load PDF into Visual Editor
  const handleLoadEditorPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const raw = new Uint8Array(buf);
      // Keep an independent copy because pdf.js transfers ArrayBuffers to worker!
      const bytesForExport = raw.slice();
      setPdfBytes(bytesForExport);
      setPdfName(file.name.replace(/\.pdf$/i, ''));
      setOverlays([]);
      setSelectedOverlayId(null);
      setSelectedPageIdx(0);

      const loadingTask = pdfjsLib.getDocument({ data: raw.slice() });
      const doc = await loadingTask.promise;
      const metas: PageMeta[] = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 0.35 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const baseVp = page.getViewport({ scale: 1 });
        metas.push({
          originalIndex: i - 1,
          rotation: 0,
          thumbUrl: canvas.toDataURL('image/jpeg', 0.8),
          width: baseVp.width,
          height: baseVp.height,
        });
      }
      setPages(metas);
    } catch (err) {
      alert('Failed to open PDF file. Please verify it is a valid PDF.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  // Render full high-DPI preview whenever selected page or rotation changes
  useEffect(() => {
    if (!pdfBytes || pages.length === 0 || !pages[selectedPageIdx]) {
      setActivePagePreview('');
      return;
    }
    let cancelled = false;
    const renderActive = async () => {
      const targetMeta = pages[selectedPageIdx];
      const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      const page = await doc.getPage(targetMeta.originalIndex + 1);
      const vp = page.getViewport({
        scale: 1.5,
        rotation: (page.rotate + targetMeta.rotation) % 360,
      });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!cancelled) {
        setActivePagePreview(canvas.toDataURL('image/png'));
      }
    };
    renderActive();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, pages, selectedPageIdx]);

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stageRef.current || tool === 'move') return;
    if (e.target !== stageRef.current && !(e.target as HTMLElement).dataset.stageBg) return;

    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.max(0.02, Math.min(0.88, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.02, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    const id = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (tool === 'whiteout') {
      const item: OverlayItem = {
        id,
        pageIndex: selectedPageIdx,
        kind: 'whiteout',
        x,
        y,
        w: 0.22,
        h: 0.045,
      };
      setOverlays((prev) => [...prev, item]);
      setSelectedOverlayId(id);
      setTool('move');
    } else if (tool === 'text_urdu' || tool === 'text_en') {
      const item: OverlayItem = {
        id,
        pageIndex: selectedPageIdx,
        kind: tool,
        x,
        y,
        w: 0.3,
        h: 0.06,
        text: tool === 'text_urdu' ? 'یہاں اردو لکھیں' : 'Type text here',
        fontSize,
        color: textColor,
      };
      setOverlays((prev) => [...prev, item]);
      setSelectedOverlayId(id);
      setTool('move');
    }
  };

  const handleAddImageOverlay = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      const id = `ov-${Date.now()}`;
      setOverlays((prev) => [
        ...prev,
        {
          id,
          pageIndex: selectedPageIdx,
          kind: 'image',
          x: 0.35,
          y: 0.35,
          w: 0.22,
          h: 0.16,
          imageDataUrl: String(reader.result),
        },
      ]);
      setSelectedOverlayId(id);
      setTool('move');
    };
    reader.readAsDataURL(file);
  };

  // Pointer drag move for overlays
  const startDragOverlay = (e: React.MouseEvent, item: OverlayItem) => {
    e.stopPropagation();
    setSelectedOverlayId(item.id);
    if (!stageRef.current) return;
    dragStateRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: item.x,
      origY: item.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragStateRef.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const dx = (ev.clientX - dragStateRef.current.startX) / rect.width;
      const dy = (ev.clientY - dragStateRef.current.startY) / rect.height;
      const nx = Math.max(0, Math.min(0.95, dragStateRef.current.origX + dx));
      const ny = Math.max(0, Math.min(0.95, dragStateRef.current.origY + dy));
      setOverlays((prev) =>
        prev.map((o) => (o.id === dragStateRef.current?.id ? { ...o, x: nx, y: ny } : o))
      );
    };

    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Render Urdu or English text item into high-DPI transparent PNG so Nastaliq ligatures stay 100% authentic in PDF!
  const renderTextOverlayToPng = (item: OverlayItem): { dataUrl: string; pxW: number; pxH: number } => {
    const scale = 3;
    const fSize = (item.fontSize || 20) * scale;
    const isUrdu = item.kind === 'text_urdu';
    const fontSpec = isUrdu
      ? `${fSize}px "Noto Nastaliq Urdu", "Noto Naskh Arabic", serif`
      : `${fSize}px Inter, Arial, sans-serif`;

    const measureCanvas = document.createElement('canvas');
    const mCtx = measureCanvas.getContext('2d')!;
    mCtx.font = fontSpec;
    const lines = (item.text || '').split('\n');
    let maxW = 60;
    for (const ln of lines) {
      const w = mCtx.measureText(ln).width;
      if (w > maxW) maxW = w;
    }

    const lineH = isUrdu ? fSize * 2.2 : fSize * 1.35;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(maxW + fSize * 0.8);
    canvas.height = Math.ceil(lines.length * lineH + fSize * 0.6);

    const ctx = canvas.getContext('2d')!;
    ctx.font = fontSpec;
    ctx.fillStyle = item.color || '#000000';
    ctx.textBaseline = 'top';
    if (isUrdu) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
    } else {
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
    }

    lines.forEach((ln, i) => {
      const xPos = isUrdu ? canvas.width - fSize * 0.3 : fSize * 0.2;
      ctx.fillText(ln, xPos, i * lineH + (isUrdu ? fSize * 0.25 : fSize * 0.1));
    });

    return {
      dataUrl: canvas.toDataURL('image/png'),
      pxW: canvas.width / scale,
      pxH: canvas.height / scale,
    };
  };

  // Export Final Edited PDF via pdf-lib
  const handleExportEditedPdf = async () => {
    if (!pdfBytes || pages.length === 0) return;
    setBusy(true);
    try {
      const srcDoc = await PDFDocument.load(pdfBytes);
      const outDoc = await PDFDocument.create();
      const font = await outDoc.embedFont(StandardFonts.Helvetica);

      for (let outIdx = 0; outIdx < pages.length; outIdx++) {
        const meta = pages[outIdx];
        const [copiedPage] = await outDoc.copyPages(srcDoc, [meta.originalIndex]);
        if (meta.rotation !== 0) {
          const currentRot = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees((currentRot + meta.rotation) % 360));
        }
        outDoc.addPage(copiedPage);

        const { width: pw, height: ph } = copiedPage.getSize();
        const pageOverlays = overlays.filter((o) => o.pageIndex === outIdx);

        for (const ov of pageOverlays) {
          if (ov.kind === 'whiteout') {
            const rw = ov.w * pw;
            const rh = ov.h * ph;
            const rx = ov.x * pw;
            const ry = ph - ov.y * ph - rh;
            copiedPage.drawRectangle({
              x: rx,
              y: ry,
              width: rw,
              height: rh,
              color: rgb(1, 1, 1),
            });
          } else if (ov.kind === 'image' && ov.imageDataUrl) {
            const rw = ov.w * pw;
            const rh = ov.h * ph;
            const rx = ov.x * pw;
            const ry = ph - ov.y * ph - rh;
            const isPng = ov.imageDataUrl.startsWith('data:image/png');
            const embedded = isPng
              ? await outDoc.embedPng(ov.imageDataUrl)
              : await outDoc.embedJpg(ov.imageDataUrl);
            copiedPage.drawImage(embedded, { x: rx, y: ry, width: rw, height: rh });
          } else if ((ov.kind === 'text_urdu' || ov.kind === 'text_en') && ov.text) {
            const rendered = renderTextOverlayToPng(ov);
            const png = await outDoc.embedPng(rendered.dataUrl);
            const rx = ov.x * pw;
            const ry = ph - ov.y * ph - rendered.pxH * 0.78;
            copiedPage.drawImage(png, {
              x: rx,
              y: ry,
              width: rendered.pxW * 0.78,
              height: rendered.pxH * 0.78,
            });
          }
        }

        if (addPageNumbers) {
          copiedPage.drawText(`Page ${outIdx + 1} of ${pages.length}`, {
            x: pw / 2 - 28,
            y: 16,
            size: 9,
            font,
            color: rgb(0.25, 0.25, 0.25),
          });
        }
      }

      const finalBytes = await outDoc.save();
      const blob = new Blob([finalBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pdfName || 'IK-Edited'}-Edited.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Error exporting edited PDF.');
    } finally {
      setBusy(false);
    }
  };

  // --- Merge Multiple PDFs ---
  const handleAddMergeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    const items: { id: string; name: string; bytes: Uint8Array; pageCount: number }[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes);
        items.push({
          id: `${Date.now()}-${Math.random()}`,
          name: file.name,
          bytes,
          pageCount: doc.getPageCount(),
        });
      } catch {
        // skip invalid
      }
    }
    setMergeFiles((prev) => [...prev, ...items]);
    e.target.value = '';
    setBusy(false);
  };

  const handleDownloadMerged = async () => {
    if (mergeFiles.length === 0) return;
    setBusy(true);
    try {
      const merged = await PDFDocument.create();
      for (const item of mergeFiles) {
        const src = await PDFDocument.load(item.bytes);
        const copied = await merged.copyPages(src, src.getPageIndices());
        copied.forEach((p) => merged.addPage(p));
      }
      const out = await merged.save();
      const url = URL.createObjectURL(new Blob([out as unknown as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `IK-Merged-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  // --- Split / Extract Pages ---
  const handleLoadSplitFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    setSplitPdf({
      name: file.name.replace(/\.pdf$/i, ''),
      bytes,
      pageCount: doc.getPageCount(),
    });
    setSplitRange(`1-${doc.getPageCount()}`);
  };

  const handleExtractSplit = async () => {
    if (!splitPdf) return;
    const indices: number[] = [];
    const parts = splitRange.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [a, b] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(a) && !isNaN(b)) {
          for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
            if (p >= 1 && p <= splitPdf.pageCount) indices.push(p - 1);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!isNaN(p) && p >= 1 && p <= splitPdf.pageCount) indices.push(p - 1);
      }
    }
    if (indices.length === 0) {
      alert('Enter valid page numbers e.g. 1-3, 5');
      return;
    }
    setBusy(true);
    try {
      const src = await PDFDocument.load(splitPdf.bytes);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      const saved = await out.save();
      const url = URL.createObjectURL(new Blob([saved as unknown as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${splitPdf.name}-Extracted.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) || null;

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Sub-navigation bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Type className="w-3.5 h-3.5" /> Visual PDF Editor (Urdu/Text/Whiteout)
          </button>
          <button
            onClick={() => setActiveTab('merge')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'merge' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Merge PDFs
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'split' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" /> Split / Extract Pages
          </button>
        </div>

        {activeTab === 'editor' && pages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTool('move')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 ${
                tool === 'move'
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              <Move className="w-3.5 h-3.5" /> Move / Edit
            </button>
            <button
              onClick={() => setTool('whiteout')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 ${
                tool === 'whiteout'
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
              title="Click on PDF to place a Whiteout Eraser Box over old text"
            >
              <Eraser className="w-3.5 h-3.5" /> Whiteout Erase
            </button>
            <button
              onClick={() => setTool('text_urdu')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 ${
                tool === 'text_urdu'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              + اردو ٹیکسٹ
            </button>
            <button
              onClick={() => setTool('text_en')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 ${
                tool === 'text_en'
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <Type className="w-3.5 h-3.5" /> + English Text
            </button>

            <input
              ref={imgOverlayInputRef}
              type="file"
              accept="image/*"
              onChange={handleAddImageOverlay}
              className="hidden"
            />
            <button
              onClick={() => imgOverlayInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
            >
              <ImagePlus className="w-3.5 h-3.5 text-sky-400" /> + Sign / Photo
            </button>

            <label className="flex items-center gap-1 text-xs text-slate-300 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={addPageNumbers}
                onChange={(e) => setAddPageNumbers(e.target.checked)}
                className="accent-emerald-500"
              />
              <Hash className="w-3 h-3" /> Page #
            </label>

            <button
              onClick={handleExportEditedPdf}
              disabled={busy}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow"
            >
              <Download className="w-4 h-4" />
              {busy ? 'Saving...' : 'Download Edited PDF'}
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: VISUAL PDF EDITOR */}
      {activeTab === 'editor' && (
        <div className="flex-1 flex overflow-hidden">
          {pages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <label className="max-w-md w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer transition">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
                  <FileUp className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Open Any PDF to Edit</h3>
                <p className="text-xs text-slate-400 mb-4">
                  Erase/Whiteout old text, add Urdu Nastaliq or English text anywhere, stamp
                  signatures or passport photos, rotate or delete pages.
                </p>
                <span className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                  {busy ? 'Opening PDF...' : 'Choose PDF File'}
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleLoadEditorPdf}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <>
              {/* Left Page Thumbnails Sidebar */}
              <div className="w-48 bg-slate-900 border-r border-slate-800 overflow-y-auto p-3 space-y-3 shrink-0">
                <label className="block w-full text-center py-2 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-300 cursor-pointer border border-slate-700">
                  + Open Another PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleLoadEditorPdf}
                    className="hidden"
                  />
                </label>

                {pages.map((p, idx) => (
                  <div
                    key={`${p.originalIndex}-${idx}`}
                    onClick={() => setSelectedPageIdx(idx)}
                    className={`rounded-xl p-2 border cursor-pointer transition ${
                      selectedPageIdx === idx
                        ? 'border-emerald-500 bg-emerald-950/30'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <img
                      src={p.thumbUrl}
                      alt={`Page ${idx + 1}`}
                      style={{ transform: `rotate(${p.rotation}deg)` }}
                      className="w-full rounded bg-white mb-1.5 transition-transform"
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span className="font-bold">Page {idx + 1}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPages((prev) =>
                              prev.map((m, i) =>
                                i === idx ? { ...m, rotation: (m.rotation + 90) % 360 } : m
                              )
                            );
                          }}
                          className="p-1 hover:bg-slate-800 rounded text-slate-300"
                          title="Rotate 90°"
                        >
                          <RotateCw className="w-3 h-3" />
                        </button>
                        {pages.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPages((prev) => prev.filter((_, i) => i !== idx));
                              setSelectedPageIdx((cur) => Math.max(0, cur - 1));
                            }}
                            className="p-1 hover:bg-rose-950 rounded text-rose-400"
                            title="Delete Page"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Center Interactive PDF Canvas */}
              <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
                {tool !== 'move' && (
                  <div className="mb-3 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-200 text-xs font-semibold">
                    Click anywhere on the PDF page below to place your{' '}
                    {tool === 'whiteout'
                      ? 'Whiteout Eraser Box'
                      : tool === 'text_urdu'
                      ? 'Urdu Text'
                      : 'English Text'}
                  </div>
                )}

                {/* Selected Overlay Inspector */}
                {selectedOverlay && (
                  <div className="mb-4 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center gap-3 shadow-xl max-w-2xl w-full">
                    {(selectedOverlay.kind === 'text_urdu' ||
                      selectedOverlay.kind === 'text_en') && (
                      <>
                        <input
                          type="text"
                          dir={selectedOverlay.kind === 'text_urdu' ? 'rtl' : 'ltr'}
                          value={selectedOverlay.text || ''}
                          onKeyDown={(e) => {
                            if (
                              selectedOverlay.kind === 'text_urdu' &&
                              !e.ctrlKey &&
                              !e.altKey &&
                              !e.metaKey &&
                              e.key.length === 1 &&
                              PHONETIC_KEY_MAP[e.key]
                            ) {
                              e.preventDefault();
                              const target = e.currentTarget;
                              const start = target.selectionStart || 0;
                              const end = target.selectionEnd || 0;
                              const cur = selectedOverlay.text || '';
                              const nextText =
                                cur.slice(0, start) + PHONETIC_KEY_MAP[e.key] + cur.slice(end);
                              setOverlays((prev) =>
                                prev.map((o) =>
                                  o.id === selectedOverlay.id ? { ...o, text: nextText } : o
                                )
                              );
                            }
                          }}
                          onChange={(e) =>
                            setOverlays((prev) =>
                              prev.map((o) =>
                                o.id === selectedOverlay.id ? { ...o, text: e.target.value } : o
                              )
                            )
                          }
                          className={`flex-1 bg-slate-950 border border-emerald-500 rounded-lg px-3 py-1.5 text-sm text-white ${
                            selectedOverlay.kind === 'text_urdu' ? 'urdu-nastaliq' : ''
                          }`}
                        />
                        <input
                          type="number"
                          min={8}
                          max={72}
                          value={selectedOverlay.fontSize || 20}
                          onChange={(e) => {
                            const s = Number(e.target.value) || 18;
                            setFontSize(s);
                            setOverlays((prev) =>
                              prev.map((o) =>
                                o.id === selectedOverlay.id ? { ...o, fontSize: s } : o
                              )
                            );
                          }}
                          className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                          title="Font Size"
                        />
                        <input
                          type="color"
                          value={selectedOverlay.color || '#000000'}
                          onChange={(e) => {
                            const c = e.target.value;
                            setTextColor(c);
                            setOverlays((prev) =>
                              prev.map((o) => (o.id === selectedOverlay.id ? { ...o, color: c } : o))
                            );
                          }}
                          className="w-8 h-8 rounded cursor-pointer bg-transparent"
                        />
                      </>
                    )}

                    {(selectedOverlay.kind === 'whiteout' || selectedOverlay.kind === 'image') && (
                      <div className="flex items-center gap-3 text-xs text-slate-300 flex-1">
                        <span>Width:</span>
                        <input
                          type="range"
                          min={0.03}
                          max={0.9}
                          step={0.01}
                          value={selectedOverlay.w}
                          onChange={(e) =>
                            setOverlays((prev) =>
                              prev.map((o) =>
                                o.id === selectedOverlay.id
                                  ? { ...o, w: Number(e.target.value) }
                                  : o
                              )
                            )
                          }
                          className="w-28 accent-emerald-500"
                        />
                        <span>Height:</span>
                        <input
                          type="range"
                          min={0.015}
                          max={0.6}
                          step={0.005}
                          value={selectedOverlay.h}
                          onChange={(e) =>
                            setOverlays((prev) =>
                              prev.map((o) =>
                                o.id === selectedOverlay.id
                                  ? { ...o, h: Number(e.target.value) }
                                  : o
                              )
                            )
                          }
                          className="w-28 accent-emerald-500"
                        />
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setOverlays((prev) => prev.filter((o) => o.id !== selectedOverlay.id));
                        setSelectedOverlayId(null);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-xs font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                )}

                {activePagePreview && (
                  <div
                    ref={stageRef}
                    onClick={handleStageClick}
                    className={`relative shadow-2xl bg-white select-none ${
                      tool !== 'move' ? 'cursor-crosshair' : ''
                    }`}
                  >
                    <img
                      src={activePagePreview}
                      data-stage-bg="true"
                      alt="Active PDF Page"
                      className="max-w-[780px] w-full h-auto block pointer-events-auto"
                      draggable={false}
                    />

                    {/* Placed Overlays */}
                    {overlays
                      .filter((o) => o.pageIndex === selectedPageIdx)
                      .map((ov) => {
                        const isSelected = ov.id === selectedOverlayId;
                        if (ov.kind === 'whiteout') {
                          return (
                            <div
                              key={ov.id}
                              onMouseDown={(e) => startDragOverlay(e, ov)}
                              style={{
                                left: `${ov.x * 100}%`,
                                top: `${ov.y * 100}%`,
                                width: `${ov.w * 100}%`,
                                height: `${ov.h * 100}%`,
                              }}
                              className={`absolute bg-white cursor-move ${
                                isSelected
                                  ? 'ring-2 ring-amber-500'
                                  : 'border border-dashed border-slate-300'
                              }`}
                              title="Whiteout Mask (Drag to move)"
                            />
                          );
                        }
                        if (ov.kind === 'image' && ov.imageDataUrl) {
                          return (
                            <img
                              key={ov.id}
                              src={ov.imageDataUrl}
                              alt="Overlay"
                              onMouseDown={(e) => startDragOverlay(e, ov)}
                              style={{
                                left: `${ov.x * 100}%`,
                                top: `${ov.y * 100}%`,
                                width: `${ov.w * 100}%`,
                                height: `${ov.h * 100}%`,
                              }}
                              className={`absolute object-contain cursor-move ${
                                isSelected ? 'ring-2 ring-emerald-500' : ''
                              }`}
                              draggable={false}
                            />
                          );
                        }
                        return (
                          <div
                            key={ov.id}
                            dir={ov.kind === 'text_urdu' ? 'rtl' : 'ltr'}
                            onMouseDown={(e) => startDragOverlay(e, ov)}
                            style={{
                              left: `${ov.x * 100}%`,
                              top: `${ov.y * 100}%`,
                              fontSize: `${ov.fontSize || 20}px`,
                              color: ov.color || '#000000',
                            }}
                            className={`absolute cursor-move px-1 whitespace-pre leading-relaxed ${
                              ov.kind === 'text_urdu' ? 'urdu-nastaliq' : 'font-sans'
                            } ${
                              isSelected
                                ? 'ring-2 ring-emerald-500 bg-emerald-500/10 rounded'
                                : 'hover:ring-1 hover:ring-sky-400'
                            }`}
                          >
                            {ov.text}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: MERGE PDFs */}
      {activeTab === 'merge' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Merge Multiple PDF Files</h3>
                <p className="text-xs text-slate-400">
                  Combine customer CNIC, degrees, forms & challans into a single clean PDF
                </p>
              </div>
              <label className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add PDF Files
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleAddMergeFiles}
                  className="hidden"
                />
              </label>
            </div>

            {mergeFiles.length === 0 ? (
              <div className="border-2 border-dashed border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
                No PDF files added yet. Click &ldquo;Add PDF Files&rdquo; to combine 2 or more PDFs.
              </div>
            ) : (
              <div className="space-y-2 mb-5">
                {mergeFiles.map((f, idx) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{f.name}</div>
                      <div className="text-xs text-emerald-400">{f.pageCount} pages</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={idx === 0}
                        onClick={() =>
                          setMergeFiles((prev) => {
                            const copy = [...prev];
                            [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                            return copy;
                          })
                        }
                        className="p-1.5 rounded bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        disabled={idx === mergeFiles.length - 1}
                        onClick={() =>
                          setMergeFiles((prev) => {
                            const copy = [...prev];
                            [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                            return copy;
                          })
                        }
                        className="p-1.5 rounded bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setMergeFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        className="p-1.5 rounded bg-rose-950 text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mergeFiles.length >= 2 && (
              <button
                onClick={handleDownloadMerged}
                disabled={busy}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg"
              >
                <Download className="w-4 h-4" />
                Merge {mergeFiles.length} PDFs & Download
              </button>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SPLIT / EXTRACT PAGES */}
      {activeTab === 'split' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white">Split / Extract Specific PDF Pages</h3>
              <p className="text-xs text-slate-400">
                Extract only the pages the customer wants printed or saved (e.g. challan page 1 or
                pages 2-5)
              </p>
            </div>

            <label className="block border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-6 text-center cursor-pointer">
              <span className="text-xs font-bold text-emerald-400">
                {splitPdf
                  ? `${splitPdf.name}.pdf (${splitPdf.pageCount} total pages)`
                  : 'Click to Select PDF File'}
              </span>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleLoadSplitFile}
                className="hidden"
              />
            </label>

            {splitPdf && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Pages to Extract (e.g. <span className="font-mono text-emerald-400">1-3, 5, 8</span>)
                  </label>
                  <input
                    type="text"
                    value={splitRange}
                    onChange={(e) => setSplitRange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                  />
                </div>
                <button
                  onClick={handleExtractSplit}
                  disabled={busy}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Scissors className="w-4 h-4" />
                  Extract & Download Selected Pages
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
