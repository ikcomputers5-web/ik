import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  Printer,
  RefreshCw,
  Smartphone,
  Store,
  Trash2,
  Wifi,
  WifiOff,
  QrCode,
} from 'lucide-react';
import { HybridMobileSync } from '../lib/mobileSync';
import {
  OrderReceiver,
  formatBytes,
  type IncomingOrder,
} from '../lib/orderSync';

interface ScanOrderStationProps {
  onOpenFile: (file: File) => void;
}

interface LanIp {
  name: string;
  address: string;
}

const randomRoom = () =>
  String(Math.floor(1000 + Math.random() * 9000));

export const ScanOrderStation: React.FC<ScanOrderStationProps> = ({ onOpenFile }) => {
  const [room, setRoom] = useState<string>(
    () => localStorage.getItem('ik_order_room') || randomRoom()
  );
  const [qr, setQr] = useState<string>('');
  const [linkMode, setLinkMode] = useState<string>('auto');
  const [lanIps, setLanIps] = useState<LanIp[]>([]);
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState('Standby');
  const [orders, setOrders] = useState<IncomingOrder[]>([]);
  const [message, setMessage] = useState<string>('');

  const syncRef = useRef<HybridMobileSync | null>(null);
  const receiverRef = useRef<OrderReceiver | null>(null);

  // Remember the station's room code so a printed sticker keeps working.
  useEffect(() => {
    localStorage.setItem('ik_order_room', room);
  }, [room]);

  // LAN addresses let the QR work even when the shop PC has no internet.
  useEffect(() => {
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((data) => setLanIps(Array.isArray(data?.lanIps) ? data.lanIps : []))
      .catch(() => setLanIps([]));
  }, []);

  const orderUrl = useMemo(() => {
    const base =
      linkMode === 'auto'
        ? window.location.origin
        : linkMode === 'lan'
        ? `http://${lanIps[0]?.address || window.location.hostname}:${window.location.port || 5173}`
        : linkMode;
    return `${base}/?order=${room}`;
  }, [linkMode, lanIps, room]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(orderUrl, { width: 420, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr('');
      });
    return () => {
      cancelled = true;
    };
  }, [orderUrl]);

  // Desktop side of the transport
  useEffect(() => {
    const receiver = new OrderReceiver({
      onNew: (order) => {
        setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
        setMessage(`${order.name} is sending “${order.fileName}”…`);
      },
      onProgress: (order) => {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...order } : o)));
      },
      onComplete: (order) => {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...order } : o)));
        setMessage(`✅ ${order.fileName} received from ${order.name}.`);
        try {
          syncRef.current?.send({ type: 'order_done', orderId: order.id });
        } catch {
          /* ignore */
        }
      },
      onError: (order, msg) => {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...order } : o)));
        setMessage(msg);
      },
    });
    receiverRef.current = receiver;

    const sync = new HybridMobileSync({
      // Same namespaced room the customer page uses (never clashes with the keyboard room).
      room: `ORD${room}`,
      role: 'desktop',
      onStatusChange: ({ connected: ok, transport: t }) => {
        setConnected(ok);
        setTransport(t);
      },
      onMessage: (msg) => receiver.handle(msg),
    });
    syncRef.current = sync;

    return () => {
      receiver.dispose();
      receiverRef.current = null;
      sync.destroy();
      syncRef.current = null;
    };
  }, [room]);

  const removeOrder = (id: string) => {
    setOrders((prev) => {
      const target = prev.find((o) => o.id === id);
      if (target?.url) {
        try {
          URL.revokeObjectURL(target.url);
        } catch {
          /* ignore */
        }
      }
      return prev.filter((o) => o.id !== id);
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(orderUrl);
      setMessage('Order link copied — send it on WhatsApp if the customer is not in the shop.');
    } catch {
      setMessage('Could not copy the link on this browser.');
    }
  };

  const printSticker = () => {
    if (!qr) return;
    const win = window.open('', '_blank', 'width=520,height=720');
    if (!win) {
      setMessage('Allow pop-ups to print the QR sticker.');
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>IK Computers — Scan &amp; Order</title>
      <style>
        @page { size: A5; margin: 10mm; }
        body { font-family: Inter, Arial, sans-serif; text-align: center; color: #0f172a; margin: 0; }
        .card { border: 3px solid #047857; border-radius: 16px; padding: 18px; }
        h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: .5px; }
        h2 { font-size: 13px; font-weight: 600; color: #047857; margin: 0 0 12px; }
        img { width: 260px; height: 260px; image-rendering: pixelated; }
        p { font-size: 12px; color: #334155; margin: 8px 0 0; line-height: 1.5; }
        .urdu { font-size: 15px; direction: rtl; margin-top: 6px; }
        .code { font-family: monospace; font-size: 13px; margin-top: 6px; color: #065f46; font-weight: 700; }
      </style></head><body>
      <div class="card">
        <h1>IK COMPUTERS</h1>
        <h2>Scan &amp; Order — فائل بھیجیں</h2>
        <img src="${qr}" alt="QR" />
        <p><strong>Scan this code and send your file</strong><br/>Print · Photostat · Composing · Passport Photos</p>
        <p class="urdu">اپنی فائل اسکوین کریں — فوٹو کاپی، پرنٹ، کمپوزنگ، پاسپورٹ فوٹو</p>
        <div class="code">Station #${room}</div>
      </div>
      </body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 350);
  };

  const readyCount = orders.filter((o) => o.status === 'ready').length;

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white leading-tight">
              Scan &amp; Order Station
            </h2>
            <p className="text-[11px] text-slate-400 leading-tight">
              کسٹمر کا QR اسکین — فائل سیدھی اس کمپیوٹر پر
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 ${
              connected
                ? 'bg-emerald-950/70 border border-emerald-700 text-emerald-300'
                : 'bg-amber-950/60 border border-amber-700 text-amber-300'
            }`}
          >
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connected ? transport : 'Waiting for phone'}
          </div>
          {readyCount > 0 && (
            <span className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold">
              {readyCount} new
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className="px-4 py-2 bg-slate-900/70 border-b border-slate-800 text-[11.5px] text-slate-300 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{message}</span>
          <button
            onClick={() => setMessage('')}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 font-semibold"
          >
            dismiss
          </button>
        </div>
      )}

      <div className="p-4 grid lg:grid-cols-[340px_1fr] gap-4 items-start max-w-6xl w-full mx-auto">
        {/* QR card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Customer scans this
          </div>

          <div className="bg-white rounded-xl p-3 flex flex-col items-center">
            {qr ? (
              <img src={qr} alt="Scan & Order QR code" className="w-52 h-52" />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
              </div>
            )}
            <div className="text-center mt-1.5">
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
              onChange={(e) => setLinkMode(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200 outline-none"
            >
              <option value="auto">This site ({window.location.origin})</option>
              {lanIps.length > 0 && <option value="lan">Shop Wi-Fi ({lanIps[0].address}) — works offline</option>}
              {lanIps.slice(1).map((ip) => (
                <option key={ip.address} value={`http://${ip.address}:${window.location.port || 5173}`}>
                  {ip.name} ({ip.address})
                </option>
              ))}
            </select>
            <div className="text-[9.5px] text-slate-500 font-mono break-all leading-snug">{orderUrl}</div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={printSticker}
              className="px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print sticker
            </button>
            <button
              onClick={copyLink}
              className="px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" /> Copy link
            </button>
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
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
              title="New station code"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            Print this QR once and stick it on the counter. The customer scans it with their phone camera,
            picks a service and sends the file — it appears on the right instantly. No app, no WhatsApp,
            no cable.
          </p>
        </div>

        {/* Incoming queue */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Incoming files ({orders.length})
            </div>
            {orders.some((o) => o.status === 'ready') && (
              <button
                onClick={() => orders.filter((o) => o.status === 'ready').forEach((o) => removeOrder(o.id))}
                className="text-[10px] text-slate-500 hover:text-rose-300 font-semibold"
              >
                clear received
              </button>
            )}
          </div>

          {orders.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
              <Smartphone className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <div className="text-xs font-bold text-slate-300">No orders yet</div>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                When a customer scans the QR code and sends a file, it appears here with their name, phone
                number and the service they asked for — plus a one-click hand-off to the PDF editor or the
                Image&nbsp;→&nbsp;PDF cleaner.
              </p>
            </div>
          )}

          {orders.map((order) => {
            const isImage = (order.mime || '').startsWith('image/');
            const progress =
              order.status === 'ready'
                ? 100
                : Math.round((order.receivedChunks / Math.max(1, order.totalChunks)) * 100);

            return (
              <div
                key={order.id}
                className={`rounded-2xl border p-3 transition ${
                  order.status === 'error'
                    ? 'bg-rose-950/30 border-rose-800'
                    : order.status === 'ready'
                    ? 'bg-emerald-950/20 border-emerald-800/70'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                    {order.url && isImage ? (
                      <img src={order.url} alt={order.fileName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-emerald-400">
                        {isImage ? <ImagePlus className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white truncate max-w-[240px]">
                        {order.fileName}
                      </span>
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold">
                        {order.serviceLabel}
                      </span>
                      <span className="text-[9.5px] text-slate-500">{formatBytes(order.size)}</span>
                    </div>

                    <div className="text-[11px] text-slate-300 mt-0.5">
                      <Store className="w-3 h-3 inline mr-1 text-slate-500" />
                      {order.name}
                      {order.phone && (
                        <a href={`tel:${order.phone}`} className="text-emerald-300 hover:underline ml-2">
                          {order.phone}
                        </a>
                      )}
                    </div>

                    {order.notes && (
                      <div className="text-[10.5px] text-slate-400 mt-1 line-clamp-2" dir="auto">
                        “{order.notes}”
                      </div>
                    )}

                    {order.status === 'receiving' && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                          <span className="flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> Receiving…
                          </span>
                          <span className="font-mono">{progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {order.status === 'error' && (
                      <div className="text-[10.5px] text-rose-300 mt-1.5">{order.error}</div>
                    )}

                    {order.status === 'ready' && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <button
                          onClick={() => order.file && onOpenFile(order.file)}
                          className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {isImage ? 'Open in Image→PDF' : 'Open in PDF Editor'}
                        </button>
                        {order.url && (
                          <>
                            <a
                              href={order.url}
                              download={order.fileName}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10.5px] font-bold flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> Save
                            </a>
                            <a
                              href={order.url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10.5px] font-bold flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> View
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => removeOrder(order.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-rose-300 shrink-0"
                    title="Remove from list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3 text-[10.5px] text-slate-500 leading-relaxed">
            Files stay only in this browser tab while the shop PC is open. Save anything you need to keep
            before refreshing or closing the page. Maximum file size is 25 MB per order.
          </div>
        </div>
      </div>
    </div>
  );
};
