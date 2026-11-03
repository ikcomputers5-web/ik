import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Printer,
  RefreshCw,
  Signal,
  ShieldCheck,
  Radio,
  Info,
  ArrowRight,
  Keyboard,
  FileUp,
  ScanLine,
} from 'lucide-react';
import { HybridMobileSync, type SyncStatus } from '../lib/mobileSync';

interface LanIp {
  name: string;
  address: string;
}

const randomRoom = () => String(Math.floor(1000 + Math.random() * 9000));

type PairMode = 'keyboard' | 'order';

export const MobileConnectHub: React.FC = () => {
  const [room, setRoom] = useState<string>(
    () => localStorage.getItem('ik_connect_room') || randomRoom()
  );
  const [mode, setMode] = useState<PairMode>('keyboard');
  const [linkMode, setLinkMode] = useState<'auto' | 'lan' | 'custom'>('auto');
  const [customBase, setCustomBase] = useState('');
  const [lanIps, setLanIps] = useState<LanIp[]>([]);
  const [port, setPort] = useState(window.location.port || '5173');
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<SyncStatus>({
    connected: false,
    peerCount: 0,
    transport: 'Standby',
    latency: null,
  });
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [secureContext, setSecureContext] = useState(true);

  const syncRef = useRef<HybridMobileSync | null>(null);

  useEffect(() => {
    localStorage.setItem('ik_connect_room', room);
  }, [room]);

  useEffect(() => {
    // getUserMedia / WebRTC need HTTPS or localhost. Warn honestly when it is not.
    const host = window.location.hostname;
    setSecureContext(
      window.isSecureContext || host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)
    );
  }, []);

  useEffect(() => {
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((data) => {
        setLanIps(Array.isArray(data?.lanIps) ? data.lanIps : []);
        if (data?.port) setPort(String(data.port));
      })
      .catch(() => setLanIps([]));
  }, []);

  const baseUrl = useMemo(() => {
    if (linkMode === 'custom' && customBase.trim()) return customBase.trim().replace(/\/$/, '');
    if (linkMode === 'lan' && lanIps[0]?.address) {
      const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${proto}//${lanIps[0].address}:${port}`;
    }
    return window.location.origin;
  }, [linkMode, customBase, lanIps, port]);

  const phoneUrl = useMemo(() => {
    const suffix = mode === 'keyboard' ? `?mobile=${room}` : `?order=${room}`;
    return `${baseUrl}/${suffix}`;
  }, [baseUrl, mode, room]);

  useEffect(() => {
    QRCode.toDataURL(phoneUrl, {
      width: 420,
      margin: 2,
      color: { dark: '#022c22', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [phoneUrl]);

  // A desktop presence in the same room, so the phone can see it is reachable.
  useEffect(() => {
    const roomName = mode === 'order' ? `ORD${room}` : room;
    const sync = new HybridMobileSync({
      room: roomName,
      role: 'desktop',
      onStatusChange: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'client_info') {
          const label = msg.device || 'Phone';
          setPhones((prev) => (prev.includes(label) ? prev : [...prev, label].slice(-4)));
        }
      },
    });
    syncRef.current = sync;
    return () => {
      sync.destroy();
      syncRef.current = null;
    };
  }, [room, mode]);

  const runDiagnostics = async () => {
    setTesting(true);
    try {
      await syncRef.current?.probe(5000);
    } finally {
      setTesting(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const printSticker = () => {
    if (!qr) return;
    const win = window.open('', '_blank', 'width=520,height=720');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>IK Computers — Connect Phone</title>
      <style>@page{size:A6;margin:8mm}
      body{font-family:Inter,Arial,sans-serif;text-align:center;color:#0f172a;margin:0}
      .card{border:3px solid #047857;border-radius:16px;padding:16px}
      h1{font-size:20px;margin:0 0 2px;letter-spacing:.5px}
      h2{font-size:12px;font-weight:600;color:#047857;margin:0 0 10px}
      img{width:250px;height:250px}
      p{font-size:11.5px;color:#334155;margin:6px 0 0;line-height:1.5}
      .urdu{font-size:14px;direction:rtl;margin-top:6px}
      .code{font-family:monospace;font-size:12px;color:#065f46;font-weight:700;margin-top:6px}</style></head><body>
      <div class="card">
        <h1>IK COMPUTERS</h1>
        <h2>${mode === 'keyboard' ? 'Scan to type Urdu on your phone' : 'Scan to send your file'}</h2>
        <img src="${qr}" alt="QR"/>
        <p><strong>${mode === 'keyboard' ? 'Opens the mobile Urdu keyboard pad' : 'Opens the file upload page'}</strong><br/>
        Shop Wi-Fi or mobile data · no app needed</p>
        <p class="urdu">${mode === 'keyboard' ? 'موبائل سے اردو لکھیں' : 'موبائل سے فائل بھیجیں'}</p>
        <div class="code">Station #${room}</div>
      </div></body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 320);
  };

  const checks = [
    {
      ok: secureContext,
      label: 'Secure page (HTTPS or shop IP)',
      hint: 'WebRTC needs HTTPS. Use the Vercel link or the shop Wi-Fi IP — not a bare http:// domain.',
    },
    {
      ok: status.connected,
      label: 'Phone linked right now',
      hint: 'Open the QR link on the phone and keep the page in the foreground.',
    },
    {
      ok: lanIps.length > 0,
      label: 'Shop Wi-Fi address detected',
      hint: 'Run the app with `npm run dev` on the shop PC to expose the LAN address.',
    },
    {
      ok: navigator.onLine,
      label: 'Computer online (for cloud pairing)',
      hint: 'Offline is fine on shop Wi-Fi; online pairing also works over 4G.',
    },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
          <Radio className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-white leading-tight">Connect a Phone</h2>
          <p className="text-[11px] text-slate-400 leading-tight">
            موبائل کنیکٹ کریں — live link between the counter PC and any customer phone
          </p>
        </div>

        <div
          className={`ml-auto px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 border ${
            status.connected
              ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
              : 'bg-amber-950/60 border-amber-700 text-amber-300'
          }`}
        >
          {status.connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {status.connected
            ? `${status.peerCount} device${status.peerCount > 1 ? 's' : ''} · ${status.transport}${
                status.latency ? ` · ${status.latency} ms` : ''
              }`
            : 'No phone connected'}
        </div>
      </div>

      <div className="p-4 grid lg:grid-cols-[360px_1fr] gap-4 max-w-6xl w-full mx-auto">
        {/* Left: pairing card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 h-fit">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setMode('keyboard')}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                mode === 'keyboard' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" /> Urdu keyboard
            </button>
            <button
              onClick={() => setMode('order')}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                mode === 'order' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              <FileUp className="w-3.5 h-3.5" /> Send a file
            </button>
          </div>

          <div className="bg-white rounded-xl p-3 flex flex-col items-center">
            {qr ? (
              <img src={qr} alt="Pairing QR" className="w-52 h-52" />
            ) : (
              <div className="w-52 h-52" />
            )}
            <div className="text-center mt-1">
              <div className="text-[11px] font-extrabold text-slate-900">IK COMPUTERS</div>
              <div className="text-[9.5px] text-emerald-700 font-bold">Station #{room}</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              QR link target
            </label>
            <select
              value={linkMode}
              onChange={(e) => setLinkMode(e.target.value as any)}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200 outline-none"
            >
              <option value="auto">This site ({window.location.origin})</option>
              {lanIps.map((ip) => (
                <option key={ip.address} value="lan">
                  Shop Wi-Fi ({ip.name}: {ip.address})
                </option>
              ))}
              <option value="custom">Custom address…</option>
            </select>
            {linkMode === 'custom' && (
              <input
                value={customBase}
                onChange={(e) => setCustomBase(e.target.value)}
                placeholder="https://your-shop.vercel.app"
                className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-white outline-none focus:border-emerald-500"
              />
            )}
            <div className="flex items-center gap-1.5">
              <input
                value={phoneUrl}
                readOnly
                className="flex-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[10px] font-mono text-emerald-300 outline-none"
              />
              <button
                onClick={copy}
                className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 6).toUpperCase())}
              className="flex-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-white font-mono outline-none focus:border-emerald-500"
              placeholder="Station code"
            />
            <button
              onClick={() => setRoom(randomRoom())}
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300"
              title="New station code"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={printSticker}
              className="px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print sticker
            </button>
            <a
              href={phoneUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1"
            >
              <Smartphone className="w-3.5 h-3.5" /> Open on this PC
            </a>
          </div>
        </div>

        {/* Right: diagnostics & explains */}
        <div className="space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Connection check
              </h3>
              <button
                onClick={runDiagnostics}
                disabled={testing}
                className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"
              >
                <Signal className={`w-3 h-3 ${testing ? 'animate-pulse' : ''}`} />
                {testing ? 'Testing…' : 'Test latency'}
              </button>
            </div>

            <div className="space-y-1.5">
              {checks.map((c) => (
                <div
                  key={c.label}
                  className={`rounded-lg border px-2.5 py-1.5 ${
                    c.ok
                      ? 'bg-emerald-950/30 border-emerald-800/60'
                      : 'bg-amber-950/25 border-amber-800/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    {c.ok ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Info className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span className={c.ok ? 'text-emerald-200' : 'text-amber-200'}>{c.label}</span>
                  </div>
                  {!c.ok && <div className="text-[10.5px] text-slate-400 mt-0.5 pl-5">{c.hint}</div>}
                </div>
              ))}
            </div>

            {phones.length > 0 && (
              <div className="text-[10.5px] text-slate-400">
                Seen on this station:{' '}
                <span className="text-slate-200 font-semibold">{phones.join(', ')}</span>
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-white">How the link works</h3>
            <div className="grid sm:grid-cols-3 gap-2">
              {[
                {
                  icon: Wifi,
                  title: 'Shop Wi-Fi',
                  text: 'Both devices on the same router: instant, works with the internet down.',
                },
                {
                  icon: Radio,
                  title: 'WebRTC cloud',
                  text: 'Phone on 4G and PC on Wi-Fi: pairs directly, nothing is uploaded to a server.',
                },
                {
                  icon: ScanLine,
                  title: 'Same device',
                  text: 'Two browser tabs on one PC stay in sync as a fallback.',
                },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                    <Icon className="w-3.5 h-3.5" /> {title}
                  </div>
                  <p className="text-[10.5px] text-slate-400 mt-0.5 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
            <p className="text-[10.5px] text-slate-500 leading-relaxed">
              A phone reaches the PC through the QR link. Keep this page open on the counter PC — that is the
              only requirement. If a strict office firewall blocks the direct link, add a TURN server address
              in the app settings to relay through the internet.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <a
              href={`${window.location.origin}/?mobile=${room}`}
              target="_blank"
              rel="noreferrer"
              className="bg-slate-900 border border-slate-800 hover:border-emerald-600 rounded-xl p-3 flex items-center gap-2"
            >
              <Keyboard className="w-4 h-4 text-emerald-400" />
              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-white">Open Urdu keyboard pad</div>
                <div className="text-[10px] text-slate-400">Test it right here in a new tab</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 ml-auto" />
            </a>
            <a
              href={`${window.location.origin}/?order=${room}`}
              target="_blank"
              rel="noreferrer"
              className="bg-slate-900 border border-slate-800 hover:border-emerald-600 rounded-xl p-3 flex items-center gap-2"
            >
              <FileUp className="w-4 h-4 text-sky-400" />
              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-white">Open customer file page</div>
                <div className="text-[10px] text-slate-400">Same page the customer scans</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 ml-auto" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileConnectHub;
