import React, { useEffect, useState } from 'react';
import { KeyRound, CheckCircle2, AlertCircle, X, Sparkles, RefreshCw, Eye, EyeOff } from 'lucide-react';
import {
  getGroqSettings,
  saveGroqSettings,
  testGroqConnection,
  GroqSettings,
} from '../lib/groqClient';

interface GroqSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export const GroqSettingsModal: React.FC<GroqSettingsModalProps> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<GroqSettings>(() => getGroqSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok?: boolean; message?: string; models?: string[] }>({});

  useEffect(() => {
    if (open) {
      setSettings(getGroqSettings());
      setStatus({});
    }
  }, [open]);

  if (!open) return null;

  const handleTest = async () => {
    setTesting(true);
    setStatus({});
    const res = await testGroqConnection(settings.apiKey);
    setTesting(false);
    if (res.ok) {
      setStatus({
        ok: true,
        message: `Connected! ${res.models.length} Groq LPU models ready for IK Computers.`,
        models: res.models,
      });
    } else {
      setStatus({
        ok: false,
        message: res.error || 'Connection failed',
      });
    }
  };

  const handleSave = () => {
    saveGroqSettings(settings);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Groq AI Engine Configuration</h3>
              <p className="text-xs text-slate-400">
                Powers Smart Urdu Suggestions, Application Writer, Translation & Document OCR
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Groq API Key (<span className="text-emerald-400 font-mono">gsk_...</span>)
            </label>
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl pl-3.5 pr-10 py-2.5 text-sm font-mono text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                Test Key
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Stored locally in your browser on this shop PC. Get a free key anytime from{' '}
              <span className="text-emerald-400 font-mono">console.groq.com/keys</span>.
            </p>
          </div>

          {status.message && (
            <div
              className={`rounded-xl p-3 text-xs flex items-start gap-2 border ${
                status.ok
                  ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-800/60 text-rose-300'
              }`}
            >
              {status.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              )}
              <span>{status.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Composing & Writer Model
              </label>
              <input
                type="text"
                value={settings.smartModel}
                onChange={(e) => setSettings({ ...settings, smartModel: e.target.value })}
                list="groq-models-list"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Instant Word Suggestion Model
              </label>
              <input
                type="text"
                value={settings.fastModel}
                onChange={(e) => setSettings({ ...settings, fastModel: e.target.value })}
                list="groq-models-list"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Vision Document OCR Model (Photo → Urdu/English Text)
            </label>
            <input
              type="text"
              value={settings.visionModel}
              onChange={(e) => setSettings({ ...settings, visionModel: e.target.value })}
              list="groq-models-list"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200"
            />
          </div>

          {status.models && status.models.length > 0 && (
            <datalist id="groq-models-list">
              {status.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <input
              type="checkbox"
              checked={settings.enableLiveSuggestions}
              onChange={(e) =>
                setSettings({ ...settings, enableLiveSuggestions: e.target.checked })
              }
              className="w-4 h-4 accent-emerald-500 rounded"
            />
            <div className="text-xs">
              <div className="font-semibold text-white flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Enable Live Groq AI Urdu Next-Word Suggestions
              </div>
              <div className="text-slate-400">
                Combines built-in instant Urdu dictionary with AI context predictions while typing
              </div>
            </div>
          </label>
        </div>

        <div className="px-5 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-end gap-2.5">
          {settings.apiKey && (
            <button
              type="button"
              onClick={() => {
                const cleared = { ...settings, apiKey: '' };
                setSettings(cleared);
                saveGroqSettings(cleared);
              }}
              className="px-3 py-2 rounded-lg text-xs text-rose-400 hover:bg-rose-950/50 mr-auto"
            >
              Clear Key
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg"
          >
            Save Groq Settings
          </button>
        </div>
      </div>
    </div>
  );
};
