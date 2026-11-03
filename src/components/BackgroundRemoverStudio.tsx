import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Scissors,
  Upload,
  Download,
  Sparkles,
  PenTool,
  IdCard,
  Eraser,
  RotateCcw,
  Zap,
  Palette,
  Brush,
  Undo2,
  Check,
  Wand2,
  Maximize2,
  Crop,
  Save,
} from 'lucide-react';
import { extractSignatureToTransparentCanvas } from '../lib/imageFilters';
import {
  aiCutout,
  alphaBoundingBox,
  fastCutout,
  isLowPowerDevice,
  loadImageElement,
  trimTransparent,
  type CutoutOptions,
} from '../lib/bgRemoval';

interface BackgroundRemoverStudioProps {
  onSendToPassportMaker: (imageDataUrl: string) => void;
}

type Engine = 'fast' | 'ai';
type Mode = 'photo' | 'signature';

const BACKDROP_PRESETS = [
  { label: 'Transparent', value: 'transparent' },
  { label: 'Passport Blue', value: '#0057b7' },
  { label: 'NADRA Sky', value: '#2563eb' },
  { label: 'Pure White', value: '#ffffff' },
  { label: 'Visa Gray', value: '#e2e8f0' },
  { label: 'Studio Red', value: '#dc2626' },
  { label: 'Soft Cream', value: '#fdf6e3' },
];

const LAST_SETTINGS_KEY = 'ik_bg_last_settings';

interface StoredSettings {
  tolerance: number;
  feather: number;
  shrink: number;
  engine: Engine;
}

function readStoredSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(LAST_SETTINGS_KEY);
    if (raw) return { tolerance: 42, feather: 1.4, shrink: 1, engine: 'fast', ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { tolerance: 42, feather: 1.4, shrink: 1, engine: 'fast' };
}

export const BackgroundRemoverStudio: React.FC<BackgroundRemoverStudioProps> = ({
  onSendToPassportMaker,
}) => {
  const stored = useMemo(readStoredSettings, []);

  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [engine, setEngine] = useState<Engine>(stored.engine);
  const [mode, setMode] = useState<Mode>('photo');
  const [cutoutUrl, setCutoutUrl] = useState<string>('');
  const [cutoutCanvas, setCutoutCanvas] = useState<HTMLCanvasElement | null>(null);
  const [bgColor, setBgColor] = useState<string>('transparent');
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(-1);
  const [speedMs, setSpeedMs] = useState<number | null>(null);
  const [tolerance, setTolerance] = useState<number>(stored.tolerance);
  const [feather, setFeather] = useState<number>(stored.feather);
  const [shrink, setShrink] = useState<number>(stored.shrink);
  const [despeckle, setDespeckle] = useState<boolean>(true);
  const [erasedMaskUrl, setErasedMaskUrl] = useState<string>('');
  const [brushOn, setBrushOn] = useState(false);
  const [brushSize, setBrushSize] = useState(26);
  const [history, setHistory] = useState<string[]>([]);
  const [warning, setWarning] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [comparing, setComparing] = useState(false);

  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const runTokenRef = useRef(0);
  /** true once the hidden working canvas holds the latest cutout. */
  const workingDirtyRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        LAST_SETTINGS_KEY,
        JSON.stringify({ tolerance, feather, shrink, engine })
      );
    } catch {
      /* ignore */
    }
  }, [tolerance, feather, shrink, engine]);

  // ---------------------------------------------------------------------
  // Engine runners
  // ---------------------------------------------------------------------
  const runFast = async (srcUrl: string, opts: Partial<CutoutOptions> = {}) => {
    const token = ++runTokenRef.current;
    setProcessing(true);
    setWarning('');
    setProgressPct(-1);
    setProgressText('Separating subject locally…');
    try {
      const img = await loadImageElement(srcUrl);
      // Yield one frame so the spinner actually paints.
      await new Promise((r) => setTimeout(r, 16));
      const result = fastCutout(img, {
        tolerance,
        feather,
        shrink,
        despeckle,
        ...opts,
      });
      if (token !== runTokenRef.current) return;
      setCutoutCanvas(result.canvas);
      setCutoutUrl(result.canvas.toDataURL('image/png'));
      setSpeedMs(result.ms);
      setErasedMaskUrl('');
      workingDirtyRef.current = false;
      if (result.failed) {
        setWarning(
          'No background edge found — this photo fills the whole frame. Nothing was removed. Ask for a photo with some wall around the head, or switch to AI HD mode.'
        );
        setProgressText('');
      } else if (result.ms < 120) {
        setProgressText(`Done in ${result.ms} ms — instant, offline.`);
      } else {
        setProgressText(`Done in ${result.ms} ms.`);
      }
    } catch (err: any) {
      if (token === runTokenRef.current) {
        setWarning(String(err?.message || 'Could not process this image.'));
        setProgressText('');
      }
    } finally {
      if (token === runTokenRef.current) setProcessing(false);
    }
  };

  const runAi = async (srcUrl: string) => {
    const token = ++runTokenRef.current;
    setProcessing(true);
    setWarning('');
    setProgressPct(0);
    setProgressText(
      isLowPowerDevice()
        ? 'Loading the AI model — this phone may take a while once. Use “Instant” mode for speed.'
        : 'Loading the AI model (downloads once, then cached)…'
    );
    try {
      const result = await aiCutout(srcUrl, {
        quality: 'fast',
        onProgress: (text, pct) => {
          if (token !== runTokenRef.current) return;
          setProgressText(text);
          setProgressPct(pct);
        },
      });
      if (token !== runTokenRef.current) return;
      setCutoutCanvas(result.canvas);
      setCutoutUrl(result.canvas.toDataURL('image/png'));
      setSpeedMs(result.ms);
      setErasedMaskUrl('');
      workingDirtyRef.current = false;
      setProgressText(result.cached ? 'Loaded from cache — instant.' : `AI finished in ${result.ms} ms.`);
      setProgressPct(100);
    } catch (err: any) {
      if (token === runTokenRef.current) {
        setWarning(
          'The AI model could not load (usually no internet for the first download). Instant mode works fully offline — try that.'
        );
        setProgressText('');
      }
    } finally {
      if (token === runTokenRef.current) setProcessing(false);
    }
  };

  const runSignature = async (srcUrl: string, thresh: number) => {
    const token = ++runTokenRef.current;
    setProcessing(true);
    setWarning('');
    setProgressText('Extracting ink…');
    try {
      const img = await loadImageElement(srcUrl);
      const canvas = extractSignatureToTransparentCanvas(img, thresh);
      if (token !== runTokenRef.current) return;
      setCutoutCanvas(canvas);
      setCutoutUrl(canvas.toDataURL('image/png'));
      setSpeedMs(null);
      setErasedMaskUrl('');
      workingDirtyRef.current = false;
      setProgressText('Ink extracted.');
    } finally {
      if (token === runTokenRef.current) setProcessing(false);
    }
  };

  const sigThreshold = Math.max(90, Math.min(235, Math.round(235 - tolerance * 1.19)));

  const reprocess = (overrides: Partial<{ tol: number; feather: number; shrink: number; mode: Mode; engine: Engine }> = {}) => {
    if (!originalUrl) return;
    const m = overrides.mode ?? mode;
    if (m === 'signature') {
      runSignature(
        originalUrl,
        Math.max(90, Math.min(235, Math.round(235 - (overrides.tol ?? tolerance) * 1.19)))
      );
      return;
    }
    const e = overrides.engine ?? engine;
    if (e === 'ai') runAi(originalUrl);
    else
      runFast(originalUrl, {
        tolerance: overrides.tol ?? tolerance,
        feather: overrides.feather ?? feather,
        shrink: overrides.shrink ?? shrink,
      });
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setWarning('Please choose an image file (JPG, PNG, WEBP or HEIC-converted).');
      return;
    }
    const url: string = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    setOriginalUrl(url);
    workingDirtyRef.current = false;
    setCutoutCanvas(null);
    setCutoutUrl('');
    setHistory([]);
    setSpeedMs(null);
    reprocess();
  };

  // Live re-process when the slider is released (debounced while dragging).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!originalUrl || mode !== 'photo' || engine !== 'fast') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runFast(originalUrl, { tolerance, feather, shrink, despeckle });
    }, 260);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerance, feather, shrink, despeckle, engine, mode]);

  // ---------------------------------------------------------------------
  // Manual brush clean-up (uses a painted mask, no re-encode of the base)
  // ---------------------------------------------------------------------
  const applyEraseStroke = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!brushOn || !cutoutCanvas) return;
    const holder = e.currentTarget.querySelector('img');
    if (!holder) return;
    const rect = holder.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * cutoutCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * cutoutCanvas.height;

    const canvas = editCanvasRef.current!;
    if (canvas.width !== cutoutCanvas.width || canvas.height !== cutoutCanvas.height) {
      canvas.width = cutoutCanvas.width;
      canvas.height = cutoutCanvas.height;
    }
    const ctx = canvas.getContext('2d')!;

    if (lastPointRef.current) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize * (cutoutCanvas.width / Math.max(1, rect.width));
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    lastPointRef.current = { x, y };
  };

  const startDraw = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!brushOn || !cutoutCanvas) return;
    // Seed the hidden working canvas from the current cutout the first time.
    const canvas = editCanvasRef.current!;
    if (!workingDirtyRef.current) {
      canvas.width = cutoutCanvas.width;
      canvas.height = cutoutCanvas.height;
      canvas.getContext('2d')!.drawImage(cutoutCanvas, 0, 0);
      workingDirtyRef.current = true;
    }
    setHistory((h) => [...h.slice(-9), canvas.toDataURL('image/png')]);
    drawingRef.current = true;
    lastPointRef.current = null;
    await applyEraseStroke(e);
  };

  const moveDraw = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    await applyEraseStroke(e);
  };

  const endDraw = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    setErasedMaskUrl(canvas.toDataURL('image/png'));
    setCutoutCanvas(canvas);
    setCutoutUrl(canvas.toDataURL('image/png'));
    workingDirtyRef.current = true;
  };

  const undoErase = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const next = [...h];
      const previous = next.pop()!;
      setCutoutUrl(previous);
      loadImageElement(previous).then((img) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        setCutoutCanvas(c);
        const work = editCanvasRef.current;
        if (work) {
          work.width = c.width;
          work.height = c.height;
          work.getContext('2d')!.drawImage(c, 0, 0);
          workingDirtyRef.current = true;
        }
      });
      return next;
    });
  };

  // ---------------------------------------------------------------------
  // Composite over the chosen backdrop
  // ---------------------------------------------------------------------
  const [compositeUrl, setCompositeUrl] = useState('');
  useEffect(() => {
    if (!cutoutUrl) {
      setCompositeUrl('');
      return;
    }
    if (bgColor === 'transparent') {
      setCompositeUrl(cutoutUrl);
      return;
    }
    let cancelled = false;
    (async () => {
      const img = await loadImageElement(cutoutUrl);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      if (!cancelled) setCompositeUrl(c.toDataURL('image/png'));
    })();
    return () => {
      cancelled = true;
    };
  }, [cutoutUrl, bgColor]);

  const visibleUrl = bgColor === 'transparent' ? cutoutUrl : compositeUrl;

  // ---------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------
  const handleDownload = () => {
    if (!visibleUrl) return;
    const a = document.createElement('a');
    a.href = visibleUrl;
    a.download = `IK-Cutout-${bgColor === 'transparent' ? 'transparent' : bgColor.replace('#', '')}-${Date.now()}.png`;
    a.click();
  };

  const handleDownloadTrimmed = async () => {
    if (!cutoutCanvas) return;
    const trimmed = trimTransparent(cutoutCanvas);
    const a = document.createElement('a');
    a.href = trimmed.toDataURL('image/png');
    a.download = `IK-Cutout-trimmed-${Date.now()}.png`;
    a.click();
  };

  const stats = useMemo(() => {
    if (!cutoutCanvas) return null;
    const bbox = alphaBoundingBox(cutoutCanvas);
    const px = cutoutCanvas.width * cutoutCanvas.height;
    return {
      size: `${cutoutCanvas.width} × ${cutoutCanvas.height}`,
      subject: bbox ? `${Math.round((bbox.w / cutoutCanvas.width) * 100)}% wide / ${Math.round((bbox.h / cutoutCanvas.height) * 100)}% tall` : '—',
      megapixels: (px / 1_000_000).toFixed(1),
    };
  }, [cutoutCanvas]);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <canvas ref={editCanvasRef} className="hidden" />

      {/* Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-2 no-print">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => {
              setMode('photo');
              setEngine('fast');
              reprocess({ mode: 'photo', engine: 'fast' });
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              mode === 'photo' && engine === 'fast' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
            title="Offline wall-colour engine — instant, no download"
          >
            <Zap className="w-3.5 h-3.5" /> Instant Cutout
          </button>
          <button
            onClick={() => {
              setMode('photo');
              setEngine('ai');
              reprocess({ mode: 'photo', engine: 'ai' });
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              mode === 'photo' && engine === 'ai' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
            title="Neural matting — best for cluttered backgrounds"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI HD
          </button>
          <button
            onClick={() => {
              setMode('signature');
              reprocess({ mode: 'signature' });
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              mode === 'signature' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" /> Signature
          </button>
        </div>

        <label className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 text-emerald-400" /> Upload Photo
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>

        <button
          onClick={() => setShowHelp((v) => !v)}
          className="px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold"
        >
          Help
        </button>

        {speedMs !== null && !processing && (
          <span className="px-2 py-1 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-[11px] font-bold">
            {speedMs} ms
          </span>
        )}

        {visibleUrl && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setBrushOn((v) => !v);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 ${
                brushOn ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" /> Touch-Up
            </button>
            {history.length > 0 && (
              <button
                onClick={undoErase}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1"
              >
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
            )}
            <button
              onClick={() => onSendToPassportMaker(bgColor === 'transparent' ? cutoutUrl : compositeUrl)}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow"
            >
              <IdCard className="w-4 h-4" /> Passport Sheet
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
            >
              <Download className="w-4 h-4" /> PNG
            </button>
          </div>
        )}
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto p-5">
        {!originalUrl ? (
          <div className="max-w-3xl mx-auto space-y-4">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className="w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer transition"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
                <Scissors className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">
                Background Remover — fast offline cutouts &amp; passport backdrops
              </h3>
              <p className="text-xs text-slate-400 mb-5 max-w-lg">
                Drop a customer photo here. The <strong className="text-emerald-300">Instant</strong> engine
                works with no internet and finishes in a fraction of a second; switch to{' '}
                <strong className="text-sky-300">AI HD</strong> only for messy backgrounds.
              </p>
              <span className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                Select or drop an image
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>

            <div className="grid sm:grid-cols-3 gap-3">
              {[
                {
                  icon: Zap,
                  title: 'Instant engine',
                  text: 'No 40 MB model download. Ideal for studio backdrops and counter walk-ins.',
                },
                {
                  icon: Brush,
                  title: 'Soft matte + touch-up',
                  text: 'Feathered edges without the white halo, plus a brush with undo.',
                },
                {
                  icon: IdCard,
                  title: 'Straight to the sheet',
                  text: 'One click sends the cutout to the Passport Photo Sheet maker.',
                },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1">
                    <Icon className="w-4 h-4" /> {title}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-4">
            {warning && (
              <div className="bg-rose-950/50 border border-rose-800 rounded-xl px-3 py-2 text-xs text-rose-200 flex items-start gap-2">
                <span className="mt-0.5">⚠</span>
                <span className="flex-1">{warning}</span>
                <button onClick={() => setWarning('')} className="text-rose-300/70 hover:text-rose-200">
                  ✕
                </button>
              </div>
            )}

            {showHelp && (
              <div className="bg-sky-950/40 border border-sky-800 rounded-xl p-3 text-[11.5px] text-sky-100 leading-relaxed space-y-1">
                <strong>Getting a perfect cutout</strong>
                <div>• Instant engine compares the photo border with the subject — a plain wall works best.</div>
                <div>• Too much of the wall left? Raise <em>Tolerance</em>. Ate the hair? Lower it.</div>
                <div>• Halo / fringe around shoulders? Use <em>Shrink</em> and then <em>Feather</em>.</div>
                <div>• Missing fingers or a chair edge? Turn on <em>Touch-Up</em> and paint it back in with Undo.</div>
                <div>• Camera on a phone: shoot against a plain wall, even light, no window behind.</div>
              </div>
            )}

            {processing && (
              <div className="bg-emerald-950/50 border border-emerald-700/60 rounded-xl p-3">
                <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold">
                  <span className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 animate-pulse" />
                    {progressText || 'Working…'}
                  </span>
                  {progressPct >= 0 && <span>{progressPct}%</span>}
                </div>
                {progressPct >= 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-emerald-900/60 overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-all"
                      style={{ width: `${Math.max(4, progressPct)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Backdrop presets */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
                <Palette className="w-3.5 h-3.5" /> Backdrop
              </span>
              {BACKDROP_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setBgColor(preset.value)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1.5 transition ${
                    bgColor === preset.value
                      ? 'border-emerald-400 bg-slate-800 text-white ring-1 ring-emerald-400'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span
                    style={{ background: preset.value === 'transparent' ? undefined : preset.value }}
                    className={`w-3.5 h-3.5 rounded-full border border-slate-500 ${
                      preset.value === 'transparent' ? 'bg-checkerboard' : ''
                    }`}
                  />
                  {preset.label}
                </button>
              ))}
              <input
                type="color"
                value={bgColor === 'transparent' ? '#0057b7' : bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer bg-transparent"
                title="Custom backdrop colour"
              />
              <button
                onClick={() => setComparing((v) => !v)}
                className={`ml-auto px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 ${
                  comparing
                    ? 'bg-slate-100 text-slate-900 border-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <Crop className="w-3.5 h-3.5" /> Hold to compare
              </button>
            </div>

            {/* Side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col items-center">
                <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Original
                </span>
                <div className="relative flex items-center justify-center">
                  <img
                    src={originalUrl}
                    alt="Original"
                    className={`max-h-[52vh] w-auto object-contain rounded-lg ${comparing ? '' : 'opacity-100'}`}
                  />
                </div>
              </div>

              <div
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                className={`bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col items-center ${
                  brushOn ? 'cursor-crosshair ring-1 ring-amber-500/60' : ''
                }`}
              >
                <div className="w-full flex items-center justify-between mb-2">
                  <span className="text-[10.5px] font-bold text-emerald-400 uppercase tracking-wider">
                    Cutout result
                  </span>
                  {stats && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      {stats.size}px • {stats.megapixels} MP • {stats.subject}
                    </span>
                  )}
                </div>
                <div
                  className={`rounded-lg p-1 flex items-center justify-center min-h-[220px] ${
                    bgColor === 'transparent' ? 'bg-checkerboard' : ''
                  }`}
                  style={bgColor === 'transparent' ? undefined : { background: '#0f172a' }}
                >
                  {visibleUrl ? (
                    <img
                      src={visibleUrl}
                      alt="Cutout"
                      className="max-h-[52vh] w-auto object-contain rounded select-none touch-none"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center text-xs text-slate-500">
                      {processing ? 'Processing…' : 'No cutout yet'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Engine controls */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-emerald-400" /> Fine tuning
                </h4>
                <button
                  onClick={() => reprocess()}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-200 font-semibold flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Re-run
                </button>
              </div>

              {mode === 'photo' ? (
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[11px] text-slate-400 flex justify-between">
                      <span>Wall tolerance</span>
                      <strong className="text-emerald-300">{tolerance}</strong>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={110}
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                    <p className="text-[10px] text-slate-500">Raise if wall patches remain.</p>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 flex justify-between">
                      <span>Edge feather</span>
                      <strong className="text-emerald-300">{feather.toFixed(1)}</strong>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={0.2}
                      value={feather}
                      onChange={(e) => setFeather(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                    <p className="text-[10px] text-slate-500">Softens hair and shoulder edges.</p>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 flex justify-between">
                      <span>Shrink matte</span>
                      <strong className="text-emerald-300">{shrink}</strong>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      value={shrink}
                      onChange={(e) => setShrink(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                    <p className="text-[10px] text-slate-500">Removes the light rim/halo.</p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[11px] text-slate-400 flex justify-between">
                    <span>Ink sensitivity</span>
                    <strong className="text-violet-300">{sigThreshold}</strong>
                  </label>
                  <input
                    type="range"
                    min={90}
                    max={235}
                    value={sigThreshold}
                    onChange={(e) => {
                      const t = Number(e.target.value);
                      setTolerance(Math.round((235 - t) / 1.19));
                      runSignature(originalUrl, t);
                    }}
                    className="w-full accent-violet-500"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={despeckle}
                    onChange={(e) => setDespeckle(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Remove dust specks
                </label>

                {brushOn && (
                  <label className="flex items-center gap-2 text-[11px] text-amber-300">
                    Brush
                    <input
                      type="range"
                      min={8}
                      max={90}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      className="w-24 accent-amber-400"
                    />
                    <span className="font-mono">{brushSize}</span>
                  </label>
                )}

                <button
                  onClick={handleDownloadTrimmed}
                  className="ml-auto px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                  title="Crop away transparent padding so passport forms accept the file"
                >
                  <Maximize2 className="w-3 h-3" /> Download trimmed PNG
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              Photos never leave this computer — the instant engine is fully offline.
              <button
                onClick={() => {
                  setOriginalUrl('');
                  setCutoutUrl('');
                  setCutoutCanvas(null);
                  setCompositeUrl('');
                  setHistory([]);
                  setWarning('');
                }}
                className="ml-auto flex items-center gap-1 text-slate-400 hover:text-white font-semibold"
              >
                <Save className="w-3 h-3" /> New photo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BackgroundRemoverStudio;
