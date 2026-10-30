import React, { useEffect, useRef, useState } from 'react';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Send,
  CornerDownLeft,
  Delete,
  RotateCcw,
  Sparkles,
  Languages,
  CheckCircle2,
} from 'lucide-react';
import { getUrduSuggestions, learnUrduWordsFromText } from '../lib/urduEngine';
import { HybridMobileSync } from '../lib/mobileSync';

interface MobileKeyboardViewProps {
  initialRoom: string;
  onExitMobileMode?: () => void;
}

export const MobileKeyboardView: React.FC<MobileKeyboardViewProps> = ({
  initialRoom,
  onExitMobileMode,
}) => {
  const [roomCode, setRoomCode] = useState(initialRoom.toUpperCase());
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [transportName, setTransportName] = useState('Connecting...');
  const [syncMode, setSyncMode] = useState<'instant_word' | 'sentence'>('instant_word');
  const [romanHelper, setRomanHelper] = useState(true);
  const [text, setText] = useState('');
  const [lastSentWord, setLastSentWord] = useState('');
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const syncRef = useRef<HybridMobileSync | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const sync = new HybridMobileSync({
      room: roomCode,
      role: 'mobile',
      onStatusChange: ({ connected, transport }) => {
        setDesktopOnline(connected);
        setTransportName(transport);
      },
      onMessage: (msg) => {
        if (msg.type === 'context_sync' && typeof msg.lastWord === 'string') {
          setLastSentWord(msg.lastWord);
        }
      },
    });
    syncRef.current = sync;
    return () => {
      sync.destroy();
    };
  }, [roomCode]);

  // Recompute Urdu word suggestions whenever mobile input or last word changes
  useEffect(() => {
    const trimmedEnd = text;
    const parts = trimmedEnd.split(/\s+/);
    const currentToken = trimmedEnd.endsWith(' ') ? '' : parts[parts.length - 1] || '';
    const prevWord =
      trimmedEnd.endsWith(' ')
        ? parts[parts.length - 2] || lastSentWord
        : parts.length >= 2
        ? parts[parts.length - 2]
        : lastSentWord;

    const list = getUrduSuggestions(currentToken, prevWord, 8);
    setSuggestions(list);
  }, [text, lastSentWord]);

  const transmitTextToPc = (str: string) => {
    if (!str) return;
    syncRef.current?.send({ type: 'insert_text', text: str });
    syncRef.current?.send({ type: 'live_composing', text: '' });
    learnUrduWordsFromText(str);
    const cleanWords = str.trim().split(/\s+/).filter(Boolean);
    if (cleanWords.length > 0) {
      setLastSentWord(cleanWords[cleanWords.length - 1]);
    }
    setSentHistory((prev) => [str.trim(), ...prev.filter((x) => x !== str.trim())].slice(0, 8));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;

    if (syncMode === 'instant_word') {
      if (val.endsWith('\n')) {
        const before = val.slice(0, -1);
        if (before) {
          let finalBefore = before;
          if (romanHelper && /^[a-zA-Z]+$/.test(before.trim())) {
            const cands = getUrduSuggestions(before.trim(), lastSentWord, 1);
            if (cands[0]) finalBefore = cands[0];
          }
          transmitTextToPc(finalBefore);
        }
        syncRef.current?.send({ type: 'command', action: 'enter' });
        setText('');
        return;
      }

      if (val.length > 0 && /[\s۔،؟!]$/.test(val)) {
        const trailing = val.slice(-1);
        const core = val.slice(0, -1).trim();
        if (core) {
          let wordOut = core;
          if (romanHelper && /^[a-zA-Z]+$/.test(core)) {
            const cands = getUrduSuggestions(core, lastSentWord, 1);
            if (cands[0]) wordOut = cands[0];
          }
          transmitTextToPc(wordOut + (trailing === ' ' ? ' ' : trailing + ' '));
        } else {
          transmitTextToPc(trailing);
        }
        setText('');
        return;
      }

      setText(val);
      syncRef.current?.send({ type: 'live_composing', text: val });
    } else {
      setText(val);
      syncRef.current?.send({ type: 'live_composing', text: val });
    }
  };

  const handlePickSuggestion = (word: string) => {
    if (syncMode === 'instant_word') {
      transmitTextToPc(word + ' ');
      setText('');
    } else {
      if (!text || text.endsWith(' ')) {
        const updated = text + word + ' ';
        setText(updated);
        syncRef.current?.send({ type: 'live_composing', text: updated });
      } else {
        const parts = text.split(/\s+/);
        parts[parts.length - 1] = word;
        const updated = parts.join(' ') + ' ';
        setText(updated);
        syncRef.current?.send({ type: 'live_composing', text: updated });
      }
    }
    inputRef.current?.focus();
  };

  const handleManualSend = () => {
    if (!text.trim()) return;
    let out = text;
    if (romanHelper && /^[a-zA-Z]+$/.test(text.trim())) {
      const cands = getUrduSuggestions(text.trim(), lastSentWord, 1);
      if (cands[0]) out = cands[0];
    }
    transmitTextToPc(out.endsWith(' ') ? out : out + ' ');
    setText('');
    inputRef.current?.focus();
  };

  const sendCommand = (action: 'backspace' | 'enter' | 'undo' | 'space') => {
    if (action === 'backspace' && text.length > 0) {
      const next = text.slice(0, -1);
      setText(next);
      syncRef.current?.send({ type: 'live_composing', text: next });
      return;
    }
    syncRef.current?.send({ type: 'command', action });
    inputRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-3 max-w-lg mx-auto select-none">
      {/* Compact Top Status Header */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 mb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center font-black text-white text-sm shadow">
            IK
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              IK Mobile Urdu Pad
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-[11px] flex items-center gap-1.5">
              {desktopOnline ? (
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <Wifi className="w-3 h-3" /> Live Connected to PC (#{roomCode} • {transportName})
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <WifiOff className="w-3 h-3" /> Pairing with PC Room #{roomCode}...
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs font-mono font-bold text-emerald-400"
            title="Room Code"
          />
          {onExitMobileMode && (
            <button
              onClick={onExitMobileMode}
              className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              PC View
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
        <button
          onClick={() => setSyncMode('instant_word')}
          className={`py-2 px-2 rounded-lg text-xs font-semibold border transition ${
            syncMode === 'instant_word'
              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          ⚡ Instant Live Type
        </button>
        <button
          onClick={() => setSyncMode('sentence')}
          className={`py-2 px-2 rounded-lg text-xs font-semibold border transition ${
            syncMode === 'sentence'
              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          📝 Compose & Send
        </button>
        <button
          onClick={() => setRomanHelper((v) => !v)}
          className={`py-2 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition ${
            romanHelper
              ? 'bg-sky-600/20 border-sky-500 text-sky-300'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <Languages className="w-3.5 h-3.5" />
          Roman→اردو
        </button>
      </div>

      {/* Live Urdu Word Suggestion Chips */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-2 mb-2.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 px-1">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            اردو الفاظ کی تجاویز (Tap word to insert on PC)
          </span>
          {lastSentWord && (
            <span className="urdu-naskh text-emerald-400 text-xs">آخری لفظ: {lastSentWord}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end" dir="rtl">
          {suggestions.map((sug, i) => (
            <button
              key={`${sug}-${i}`}
              type="button"
              onClick={() => handlePickSuggestion(sug)}
              className="urdu-nastaliq bg-slate-800 hover:bg-emerald-600 active:scale-95 text-white border border-slate-700 hover:border-emerald-400 rounded-lg px-3 py-1 text-base transition"
            >
              {sug}
            </button>
          ))}
        </div>
      </div>

      {/* Main Mobile Native Keyboard Typing Area */}
      <div className="relative mb-2.5">
        <textarea
          ref={inputRef}
          dir="rtl"
          lang="ur"
          rows={3}
          value={text}
          onChange={handleTextChange}
          placeholder="یہاں اپنے موبائل کے اردو کی بورڈ یا مائیک (Voice) سے ٹائپ کریں..."
          className="w-full urdu-nastaliq text-xl bg-slate-900 border-2 border-emerald-500/60 focus:border-emerald-400 rounded-xl p-3.5 text-white placeholder:text-slate-500 focus:outline-none resize-none"
          autoFocus
        />
        {text.length > 0 && (
          <button
            type="button"
            onClick={handleManualSend}
            className="absolute left-3 bottom-3 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold px-3.5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-lg"
          >
            <Send className="w-3.5 h-3.5" />
            Send to PC
          </button>
        )}
      </div>

      {/* Quick Urdu Punctuation & PC Cursor Control Keys */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <button
          type="button"
          onClick={() => transmitTextToPc('۔ ')}
          className="bg-slate-800 active:bg-slate-700 border border-slate-700 rounded-xl py-2.5 text-lg font-bold text-white"
        >
          ۔ <span className="text-[10px] text-slate-400 block font-normal">ختمہ</span>
        </button>
        <button
          type="button"
          onClick={() => transmitTextToPc('، ')}
          className="bg-slate-800 active:bg-slate-700 border border-slate-700 rounded-xl py-2.5 text-lg font-bold text-white"
        >
          ، <span className="text-[10px] text-slate-400 block font-normal">سکتہ</span>
        </button>
        <button
          type="button"
          onClick={() => transmitTextToPc('؟ ')}
          className="bg-slate-800 active:bg-slate-700 border border-slate-700 rounded-xl py-2.5 text-lg font-bold text-white"
        >
          ؟ <span className="text-[10px] text-slate-400 block font-normal">سوالیہ</span>
        </button>
        <button
          type="button"
          onClick={() => sendCommand('backspace')}
          className="bg-rose-950/60 active:bg-rose-900 border border-rose-800/70 rounded-xl py-2.5 text-xs font-bold text-rose-200 flex flex-col items-center justify-center"
        >
          <Delete className="w-4 h-4 mb-0.5" />
          Backspace
        </button>

        <button
          type="button"
          onClick={() => sendCommand('space')}
          className="col-span-2 bg-slate-800 active:bg-slate-700 border border-slate-700 rounded-xl py-2.5 text-xs font-semibold text-slate-200"
        >
          Space (فاصلہ)
        </button>
        <button
          type="button"
          onClick={() => sendCommand('enter')}
          className="bg-indigo-950/70 active:bg-indigo-900 border border-indigo-700/60 rounded-xl py-2.5 text-xs font-semibold text-indigo-200 flex items-center justify-center gap-1"
        >
          <CornerDownLeft className="w-4 h-4" /> Enter
        </button>
        <button
          type="button"
          onClick={() => sendCommand('undo')}
          className="bg-slate-800 active:bg-slate-700 border border-slate-700 rounded-xl py-2.5 text-xs font-semibold text-amber-300 flex items-center justify-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Undo
        </button>
      </div>

      {/* Recently Sent Quick Re-insert */}
      {sentHistory.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5 mt-auto">
          <div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            Sent to PC (Tap to send again):
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end" dir="rtl">
            {sentHistory.map((item, idx) => (
              <button
                key={idx}
                onClick={() => transmitTextToPc(item + ' ')}
                className="urdu-naskh text-xs bg-slate-800/80 text-slate-300 px-2.5 py-1 rounded-md border border-slate-700/70"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
