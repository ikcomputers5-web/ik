import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  IdCard,
  Printer,
  Download,
  RotateCw,
  ArrowLeftRight,
  Crop,
  Sparkles,
  Upload,
  Check,
  X,
  ClipboardPaste,
  Trash2,
  Plus,
  Copy,
  ChevronUp,
  ChevronDown,
  LayoutGrid,
  Users,
  Layers,
  Wand2,
  Scissors,
  Type,
  Save,
  RotateCcw,
} from 'lucide-react';
import {
  DocFilterMode,
  loadImageElement,
  renderFilteredDocumentCanvas,
} from '../lib/imageFilters';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CardSideState {
  rawUrl: string;
  rotation90: number;
  fineTilt: number;
  crop: CropRect;
}

const DEFAULT_SIDE: CardSideState = {
  rawUrl: '',
  rotation90: 0,
  fineTilt: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
};

interface CardEntry {
  id: string;
  label: string;
  front: CardSideState;
  back: CardSideState;
  copies: number; // 1..4 per card
}

type LayoutStyle = 'grid_fill' | 'side_by_side' | 'stacked_vertical' | 'duplex_2page';
type SizePreset = 'exact_100' | 'medium_110' | 'large_125' | 'mini_70';
type VerticalSlot = 'top' | 'middle' | 'bottom_half' | 'custom';
type CutGuide = 'solid' | 'dashed' | 'corner' | 'none';

let cardSeq = 0;
const newCardId = () => `card-${Date.now()}-${cardSeq++}`;
const createCard = (n: number, label?: string): CardEntry => ({
  id: newCardId(),
  label: label ?? `Person ${n}`,
  front: { ...DEFAULT_SIDE },
  back: { ...DEFAULT_SIDE },
  copies: 1,
});

const STORAGE_KEY = 'ik_id_cards_multi_v1';

function loadSaved(): { cards: CardEntry[]; layout: LayoutStyle; sizePreset: SizePreset; footer: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.cards) || parsed.cards.length === 0) return null;
    // basic validation
    const cards: CardEntry[] = parsed.cards.map((c: any, i: number) => ({
      id: c.id || newCardId(),
      label: c.label || `Person ${i + 1}`,
      front: { ...DEFAULT_SIDE, ...(c.front || {}) },
      back: { ...DEFAULT_SIDE, ...(c.back || {}) },
      copies: Math.max(1, Math.min(4, Number(c.copies) || 1)),
    }));
    return {
      cards,
      layout: parsed.layout || 'grid_fill',
      sizePreset: parsed.sizePreset || 'exact_100',
      footer: parsed.footer || '',
    };
  } catch {
    return null;
  }
}

export const IdCardPageMaker: React.FC = () => {
  const savedRef = useRef(loadSaved());

  const [cards, setCards] = useState<CardEntry[]>(() => {
    if (savedRef.current) return savedRef.current.cards;
    return [createCard(1)];
  });
  const [selectedCardId, setSelectedCardId] = useState<string>(() => {
    if (savedRef.current) return savedRef.current.cards[0].id;
    return '';
  });
  // fix initial selected if empty (createCard id generated inside initializer above is different)
  useEffect(() => {
    if (!selectedCardId && cards[0]) setSelectedCardId(cards[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pasteTarget, setPasteTarget] = useState<{ cardId: string; side: 'front' | 'back' }>({
    cardId: selectedCardId || '',
    side: 'front',
  });

  // keep pasteTarget in sync when cards first load
  useEffect(() => {
    if (!pasteTarget.cardId && cards[0]) {
      setPasteTarget({ cardId: cards[0].id, side: 'front' });
      setSelectedCardId(cards[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  // Crop modal
  const [cropEditing, setCropEditing] = useState<{ cardId: string; side: 'front' | 'back' } | null>(null);
  const [tempCrop, setTempCrop] = useState<CropRect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [tempRot90, setTempRot90] = useState<number>(0);
  const [tempTilt, setTempTilt] = useState<number>(0);
  const [rotatedPreviewForCrop, setRotatedPreviewForCrop] = useState<string>('');

  // Sheet settings
  const [layout, setLayout] = useState<LayoutStyle>(() => savedRef.current?.layout || 'grid_fill');
  const [sizePreset, setSizePreset] = useState<SizePreset>(() => savedRef.current?.sizePreset || 'exact_100');
  const [verticalSlot, setVerticalSlot] = useState<VerticalSlot>('top');
  const [customTopMm, setCustomTopMm] = useState<number>(16);
  const [filterMode, setFilterMode] = useState<DocFilterMode>('cnic_photostat');
  const [brightness, setBrightness] = useState<number>(0);
  const [contrast, setContrast] = useState<number>(8);
  const [roundedCorners, setRoundedCorners] = useState<boolean>(true);
  const [cutGuide, setCutGuide] = useState<CutGuide>('solid');
  const [crossWatermark, setCrossWatermark] = useState<string>('');
  const [autoFit, setAutoFit] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [footer, setFooter] = useState<string>(() => savedRef.current?.footer || '');
  const [savedAt, setSavedAt] = useState<string>('');

  // Rendered pages
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [building, setBuilding] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });

  // ---------- helpers ----------
  const updateCard = useCallback((id: string, patch: Partial<CardEntry>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const updateSide = useCallback((cardId: string, side: 'front' | 'back', patch: Partial<CardSideState>) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, [side]: { ...c[side], ...patch } } : c))
    );
  }, []);

  const selectSlot = (cardId: string, side: 'front' | 'back') => {
    setSelectedCardId(cardId);
    setPasteTarget({ cardId, side });
  };

  const addCard = useCallback(() => {
    setCards((prev) => {
      const nc = createCard(prev.length + 1);
      // select new card after state update via timeout microtask
      setTimeout(() => {
        setSelectedCardId(nc.id);
        setPasteTarget({ cardId: nc.id, side: 'front' });
      }, 0);
      return [...prev, nc];
    });
  }, []);

  const ensureCards = useCallback((n: number) => {
    setCards((prev) => {
      if (prev.length >= n) return prev;
      const next = [...prev];
      for (let i = prev.length; i < n; i++) next.push(createCard(i + 1));
      return next;
    });
  }, []);

  const duplicateCard = (id: string) => {
    setCards((prev) => {
      const src = prev.find((c) => c.id === id);
      if (!src) return prev;
      const copy: CardEntry = {
        ...src,
        id: newCardId(),
        label: `${src.label} copy`,
        front: { ...src.front, crop: { ...src.front.crop } },
        back: { ...src.back, crop: { ...src.back.crop } },
      };
      const idx = prev.findIndex((c) => c.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      setTimeout(() => {
        setSelectedCardId(copy.id);
        setPasteTarget({ cardId: copy.id, side: 'front' });
      }, 0);
      return next;
    });
  };

  const removeCard = (id: string) => {
    setCards((prev) => {
      if (prev.length <= 1) {
        // clear the only card instead of removing
        return [{ ...prev[0], front: { ...DEFAULT_SIDE }, back: { ...DEFAULT_SIDE } }];
      }
      const next = prev.filter((c) => c.id !== id);
      if (selectedCardId === id && next[0]) {
        setTimeout(() => {
          setSelectedCardId(next[0].id);
          setPasteTarget({ cardId: next[0].id, side: 'front' });
        }, 0);
      }
      return next;
    });
  };

  const moveCard = (id: string, dir: -1 | 1) => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const clearAll = () => {
    const nc = createCard(1);
    setCards([nc]);
    setSelectedCardId(nc.id);
    setPasteTarget({ cardId: nc.id, side: 'front' });
    setPageIndex(0);
  };

  // ---------- paste (Ctrl+V) with auto-advance across cards ----------
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((it) => it.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;
      // don't hijack paste inside text inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const url = await fileToDataUrl(file);

      // resolve target card (fallback to first empty slot)
      let targetCard = cards.find((c) => c.id === pasteTarget.cardId) || cards[0];
      if (!targetCard) return;
      let side = pasteTarget.side;

      // if chosen side already filled and other side empty, fill the empty one instead
      if (side === 'front' && targetCard.front.rawUrl && !targetCard.back.rawUrl) side = 'back';
      if (side === 'back' && targetCard.back.rawUrl && !targetCard.front.rawUrl) side = 'front';

      if (side === 'front') {
        updateSide(targetCard.id, 'front', { ...DEFAULT_SIDE, rawUrl: url });
        setSelectedCardId(targetCard.id);
        setPasteTarget({ cardId: targetCard.id, side: 'back' });
      } else {
        updateSide(targetCard.id, 'back', { ...DEFAULT_SIDE, rawUrl: url });
        // advance to next card's front, or create a new card
        const idx = cards.findIndex((c) => c.id === targetCard.id);
        const next = cards[idx + 1];
        if (next) {
          setSelectedCardId(next.id);
          setPasteTarget({ cardId: next.id, side: 'front' });
        } else {
          const nc = createCard(cards.length + 1);
          setCards((prev) => [...prev, nc]);
          setSelectedCardId(nc.id);
          setPasteTarget({ cardId: nc.id, side: 'front' });
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [cards, pasteTarget, updateSide]);

  // ---------- bulk upload: pair files sequentially ----------
  const handleBulkFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    // build new cards array
    let nextCards = [...cards];
    const needed = Math.ceil(files.length / 2);
    while (nextCards.length < needed) {
      nextCards.push(createCard(nextCards.length + 1));
    }
    // if first card is empty and we have many files, start from card 0; otherwise append from first empty?
    // Simple predictable behaviour: fill from card 0 sequentially (overwrite), which matches "select both" old behaviour for 2 files.
    for (let i = 0; i < files.length; i++) {
      const cardIdx = Math.floor(i / 2);
      const side: 'front' | 'back' = i % 2 === 0 ? 'front' : 'back';
      const url = await fileToDataUrl(files[i]);
      nextCards[cardIdx] = {
        ...nextCards[cardIdx],
        [side]: { ...DEFAULT_SIDE, rawUrl: url },
      };
    }
    setCards(nextCards);
    const lastCard = nextCards[Math.min(needed - 1, nextCards.length - 1)];
    if (lastCard) {
      setSelectedCardId(lastCard.id);
      setPasteTarget({ cardId: lastCard.id, side: 'back' });
    }
  };

  const handleSingleUpload = async (cardId: string, side: 'front' | 'back', file: File | undefined) => {
    if (!file) return;
    const url = await fileToDataUrl(file);
    updateSide(cardId, side, { ...DEFAULT_SIDE, rawUrl: url });
    selectSlot(cardId, side === 'front' ? 'back' : 'front');
    // if front just filled, focus back of same card; if back filled, focus next card front
    if (side === 'back') {
      const idx = cards.findIndex((c) => c.id === cardId);
      const next = cards[idx + 1];
      if (next) selectSlot(next.id, 'front');
    }
  };

  // ---------- auto-save (load-shedding safe) ----------
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        const payload = { cards, layout, sizePreset, footer, savedAt: new Date().toISOString() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setSavedAt(new Date().toLocaleTimeString());
      } catch {
        // quota exceeded — keep working in-memory, don't crash
      }
    }, 900);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [cards, layout, sizePreset, footer]);

  // ---------- render single card canvas ----------
  const renderCardCanvas = useCallback(
    async (side: CardSideState): Promise<HTMLCanvasElement | null> => {
      if (!side.rawUrl) return null;
      const img = await loadImageElement(side.rawUrl);
      const swap = side.rotation90 % 180 !== 0;
      const baseW = swap ? img.height : img.width;
      const baseH = swap ? img.width : img.height;
      const rotCanvas = document.createElement('canvas');
      rotCanvas.width = baseW;
      rotCanvas.height = baseH;
      const rCtx = rotCanvas.getContext('2d')!;
      rCtx.fillStyle = '#ffffff';
      rCtx.fillRect(0, 0, baseW, baseH);
      rCtx.save();
      rCtx.translate(baseW / 2, baseH / 2);
      rCtx.rotate(((side.rotation90 + side.fineTilt) * Math.PI) / 180);
      rCtx.drawImage(img, -img.width / 2, -img.height / 2);
      rCtx.restore();

      const cx = Math.round(side.crop.x * baseW);
      const cy = Math.round(side.crop.y * baseH);
      const cw = Math.max(20, Math.round(side.crop.w * baseW));
      const ch = Math.max(20, Math.round(side.crop.h * baseH));

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cw;
      croppedCanvas.height = ch;
      const cCtx = croppedCanvas.getContext('2d')!;
      cCtx.drawImage(rotCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

      const croppedImg = await loadImageElement(croppedCanvas.toDataURL('image/jpeg', 0.96));
      return renderFilteredDocumentCanvas(croppedImg, {
        filter: filterMode,
        rotation: 0,
        brightness,
        contrast,
        maxDimension: 1400,
      });
    },
    [filterMode, brightness, contrast]
  );

  // ---------- crop modal preview ----------
  useEffect(() => {
    if (!cropEditing) {
      setRotatedPreviewForCrop('');
      return;
    }
    const card = cards.find((c) => c.id === cropEditing.cardId);
    const side = card ? card[cropEditing.side] : null;
    if (!side?.rawUrl) return;
    let cancelled = false;
    (async () => {
      const img = await loadImageElement(side.rawUrl);
      const swap = tempRot90 % 180 !== 0;
      const w = swap ? img.height : img.width;
      const h = swap ? img.width : img.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(((tempRot90 + tempTilt) * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (!cancelled) setRotatedPreviewForCrop(c.toDataURL('image/jpeg', 0.9));
    })();
    return () => {
      cancelled = true;
    };
  }, [cropEditing, cards, tempRot90, tempTilt]);

  // ---------- stats ----------
  const stats = useMemo(() => {
    const filled = cards.filter((c) => c.front.rawUrl || c.back.rawUrl);
    const sides = cards.reduce(
      (n, c) => n + (c.front.rawUrl ? 1 : 0) + (c.back.rawUrl ? 1 : 0),
      0
    );
    const tiles = cards.reduce(
      (n, c) => n + ((c.front.rawUrl ? 1 : 0) + (c.back.rawUrl ? 1 : 0)) * Math.max(1, c.copies),
      0
    );
    return { filledCount: filled.length, sides, tiles };
  }, [cards]);

  // ---------- sheet renderer (multi-card, multi-page) ----------
  useEffect(() => {
    const hasAny = cards.some((c) => c.front.rawUrl || c.back.rawUrl);
    if (!hasAny) {
      setPages([]);
      setBuilding(false);
      return;
    }
    let cancelled = false;
    setBuilding(true);

    const generateSheets = async () => {
      const pxPerMm = 9.5;
      const a4W = Math.round(210 * pxPerMm);
      const a4H = Math.round(297 * pxPerMm);

      const cardMm =
        sizePreset === 'exact_100'
          ? { w: 85.6, h: 54.0 }
          : sizePreset === 'medium_110'
          ? { w: 94.0, h: 59.3 }
          : sizePreset === 'large_125'
          ? { w: 107.0, h: 67.5 }
          : { w: 70.0, h: 44.0 }; // mini_70

      let cardW = Math.round(cardMm.w * pxPerMm);
      let cardH = Math.round(cardMm.h * pxPerMm);
      const cornerR = Math.round(3.2 * pxPerMm);
      const gapMm = sizePreset === 'large_125' ? 6 : 10;
      const gapPx = Math.round(gapMm * pxPerMm);
      const labelH = showLabels ? Math.round(7 * pxPerMm) : 0;
      const rowH = cardH + labelH;

      // render each side once
      const rendered = new Map<string, HTMLCanvasElement | null>();
      for (const card of cards) {
        rendered.set(`${card.id}-front`, await renderCardCanvas(card.front));
        rendered.set(`${card.id}-back`, await renderCardCanvas(card.back));
      }
      if (cancelled) return;

      type Tile = { canvas: HTMLCanvasElement | null; label: string; sideLabel: string };
      type Pair = { front: HTMLCanvasElement | null; back: HTMLCanvasElement | null; label: string };

      const tiles: Tile[] = [];
      const pairs: Pair[] = [];
      for (const card of cards) {
        const copies = Math.max(1, Math.min(4, card.copies || 1));
        for (let k = 0; k < copies; k++) {
          const f = rendered.get(`${card.id}-front`) || null;
          const b = rendered.get(`${card.id}-back`) || null;
          if (f) tiles.push({ canvas: f, label: card.label, sideLabel: 'Front' });
          if (b) tiles.push({ canvas: b, label: card.label, sideLabel: 'Back' });
          if (f || b) pairs.push({ front: f, back: b, label: card.label });
        }
      }

      const drawCardOnSheet = (
        ctx: CanvasRenderingContext2D,
        cardCanvas: HTMLCanvasElement,
        x: number,
        y: number,
        w: number,
        h: number,
        radiusPx: number,
        labelText?: string
      ) => {
        ctx.save();
        if (roundedCorners) {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, radiusPx);
          ctx.clip();
        }
        ctx.drawImage(cardCanvas, x, y, w, h);
        if (crossWatermark.trim()) {
          ctx.save();
          ctx.translate(x + w / 2, y + h / 2);
          ctx.rotate(-0.32);
          ctx.font = `bold ${Math.round(h * 0.075)}px sans-serif`;
          ctx.fillStyle = 'rgba(220, 38, 38, 0.32)';
          ctx.textAlign = 'center';
          ctx.fillText(crossWatermark.trim().toUpperCase(), 0, 0);
          ctx.restore();
        }
        ctx.restore();

        // cut guide
        if (cutGuide !== 'none') {
          ctx.save();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 2;
          if (cutGuide === 'dashed') ctx.setLineDash([10, 7]);
          if (cutGuide === 'corner') {
            ctx.setLineDash([]);
            const L = Math.round(6 * pxPerMm);
            ctx.beginPath();
            // four corners
            ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
            ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
            ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
            ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
            ctx.stroke();
          } else {
            if (roundedCorners) {
              ctx.beginPath();
              ctx.roundRect(x, y, w, h, radiusPx);
              ctx.stroke();
            } else {
              ctx.strokeRect(x, y, w, h);
            }
          }
          ctx.restore();
        }

        if (showLabels && labelText) {
          ctx.save();
          ctx.font = `600 ${Math.round(3.4 * pxPerMm)}px sans-serif`;
          ctx.fillStyle = '#475569';
          ctx.textAlign = 'center';
          ctx.fillText(labelText, x + w / 2, y + h + Math.round(4.6 * pxPerMm));
          ctx.restore();
        }
      };

      const drawFooter = (ctx: CanvasRenderingContext2D, pageNum: number, totalPages: number) => {
        ctx.save();
        ctx.font = `500 ${Math.round(3 * pxPerMm)}px sans-serif`;
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        const parts: string[] = [];
        if (footer.trim()) parts.push(footer.trim());
        if (totalPages > 1) parts.push(`Page ${pageNum} of ${totalPages}`);
        if (parts.length) ctx.fillText(parts.join('  •  '), a4W / 2, a4H - Math.round(10 * pxPerMm));
        ctx.restore();
      };

      const makeSheet = () => {
        const s = document.createElement('canvas');
        s.width = a4W;
        s.height = a4H;
        const ctx = s.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, a4W, a4H);
        return { canvas: s, ctx };
      };

      const topMarginPx = Math.round(15 * pxPerMm);
      const usableH = a4H - topMarginPx - Math.round(18 * pxPerMm); // leave footer space

      const getStartY = (blockH: number, isSinglePage: boolean) => {
        if (!isSinglePage) return topMarginPx;
        if (verticalSlot === 'top') return topMarginPx;
        if (verticalSlot === 'middle') return Math.max(40, Math.round((a4H - blockH) / 2));
        if (verticalSlot === 'bottom_half') return Math.round(154 * pxPerMm);
        return Math.round(customTopMm * pxPerMm);
      };

      const pageUrls: string[] = [];

      if (layout === 'grid_fill') {
        // auto-fit shrink to one page if requested
        const cols = 2;
        if (autoFit && tiles.length > 0) {
          const rowsNeeded = Math.ceil(tiles.length / cols);
          const neededH = rowsNeeded * rowH + (rowsNeeded - 1) * gapPx;
          if (neededH > usableH) {
            const scale = Math.max(0.42, usableH / neededH);
            cardW = Math.max(Math.round(38 * pxPerMm), Math.round(cardW * scale));
            cardH = Math.max(Math.round(24 * pxPerMm), Math.round(cardH * scale));
          }
        }
        const effRowH = cardH + labelH;
        const rowsPerPage = Math.max(1, Math.floor((usableH + gapPx) / (effRowH + gapPx)));
        const perPage = cols * rowsPerPage;
        const totalPages = Math.max(1, Math.ceil(tiles.length / perPage));

        for (let p = 0; p < totalPages; p++) {
          const { canvas, ctx } = makeSheet();
          const slice = tiles.slice(p * perPage, (p + 1) * perPage);
          const rows = Math.ceil(slice.length / cols);
          const blockH = rows * effRowH + (rows - 1) * gapPx;
          const totalW = cols * cardW + (cols - 1) * gapPx;
          const startX = Math.round((a4W - totalW) / 2);
          const startY = getStartY(blockH, totalPages === 1);
          slice.forEach((tile, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const x = startX + c * (cardW + gapPx);
            const y = startY + r * (effRowH + gapPx);
            if (tile.canvas) drawCardOnSheet(ctx, tile.canvas, x, y, cardW, cardH, cornerR, tile.label);
          });
          drawFooter(ctx, p + 1, totalPages);
          pageUrls.push(canvas.toDataURL('image/jpeg', 0.95));
        }
      } else if (layout === 'side_by_side') {
        // each pair = front+back in one row
        const pairW = cardW * 2 + gapPx;
        if (autoFit && pairs.length > 0) {
          const neededH = pairs.length * rowH + (pairs.length - 1) * gapPx;
          if (neededH > usableH) {
            const scale = Math.max(0.42, usableH / neededH);
            cardW = Math.max(Math.round(38 * pxPerMm), Math.round(cardW * scale));
            cardH = Math.max(Math.round(24 * pxPerMm), Math.round(cardH * scale));
          }
        }
        const effRowH = cardH + labelH;
        const rowsPerPage = Math.max(1, Math.floor((usableH + gapPx) / (effRowH + gapPx)));
        const totalPages = Math.max(1, Math.ceil(pairs.length / rowsPerPage));
        const effPairW = cardW * 2 + gapPx;

        for (let p = 0; p < totalPages; p++) {
          const { canvas, ctx } = makeSheet();
          const slice = pairs.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
          const blockH = slice.length * effRowH + (slice.length - 1) * gapPx;
          const startX = Math.max(20, Math.round((a4W - effPairW) / 2));
          const startY = getStartY(blockH, totalPages === 1);
          slice.forEach((pair, i) => {
            const y = startY + i * (effRowH + gapPx);
            if (pair.front) drawCardOnSheet(ctx, pair.front, startX, y, cardW, cardH, cornerR, pair.label);
            if (pair.back)
              drawCardOnSheet(ctx, pair.back, startX + cardW + gapPx, y, cardW, cardH, cornerR, pair.label);
          });
          drawFooter(ctx, p + 1, totalPages);
          pageUrls.push(canvas.toDataURL('image/jpeg', 0.95));
        }
      } else if (layout === 'stacked_vertical') {
        const cols = 2;
        const pairH = cardH * 2 + Math.round(6 * pxPerMm) + labelH;
        if (autoFit && pairs.length > 0) {
          const rowsNeeded = Math.ceil(pairs.length / cols);
          const neededH = rowsNeeded * pairH + (rowsNeeded - 1) * gapPx;
          if (neededH > usableH) {
            const scale = Math.max(0.42, usableH / neededH);
            cardW = Math.max(Math.round(38 * pxPerMm), Math.round(cardW * scale));
            cardH = Math.max(Math.round(24 * pxPerMm), Math.round(cardH * scale));
          }
        }
        const effPairH = cardH * 2 + Math.round(6 * pxPerMm) + labelH;
        const rowsPerPage = Math.max(1, Math.floor((usableH + gapPx) / (effPairH + gapPx)));
        const perPage = cols * rowsPerPage;
        const totalPages = Math.max(1, Math.ceil(pairs.length / perPage));

        for (let p = 0; p < totalPages; p++) {
          const { canvas, ctx } = makeSheet();
          const slice = pairs.slice(p * perPage, (p + 1) * perPage);
          const rows = Math.ceil(slice.length / cols);
          const blockH = rows * effPairH + (rows - 1) * gapPx;
          const totalW = cols * cardW + (cols - 1) * gapPx;
          const startX = Math.round((a4W - totalW) / 2);
          const startY = getStartY(blockH, totalPages === 1);
          slice.forEach((pair, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const x = startX + c * (cardW + gapPx);
            const y = startY + r * (effPairH + gapPx);
            if (pair.front) drawCardOnSheet(ctx, pair.front, x, y, cardW, cardH, cornerR);
            if (pair.back)
              drawCardOnSheet(ctx, pair.back, x, y + cardH + Math.round(6 * pxPerMm), cardW, cardH, cornerR, pair.label);
          });
          drawFooter(ctx, p + 1, totalPages);
          pageUrls.push(canvas.toDataURL('image/jpeg', 0.95));
        }
      } else {
        // duplex_2page: fronts on page 1, backs mirrored on page 2
        const cols = 2;
        const count = pairs.length;
        const rowsPerPage = Math.max(1, Math.floor((usableH + gapPx) / (rowH + gapPx)));
        const perPage = cols * rowsPerPage;
        const totalPages = Math.max(1, Math.ceil(count / perPage));

        for (let p = 0; p < totalPages; p++) {
          const s1 = makeSheet();
          const s2 = makeSheet();
          const slice = pairs.slice(p * perPage, (p + 1) * perPage);
          const rows = Math.ceil(slice.length / cols);
          const blockH = rows * rowH + (rows - 1) * gapPx;
          const totalW = cols * cardW + (cols - 1) * gapPx;
          const startX = Math.round((a4W - totalW) / 2);
          const startY = getStartY(blockH, totalPages === 1);
          slice.forEach((pair, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const xFront = startX + c * (cardW + gapPx);
            const xBack = a4W - xFront - cardW;
            const y = startY + r * (rowH + gapPx);
            if (pair.front) drawCardOnSheet(s1.ctx, pair.front, xFront, y, cardW, cardH, cornerR, pair.label);
            if (pair.back) drawCardOnSheet(s2.ctx, pair.back, xBack, y, cardW, cardH, cornerR, pair.label);
          });
          drawFooter(s1.ctx, p * 2 + 1, totalPages * 2);
          drawFooter(s2.ctx, p * 2 + 2, totalPages * 2);
          pageUrls.push(s1.canvas.toDataURL('image/jpeg', 0.95));
          // only add back page if any back exists in slice
          if (slice.some((pr) => pr.back)) pageUrls.push(s2.canvas.toDataURL('image/jpeg', 0.95));
        }
      }

      if (!cancelled) {
        setPages(pageUrls);
        setPageIndex((idx) => Math.min(idx, Math.max(0, pageUrls.length - 1)));
        setBuilding(false);
      }
    };

    generateSheets();
    return () => {
      cancelled = true;
    };
  }, [
    cards,
    layout,
    sizePreset,
    verticalSlot,
    customTopMm,
    roundedCorners,
    cutGuide,
    crossWatermark,
    autoFit,
    showLabels,
    footer,
    renderCardCanvas,
  ]);

  // ---------- crop modal handlers ----------
  const handleOpenCropModal = (cardId: string, side: 'front' | 'back') => {
    const card = cards.find((c) => c.id === cardId);
    if (!card || !card[side].rawUrl) return;
    const s = card[side];
    setTempCrop({ ...s.crop });
    setTempRot90(s.rotation90);
    setTempTilt(s.fineTilt);
    setCropEditing({ cardId, side });
  };

  const handleSaveCrop = () => {
    if (!cropEditing) return;
    updateSide(cropEditing.cardId, cropEditing.side, {
      crop: { ...tempCrop },
      rotation90: tempRot90,
      fineTilt: tempTilt,
    });
    setCropEditing(null);
  };

  const handleCropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropStageRef.current) return;
    const rect = cropStageRef.current.getBoundingClientRect();
    const startX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const startY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const onMove = (ev: MouseEvent) => {
      const curX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const curY = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.max(0.08, Math.abs(curX - startX));
      const h = Math.max(0.08, Math.abs(curY - startY));
      setTempCrop({ x, y, w: Math.min(1 - x, w), h: Math.min(1 - y, h) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---------- downloads ----------
  const handleDownloadPdf = () => {
    if (pages.length === 0) return;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pages.forEach((url, i) => {
      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(url, 'JPEG', 0, 0, 210, 297);
    });
    pdf.save(`IK-ID-Cards-A4-${pages.length}p-${Date.now()}.pdf`);
  };

  const handleDownloadJpg = (idx?: number) => {
    const i = idx ?? pageIndex;
    if (!pages[i]) return;
    const a = document.createElement('a');
    a.href = pages[i];
    a.download = `IK-ID-Card-Page-${i + 1}-${Date.now()}.jpg`;
    a.click();
  };

  const handleDownloadAllJpg = () => {
    pages.forEach((url, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `IK-ID-Card-Page-${i + 1}-${Date.now()}.jpg`;
        a.click();
      }, i * 350);
    });
  };

  const swapFrontBack = (cardId: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, front: c.back, back: c.front } : c))
    );
  };

  // ---------- presets (interesting one-tap packs) ----------
  const applyPreset = (name: 'two' | 'family4' | 'four_fronts' | 'eight_mini' | 'fill') => {
    if (name === 'two') {
      ensureCards(2);
      setLayout('side_by_side');
      setAutoFit(false);
    } else if (name === 'family4') {
      ensureCards(4);
      setLayout('side_by_side');
      setAutoFit(true);
    } else if (name === 'four_fronts') {
      ensureCards(4);
      setLayout('grid_fill');
      setAutoFit(true);
    } else if (name === 'eight_mini') {
      ensureCards(8);
      setLayout('grid_fill');
      setSizePreset('mini_70');
      setAutoFit(true);
    } else if (name === 'fill') {
      setLayout('grid_fill');
      setAutoFit(true);
    }
  };

  // ---------- demo data (see multi-card layout instantly) ----------
  const loadDemo = () => {
    const names = ['Ahmed Raza', 'Fatima Bibi', 'Bilal Hussain', 'Ayesha Khan'];
    const makeDemoSide = (name: string, side: 'front' | 'back', idx: number): string => {
      const c = document.createElement('canvas');
      c.width = 850;
      c.height = 540;
      const ctx = c.getContext('2d')!;
      const hues = [160, 210, 265, 20];
      const hue = hues[idx % hues.length];
      const grad = ctx.createLinearGradient(0, 0, 850, 540);
      grad.addColorStop(0, `hsl(${hue}, 55%, 96%)`);
      grad.addColorStop(1, `hsl(${hue}, 45%, 88%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 850, 540);
      ctx.fillStyle = `hsl(${hue}, 60%, 32%)`;
      ctx.fillRect(0, 0, 850, 86);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(side === 'front' ? 'DEMO CNIC — FRONT' : 'DEMO CNIC — BACK', 425, 56);
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(name, 40, 170);
      ctx.font = '28px sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(side === 'front' ? '35202-XXXXXXX-X  •  DEMO ONLY' : 'Address: Lahore, Punjab  •  DEMO ONLY', 40, 225);
      ctx.fillText('IK Computers — Multi-Card Demo', 40, 285);
      // fake photo box
      ctx.strokeStyle = `hsl(${hue}, 50%, 45%)`;
      ctx.lineWidth = 4;
      ctx.strokeRect(620, 120, 170, 210);
      ctx.fillStyle = `hsl(${hue}, 40%, 82%)`;
      ctx.fillRect(620, 120, 170, 210);
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PHOTO', 705, 235);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '20px sans-serif';
      ctx.fillText('demo', 705, 265);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748b';
      ctx.font = '22px sans-serif';
      ctx.fillText('This is a generated demo card — replace with real photos!', 40, 470);
      return c.toDataURL('image/jpeg', 0.92);
    };
    const demoCards: CardEntry[] = names.map((name, i) => {
      const card = createCard(i + 1, name);
      card.front = { ...DEFAULT_SIDE, rawUrl: makeDemoSide(name, 'front', i) };
      card.back = { ...DEFAULT_SIDE, rawUrl: makeDemoSide(name, 'back', i) };
      return card;
    });
    setCards(demoCards);
    setSelectedCardId(demoCards[0].id);
    setPasteTarget({ cardId: demoCards[0].id, side: 'front' });
    setLayout('grid_fill');
    setAutoFit(true);
    setShowLabels(true);
    setCutGuide('dashed');
    setFooter('IK Computers • Demo — replace with real CNIC photos');
  };

  const currentPageUrl = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] || '';

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top Action Bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <IdCard className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
              Front & Back ID Card (CNIC) A4 Page Maker
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                MULTI-CARD
              </span>
              <span className="urdu-nastaliq text-emerald-400 text-xs font-normal">
                شناختی کارڈ فرنٹ اور بیک پیج میکر
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Add <strong className="text-emerald-300">multiple different ID cards</strong> on one A4 page — copy from WhatsApp & press <strong>Ctrl + V</strong>!
              {savedAt && <span className="text-slate-500"> • Auto-saved {savedAt}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-300 cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Add Many Images (auto-pair F/B)
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                handleBulkFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>

          <button
            onClick={addCard}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add Card
          </button>

          {pages.length > 0 && (
            <>
              <button
                onClick={() => handleDownloadJpg()}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5 text-sky-400" /> JPG
              </button>
              <button
                onClick={handleDownloadPdf}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow"
              >
                <Download className="w-4 h-4" /> Save A4 PDF ({pages.length}p)
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg"
              >
                <Printer className="w-4 h-4" /> Print A4 Page
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div
        className={`flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-12 gap-6 no-print ${dragOver ? 'ring-2 ring-emerald-500 rounded-xl' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleBulkFiles(e.dataTransfer.files);
        }}
      >
        {/* Left Controls Panel */}
        <div className="xl:col-span-5 space-y-4">
          {/* Interesting presets */}
          <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-800/50 rounded-2xl p-3.5">
            <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 mb-2">
              <Wand2 className="w-4 h-4" /> One-tap packs — multiple cards, one page
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'two' as const, label: '👥 2 Persons (F+B)' },
                { id: 'family4' as const, label: '👨‍👩‍👧‍👦 Family 4 (F+B)' },
                { id: 'four_fronts' as const, label: '🪪 4 Fronts Grid' },
                { id: 'eight_mini' as const, label: '✨ 8 Mini Fronts' },
                { id: 'fill' as const, label: '📄 Fill Page (Auto-fit)' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-950/80 hover:bg-emerald-600 border border-slate-700 hover:border-emerald-500 text-[11px] font-bold text-slate-200 hover:text-white transition"
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={loadDemo}
                className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 border border-amber-500/50 text-[11px] font-bold text-amber-200 hover:text-white transition"
                title="Generate 4 fake demo cards to see the layout instantly"
              >
                🎬 Try Demo (4 persons)
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Tip: drag & drop many images anywhere here — they auto-pair as Front/Back per person. Or select many files with “Add Many Images”. Demo creates fake cards so you can see the layout without uploading.
            </p>
          </div>

          {/* Cards list header */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" /> ID Cards on this page ({cards.length})
              <span className="text-slate-500 font-normal">
                • {stats.filledCount} filled • {stats.sides} sides • {stats.tiles} tiles
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={addCard}
                className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Card
              </button>
              <button
                onClick={clearAll}
                className="px-2 py-1 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
                title="Clear all cards"
              >
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            </div>
          </div>

          {/* Cards list */}
          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {cards.map((card, cardIdx) => {
              const isSelected = selectedCardId === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => selectSlot(card.id, pasteTarget.cardId === card.id ? pasteTarget.side : 'front')}
                  className={`bg-slate-900 rounded-2xl p-3.5 border-2 transition cursor-pointer ${
                    isSelected
                      ? 'border-emerald-500 shadow-lg shadow-emerald-950/40'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* card header */}
                  <div className="flex items-center gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
                    <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {cardIdx + 1}
                    </span>
                    <input
                      value={card.label}
                      onChange={(e) => updateCard(card.id, { label: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={`Person ${cardIdx + 1} name`}
                      className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-white outline-none focus:border-emerald-500"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => moveCard(card.id, -1)}
                        disabled={cardIdx === 0}
                        className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveCard(card.id, 1)}
                        disabled={cardIdx === cards.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => duplicateCard(card.id)}
                        className="p-1 rounded text-slate-400 hover:text-emerald-300"
                        title="Duplicate this card"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeCard(card.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400"
                        title="Remove this card"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* copies per card */}
                  <div className="flex items-center gap-1.5 mb-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] text-slate-500 font-semibold">Copies of this card:</span>
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => updateCard(card.id, { copies: n })}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${
                          card.copies === n
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {n}x
                      </button>
                    ))}
                    {(card.front.rawUrl || card.back.rawUrl) && (
                      <button
                        onClick={() => swapFrontBack(card.id)}
                        className="ml-auto px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-semibold flex items-center gap-1"
                        title="Swap front & back"
                      >
                        <ArrowLeftRight className="w-3 h-3 text-sky-400" /> Swap F/B
                      </button>
                    )}
                  </div>

                  {/* front / back slots */}
                  <div className="grid grid-cols-2 gap-2.5" onClick={(e) => e.stopPropagation()}>
                    {(['front', 'back'] as const).map((side) => {
                      const s = card[side];
                      const isPasteTarget = pasteTarget.cardId === card.id && pasteTarget.side === side;
                      const accent = side === 'front' ? 'emerald' : 'sky';
                      return (
                        <div
                          key={side}
                          onClick={() => selectSlot(card.id, side)}
                          className={`rounded-xl p-2 border-2 transition cursor-pointer ${
                            isPasteTarget
                              ? side === 'front'
                                ? 'border-emerald-500 bg-emerald-950/20'
                                : 'border-sky-500 bg-sky-950/20'
                              : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span
                              className={`text-[10px] font-extrabold uppercase tracking-wider ${
                                side === 'front' ? 'text-emerald-400' : 'text-sky-400'
                              }`}
                            >
                              {side === 'front' ? 'Front' : 'Back'}
                            </span>
                            {isPasteTarget && (
                              <span
                                className={`text-[9px] px-1 py-0.5 rounded flex items-center gap-0.5 ${
                                  side === 'front'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-sky-500/20 text-sky-300'
                                }`}
                              >
                                <ClipboardPaste className="w-2.5 h-2.5" /> Ctrl+V
                              </span>
                            )}
                          </div>

                          {s.rawUrl ? (
                            <div className="space-y-1.5">
                              <img
                                src={s.rawUrl}
                                alt={`${card.label} ${side}`}
                                className="w-full h-24 object-contain bg-slate-950 rounded-lg border border-slate-800"
                              />
                              <div className="grid grid-cols-3 gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenCropModal(card.id, side);
                                  }}
                                  className={`py-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-0.5 border ${
                                    side === 'front'
                                      ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                                      : 'bg-sky-600/20 border-sky-500/40 text-sky-300'
                                  }`}
                                >
                                  <Crop className="w-3 h-3" /> Crop
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateSide(card.id, side, { rotation90: (s.rotation90 + 90) % 360 });
                                  }}
                                  className="py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center justify-center gap-0.5"
                                >
                                  <RotateCw className="w-3 h-3" /> 90°
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateSide(card.id, side, { ...DEFAULT_SIDE });
                                  }}
                                  className="py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-[10px] flex items-center justify-center"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className={`h-28 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center p-2 cursor-pointer ${
                                side === 'front'
                                  ? 'border-slate-700 hover:border-emerald-400'
                                  : 'border-slate-700 hover:border-sky-400'
                              }`}
                            >
                              <Upload className={`w-4 h-4 mb-1 ${side === 'front' ? 'text-emerald-400' : 'text-sky-400'}`} />
                              <span className="text-[11px] font-bold text-slate-200">
                                Upload {side === 'front' ? 'Front' : 'Back'}
                              </span>
                              <span className="text-[9px] text-slate-500 mt-0.5">click slot & Ctrl+V</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (f) await handleSingleUpload(card.id, side, f);
                                  e.target.value = '';
                                }}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Layout & Copies Configuration */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5 text-xs">
            <div>
              <label className="block font-bold text-slate-200 mb-1.5 flex items-center gap-1.5">
                <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" /> Page Arrangement (multi-card)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'grid_fill', label: '✨ Grid Fill (Multi)' },
                  { id: 'side_by_side', label: 'Side-by-Side [F][B]' },
                  { id: 'stacked_vertical', label: 'Top & Bottom' },
                  { id: 'duplex_2page', label: '2-Page Duplex' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setLayout(opt.id as LayoutStyle)}
                    className={`py-2 px-2 rounded-xl font-bold border transition text-[11px] ${
                      layout === opt.id
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Grid Fill flows every Front/Back tile in order — best for many different people on one page.
              </p>
            </div>

            <label className="flex items-center gap-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFit}
                onChange={(e) => setAutoFit(e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
              <div>
                <div className="font-bold text-emerald-300 flex items-center gap-1">
                  <Wand2 className="w-3.5 h-3.5" /> Auto-fit all cards on ONE A4 page
                </div>
                <div className="text-slate-400 text-[10px]">
                  Shrinks cards just enough so everything fits one sheet. Turn off to paginate at full size.
                </div>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Card Size Scale</label>
                <select
                  value={sizePreset}
                  onChange={(e) => setSizePreset(e.target.value as SizePreset)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-white text-[11px]"
                >
                  <option value="exact_100">Exact NADRA 1:1 (85.6×54mm)</option>
                  <option value="medium_110">110% Enlarged (94×59mm)</option>
                  <option value="large_125">125% Large Copy (107×67mm)</option>
                  <option value="mini_70">Mini 70×44mm (many per page)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Position on A4 Paper</label>
                <select
                  value={verticalSlot}
                  onChange={(e) => setVerticalSlot(e.target.value as VerticalSlot)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-emerald-300 font-semibold text-[11px]"
                >
                  <option value="top">Top of A4 (Standard)</option>
                  <option value="middle">Center of A4</option>
                  <option value="bottom_half">Bottom Half (Reuse Paper!)</option>
                  <option value="custom">Custom Top Margin (mm)</option>
                </select>
              </div>
            </div>

            {verticalSlot === 'custom' && (
              <div>
                <label className="block text-slate-400 mb-1">
                  Top Margin: <strong>{customTopMm} mm</strong>
                </label>
                <input
                  type="range"
                  min={5}
                  max={210}
                  value={customTopMm}
                  onChange={(e) => setCustomTopMm(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5 text-amber-400" /> Cut guides
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ['solid', 'Solid'],
                    ['dashed', '✂ Dashed'],
                    ['corner', 'Corner'],
                    ['none', 'None'],
                  ] as [CutGuide, string][]
                ).map(([g, label]) => (
                  <button
                    key={g}
                    onClick={() => setCutGuide(g)}
                    className={`py-1.5 rounded-lg text-[11px] font-bold border ${
                      cutGuide === g
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="accent-emerald-500"
                />
                <span className="flex items-center gap-1">
                  <Type className="w-3.5 h-3.5 text-slate-400" /> Print person name under each card
                </span>
              </label>
              <input
                type="text"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Shop footer on sheet e.g. 'IK Computers • 0300-1234567'"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          {/* Photostat Enhancement */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> Photostat Image Enhancer & Toner Saver
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['cnic_photostat', '✨ Face-Safe CNIC B&W'],
                  ['magic_bw', 'Sharp Text B&W'],
                  ['vivid_scan', 'Clean Color Card'],
                  ['original', 'Original Unfiltered'],
                ] as [DocFilterMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setFilterMode(m)}
                  className={`py-2 px-2.5 rounded-xl font-semibold border text-left text-[11px] ${
                    filterMode === m
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-slate-400 mb-1">Lighten / Darken ({brightness})</label>
                <input
                  type="range"
                  min={-35}
                  max={35}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Ink Sharpness ({contrast})</label>
                <input
                  type="range"
                  min={-25}
                  max={45}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roundedCorners}
                  onChange={(e) => setRoundedCorners(e.target.checked)}
                  className="accent-emerald-500"
                />
                Rounded ID Corners
              </label>
            </div>

            <input
              type="text"
              value={crossWatermark}
              onChange={(e) => setCrossWatermark(e.target.value)}
              placeholder="Optional security stamp e.g. 'FOR BANK ACCOUNT ONLY'"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 px-1">
            <Save className="w-3 h-3" />
            Auto-saves cards + settings in this browser (load-shedding safe). Clear button resets.
          </div>
        </div>

        {/* Right Live A4 Sheet Preview */}
        <div className="xl:col-span-7 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center">
          {building && (
            <div className="text-xs text-emerald-300 font-semibold animate-pulse mb-3">Building A4 sheet…</div>
          )}

          {pages.length > 0 ? (
            <div className="space-y-4 flex flex-col items-center w-full">
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-bold flex items-center gap-1">
                  <Layers className="w-3 h-3 text-emerald-400" />
                  {stats.filledCount} card{stats.filledCount === 1 ? '' : 's'} • {stats.tiles} tiles • {pages.length} A4 page{pages.length === 1 ? '' : 's'}
                </span>
                {pages.length === 1 && autoFit && (
                  <span className="px-2 py-1 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold">
                    ✓ All on 1 page
                  </span>
                )}
                {pages.length > 1 && (
                  <span className="px-2 py-1 rounded-lg bg-amber-950 border border-amber-800 text-amber-300 font-bold">
                    {pages.length} pages — print all
                  </span>
                )}
              </div>

              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Live A4 Print Sheet Preview (210 × 297 mm) — Page {Math.min(pageIndex + 1, pages.length)} / {pages.length}
              </div>

              <img
                src={currentPageUrl}
                alt={`A4 ID Card Page ${pageIndex + 1}`}
                className="max-h-[68vh] w-auto object-contain bg-white shadow-2xl rounded-sm border border-slate-700"
              />

              {pages.length > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200"
                  >
                    ← Prev
                  </button>
                  <div className="flex gap-1.5 flex-wrap justify-center">
                    {pages.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setPageIndex(i)}
                        className={`w-12 h-16 rounded overflow-hidden border-2 ${i === pageIndex ? 'border-emerald-500' : 'border-slate-700 opacity-60 hover:opacity-100'}`}
                        title={`Page ${i + 1}`}
                      >
                        <img src={url} alt={`Page ${i + 1} thumb`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200"
                  >
                    Next →
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => handleDownloadJpg()}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200"
                >
                  Save this page JPG
                </button>
                {pages.length > 1 && (
                  <button
                    onClick={handleDownloadAllJpg}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200"
                  >
                    Save all {pages.length} pages JPG
                  </button>
                )}
              </div>
            </div>
          ) : (
            !building && (
              <div className="text-center max-w-md space-y-3">
                <IdCard className="w-12 h-12 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-slate-300">
                  Add one card — or many different people on the same page!
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Click a Front/Back slot, then press <strong className="text-slate-300">Ctrl + V</strong> to paste from WhatsApp.
                  It auto-advances to the next person. Or use <strong className="text-slate-300">Add Card</strong> and
                  one-tap packs like <strong className="text-emerald-300">Family 4</strong> to lay out a whole family on one A4 sheet.
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center pt-1">
                  {[
                    { id: 'two' as const, label: '2 Persons' },
                    { id: 'family4' as const, label: 'Family 4' },
                    { id: 'four_fronts' as const, label: '4 Fronts' },
                    { id: 'eight_mini' as const, label: '8 Mini' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold hover:bg-emerald-600 hover:text-white"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Interactive Card Crop & Straighten Modal */}
      {cropEditing && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 no-print">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">
                  Crop & Straighten {cropEditing.side === 'front' ? 'Front' : 'Back'} ID Card
                </h3>
                <p className="text-xs text-slate-400">
                  Click and drag across the ID card below to trim away surrounding table/background!
                </p>
              </div>
              <button
                onClick={() => setCropEditing(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setTempRot90((r) => (r + 90) % 360)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold flex items-center gap-1"
              >
                <RotateCw className="w-3.5 h-3.5" /> Rotate 90°
              </button>

              <div className="flex items-center gap-2 text-slate-300 flex-1">
                <span>Straighten Tilt ({tempTilt}°):</span>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={tempTilt}
                  onChange={(e) => setTempTilt(Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
              </div>

              <button
                onClick={() => {
                  setTempCrop({ x: 0, y: 0, w: 1, h: 1 });
                  setTempTilt(0);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                Full Image
              </button>
            </div>

            <div className="flex justify-center bg-slate-950 rounded-xl p-3 overflow-hidden">
              {rotatedPreviewForCrop && (
                <div
                  ref={cropStageRef}
                  onMouseDown={handleCropMouseDown}
                  className="relative inline-block cursor-crosshair select-none"
                >
                  <img
                    src={rotatedPreviewForCrop}
                    alt="Drag to crop ID card"
                    className="max-h-[52vh] w-auto block opacity-60"
                    draggable={false}
                  />
                  <div
                    style={{
                      left: `${tempCrop.x * 100}%`,
                      top: `${tempCrop.y * 100}%`,
                      width: `${tempCrop.w * 100}%`,
                      height: `${tempCrop.h * 100}%`,
                    }}
                    className="absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] pointer-events-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCropEditing(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCrop}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Apply Card Crop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Clean A4 Print Area — all pages */}
      {pages.length > 0 && (
        <div id="ik-print-area" className="hidden print:block bg-white">
          {pages.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`Print Page ${i + 1}`}
              className="ik-print-page"
              style={{ width: '210mm', height: '297mm' }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
