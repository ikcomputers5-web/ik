import React, { useState } from 'react';
import {
  Sparkles,
  Minimize2,
  Receipt,
  Upload,
  Download,
  Printer,
  Send,
  Plus,
  Trash2,
  Camera,
} from 'lucide-react';
import { compressToTargetKB, loadImageElement } from '../lib/imageFilters';
import {
  extractDocumentOcrWithGroq,
  hasGroqKey,
  transformShopTextWithGroq,
  TextTransformMode,
} from '../lib/groqClient';

interface ShopUtilitiesHubProps {
  initialTab?: 'ai' | 'compressor' | 'pos';
  onOpenGroqModal: () => void;
  onSendHtmlToComposer: (html: string) => void;
}

interface RateItem {
  id: string;
  label: string;
  rate: number;
  qty: number;
}

const DEFAULT_RATES: RateItem[] = [
  { id: 'bw_print', label: 'B&W Laser Print / Photostat (per page)', rate: 15, qty: 0 },
  { id: 'color_print', label: 'Color Print (per page)', rate: 50, qty: 0 },
  { id: 'urdu_comp', label: 'Urdu Composing + Print (per page)', rate: 150, qty: 0 },
  { id: 'en_comp', label: 'English Composing / CV', rate: 200, qty: 0 },
  { id: 'pdf_edit', label: 'PDF Editing / Form Fill', rate: 150, qty: 0 },
  { id: 'passport_pic', label: 'Passport Photos Sheet (8 pcs)', rate: 250, qty: 0 },
  { id: 'cnic_copy', label: 'CNIC Front/Back Print', rate: 30, qty: 0 },
  { id: 'lamination', label: 'Lamination / Binding', rate: 100, qty: 0 },
];

export const ShopUtilitiesHub: React.FC<ShopUtilitiesHubProps> = ({
  initialTab = 'ai',
  onOpenGroqModal,
  onSendHtmlToComposer,
}) => {
  const [tab, setTab] = useState<'ai' | 'compressor' | 'pos'>(initialTab);

  // --- AI OCR & Translator State ---
  const [aiInput, setAiInput] = useState<string>('');
  const [aiOutput, setAiOutput] = useState<string>('');
  const [ocrImagePreview, setOcrImagePreview] = useState<string>('');
  const [aiBusy, setAiBusy] = useState<boolean>(false);
  const [aiErr, setAiErr] = useState<string>('');

  // --- Portal KB Compressor State ---
  const [compSrc, setCompSrc] = useState<string>('');
  const [origKB, setOrigKB] = useState<number>(0);
  const [targetKB, setTargetKB] = useState<number>(20);
  const [maxWidth, setMaxWidth] = useState<number>(600);
  const [compResult, setCompResult] = useState<{
    dataUrl: string;
    sizeKB: number;
    width: number;
    height: number;
    quality: number;
  } | null>(null);

  // --- Shop POS Bill & Receipt State ---
  const [customerName, setCustomerName] = useState<string>('Walk-in Customer');
  const [shopPhone, setShopPhone] = useState<string>(
    () => localStorage.getItem('ik_shop_phone') || '0300-0000000'
  );
  const [shopAddress, setShopAddress] = useState<string>(
    () => localStorage.getItem('ik_shop_addr') || 'Main Market, Lahore'
  );
  const [items, setItems] = useState<RateItem[]>(() => {
    try {
      const saved = localStorage.getItem('ik_pos_rates_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((x: RateItem) => ({ ...x, qty: 0 }));
      }
    } catch {
      // ignore
    }
    return DEFAULT_RATES;
  });

  // --- Handlers ---
  const handleRunTransform = async (mode: TextTransformMode) => {
    if (!aiInput.trim()) return;
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    setAiBusy(true);
    setAiErr('');
    try {
      const out = await transformShopTextWithGroq(aiInput, mode);
      setAiOutput(out);
    } catch (e: any) {
      setAiErr(e?.message || 'Groq error');
    } finally {
      setAiBusy(false);
    }
  };

  const handleOcrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    const reader = new FileReader();
    const url: string = await new Promise((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    setOcrImagePreview(url);
    setAiBusy(true);
    setAiErr('');
    try {
      const text = await extractDocumentOcrWithGroq(url);
      setAiOutput(text);
    } catch (err: any) {
      setAiErr(err?.message || 'Vision OCR failed');
    } finally {
      setAiBusy(false);
    }
  };

  const runCompression = async (src: string, kb: number, mw: number) => {
    const img = await loadImageElement(src);
    const res = await compressToTargetKB(img, kb, mw);
    setCompResult(res);
  };

  const handleUploadCompress = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setOrigKB(Math.round((f.size / 1024) * 10) / 10);
    const reader = new FileReader();
    const url: string = await new Promise((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(f);
    });
    setCompSrc(url);
    await runCompression(url, targetKB, maxWidth);
  };

  const billTotal = items.reduce((sum, it) => sum + it.rate * it.qty, 0);

  const saveRatesToStorage = (next: RateItem[]) => {
    setItems(next);
    localStorage.setItem('ik_pos_rates_v1', JSON.stringify(next));
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Sub-tabs */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setTab('ai')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'ai' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Groq AI OCR & Translator
          </button>
          <button
            onClick={() => setTab('compressor')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'compressor' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" /> Online Portal &lt;20KB Compressor
          </button>
          <button
            onClick={() => setTab('pos')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'pos' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" /> IK Computers Bill & Receipt Counter
          </button>
        </div>
      </div>

      {/* TAB 1: GROQ AI OCR & TRANSLATOR */}
      {tab === 'ai' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  AI Urdu/English Document OCR & Smart Translator
                </h3>
                <p className="text-xs text-slate-400">
                  Extract editable Urdu/English text from photographed papers, or convert Roman Urdu
                  ↔ Pure Urdu ↔ Formal English.
                </p>
              </div>
              <label className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow">
                <Camera className="w-4 h-4" /> Upload Document Photo (AI OCR)
                <input type="file" accept="image/*" onChange={handleOcrFile} className="hidden" />
              </label>
            </div>

            {aiErr && (
              <div className="bg-rose-950/60 border border-rose-700 rounded-xl p-3 text-xs text-rose-300">
                {aiErr}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300">
                  Input Text (Roman Urdu / Urdu / English) or OCR Source
                </span>
                {ocrImagePreview && (
                  <img
                    src={ocrImagePreview}
                    alt="OCR Source"
                    className="max-h-36 rounded-lg border border-slate-700 object-contain"
                  />
                )}
                <textarea
                  rows={8}
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="Paste Roman Urdu, English, or rough Urdu notes here..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-amber-400"
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    disabled={aiBusy}
                    onClick={() => handleRunTransform('roman_to_urdu')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                  >
                    Roman → اردو
                  </button>
                  <button
                    disabled={aiBusy}
                    onClick={() => handleRunTransform('en_to_urdu')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                  >
                    English → اردو
                  </button>
                  <button
                    disabled={aiBusy}
                    onClick={() => handleRunTransform('urdu_to_en')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                  >
                    اردو → English
                  </button>
                  <button
                    disabled={aiBusy}
                    onClick={() => handleRunTransform('formalize_urdu')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-xs font-semibold text-emerald-200"
                  >
                    Formalize Official Urdu
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400">
                    {aiBusy ? 'Groq LPU Processing...' : 'AI Result (Editable)'}
                  </span>
                  {aiOutput && (
                    <button
                      onClick={() => {
                        const isUr = /[\u0600-\u06FF]/.test(aiOutput);
                        const html = `<div dir="${isUr ? 'rtl' : 'ltr'}" style="text-align:${
                          isUr ? 'right' : 'left'
                        };">${aiOutput
                          .split('\n')
                          .filter(Boolean)
                          .map((l) => `<p>${l}</p>`)
                          .join('')}</div>`;
                        onSendHtmlToComposer(html);
                      }}
                      className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> Open in Urdu Composer
                    </button>
                  )}
                </div>
                <textarea
                  rows={10}
                  dir={/[\u0600-\u06FF]/.test(aiOutput) ? 'rtl' : 'ltr'}
                  value={aiOutput}
                  onChange={(e) => setAiOutput(e.target.value)}
                  placeholder="AI output or extracted OCR text will appear here..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-base urdu-nastaliq text-white focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PORTAL KB IMAGE COMPRESSOR */}
      {tab === 'compressor' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
            <div>
              <h3 className="text-lg font-bold text-white">
                Online Form Photo & Document KB Compressor
              </h3>
              <p className="text-xs text-slate-400">
                Compress photos to exact KB limits (&lt;20KB, &lt;30KB, &lt;50KB, &lt;100KB) for
                PPSC, FPSC, NTS, NADRA Pak-ID & Passport portals!
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5">
                <Upload className="w-4 h-4" /> Select Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadCompress}
                  className="hidden"
                />
              </label>

              {[15, 20, 30, 50, 100].map((kb) => (
                <button
                  key={kb}
                  onClick={() => {
                    setTargetKB(kb);
                    if (compSrc) runCompression(compSrc, kb, maxWidth);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${
                    targetKB === kb
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-950 border-slate-700 text-slate-300'
                  }`}
                >
                  &le; {kb} KB
                </button>
              ))}

              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>Max Width (px):</span>
                <input
                  type="number"
                  value={maxWidth}
                  onChange={(e) => {
                    const mw = Number(e.target.value) || 600;
                    setMaxWidth(mw);
                    if (compSrc) runCompression(compSrc, targetKB, mw);
                  }}
                  className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white"
                />
              </div>
            </div>

            {compResult && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center bg-slate-950 border border-slate-800 rounded-2xl p-5">
                <div className="flex flex-col items-center">
                  <img
                    src={compResult.dataUrl}
                    alt="Compressed"
                    className="max-h-64 rounded-lg border border-slate-700"
                  />
                </div>
                <div className="space-y-3">
                  <div className="text-sm text-slate-300">
                    Original Size: <strong className="text-rose-400">{origKB} KB</strong>
                  </div>
                  <div className="text-lg font-extrabold text-emerald-400">
                    New Size: {compResult.sizeKB} KB ✓
                  </div>
                  <div className="text-xs text-slate-400">
                    Dimensions: {compResult.width} × {compResult.height} px • JPEG Quality:{' '}
                    {compResult.quality}%
                  </div>
                  <a
                    href={compResult.dataUrl}
                    download={`IK-Portal-${compResult.sizeKB}KB.jpg`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg"
                  >
                    <Download className="w-4 h-4" /> Download {compResult.sizeKB} KB JPG
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: IK COMPUTERS POS COUNTER & RECEIPT PRINTER */}
      {tab === 'pos' && (
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 no-print">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">
                IK Computers Quick Bill Calculator
              </h3>
              <button
                onClick={() => saveRatesToStorage(items.map((x) => ({ ...x, qty: 0 })))}
                className="text-xs text-amber-400 hover:underline"
              >
                Reset Quantities
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer Name"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
              />
              <input
                value={shopPhone}
                onChange={(e) => {
                  setShopPhone(e.target.value);
                  localStorage.setItem('ik_shop_phone', e.target.value);
                }}
                placeholder="IK Computers Phone"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
              />
              <input
                value={shopAddress}
                onChange={(e) => {
                  setShopAddress(e.target.value);
                  localStorage.setItem('ik_shop_addr', e.target.value);
                }}
                placeholder="Shop Address"
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white"
              />
            </div>

            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs"
                >
                  <input
                    value={it.label}
                    onChange={(e) => {
                      const next = items.map((x, i) =>
                        i === idx ? { ...x, label: e.target.value } : x
                      );
                      saveRatesToStorage(next);
                    }}
                    className="col-span-6 bg-transparent text-white font-medium focus:outline-none"
                  />
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="text-slate-500">Rs.</span>
                    <input
                      type="number"
                      value={it.rate}
                      onChange={(e) => {
                        const next = items.map((x, i) =>
                          i === idx ? { ...x, rate: Number(e.target.value) || 0 } : x
                        );
                        saveRatesToStorage(next);
                      }}
                      className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-emerald-300 font-mono"
                    />
                  </div>
                  <div className="col-span-3 flex items-center justify-center gap-1.5">
                    <button
                      onClick={() =>
                        setItems((p) =>
                          p.map((x, i) => (i === idx ? { ...x, qty: Math.max(0, x.qty - 1) } : x))
                        )
                      }
                      className="w-6 h-6 rounded bg-slate-800 text-white font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={it.qty}
                      onChange={(e) =>
                        setItems((p) =>
                          p.map((x, i) =>
                            i === idx ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x
                          )
                        )
                      }
                      className="w-12 text-center bg-slate-900 border border-slate-700 rounded py-1 text-white font-bold"
                    />
                    <button
                      onClick={() =>
                        setItems((p) =>
                          p.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x))
                        )
                      }
                      className="w-6 h-6 rounded bg-emerald-700 text-white font-bold"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => saveRatesToStorage(items.filter((_, i) => i !== idx))}
                    className="col-span-1 text-rose-400 flex justify-end"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() =>
                saveRatesToStorage([
                  ...items,
                  { id: `custom-${Date.now()}`, label: 'Custom Service', rate: 100, qty: 1 },
                ])
              }
              className="text-xs font-semibold text-emerald-400 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Service Row
            </button>
          </div>

          {/* Printable Cash Receipt Preview */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div
              id="ik-print-area"
              className="bg-white text-black w-full max-w-sm rounded-xl shadow-2xl p-6 font-mono text-xs"
            >
              <div className="text-center border-b-2 border-dashed border-slate-400 pb-3 mb-3">
                <h2 className="text-xl font-black tracking-tight">IK COMPUTERS</h2>
                <p className="text-[11px] font-sans font-semibold">
                  Urdu & English Composing • Laser Printing • PDF Studio
                </p>
                <p className="text-[11px]">{shopAddress}</p>
                <p className="text-[11px]">Tel: {shopPhone}</p>
              </div>

              <div className="flex justify-between text-[11px] mb-3">
                <span>Customer: {customerName}</span>
                <span>{new Date().toLocaleDateString()}</span>
              </div>

              <table className="w-full border-collapse mb-3">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th className="py-1">Item</th>
                    <th className="py-1 text-center">Qty</th>
                    <th className="py-1 text-right">Rs.</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter((x) => x.qty > 0)
                    .map((it) => (
                      <tr key={it.id} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2">{it.label}</td>
                        <td className="py-1.5 text-center">{it.qty}</td>
                        <td className="py-1.5 text-right font-bold">{it.rate * it.qty}</td>
                      </tr>
                    ))}
                  {items.every((x) => x.qty === 0) && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-slate-400">
                        Add item quantities on the left...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="border-t-2 border-black pt-2 flex justify-between text-base font-black">
                <span>TOTAL BILL:</span>
                <span>Rs. {billTotal.toLocaleString()}</span>
              </div>

              <p className="text-center text-[11px] mt-4 pt-2 border-t border-dashed border-slate-400">
                شکریہ! آئی کے کمپیوٹرز تشریف لانے کا شکریہ
              </p>
            </div>

            <button
              onClick={() => window.print()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg no-print"
            >
              <Printer className="w-4 h-4" /> Print Cash Receipt
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
