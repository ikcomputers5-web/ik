import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import {
  pdfjsLib,
  renderPdfPageToDataUrl,
  normalizeRotation,
  type PDFDocumentProxy,
} from '../lib/pdfjs';
import {
  extractPdfText,
  looksRtl,
  type PdfPageText,
  type PdfTextIndex,
  type PdfTextLine,
} from '../lib/pdfText';
import {
  buildFreeTextOverlays,
  buildLineReplaceOverlays,
  hitTestLine,
  mergeOcrIntoLines,
  ocrBoxesToLines,
} from '../lib/pdfTextEdit';
import {
  ensureOverlayFonts,
  fitTextOverlay,
  isTextKind,
  newOverlayId,
  rasterizeTextOverlay,
  rotateNormalizedRect,
  type PdfOverlay,
} from '../lib/pdfOverlay';
import { buildEditedPdf, pageViewSize } from '../lib/pdfExport';
import { hasGroqKey, isGroqApiError, ocrPageWithBoxes } from '../lib/groqClient';
import type { AiDraft } from '../lib/pdfAiEdit';
import { PdfAiAssistant } from './PdfAiAssistant';
import { PdfTextEditor } from './PdfTextEditor';
import {
  FileUp,
  Type,
  Eraser,
  ImagePlus,
  RotateCw,
  Trash2,
  Download,
  Layers,
  Scissors,
  Move,
  ArrowUp,
  ArrowDown,
  Hash,
  Plus,
  Sparkles,
  Undo2,
  Redo2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
  Pencil,
  Search,
  Copy,
} from 'lucide-react';

type PdfTab = 'editor' | 'merge' | 'split';
type EditorTool = 'move' | 'whiteout' | 'text_urdu' | 'text_en' | 'text_edit' | 'cover_retype';

/**
 * The inline card above the stage has two modes:
 *  • 'line' — bound to a real/OCR PdfTextLine (click-to-edit)
 *  • 'free' — "Cover & Retype": a whiteout box + free text, no text layer needed
 */
type InlineEdit =
  | { kind: 'line'; page: number; line: PdfTextLine; value: string }
  | { kind: 'free'; page: number; overlayId: string; value: string };

type StatusAction = { label: string; onClick: () => void };

const COVER_RETYPE_W = 0.26;
const COVER_RETYPE_H = 0.05;

interface PageMeta {
  id: string;
  originalIndex: number;
  /** /Rotate already baked into the page by the PDF itself */
  intrinsicRotation: number;
  /** extra rotation applied by the user on top of the intrinsic one */
  extraRotation: number;
  /** intrinsic view size in points (rotation applied) */
  baseW: number;
  baseH: number;
  thumbUrl: string;
}

interface MergeItem {
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Size of the page as currently displayed (intrinsic + extra rotation). */
function viewSize(meta: PageMeta): { w: number; h: number } {
  return pageViewSize(meta);
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

interface PdfStudioProps {
  onOpenGroqModal?: () => void;
  /** A file handed over from another module (e.g. the Scan & Order queue). */
  incomingFile?: { file: File; nonce: number } | null;
}

export const PdfStudio: React.FC<PdfStudioProps> = ({ onOpenGroqModal, incomingFile }) => {
  const [activeTab, setActiveTab] = useState<PdfTab>('editor');

  // ---------- Document state ----------
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState<number>(0);
  const [activePagePreview, setActivePagePreview] = useState<string>('');
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error' | 'info';
    text: string;
    actions?: StatusAction[];
  } | null>(null);

  // ---------- Editing state ----------
  const [tool, setTool] = useState<EditorTool>('move');
  const [overlays, setOverlays] = useState<PdfOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [textColor, setTextColor] = useState<string>('#000000');
  const [fontSize, setFontSize] = useState<number>(18);
  const [addPageNumbers, setAddPageNumbers] = useState<boolean>(false);
  const [fontsReady, setFontsReady] = useState<boolean>(false);
  const [pxPerPt, setPxPerPt] = useState<number>(1);

  // ---------- AI assistant ----------
  const [aiOpen, setAiOpen] = useState<boolean>(false);
  const [textIndex, setTextIndex] = useState<PdfTextIndex | null>(null);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(null);
  const [extractNonce, setExtractNonce] = useState<number>(0);
  const [textPanelOpen, setTextPanelOpen] = useState<boolean>(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(() => new Set());
  const [groqReady, setGroqReady] = useState<boolean>(() => hasGroqKey());

  // ---------- AI OCR (position-aware), per PDF page ----------
  const [ocrLinesByPage, setOcrLinesByPage] = useState<Map<number, PdfTextLine[]>>(() => new Map());
  const [ocrBusyPage, setOcrBusyPage] = useState<number | null>(null);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);

  // ---------- Merge / split ----------
  const [mergeFiles, setMergeFiles] = useState<MergeItem[]>([]);
  const [splitPdf, setSplitPdf] = useState<{ name: string; bytes: Uint8Array; pageCount: number } | null>(null);
  const [splitRange, setSplitRange] = useState<string>('1');

  // ---------- Refs ----------
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageImgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgOverlayInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const historyRef = useRef<PdfOverlay[][]>([]);
  const redoRef = useRef<PdfOverlay[][]>([]);
  const extractTriedRef = useRef<string>('');
  /** overlays as they were before a Cover & Retype box was placed (for 1-step undo) */
  const coverBaseRef = useRef<PdfOverlay[] | null>(null);

  const meta = pages[selectedPageIdx] ?? null;
  const metaKey = meta ? `${meta.id}:${meta.extraRotation}` : '';
  const pageOverlays = useMemo(
    () => (meta ? overlays.filter((o) => o.pageId === meta.id) : []),
    [overlays, meta]
  );
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) || null;

  // =====================================================================
  // Text index + AI OCR lines
  // Scanned pages get their lines from Groq vision (approximate boxes). The
  // merged index is what every edit path below uses, so an OCR'd scan behaves
  // exactly like a real text-layer page.
  // =====================================================================
  const mergedTextIndex = useMemo<PdfTextIndex | null>(() => {
    if (!textIndex && ocrLinesByPage.size === 0) return null;

    const base = textIndex;
    const pageNumbers = new Set<number>();
    base?.pages.forEach((p) => pageNumbers.add(p.page));
    ocrLinesByPage.forEach((lines, page) => {
      const stillInDocument = pages.some((m) => m.originalIndex === page - 1);
      if (lines.length > 0 && stillInDocument) pageNumbers.add(page);
    });

    const outPages: PdfPageText[] = [];
    const scannedPages: number[] = [];
    let totalChars = 0;

    for (const pageNumber of [...pageNumbers].sort((a, b) => a - b)) {
      const basePage = base?.pages.find((p) => p.page === pageNumber);
      const pageMeta = pages.find((p) => p.originalIndex === pageNumber - 1);
      const realLines: PdfTextLine[] = (basePage?.lines ?? []).map((l) => ({
        ...l,
        source: l.source ?? 'text',
      }));
      const ocrLines = (ocrLinesByPage.get(pageNumber) ?? []).map((l) => ({
        ...l,
        source: 'ocr' as const,
      }));
      const lines = mergeOcrIntoLines(realLines, ocrLines);
      const charCount = lines.reduce((n, l) => n + l.text.length, 0);
      const realChars = realLines.reduce((n, l) => n + l.text.length, 0);
      totalChars += charCount;
      if (realChars < 4 && ocrLines.length === 0) scannedPages.push(pageNumber);
      outPages.push({
        page: pageNumber,
        widthPt: basePage?.widthPt ?? pageMeta?.baseW ?? 612,
        heightPt: basePage?.heightPt ?? pageMeta?.baseH ?? 792,
        lines,
        charCount,
      });
    }

    return {
      pages: outPages,
      totalChars,
      pageCount: base?.pageCount ?? pages.length,
      scannedPages,
    };
  }, [textIndex, ocrLinesByPage, pages]);

  const pageTextInfo = useCallback(
    (pageNumber: number): PdfPageText | undefined =>
      mergedTextIndex?.pages.find((p) => p.page === pageNumber),
    [mergedTextIndex]
  );

  // =====================================================================
  // Loading
  // =====================================================================
  const loadPdfFile = useCallback(async (file: File) => {
    setBusy(true);
    setStatus({ kind: 'info', text: `Opening ${file.name}…` });
    setPreviewError(null);
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      const bytesForExport = raw.slice(); // pdf-lib copy (pdf.js detaches its buffer)

      if (pdfDocRef.current) {
        try {
          await pdfDocRef.current.destroy();
        } catch {
          /* ignore */
        }
        pdfDocRef.current = null;
      }

      const doc = await pdfjsLib.getDocument({ data: raw.slice() }).promise;
      const metas: PageMeta[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const baseVp = page.getViewport({ scale: 1 });
        const thumbVp = page.getViewport({ scale: 0.32 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(thumbVp.width));
        canvas.height = Math.max(1, Math.ceil(thumbVp.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas not available');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: thumbVp }).promise;
        metas.push({
          id: uid('pg'),
          originalIndex: i - 1,
          intrinsicRotation: normalizeRotation(page.rotate || 0),
          extraRotation: 0,
          baseW: baseVp.width,
          baseH: baseVp.height,
          thumbUrl: canvas.toDataURL('image/jpeg', 0.72),
        });
      }

      pdfDocRef.current = doc;
      setPdfBytes(bytesForExport);
      setPdfName(file.name.replace(/\.pdf$/i, ''));
      setPages(metas);
      setOverlays([]);
      setSelectedOverlayId(null);
      setSelectedPageIdx(0);
      setTextIndex(null);
      setExtractError(null);
      setExtractProgress(null);
      setEditedKeys(new Set());
      setInlineEdit(null);
      setOcrLinesByPage(new Map());
      setOcrBusyPage(null);
      setFocusLineKey(null);
      coverBaseRef.current = null;
      extractTriedRef.current = '';
      historyRef.current = [];
      redoRef.current = [];
      setStatus({
        kind: 'ok',
        text: `${file.name} opened — ${metas.length} page${metas.length === 1 ? '' : 's'} ready to edit.`,
      });
    } catch (err: any) {
      console.error(err);
      const msg = String(err?.message || '');
      setStatus({
        kind: 'error',
        text: /password|encrypt/i.test(msg)
          ? 'This PDF is password-protected. Remove the password first, then open it again.'
          : 'Could not open this file. Please make sure it is a valid, unlocked PDF.',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  // Open a file handed over from the Scan & Order station
  useEffect(() => {
    if (!incomingFile?.file) return;
    void loadPdfFile(incomingFile.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFile?.nonce]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadPdfFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && /pdf$/i.test(file.name)) void loadPdfFile(file);
    else if (file) setStatus({ kind: 'error', text: 'Please drop a PDF file.' });
  };

  // =====================================================================
  // Page preview
  // =====================================================================
  useEffect(() => {
    let cancelled = false;
    const doc = pdfDocRef.current;
    const current = pages[selectedPageIdx];
    if (!pdfBytes || !current) {
      setActivePagePreview('');
      setPreviewBusy(false);
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    const rotation = normalizeRotation(current.intrinsicRotation + current.extraRotation);
    renderPdfPageToDataUrl(pdfBytes, current.originalIndex, {
      scale: 1.5,
      rotation,
      mime: 'image/png',
      doc: doc ?? undefined,
    })
      .then((r) => {
        if (!cancelled) setActivePagePreview(r.dataUrl);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setActivePagePreview('');
        setPreviewError(err?.message || 'Could not render this page.');
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metaKey, pdfBytes, pages, selectedPageIdx]);

  // Measure how many screen pixels one PDF point occupies (for text sizing)
  useEffect(() => {
    const img = pageImgRef.current;
    const current = pages[selectedPageIdx];
    if (!img || !current) return;
    const update = () => {
      const vs = viewSize(current);
      if (img.clientWidth > 0 && vs.w > 0) setPxPerPt(img.clientWidth / vs.w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(img);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [activePagePreview, metaKey, pages, selectedPageIdx]);

  useEffect(() => {
    let mounted = true;
    ensureOverlayFonts().then(() => {
      if (mounted) setFontsReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onUpdate = () => setGroqReady(hasGroqKey());
    window.addEventListener('ik-groq-updated', onUpdate);
    return () => window.removeEventListener('ik-groq-updated', onUpdate);
  }, []);

  // =====================================================================
  // Automatic text reading — runs on every upload, not on demand.
  // The whole document's text layer is indexed in the background so the
  // operator can click any line and edit it immediately.
  // =====================================================================
  useEffect(() => {
    if (!pdfBytes) return;
    const token = `${pdfName}|${pdfBytes.length}|${extractNonce}`;
    if (extractTriedRef.current === token) return;
    extractTriedRef.current = token;
    let cancelled = false;
    setExtracting(true);
    setExtractError(null);
    setExtractProgress(null);
    setTextIndex(null);
    extractPdfText(pdfBytes, {
      maxPages: 60,
      onProgress: (done, total) => {
        if (!cancelled) setExtractProgress({ done, total });
      },
    })
      .then((idx) => {
        if (!cancelled) {
          setTextIndex(idx);
          setExtractProgress(null);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setExtractError(
            'Could not read the text layer of this PDF. If it is a scanned photo, use Cover & Retype, or read the page with AI.'
          );
          setExtractProgress(null);
        }
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, extractNonce, pdfName]);

  // =====================================================================
  // Overlay mutations (with undo / redo)
  // =====================================================================
  const mutateOverlays = useCallback(
    (fn: (prev: PdfOverlay[]) => PdfOverlay[], record = true) => {
      setOverlays((prev) => {
        if (record) {
          historyRef.current.push(prev);
          if (historyRef.current.length > 60) historyRef.current.shift();
          redoRef.current = [];
        }
        return fn(prev);
      });
    },
    []
  );

  const undo = useCallback(() => {
    setOverlays((prev) => {
      const last = historyRef.current.pop();
      if (!last) return prev;
      redoRef.current.push(prev);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setOverlays((prev) => {
      const next = redoRef.current.pop();
      if (!next) return prev;
      historyRef.current.push(prev);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedOverlayId) return;
    // Deleting the not-yet-applied Cover & Retype box = cancelling it, so the
    // document never gets a history entry for a box the operator abandoned.
    if (inlineEdit?.kind === 'free' && inlineEdit.overlayId === selectedOverlayId) {
      setOverlays((prev) => coverBaseRef.current ?? prev.filter((o) => o.id !== selectedOverlayId));
      coverBaseRef.current = null;
      setInlineEdit(null);
      setSelectedOverlayId(null);
      return;
    }
    mutateOverlays((prev) => prev.filter((o) => o.id !== selectedOverlayId));
    setSelectedOverlayId(null);
  }, [inlineEdit, mutateOverlays, selectedOverlayId]);

  /**
   * Drop the box of an un-applied Cover & Retype. The whiteout was placed
   * without a history entry, so cancelling must restore the snapshot directly.
   */
  const discardFreeBox = useCallback((overlayId: string) => {
    setOverlays((prev) => {
      const base = coverBaseRef.current;
      coverBaseRef.current = null;
      return base ?? prev.filter((o) => o.id !== overlayId);
    });
    setSelectedOverlayId(null);
  }, []);

  /** Close the inline card (line mode just closes; free mode also removes the box). */
  const cancelInlineEdit = useCallback(
    (current: InlineEdit | null) => {
      if (current?.kind === 'free') discardFreeBox(current.overlayId);
      setInlineEdit(null);
    },
    [discardFreeBox]
  );

  // A Cover & Retype box belongs to the page it was placed on — drop it when the
  // operator flips pages (it was never committed to the document yet).
  const lastPageRef = useRef<number>(selectedPageIdx);
  useEffect(() => {
    if (lastPageRef.current === selectedPageIdx) return;
    lastPageRef.current = selectedPageIdx;
    if (inlineEdit?.kind === 'free') {
      discardFreeBox(inlineEdit.overlayId);
      setInlineEdit(null);
    }
  }, [discardFreeBox, inlineEdit, selectedPageIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selectedOverlayId) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === 'Escape') {
        if (inlineEdit) {
          e.preventDefault();
          cancelInlineEdit(inlineEdit);
        }
        setTool('move');
        setSelectedOverlayId(null);
        return;
      }
      // R = Cover & Retype — works on scans and on real PDFs alike.
      if (
        !typing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'r' || e.key === 'R') &&
        pages.length > 0
      ) {
        e.preventDefault();
        setTool('cover_retype');
        setStatus({
          kind: 'info',
          text: 'Cover & Retype: click on the page where the old text is — a whiteout box opens with a typing card. Esc cancels.',
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    cancelInlineEdit,
    deleteSelected,
    inlineEdit,
    pages.length,
    redo,
    selectedOverlayId,
    undo,
  ]);

  // =====================================================================
  // Add overlays
  // =====================================================================
  const updateOverlay = useCallback(
    (id: string, patch: Partial<PdfOverlay>, record = true) => {
      mutateOverlays(
        (prev) =>
          prev.map((o) => {
            if (o.id !== id) return o;
            let next: PdfOverlay = { ...o, ...patch };
            if (isTextKind(next.kind) && (patch.text !== undefined || patch.fontSize !== undefined)) {
              const page = pages.find((p) => p.id === next.pageId);
              if (page) {
                const vs = viewSize(page);
                next = fitTextOverlay(next, vs.w, vs.h);
              }
            }
            return next;
          }),
        record
      );
    },
    [mutateOverlays, pages]
  );

  /** Undo the user's extra page rotation for a click point (display → PDF space). */
  const displayPointToIntrinsic = (meta: PageMeta, nx: number, ny: number) => {
    const deg = normalizeRotation(meta.extraRotation);
    if (deg === 90) return { x: ny, y: 1 - nx };
    if (deg === 180) return { x: 1 - nx, y: 1 - ny };
    if (deg === 270) return { x: 1 - ny, y: nx };
    return { x: nx, y: ny };
  };

  const lineKey = (page: number, line: PdfTextLine) => `${page}:${line.id}`;

  /** Rewrite one extracted line in place (or delete it when newText is empty). */
  const applyLineEdit = (
    pageNumber: number,
    line: PdfTextLine,
    newText: string,
    opts: { silent?: boolean } = {}
  ) => {
    const pageInfo = pageTextInfo(pageNumber);
    if (!pageInfo) {
      setStatus({ kind: 'error', text: 'Text for that page is not ready yet. Please wait a second and try again.' });
      return;
    }
    const res = buildLineReplaceOverlays(pageInfo, line, newText, { color: textColor });
    applyAiDrafts([
      {
        id: uid('draft'),
        page: pageNumber,
        label: `Page ${pageNumber} · ${newText.trim() ? 'rewrite' : 'delete'} line`,
        overlays: res.overlays,
        warnings: res.warnings,
      },
    ]);
    setEditedKeys((prev) => {
      const next = new Set(prev);
      next.add(lineKey(pageNumber, line));
      return next;
    });
    if (!opts.silent) {
      setStatus({
        kind: res.warnings.length ? 'info' : 'ok',
        text: res.warnings.length
          ? res.warnings.join(' ')
          : newText.trim()
          ? 'Text replaced in place — press Ctrl+Z to undo, then download the PDF.'
          : 'Line removed — press Ctrl+Z to undo, then download the PDF.',
      });
    }
  };

  // =====================================================================
  // Cover & Retype — free text over a whiteout box (no text layer needed)
  // =====================================================================
  const applyFreeTextEdit = (
    edit: Extract<InlineEdit, { kind: 'free' }>,
    opts: { silent?: boolean } = {}
  ) => {
    const pageMeta = pages.find((p) => p.originalIndex === edit.page - 1);
    if (!pageMeta) {
      setStatus({ kind: 'error', text: 'That page is not in this document any more.' });
      setInlineEdit(null);
      return;
    }
    const box = overlays.find((o) => o.id === edit.overlayId);
    if (!box) {
      coverBaseRef.current = null;
      setStatus({ kind: 'error', text: 'The whiteout box was removed — click the page again with Cover & Retype.' });
      setInlineEdit(null);
      return;
    }
    // Boxes live in the *displayed* page space, so measure against the view size.
    const vs = viewSize(pageMeta);
    const res = buildFreeTextOverlays(
      { widthPt: vs.w, heightPt: vs.h },
      { x: box.x, y: box.y, w: box.w, h: box.h },
      edit.value,
      { color: textColor }
    );

    const base = coverBaseRef.current;
    // The box already lives in the displayed page space, so the new text needs
    // the same pageId as the box — no rotation maths required.
    const textOverlays = res.overlays
      .filter((o) => o.kind !== 'whiteout')
      .map((o) => ({ ...o, pageId: box.pageId }));
    setOverlays((prev) => {
      // One history entry for the whole action: undo removes box *and* text.
      historyRef.current.push(base ?? prev);
      if (historyRef.current.length > 60) historyRef.current.shift();
      redoRef.current = [];
      return [...prev, ...textOverlays];
    });
    coverBaseRef.current = null;
    setSelectedOverlayId(textOverlays[textOverlays.length - 1]?.id ?? edit.overlayId);
    setInlineEdit(null);

    if (!opts.silent) {
      const hadText = Boolean(edit.value.trim());
      setStatus({
        kind: res.warnings.length ? 'info' : 'ok',
        text: res.warnings.length
          ? res.warnings.join(' ')
          : hadText
          ? 'Covered and retyped — press Ctrl+Z to undo, then download the PDF.'
          : 'Whiteout box kept — press Ctrl+Z to undo.',
      });
    }
  };

  // =====================================================================
  // AI OCR for one page: read the page image and keep the line boxes, so the
  // scan becomes click-to-edit exactly like a real text layer.
  // =====================================================================
  const runPageOcr = useCallback(
    async (pageNumber: number): Promise<{ lineCount: number; text: string }> => {
      if (!pdfBytes) throw new Error('Open a PDF first.');
      const pageMeta = pages.find((p) => p.originalIndex === pageNumber - 1);
      if (!pageMeta) throw new Error('That page is not in this document any more.');

      if (!hasGroqKey()) {
        const message = 'Add your Groq key first — AI page reading needs it.';
        setStatus({
          kind: 'error',
          text: message,
          actions: [{ label: 'Open Groq settings', onClick: () => onOpenGroqModal?.() }],
        });
        throw new Error(message);
      }

      setOcrBusyPage(pageNumber);
      setStatus({ kind: 'info', text: `AI is reading page ${pageNumber}… this takes a few seconds.` });

      try {
        const rotation = normalizeRotation(pageMeta.intrinsicRotation + pageMeta.extraRotation);
        const rendered = await renderPdfPageToDataUrl(pdfBytes, pageNumber - 1, {
          scale: 2,
          rotation,
          mime: 'image/jpeg',
          quality: 0.92,
          doc: pdfDocRef.current ?? undefined,
        });

        const boxes = await ocrPageWithBoxes(rendered.dataUrl, {
          widthPt: rendered.widthPt,
          heightPt: rendered.heightPt,
        });

        // OCR boxes follow the *displayed* orientation → map back to intrinsic.
        const extra = normalizeRotation(pageMeta.extraRotation);
        const vs = viewSize(pageMeta);
        const mapped =
          extra === 0
            ? boxes
            : boxes.map((b) => ({
                ...b,
                ...rotateNormalizedRect(
                  { x: b.x, y: b.y, w: b.w, h: b.h },
                  vs.w,
                  vs.h,
                  (360 - extra) % 360
                ),
              }));

        const extracted = textIndex?.pages.find((p) => p.page === pageNumber);
        const lines = ocrBoxesToLines(
          {
            page: pageNumber,
            widthPt: extracted?.widthPt ?? pageMeta.baseW,
            heightPt: extracted?.heightPt ?? pageMeta.baseH,
          },
          mapped
        );

        if (lines.length === 0) {
          throw new Error(
            'AI could not find any text on this page. Try a sharper photo or a higher-resolution scan.'
          );
        }

        setOcrLinesByPage((prev) => {
          const next = new Map(prev);
          next.set(pageNumber, lines);
          return next;
        });
        // Show the operator straight away that the page is now editable.
        setTextPanelOpen(true);
        setAiOpen(false);
        setFocusLineKey(`${pageNumber}:${lines[0].id}`);
        setStatus({
          kind: 'ok',
          text: `AI read page ${pageNumber}: ${lines.length} line${
            lines.length === 1 ? '' : 's'
          } found — they are now click-to-edit in the Text panel.`,
        });
        return { lineCount: lines.length, text: boxes.map((b) => b.text).join('\n') };
      } catch (err: any) {
        const message = String(err?.message || 'AI could not read this page.');
        const needsSettings =
          isGroqApiError(err) && (err.status === 401 || err.code === 'no_model');
        setStatus({
          kind: 'error',
          text: message,
          actions: needsSettings
            ? [{ label: 'Open Groq settings', onClick: () => onOpenGroqModal?.() }]
            : undefined,
        });
        throw new Error(message);
      } finally {
        setOcrBusyPage(null);
      }
    },
    [pdfBytes, pages, textIndex, onOpenGroqModal]
  );

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'move') return;
    const stage = stageRef.current;
    if (!stage) return;
    const target = e.target as HTMLElement;
    if (target !== stage && target.dataset.stageBg !== 'true') return;
    const current = pages[selectedPageIdx];
    if (!current) return;
    const rect = stage.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0.01, 0.99);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0.01, 0.99);
    const vs = viewSize(current);

    if (tool === 'text_edit') {
      const pdfPage = current.originalIndex + 1;
      const pageInfo = pageTextInfo(pdfPage);
      const point = displayPointToIntrinsic(current, nx, ny);
      const line = hitTestLine(pageInfo, point.x, point.y);
      if (!line) {
        const hasRealText = Boolean(
          pageInfo && pageInfo.lines.some((l) => (l.source ?? 'text') === 'text')
        );
        if (pageInfo && !hasRealText) {
          // Dead end no more: give the operator the two things that actually work.
          setStatus({
            kind: 'info',
            text: 'This page is a scan — it has no text layer. Either cover and retype it, or let AI read it so its lines become clickable.',
            actions: [
              {
                label: 'Cover & Retype',
                onClick: () => {
                  setTool('cover_retype');
                  setStatus({
                    kind: 'info',
                    text: 'Cover & Retype: click on the page where the old text is — a whiteout box opens with a typing card. Esc cancels.',
                  });
                },
              },
              {
                label: 'Read page with AI',
                onClick: () => {
                  void runPageOcr(pdfPage).catch(() => undefined);
                },
              },
            ],
          });
          return;
        }
        setStatus({
          kind: 'info',
          text: pageInfo
            ? 'No editable text exactly there — the click missed the line. Try the Text panel on the right.'
            : extracting
            ? 'Still reading this PDF — try again in a moment.'
            : 'Text not read yet. Open the Text panel and press “Try reading again”.',
        });
        return;
      }
      setInlineEdit({ kind: 'line', page: pdfPage, line, value: line.text });
      setTextPanelOpen(true);
      setTool('move');
      return;
    }

    if (tool === 'cover_retype') {
      // Replacing an un-applied box: drop it first, then place the new one.
      if (inlineEdit?.kind === 'free') cancelInlineEdit(inlineEdit);
      const item: PdfOverlay = {
        id: newOverlayId(),
        pageId: current.id,
        kind: 'whiteout',
        x: clamp(nx - COVER_RETYPE_W / 2, 0, 1 - COVER_RETYPE_W),
        y: clamp(ny - COVER_RETYPE_H / 2, 0, 1 - COVER_RETYPE_H),
        w: COVER_RETYPE_W,
        h: COVER_RETYPE_H,
        origin: 'manual',
        note: 'cover-retype mask',
      };
      // No history entry yet — the whole action is committed on Apply.
      setOverlays((prev) => {
        coverBaseRef.current = prev;
        return [...prev, item];
      });
      setSelectedOverlayId(item.id);
      setInlineEdit({
        kind: 'free',
        page: current.originalIndex + 1,
        overlayId: item.id,
        value: '',
      });
      setTool('move');
      return;
    }

    if (tool === 'whiteout') {
      const w = 0.26;
      const h = 0.05;
      const item: PdfOverlay = {
        id: newOverlayId(),
        pageId: current.id,
        kind: 'whiteout',
        x: clamp(nx - w / 2, 0, 1 - w),
        y: clamp(ny - h / 2, 0, 1 - h),
        w,
        h,
        origin: 'manual',
      };
      mutateOverlays((prev) => [...prev, item]);
      setSelectedOverlayId(item.id);
      setTool('move');
      return;
    }

    const kind: PdfOverlay['kind'] = tool === 'text_urdu' ? 'text_urdu' : 'text_en';
    let item: PdfOverlay = {
      id: newOverlayId(),
      pageId: current.id,
      kind,
      x: 0,
      y: 0,
      w: 0.2,
      h: 0.05,
      text: kind === 'text_urdu' ? 'یہاں لکھیں' : 'Type here',
      fontSize,
      color: textColor,
      origin: 'manual',
    };
    item = fitTextOverlay(item, vs.w, vs.h);
    item.x = clamp(nx - item.w / 2, 0, Math.max(0, 1 - item.w));
    item.y = clamp(ny - item.h / 2, 0, Math.max(0, 1 - item.h));
    mutateOverlays((prev) => [...prev, item]);
    setSelectedOverlayId(item.id);
    setTool('move');
  };

  const handleAddImageOverlay = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const current = pages[selectedPageIdx];
    if (!file || !current) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const vs = viewSize(current);
      const img = new Image();
      img.onload = () => {
        const w = 0.28;
        const h = clamp((w * vs.w * (img.naturalHeight / Math.max(1, img.naturalWidth))) / vs.h, 0.01, 0.9);
        const item: PdfOverlay = {
          id: newOverlayId(),
          pageId: current.id,
          kind: 'image',
          x: 0.5 - w / 2,
          y: 0.5 - h / 2,
          w,
          h,
          imageDataUrl: dataUrl,
          origin: 'manual',
        };
        mutateOverlays((prev) => [...prev, item]);
        setSelectedOverlayId(item.id);
        setTool('move');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Drag to move
  const startDragOverlay = (e: React.MouseEvent, item: PdfOverlay) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedOverlayId(item.id);
    const stage = stageRef.current;
    if (!stage) return;
    // The pending Cover & Retype box is not committed yet — its single history
    // entry is created on Apply, so dragging it must not record anything.
    const pendingFreeId = inlineEdit?.kind === 'free' ? inlineEdit.overlayId : null;
    mutateOverlays((prev) => prev, item.id !== pendingFreeId);
    dragRef.current = { id: item.id, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y };

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const dx = (ev.clientX - drag.startX) / rect.width;
      const dy = (ev.clientY - drag.startY) / rect.height;
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id !== drag.id) return o;
          return {
            ...o,
            x: clamp(drag.origX + dx, 0, Math.max(0, 1 - o.w)),
            y: clamp(drag.origY + dy, 0, Math.max(0, 1 - o.h)),
          };
        })
      );
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // =====================================================================
  // Text raster cache for preview (identical pixels to the exported PDF)
  // =====================================================================
  const textRasters = useMemo(() => {
    const map = new Map<string, { src: string; w: number; h: number }>();
    if (!fontsReady) return map;
    for (const o of overlays) {
      if (!isTextKind(o.kind)) continue;
      const page = pages.find((p) => p.id === o.pageId);
      if (!page) continue;
      const vs = viewSize(page);
      const r = rasterizeTextOverlay(o, vs.w, vs.h);
      if (r) map.set(o.id, { src: r.dataUrl, w: r.wPt / vs.w, h: r.hPt / vs.h });
    }
    return map;
  }, [overlays, pages, fontsReady]);

  // =====================================================================
  // Page operations
  // =====================================================================
  const rotatePage = (idx: number) => {
    const page = pages[idx];
    if (!page) return;
    const vs = viewSize(page);
    mutateOverlays((prev) =>
      prev.map((o) => {
        if (o.pageId !== page.id) return o;
        const r = rotateNormalizedRect({ x: o.x, y: o.y, w: o.w, h: o.h }, vs.w, vs.h, 90);
        return { ...o, ...r };
      }),
      false
    );
    setPages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, extraRotation: normalizeRotation(m.extraRotation + 90) } : m))
    );
  };

  const deletePage = (idx: number) => {
    const page = pages[idx];
    if (!page || pages.length <= 1) return;
    mutateOverlays((prev) => prev.filter((o) => o.pageId !== page.id), false);
    setPages((prev) => prev.filter((_, i) => i !== idx));
    setSelectedPageIdx((cur) => clamp(cur > idx ? cur - 1 : cur, 0, pages.length - 2));
  };

  const movePage = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
    setSelectedPageIdx(target);
  };

  // =====================================================================
  // Export
  // =====================================================================
  const handleExportEditedPdf = async () => {
    if (!pdfBytes || pages.length === 0) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Building the edited PDF…' });
    try {
      const finalBytes = await buildEditedPdf({
        pdfBytes,
        pages,
        overlays,
        addPageNumbers,
        renderRotatedPage: async (pageIndex, rotation) => {
          const raster = await renderPdfPageToDataUrl(pdfBytes, pageIndex, {
            scale: 3.6,
            rotation,
            mime: 'image/jpeg',
            quality: 0.95,
          });
          return raster.dataUrl;
        },
      });
      downloadBytes(finalBytes, `${pdfName || 'IK-Edited'}-Edited.pdf`);
      setStatus({ kind: 'ok', text: 'Edited PDF downloaded — check it before printing.' });
    } catch (err: any) {
      console.error(err);
      setStatus({
        kind: 'error',
        text: `Could not save the PDF${err?.message ? `: ${err.message}` : '.'} Try a smaller PDF or remove a page.`,
      });
    } finally {
      setBusy(false);
    }
  };

  // =====================================================================
  // AI apply
  // =====================================================================
  /** AI page numbers come from the extracted text layer (original order). */
  const pageIndexForAiPage = (aiPage: number) => {
    const idx = pages.findIndex((p) => p.originalIndex === aiPage - 1);
    return idx >= 0 ? idx : clamp(aiPage - 1, 0, Math.max(0, pages.length - 1));
  };

  const applyAiDrafts = (drafts: AiDraft[]) => {
    if (drafts.length === 0) return;
    const incoming: PdfOverlay[] = [];
    for (const draft of drafts) {
      const page = pages.find((p) => p.originalIndex === draft.page - 1);
      if (!page) continue;
      for (const ov of draft.overlays) {
        let next: PdfOverlay = { ...ov, pageId: page.id };
        if (normalizeRotation(page.extraRotation) !== 0) {
          const r = rotateNormalizedRect(
            { x: next.x, y: next.y, w: next.w, h: next.h },
            page.baseW,
            page.baseH,
            page.extraRotation
          );
          next = { ...next, ...r };
        }
        incoming.push(next);
      }
    }
    if (incoming.length === 0) return;
    mutateOverlays((prev) => [...prev, ...incoming]);
    setSelectedPageIdx(pageIndexForAiPage(drafts[0]?.page ?? 1));
    setTool('move');
    setSelectedOverlayId(incoming[incoming.length - 1]?.id ?? null);
    setStatus({
      kind: 'ok',
      text: `AI added ${incoming.length} change${incoming.length === 1 ? '' : 's'} — review the preview, then download.`,
    });
  };

  // =====================================================================
  // Merge / split
  // =====================================================================
  const handleAddMergeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;
    setBusy(true);
    const items: MergeItem[] = [];
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        items.push({ id: uid('mf'), name: file.name, bytes, pageCount: doc.getPageCount() });
      } catch {
        setStatus({ kind: 'error', text: `Skipped “${file.name}” — not a readable PDF.` });
      }
    }
    setMergeFiles((prev) => [...prev, ...items]);
    setBusy(false);
  };

  const handleDownloadMerged = async () => {
    if (mergeFiles.length === 0) return;
    setBusy(true);
    try {
      const merged = await PDFDocument.create();
      for (const item of mergeFiles) {
        const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
        const copied = await merged.copyPages(src, src.getPageIndices());
        copied.forEach((p) => merged.addPage(p));
      }
      downloadBytes(await merged.save(), `IK-Merged-${Date.now()}.pdf`);
      setStatus({ kind: 'ok', text: 'Merged PDF downloaded.' });
    } catch (err: any) {
      setStatus({ kind: 'error', text: `Merge failed: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSplitFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      setSplitPdf({ name: file.name.replace(/\.pdf$/i, ''), bytes, pageCount: doc.getPageCount() });
      setSplitRange(`1-${doc.getPageCount()}`);
    } catch {
      setStatus({ kind: 'error', text: 'That file is not a readable PDF.' });
    }
  };

  const handleExtractSplit = async () => {
    if (!splitPdf) return;
    const indices: number[] = [];
    for (const part of splitRange.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('-')) {
        const [a, b] = trimmed.split('-').map((n) => parseInt(n.trim(), 10));
        if (!isNaN(a) && !isNaN(b)) {
          for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
            if (p >= 1 && p <= splitPdf.pageCount) indices.push(p - 1);
          }
        }
      } else {
        const p = parseInt(trimmed, 10);
        if (!isNaN(p) && p >= 1 && p <= splitPdf.pageCount) indices.push(p - 1);
      }
    }
    if (indices.length === 0) {
      setStatus({ kind: 'error', text: 'Enter valid page numbers, e.g. 1-3, 5' });
      return;
    }
    setBusy(true);
    try {
      const src = await PDFDocument.load(splitPdf.bytes, { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      downloadBytes(await out.save(), `${splitPdf.name}-Extracted.pdf`);
      setStatus({ kind: 'ok', text: `Extracted ${indices.length} page(s).` });
    } catch (err: any) {
      setStatus({ kind: 'error', text: `Extract failed: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  };

  // =====================================================================
  // UI helpers
  // =====================================================================
  const statusBanner = status ? (
    <div
      className={`px-3 py-1.5 text-[11px] flex items-center gap-2 border-b ${
        status.kind === 'error'
          ? 'bg-rose-950/60 border-rose-800/70 text-rose-200'
          : status.kind === 'ok'
          ? 'bg-emerald-950/60 border-emerald-800/70 text-emerald-200'
          : 'bg-slate-900 border-slate-800 text-slate-300'
      }`}
    >
      {status.kind === 'error' ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      ) : status.kind === 'ok' ? (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
      )}
      <span className="flex-1">{status.text}</span>
      {status.actions?.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
            status.kind === 'error'
              ? 'bg-rose-900/60 hover:bg-rose-800 border-rose-700 text-rose-100'
              : 'bg-emerald-700/60 hover:bg-emerald-600 border-emerald-600 text-white'
          }`}
        >
          {action.label}
        </button>
      ))}
      <button onClick={() => setStatus(null)} className="opacity-60 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  const toolBtn = (
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    label: React.ReactNode,
    extraClass = ''
  ) => (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 transition ${extraClass} ${
        active
          ? 'bg-emerald-600 border-emerald-500 text-white shadow'
          : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-slate-950 min-h-0">
      {/* ---------------- Top bar ---------------- */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Type className="w-3.5 h-3.5" /> PDF Editor
          </button>
          <button
            onClick={() => setActiveTab('merge')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'merge' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Merge
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              activeTab === 'split' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" /> Split
          </button>
        </div>

        {activeTab === 'editor' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setAiOpen((v) => {
                  if (!v) setTextPanelOpen(false);
                  return !v;
                })
              }
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
                aiOpen
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-gradient-to-r from-emerald-900/70 to-slate-800 border-emerald-700/70 text-emerald-200 hover:from-emerald-900'
              }`}
              title="Tell the AI what to replace, add or remove"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI Assistant
            </button>
            <button
              onClick={() => {
                setTextPanelOpen((v) => {
                  if (!v) setAiOpen(false);
                  return !v;
                });
                setTool((t) => (t === 'text_edit' ? 'move' : t));
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition ${
                textPanelOpen
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-sky-200 hover:bg-slate-700'
              }`}
              title="Every line of text in this PDF, ready to edit"
            >
              <Pencil className="w-3.5 h-3.5" /> Text
              {mergedTextIndex && mergedTextIndex.totalChars > 0 && (
                <span className="text-[9px] px-1 rounded bg-black/30 font-mono">
                  {mergedTextIndex.pages.reduce((n, p) => n + p.lines.length, 0)}
                </span>
              )}
            </button>
            <button
              onClick={handleExportEditedPdf}
              disabled={busy || pages.length === 0}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1.5 shadow"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download PDF
            </button>
          </div>
        )}
      </div>

      {statusBanner}

      {/* ---------------- TAB: EDITOR ---------------- */}
      {activeTab === 'editor' && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Tool strip */}
            {pages.length > 0 && (
              <div className="bg-slate-900/70 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center gap-1.5 shrink-0">
                {toolBtn(tool === 'move', () => setTool('move'), <Move className="w-3.5 h-3.5" />, 'Move / Edit')}
                {toolBtn(
                  tool === 'text_edit',
                  () => {
                    setTool('text_edit');
                    setTextPanelOpen(true);
                  },
                  <Pencil className="w-3.5 h-3.5" />,
                  'Edit Text',
                  'hover:border-emerald-500'
                )}
                {toolBtn(
                  tool === 'whiteout',
                  () => setTool('whiteout'),
                  <Eraser className="w-3.5 h-3.5" />,
                  'Whiteout',
                  'hover:border-amber-500'
                )}
                {toolBtn(
                  tool === 'cover_retype',
                  () => setTool('cover_retype'),
                  <span className="flex items-center">
                    <Eraser className="w-3.5 h-3.5" />
                    <Type className="w-3.5 h-3.5 -ml-1" />
                  </span>,
                  <>
                    Cover &amp; Retype
                    <span className="urdu-naskh font-normal ml-1">ڈھانپیں اور لکھیں</span>
                    <span className="text-[9px] px-1 rounded bg-black/30 font-mono ml-1">R</span>
                  </>,
                  'hover:border-amber-500'
                )}
                {toolBtn(tool === 'text_urdu', () => setTool('text_urdu'), <Type className="w-3.5 h-3.5" />, '+ اردو ٹیکسٹ')}
                {toolBtn(tool === 'text_en', () => setTool('text_en'), <Type className="w-3.5 h-3.5" />, '+ English Text')}

                <input ref={imgOverlayInputRef} type="file" accept="image/*" onChange={handleAddImageOverlay} className="hidden" />
                <button
                  onClick={() => imgOverlayInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center gap-1"
                >
                  <ImagePlus className="w-3.5 h-3.5 text-sky-400" /> Sign / Photo
                </button>

                <div className="w-px h-6 bg-slate-700 mx-0.5" />

                <button
                  onClick={undo}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={redo}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>

                <label className="flex items-center gap-1 text-xs text-slate-300 bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addPageNumbers}
                    onChange={(e) => setAddPageNumbers(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <Hash className="w-3 h-3" /> Page #
                </label>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 flex items-center gap-1"
                >
                  <FileUp className="w-3.5 h-3.5" /> Open PDF
                </button>
                <span className="text-[11px] text-slate-500">
                  {overlays.length} edit{overlays.length === 1 ? '' : 's'}
                </span>
              </div>
            )}

            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileInput} className="hidden" />

            {/* Editor body */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              {pages.length === 0 ? (
                <div
                  className="flex-1 flex items-center justify-center p-6 overflow-y-auto"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="max-w-2xl w-full grid sm:grid-cols-2 gap-4">
                    <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-900/60 rounded-2xl p-7 flex flex-col items-center text-center cursor-pointer transition">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                        {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <FileUp className="w-7 h-7" />}
                      </div>
                      <h3 className="text-base font-bold text-white mb-1">Open Any PDF to Edit</h3>
                      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                        Drag &amp; drop a PDF here. Its text is read automatically — click any line and
                        rewrite it in place. Erase old text, add Urdu Nastaliq / English text, stamp
                        signatures or photos.
                      </p>
                      <span className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                        {busy ? 'Opening…' : 'Choose PDF File'}
                      </span>
                      <input type="file" accept="application/pdf" onChange={handleFileInput} className="hidden" />
                    </label>

                    <button
                      onClick={() => {
                        setAiOpen(true);
                        if (!pdfBytes) setTimeout(() => fileInputRef.current?.click(), 50);
                      }}
                      className="border-2 border-dashed border-emerald-700/60 hover:border-emerald-500 bg-gradient-to-br from-emerald-950/50 to-slate-900/60 rounded-2xl p-7 flex flex-col items-center text-center transition"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-emerald-600/25 text-emerald-300 flex items-center justify-center mb-3">
                        <Sparkles className="w-7 h-7" />
                      </div>
                      <h3 className="text-base font-bold text-white mb-1">AI PDF Assistant</h3>
                      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                        Upload the PDF and simply say: <em>“replace Ahmed with Bilal”</em>,{' '}
                        <em>“remove the phone number”</em> or <em>“add Approved at the bottom”</em>.
                      </p>
                      <span className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold">
                        Start AI Editing
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Thumbnails */}
                  <div className="w-44 bg-slate-900 border-r border-slate-800 overflow-y-auto p-2.5 space-y-2.5 shrink-0 hidden sm:block">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold px-1">
                      {pages.length} page{pages.length === 1 ? '' : 's'}
                    </div>
                    {pages.map((p, idx) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedPageIdx(idx)}
                        className={`rounded-xl p-2 border cursor-pointer transition ${
                          selectedPageIdx === idx
                            ? 'border-emerald-500 bg-emerald-950/30'
                            : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                        }`}
                      >
                        <img
                          src={p.thumbUrl}
                          alt={`Page ${idx + 1}`}
                          className="w-full rounded bg-white mb-1.5"
                          style={{
                            transform: `rotate(${normalizeRotation(p.extraRotation)}deg)`,
                            maxHeight: 150,
                            objectFit: 'contain',
                          }}
                        />
                        <div className="flex items-center justify-between text-[10px] text-slate-300">
                          <span className="font-bold">Page {idx + 1}</span>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(idx, -1);
                              }}
                              disabled={idx === 0}
                              className="p-1 hover:bg-slate-800 rounded text-slate-300 disabled:opacity-30"
                              title="Move up"
                            >
                              <ArrowUp className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePage(idx, 1);
                              }}
                              disabled={idx === pages.length - 1}
                              className="p-1 hover:bg-slate-800 rounded text-slate-300 disabled:opacity-30"
                              title="Move down"
                            >
                              <ArrowDown className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                rotatePage(idx);
                              }}
                              className="p-1 hover:bg-slate-800 rounded text-slate-300"
                              title="Rotate 90°"
                            >
                              <RotateCw className="w-2.5 h-2.5" />
                            </button>
                            {pages.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePage(idx);
                                }}
                                className="p-1 hover:bg-rose-950 rounded text-rose-400"
                                title="Delete page"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Stage */}
                  <div className="flex-1 overflow-auto p-4 flex flex-col items-center min-w-0">
                    {tool !== 'move' && (
                      <div className="mb-2 px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-200 text-[11px] font-semibold">
                        {tool === 'text_edit' ? (
                          <>
                            Click any line of text on the page to rewrite it in place ·{' '}
                            <kbd className="font-mono">Esc</kbd> to cancel
                          </>
                        ) : tool === 'cover_retype' ? (
                          <>
                            Click on the page where the old text is — a whiteout box opens and you type
                            the replacement · <kbd className="font-mono">Esc</kbd> to cancel
                          </>
                        ) : (
                          <>
                            Click on the page to place{' '}
                            {tool === 'whiteout'
                              ? 'a whiteout box'
                              : tool === 'text_urdu'
                              ? 'Urdu text'
                              : 'English text'}{' '}
                            · <kbd className="font-mono">Esc</kbd> to cancel
                          </>
                        )}
                      </div>
                    )}

                    {/* Inline editor card — click-to-edit line, or Cover & Retype free text */}
                    {inlineEdit && (
                      <div className="mb-2 w-full max-w-3xl bg-slate-900 border-2 border-emerald-500 rounded-xl px-3 py-2.5 shadow-2xl space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-300">
                          {inlineEdit.kind === 'line' ? (
                            <Pencil className="w-3.5 h-3.5" />
                          ) : (
                            <span className="flex items-center text-emerald-300">
                              <Eraser className="w-3.5 h-3.5" />
                              <Type className="w-3.5 h-3.5 -ml-1" />
                            </span>
                          )}
                          {inlineEdit.kind === 'line' ? (
                            <span>Editing page {inlineEdit.page}</span>
                          ) : (
                            <span>
                              Cover &amp; Retype · page {inlineEdit.page}{' '}
                              <span className="urdu-naskh font-normal">ڈھانپیں اور لکھیں</span>
                            </span>
                          )}
                          {inlineEdit.kind === 'line' ? (
                            <span className="text-slate-500 font-mono font-normal">
                              {inlineEdit.line.id} · {inlineEdit.line.fontSize.toFixed(1)} pt ·{' '}
                              {inlineEdit.line.rtl ? 'اردو' : 'English'}
                              {inlineEdit.line.source === 'ocr' ? ' · AI box' : ''}
                            </span>
                          ) : (
                            <span className="text-slate-500 font-mono font-normal">
                              whiteout {Math.round(COVER_RETYPE_W * 100)}% ×{' '}
                              {Math.round(COVER_RETYPE_H * 100)}%
                            </span>
                          )}
                          <button
                            onClick={() => cancelInlineEdit(inlineEdit)}
                            className="ml-auto p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                            title="Close (Esc)"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {inlineEdit.kind === 'free' && (
                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            The whiteout box stays on the page. Your text is fitted inside it — Urdu is
                            right-aligned automatically. Works on scans and on normal PDFs.
                          </p>
                        )}
                        <textarea
                          autoFocus
                          dir={
                            inlineEdit.kind === 'line'
                              ? inlineEdit.line.rtl
                                ? 'rtl'
                                : 'ltr'
                              : 'auto'
                          }
                          value={inlineEdit.value}
                          placeholder={inlineEdit.kind === 'free' ? 'Type replacement…' : undefined}
                          onChange={(e) =>
                            setInlineEdit((prev) =>
                              prev ? { ...prev, value: e.target.value } : prev
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelInlineEdit(inlineEdit);
                              return;
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (inlineEdit.kind === 'line') {
                                applyLineEdit(inlineEdit.page, inlineEdit.line, inlineEdit.value);
                                setInlineEdit(null);
                              } else {
                                applyFreeTextEdit(inlineEdit);
                              }
                            }
                          }}
                          rows={2}
                          className={`w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white outline-none focus:border-emerald-500 placeholder:text-slate-500 ${
                            inlineEdit.kind === 'line'
                              ? inlineEdit.line.rtl
                                ? 'urdu-nastaliq'
                                : ''
                              : looksRtl(inlineEdit.value)
                              ? 'urdu-nastaliq'
                              : ''
                          }`}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              if (inlineEdit.kind === 'line') {
                                applyLineEdit(inlineEdit.page, inlineEdit.line, inlineEdit.value);
                                setInlineEdit(null);
                              } else {
                                applyFreeTextEdit(inlineEdit);
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Apply to page
                          </button>
                          {inlineEdit.kind === 'line' ? (
                            <button
                              onClick={() => {
                                applyLineEdit(inlineEdit.page, inlineEdit.line, '');
                                setInlineEdit(null);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete line
                            </button>
                          ) : (
                            <button
                              onClick={() => cancelInlineEdit(inlineEdit)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
                              title="Remove the whiteout box and the typed text"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete box
                              <span className="urdu-naskh font-normal">ڈبہ حذف</span>
                            </button>
                          )}
                          <button
                            onClick={() => cancelInlineEdit(inlineEdit)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                          >
                            Cancel
                          </button>
                          <span className="text-[10px] text-slate-500">
                            Enter = apply · Shift+Enter = new line · Esc = cancel
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Selected overlay inspector */}
                    {selectedOverlay && (
                      <div className="mb-3 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 shadow-xl max-w-3xl w-full">
                        {isTextKind(selectedOverlay.kind) ? (
                          <>
                            <input
                              type="text"
                              dir={selectedOverlay.kind === 'text_urdu' ? 'rtl' : 'ltr'}
                              value={selectedOverlay.text || ''}
                              onChange={(e) => updateOverlay(selectedOverlay.id, { text: e.target.value }, false)}
                              className={`flex-1 min-w-[180px] bg-slate-950 border border-emerald-500 rounded-lg px-3 py-1.5 text-sm text-white ${
                                selectedOverlay.kind === 'text_urdu' ? 'urdu-nastaliq' : ''
                              }`}
                              placeholder="Text…"
                            />
                            <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                              <span className="text-[10px] text-slate-500">Size</span>
                              <input
                                type="number"
                                min={5}
                                max={96}
                                value={Math.round(selectedOverlay.fontSize || 12)}
                                onChange={(e) =>
                                  updateOverlay(selectedOverlay.id, { fontSize: Number(e.target.value) || 12 }, false)
                                }
                                className="w-12 bg-transparent text-xs text-white outline-none"
                              />
                            </div>
                            <input
                              type="color"
                              value={selectedOverlay.color || '#000000'}
                              onChange={(e) => {
                                setTextColor(e.target.value);
                                updateOverlay(selectedOverlay.id, { color: e.target.value }, false);
                              }}
                              className="w-8 h-8 rounded cursor-pointer bg-transparent"
                              title="Text colour"
                            />
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 flex-1">
                            <span className="font-semibold text-slate-200">
                              {selectedOverlay.kind === 'whiteout' ? 'Whiteout box' : 'Image'}
                            </span>
                            <span>Width</span>
                            <input
                              type="range"
                              min={0.02}
                              max={0.95}
                              step={0.005}
                              value={selectedOverlay.w}
                              onChange={(e) => updateOverlay(selectedOverlay.id, { w: Number(e.target.value) }, false)}
                              className="w-24 accent-emerald-500"
                            />
                            <span>Height</span>
                            <input
                              type="range"
                              min={0.01}
                              max={0.75}
                              step={0.005}
                              value={selectedOverlay.h}
                              onChange={(e) => updateOverlay(selectedOverlay.id, { h: Number(e.target.value) }, false)}
                              className="w-24 accent-emerald-500"
                            />
                          </div>
                        )}
                        <button
                          onClick={deleteSelected}
                          className="px-2 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>
                    )}

                    {previewError && (
                      <div className="mb-2 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> {previewError}
                      </div>
                    )}

                    <div className="relative">
                      {previewBusy && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/40 rounded">
                          <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
                        </div>
                      )}
                      {activePagePreview && (
                        <div
                          ref={stageRef}
                          onClick={handleStageClick}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={handleDrop}
                          className={`relative shadow-2xl bg-white select-none ${tool !== 'move' ? 'cursor-crosshair' : ''}`}
                        >
                          <img
                            ref={pageImgRef}
                            src={activePagePreview}
                            data-stage-bg="true"
                            alt="PDF page"
                            className="max-w-[760px] w-full h-auto block"
                            draggable={false}
                          />

                          {pageOverlays.map((ov) => {
                            const selected = ov.id === selectedOverlayId;
                            const baseStyle: React.CSSProperties = {
                              left: `${ov.x * 100}%`,
                              top: `${ov.y * 100}%`,
                              width: `${ov.w * 100}%`,
                              height: `${ov.h * 100}%`,
                            };

                            if (ov.kind === 'whiteout') {
                              return (
                                <div
                                  key={ov.id}
                                  onMouseDown={(e) => startDragOverlay(e, ov)}
                                  style={baseStyle}
                                  className={`absolute bg-white cursor-move ${
                                    selected ? 'ring-2 ring-amber-500' : 'border border-dashed border-slate-300/70'
                                  }`}
                                  title="Whiteout mask — drag to move"
                                />
                              );
                            }
                            if (ov.kind === 'image' && ov.imageDataUrl) {
                              return (
                                <img
                                  key={ov.id}
                                  src={ov.imageDataUrl}
                                  alt="Overlay"
                                  onMouseDown={(e) => startDragOverlay(e, ov)}
                                  style={baseStyle}
                                  className={`absolute object-fill cursor-move ${selected ? 'ring-2 ring-emerald-500' : ''}`}
                                  draggable={false}
                                />
                              );
                            }
                            const raster = textRasters.get(ov.id);
                            if (!raster) {
                              // Fonts still loading — show live text until the raster is ready
                              return (
                                <div
                                  key={ov.id}
                                  dir={ov.kind === 'text_urdu' ? 'rtl' : 'ltr'}
                                  onMouseDown={(e) => startDragOverlay(e, ov)}
                                  style={{
                                    ...baseStyle,
                                    fontSize: `${(ov.fontSize || 12) * pxPerPt}px`,
                                    color: ov.color || '#000000',
                                    lineHeight: 1.25,
                                    whiteSpace: 'pre',
                                  }}
                                  className={`absolute cursor-move ${
                                    ov.kind === 'text_urdu' ? 'urdu-nastaliq' : 'font-sans'
                                  } ${selected ? 'ring-2 ring-emerald-500 rounded-sm' : ''}`}
                                >
                                  {ov.text}
                                </div>
                              );
                            }
                            return (
                              <img
                                key={ov.id}
                                src={raster.src}
                                alt={ov.text || ''}
                                onMouseDown={(e) => startDragOverlay(e, ov)}
                                style={{
                                  left: `${ov.x * 100}%`,
                                  top: `${ov.y * 100}%`,
                                  width: `${raster.w * 100}%`,
                                  height: `${raster.h * 100}%`,
                                }}
                                className={`absolute cursor-move ${
                                  selected ? 'ring-2 ring-emerald-500 rounded-sm' : 'hover:ring-1 hover:ring-sky-400'
                                }`}
                                draggable={false}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {meta && (
                      <div className="mt-2 text-[10px] text-slate-500">
                        Page {selectedPageIdx + 1} of {pages.length} ·{' '}
                        {Math.round(viewSize(meta).w)}×{Math.round(viewSize(meta).h)} pt
                        {meta.extraRotation ? ' · rotated' : ''}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AI panel */}
          {aiOpen && (
            <div className="fixed lg:static inset-y-14 right-0 z-40 flex">
              <PdfAiAssistant
                hasPdf={pages.length > 0}
                pdfName={pdfName}
                pageCount={pages.length}
                textIndex={mergedTextIndex}
                extracting={extracting}
                extractError={extractError}
                groqReady={groqReady}
                onOpenSettings={() => onOpenGroqModal?.()}
                onPickPdf={() => fileInputRef.current?.click()}
                onApplyDrafts={applyAiDrafts}
                onFocusPage={(page) => setSelectedPageIdx(pageIndexForAiPage(page))}
                onClose={() => setAiOpen(false)}
              />
            </div>
          )}

          {/* Editable-text panel — auto-filled as soon as a PDF is opened */}
          {textPanelOpen && (
            <div className="fixed lg:static inset-y-14 right-0 z-40 flex">
              <PdfTextEditor
                pdfName={pdfName}
                hasPdf={pages.length > 0}
                textIndex={mergedTextIndex}
                extracting={extracting}
                extractProgress={extractProgress}
                extractError={extractError}
                currentPage={pages[selectedPageIdx]?.originalIndex + 1 || 1}
                editedKeys={editedKeys}
                groqReady={groqReady}
                onOpenSettings={() => onOpenGroqModal?.()}
                onPickPdf={() => fileInputRef.current?.click()}
                onRetryExtract={() => {
                  extractTriedRef.current = '';
                  setExtractNonce((n) => n + 1);
                }}
                onFocusPage={(page) => setSelectedPageIdx(pageIndexForAiPage(page))}
                onReplace={(page, line, text) => applyLineEdit(page, line, text)}
                onRemove={(page, line) => applyLineEdit(page, line, '')}
                onEditOnPage={(page, line) => {
                  setSelectedPageIdx(pageIndexForAiPage(page));
                  setInlineEdit({ kind: 'line', page, line, value: line.text });
                }}
                onOcrPage={(page) => runPageOcr(page)}
                ocrBusyPage={ocrBusyPage}
                focusLineKey={focusLineKey}
                onCoverRetype={(page) => {
                  setSelectedPageIdx(pageIndexForAiPage(page));
                  setTool('cover_retype');
                  setStatus({
                    kind: 'info',
                    text: 'Cover & Retype: click on the page where the old text is — a whiteout box opens with a typing card. Esc cancels.',
                  });
                }}
                onClose={() => setTextPanelOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* ---------------- TAB: MERGE ---------------- */}
      {activeTab === 'merge' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">Merge Multiple PDF Files</h3>
                <p className="text-xs text-slate-400">
                  Combine CNIC, degrees, forms &amp; challans into one clean PDF.
                </p>
              </div>
              <label className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shrink-0">
                <Plus className="w-4 h-4" /> Add PDFs
                <input type="file" accept="application/pdf" multiple onChange={handleAddMergeFiles} className="hidden" />
              </label>
            </div>

            {mergeFiles.length === 0 ? (
              <div className="border-2 border-dashed border-slate-800 rounded-xl p-10 text-center text-xs text-slate-400">
                No PDF files added yet. Add 2 or more PDFs to combine them.
              </div>
            ) : (
              <div className="space-y-2 mb-5">
                {mergeFiles.map((f, idx) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{f.name}</div>
                      <div className="text-xs text-emerald-400">{f.pageCount} pages</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        disabled={idx === 0}
                        onClick={() =>
                          setMergeFiles((prev) => {
                            const copy = [...prev];
                            [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                            return copy;
                          })
                        }
                        className="p-1.5 rounded bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        disabled={idx === mergeFiles.length - 1}
                        onClick={() =>
                          setMergeFiles((prev) => {
                            const copy = [...prev];
                            [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                            return copy;
                          })
                        }
                        className="p-1.5 rounded bg-slate-800 disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setMergeFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        className="p-1.5 rounded bg-rose-950 text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mergeFiles.length >= 2 && (
              <button
                onClick={handleDownloadMerged}
                disabled={busy}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Merge {mergeFiles.length} PDFs &amp; Download
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------------- TAB: SPLIT ---------------- */}
      {activeTab === 'split' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white">Split / Extract Specific Pages</h3>
              <p className="text-xs text-slate-400">
                Keep only the pages the customer needs (e.g. challan page 1, or pages 2-5).
              </p>
            </div>

            <label className="block border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-6 text-center cursor-pointer">
              <span className="text-xs font-bold text-emerald-400">
                {splitPdf
                  ? `${splitPdf.name}.pdf — ${splitPdf.pageCount} total pages`
                  : 'Click to Select PDF File'}
              </span>
              <input type="file" accept="application/pdf" onChange={handleLoadSplitFile} className="hidden" />
            </label>

            {splitPdf && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Pages to extract (e.g. <span className="font-mono text-emerald-400">1-3, 5, 8</span>)
                  </label>
                  <input
                    type="text"
                    value={splitRange}
                    onChange={(e) => setSplitRange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  onClick={handleExtractSplit}
                  disabled={busy}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Scissors className="w-4 h-4" /> Extract &amp; Download
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
