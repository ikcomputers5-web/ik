import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { HybridMobileSync } from '../lib/mobileSync';

export const LiveComposing: React.FC<{ mobile?: boolean; initialRoom?: string }> = ({ mobile = false, initialRoom }) => {
  const [room] = useState(() => initialRoom || Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase());
  const [text, setText] = useState('');
  const textRef = useRef('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef<{ text: string; start: number; end: number }[]>([]);
  const redoRef = useRef<{ text: string; start: number; end: number }[]>([]);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const revisionRef = useRef(0);
  const syncRef = useRef<HybridMobileSync | null>(null);
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState('Waiting');
  const [qr, setQr] = useState('');
  const [link, setLink] = useState(`${window.location.origin}/?mobilelive=${room}`);
  const [notice, setNotice] = useState('');
  const [direction, setDirection] = useState<'rtl' | 'ltr'>('rtl');

  useEffect(() => {
    if (mobile) return;
    // localhost cannot be opened by a phone; use the PC's LAN address there.
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      fetch('/api/network-info').then(r => r.json()).then(data => {
        if (data.lanIps?.[0]?.address) setLink(`http://${data.lanIps[0].address}:${data.port}/?mobilelive=${room}`);
      }).catch(() => {});
    }
  }, [mobile, room]);

  useEffect(() => {
    QRCode.toDataURL(link, { width: 240, margin: 2 }).then(setQr).catch(() => setQr(''));
  }, [link]);

  useEffect(() => {
    const sync = new HybridMobileSync({
      room, role: mobile ? 'mobile' : 'desktop',
      onStatusChange: status => {
        setConnected(status.connected);
        setTransport(status.transport);
        if (mobile && status.connected) {
          // Full snapshots recover text typed before pairing or during a disconnect.
          syncRef.current?.send({ type: 'live_document', text: textRef.current, revision: revisionRef.current });
        }
      },
      onMessage: msg => {
        if (!mobile && msg.type === 'live_document' && typeof msg.text === 'string' && (msg.revision || 0) >= revisionRef.current) {
          revisionRef.current = msg.revision || 0;
          textRef.current = msg.text;
          setText(msg.text);
        }
      },
    });
    syncRef.current = sync;
    // Repeat snapshots to recover from reconnects and late-arriving older transports.
    const timer = mobile ? setInterval(() => sync.send({ type: 'live_document', text: textRef.current, revision: revisionRef.current }), 1500) : undefined;
    return () => { clearInterval(timer); sync.destroy(); syncRef.current = null; };
  }, [room, mobile]);

  const refreshHistory = () => setHistoryState({ undo: undoRef.current.length > 0, redo: redoRef.current.length > 0 });
  const snapshot = () => ({ text: textRef.current, ...selectionRef.current });
  const rememberSelection = () => {
    const editor = editorRef.current;
    if (editor) selectionRef.current = { start: editor.selectionStart, end: editor.selectionEnd };
  };
  const restoreSelection = (start: number, end = start) => {
    selectionRef.current = { start, end };
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(start, end);
    });
  };
  const updateText = (value: string, remember = true) => {
    if (value === textRef.current) return;
    if (remember) {
      undoRef.current.push(snapshot());
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = [];
      refreshHistory();
    }
    revisionRef.current = Math.max(Date.now(), revisionRef.current + 1);
    textRef.current = value;
    setText(value);
    syncRef.current?.send({ type: 'live_document', text: value, revision: revisionRef.current });
  };

  const travelHistory = (undo: boolean) => {
    const source = undo ? undoRef.current : redoRef.current;
    const destination = undo ? redoRef.current : undoRef.current;
    const previous = source.pop();
    if (!previous) return;
    destination.push(snapshot());
    updateText(previous.text, false);
    restoreSelection(previous.start, previous.end);
    refreshHistory();
  };
  const deleteSelection = () => {
    const { start, end } = selectionRef.current;
    if (start === end) { setNotice('Long-press text and select the words to delete first.'); return; }
    updateText(textRef.current.slice(0, start) + textRef.current.slice(end));
    restoreSelection(start);
    setNotice('Selection deleted. Use Undo to restore it.');
  };

  return <main className="max-w-6xl mx-auto p-4 md:p-8 text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
      <div><h1 className="text-2xl font-bold">Live Composing</h1><p className="text-slate-400 mt-1">{mobile ? 'Type with your phone keyboard or its voice input. Your PC shows every edit.' : 'Your phone is the keyboard. This page is your live writing screen.'}</p></div>
      <span role="status" className={connected ? 'text-emerald-400' : 'text-amber-400'}>{connected ? `Connected • ${transport}` : 'Waiting for connection…'}</span>
    </div>
    <div className={`grid gap-6 ${mobile ? '' : 'md:grid-cols-[280px_1fr]'}`}>
      {!mobile && <aside className="bg-slate-900 border border-slate-700 rounded-xl p-4 print:hidden">
        <h2 className="font-bold mb-2">1. Connect your phone</h2>
        {qr && <img src={qr} alt="Scan to open this live composing room on your phone" className="rounded-lg w-full max-w-60 mx-auto" />}
        <p className="text-sm text-slate-400 my-3">Scan with your phone camera, then type on the page that opens. Keep this PC page open. Use one phone per room.</p>
        <label className="text-xs text-slate-400">Phone link (editable for LAN)</label>
        <input aria-label="Phone pairing link" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs mt-1" value={link} onChange={e => setLink(e.target.value)} />
        <button className="mt-3 text-emerald-400 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setNotice('Link copied'); } catch { setNotice('Select and copy the phone link above.'); } }}>Copy phone link</button>
        <p className="text-xs text-slate-400 mt-3">On a local PC server, connect both devices to the same Wi-Fi. Cloud pairing depends on WebRTC connectivity; some networks may block it. Keep this private link only on trusted devices.</p>
        <a className="block text-sm text-sky-400 mt-4" href={link} target="_blank" rel="noreferrer">Test phone pad in new tab ↗</a>
      </aside>}
      <section className="min-w-0">
        <div className="flex flex-wrap gap-3 mb-3 print:hidden">
          <button className="bg-slate-800 rounded px-3 py-2 text-sm" onClick={() => setDirection(d => d === 'rtl' ? 'ltr' : 'rtl')}>{direction === 'rtl' ? 'Urdu / RTL' : 'English / LTR'}</button>
          {!mobile && <><button className="bg-slate-800 rounded px-3 py-2 text-sm" onClick={() => window.print()}>Print</button><button className="bg-slate-800 rounded px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setNotice('Text copied'); } catch { setNotice('Select the text to copy it.'); } }}>Copy text</button></>}
          <span className="text-sm text-slate-400 self-center">{text.length} characters</span>
        </div>
        {mobile && <div className="mb-3 print:hidden">
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Mobile text editing">
            <button className="bg-slate-800 rounded px-3 py-2 text-sm disabled:opacity-40" disabled={!historyState.undo} onPointerDown={e => e.preventDefault()} onClick={() => travelHistory(true)}>Undo</button>
            <button className="bg-slate-800 rounded px-3 py-2 text-sm disabled:opacity-40" disabled={!historyState.redo} onPointerDown={e => e.preventDefault()} onClick={() => travelHistory(false)}>Redo</button>
            <button className="bg-slate-800 rounded px-3 py-2 text-sm" onPointerDown={e => e.preventDefault()} onClick={() => restoreSelection(0, text.length)}>Select all</button>
            <button className="bg-rose-950 text-rose-200 rounded px-3 py-2 text-sm" onPointerDown={e => e.preventDefault()} onClick={deleteSelection}>Delete selection</button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Tap anywhere to edit. Long-press to select, replace, cut or paste text. Every change appears on your PC; Undo and Redo sync too.</p>
        </div>}
        {mobile ? <textarea ref={editorRef} onSelect={rememberSelection} onBeforeInput={rememberSelection} aria-label="Live composing text" dir={direction} lang={direction === 'rtl' ? 'ur' : 'en'} value={text} onChange={e => updateText(e.target.value)} placeholder="یہاں لکھیں / Type here…" className="w-full min-h-[55vh] rounded-xl bg-slate-900 text-white border border-emerald-500 p-5 text-2xl leading-loose focus:outline-none" /> :
          <article aria-label="Live document" dir={direction} className="bg-white text-slate-950 rounded-xl shadow p-6 md:p-10 min-h-[65vh] whitespace-pre-wrap break-words text-2xl leading-loose select-text print:shadow-none">{text || <span className="text-slate-400 print:hidden">Your mobile typing will appear here, live…</span>}</article>}
        <p role="status" className="text-sm text-emerald-400 mt-3 print:hidden">{notice}</p>
        {mobile && !connected && <p className="text-amber-400 text-sm mt-2">Not connected yet. Keep this page open; your text will sync when the PC connects. Do not close or reload this page before copying unsynced text.</p>}
      </section>
    </div>
  </main>;
};
