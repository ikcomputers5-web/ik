import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IdCard,
  Camera,
  Printer,
  Download,
  RotateCw,
  Sparkles,
  Plus,
  Trash2,
  Users,
  Ruler,
  Layers,
  FileImage,
  UserRound,
  AlertTriangle,
  Copy as CopyIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { renderFilteredDocumentCanvas } from '../lib/imageFilters';
import { loadImageElement, alphaBoundingBox } from '../lib/bgRemoval';
import {
  DEFAULT_SHEET,
  PAPER_PRESETS,
  PHOTO_SIZE_PRESETS,
  buildCopyQueue,
  buildSheet,
  buildSinglePhoto,
  computeLayout,
  downloadCanvasJpg,
  downloadCanvasPng,
  downloadMultiPagePdf,
  maxCopies,
  type GuideStyle,
  type SheetSettings,
  type SheetTileSource,
} from '../lib/photoSheet';

interface IdAndPassportStudioProps {
  incomingPassportPhoto?: string | null;
}

type StudioTab = 'passport' | 'cnic';

const BG_SWATCHES = ['#0057b7', '#ffffff', '#2563eb', '#e2e8f0', '#38bdf8', '#dc2626', 'transparent'];

interface PhotoRow extends SheetTileSource {
  name: string;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });

let rowSeq = 0;
const newRowId = () => `photo-${Date.now()}-${rowSeq++}`;

export const IdAndPassportStudio: React.FC<IdAndPassportStudioProps> = ({
  incomingPassportPhoto,
}) => {
  const [tab, setTab] = useState<StudioTab>('passport');

  // ------------------------------- Passport -------------------------------
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [rowId, setRowId] = useState<string | null>(null);
  const [sizePreset, setSizePreset] = useState('pk_passport');
  const [paperPreset, setPaperPreset] = useState('4x6');
  const [settings, setSettings] = useState<SheetSettings>(() => {
    try {
      const raw = localStorage.getItem('ik_photo_sheet_settings');
      if (raw) return { ...DEFAULT_SHEET, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return DEFAULT_SHEET;
  });
  const [pages, setPages] = useState<{ url: string; canvas: HTMLCanvasElement }[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [building, setBuilding] = useState(false);
  const [footer, setFooter] = useState('IK Computers');
  const [faceBoxes, setFaceBoxes] = useState<Record<string, { x: number; y: number; w: number; h: number } | null>>({});
  const [sheetError, setSheetError] = useState('');
  const [singleBusy, setSingleBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // -------------------------------- CNIC ----------------------------------
  const [cnicFrontRaw, setCnicFrontRaw] = useState('');
  const [cnicBackRaw, setCnicBackRaw] = useState('');
  const [frontRot, setFrontRot] = useState(0);
  const [backRot, setBackRot] = useState(0);
  const [cnicCleanBw, setCnicCleanBw] = useState(true);
  const [cnicCopies, setCnicCopies] = useState<1 | 2 | 4>(2);
  const [cnicSheetPreview, setCnicSheetPreview] = useState('');

  useEffect(() => {
    if (!incomingPassportPhoto) return;
    setTab('passport');
    setPhotos((prev) => {
      if (prev.some((p) => p.src === incomingPassportPhoto)) return prev;
      const row: PhotoRow = {
        id: newRowId(),
        name: `Photo ${prev.length + 1}`,
        src: incomingPassportPhoto,
        bg: '#0057b7',
        copies: 1,
        zoom: 1,
        offsetY: 0,
      };
      return [...prev, row];
    });
  }, [incomingPassportPhoto, settings]);

  useEffect(() => {
    try {
      localStorage.setItem('ik_photo_sheet_settings', JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const preset = PHOTO_SIZE_PRESETS.find((p) => p.id === sizePreset) || PHOTO_SIZE_PRESETS[0];
  const paper = PAPER_PRESETS.find((p) => p.id === paperPreset) || PAPER_PRESETS[0];

  const activeSettings = useMemo<SheetSettings>(
    () => ({
      ...settings,
      photoWmm: preset.id === 'custom' ? settings.photoWmm : preset.wMm,
      photoHmm: preset.id === 'custom' ? settings.photoHmm : preset.hMm,
      paperWmm: paper.id === 'custom_paper' ? settings.paperWmm : paper.wMm,
      paperHmm: paper.id === 'custom_paper' ? settings.paperHmm : paper.hMm,
    }),
    [settings, preset, paper]
  );

  const layout = useMemo(() => computeLayout(activeSettings), [activeSettings]);
  const capacity = useMemo(() => maxCopies(activeSettings), [activeSettings]);
  const wanted = Math.max(1, activeSettings.totalCopies);
  const pageCount = Math.max(1, Math.ceil(wanted / Math.max(1, capacity)));

  // The "how many photos" field is the single source of truth. Each photo's own
  // `copies` value is only a *weight* telling us how the quantity is shared
  // between several people on one sheet.
  const pageSources = useMemo(() => {
    const list = photos.filter((p) => p.src);
    if (list.length === 0) return [] as SheetTileSource[][];
    const shares = buildCopyQueue(
      list.map((p) => ({ id: p.id, copies: Math.max(1, p.copies || 1) })),
      wanted
    );
    const perPage = Math.max(1, capacity);
    const pageLists: SheetTileSource[][] = [];
    for (let page = 0; page < pageCount; page++) {
      const from = page * perPage;
      const to = Math.min(wanted, from + perPage);
      const row: SheetTileSource[] = [];
      let cursor = 0;
      for (const share of shares) {
        const shareStart = cursor;
        const shareEnd = cursor + share.count;
        cursor = shareEnd;
        const overlap = Math.min(to, shareEnd) - Math.max(from, shareStart);
        if (overlap > 0) {
          const src = list.find((p) => p.id === share.id);
          if (src) row.push({ ...src, copies: overlap });
        }
      }
      pageLists.push(row);
    }
    return pageLists;
  }, [photos, pageCount, capacity, wanted]);

  // Build preview pages
  useEffect(() => {
    if (photos.length === 0) {
      setPages([]);
      setSheetError('');
      return;
    }
    let cancelled = false;
    setBuilding(true);
    setSheetError('');
    const timer = setTimeout(async () => {
      try {
        const built: { url: string; canvas: HTMLCanvasElement }[] = [];
        for (let i = 0; i < pageSources.length; i++) {
          const sources = pageSources[i];
          if (sources.length === 0) continue;
          const result = await buildSheet({
            settings: activeSettings,
            sources,
            faceBoxes,
            footer: i === 0 ? footer : undefined,
          });
          if (result) built.push({ url: result.previewUrl, canvas: result.canvas });
        }
        if (cancelled) return;
        setPages(built);
        setPageIndex((idx) => Math.min(idx, Math.max(0, built.length - 1)));
        if (built.length === 0) {
          setSheetError(
            'These photos cannot fit on the chosen paper. Use a larger paper, a smaller photo size, or fewer copies.'
          );
        }
      } catch (err: any) {
        if (!cancelled) setSheetError(String(err?.message || 'Could not build the sheet.'));
      } finally {
        if (!cancelled) setBuilding(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [photos, activeSettings, pageSources, faceBoxes, footer]);

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const rows: PhotoRow[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const src = await readAsDataUrl(file);
      rows.push({
        id: newRowId(),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 18) || `Photo ${photos.length + rows.length + 1}`,
        src,
        bg: '#0057b7',
        copies: 1,
        zoom: 1,
        offsetY: 0,
      });
    }
    if (rows.length === 0) return;
    setPhotos((prev) => [...prev, ...rows]);
    // Compute face boxes (alpha bounding box heuristic) for each new photo.
    const boxes: Record<string, any> = {};
    for (const row of rows) {
      try {
        const img = await loadImageElement(row.src);
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        const bbox = alphaBoundingBox(c);
        boxes[row.id] = bbox;
      } catch {
        boxes[row.id] = null;
      }
    }
    setFaceBoxes((prev) => ({ ...prev, ...boxes }));
    setRowId((cur) => cur ?? rows[0].id);
  };

  const updatePhoto = (id: string, patch: Partial<PhotoRow>) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setRowId((cur) => (cur === id ? null : cur));
  };
  const duplicatePhoto = (id: string) =>
    setPhotos((prev) => {
      const src = prev.find((p) => p.id === id);
      if (!src) return prev;
      return [
        ...prev,
        { ...src, id: newRowId(), name: `${src.name} copy` },
      ];
    });

  const selected = photos.find((p) => p.id === rowId) || photos[0] || null;

  const ready = pages.length > 0;

  const handlePrint = () => {
    if (!ready) return;
    // The print CSS shows #ik-print-area, which renders every page in order.
    window.print();
  };

  const handleDownloadPdf = () => {
    if (pages.length === 0) return;
    downloadMultiPagePdf(
      pages.map((p) => p.canvas),
      activeSettings,
      `IK-PhotoSheet-${preset.id}-${wanted}pcs-${Date.now()}.pdf`
    );
  };

  const handleDownloadSingle = async () => {
    if (!selected) return;
    setSingleBusy(true);
    try {
      const canvas = await buildSinglePhoto(
        selected.src,
        selected.bg,
        activeSettings.photoWmm,
        activeSettings.photoHmm,
        300,
        faceBoxes[selected.id] || null,
        selected.zoom,
        selected.offsetY
      );
      if (canvas) {
        downloadCanvasPng(
          canvas,
          `IK-Single-${Math.round(activeSettings.photoWmm)}x${Math.round(activeSettings.photoHmm)}mm-300dpi.png`
        );
      }
    } finally {
      setSingleBusy(false);
    }
  };

  // ------------------------------ CNIC sheet ------------------------------
  useEffect(() => {
    if (!cnicFrontRaw && !cnicBackRaw) {
      setCnicSheetPreview('');
      return;
    }
    let cancelled = false;
    const buildCnicSheet = async () => {
      const pxPerMm = 8;
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

      if (!cancelled) setCnicSheetPreview(canvas.toDataURL('image/jpeg', 0.94));
    };
    void buildCnicSheet();
    return () => {
      cancelled = true;
    };
  }, [cnicFrontRaw, cnicBackRaw, frontRot, backRot, cnicCleanBw, cnicCopies]);

  const downloadCnicPdf = () => {
    if (!cnicSheetPreview) return;
    const a = document.createElement('a');
    a.href = cnicSheetPreview;
    a.download = `IK-CNIC-A4-${Date.now()}.jpg`;
    a.click();
  };

  const NumberField = ({
    label,
    value,
    onChange,
    min = 0,
    max = 999,
    step = 1,
    suffix,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
  }) => (
    <label className="block">
      <span className="block text-[10.5px] text-slate-400 mb-1">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
        />
        {suffix && <span className="text-[10px] text-slate-500 shrink-0">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTab('passport')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'passport' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" /> Passport Photo Sheets
          </button>
          <button
            onClick={() => setTab('cnic')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'cnic' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <IdCard className="w-3.5 h-3.5" /> CNIC Front &amp; Back
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {tab === 'passport' && ready && (
            <>
              <span className="hidden sm:flex items-center gap-1 text-[10.5px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-800 rounded-lg px-2 py-1">
                <Layers className="w-3 h-3" /> {wanted} photo{wanted === 1 ? '' : 's'} •{' '}
                {pageCount} page{pageCount === 1 ? '' : 's'}
              </span>
              <button
                onClick={handleDownloadSingle}
                disabled={singleBusy || !selected}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                title="One photo at exact 300 DPI pixel size — for online application portals"
              >
                <FileImage className="w-4 h-4 text-sky-400" /> Single PNG
              </button>
              <button
                onClick={handlePrint}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4 text-emerald-400" /> Print
              </button>
              <button
                onClick={handleDownloadPdf}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
              >
                <Download className="w-4 h-4" /> 300-DPI PDF
              </button>
            </>
          )}
          {tab === 'cnic' && cnicSheetPreview && (
            <>
              <button
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4 text-emerald-400" /> Print
              </button>
              <button
                onClick={downloadCnicPdf}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Save A4
              </button>
            </>
          )}
        </div>
      </div>

      {/* ============================ PASSPORT TAB ============================ */}
      {tab === 'passport' && (
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 xl:grid-cols-12 gap-4 no-print">
          {/* Left: controls */}
          <div className="xl:col-span-4 space-y-3">
            {/* Photos */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-emerald-400" /> Photos on this job
                </h3>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {photos.length === 0 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-5 text-center"
                >
                  <UserRound className="w-6 h-6 text-slate-500 mx-auto mb-1" />
                  <span className="text-[11px] text-slate-400 block">
                    Add one photo — or several for a family / job application sheet.
                  </span>
                  <span className="text-[11px] text-emerald-400 font-bold block mt-1">
                    Select portraits or BG-remover cutouts
                  </span>
                </button>
              )}

              <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                {photos.map((p) => {
                  const active = selected?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setRowId(p.id)}
                      className={`flex items-center gap-2 p-1.5 rounded-xl border cursor-pointer ${
                        active
                          ? 'border-emerald-500 bg-emerald-950/30'
                          : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                      }`}
                    >
                      <div className="w-10 h-12 rounded-lg overflow-hidden bg-checkerboard shrink-0 flex items-center justify-center">
                        <img src={p.src} alt={p.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <input
                          value={p.name}
                          onChange={(e) => updatePhoto(p.id, { name: e.target.value })}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-transparent text-[11px] font-bold text-white outline-none border-b border-transparent focus:border-emerald-600"
                        />
                        <div className="text-[10px] text-slate-400">
                          share {p.copies} · {p.bg === 'transparent' ? 'transparent' : p.bg}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicatePhoto(p.id);
                        }}
                        className="p-1 rounded text-slate-500 hover:text-emerald-300"
                        title="Duplicate"
                      >
                        <CopyIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhoto(p.id);
                        }}
                        className="p-1 rounded text-slate-500 hover:text-rose-400"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected photo settings */}
            {selected && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" /> Adjust “{selected.name}”
                </h3>

                <div>
                  <span className="block text-[10.5px] text-slate-400 mb-1">Backdrop behind this photo</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {BG_SWATCHES.map((c) => (
                      <button
                        key={c}
                        onClick={() => updatePhoto(selected.id, { bg: c })}
                        style={{ background: c === 'transparent' ? undefined : c }}
                        className={`w-6 h-6 rounded-full border ${
                          c === 'transparent' ? 'bg-checkerboard' : ''
                        } ${
                          selected.bg === c ? 'ring-2 ring-emerald-400 border-white' : 'border-slate-600'
                        }`}
                        title={c === 'transparent' ? 'Transparent' : c}
                      />
                    ))}
                    <input
                      type="color"
                      value={selected.bg === 'transparent' ? '#0057b7' : selected.bg}
                      onChange={(e) => updatePhoto(selected.id, { bg: e.target.value })}
                      className="w-7 h-7 rounded cursor-pointer bg-transparent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Share of the total"
                    value={selected.copies}
                    min={1}
                    max={200}
                    onChange={(v) => updatePhoto(selected.id, { copies: v })}
                  />
                  <label className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeSettings.faceAware}
                        onChange={(e) => setSettings((s) => ({ ...s, faceAware: e.target.checked }))}
                        className="accent-emerald-500"
                      />
                      Auto face framing
                    </label>
                  </label>
                </div>

                <div>
                  <label className="text-[10.5px] text-slate-400 flex justify-between mb-1">
                    <span>Zoom</span>
                    <strong className="text-emerald-300">{Math.round(selected.zoom * 100)}%</strong>
                  </label>
                  <input
                    type="range"
                    min={0.8}
                    max={1.8}
                    step={0.02}
                    value={selected.zoom}
                    onChange={(e) => updatePhoto(selected.id, { zoom: Number(e.target.value) })}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] text-slate-400 flex justify-between mb-1">
                    <span>Head position</span>
                    <strong className="text-emerald-300">{selected.offsetY}</strong>
                  </label>
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={selected.offsetY}
                    onChange={(e) => updatePhoto(selected.id, { offsetY: Number(e.target.value) })}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div>
                  <label className="flex items-center justify-between text-[10.5px] text-slate-400 mb-1">
                    <span>Match all photos to this</span>
                    <button
                      onClick={() =>
                        setPhotos((prev) =>
                          prev.map((p) =>
                            p.id === selected.id
                              ? p
                              : { ...p, bg: selected.bg, zoom: selected.zoom, offsetY: selected.offsetY }
                          )
                        )
                      }
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold"
                    >
                      apply
                    </button>
                  </label>
                </div>
              </div>
            )}

            {/* Sheet setup */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-amber-400" /> Size &amp; quantity
              </h3>

              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">Photo size standard</label>
                <select
                  value={sizePreset}
                  onChange={(e) => setSizePreset(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11.5px] text-white"
                >
                  {PHOTO_SIZE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {sizePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Width"
                    value={settings.photoWmm}
                    min={15}
                    max={120}
                    step={0.5}
                    suffix="mm"
                    onChange={(v) => setSettings((s) => ({ ...s, photoWmm: v }))}
                  />
                  <NumberField
                    label="Height"
                    value={settings.photoHmm}
                    min={15}
                    max={160}
                    step={0.5}
                    suffix="mm"
                    onChange={(v) => setSettings((s) => ({ ...s, photoHmm: v }))}
                  />
                </div>
              )}

              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">Paper</label>
                <select
                  value={paperPreset}
                  onChange={(e) => setPaperPreset(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11.5px] text-white"
                >
                  {PAPER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {paperPreset === 'custom_paper' && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Paper width"
                    value={settings.paperWmm}
                    min={50}
                    max={400}
                    step={1}
                    suffix="mm"
                    onChange={(v) => setSettings((s) => ({ ...s, paperWmm: v }))}
                  />
                  <NumberField
                    label="Paper height"
                    value={settings.paperHmm}
                    min={50}
                    max={500}
                    step={1}
                    suffix="mm"
                    onChange={(v) => setSettings((s) => ({ ...s, paperHmm: v }))}
                  />
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">
                  How many photos do you need?{' '}
                  <span className="text-slate-500">({capacity} fit on one page)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={400}
                    value={settings.totalCopies}
                    onChange={(e) => setSettings((s) => ({ ...s, totalCopies: Math.max(1, Number(e.target.value)) }))}
                    className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-emerald-300 font-bold outline-none focus:border-emerald-500"
                  />
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 4, 6, 8, 12, 16, 24, 30].map((n) => (
                      <button
                        key={n}
                        onClick={() => setSettings((s) => ({ ...s, totalCopies: n }))}
                        className={`px-1.5 py-1 rounded-md text-[10.5px] font-bold border ${
                          settings.totalCopies === n
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-slate-950 border-slate-700 text-slate-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setSettings((s) => ({ ...s, totalCopies: capacity }))}
                      className="px-1.5 py-1 rounded-md text-[10.5px] font-bold border bg-slate-950 border-amber-700 text-amber-300"
                      title="Fill the page completely"
                    >
                      Max
                    </button>
                  </div>
                </div>
                {wanted > capacity && (
                  <p className="text-[10px] text-amber-300 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {capacity} per page → {pageCount} pages will be
                    generated.
                  </p>
                )}
                {photos.length > 1 && (
                  <button
                    onClick={() => setPhotos((prev) => prev.map((p) => ({ ...p, copies: 1 })))}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold mt-1"
                  >
                    Split {wanted} evenly between {photos.length} photos
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Gap between photos"
                  value={settings.gapMm}
                  min={0}
                  max={20}
                  step={0.5}
                  suffix="mm"
                  onChange={(v) => setSettings((s) => ({ ...s, gapMm: v }))}
                />
                <NumberField
                  label="Page margin"
                  value={settings.marginMm}
                  min={0}
                  max={30}
                  step={0.5}
                  suffix="mm"
                  onChange={(v) => setSettings((s) => ({ ...s, marginMm: v }))}
                />
              </div>

              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">Cut guides</label>
                <div className="grid grid-cols-4 gap-1">
                  {(['none', 'corner', 'dashed', 'hairline'] as GuideStyle[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setSettings((s) => ({ ...s, guide: g }))}
                      className={`py-1.5 rounded-lg text-[10px] font-bold capitalize border ${
                        settings.guide === g
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-950 border-slate-700 text-slate-400'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">
                  Shop note on the sheet (optional)
                </label>
                <input
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                  placeholder="IK Computers · 0300-0000000"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800 pt-2">
                <span>
                  {activeSettings.photoWmm} × {activeSettings.photoHmm} mm • {layout.cols}×{layout.rows} grid
                </span>
                <button
                  onClick={() => setSettings(DEFAULT_SHEET)}
                  className="text-slate-400 hover:text-white font-semibold"
                >
                  reset
                </button>
              </div>
            </div>
          </div>

          {/* Right: preview */}
          <div className="xl:col-span-8 space-y-2">
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col items-center min-h-[420px] justify-center">
              {building && (
                <div className="text-xs text-emerald-300 font-semibold animate-pulse mb-2">
                  Building 300-DPI sheet…
                </div>
              )}
              {sheetError && (
                <div className="max-w-md text-center text-xs text-rose-300 bg-rose-950/40 border border-rose-800 rounded-xl px-3 py-2 mb-2">
                  {sheetError}
                </div>
              )}
              {ready && !building ? (
                <img
                  src={pages[Math.min(pageIndex, pages.length - 1)].url}
                  alt="Photo sheet preview"
                  className="max-h-[68vh] w-auto object-contain shadow-2xl rounded bg-white"
                />
              ) : (
                !building && (
                  <div className="text-center">
                    <FileImage className="w-9 h-9 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500 max-w-sm">
                      Add a customer photo to generate a print-ready sheet. Choose the size standard, paper and
                      the exact number of photos you need.
                    </p>
                  </div>
                )
              )}
            </div>

            {pages.length > 1 && (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-300">
                <button
                  onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                  className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono">
                  Page {Math.min(pageIndex + 1, pages.length)} / {pages.length}
                </span>
                <button
                  onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
                  className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {ready && (
              <div className="flex flex-wrap items-center gap-2 justify-center">
                <button
                  onClick={() =>
                    downloadCanvasJpg(
                      pages[Math.min(pageIndex, pages.length - 1)].canvas,
                      `IK-PhotoSheet-${Date.now()}.jpg`
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold"
                >
                  Save this page as JPG
                </button>
                {pages.length > 1 && (
                  <button
                    onClick={() => {
                      pages.forEach((pg, i) =>
                        setTimeout(
                          () => downloadCanvasJpg(pg.canvas, `IK-PhotoSheet-p${i + 1}-${Date.now()}.jpg`),
                          i * 350
                        )
                      );
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold"
                  >
                    Save all {pages.length} pages
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================== CNIC TAB ============================== */}
      {tab === 'cnic' && (
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 no-print">
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 h-fit">
            <div>
              <h3 className="font-bold text-white text-base">CNIC Front &amp; Back A4 Sheet</h3>
              <p className="text-xs text-slate-400">
                Auto-scales WhatsApp photos to exact NADRA card size (85.6 × 54 mm) on A4.
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
                Copies on single A4 page
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
                  <Sparkles className="w-3.5 h-3.5" /> Clean B&amp;W photostat (toner saver)
                </div>
                <div className="text-slate-400">Whitens WhatsApp shadows for a clean laser copy</div>
              </div>
            </label>
          </div>

          <div className="lg:col-span-8 flex items-center justify-center bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            {cnicSheetPreview ? (
              <img
                src={cnicSheetPreview}
                alt="CNIC A4 sheet preview"
                className="max-h-[72vh] w-auto object-contain shadow-2xl rounded bg-white"
              />
            ) : (
              <p className="text-xs text-slate-500">
                Upload CNIC front &amp; back images to lay them out cleanly on one A4 page.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Print target — every generated page in order */}
      <div id="ik-print-area" className="hidden print:block bg-white">
        {tab === 'passport'
          ? pages.map((p, i) => (
              <img key={i} src={p.url} alt={`Sheet page ${i + 1}`} className="ik-print-page w-full h-auto" />
            ))
          : cnicSheetPreview && (
              <img src={cnicSheetPreview} alt="CNIC sheet" className="ik-print-page w-full h-auto" />
            )}
      </div>
    </div>
  );
};

export default IdAndPassportStudio;
