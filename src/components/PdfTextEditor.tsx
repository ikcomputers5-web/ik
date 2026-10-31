import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eraser,
  FileText,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { PdfTextIndex, PdfTextLine } from '../lib/pdfText';
import { documentToPlainText } from '../lib/pdfTextEdit';

interface PdfTextEditorProps {
  pdfName: string;
  hasPdf: boolean;
  textIndex: PdfTextIndex | null;
  extracting: boolean;
  extractProgress?: { done: number; total: number } | null;
  extractError: string | null;
  /** 1-based PDF page currently shown on the stage */
  currentPage: number;
  /** keys of lines already rewritten: `page:lineId` */
  editedKeys: Set<string>;
  groqReady: boolean;
  onOpenSettings: () => void;
  onPickPdf: () => void;
  onRetryExtract: () => void;
  onFocusPage: (page: number) => void;
  onReplace: (page: number, line: PdfTextLine, newText: string) => void;
  onRemove: (page: number, line: PdfTextLine) => void;
  onEditOnPage: (page: number, line: PdfTextLine) => void;
  /** Reads the page image with AI and turns it into clickable lines. */
  onOcrPage: (page: number) => Promise<{ lineCount: number; text: string }>;
  /** page currently being read by AI (parent owns the request) */
  ocrBusyPage?: number | null;
  /** `page:lineId` that should be scrolled to + highlighted (after OCR) */
  focusLineKey?: string | null;
  onCoverRetype: (page: number) => void;
  onClose: () => void;
}

const keyOf = (page: number, line: PdfTextLine) => `${page}:${line.id}`;

export const PdfTextEditor: React.FC<PdfTextEditorProps> = ({
  pdfName,
  hasPdf,
  textIndex,
  extracting,
  extractProgress,
  extractError,
  currentPage,
  editedKeys,
  groqReady,
  onOpenSettings,
  onPickPdf,
  onRetryExtract,
  onFocusPage,
  onReplace,
  onRemove,
  onEditOnPage,
  onOcrPage,
  ocrBusyPage,
  focusLineKey,
  onCoverRetype,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [editing, setEditing] = useState<{ page: number; line: PdfTextLine; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [ocr, setOcr] = useState<{
    page: number;
    text: string;
    lineCount: number;
    busy: boolean;
    error: string;
  } | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(220, el.scrollHeight)}px`;
    }
  }, [editing?.line.id]);

  // Keep scope honest: when the operator flips pages, "This page" should follow.
  useEffect(() => {
    setEditing(null);
  }, [currentPage]);

  const pageText = useMemo(
    () => textIndex?.pages.find((p) => p.page === currentPage) ?? null,
    [textIndex, currentPage]
  );

  const visiblePages = useMemo(() => {
    if (!textIndex) return [];
    const pages = scope === 'page' ? textIndex.pages.filter((p) => p.page === currentPage) : textIndex.pages;
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages
      .map((p) => ({ ...p, lines: p.lines.filter((l) => l.text.toLowerCase().includes(q)) }))
      .filter((p) => p.lines.length > 0);
  }, [textIndex, scope, query, currentPage]);

  const totalLines = useMemo(
    () => (textIndex ? textIndex.pages.reduce((n, p) => n + p.lines.length, 0) : 0),
    [textIndex]
  );

  const realLines = useMemo(
    () => (pageText ? pageText.lines.filter((l) => (l.source ?? 'text') === 'text') : []),
    [pageText]
  );
  const ocrLineCount = useMemo(
    () => (pageText ? pageText.lines.filter((l) => l.source === 'ocr').length : 0),
    [pageText]
  );
  const isScanPage = Boolean(pageText) && realLines.length === 0;

  /**
   * After OCR the operator must SEE that the page became editable: scroll the
   * first AI line into view and flash it.
   */
  useEffect(() => {
    if (!focusLineKey) return;
    setScope('page');
    setQuery('');
    setEditing(null);
    setHighlightKey(focusLineKey);
    // The panel may have just mounted — give the list one frame to lay out.
    const scroll = window.setTimeout(() => {
      const el = lineRefs.current.get(focusLineKey);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    const clear = window.setTimeout(() => setHighlightKey(null), 3200);
    return () => {
      window.clearTimeout(scroll);
      window.clearTimeout(clear);
    };
  }, [focusLineKey, textIndex]);

  const copyAll = async () => {
    if (!textIndex) return;
    try {
      await navigator.clipboard.writeText(documentToPlainText(textIndex.pages));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked — the .txt download still works */
    }
  };

  const downloadTxt = () => {
    if (!textIndex) return;
    const blob = new Blob([documentToPlainText(textIndex.pages)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdfName || 'document'}-text.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const commit = () => {
    if (!editing) return;
    const value = editing.value.replace(/\r/g, '');
    if (value.trim() === editing.line.text.trim()) {
      setEditing(null);
      return;
    }
    if (!value.trim()) onRemove(editing.page, editing.line);
    else onReplace(editing.page, editing.line, value);
    setEditing(null);
  };

  const runOcr = async (page: number) => {
    if (ocr?.busy || ocrBusyPage === page) return;
    if (!groqReady) {
      // No key yet: send the operator straight to the key screen.
      onOpenSettings();
      return;
    }
    setOcr({ page, text: '', lineCount: 0, busy: true, error: '' });
    try {
      const res = await onOcrPage(page);
      setOcr({ page, text: res.text, lineCount: res.lineCount, busy: false, error: '' });
    } catch (err: any) {
      // The resolved-error message from the AI client is shown verbatim.
      setOcr({
        page,
        text: '',
        lineCount: 0,
        busy: false,
        error: String(err?.message || 'AI could not read this page.'),
      });
    }
  };

  const scannedPages = textIndex?.scannedPages ?? [];
  const ocrPanel = ocr && ocr.page === currentPage ? ocr : null;
  const busyForPage = ocrBusyPage === currentPage || ocrPanel?.busy;

  const readButtonLabel = ocrLineCount > 0 ? 'Re-read with AI' : 'Read page with AI (OCR)';

  return (
    <div className="w-full sm:w-[380px] h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-slate-800 flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-extrabold text-white">
            <Pencil className="w-4 h-4 text-emerald-400" /> Editable Text
            <span className="urdu-naskh text-emerald-400 text-xs font-normal">قابلِ ترمیم متن</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
            {hasPdf
              ? `${pdfName}.pdf · ${totalLines} line${totalLines === 1 ? '' : 's'} read`
              : 'Open a PDF to read its text automatically'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0"
          title="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!hasPdf && (
          <div className="p-4 space-y-3">
            <div className="rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-4 text-center">
              <FileText className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs text-slate-300 font-semibold mb-1">No PDF open yet</p>
              <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                Drop a PDF here. Every line of text inside it is read automatically and appears here ready to
                edit — no retyping, no whiteout maths. Scanned pages can be read with AI too.
              </p>
              <button
                onClick={onPickPdf}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Choose PDF File
              </button>
            </div>
          </div>
        )}

        {hasPdf && (extracting || extractProgress) && (
          <div className="p-4">
            <div className="rounded-xl bg-emerald-950/40 border border-emerald-800/60 p-3 flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
              <div className="text-[11px] text-emerald-200">
                <div className="font-bold">Reading the text layer…</div>
                {extractProgress && (
                  <div className="text-emerald-300/80">
                    Page {extractProgress.done} of {extractProgress.total}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {hasPdf && !extracting && extractError && (
          <div className="p-4 space-y-2">
            <div className="rounded-xl bg-rose-950/50 border border-rose-800 p-3 text-[11px] text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{extractError}</span>
            </div>
            <button
              onClick={onRetryExtract}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200"
            >
              Try reading again
            </button>
          </div>
        )}

        {hasPdf && !extracting && !extractError && textIndex && (
          <>
            {/* Search + scope */}
            <div className="px-3 pt-3 pb-2 space-y-2 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find text… (naam, date, number)"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setScope('page')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                    scope === 'page'
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  This page
                </button>
                <button
                  onClick={() => setScope('all')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                    scope === 'all'
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  All pages
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={copyAll}
                    className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                    title="Copy all text"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={downloadTxt}
                    className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                    title="Download text as .txt"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Hint */}
            <div className="mx-3 mb-2 px-2.5 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-[10.5px] text-slate-400 leading-relaxed">
              Tap any line to rewrite it in place. Or use the <strong className="text-emerald-300">Edit Text</strong>{' '}
              tool and click directly on the page — the old text is covered and the new text is typed at the same
              size and position. Lines marked{' '}
              <span className="px-1 rounded bg-amber-500/20 text-amber-300 font-bold">approx position</span> were
              read by AI from a scan, so check them before printing.
            </div>

            {/* Scanned page card — actionable, never a dead end */}
            {isScanPage && (
              <div className="mx-3 mb-2 rounded-xl bg-amber-950/40 border border-amber-700/60 p-3">
                <div className="text-[11px] text-amber-200 font-bold flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Page {currentPage} is a scan
                  {ocrLineCount > 0 && (
                    <span className="ml-auto text-[10px] font-normal text-amber-300/90">
                      {ocrLineCount} AI line{ocrLineCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="text-[10.5px] text-amber-100/80 leading-relaxed mb-2">
                  This page is a scan — it has no text layer. Either cover and retype it, or let AI read it so its
                  lines become clickable.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => runOcr(currentPage)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1.5"
                  >
                    {busyForPage ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {groqReady ? readButtonLabel : 'Add Groq key to read scans'}
                    <span className="urdu-naskh font-normal">AI سے پڑھیں</span>
                  </button>
                  <button
                    onClick={() => onCoverRetype(currentPage)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1.5"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    Cover &amp; Retype
                    <span className="urdu-naskh font-normal">ڈھانپیں اور لکھیں</span>
                  </button>
                </div>

                {ocrPanel && (ocrPanel.busy || busyForPage) && (
                  <div className="mt-2 text-[11px] text-amber-200 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading page with AI…
                  </div>
                )}

                {ocrPanel?.error && (
                  <div className="mt-2 rounded-lg bg-rose-950/60 border border-rose-800 p-2 space-y-1.5">
                    <div className="text-[11px] text-rose-200 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{ocrPanel.error}</span>
                    </div>
                    <button
                      onClick={onOpenSettings}
                      className="px-2 py-1 rounded bg-rose-900/70 hover:bg-rose-800 border border-rose-700 text-[10.5px] font-bold text-rose-100"
                    >
                      Open Groq settings
                    </button>
                  </div>
                )}

                {ocrPanel && !ocrPanel.busy && !ocrPanel.error && ocrPanel.lineCount > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[10.5px] text-emerald-300 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> {ocrPanel.lineCount} line
                      {ocrPanel.lineCount === 1 ? '' : 's'} read — they are click-to-edit above.
                    </div>
                    {ocrPanel.text && (
                      <>
                        <textarea
                          readOnly
                          value={ocrPanel.text}
                          dir="auto"
                          className="w-full h-24 p-2 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200 font-mono"
                        />
                        <button
                          onClick={() => navigator.clipboard?.writeText(ocrPanel.text).catch(() => undefined)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10.5px] font-semibold text-slate-200 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy OCR text
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Line list */}
            <div className="px-3 pb-6 space-y-3">
              {visiblePages.length === 0 && (
                <div className="text-[11px] text-slate-500 text-center py-6">
                  {query
                    ? 'No line in this document matches your search.'
                    : 'No text on this page — use “Read page with AI (OCR)” above, or try “All pages”.'}
                </div>
              )}

              {visiblePages.map((page) => (
                <div key={page.page} className="space-y-1.5">
                  {scope === 'all' && (
                    <button
                      onClick={() => onFocusPage(page.page)}
                      className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 hover:text-emerald-300 px-1"
                    >
                      Page {page.page} · {page.lines.length} lines
                    </button>
                  )}
                  {page.lines.map((line) => {
                    const isEditing = editing?.page === page.page && editing.line.id === line.id;
                    const edited = editedKeys.has(keyOf(page.page, line));
                    const rtl = line.rtl;
                    const isOcr = line.source === 'ocr';
                    const isFocused = highlightKey === keyOf(page.page, line);

                    if (isEditing) {
                      return (
                        <div
                          key={line.id}
                          className="rounded-lg border border-emerald-600 bg-slate-950 p-2 space-y-1.5"
                        >
                          <div className="text-[9.5px] text-slate-500 font-mono">
                            {line.id} · {line.fontSize.toFixed(1)} pt · {rtl ? 'RTL' : 'LTR'}
                            {isOcr ? ' · AI box (approx)' : ''}
                          </div>
                          <textarea
                            ref={textareaRef}
                            value={editing!.value}
                            dir={rtl ? 'rtl' : 'ltr'}
                            onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditing(null);
                              }
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                commit();
                              }
                            }}
                            rows={2}
                            className={`w-full p-2 rounded-md bg-slate-900 border border-slate-700 text-xs text-white outline-none focus:border-emerald-500 ${
                              rtl ? 'urdu-nastaliq' : ''
                            }`}
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={commit}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" /> Apply
                            </button>
                            <button
                              onClick={() => {
                                onRemove(page.page, line);
                                setEditing(null);
                              }}
                              className="px-2 py-1 rounded-md bg-rose-950 hover:bg-rose-900 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
                              title="Delete this line"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                onEditOnPage(page.page, line);
                                setEditing(null);
                              }}
                              className="ml-auto text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold"
                              title="Show me where this line is on the page"
                            >
                              Show on page
                            </button>
                          </div>
                          <div className="text-[9.5px] text-slate-500">
                            Enter = apply · Shift+Enter = new line · Esc = cancel
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={line.id}
                        ref={(el) => {
                          if (el) lineRefs.current.set(keyOf(page.page, line), el);
                          else lineRefs.current.delete(keyOf(page.page, line));
                        }}
                        className={`group rounded-lg border px-2 py-1.5 cursor-text transition ${
                          isFocused
                            ? 'bg-emerald-900/40 border-emerald-400 ring-2 ring-emerald-400/60'
                            : edited
                            ? 'bg-emerald-950/30 border-emerald-800/70'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-600'
                        }`}
                        onClick={() => setEditing({ page: page.page, line, value: line.text })}
                        title={
                          isOcr
                            ? 'AI estimated this line’s position from the page image — check it before printing'
                            : 'Click to edit this line'
                        }
                      >
                        <div
                          dir={rtl ? 'rtl' : 'ltr'}
                          className={`text-[11.5px] leading-relaxed text-slate-100 break-words ${
                            rtl ? 'urdu-nastaliq' : ''
                          }`}
                        >
                          {line.text}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] text-slate-500 font-mono">
                            {line.id} · {line.fontSize.toFixed(0)}pt
                          </span>
                          {rtl && (
                            <span className="text-[8.5px] px-1 rounded bg-sky-500/15 text-sky-300 font-bold">
                              اردو
                            </span>
                          )}
                          {isOcr && (
                            <span
                              className="text-[8.5px] px-1 rounded bg-amber-500/20 text-amber-300 font-bold"
                              title="AI estimated this line's position from the page image — check it before printing."
                            >
                              approx position
                            </span>
                          )}
                          {edited && (
                            <span className="text-[8.5px] px-1 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                              edited
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onFocusPage(page.page);
                            }}
                            className="ml-auto text-[9px] text-slate-500 hover:text-emerald-300 font-semibold opacity-0 group-hover:opacity-100"
                          >
                            p.{page.page} ↗
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              {scannedPages.length > 0 && scope === 'all' && (
                <div className="mt-3 rounded-lg bg-slate-950/60 border border-slate-800 p-2.5">
                  <div className="text-[10.5px] text-slate-400 font-semibold mb-1">
                    {scannedPages.length} scanned page{scannedPages.length === 1 ? '' : 's'} (no text layer)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {scannedPages.slice(0, 12).map((p) => (
                      <button
                        key={p}
                        onClick={() => onFocusPage(p)}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-mono"
                      >
                        p.{p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
