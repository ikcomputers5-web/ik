import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Search,
  Printer,
  Trash2,
  CheckCircle2,
  Phone,
  Download,
  Wallet,
  TrendingUp,
  Clock,
  FileSpreadsheet,
  MessageSquare,
  Settings2,
  Copy,
} from 'lucide-react';
import {
  JOB_SERVICES,
  STATUS_META,
  daySummaryText,
  downloadText,
  isToday,
  loadShopSettings,
  loadTickets,
  makeTicket,
  saveShopSettings,
  saveTickets,
  summariseDay,
  ticketsToCsv,
  type JobStatus,
  type JobTicket,
  type ShopSettings,
} from '../lib/jobLedger';

interface JobTicketRegisterProps {
  /** A ticket suggested by another module (Scan & Order, Passport sheet …). */
  incoming?: { customer?: string; phone?: string; service?: string; source?: JobTicket['source']; fileName?: string } | null;
  onConsumeIncoming?: () => void;
}

const STATUS_FLOW: JobStatus[] = ['pending', 'working', 'ready', 'delivered'];

const badgeClass = (status: JobStatus) => {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-700/60';
    case 'working':
      return 'bg-sky-500/15 text-sky-300 border-sky-700/60';
    case 'delivered':
      return 'bg-slate-500/15 text-slate-300 border-slate-600/60';
    case 'cancelled':
      return 'bg-rose-500/15 text-rose-300 border-rose-700/60';
    default:
      return 'bg-amber-500/15 text-amber-300 border-amber-700/60';
  }
};

export const JobTicketRegister: React.FC<JobTicketRegisterProps> = ({
  incoming,
  onConsumeIncoming,
}) => {
  const [tickets, setTickets] = useState<JobTicket[]>(() => loadTickets());
  const [shop, setShop] = useState<ShopSettings>(() => loadShopSettings());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'today' | 'open' | 'all'>('today');
  const [editing, setEditing] = useState<JobTicket | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    saveTickets(tickets);
  }, [tickets]);

  useEffect(() => {
    saveShopSettings(shop);
  }, [shop]);

  // A new job arriving from another module becomes a draft ticket.
  useEffect(() => {
    if (!incoming) return;
    const draft = makeTicket({
      customer: incoming.customer || 'Walk-in customer',
      phone: incoming.phone || '',
      service: incoming.service || JOB_SERVICES[0],
      source: incoming.source || 'counter',
      fileName: incoming.fileName,
    });
    setEditing(draft);
    onConsumeIncoming?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const summary = useMemo(() => summariseDay(tickets), [tickets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tickets;
    if (filter === 'today') list = list.filter((t) => isToday(t.createdAt));
    if (filter === 'open')
      list = list.filter((t) => t.status === 'pending' || t.status === 'working' || t.status === 'ready');
    if (q) {
      list = list.filter((t) =>
        [t.id, t.customer, t.phone, t.service, t.details, t.fileName]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list.slice().sort((a, b) => b.createdAt - a.createdAt);
  }, [tickets, filter, query]);

  const upsert = (ticket: JobTicket) => {
    setTickets((prev) => {
      const idx = prev.findIndex((t) => t.id === ticket.id);
      const next = [...prev];
      if (idx >= 0) next[idx] = { ...ticket, updatedAt: Date.now() };
      else next.unshift({ ...ticket, updatedAt: Date.now() });
      return next;
    });
    setEditing(null);
    setToast(`Ticket #${ticket.id} saved.`);
    setTimeout(() => setToast(''), 2600);
  };

  const createBlank = () => setEditing(makeTicket());

  const advance = (ticket: JobTicket) => {
    const idx = STATUS_FLOW.indexOf(ticket.status);
    const next = STATUS_FLOW[Math.min(STATUS_FLOW.length - 1, idx + 1)];
    upsert({ ...ticket, status: next, paid: next === 'delivered' ? ticket.price : ticket.paid });
  };

  const printTicket = (ticket: JobTicket) => {
    const win = window.open('', '_blank', 'width=420,height=640');
    if (!win) {
      setToast('Allow pop-ups to print the ticket.');
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Ticket ${ticket.id} — ${shop.name}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: Inter, Arial, sans-serif; color:#0f172a; margin:0; }
        h1 { font-size: 15px; margin: 0; letter-spacing:.5px; }
        .muted { color:#64748b; font-size: 10px; }
        .big { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
        .row { display:flex; justify-content:space-between; font-size: 11.5px; padding: 3px 0; border-bottom: 1px dashed #e2e8f0; }
        .box { border: 2px solid #0f172a; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
        .urdu { direction: rtl; font-size: 12px; }
        .total { font-size: 14px; font-weight: 800; }
      </style></head><body>
      <div class="box" style="text-align:center">
        <h1>${shop.name}</h1>
        ${shop.phone ? `<div class="muted">${shop.phone}</div>` : ''}
        ${shop.address ? `<div class="muted">${shop.address}</div>` : ''}
        <div class="big" style="margin-top:6px">#${ticket.id}</div>
        <div class="muted">${new Date(ticket.createdAt).toLocaleString()}</div>
      </div>
      <div class="row"><span>Customer</span><strong>${ticket.customer}</strong></div>
      ${ticket.phone ? `<div class="row"><span>Phone</span><strong>${ticket.phone}</strong></div>` : ''}
      <div class="row"><span>Service</span><strong>${ticket.service}</strong></div>
      <div class="row"><span>Copies</span><strong>${ticket.copies}</strong></div>
      ${ticket.details ? `<div class="row"><span>Details</span><strong>${ticket.details}</strong></div>` : ''}
      ${ticket.fileName ? `<div class="row"><span>File</span><strong>${ticket.fileName}</strong></div>` : ''}
      <div class="row total"><span>Total</span><span>Rs ${ticket.price}</span></div>
      ${ticket.paid ? `<div class="row"><span>Paid</span><span>Rs ${ticket.paid}</span></div>` : ''}
      <p class="muted" style="margin-top:10px;text-align:center">
        Keep this slip and show it when collecting your work.<br/>
        <span class="urdu">یہ پرچی لے کر اپنا کام وصول کریں</span><br/>${shop.footerNote || ''}
      </p>
      </body></html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  };

  const sendWhatsApp = (ticket: JobTicket) => {
    const phone = ticket.phone.replace(/[^0-9]/g, '');
    if (!phone) {
      setToast('Add the customer phone number first.');
      return;
    }
    const digits = phone.startsWith('92') ? phone : phone.startsWith('0') ? `92${phone.slice(1)}` : `92${phone}`;
    const text = encodeURIComponent(
      `${shop.name}\nYour work is READY ✅\nTicket #${ticket.id} — ${ticket.service} (${ticket.copies} pcs)\nAmount: Rs ${ticket.price}\nPlease collect from the counter. شکریہ`
    );
    window.open(`https://wa.me/${digits}?text=${text}`, '_blank');
  };

  const printDayRegister = () => {
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) return;
    const rows = tickets
      .filter((t) => isToday(t.createdAt))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(
        (t) =>
          `<tr><td>${t.id}</td><td>${t.customer}</td><td>${t.service}</td><td>${t.copies}</td><td>Rs ${t.price}</td><td>Rs ${t.paid}</td><td>${STATUS_META[t.status].label}</td></tr>`
      )
      .join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Daily register</title>
      <style>@page{size:A4;margin:12mm} body{font-family:Inter,Arial,sans-serif;color:#0f172a}
      h1{font-size:18px;margin:0 0 2px} .muted{color:#64748b;font-size:11px}
      table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11.5px}
      th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}
      th{background:#f1f5f9;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px}
      .stats{display:flex;gap:14px;margin-top:8px;font-size:12px}</style></head><body>
      <h1>${shop.name} — Daily Register</h1>
      <div class="muted">${new Date().toLocaleString()} ${shop.phone ? '· ' + shop.phone : ''}</div>
      <div class="stats">
        <span><strong>${summary.tickets}</strong> tickets</span>
        <span>Open: <strong>${summary.open}</strong></span>
        <span>Delivered: <strong>${summary.done}</strong></span>
        <span>Billing: <strong>Rs ${summary.billing}</strong></span>
        <span>Collected: <strong>Rs ${summary.collected}</strong></span>
        <span>Outstanding: <strong>Rs ${summary.outstanding}</strong></span>
      </div>
      <table><thead><tr><th>#</th><th>Customer</th><th>Service</th><th>Qty</th><th>Price</th><th>Paid</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No tickets today</td></tr>'}</tbody></table>
      <p class="muted" style="margin-top:14px">Printed ${new Date().toLocaleString()} · ${shop.footerNote || ''}</p>
      </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 350);
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(daySummaryText(tickets, shop));
      setToast('Day summary copied — paste it into WhatsApp.');
    } catch {
      setToast('Could not copy on this browser.');
    }
    setTimeout(() => setToast(''), 2600);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
            <ClipboardList className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white leading-tight">
              Job Ticket Register <span className="urdu-naskh text-slate-400 font-normal">کام کی پرچی</span>
            </h2>
            <p className="text-[10.5px] text-slate-400 leading-tight">
              Every counter job, price and pending payment in one place
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            onClick={copySummary}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy day summary
          </button>
          <button
            onClick={() => downloadText(ticketsToCsv(tickets), `IK-Tickets-${Date.now()}.csv`, 'text/csv')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
          >
            <FileSpreadsheet className="w-3 h-3" /> CSV
          </button>
          <button
            onClick={printDayRegister}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
          >
            <Printer className="w-3 h-3" /> Day register
          </button>
          <button
            onClick={() => setShowShop((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1"
          >
            <Settings2 className="w-3 h-3" /> Shop details
          </button>
          <button
            onClick={createBlank}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> New ticket
          </button>
        </div>
      </div>

      {toast && (
        <div className="px-4 py-1.5 bg-emerald-950/60 border-b border-emerald-800 text-[11px] text-emerald-200">
          {toast}
        </div>
      )}

      {showShop && (
        <div className="px-4 py-3 bg-slate-900/70 border-b border-slate-800 grid sm:grid-cols-4 gap-2">
          {(
            [
              ['name', 'Shop name'],
              ['phone', 'Phone'],
              ['address', 'Address'],
              ['footerNote', 'Footer note'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[10px] text-slate-400 mb-0.5">{label}</span>
              <input
                value={(shop as any)[key]}
                onChange={(e) => setShop((s) => ({ ...s, [key]: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-emerald-500"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Today's numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: Clock, label: 'Open jobs', value: String(summary.open), tone: 'text-amber-300' },
            { icon: CheckCircle2, label: 'Delivered', value: String(summary.done), tone: 'text-emerald-300' },
            { icon: TrendingUp, label: 'Billing today', value: `Rs ${summary.billing}`, tone: 'text-sky-300' },
            { icon: Wallet, label: 'Outstanding', value: `Rs ${summary.outstanding}`, tone: 'text-rose-300' },
          ].map(({ icon: Icon, label, value, tone }) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5">
              <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
                <Icon className="w-3 h-3" /> {label}
              </div>
              <div className="text-lg font-extrabold text-white mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            {(['today', 'open', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold capitalize ${
                  filter === f ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticket, name, phone…"
              className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11.5px] text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />
          </div>
          <span className="text-[10.5px] text-slate-500">{visible.length} shown</span>
        </div>

        {/* Ticket list */}
        {visible.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
            <ClipboardList className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <div className="text-xs font-bold text-slate-300">No tickets here yet</div>
            <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
              Create a ticket for each customer job — it prints a small slip with a ticket number, tracks
              whether the work is pending or ready, and totals the day's cash at closing time.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          {visible.map((t) => (
            <div
              key={t.id}
              className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2"
            >
              <div className="font-mono text-[11px] text-emerald-300 font-bold w-16">#{t.id}</div>
              <div className="min-w-[120px] flex-1">
                <div className="text-[12px] font-bold text-white truncate">{t.customer}</div>
                <div className="text-[10.5px] text-slate-400 truncate">
                  {t.service} × {t.copies}
                  {t.details ? ` · ${t.details}` : ''}
                </div>
              </div>
              <div className="text-[11px] font-bold text-slate-200 w-20 text-right">Rs {t.price}</div>
              <span
                className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold uppercase ${badgeClass(t.status)}`}
              >
                {STATUS_META[t.status].label}
              </span>
              <div className="flex items-center gap-1">
                {t.status !== 'delivered' && t.status !== 'cancelled' && (
                  <button
                    onClick={() => advance(t)}
                    className="px-1.5 py-1 rounded bg-emerald-600/20 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold"
                    title="Move to the next stage"
                  >
                    {t.status === 'ready' ? 'Deliver' : 'Next'}
                  </button>
                )}
                <button
                  onClick={() => printTicket(t)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                  title="Print slip"
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
                {t.phone && (
                  <>
                    <a
                      href={`tel:${t.phone}`}
                      className="p-1 rounded text-slate-400 hover:text-white"
                      title="Call"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => sendWhatsApp(t)}
                      className="p-1 rounded text-slate-400 hover:text-emerald-300"
                      title="WhatsApp: work is ready"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setEditing(t)}
                  className="p-1 rounded text-slate-400 hover:text-sky-300 text-[10px] font-bold"
                  title="Edit"
                >
                  edit
                </button>
                <button
                  onClick={() => setTickets((prev) => prev.filter((x) => x.id !== t.id))}
                  className="p-1 rounded text-slate-400 hover:text-rose-400"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => downloadText(daySummaryText(tickets, shop), `IK-Day-${Date.now()}.txt`)}
          className="w-full py-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-bold flex items-center justify-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Download today's register as text
        </button>
      </div>

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-4 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white">
                Ticket <span className="font-mono text-emerald-300">#{editing.id}</span>
              </h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block col-span-2 sm:col-span-1">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Customer name</span>
                <input
                  value={editing.customer}
                  onChange={(e) => setEditing({ ...editing, customer: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block col-span-2 sm:col-span-1">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Phone</span>
                <input
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  inputMode="tel"
                  placeholder="03xx-xxxxxxx"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block col-span-2">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Service</span>
                <select
                  value={editing.service}
                  onChange={(e) => setEditing({ ...editing, service: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {JOB_SERVICES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Copies / pages</span>
                <input
                  type="number"
                  min={1}
                  value={editing.copies}
                  onChange={(e) => setEditing({ ...editing, copies: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Price (Rs)</span>
                <input
                  type="number"
                  min={0}
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-emerald-300 font-bold outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Paid (Rs)</span>
                <input
                  type="number"
                  min={0}
                  value={editing.paid}
                  onChange={(e) => setEditing({ ...editing, paid: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Status</span>
                <select
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value as JobStatus })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {(Object.keys(STATUS_META) as JobStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block col-span-2">
                <span className="block text-[10.5px] text-slate-400 mb-0.5">Details / instructions</span>
                <textarea
                  value={editing.details}
                  onChange={(e) => setEditing({ ...editing, details: e.target.value })}
                  rows={2}
                  dir="auto"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500 resize-none"
                />
              </label>
            </div>

            {editing.fileName && (
              <div className="text-[10.5px] text-slate-400">
                Attached file: <span className="text-slate-200 font-semibold">{editing.fileName}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => upsert(editing)}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Save ticket
              </button>
              <button
                onClick={() => {
                  const t = editing;
                  setEditing(null);
                  setTimeout(() => printTicket(t), 100);
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-bold"
              >
                Save &amp; print
              </button>
            </div>
            {!tickets.some((t) => t.id === editing.id) && (
              <p className="text-[10px] text-slate-500">
                Ticket number #{editing.id} is new — saved tickets stay on this computer even after a refresh.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default JobTicketRegister;
