// IK Computers — Job ticket ledger (daily counter register)
//
// A job ticket is one piece of counter work: a print job, a passport-sheet job,
// a composing job. It records who asked, what was wanted, the price, the status
// and when it was delivered. Everything lives in this browser (localStorage), so
// the shop works with no internet and survives a page refresh. Tickets can be
// exported for a daily cash summary.

export type JobStatus = 'pending' | 'working' | 'ready' | 'delivered' | 'cancelled';

export interface JobTicket {
  id: string;
  createdAt: number;
  updatedAt: number;
  customer: string;
  phone: string;
  service: string;
  copies: number;
  details: string;
  price: number;
  paid: number;
  status: JobStatus;
  /** Where the ticket came from. */
  source: 'counter' | 'phone_qr' | 'passport' | 'bg_remover' | 'composer' | 'pdf';
  /** Optional file name attached at the counter. */
  fileName?: string;
}

const STORAGE_KEY = 'ik_job_tickets_v2';
const SEQ_KEY = 'ik_job_ticket_seq';
export const SHOP_SETTINGS_KEY = 'ik_shop_settings';

export const JOB_SERVICES = [
  'Print / Photostat',
  'Colour Print',
  'Urdu Composing',
  'English Composing / CV',
  'PDF Edit / Form Fill',
  'Passport Photos',
  'CNIC Front & Back',
  'Scan to PDF',
  'Lamination / Binding',
  'Other',
];

export const STATUS_META: Record<JobStatus, { label: string; urdu: string; color: string }> = {
  pending: { label: 'Pending', urdu: 'باقی', color: 'amber' },
  working: { label: 'Working', urdu: 'کام جاری', color: 'sky' },
  ready: { label: 'Ready', urdu: 'تیار', color: 'emerald' },
  delivered: { label: 'Delivered', urdu: 'ڈیلیور', color: 'slate' },
  cancelled: { label: 'Cancelled', urdu: 'منسوخ', color: 'rose' },
};

export interface ShopSettings {
  name: string;
  phone: string;
  address: string;
  footerNote: string;
}

export const DEFAULT_SHOP: ShopSettings = {
  name: 'IK Computers',
  phone: '',
  address: '',
  footerNote: 'Thank you — شکریہ',
};

export function loadShopSettings(): ShopSettings {
  try {
    const raw = localStorage.getItem(SHOP_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SHOP, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SHOP;
}

export function saveShopSettings(settings: ShopSettings) {
  try {
    localStorage.setItem(SHOP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function loadTickets(): JobTicket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JobTicket[]) : [];
  } catch {
    return [];
  }
}

export function saveTickets(tickets: JobTicket[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets.slice(0, 3000)));
  } catch {
    /* ignore */
  }
}

/** Short, human-friendly ticket number that restarts whenever the shop wants. */
export function nextTicketId(): string {
  const today = new Date().toISOString().slice(0, 10);
  let seq = 1;
  try {
    const raw = localStorage.getItem(SEQ_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { date: string; n: number };
      if (parsed.date === today) seq = parsed.n + 1;
    }
    localStorage.setItem(SEQ_KEY, JSON.stringify({ date: today, n: seq }));
  } catch {
    /* ignore */
  }
  return `${today.slice(5).replace('-', '')}-${String(seq).padStart(3, '0')}`;
}

export function makeTicket(partial: Partial<JobTicket> = {}): JobTicket {
  const now = Date.now();
  return {
    id: nextTicketId(),
    createdAt: now,
    updatedAt: now,
    customer: 'Walk-in customer',
    phone: '',
    service: JOB_SERVICES[0],
    copies: 1,
    details: '',
    price: 0,
    paid: 0,
    status: 'pending',
    source: 'counter',
    ...partial,
  };
}

export function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export interface DaySummary {
  tickets: number;
  done: number;
  open: number;
  billing: number;
  collected: number;
  outstanding: number;
  byService: { service: string; count: number; amount: number }[];
}

export function summariseDay(tickets: JobTicket[]): DaySummary {
  const todays = tickets.filter((t) => isToday(t.createdAt));
  const active = todays.filter((t) => t.status !== 'cancelled');
  const billing = active.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  const collected = active.reduce((sum, t) => sum + (Number(t.paid) || 0), 0);
  const map = new Map<string, { count: number; amount: number }>();
  for (const t of active) {
    const cur = map.get(t.service) || { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(t.price) || 0;
    map.set(t.service, cur);
  }
  return {
    tickets: todays.length,
    done: todays.filter((t) => t.status === 'delivered').length,
    open: todays.filter((t) => t.status === 'pending' || t.status === 'working' || t.status === 'ready').length,
    billing,
    collected,
    outstanding: Math.max(0, billing - collected),
    byService: Array.from(map.entries())
      .map(([service, v]) => ({ service, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Plain-text daily register — paste straight into WhatsApp or print it. */
export function daySummaryText(tickets: JobTicket[], shop: ShopSettings): string {
  const s = summariseDay(tickets);
  const date = new Date().toLocaleDateString();
  const lines: string[] = [];
  lines.push(`${shop.name || 'IK Computers'} — Daily Register (${date})`);
  if (shop.phone) lines.push(`Tel: ${shop.phone}`);
  lines.push('');
  lines.push(`Tickets: ${s.tickets}   Open: ${s.open}   Delivered: ${s.done}`);
  lines.push(`Billing: Rs ${s.billing}   Collected: Rs ${s.collected}   Outstanding: Rs ${s.outstanding}`);
  lines.push('');
  if (s.byService.length) {
    lines.push('By service:');
    for (const row of s.byService) {
      lines.push(`  • ${row.service}: ${row.count} × — Rs ${row.amount}`);
    }
    lines.push('');
  }
  lines.push('Tickets:');
  for (const t of tickets.filter((x) => isToday(x.createdAt))) {
    const status = STATUS_META[t.status].label;
    lines.push(
      `  #${t.id} [${status}] ${t.customer}${t.phone ? ` (${t.phone})` : ''} — ${t.service} ×${
        t.copies
      } — Rs ${t.price}${t.paid ? ` (paid ${t.paid})` : ''}`
    );
  }
  lines.push('');
  lines.push(shop.footerNote || '');
  return lines.join('\n');
}

/** CSV export for Excel / Google Sheets bookkeeping. */
export function ticketsToCsv(tickets: JobTicket[]): string {
  const header = [
    'Ticket',
    'Date',
    'Time',
    'Customer',
    'Phone',
    'Service',
    'Copies',
    'Details',
    'Price',
    'Paid',
    'Status',
    'Source',
  ];
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = tickets.map((t) => {
    const d = new Date(t.createdAt);
    return [
      t.id,
      d.toLocaleDateString(),
      d.toLocaleTimeString(),
      t.customer,
      t.phone,
      t.service,
      t.copies,
      t.details,
      t.price,
      t.paid,
      STATUS_META[t.status].label,
      t.source,
    ]
      .map(escape)
      .join(',');
  });
  return [header.map(escape).join(','), ...rows].join('\n');
}

export function downloadText(text: string, fileName: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
