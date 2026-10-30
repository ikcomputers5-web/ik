import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  KeyRound,
  FileUp,
  Wand2,
  Eye,
  ScanText,
} from 'lucide-react';
import type { PdfTextIndex } from '../lib/pdfText';
import {
  AI_EDIT_EXAMPLES,
  PDF_EDIT_SYSTEM_PROMPT,
  buildPdfEditUserPrompt,
  parsePdfAiPlan,
  resolvePdfAiPlan,
  type AiDraft,
} from '../lib/pdfAiEdit';
import { groqJsonCompletion } from '../lib/groqClient';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  drafts?: AiDraft[];
  issues?: string[];
  applied?: boolean;
  at: number;
}

interface PdfAiAssistantProps {
  hasPdf: boolean;
  pdfName: string;
  pageCount: number;
  textIndex: PdfTextIndex | null;
  extracting: boolean;
  extractError: string | null;
  groqReady: boolean;
  onOpenSettings: () => void;
  onPickPdf: () => void;
  onApplyDrafts: (drafts: AiDraft[]) => void;
  onFocusPage: (page: number) => void;
  onClose: () => void;
}

export const PdfAiAssistant: React.FC<PdfAiAssistantProps> = ({
  hasPdf,
  pdfName,
  pageCount,
  textIndex,
  extracting,
  extractError,
  groqReady,
  onOpenSettings,
  onPickPdf,
  onApplyDrafts,
  onFocusPage,
  onClose,
}) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy, error]);

  const scanned = Boolean(textIndex && textIndex.totalChars < 25);

  const send = async (rawInstruction?: string) => {
    const instruction = (rawInstruction ?? input).trim();
    if (!instruction || busy) return;
    if (!hasPdf) {
      setError('Please open a PDF first.');
      return;
    }
    if (!textIndex) {
      setError(extracting ? 'Still reading the PDF text…' : 'Could not read the PDF text layer.');
      return;
    }
    if (!groqReady) {
      setError('Add your Groq API key to use the AI assistant.');
      return;
    }

    setError(null);
    setBusy(true);
    setInput('');
    const userMsg: AiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: instruction,
      at: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const raw = await groqJsonCompletion(
        PDF_EDIT_SYSTEM_PROMPT,
        buildPdfEditUserPrompt(textIndex, instruction),
        { temperature: 0.15, maxTokens: 1800 }
      );
      const plan = parsePdfAiPlan(raw);
      const { drafts, issues } = resolvePdfAiPlan(plan, textIndex);
      const replyText =
        plan.reply?.trim() ||
        (drafts.length
          ? `I prepared ${drafts.length} change${drafts.length === 1 ? '' : 's'} for you.`
          : 'I could not prepare any change for this instruction.');

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: replyText,
          drafts,
          issues,
          at: Date.now(),
        },
      ]);
    } catch (err: any) {
      setError(err?.message || 'The AI request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyMessage = (msg: AiChatMessage) => {
    if (!msg.drafts || msg.drafts.length === 0) return;
    onApplyDrafts(msg.drafts);
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, applied: true } : m)));
  };

  return (
    <div className="w-[380px] max-w-full h-full bg-slate-900 border-l border-slate-800 flex flex-col shrink-0">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-gradient-to-r from-emerald-950/60 to-slate-900">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-600/20 text-emerald-300 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate">AI PDF Assistant</div>
            <div className="text-[10px] text-slate-400 truncate">
              {hasPdf
                ? `${pdfName || 'document'}.pdf · ${pageCount} page${pageCount === 1 ? '' : 's'}`
                : 'Open a PDF to begin'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {!hasPdf && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 text-center space-y-3">
            <FileUp className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-xs text-slate-300">
              Upload the customer PDF and tell me what to <strong>replace</strong>,{' '}
              <strong>add</strong> or <strong>remove</strong>.
            </p>
            <button
              onClick={onPickPdf}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              Choose PDF File
            </button>
          </div>
        )}

        {hasPdf && extracting && (
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            Reading every page of the PDF…
          </div>
        )}

        {hasPdf && extractError && (
          <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-xl px-3 py-2.5">
            {extractError}
          </div>
        )}

        {hasPdf && scanned && (
          <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-600/50 rounded-xl px-3 py-2.5 flex gap-2">
            <ScanText className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This PDF appears to be a <strong>scanned photo</strong> (no text layer), so AI cannot
              locate exact text. Type the text you want added, or use Whiteout + Add Text manually.
            </span>
          </div>
        )}

        {messages.length === 0 && hasPdf && !extracting && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Examples — write in English, Roman Urdu or Urdu:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AI_EDIT_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  disabled={busy || !textIndex}
                  className="text-[11px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-left disabled:opacity-40"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div
              className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-lg bg-emerald-600/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}
              <div
                className={`max-w-[85%] text-xs rounded-2xl px-3 py-2 leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-emerald-600 text-white rounded-br-sm'
                    : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                } ${m.text.length > 0 && /[\u0600-\u06FF]/.test(m.text) ? 'urdu-naskh' : ''}`}
                dir={/[\u0600-\u06FF]/.test(m.text) ? 'rtl' : 'ltr'}
              >
                {m.text}
              </div>
              {m.role === 'user' && (
                <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>

            {m.role === 'assistant' && m.issues && m.issues.length > 0 && (
              <div className="ml-8 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-700/50 rounded-xl px-2.5 py-2 space-y-1">
                {m.issues.map((iss, i) => (
                  <div key={i} className="flex gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{iss}</span>
                  </div>
                ))}
              </div>
            )}

            {m.role === 'assistant' && m.drafts && m.drafts.length > 0 && (
              <div className="ml-8 bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-400 font-bold">
                  <Wand2 className="w-3 h-3" /> Proposed changes
                </div>
                {m.drafts.map((d) => (
                  <div key={d.id} className="text-[11px] text-slate-200 space-y-1">
                    <button
                      onClick={() => onFocusPage(d.page)}
                      className="text-left flex items-start gap-1.5 hover:text-emerald-300"
                      title="Jump to this page"
                    >
                      <Eye className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                      <span className="break-words">{d.label}</span>
                    </button>
                    {d.warnings.map((w, i) => (
                      <div key={i} className="text-[10px] text-amber-300 pl-4">
                        {w}
                      </div>
                    ))}
                  </div>
                ))}
                <button
                  onClick={() => applyMessage(m)}
                  disabled={m.applied}
                  className={`w-full py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                    m.applied
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {m.applied ? 'Applied to document' : 'Apply to document'}
                </button>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            Analysing the document and planning the edits…
          </div>
        )}

        {error && (
          <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded-xl px-3 py-2.5 space-y-2">
            <div className="flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            {!groqReady && (
              <button
                onClick={onOpenSettings}
                className="w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold flex items-center justify-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5" /> Add Groq API Key
              </button>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="p-2.5 border-t border-slate-800 space-y-2">
        {!groqReady && (
          <button
            onClick={onOpenSettings}
            className="w-full py-1.5 rounded-lg bg-amber-500/15 border border-amber-600/60 text-amber-300 text-[11px] font-bold flex items-center justify-center gap-1.5"
          >
            <KeyRound className="w-3.5 h-3.5" /> Groq key needed for AI
          </button>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder='e.g. "Ahmed ko Bilal se replace karo" or "Add Approved stamp text at the bottom"'
            className="flex-1 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-2.5 py-2 text-xs text-white resize-none outline-none"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim() || !hasPdf}
            className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center shrink-0"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          AI white-outs the old text and draws the new text in its exact place. Always check the
          preview before printing.
        </p>
      </div>
    </div>
  );
};
