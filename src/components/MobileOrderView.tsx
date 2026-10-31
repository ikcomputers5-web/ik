import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
  X,
  AlertTriangle,
  Store,
} from 'lucide-react';
import { HybridMobileSync } from '../lib/mobileSync';
import {
  MAX_ORDER_BYTES,
  ORDER_SERVICES,
  formatBytes,
  sendOrderWithFile,
} from '../lib/orderSync';

interface MobileOrderViewProps {
  initialRoom: string;
  onExitMobileMode?: () => void;
}

type Stage = 'form' | 'sending' | 'sent';

export const MobileOrderView: React.FC<MobileOrderViewProps> = ({ initialRoom, onExitMobileMode }) => {
  const room = useMemo(() => initialRoom.trim().toUpperCase(), [initialRoom]);
  // Separate namespace from the mobile-keyboard room so both can be open at once.
  const syncRoom = useMemo(() => `ORD${room}`, [room]);

  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState('Connecting…');

  const [service, setService] = useState<string>(ORDER_SERVICES[0].id);
  const [name, setName] = useState(() => localStorage.getItem('ik_order_name') || '');
  const [phone, setPhone] = useState(() => localStorage.getItem('ik_order_phone') || '');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const [stage, setStage] = useState<Stage>('form');
  const [progress, setProgress] = useState(0);
  const [sentSummary, setSentSummary] = useState<{ fileName: string; service: string; size: number } | null>(null);
  const [error, setError] = useState('');

  const syncRef = useRef<HybridMobileSync | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = new HybridMobileSync({
      room: syncRoom,
      role: 'mobile',
      onStatusChange: ({ connected: ok, transport: t }) => {
        setConnected(ok);
        setTransport(t);
      },
      onMessage: (msg) => {
        if (msg.type === 'order_done') {
          setStage('sent');
          setProgress(100);
        }
      },
    });
    syncRef.current = sync;
    return () => {
      sync.destroy();
    };
  }, [syncRoom]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const activeService = ORDER_SERVICES.find((s) => s.id === service) || ORDER_SERVICES[0];
  const accept =
    activeService.accepts === 'pdf' ? 'application/pdf' : activeService.accepts === 'image' ? 'image/*' : 'application/pdf,image/*';

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    if (f.size > MAX_ORDER_BYTES) {
      setFile(null);
      setError(`This file is ${formatBytes(f.size)}. Maximum is ${formatBytes(MAX_ORDER_BYTES)}.`);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };

  const submit = async () => {
    if (!connected) {
      setError(
        'Not connected to the shop computer yet. Please ask the shopkeeper, or wait a few seconds and try again.'
      );
      return;
    }
    if (!file) {
      setError('Choose the file you want printed or edited first.');
      return;
    }
    if (!syncRef.current) {
      setError('Connection is not ready yet. Please wait a moment and try again.');
      return;
    }
    setError('');
    setStage('sending');
    setProgress(0);
    localStorage.setItem('ik_order_name', name.trim());
    localStorage.setItem('ik_order_phone', phone.trim());
    try {
      await sendOrderWithFile(
        syncRef.current,
        { name, phone, service, notes },
        file,
        (sent, total) => setProgress(Math.round((sent / total) * 100))
      );
      setSentSummary({ fileName: file.name, service: activeService.label, size: file.size });
      // Stay on "sending" until the shop PC confirms, but do not trap the customer.
      setTimeout(() => setStage((s) => (s === 'sending' ? 'sent' : s)), 4000);
    } catch (err: any) {
      setStage('form');
      setError(String(err?.message || 'Could not send the file. Please try again.'));
    }
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setNotes('');
    setStage('form');
    setProgress(0);
    setSentSummary(null);
    setError('');
  };

  if (stage === 'sent' && sentSummary) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <div className="flex-1 flex items-center justify-center p-5">
          <div className="w-full max-w-sm text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-11 h-11" />
            </div>
            <h1 className="text-xl font-extrabold text-white">Sent to IK Computers</h1>
            <p className="urdu-nastaliq text-emerald-400 text-base mt-1 mb-3">فائل دکان تک پہنچ گئی ہے</p>
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-left text-xs space-y-1.5 mb-5">
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">File</span>
                <span className="text-slate-100 font-semibold truncate max-w-[65%] text-right">
                  {sentSummary.fileName}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Service</span>
                <span className="text-slate-100 font-semibold">{sentSummary.service}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400">Size</span>
                <span className="text-slate-100 font-semibold">{formatBytes(sentSummary.size)}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-5">
              The shop will call your number when the work is ready. You can close this page now.
            </p>
            <button
              onClick={reset}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
            >
              Send Another File
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Shop header */}
      <div className="bg-gradient-to-r from-emerald-700 to-teal-800 px-4 py-3 flex items-center gap-3 shadow-lg">
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
          <Store className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-white text-sm leading-tight">IK COMPUTERS</div>
          <div className="text-[11px] text-emerald-100 leading-tight">Scan &amp; Order · فائل بھیجیں</div>
        </div>
        {onExitMobileMode && (
          <button
            onClick={onExitMobileMode}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            title="Exit"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Connection strip */}
      <div
        className={`px-4 py-2 text-[11px] font-semibold flex items-center gap-1.5 ${
          connected ? 'bg-emerald-950/60 text-emerald-300' : 'bg-amber-950/50 text-amber-300'
        }`}
      >
        {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
        {connected ? `Connected to shop PC · ${transport}` : 'Connecting to the shop computer…'}
        <span className="ml-auto font-mono text-[10px] opacity-70">#{room}</span>
      </div>

      <div className="flex-1 p-4 space-y-4 pb-8">
        {/* Service */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
            What do you need?
          </label>
          <div className="grid grid-cols-2 gap-2">
            {ORDER_SERVICES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setService(s.id);
                  setFile(null);
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl('');
                }}
                className={`text-left px-3 py-2.5 rounded-xl border transition ${
                  service === s.id
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <div className="text-[11.5px] font-bold leading-tight">{s.label}</div>
                <div
                  className={`urdu-naskh text-[10.5px] mt-0.5 ${
                    service === s.id ? 'text-emerald-100' : 'text-slate-500'
                  }`}
                >
                  {s.urdu}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* File */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
            Your file
          </label>
          <input ref={fileInputRef} type="file" accept={accept} onChange={pickFile} className="hidden" />
          {!file ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl py-7 flex flex-col items-center gap-2"
            >
              <FileUp className="w-7 h-7 text-emerald-400" />
              <span className="text-xs font-bold text-white">Choose file from phone</span>
              <span className="text-[10.5px] text-slate-400">
                {activeService.accepts === 'pdf'
                  ? 'PDF up to 25 MB'
                  : activeService.accepts === 'image'
                  ? 'Photo / scan up to 25 MB'
                  : 'PDF or photo up to 25 MB'}
              </span>
            </button>
          ) : (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3 flex items-center gap-3">
              {previewUrl ? (
                <img src={previewUrl} alt="preview" className="w-14 h-14 rounded-lg object-cover bg-white" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
                  <FileUp className="w-6 h-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">{file.name}</div>
                <div className="text-[10.5px] text-slate-400">{formatBytes(file.size)}</div>
              </div>
              <button
                onClick={() => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl('');
                  setFile(null);
                }}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Customer details */}
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
              Your name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Naam / نام"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
              Mobile number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="03xx-xxxxxxx"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
              Instructions (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              dir="auto"
              placeholder="e.g. 2 colour copies, name change karna hai…"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-500 resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-rose-950/60 border border-rose-800 px-3 py-2.5 text-[11.5px] text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {stage === 'sending' && (
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
            <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" /> Sending to shop…
              </span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Keep this page open until it finishes. Do not lock the phone screen.
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={stage === 'sending' || !file || !connected}
          className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
        >
          {stage === 'sending' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Sending…
            </>
          ) : !connected ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Waiting for shop computer…
            </>
          ) : (
            <>
              <Send className="w-4 h-4" /> Send to IK Computers
            </>
          )}
        </button>

        <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center">
          <Smartphone className="w-3 h-3" />
          <span>No app needed · your file goes straight to the shop counter</span>
        </div>
      </div>
    </div>
  );
};
