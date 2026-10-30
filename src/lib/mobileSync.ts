// IK Computers — Serverless Vercel-Ready + Offline LAN Hybrid Mobile Keyboard Sync
// Uses 3 automatic transports with deduplication:
//   1. WebRTC Direct DataChannel (PeerJS) -> Works 100% serverless on Vercel (*.vercel.app) over Wi-Fi or 4G!
//   2. Local WebSocket (/ws) -> Works offline on Shop LAN when running `npm run dev` / `npm start`
//   3. BroadcastChannel -> Instant 0ms sync across tabs on the same device

import Peer, { DataConnection } from 'peerjs';

export interface SyncMessage {
  msgId?: string;
  revision?: number;
  type: 'live_document' | 'room_status' | 'insert_text' | 'live_composing' | 'command' | 'context_sync' | 'hello';
  room?: string;
  text?: string;
  action?: 'backspace' | 'enter' | 'undo' | 'space';
  lastWord?: string;
  desktopCount?: number;
  mobileCount?: number;
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

export class HybridMobileSync {
  private room: string;
  private role: 'desktop' | 'mobile';
  private onMessage: (msg: SyncMessage) => void;
  private onStatusChange: (status: { connected: boolean; peerCount: number; transport: string }) => void;

  private peer: Peer | null = null;
  private peerConns: Set<DataConnection> = new Set();
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private seenIds: Set<string> = new Set();
  private destroyed = false;
  private wsConnectedPeers = 0;
  private bcConnected = false;
  private wsRetry: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    room: string;
    role: 'desktop' | 'mobile';
    onMessage: (msg: SyncMessage) => void;
    onStatusChange: (status: { connected: boolean; peerCount: number; transport: string }) => void;
  }) {
    this.room = opts.room.trim().toUpperCase();
    this.role = opts.role;
    this.onMessage = opts.onMessage;
    this.onStatusChange = opts.onStatusChange;

    this.initBroadcastChannel();
    this.initWebRTC();
    this.initLocalWebSocketIfAvailable();
  }

  private emitStatus() {
    const webrtcCount = Array.from(this.peerConns).filter((c) => c.open).length;
    const totalPeers = Math.max(webrtcCount, this.wsConnectedPeers, this.bcConnected ? 1 : 0);
    const transport =
      webrtcCount > 0
        ? 'WebRTC Cloud'
        : this.wsConnectedPeers > 0
        ? 'LAN WebSocket'
        : this.bcConnected
        ? 'Local Tab'
        : 'Standby';
    this.onStatusChange({
      connected: totalPeers > 0,
      peerCount: totalPeers,
      transport,
    });
  }

  private handleIncoming(raw: SyncMessage) {
    if (!raw || typeof raw !== 'object') return;
    if (raw.msgId) {
      if (this.seenIds.has(raw.msgId)) return;
      this.seenIds.add(raw.msgId);
      if (this.seenIds.size > 300) {
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
      const count =
        this.role === 'desktop' ? raw.mobileCount || 0 : raw.desktopCount || 0;
      this.wsConnectedPeers = count;
      this.emitStatus();
      return;
    }

    this.onMessage(raw);
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
      // ignore
    }
  }

  // 2. Serverless WebRTC PeerJS (Works on Vercel HTTPS between Phone & PC!)
  private initWebRTC() {
    try {
      const desktopId = buildDesktopPeerId(this.room);
      if (this.role === 'desktop') {
        const peer = new Peer(desktopId, { debug: 0 });
        this.peer = peer;

        peer.on('connection', (conn) => {
          this.setupConn(conn);
        });

        peer.on('error', () => {
          // Gracefully fallback if ID busy or offline
        });
      } else {
        const peer = new Peer({ debug: 0 });
        this.peer = peer;

        const connectToDesktop = () => {
          if (this.destroyed || !this.peer || this.peer.destroyed) return;
          const activeOpen = Array.from(this.peerConns).some((c) => c.open);
          if (activeOpen) return;

          const conn = this.peer.connect(desktopId, { reliable: true });
          this.setupConn(conn);
        };

        peer.on('open', () => {
          connectToDesktop();
          this.reconnectTimer = setInterval(connectToDesktop, 3500);
        });

        peer.on('error', () => {
          // Will retry quietly
        });
      }
    } catch {
      // WebRTC unavailable
    }
  }

  private setupConn(conn: DataConnection) {
    this.peerConns.add(conn);
    conn.on('open', () => {
      this.emitStatus();
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

  // 3. Local LAN WebSocket (/ws) when running Express server locally
  private initLocalWebSocketIfAvailable() {
    // Skip WS polling on vercel.app static deployments so console stays 100% clean
    if (window.location.hostname.endsWith('.vercel.app')) {
      return;
    }

    const connectWs = () => {
      if (this.destroyed) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        this.ws = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'join',
              room: this.room,
              role: this.role,
            })
          );
        };

        ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data);
            this.handleIncoming(parsed);
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          this.wsConnectedPeers = 0;
          this.emitStatus();
          if (!this.destroyed) {
            this.wsRetry = setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        // ignore
      }
    };

    connectWs();
  }

  public send(payload: Omit<SyncMessage, 'msgId'>) {
    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full = { ...payload, msgId, senderRole: this.role };
    this.seenIds.add(msgId);

    // Send over WebRTC
    for (const conn of this.peerConns) {
      if (conn.open) {
        try {
          conn.send(full);
        } catch {
          // ignore
        }
      }
    }

    // Send over WebSocket if open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(full));
      } catch {
        // ignore
      }
    }

    // Send over BroadcastChannel
    if (this.bc) {
      try {
        this.bc.postMessage(full);
      } catch {
        // ignore
      }
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.wsRetry) clearTimeout(this.wsRetry);
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    for (const c of this.peerConns) {
      try {
        c.close();
      } catch {
        // ignore
      }
    }
    this.peerConns.clear();
    try {
      this.peer?.destroy();
    } catch {
      // ignore
    }
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
  }
}
