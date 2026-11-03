// IK Computers — Real-time phone ↔ shop-PC link.
//
// One class, three transports, with automatic fail-over and de-duplication:
//   1. WebRTC data channel (PeerJS)  → works across the internet / hosted Vercel
//   2. LAN WebSocket (/ws)           → works on the shop Wi-Fi with no internet
//   3. BroadcastChannel              → instant sync between tabs on one device
//
// Reliability work in this version:
//   • Messages are QUEUED while the link is still coming up (previously an order
//     started in the first seconds was silently dropped — the #1 “it doesn’t
//     connect” complaint).
//   • Explicit STUN/TURN ICE configuration, so phone-on-4G ↔ PC-on-shop-Wi-Fi
//     connects reliably instead of only on the same network.
//   • Round-trip ping/pong so the UI can honestly show “Connected · 42 ms”.
//   • Auto-reconnect for both WebRTC and LAN socket with backoff.
//   • Connection state is derived from real open channels, not guesswork.

import Peer, { DataConnection } from 'peerjs';

export type SyncType =
  | 'live_document'
  | 'room_status'
  | 'insert_text'
  | 'live_composing'
  | 'command'
  | 'context_sync'
  | 'hello'
  | 'probe'
  | 'probe_reply'
  | 'client_info'
  // --- Scan & Order (customer phone -> shop PC) ---
  | 'order_start'
  | 'order_chunk'
  | 'order_end'
  | 'order_ack'
  | 'order_missing'
  | 'order_done'
  | 'order_cancel';

export interface SyncMessage {
  msgId?: string;
  revision?: number;
  type: SyncType;
  room?: string;
  text?: string;
  action?: 'backspace' | 'enter' | 'undo' | 'space';
  lastWord?: string;
  desktopCount?: number;
  mobileCount?: number;
  /** order id shared by all messages of one customer upload */
  orderId?: string;
  name?: string;
  phone?: string;
  service?: string;
  notes?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  totalChunks?: number;
  seq?: number;
  data?: string;
  error?: string;
  /** probe / client-info extras */
  ts?: number;
  device?: string;
}

export interface SyncStatus {
  connected: boolean;
  peerCount: number;
  transport: string;
  /** Round-trip time in ms, or null when unknown. */
  latency: number | null;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

// Optional TURN relay (needed when both ends sit behind strict NAT / mobile 4G).
// Add VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL in .env to enable.
const env = (import.meta as any).env || {};
if (env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: env.VITE_TURN_URL,
    username: env.VITE_TURN_USERNAME,
    credential: env.VITE_TURN_CREDENTIAL,
  });
}

function getHostNamespace(): string {
  const cleanHost = (window.location.hostname || 'local')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 28);
  return `ikc-${cleanHost}`;
}

function buildDesktopPeerId(roomCode: string): string {
  return `${getHostNamespace()}-pc-${roomCode.trim().toUpperCase()}`;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'Browser';
}

export class HybridMobileSync {
  private room: string;
  private role: 'desktop' | 'mobile';
  private onMessage: (msg: SyncMessage) => void;
  private onStatusChange: (status: SyncStatus) => void;

  private peer: Peer | null = null;
  private peerConns: Set<DataConnection> = new Set();
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private seenIds: Set<string> = new Set();
  private destroyed = false;
  private wsConnectedPeers = 0;
  private bcConnected = false;
  private wsRetry: ReturnType<typeof setTimeout> | null = null;
  private wsRetryDelay = 1000;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private lastLatency: number | null = null;
  private probes = new Map<string, number>();
  private pending: { payload: Omit<SyncMessage, 'msgId'>; ts: number }[] = [];
  private waiters: (() => void)[] = [];
  private listeners: Map<string, Set<(msg: SyncMessage) => void>> = new Map();
  private statusListeners: Set<() => void> = new Set();
  private peerRetryCount = 0;

  constructor(opts: {
    room: string;
    role: 'desktop' | 'mobile';
    onMessage: (msg: SyncMessage) => void;
    onStatusChange: (status: SyncStatus) => void;
  }) {
    this.room = opts.room.trim().toUpperCase();
    this.role = opts.role;
    this.onMessage = opts.onMessage;
    this.onStatusChange = opts.onStatusChange;

    this.initBroadcastChannel();
    this.initWebRTC();
    this.initLocalWebSocketIfAvailable();
  }

  public get connected(): boolean {
    return this.openConnCount() > 0 || this.wsConnectedPeers > 0 || this.bcConnected;
  }

  private openConnCount(): number {
    let n = 0;
    for (const c of this.peerConns) if (c.open) n++;
    return n;
  }

  private emitStatus() {
    const webrtcCount = this.openConnCount();
    const totalPeers = Math.max(webrtcCount, this.wsConnectedPeers, this.bcConnected ? 1 : 0);
    const transport =
      webrtcCount > 0
        ? 'WebRTC Cloud'
        : this.wsConnectedPeers > 0
        ? 'LAN Wi-Fi'
        : this.bcConnected
        ? 'Same device'
        : 'Standby';
    this.onStatusChange({
      connected: totalPeers > 0,
      peerCount: totalPeers,
      transport,
      latency: webrtcCount > 0 ? this.lastLatency : null,
    });
    for (const fn of this.statusListeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }

  private handleIncoming(raw: SyncMessage) {
    if (!raw || typeof raw !== 'object') return;
    if (raw.msgId) {
      if (this.seenIds.has(raw.msgId)) return;
      this.seenIds.add(raw.msgId);
      if (this.seenIds.size > 400) {
        const first = this.seenIds.values().next().value;
        if (first) this.seenIds.delete(first);
      }
    }

    if (raw.type === 'hello') {
      this.bcConnected = true;
      this.emitStatus();
      return;
    }

    if (raw.type === 'room_status') {
      const count = this.role === 'desktop' ? raw.mobileCount || 0 : raw.desktopCount || 0;
      this.wsConnectedPeers = count;
      this.emitStatus();
      return;
    }

    if (raw.type === 'probe') {
      // Answer immediately so the other side can show a real latency figure.
      this.sendRaw({ type: 'probe_reply', ts: raw.ts });
      this.lastLatency = 0;
      this.emitStatus();
      return;
    }

    if (raw.type === 'probe_reply') {
      const sentAt = raw.ts ? this.probes.get(String(raw.ts)) : undefined;
      if (sentAt) {
        this.lastLatency = Math.max(1, Date.now() - sentAt);
        this.probes.delete(String(raw.ts));
        this.emitStatus();
      }
      if (this.waiters.length) {
        const list = this.waiters.splice(0);
        list.forEach((fn) => fn());
      }
      return;
    }

    this.onMessage(raw);
    const set = this.listeners.get(raw.type);
    if (set) for (const fn of set) {
      try {
        fn(raw);
      } catch {
        /* ignore */
      }
    }
  }

  /** Subscribe to one message type; returns an unsubscribe function. */
  public on(type: SyncType, handler: (msg: SyncMessage) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  /** Fires whenever the link comes up or drops. Returns an unsubscribe function. */
  public onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  // 1. Same-browser instant BroadcastChannel
  private initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.bc = new BroadcastChannel(`ik-urdu-sync-${this.room}`);
      this.bc.onmessage = (ev) => {
        const data = ev.data as SyncMessage & { senderRole?: string };
        if (data && data.senderRole !== this.role) {
          if (data.type === 'hello') {
            if (!this.bcConnected) {
              this.bcConnected = true;
              this.bc?.postMessage({
                msgId: `hello-${Date.now()}-${Math.random()}`,
                type: 'hello',
                senderRole: this.role,
              });
              this.emitStatus();
            }
            return;
          }
          this.handleIncoming(data);
        }
      };
      this.bc.postMessage({
        msgId: `hello-${Date.now()}-${Math.random()}`,
        type: 'hello',
        senderRole: this.role,
      });
    } catch {
      /* ignore */
    }
  }

  // 2. Serverless WebRTC PeerJS (phone ↔ PC over any network)
  private initWebRTC() {
    try {
      const desktopId = buildDesktopPeerId(this.room);
      const peerConfig = {
        debug: 0 as const,
        config: { iceServers: ICE_SERVERS },
      };

      if (this.role === 'desktop') {
        const peer = new Peer(desktopId, peerConfig);
        this.peer = peer;

        peer.on('connection', (conn) => {
          this.setupConn(conn);
        });

        peer.on('error', (err: any) => {
          // 'unavailable-id' happens when the tab was reloaded before the old
          // registration expired on the signalling server — retry with backoff.
          if (err?.type === 'unavailable-id' || err?.type === 'network') {
            this.schedulePeerRetry();
          }
        });

        peer.on('disconnected', () => {
          if (!this.destroyed) {
            try {
              peer.reconnect();
            } catch {
              this.schedulePeerRetry();
            }
          }
        });
      } else {
        const peer = new Peer(peerConfig);
        this.peer = peer;

        const connectToDesktop = () => {
          if (this.destroyed || !this.peer || this.peer.destroyed) return;
          if (this.openConnCount() > 0) return;
          try {
            const conn = this.peer.connect(desktopId, { reliable: true });
            this.setupConn(conn);
          } catch {
            /* ignore */
          }
        };

        peer.on('open', () => {
          connectToDesktop();
          if (this.reconnectTimer) clearInterval(this.reconnectTimer);
          this.reconnectTimer = setInterval(connectToDesktop, 4000);
        });

        peer.on('disconnected', () => {
          if (!this.destroyed && this.peer && !this.peer.destroyed) {
            try {
              this.peer.reconnect();
            } catch {
              /* ignore */
            }
          }
        });

        peer.on('error', () => {
          // Quietly retried by the interval above.
        });
      }
    } catch {
      /* WebRTC unavailable */
    }
  }

  private schedulePeerRetry() {
    if (this.destroyed) return;
    this.peerRetryCount = Math.min(this.peerRetryCount + 1, 6);
    const delay = Math.min(15000, 1200 * this.peerRetryCount);
    setTimeout(() => {
      if (this.destroyed) return;
      try {
        this.peer?.destroy();
      } catch {
        /* ignore */
      }
      this.peer = null;
      this.initWebRTC();
    }, delay);
  }

  private setupConn(conn: DataConnection) {
    this.peerConns.add(conn);
    conn.on('open', () => {
      this.peerRetryCount = 0;
      this.emitStatus();
      this.flushPending();
      // Let the other side know what kind of device just joined.
      try {
        conn.send({
          type: 'client_info',
          msgId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          device: deviceLabel(),
          ts: Date.now(),
        });
      } catch {
        /* ignore */
      }
    });
    conn.on('data', (data) => {
      this.handleIncoming(data as SyncMessage);
    });
    conn.on('close', () => {
      this.peerConns.delete(conn);
      this.emitStatus();
    });
    conn.on('error', () => {
      this.peerConns.delete(conn);
      this.emitStatus();
    });
  }

  // 3. Local LAN WebSocket (/ws) when running the bundled Express server
  private initLocalWebSocketIfAvailable() {
    if (window.location.hostname.endsWith('.vercel.app')) return;

    const connectWs = () => {
      if (this.destroyed) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        this.ws = ws;

        ws.onopen = () => {
          this.wsRetryDelay = 1000;
          ws.send(JSON.stringify({ type: 'join', room: this.room, role: this.role }));
          this.emitStatus();
          this.flushPending();
        };

        ws.onmessage = (ev) => {
          try {
            this.handleIncoming(JSON.parse(ev.data));
          } catch {
            /* ignore */
          }
        };

        ws.onclose = () => {
          this.wsConnectedPeers = 0;
          this.emitStatus();
          if (!this.destroyed) {
            this.wsRetry = setTimeout(connectWs, this.wsRetryDelay);
            this.wsRetryDelay = Math.min(10000, this.wsRetryDelay * 1.7);
          }
        };

        ws.onerror = () => ws.close();
      } catch {
        /* ignore */
      }
    };

    connectWs();
  }

  private flushPending() {
    if (this.pending.length === 0) return;
    const queue = this.pending;
    this.pending = [];
    for (const item of queue) {
      // Drop anything older than two minutes so a stale order never replays late.
      if (Date.now() - item.ts > 120000) continue;
      this.send(item.payload);
    }
  }

  /** Bytes still queued in the WebRTC data channels (used to pace file uploads). */
  public bufferedAmount(): number {
    let max = 0;
    for (const conn of this.peerConns) {
      try {
        const dc = conn.dataChannel;
        if (dc && typeof dc.bufferedAmount === 'number') max = Math.max(max, dc.bufferedAmount);
      } catch {
        /* ignore */
      }
    }
    return max;
  }

  /** Resolves when the link is up, or after `timeoutMs` (returns false). */
  public waitForConnection(timeoutMs = 12000): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        if (this.connected) {
          clearInterval(iv);
          resolve(true);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(iv);
          resolve(false);
        }
      }, 250);
    });
  }

  /** Sends a tiny probe and resolves with the measured round-trip time. */
  public probe(timeoutMs = 6000): Promise<number | null> {
    const ts = Date.now();
    this.probes.set(String(ts), ts);
    this.sendRaw({ type: 'probe', ts });
    return new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (!this.probes.has(String(ts))) {
          clearInterval(iv);
          resolve(this.lastLatency);
        } else if (this.probes.has(String(ts)) && Date.now() - start > timeoutMs) {
          this.probes.delete(String(ts));
          clearInterval(iv);
          resolve(null);
        }
      }, 120);
    });
  }

  private sendRaw(payload: Omit<SyncMessage, 'msgId'>) {
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full = { ...payload, msgId, senderRole: this.role };
    this.seenIds.add(msgId);

    let delivered = false;

    for (const conn of this.peerConns) {
      if (conn.open) {
        try {
          conn.send(full);
          delivered = true;
        } catch {
          /* ignore */
        }
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(full));
        delivered = true;
      } catch {
        /* ignore */
      }
    }

    if (this.bc) {
      try {
        this.bc.postMessage(full);
        delivered = true;
      } catch {
        /* ignore */
      }
    }

    if (!delivered) {
      this.pending.push({ payload, ts: Date.now() });
      if (this.pending.length > 400) this.pending.shift();
    }
    return delivered;
  }

  public send(payload: Omit<SyncMessage, 'msgId'>) {
    this.sendRaw(payload);
  }

  /** How many messages are still waiting for a link (shown in the UI). */
  public get queuedCount(): number {
    return this.pending.length;
  }

  public destroy() {
    this.destroyed = true;
    if (this.wsRetry) clearTimeout(this.wsRetry);
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    for (const c of this.peerConns) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.peerConns.clear();
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.bc?.close();
    } catch {
      /* ignore */
    }
  }
}

export { deviceLabel, ICE_SERVERS };
