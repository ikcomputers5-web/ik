import React, { useEffect, useState } from 'react';
import {
  FileEdit,
  FileText,
  ImagePlus,
  Scissors,
  IdCard,
  Camera,
  GraduationCap,
  Wrench,
  KeyRound,
  Smartphone,
  Menu,
  X,
  CheckCircle2,
} from 'lucide-react';
import { LiveComposing } from './components/LiveComposing';
import { UrduComposer } from './components/UrduComposer';
import { IdCardPageMaker } from './components/IdCardPageMaker';
import { PdfStudio } from './components/PdfStudio';
import { ImageToPdfStudio } from './components/ImageToPdfStudio';
import { BackgroundRemoverStudio } from './components/BackgroundRemoverStudio';
import { IdAndPassportStudio } from './components/IdAndPassportStudio';
import { CvBuilderStudio } from './components/CvBuilderStudio';
import { ShopUtilitiesHub } from './components/ShopUtilitiesHub';
import { MobileKeyboardView } from './components/MobileKeyboardView';
import { GroqSettingsModal } from './components/GroqSettingsModal';
import { hasGroqKey } from './lib/groqClient';

type ModuleKey =
  | 'live_composing'
  | 'urdu_composer'
  | 'id_card_maker'
  | 'pdf_studio'
  | 'img_to_pdf'
  | 'bg_remover'
  | 'id_passport'
  | 'cv_builder'
  | 'shop_tools';

export const App: React.FC = () => {
  // Check if opened on phone via ?mobile=ROOM_CODE QR link!
  const [mobileRoomParam, setMobileRoomParam] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mobile');
  });

  const [activeModule, setActiveModule] = useState<ModuleKey>(new URLSearchParams(window.location.search).has('live') ? 'live_composing' : 'urdu_composer');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [groqModalOpen, setGroqModalOpen] = useState<boolean>(false);
  const [groqConfigured, setGroqConfigured] = useState<boolean>(() => hasGroqKey());

  // Cross-module handoff states
  const [passportIncomingPhoto, setPassportIncomingPhoto] = useState<string | null>(null);
  const [composerIncomingHtml, setComposerIncomingHtml] = useState<{
    html: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    const onUpdate = () => setGroqConfigured(hasGroqKey());
    window.addEventListener('ik-groq-updated', onUpdate);
    return () => window.removeEventListener('ik-groq-updated', onUpdate);
  }, []);

  const liveMobileRoom = new URLSearchParams(window.location.search).get('mobilelive');
  if (liveMobileRoom) return <LiveComposing mobile initialRoom={liveMobileRoom} />;

  if (mobileRoomParam) {
    return (
      <MobileKeyboardView
        initialRoom={mobileRoomParam}
        onExitMobileMode={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('mobile');
          window.history.replaceState({}, '', url.toString());
          setMobileRoomParam(null);
        }}
      />
    );
  }

  const navItems: {
    key: ModuleKey;
    labelEn: string;
    labelUr: string;
    badge?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: 'live_composing', labelEn: 'Live Mobile Composing', labelUr: 'موبائل سے براہ راست لکھیں', badge: 'Live', icon: Smartphone },
    {
      key: 'urdu_composer',
      labelEn: 'Urdu & Doc Composer',
      labelUr: 'اردو کمپوزنگ اسٹوڈیو',
      badge: 'Mobile Sync',
      icon: FileEdit,
    },
    {
      key: 'id_card_maker',
      labelEn: 'Front & Back ID Page',
      labelUr: 'شناختی کارڈ فرنٹ بیک پیج',
      badge: 'Ctrl+V',
      icon: IdCard,
    },
    {
      key: 'pdf_studio',
      labelEn: 'PDF Editor + AI Assistant',
      labelUr: 'پی ڈی ایف ایڈیٹر و اے آئی',
      badge: 'AI',
      icon: FileText,
    },
    {
      key: 'img_to_pdf',
      labelEn: 'Image → PDF & Cleaner',
      labelUr: 'تصویر سے پی ڈی ایف',
      badge: 'Toner Saver',
      icon: ImagePlus,
    },
    {
      key: 'bg_remover',
      labelEn: 'AI Background Remover',
      labelUr: 'بیک گراؤنڈ ریموور',
      badge: 'AI',
      icon: Scissors,
    },
    {
      key: 'id_passport',
      labelEn: 'Passport Photo Sheet',
      labelUr: 'پاسپورٹ سائز فوٹو شیٹ',
      icon: Camera,
    },
    {
      key: 'cv_builder',
      labelEn: 'Quick CV / Resume',
      labelUr: 'سی وی میکر',
      icon: GraduationCap,
    },
    {
      key: 'shop_tools',
      labelEn: 'AI OCR, <20KB & Bill POS',
      labelUr: 'اے آئی، کمپریسر و بل',
      icon: Wrench,
    },
  ];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100">
      {/* Top Shop Brand Header */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between shrink-0 no-print">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg bg-slate-800 text-slate-200"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center font-black text-white text-base shadow-lg shadow-emerald-950">
              IK
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white tracking-tight text-sm sm:text-base">
                  IK COMPUTERS
                </span>
                <span className="hidden sm:inline urdu-nastaliq text-emerald-400 text-sm">
                  آئی کے کمپیوٹرز
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-none hidden md:block">
                All-in-One Urdu Composing • Front/Back ID Page • PDF Studio • BG Remover & Print Hub
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const room = sessionStorage.getItem('ik_mobile_room') || '4829';
              window.open(`/?mobile=${room}`, '_blank');
            }}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200"
            title="Open Mobile Urdu Keyboard Pad"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            Mobile Pad
          </button>

          <button
            onClick={() => setGroqModalOpen(true)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition ${
              groqConfigured
                ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300 hover:bg-emerald-900/60'
                : 'bg-amber-500/20 border-amber-500/60 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            {groqConfigured ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Groq AI Ready
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                Add Groq Key
              </>
            )}
          </button>
        </div>
      </header>

      {/* Body Layout: Sidebar + Active Studio */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Navigation */}
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          } fixed lg:static inset-y-14 left-0 z-40 w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-3 transition-transform duration-200 shrink-0 no-print`}
        >
          <nav className="space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveModule(item.key);
                    setSidebarOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5 transition border ${
                    active
                      ? 'bg-emerald-600/20 border-emerald-500/60 text-white shadow'
                      : 'border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      active ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate">{item.labelEn}</span>
                      {item.badge && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div className="urdu-naskh text-[11px] text-slate-400 truncate">
                      {item.labelUr}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Bottom Shop Shortcut Card */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-emerald-400 flex items-center justify-between">
              <span>⚡ Quick Shop Shortcuts</span>
            </div>
            <div>• <strong className="text-slate-200">Ctrl + Space</strong>: Urdu ↔ English</div>
            <div>• <strong className="text-slate-200">Tab / Alt+1..8</strong>: Pick Urdu Word</div>
            <div>• <strong className="text-slate-200">Ctrl + V</strong>: Paste CNIC Image</div>
          </div>
        </aside>

        {/* Main Active Tool Workspace */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {activeModule === 'urdu_composer' && (
            <UrduComposer
              onOpenGroqModal={() => setGroqModalOpen(true)}
              externalInsertHtml={composerIncomingHtml}
            />
          )}

          {activeModule === 'live_composing' && <LiveComposing />}

          {activeModule === 'id_card_maker' && <IdCardPageMaker />}

          {activeModule === 'pdf_studio' && (
            <PdfStudio onOpenGroqModal={() => setGroqModalOpen(true)} />
          )}

          {activeModule === 'img_to_pdf' && <ImageToPdfStudio />}

          {activeModule === 'bg_remover' && (
            <BackgroundRemoverStudio
              onSendToPassportMaker={(imgDataUrl) => {
                setPassportIncomingPhoto(imgDataUrl);
                setActiveModule('id_passport');
              }}
            />
          )}

          {activeModule === 'id_passport' && (
            <IdAndPassportStudio incomingPassportPhoto={passportIncomingPhoto} />
          )}

          {activeModule === 'cv_builder' && (
            <CvBuilderStudio onOpenGroqModal={() => setGroqModalOpen(true)} />
          )}

          {activeModule === 'shop_tools' && (
            <ShopUtilitiesHub
              onOpenGroqModal={() => setGroqModalOpen(true)}
              onSendHtmlToComposer={(html) => {
                setComposerIncomingHtml({ html, nonce: Date.now() });
                setActiveModule('urdu_composer');
              }}
            />
          )}
        </main>
      </div>

      {/* Groq API Key Configuration Modal */}
      <GroqSettingsModal open={groqModalOpen} onClose={() => setGroqModalOpen(false)} />
    </div>
  );
};
