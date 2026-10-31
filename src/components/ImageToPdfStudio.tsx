import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  ImagePlus,
  Sparkles,
  RotateCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  Printer,
  Sun,
} from 'lucide-react';
import {
  DocFilterMode,
  loadImageElement,
  renderFilteredDocumentCanvas,
} from '../lib/imageFilters';

interface ScannedPageItem {
  id: string;
  name: string;
  originalUrl: string;
  processedUrl: string;
  filter: DocFilterMode;
  rotation: number;
  brightness: number;
  contrast: number;
}

interface ImageToPdfStudioProps {
  /** Images handed over from another module (e.g. the Scan & Order queue). */
  incomingFiles?: { files: File[]; nonce: number } | null;
}

export const ImageToPdfStudio: React.FC<ImageToPdfStudioProps> = ({ incomingFiles }) => {
  const [items, setItems] = useState<ScannedPageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paperSize, setPaperSize] = useState<'a4' | 'legal' | 'fit'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [marginMm, setMarginMm] = useState<number>(8);
  const [perPage, setPerPage] = useState<1 | 2 | 4>(1);
  const [busy, setBusy] = useState<boolean>(false);

  const processSingleItem = async (item: ScannedPageItem): Promise<string> => {
    const img = await loadImageElement(item.originalUrl);
    const canvas = renderFilteredDocumentCanvas(img, {
      filter: item.filter,
      rotation: item.rotation,
      brightness: item.brightness,
      contrast: item.contrast,
      maxDimension: 1850,
    });
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const addImageFiles = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setBusy(true);
    const created: ScannedPageItem[] = [];

    for (const file of fileList) {
      const url: string = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
      });
      const base: ScannedPageItem = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        originalUrl: url,
        processedUrl: url,
        filter: 'original',
        rotation: 0,
        brightness: 0,
        contrast: 0,
      };
      created.push(base);
    }

    setItems((prev) => {
      const next = [...prev, ...created];
      if (!selectedId && next[0]) setSelectedId(next[0].id);
      return next;
    });
    setBusy(false);
  };

  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const list = files ? Array.from(files) : [];
    e.target.value = '';
    await addImageFiles(list);
  };

  // Accept images handed over from the Scan & Order station
  useEffect(() => {
    if (!incomingFiles?.files?.length) return;
    void addImageFiles(incomingFiles.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles?.nonce]);

  const updateItem = async (id: string, patch: Partial<ScannedPageItem>) => {
    const target = items.find((x) => x.id === id);
    if (!target) return;
    const merged = { ...target, ...patch };
    const newUrl = await processSingleItem(merged);
    merged.processedUrl = newUrl;
    setItems((prev) => prev.map((x) => (x.id === id ? merged : x)));
  };

  const applyFilterToAll = async (filter: DocFilterMode) => {
    if (items.length === 0) return;
    setBusy(true);
    const updated: ScannedPageItem[] = [];
    for (const item of items) {
      const merged = { ...item, filter };
      merged.processedUrl = await processSingleItem(merged);
      updated.push(merged);
    }
    setItems(updated);
    setBusy(false);
  };

  const handleGeneratePdf = async () => {
    if (items.length === 0) return;
    setBusy(true);
    try {
      if (paperSize === 'fit') {
        const firstImg = await loadImageElement(items[0].processedUrl);
        const pdf = new jsPDF({
          orientation: firstImg.width > firstImg.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [firstImg.width, firstImg.height],
        });
        pdf.addImage(items[0].processedUrl, 'JPEG', 0, 0, firstImg.width, firstImg.height);
        for (let i = 1; i < items.length; i++) {
          const im = await loadImageElement(items[i].processedUrl);
          pdf.addPage([im.width, im.height], im.width > im.height ? 'landscape' : 'portrait');
          pdf.addImage(items[i].processedUrl, 'JPEG', 0, 0, im.width, im.height);
        }
        pdf.save(`IK-Images-PDF-${Date.now()}.pdf`);
      } else {
        const pdf = new jsPDF({
          orientation,
          unit: 'mm',
          format: paperSize === 'legal' ? 'legal' : 'a4',
        });

        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const cols = perPage === 4 ? 2 : 1;
        const rows = perPage === 1 ? 1 : 2;
        const cellW = (pageW - marginMm * (cols + 1)) / cols;
        const cellH = (pageH - marginMm * (rows + 1)) / rows;

        for (let idx = 0; idx < items.length; idx++) {
          const slot = idx % perPage;
          if (idx > 0 && slot === 0) {
            pdf.addPage();
          }
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const boxX = marginMm + col * (cellW + marginMm);
          const boxY = marginMm + row * (cellH + marginMm);

          const img = await loadImageElement(items[idx].processedUrl);
          const ratio = Math.min(cellW / img.width, cellH / img.height);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;
          const drawX = boxX + (cellW - drawW) / 2;
          const drawY = boxY + (cellH - drawH) / 2;

          pdf.addImage(items[idx].processedUrl, 'JPEG', drawX, drawY, drawW, drawH);
        }

        pdf.save(`IK-Scanned-Document-${Date.now()}.pdf`);
      }
    } finally {
      setBusy(false);
    }
  };

  const selected = items.find((i) => i.id === selectedId) || items[0] || null;

  useEffect(() => {
    if (items.length > 0 && !items.some((x) => x.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top Action Ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <label className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow">
            <ImagePlus className="w-4 h-4" /> + Add Photos / WhatsApp Docs
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleUploadImages}
              className="hidden"
            />
          </label>

          {items.length > 0 && (
            <>
              <button
                onClick={() => applyFilterToAll('magic_bw')}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-xs font-bold flex items-center gap-1.5"
                title="Removes gray camera shadows from WhatsApp photos so laser printers save toner!"
              >
                <Sparkles className="w-3.5 h-3.5" /> Clean All (Toner Saver B&W)
              </button>
              <button
                onClick={() => applyFilterToAll('vivid_scan')}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold"
              >
                Clean Color Scan All
              </button>
              <button
                onClick={() => applyFilterToAll('original')}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs"
              >
                Reset All
              </button>
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as 'a4' | 'legal' | 'fit')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="a4">A4 Sheet</option>
              <option value="legal">Legal Sheet</option>
              <option value="fit">Fit Exact Image Size</option>
            </select>

            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>

            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value) as 1 | 2 | 4)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-emerald-300 font-semibold"
            >
              <option value={1}>1 Image / Page</option>
              <option value={2}>2 Images / Page</option>
              <option value={4}>4 Images / Page (2×2)</option>
            </select>

            <select
              value={marginMm}
              onChange={(e) => setMarginMm(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-300"
            >
              <option value={0}>No Margin</option>
              <option value={8}>Small Margin (8mm)</option>
              <option value={16}>Normal Margin (16mm)</option>
            </select>

            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>

            <button
              onClick={handleGeneratePdf}
              disabled={busy}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 shadow-lg"
            >
              <Download className="w-4 h-4" />
              {busy ? 'Building PDF...' : `Save PDF (${items.length})`}
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <label className="max-w-lg w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer transition">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center mb-4">
              <ImagePlus className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              Image to PDF & WhatsApp Document Cleaner
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Drop dark/shadowy WhatsApp photos of bills, applications, degrees or notes — clean
              gray shadows into crisp pure-white pages to save black toner and convert to A4 PDF!
            </p>
            <span className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
              Select 1 or Multiple Images
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleUploadImages}
              className="hidden"
            />
          </label>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden no-print">
          {/* Left Image Queue */}
          <div className="w-60 bg-slate-900 border-r border-slate-800 overflow-y-auto p-3 space-y-2.5 shrink-0">
            {items.map((it, idx) => (
              <div
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className={`rounded-xl p-2 border cursor-pointer transition ${
                  selected?.id === it.id
                    ? 'border-emerald-500 bg-emerald-950/30'
                    : 'border-slate-800 bg-slate-950/60'
                }`}
              >
                <img
                  src={it.processedUrl}
                  alt={it.name}
                  className="w-full h-28 object-contain bg-white rounded mb-1.5"
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-300 truncate max-w-[90px]">
                    #{idx + 1} {it.name}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setItems((prev) => {
                          const c = [...prev];
                          [c[idx - 1], c[idx]] = [c[idx], c[idx - 1]];
                          return c;
                        });
                      }}
                      className="p-1 hover:bg-slate-800 rounded disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      disabled={idx === items.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setItems((prev) => {
                          const c = [...prev];
                          [c[idx + 1], c[idx]] = [c[idx], c[idx + 1]];
                          return c;
                        });
                      }}
                      className="p-1 hover:bg-slate-800 rounded disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setItems((prev) => prev.filter((x) => x.id !== it.id));
                      }}
                      className="p-1 hover:bg-rose-950 rounded text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Center Preview & Per-Page Document Enhancer */}
          {selected && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3 max-w-3xl w-full">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      ['original', 'Original'],
                      ['magic_bw', '✨ Magic B&W Toner Saver'],
                      ['grayscale_photostat', 'Photostat Gray'],
                      ['vivid_scan', 'Vivid Color Scan'],
                    ] as [DocFilterMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => updateItem(selected.id, { filter: mode })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        selected.filter === mode
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() =>
                    updateItem(selected.id, { rotation: (selected.rotation + 90) % 360 })
                  }
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1"
                >
                  <RotateCw className="w-3.5 h-3.5" /> Rotate 90°
                </button>

                <div className="flex items-center gap-2 text-xs text-slate-300 ml-auto">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Bright:</span>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={selected.brightness}
                    onChange={(e) =>
                      updateItem(selected.id, { brightness: Number(e.target.value) })
                    }
                    className="w-20 accent-emerald-500"
                  />
                  <span>Contrast:</span>
                  <input
                    type="range"
                    min={-30}
                    max={50}
                    value={selected.contrast}
                    onChange={(e) => updateItem(selected.id, { contrast: Number(e.target.value) })}
                    className="w-20 accent-emerald-500"
                  />
                </div>
              </div>

              <div className="bg-white p-3 rounded shadow-2xl max-w-2xl">
                <img
                  src={selected.processedUrl}
                  alt={selected.name}
                  className="max-h-[68vh] w-auto object-contain"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden Print Sheet for Direct Ctrl+P Printing */}
      {items.length > 0 && (
        <div id="ik-print-area" className="hidden print:block bg-white">
          {items.map((it) => (
            <div
              key={it.id}
              style={{ pageBreakAfter: 'always' }}
              className="w-full flex items-center justify-center p-4"
            >
              <img src={it.processedUrl} alt={it.name} className="max-w-full max-h-[275mm]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
