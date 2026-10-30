import React, { useEffect, useRef, useState } from 'react';
import {
  Scissors,
  Upload,
  Download,
  Sparkles,
  PenTool,
  IdCard,
  Eraser,
  RotateCcw,
} from 'lucide-react';
import {
  extractSignatureToTransparentCanvas,
  loadImageElement,
} from '../lib/imageFilters';

interface BackgroundRemoverStudioProps {
  onSendToPassportMaker: (imageDataUrl: string) => void;
}

const BACKDROP_PRESETS = [
  { label: 'Transparent', value: 'transparent' },
  { label: 'Passport Blue', value: '#0057b7' },
  { label: 'NADRA Sky Blue', value: '#2563eb' },
  { label: 'Pure White', value: '#ffffff' },
  { label: 'Visa Light Gray', value: '#e2e8f0' },
  { label: 'Studio Red', value: '#dc2626' },
];

export const BackgroundRemoverStudio: React.FC<BackgroundRemoverStudioProps> = ({
  onSendToPassportMaker,
}) => {
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [cutoutUrl, setCutoutUrl] = useState<string>(''); // Transparent PNG cutout
  const [finalCompositeUrl, setFinalCompositeUrl] = useState<string>('');
  const [mode, setMode] = useState<'ai_hd' | 'signature'>('ai_hd');
  const [bgColor, setBgColor] = useState<string>('transparent');
  const [sigThreshold, setSigThreshold] = useState<number>(185);
  const [processing, setProcessing] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [brushEraseActive, setBrushEraseActive] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(22);

  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  const runAiRemoval = async (srcUrl: string) => {
    setProcessing(true);
    setProgressText('Loading AI Neural Segmentation model in browser...');
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await removeBackground(srcUrl, {
        progress: (key: string, current: number, total: number) => {
          if (total > 0) {
            const pct = Math.min(100, Math.round((current / total) * 100));
            setProgressText(`Processing ${key.replace('fetch:', '')}: ${pct}%`);
          }
        },
      });
      const reader = new FileReader();
      const pngUrl: string = await new Promise((resolve) => {
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      setCutoutUrl(pngUrl);
      setProgressText('');
    } catch (err: any) {
      console.error('AI BG removal error:', err);
      setProgressText('AI model error — try Signature mode or reload image.');
    } finally {
      setProcessing(false);
    }
  };

  const runSignatureExtraction = async (srcUrl: string, thresh: number) => {
    setProcessing(true);
    try {
      const img = await loadImageElement(srcUrl);
      const canvas = extractSignatureToTransparentCanvas(img, thresh);
      setCutoutUrl(canvas.toDataURL('image/png'));
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    const url: string = await new Promise((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    setOriginalUrl(url);
    setCutoutUrl('');
    if (mode === 'ai_hd') {
      await runAiRemoval(url);
    } else {
      await runSignatureExtraction(url, sigThreshold);
    }
  };

  // Update signature extraction live when threshold changes
  useEffect(() => {
    if (originalUrl && mode === 'signature') {
      runSignatureExtraction(originalUrl, sigThreshold);
    }
  }, [sigThreshold, mode]);

  // Draw cutout + selected background color onto composite canvas
  useEffect(() => {
    if (!cutoutUrl) {
      setFinalCompositeUrl('');
      return;
    }
    let cancelled = false;
    const compose = async () => {
      const fg = await loadImageElement(cutoutUrl);
      const canvas = editCanvasRef.current || document.createElement('canvas');
      canvas.width = fg.width;
      canvas.height = fg.height;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bgColor !== 'transparent') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(fg, 0, 0);
      if (!cancelled) {
        setFinalCompositeUrl(canvas.toDataURL('image/png'));
      }
    };
    compose();
    return () => {
      cancelled = true;
    };
  }, [cutoutUrl, bgColor]);

  // Manual touch-up eraser on the transparent cutout
  const handleCanvasErase = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!brushEraseActive || !isDrawingRef.current || !cutoutUrl) return;
    const container = e.currentTarget;
    const imgEl = container.querySelector('img');
    if (!imgEl) return;
    const rect = imgEl.getBoundingClientRect();
    const fg = await loadImageElement(cutoutUrl);
    const scaleX = fg.width / rect.width;
    const scaleY = fg.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const c = document.createElement('canvas');
    c.width = fg.width;
    c.height = fg.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(fg, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, brushSize * scaleX * 0.5, 0, Math.PI * 2);
    ctx.fill();
    setCutoutUrl(c.toDataURL('image/png'));
  };

  const handleDownload = () => {
    if (!finalCompositeUrl) return;
    const a = document.createElement('a');
    a.href = finalCompositeUrl;
    a.download = `IK-Cutout-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <canvas ref={editCanvasRef} className="hidden" />

      {/* Top Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => {
                setMode('ai_hd');
                if (originalUrl) runAiRemoval(originalUrl);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                mode === 'ai_hd'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Neural BG Remover (Photos & People)
            </button>
            <button
              onClick={() => setMode('signature')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                mode === 'signature'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" /> Signature / Stamp Extractor
            </button>
          </div>

          <label className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-emerald-400" /> Upload Photo
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>

        {finalCompositeUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setBrushEraseActive((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 ${
                brushEraseActive
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <Eraser className="w-3.5 h-3.5" /> Touch-Up Eraser
            </button>

            <button
              onClick={() =>
                onSendToPassportMaker(
                  bgColor === 'transparent' ? cutoutUrl : finalCompositeUrl
                )
              }
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow"
            >
              <IdCard className="w-4 h-4" /> Send to Passport Photo Sheet
            </button>

            <button
              onClick={handleDownload}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
            >
              <Download className="w-4 h-4" /> Download PNG
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center">
        {!originalUrl ? (
          <label className="max-w-lg w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer transition">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <Scissors className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">
              100% Local AI Background Remover & Passport Backdrop Studio
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              Remove backgrounds from customer portraits, products, or signatures offline — replace
              with Passport Blue or White in 1 click, then print a Passport Sheet!
            </p>
            <span className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
              Select Image to Remove Background
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        ) : (
          <div className="w-full max-w-5xl space-y-4">
            {/* Backdrop Color Presets & Mode Controls */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 mr-1">Backdrop:</span>
                {BACKDROP_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setBgColor(preset.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition ${
                      bgColor === preset.value
                        ? 'border-emerald-400 bg-slate-800 text-white ring-1 ring-emerald-400'
                        : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <span
                      style={{
                        background:
                          preset.value === 'transparent' ? undefined : preset.value,
                      }}
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
                  title="Custom Backdrop Color"
                />
              </div>

              {mode === 'signature' && (
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span>Ink Sensitivity:</span>
                  <input
                    type="range"
                    min={90}
                    max={235}
                    value={sigThreshold}
                    onChange={(e) => setSigThreshold(Number(e.target.value))}
                    className="w-28 accent-sky-500"
                  />
                </div>
              )}

              {brushEraseActive && (
                <div className="flex items-center gap-2 text-xs text-amber-300">
                  <span>Brush Size:</span>
                  <input
                    type="range"
                    min={8}
                    max={60}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-24 accent-amber-400"
                  />
                  <button
                    onClick={() =>
                      mode === 'ai_hd'
                        ? runAiRemoval(originalUrl)
                        : runSignatureExtraction(originalUrl, sigThreshold)
                    }
                    className="px-2 py-1 rounded bg-slate-800 text-slate-200 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset Cutout
                  </button>
                </div>
              )}
            </div>

            {processing && (
              <div className="bg-emerald-950/50 border border-emerald-700/60 rounded-xl p-4 text-center text-sm text-emerald-300 font-semibold animate-pulse">
                ✨ {progressText || 'Removing background...'}
              </div>
            )}

            {/* Side-by-Side Original vs Cutout Result */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Original Photo
                </span>
                <img
                  src={originalUrl}
                  alt="Original"
                  className="max-h-[430px] w-auto object-contain rounded-lg"
                />
              </div>

              <div
                onMouseDown={(e) => {
                  isDrawingRef.current = true;
                  handleCanvasErase(e);
                }}
                onMouseMove={handleCanvasErase}
                onMouseUp={() => {
                  isDrawingRef.current = false;
                }}
                onMouseLeave={() => {
                  isDrawingRef.current = false;
                }}
                className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center ${
                  brushEraseActive ? 'cursor-crosshair' : ''
                }`}
              >
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3">
                  Background Removed Result
                </span>
                <div className="bg-checkerboard rounded-lg p-1 flex items-center justify-center">
                  {finalCompositeUrl ? (
                    <img
                      src={finalCompositeUrl}
                      alt="Cutout Result"
                      className="max-h-[430px] w-auto object-contain rounded select-none"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-64 h-64 flex items-center justify-center text-xs text-slate-500">
                      Processing...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
