import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  Smartphone,
  Sparkles,
  Printer,
  Download,
  FileText,
  Keyboard,
  Bold,
  Italic,
  Underline,
  AlignRight,
  AlignCenter,
  AlignLeft,
  ListOrdered,
  RotateCcw,
  Trash2,
  Wand2,
  Camera,
  Languages,
  Check,
  Copy,
  ExternalLink,
  Stamp,
  Table,
  Save,
  X,
} from 'lucide-react';
import {
  PHONETIC_KEY_MAP,
  KEYBOARD_ROWS,
  SHOP_TEMPLATES,
  getUrduSuggestions,
  learnUrduWordsFromText,
} from '../lib/urduEngine';
import {
  draftShopDocumentWithGroq,
  extractDocumentOcrWithGroq,
  fetchGroqUrduSuggestions,
  hasGroqKey,
  transformShopTextWithGroq,
  TextTransformMode,
} from '../lib/groqClient';
import { HybridMobileSync } from '../lib/mobileSync';

interface UrduComposerProps {
  onOpenGroqModal: () => void;
  externalInsertHtml?: { html: string; nonce: number } | null;
}

type InputMode = 'phonetic' | 'roman' | 'english';
type FontChoice = 'nastaliq' | 'gulzar' | 'naskh' | 'serif';
type PaperSize = 'a4' | 'legal' | 'stamp';
type BorderStyle = 'none' | 'single' | 'double';

const DRAFT_STORAGE_KEY = 'ik_urdu_composer_autosave_v1';

function getOrCreateRoomCode(): string {
  const existing = sessionStorage.getItem('ik_mobile_room');
  if (existing) return existing;
  const code = String(Math.floor(1000 + Math.random() * 9000));
  sessionStorage.setItem('ik_mobile_room', code);
  return code;
}

export const UrduComposer: React.FC<UrduComposerProps> = ({
  onOpenGroqModal,
  externalInsertHtml,
}) => {
  const [inputMode, setInputMode] = useState<InputMode>('phonetic');
  const [fontChoice, setFontChoice] = useState<FontChoice>('nastaliq');
  const [fontSize, setFontSize] = useState<number>(20);
  const [lineHeight, setLineHeight] = useState<number>(2.35);
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [stampTopInches, setStampTopInches] = useState<number>(3.0);
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('none');
  const [showOnScreenKb, setShowOnScreenKb] = useState<boolean>(false);
  const [shiftActive, setShiftActive] = useState<boolean>(false);

  // Word Suggestions state
  const [currentToken, setCurrentToken] = useState<string>('');
  const [prevWord, setPrevWord] = useState<string>('');
  const [localSuggestions, setLocalSuggestions] = useState<string[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  // Mobile Remote Keyboard WebSocket state
  const [roomCode] = useState<string>(getOrCreateRoomCode);
  const [mobileCount, setMobileCount] = useState<number>(0);
  const [mobileLiveText, setMobileLiveText] = useState<string>('');
  const [showMobileModal, setShowMobileModal] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [mobileUrl, setMobileUrl] = useState<string>('');
  const [lanIps, setLanIps] = useState<{ name: string; address: string }[]>([]);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // AI Composer Drawer state
  const [showAiPanel, setShowAiPanel] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiDocLang, setAiDocLang] = useState<'urdu' | 'english'>('urdu');
  const [aiBusy, setAiBusy] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>('');
  const [autoSaveTime, setAutoSaveTime] = useState<string>('Saved');

  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const syncRef = useRef<HybridMobileSync | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize editor with saved draft or default application template
  useEffect(() => {
    if (!editorRef.current) return;
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (saved && saved.trim().length > 10) {
      editorRef.current.innerHTML = saved;
    } else {
      editorRef.current.innerHTML = SHOP_TEMPLATES[0].html;
    }
    setLocalSuggestions(getUrduSuggestions('', '', 8));
  }, []);

  // Receive external HTML sent from Groq AI Hub
  useEffect(() => {
    if (externalInsertHtml && editorRef.current) {
      editorRef.current.innerHTML = externalInsertHtml.html;
      saveDraftNow();
    }
  }, [externalInsertHtml]);

  const saveDraftNow = useCallback(() => {
    if (!editorRef.current) return;
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, editorRef.current.innerHTML);
      const now = new Date();
      setAutoSaveTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    } catch {
      // ignore quota
    }
  }, []);

  // Save selection range whenever user clicks or types in editor so Mobile Keyboard inserts at exact caret!
  const rememberCaret = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  // Inspect text immediately preceding caret to drive Urdu Word Suggestions
  const updateTokenContextFromCaret = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return;

    savedRangeRef.current = range.cloneRange();

    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const textBefore = (node.textContent || '').slice(0, range.startOffset);
      const endsWithSpace = /\s$/.test(textBefore);
      const tokens = textBefore.trim().split(/\s+/).filter(Boolean);
      const cur = endsWithSpace ? '' : tokens[tokens.length - 1] || '';
      const prev = endsWithSpace
        ? tokens[tokens.length - 1] || ''
        : tokens.length >= 2
        ? tokens[tokens.length - 2]
        : '';

      setCurrentToken(cur);
      setPrevWord(prev);
      setLocalSuggestions(getUrduSuggestions(cur, prev, 8));

      // Sync last word to connected mobile phone so phone also predicts next word!
      if (endsWithSpace && prev) {
        syncRef.current?.send({ type: 'context_sync', lastWord: prev });
      }
    } else {
      setCurrentToken('');
      setLocalSuggestions(getUrduSuggestions('', prevWord, 8));
    }
  }, [prevWord]);

  // Debounced Groq AI contextual suggestions
  useEffect(() => {
    if (!hasGroqKey()) {
      setAiSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const fullText = editorRef.current?.innerText || '';
      if (fullText.trim().length < 4 && !currentToken) return;
      const cands = await fetchGroqUrduSuggestions(fullText, currentToken);
      setAiSuggestions(cands);
    }, 520);
    return () => clearTimeout(timer);
  }, [currentToken, prevWord]);

  // Insert text cleanly at caret (works for Phonetic keyboard, On-screen keyboard, AND Mobile WebSocket!)
  const insertTextAtCaret = useCallback(
    (textToInsert: string) => {
      if (!editorRef.current) return;
      editorRef.current.focus();

      const sel = window.getSelection();
      if (!sel) return;

      if (savedRangeRef.current && editorRef.current.contains(savedRangeRef.current.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      } else if (sel.rangeCount === 0 || !editorRef.current.contains(sel.anchorNode)) {
        // Place at end of editor
        const endRange = document.createRange();
        endRange.selectNodeContents(editorRef.current);
        endRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(endRange);
      }

      document.execCommand('insertText', false, textToInsert);
      rememberCaret();
      updateTokenContextFromCaret();
      saveDraftNow();
    },
    [rememberCaret, updateTokenContextFromCaret, saveDraftNow]
  );

  // Replace current partial token before caret with selected Urdu suggestion
  const applySuggestion = useCallback(
    (suggestedWord: string) => {
      if (!editorRef.current) return;
      editorRef.current.focus();

      const sel = window.getSelection();
      if (!sel) return;
      if (savedRangeRef.current && editorRef.current.contains(savedRangeRef.current.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }

      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (currentToken && range.startContainer.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset;
          const startPos = Math.max(0, offset - currentToken.length);
          const replaceRange = document.createRange();
          replaceRange.setStart(range.startContainer, startPos);
          replaceRange.setEnd(range.startContainer, offset);
          sel.removeAllRanges();
          sel.addRange(replaceRange);
        }
      }

      document.execCommand('insertText', false, suggestedWord + ' ');
      learnUrduWordsFromText(suggestedWord);
      rememberCaret();
      updateTokenContextFromCaret();
      saveDraftNow();
    },
    [currentToken, rememberCaret, updateTokenContextFromCaret, saveDraftNow]
  );

  // Connect Desktop Hybrid Mobile Sync (WebRTC Cloud for Vercel + Local WS + BroadcastChannel)
  useEffect(() => {
    const sync = new HybridMobileSync({
      room: roomCode,
      role: 'desktop',
      onStatusChange: ({ peerCount }) => {
        setMobileCount(peerCount);
      },
      onMessage: (msg) => {
        if (msg.type === 'live_composing') {
          setMobileLiveText(msg.text || '');
        } else if (msg.type === 'insert_text' && typeof msg.text === 'string') {
          setMobileLiveText('');
          insertTextAtCaret(msg.text);
        } else if (msg.type === 'command') {
          setMobileLiveText('');
          if (!editorRef.current) return;
          editorRef.current.focus();
          if (savedRangeRef.current) {
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(savedRangeRef.current);
            }
          }
          if (msg.action === 'backspace') {
            document.execCommand('delete', false);
          } else if (msg.action === 'enter') {
            document.execCommand('insertParagraph', false);
          } else if (msg.action === 'space') {
            document.execCommand('insertText', false, ' ');
          } else if (msg.action === 'undo') {
            document.execCommand('undo', false);
          }
          rememberCaret();
          updateTokenContextFromCaret();
          saveDraftNow();
        }
      },
    });
    syncRef.current = sync;
    return () => {
      sync.destroy();
    };
  }, [roomCode, insertTextAtCaret, rememberCaret, updateTokenContextFromCaret, saveDraftNow]);

  // Fetch LAN IP info & build QR Code when Mobile Modal opens
  useEffect(() => {
    const buildUrl = async () => {
      let baseOrigin = window.location.origin;
      try {
        const res = await fetch('/api/network-info');
        const info = await res.json();
        if (Array.isArray(info.lanIps)) {
          setLanIps(info.lanIps);
          if (
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
            info.lanIps.length > 0
          ) {
            baseOrigin = `http://${info.lanIps[0].address}:${info.port || window.location.port}`;
          }
        }
      } catch {
        // fallback to current origin
      }
      const target = `${baseOrigin}/?mobile=${roomCode}`;
      setMobileUrl(target);
      const qr = await QRCode.toDataURL(target, {
        width: 240,
        margin: 1,
        color: { dark: '#022c22', light: '#ffffff' },
      });
      setQrDataUrl(qr);
    };
    buildUrl();
  }, [roomCode, showMobileModal]);

  // Handle Desktop Keyboard Interceptor (Ctrl+Space switch, Alt+1..8 suggestions, Phonetic Urdu, Roman Space auto-convert)
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl + Space toggles Phonetic Urdu <-> English instantly!
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      setInputMode((m) => (m === 'english' ? 'phonetic' : 'english'));
      return;
    }

    // Alt + 1..8 selects corresponding Urdu suggestion chip!
    const mergedSuggestions = Array.from(new Set([...localSuggestions, ...aiSuggestions])).slice(
      0,
      8
    );
    if (e.altKey && e.key >= '1' && e.key <= '8') {
      const idx = Number(e.key) - 1;
      if (mergedSuggestions[idx]) {
        e.preventDefault();
        applySuggestion(mergedSuggestions[idx]);
        return;
      }
    }

    // Tab picks top suggestion when user is actively typing a word
    if (e.key === 'Tab' && currentToken.length >= 1 && mergedSuggestions[0]) {
      e.preventDefault();
      applySuggestion(mergedSuggestions[0]);
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Roman Urdu mode: pressing Space converts current ASCII word to top Urdu match!
    if (inputMode === 'roman' && e.key === ' ' && /^[a-zA-Z']+$/.test(currentToken)) {
      if (mergedSuggestions[0]) {
        e.preventDefault();
        applySuggestion(mergedSuggestions[0]);
        return;
      }
    }

    // Phonetic Urdu mode: map English keystrokes directly to Urdu characters
    if (inputMode === 'phonetic' && e.key.length === 1) {
      const mapped = PHONETIC_KEY_MAP[e.key];
      if (mapped) {
        e.preventDefault();
        document.execCommand('insertText', false, mapped);
        rememberCaret();
        updateTokenContextFromCaret();
        saveDraftNow();
      }
    }
  };

  const execCmd = (cmd: string, val?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
    }
    document.execCommand(cmd, false, val);
    saveDraftNow();
  };

  const insertSimpleTable = () => {
    const tableHtml = `
      <table dir="rtl" style="width:100%; border-collapse: collapse; margin: 12px 0; font-size: 16px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #334155; padding:6px;">نمبر شمار</th>
            <th style="border:1px solid #334155; padding:6px;">تفصیل</th>
            <th style="border:1px solid #334155; padding:6px;">تعداد / مقدار</th>
            <th style="border:1px solid #334155; padding:6px;">رقم (روپے)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #334155; padding:6px; text-align:center;">۱</td>
            <td style="border:1px solid #334155; padding:6px;"></td>
            <td style="border:1px solid #334155; padding:6px; text-align:center;"></td>
            <td style="border:1px solid #334155; padding:6px; text-align:center;"></td>
          </tr>
          <tr>
            <td style="border:1px solid #334155; padding:6px; text-align:center;">۲</td>
            <td style="border:1px solid #334155; padding:6px;"></td>
            <td style="border:1px solid #334155; padding:6px; text-align:center;"></td>
            <td style="border:1px solid #334155; padding:6px; text-align:center;"></td>
          </tr>
        </tbody>
      </table>
    `;
    execCmd('insertHTML', tableHtml);
  };

  const handleLoadTemplate = (tplId: string) => {
    const tpl = SHOP_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl || !editorRef.current) return;
    editorRef.current.innerHTML = tpl.html;
    setPaperSize(tpl.paperSize);
    if (tpl.stampTopInches) setStampTopInches(tpl.stampTopInches);
    if (tpl.dir === 'ltr') {
      setFontChoice('serif');
      setInputMode('english');
      setLineHeight(1.75);
    } else {
      setFontChoice('nastaliq');
      setInputMode('phonetic');
      setLineHeight(2.35);
    }
    saveDraftNow();
  };

  // Export Word-compatible .doc file
  const handleDownloadWord = () => {
    if (!editorRef.current) return;
    const htmlContent = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>IK Computers Document</title>
      <style>
        body { font-family: 'Jameel Noori Nastaleeq', 'Noto Nastaliq Urdu', 'Arial', serif; font-size: ${fontSize}px; line-height: ${lineHeight}; }
      </style>
      </head>
      <body>${editorRef.current.innerHTML}</body></html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IK-Computers-Composed-${Date.now()}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export crisp Print-Ready PDF (renders the formatted page via SVG foreignObject / Print or jsPDF)
  const handlePrintPaper = () => {
    window.print();
  };

  // Groq AI Actions inside Composer
  const handleAiDraft = async () => {
    if (!aiPrompt.trim()) return;
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    setAiBusy(true);
    setAiError('');
    try {
      const html = await draftShopDocumentWithGroq(aiPrompt, aiDocLang);
      if (editorRef.current && html) {
        editorRef.current.innerHTML = html;
        if (aiDocLang === 'urdu') {
          setFontChoice('nastaliq');
          setLineHeight(2.35);
        } else {
          setFontChoice('serif');
          setLineHeight(1.75);
        }
        saveDraftNow();
        setShowAiPanel(false);
        setAiPrompt('');
      }
    } catch (err: any) {
      setAiError(err?.message || 'Groq AI draft failed');
    } finally {
      setAiBusy(false);
    }
  };

  const handleAiTransform = async (mode: TextTransformMode) => {
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    if (!editorRef.current) return;
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().trim() ? sel.toString() : '';
    const sourceText = selectedText || editorRef.current.innerText;
    if (!sourceText.trim()) return;

    setAiBusy(true);
    setAiError('');
    try {
      const result = await transformShopTextWithGroq(sourceText, mode);
      if (selectedText) {
        execCmd('insertText', result);
      } else {
        const isEn = mode === 'urdu_to_en';
        editorRef.current.innerHTML = `<div dir="${isEn ? 'ltr' : 'rtl'}" style="text-align:${
          isEn ? 'left' : 'right'
        };">${result
          .split('\n')
          .map((line) => `<p>${line}</p>`)
          .join('')}</div>`;
        saveDraftNow();
      }
    } catch (err: any) {
      setAiError(err?.message || 'AI transform error');
    } finally {
      setAiBusy(false);
    }
  };

  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!hasGroqKey()) {
      onOpenGroqModal();
      return;
    }
    setAiBusy(true);
    setAiError('');
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const extracted = await extractDocumentOcrWithGroq(dataUrl);
      if (extracted && editorRef.current) {
        const htmlLines = extracted
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => `<p>${l}</p>`)
          .join('');
        editorRef.current.innerHTML += `<div dir="rtl" style="margin-top:12px;">${htmlLines}</div>`;
        saveDraftNow();
      }
    } catch (err: any) {
      setAiError(err?.message || 'Groq OCR failed');
    } finally {
      setAiBusy(false);
    }
  };

  // Merge local + AI suggestions without duplicates
  const combinedSuggestions = Array.from(new Set([...aiSuggestions, ...localSuggestions])).slice(
    0,
    8
  );

  const fontClass =
    fontChoice === 'nastaliq'
      ? 'urdu-nastaliq'
      : fontChoice === 'gulzar'
      ? 'urdu-gulzar'
      : fontChoice === 'naskh'
      ? 'urdu-naskh'
      : 'font-serif';

  const paperMinHeightPx = paperSize === 'a4' ? 1122 : 1344; // 96dpi A4 (297mm) vs Legal/Stamp (14in)

  return (
    <div className="flex flex-col h-full">
      {/* Top Composing Control Ribbon */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 space-y-2.5 no-print">
        {/* Row 1: Typing Mode + Mobile Keyboard Connect + Templates + AI + Print */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Input Mode Segmented Control */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setInputMode('phonetic')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                inputMode === 'phonetic'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              اردو فونیٹک (Phonetic)
            </button>
            <button
              type="button"
              onClick={() => setInputMode('roman')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                inputMode === 'roman'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Roman → اردو
            </button>
            <button
              type="button"
              onClick={() => setInputMode('english')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                inputMode === 'english'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              English (Ctrl+Space)
            </button>
          </div>

          {/* Mobile Keyboard Pairing Button */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMobileModal(true)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition shadow-sm ${
                mobileCount > 0
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
              }`}
            >
              <Smartphone className="w-4 h-4 text-emerald-400" />
              {mobileCount > 0
                ? `Mobile Connected (${mobileCount}) • #${roomCode}`
                : `Use Mobile Keyboard (#${roomCode})`}
            </button>

            <button
              type="button"
              onClick={() => setShowOnScreenKb((s) => !s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 ${
                showOnScreenKb
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
            >
              <Keyboard className="w-4 h-4" />
              Urdu Keys
            </button>

            {/* Templates Quick Load */}
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleLoadTemplate(e.target.value);
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-100 text-xs font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:border-emerald-500"
            >
              <option value="" disabled>
                📋 Ready Shop Templates (نمو نے)...
              </option>
              {SHOP_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.titleUr} — {t.titleEn}
                </option>
              ))}
            </select>

            {/* Groq AI Composer Button */}
            <button
              type="button"
              onClick={() => setShowAiPanel((v) => !v)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 flex items-center gap-1.5 shadow"
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI Writer & OCR
            </button>

            <input
              ref={ocrInputRef}
              type="file"
              accept="image/*"
              onChange={handleOcrUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => ocrInputRef.current?.click()}
              disabled={aiBusy}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1.5"
              title="Scan photo of old Urdu/English paper directly into editable text"
            >
              <Camera className="w-3.5 h-3.5 text-sky-400" />
              Photo → Text
            </button>

            <button
              type="button"
              onClick={handleDownloadWord}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              .DOC
            </button>

            <button
              type="button"
              onClick={handlePrintPaper}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg"
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </button>
          </div>
        </div>

        {/* Row 2: Rich Typography, Paper Size, Stamp Paper Top Offset & Formatting */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80 text-xs">
          <select
            value={fontChoice}
            onChange={(e) => setFontChoice(e.target.value as FontChoice)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200"
          >
            <option value="nastaliq">نوری نستعلیق (Noto Nastaliq)</option>
            <option value="gulzar">گلزار نستعلیق (Gulzar Display)</option>
            <option value="naskh">نسخ اردو (Noto Naskh)</option>
            <option value="serif">Times New Roman (English)</option>
          </select>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
            <span className="text-slate-400">Size:</span>
            <input
              type="number"
              min={12}
              max={56}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value) || 20)}
              className="w-11 bg-transparent text-white font-bold text-center focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
            <span className="text-slate-400">Line:</span>
            <select
              value={lineHeight}
              onChange={(e) => setLineHeight(Number(e.target.value))}
              className="bg-transparent text-white font-semibold focus:outline-none"
            >
              <option value={1.6} className="bg-slate-900">1.6x</option>
              <option value={2.0} className="bg-slate-900">2.0x</option>
              <option value={2.35} className="bg-slate-900">2.35x (Nastaliq)</option>
              <option value={2.75} className="bg-slate-900">2.75x (Loose)</option>
            </select>
          </div>

          {/* Formatting Buttons */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button onClick={() => execCmd('bold')} className="p-1.5 hover:bg-slate-800 rounded" title="Bold">
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('italic')} className="p-1.5 hover:bg-slate-800 rounded" title="Italic">
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('underline')} className="p-1.5 hover:bg-slate-800 rounded" title="Underline">
              <Underline className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-4 bg-slate-800 mx-0.5" />
            <button onClick={() => execCmd('justifyRight')} className="p-1.5 hover:bg-slate-800 rounded" title="Align Right (Urdu)">
              <AlignRight className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('justifyCenter')} className="p-1.5 hover:bg-slate-800 rounded" title="Center">
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('justifyLeft')} className="p-1.5 hover:bg-slate-800 rounded" title="Align Left (English)">
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('insertOrderedList')} className="p-1.5 hover:bg-slate-800 rounded" title="Numbered List">
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button onClick={insertSimpleTable} className="p-1.5 hover:bg-slate-800 rounded" title="Insert Urdu Table">
              <Table className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => execCmd('undo')} className="p-1.5 hover:bg-slate-800 rounded text-amber-300" title="Undo">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Paper Size & Pakistani Stamp Paper Offset */}
          <select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-emerald-300 font-semibold"
          >
            <option value="a4">A4 Paper (210×297mm)</option>
            <option value="legal">Legal Paper (8.5×14")</option>
            <option value="stamp">Stamp Paper (اسٹامپ پیپر)</option>
          </select>

          {paperSize === 'stamp' && (
            <div className="flex items-center gap-1.5 bg-amber-950/50 border border-amber-700/60 rounded-lg px-2.5 py-1 text-amber-200">
              <Stamp className="w-3.5 h-3.5 text-amber-400" />
              <span>Stamp Top Blank:</span>
              <input
                type="range"
                min={1.5}
                max={5.5}
                step={0.1}
                value={stampTopInches}
                onChange={(e) => setStampTopInches(Number(e.target.value))}
                className="w-20 accent-amber-400"
              />
              <span className="font-mono font-bold">{stampTopInches.toFixed(1)}"</span>
            </div>
          )}

          <select
            value={borderStyle}
            onChange={(e) => setBorderStyle(e.target.value as BorderStyle)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300"
          >
            <option value="none">No Page Border</option>
            <option value="single">Single Frame Border</option>
            <option value="double">Certificate Double Border</option>
          </select>

          <button
            type="button"
            onClick={() => {
              if (editorRef.current && confirm('Clear current page and start blank Urdu sheet?')) {
                editorRef.current.innerHTML = '<div dir="rtl" style="text-align:right;"><p><br/></p></div>';
                saveDraftNow();
              }
            }}
            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-rose-700 text-rose-400"
            title="Clear Page"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <span className="ml-auto text-[11px] text-slate-500 flex items-center gap-1">
            <Save className="w-3 h-3 text-emerald-500" /> Auto-saved {autoSaveTime}
          </span>
        </div>
      </div>

      {/* Groq AI Writer & Quick Transform Drawer */}
      {showAiPanel && (
        <div className="bg-slate-900/95 border-b border-amber-500/40 px-4 py-3 space-y-2.5 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <Sparkles className="w-4 h-4" />
              IK Smart Groq AI Document Writer & Translator
              {!hasGroqKey() && (
                <button
                  onClick={onOpenGroqModal}
                  className="underline text-emerald-400 ml-2 font-semibold"
                >
                  + Add Groq API Key first
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                disabled={aiBusy}
                onClick={() => handleAiTransform('roman_to_urdu')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700"
              >
                Roman → Pure اردو
              </button>
              <button
                disabled={aiBusy}
                onClick={() => handleAiTransform('en_to_urdu')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700"
              >
                English → اردو
              </button>
              <button
                disabled={aiBusy}
                onClick={() => handleAiTransform('urdu_to_en')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700"
              >
                اردو → English
              </button>
              <button
                disabled={aiBusy}
                onClick={() => handleAiTransform('fix_urdu')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300 border border-slate-700"
              >
                ✓ Fix Urdu Spelling
              </button>
              <button
                onClick={() => setShowAiPanel(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={aiDocLang}
              onChange={(e) => setAiDocLang(e.target.value as 'urdu' | 'english')}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
            >
              <option value="urdu">Write in Pure Urdu (اردو)</option>
              <option value="english">Write in Formal English</option>
            </select>
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAiDraft()}
              placeholder="Type in Roman Urdu, Urdu or English e.g. 'Sui Gas naya meter lagwane ki darkhwast likho' or 'Affidavit for domicile'..."
              className="flex-1 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
            />
            <button
              type="button"
              disabled={aiBusy}
              onClick={handleAiDraft}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0"
            >
              {aiBusy ? 'Writing...' : 'Generate Document'}
            </button>
          </div>
          {aiError && <p className="text-xs text-rose-400">{aiError}</p>}
        </div>
      )}

      {/* Sticky Live Urdu Word Suggestion Bar + Mobile Live Ghost Indicator */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Languages className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="hidden md:inline">
            Urdu Word Suggestions <span className="text-slate-500">(Tab or Alt+1..8)</span>:
          </span>
          {currentToken && (
            <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-300 font-mono text-xs">
              {currentToken}
            </span>
          )}
          {mobileLiveText && (
            <span className="px-2.5 py-0.5 rounded-full bg-sky-950 border border-sky-500/60 text-sky-300 text-xs flex items-center gap-1.5">
              <Smartphone className="w-3 h-3 animate-bounce" />
              Mobile typing: <strong className="urdu-naskh text-sm">{mobileLiveText}</strong>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 justify-end flex-1" dir="rtl">
          {combinedSuggestions.map((sug, idx) => {
            const isFromAi = aiSuggestions.includes(sug);
            return (
              <button
                key={`${sug}-${idx}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Keep focus inside contentEditable!
                  applySuggestion(sug);
                }}
                className={`urdu-nastaliq px-3 py-0.5 rounded-lg text-base border transition flex items-center gap-1.5 ${
                  idx === 0
                    ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-100 hover:bg-emerald-700'
                    : 'bg-slate-800/90 border-slate-700 text-slate-100 hover:bg-slate-700 hover:border-emerald-500/60'
                }`}
              >
                <span>{sug}</span>
                <span className="font-sans text-[10px] text-slate-400 bg-slate-950/70 px-1 rounded">
                  {isFromAi ? '✨' : idx + 1}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Optional On-Screen Interactive Urdu Phonetic Keyboard */}
      {showOnScreenKb && (
        <div className="bg-slate-900 border-b border-slate-800 px-3 py-2.5 no-print select-none">
          <div className="max-w-3xl mx-auto space-y-1.5">
            {KEYBOARD_ROWS.map((row, rIdx) => (
              <div key={rIdx} className="flex justify-center gap-1.5">
                {rIdx === 2 && (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setShiftActive((s) => !s);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                      shiftActive
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    ⇧ Shift
                  </button>
                )}
                {row.map((k) => {
                  const charOut = shiftActive && k.shiftUr ? k.shiftUr : k.ur;
                  const keyHint = shiftActive && k.shiftEn ? k.shiftEn : k.en;
                  return (
                    <button
                      key={k.en}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertTextAtCaret(charOut);
                        if (shiftActive) setShiftActive(false);
                      }}
                      className="w-14 h-11 bg-slate-800 hover:bg-emerald-700 active:scale-95 border border-slate-700 rounded-lg flex flex-col items-center justify-center transition"
                    >
                      <span className="urdu-naskh text-base font-bold text-white leading-none">
                        {charOut}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 mt-0.5">{keyHint}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Scrollable Print-Accurate Paper Canvas */}
      <div className="flex-1 overflow-y-auto bg-slate-950/90 p-4 sm:p-8 flex justify-center">
        <div
          id="ik-print-area"
          style={{
            width: '794px', // Exact 210mm A4 width at 96dpi
            minHeight: `${paperMinHeightPx}px`,
            paddingLeft: '58px',
            paddingRight: '58px',
            paddingBottom: '56px',
            paddingTop: paperSize === 'stamp' ? `${Math.round(stampTopInches * 96)}px` : '56px',
          }}
          className="relative bg-white text-black shadow-2xl rounded-sm transition-all"
        >
          {/* Visual Stamp Paper Header Blank Zone Guide (Hidden automatically when printed!) */}
          {paperSize === 'stamp' && (
            <div
              style={{ height: `${Math.round(stampTopInches * 96) - 16}px` }}
              className="no-print absolute top-2 left-4 right-4 border-2 border-dashed border-amber-400 bg-amber-50/70 rounded flex flex-col items-center justify-center text-amber-800 pointer-events-none"
            >
              <span className="text-xs font-bold tracking-wider uppercase">
                Rs. 100 / 1200 E-Stamp / Judicial Stamp Header Space ({stampTopInches.toFixed(1)} inches)
              </span>
              <span className="text-[11px]">
                This top space stays blank when printing on physical Stamp Paper
              </span>
            </div>
          )}

          {/* Optional Decorative Certificate / Notice Frame */}
          <div
            className={`min-h-[900px] ${
              borderStyle === 'single'
                ? 'border-2 border-black p-6'
                : borderStyle === 'double'
                ? 'border-4 border-double border-black p-7'
                : ''
            }`}
          >
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={handleEditorKeyDown}
              onKeyUp={updateTokenContextFromCaret}
              onMouseUp={updateTokenContextFromCaret}
              onInput={() => {
                updateTokenContextFromCaret();
                saveDraftNow();
              }}
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                minHeight: '850px',
              }}
              className={`w-full focus:outline-none text-black ${fontClass}`}
            />
          </div>
        </div>
      </div>

      {/* Mobile Keyboard QR & Live Sync Modal */}
      {showMobileModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Connect Your Mobile Urdu Keyboard
                  </h3>
                  <p className="text-xs text-slate-400">
                    Type or voice-dictate Urdu on your phone → appears live on PC!
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMobileModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-white rounded-2xl p-4 flex flex-col items-center justify-center mb-4">
              {qrDataUrl && <img src={qrDataUrl} alt="Scan on Mobile" className="w-48 h-48" />}
              <span className="mt-2 text-xs font-bold text-slate-800">
                Scan Camera / QR on Mobile • Room{' '}
                <span className="font-mono text-emerald-700 text-sm">#{roomCode}</span>
              </span>
            </div>

            {lanIps.length > 1 && (
              <div className="mb-3">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Shop Wi-Fi Network Adapter:
                </label>
                <select
                  onChange={async (e) => {
                    const nextUrl = e.target.value;
                    setMobileUrl(nextUrl);
                    const qr = await QRCode.toDataURL(nextUrl, { width: 240, margin: 1 });
                    setQrDataUrl(qr);
                  }}
                  value={mobileUrl}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value={`${window.location.origin}/?mobile=${roomCode}`}>
                    Current Browser URL ({window.location.host})
                  </option>
                  {lanIps.map((ip) => {
                    const u = `http://${ip.address}:${window.location.port || 5173}/?mobile=${roomCode}`;
                    return (
                      <option key={ip.address} value={u}>
                        Wi-Fi LAN ({ip.name}: {ip.address})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={mobileUrl}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(mobileUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copiedLink ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-xs text-slate-400">
                Status:{' '}
                <strong className={mobileCount > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                  {mobileCount > 0 ? `${mobileCount} Mobile Active` : 'Waiting for phone...'}
                </strong>
              </span>
              <a
                href={`/?mobile=${roomCode}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1"
              >
                Test Mobile Pad in New Tab <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
