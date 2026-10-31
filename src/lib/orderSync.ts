// IK Computers — "Scan & Order" file transfer
//
// The customer scans the sticker QR, picks a service, chooses a file from their
// phone and it lands on the shop PC. Everything travels over the same hybrid
// transport the mobile keyboard already uses (WebRTC → LAN WebSocket → tab), so
// it also works on a hosted Vercel deployment with no upload server at all.
//
// Wire protocol (all messages are plain JSON on the existing sync channel):
//   mobile → desktop : order_start  { orderId, name, phone, service, notes, fileName, mime, size, totalChunks }
//   mobile → desktop : order_chunk  { orderId, seq, data }   (data = base64 slice)
//   mobile → desktop : order_end    { orderId }
//   desktop → mobile : order_done   { orderId }
//
// Chunks are deduplicated by seq, so a duplicate delivered over two transports
// (WebRTC + LAN socket) can never corrupt the file.

import type { HybridMobileSync, SyncMessage } from './mobileSync';

export interface OrderServiceOption {
  id: string;
  label: string;
  urdu: string;
  accepts: 'pdf' | 'image' | 'any';
}

export const ORDER_SERVICES: OrderServiceOption[] = [
  { id: 'print', label: 'Print / Photostat', urdu: 'پرنٹ / فوٹو کاپی', accepts: 'any' },
  { id: 'pdf_edit', label: 'PDF Edit / Fill Form', urdu: 'پی ڈی ایف میں تبدیلی', accepts: 'pdf' },
  { id: 'composing', label: 'Urdu / English Composing', urdu: 'اردو کمپوزنگ', accepts: 'any' },
  { id: 'passport', label: 'Passport / Stamp Size Photos', urdu: 'پاسپورٹ سائز فوٹو', accepts: 'image' },
  { id: 'cnic', label: 'CNIC Front & Back Copy', urdu: 'شناختی کارڈ کاپی', accepts: 'image' },
  { id: 'scan_doc', label: 'Document Scan to PDF', urdu: 'دستاویز اسکین', accepts: 'image' },
  { id: 'other', label: 'Something Else', urdu: 'دیگر کام', accepts: 'any' },
];

export const MAX_ORDER_BYTES = 25 * 1024 * 1024; // 25 MB — safe on 3G/4G phones

/** 24 KB of binary per chunk (32 KB of base64) — comfortably inside one SCTP message. */
const CHUNK_B64 = 32 * 1024;

export type IncomingOrderStatus = 'receiving' | 'ready' | 'error';

export interface IncomingOrder {
  id: string;
  name: string;
  phone: string;
  service: string;
  serviceLabel: string;
  notes: string;
  fileName: string;
  mime: string;
  size: number;
  totalChunks: number;
  receivedChunks: number;
  receivedBytes: number;
  status: IncomingOrderStatus;
  error?: string;
  createdAt: number;
  completedAt?: number;
  file?: File;
  url?: string;
}

export function serviceLabelOf(id: string): string {
  return ORDER_SERVICES.find((s) => s.id === id)?.label || id;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read this file from the phone.'));
    reader.readAsDataURL(file);
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface SendOrderMeta {
  name: string;
  phone: string;
  service: string;
  notes?: string;
}

/**
 * Send one order (metadata + file) to the shop PC.
 * Resolves once every chunk has been handed to the transport.
 */
export async function sendOrderWithFile(
  sync: HybridMobileSync,
  meta: SendOrderMeta,
  file: File,
  onProgress?: (sentChunks: number, totalChunks: number) => void
): Promise<string> {
  if (file.size > MAX_ORDER_BYTES) {
    throw new Error(
      `This file is ${formatBytes(file.size)}. Please send a file below ${formatBytes(MAX_ORDER_BYTES)} — or ask the shop to scan it from your phone.`
    );
  }

  const orderId = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const base64 = await fileToBase64(file);
  const totalChunks = Math.max(1, Math.ceil(base64.length / CHUNK_B64));

  sync.send({
    type: 'order_start',
    orderId,
    name: meta.name.trim(),
    phone: meta.phone.trim(),
    service: meta.service,
    notes: (meta.notes || '').trim(),
    fileName: file.name || 'document',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    totalChunks,
  });

  for (let seq = 0; seq < totalChunks; seq++) {
    const slice = base64.slice(seq * CHUNK_B64, (seq + 1) * CHUNK_B64);
    sync.send({ type: 'order_chunk', orderId, seq, data: slice });
    onProgress?.(seq + 1, totalChunks);

    // Pace the upload: never let more than ~1 MB sit in the data-channel queue.
    let guard = 0;
    while (sync.bufferedAmount() > 1024 * 1024 && guard < 200) {
      await sleep(25);
      guard++;
    }
    if (seq % 6 === 5) await sleep(10);
  }

  sync.send({ type: 'order_end', orderId });
  return orderId;
}

/** Desktop side: reassemble incoming orders from the sync channel. */
export class OrderReceiver {
  private pending = new Map<
    string,
    {
      order: IncomingOrder;
      chunks: Map<number, string>;
      done: boolean;
    }
  >();

  constructor(
    private handlers: {
      onNew: (order: IncomingOrder) => void;
      onProgress: (order: IncomingOrder) => void;
      onComplete: (order: IncomingOrder) => void;
      onError: (order: IncomingOrder, message: string) => void;
    }
  ) {}

  /** Feed every incoming sync message here; non-order messages are ignored. */
  handle(msg: SyncMessage): void {
    if (!msg || !msg.orderId) return;
    const id = msg.orderId;

    if (msg.type === 'order_start') {
      const order: IncomingOrder = {
        id,
        name: (msg.name || '').trim() || 'Walk-in customer',
        phone: (msg.phone || '').trim(),
        service: msg.service || 'print',
        serviceLabel: serviceLabelOf(msg.service || 'print'),
        notes: (msg.notes || '').trim(),
        fileName: msg.fileName || 'document',
        mime: msg.mime || 'application/octet-stream',
        size: Number(msg.size) || 0,
        totalChunks: Math.max(1, Number(msg.totalChunks) || 1),
        receivedChunks: 0,
        receivedBytes: 0,
        status: 'receiving',
        createdAt: Date.now(),
        completedAt: undefined,
      };
      this.pending.set(id, { order, chunks: new Map(), done: false });
      this.handlers.onNew(order);
      return;
    }

    const entry = this.pending.get(id);
    if (!entry) return;

    if (msg.type === 'order_chunk') {
      const seq = Number(msg.seq);
      if (!Number.isFinite(seq) || seq < 0) return;
      const data = typeof msg.data === 'string' ? msg.data : '';
      if (!data) return;
      // Duplicate deliveries (two transports) must not double-count.
      if (entry.chunks.has(seq)) return;
      entry.chunks.set(seq, data);
      entry.order.receivedChunks = entry.chunks.size;
      entry.order.receivedBytes = Math.min(
        entry.order.size || Number.MAX_SAFE_INTEGER,
        Math.round((entry.chunks.size / entry.order.totalChunks) * (entry.order.size || 0))
      );
      if (entry.chunks.size < entry.order.totalChunks) this.handlers.onProgress(entry.order);
      return;
    }

    if (msg.type === 'order_end') {
      if (entry.done) return;
      entry.done = true;
      void this.finish(id);
    }
  }

  private async finish(id: string): Promise<void> {
    const entry = this.pending.get(id);
    if (!entry) return;
    const { order, chunks } = entry;

    const missing: number[] = [];
    for (let i = 0; i < order.totalChunks; i++) if (!chunks.has(i)) missing.push(i);

    if (missing.length > 0) {
      order.status = 'error';
      order.error = `${missing.length} part(s) of the file did not arrive. Ask the customer to send it again.`;
      this.handlers.onError(order, order.error);
      return;
    }

    try {
      const full = Array.from({ length: order.totalChunks }, (_, i) => chunks.get(i) || '').join('');
      const bytes = base64ToBytes(full);
      const blob = new Blob([bytes as unknown as BlobPart], {
        type: order.mime || 'application/octet-stream',
      });
      const file = new File([blob], order.fileName, { type: order.mime || 'application/octet-stream' });
      order.file = file;
      order.url = URL.createObjectURL(blob);
      order.receivedBytes = bytes.length;
      order.status = 'ready';
      order.completedAt = Date.now();
      this.handlers.onComplete(order);
    } catch {
      order.status = 'error';
      order.error = 'The file arrived but could not be rebuilt. Ask the customer to send it again.';
      this.handlers.onError(order, order.error);
    }
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      if (entry.order.url) {
        try {
          URL.revokeObjectURL(entry.order.url);
        } catch {
          /* ignore */
        }
      }
    }
    this.pending.clear();
  }
}
