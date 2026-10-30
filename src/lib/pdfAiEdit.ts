// IK Computers — AI PDF editing planner (Groq)
// Turns a plain instruction ("Ahmed ko Bilal se badlo") into concrete overlay
// operations: white-out the old text and draw the new text in its place.
import {
  buildTextDigest,
  findTextInPage,
  looksRtl,
  type PdfTextIndex,
} from './pdfText';
import { fitTextOverlay, isTextKind, newOverlayId, type PdfOverlay } from './pdfOverlay';

export type PdfAiOperation =
  | { type: 'replace'; page: number; find: string; replaceWith: string; note?: string }
  | { type: 'remove'; page: number; find: string; note?: string }
  | {
      type: 'add';
      page: number;
      x: number;
      y: number;
      text: string;
      fontSize?: number;
      color?: string;
      align?: 'left' | 'center' | 'right';
      note?: string;
    };

export interface PdfAiPlan {
  reply: string;
  operations: PdfAiOperation[];
}

export interface AiDraft {
  id: string;
  page: number; // 1-based
  label: string;
  overlays: PdfOverlay[];
  warnings: string[];
}

export interface AiResolveResult {
  drafts: AiDraft[];
  issues: string[];
}

export const PDF_EDIT_SYSTEM_PROMPT = `You are the AI PDF Editor inside "IK Computers", a Pakistani print & composing shop. You receive the extracted text lines of a customer PDF plus one instruction written in English, Roman Urdu or Urdu.

You must answer with a SINGLE strict JSON object (no markdown, no comments):
{
  "reply": "short, friendly explanation in the SAME language as the instruction",
  "operations": [ ... ]
}

Allowed operations:
1. Replace text inside an existing line:
   {"type":"replace","page":1,"find":"exact excerpt copied from a listed line","replaceWith":"new text","note":"optional"}
2. Delete text:
   {"type":"remove","page":1,"find":"exact excerpt copied from a listed line","note":"optional"}
3. Add brand new text anywhere on a page:
   {"type":"add","page":1,"x":0.12,"y":0.88,"text":"new text","fontSize":12,"color":"#000000","align":"left","note":"optional"}

HARD RULES
- "find" MUST be copied character-for-character from the listed lines (same spelling, digits, punctuation). Never invent text that is not in the document.
- Keep "find" as short as possible while still unique on that page (usually 1–5 words).
- x / y for add are fractions 0..1 measured from the TOP-LEFT corner of the page. y=0 is the top edge, y=1 is the bottom edge.
- fontSize is in PDF points. Use the sizes you see in the document (typically 9–14 for body text, 16–28 for headings).
- If the instruction is a question or a request for a summary, return "operations": [] and put the answer in "reply".
- If the requested text cannot be found in the document, do NOT guess: leave it out and explain that in "reply".
- If the instruction is in Urdu, write the operation text in Urdu script. If it is in Roman Urdu, still produce proper Urdu script for Urdu document text when the target place looks Urdu.
- Never return more than 25 operations.
- If nothing should change, return an empty operations array.`;

export function buildPdfEditUserPrompt(index: PdfTextIndex, instruction: string): string {
  return `DOCUMENT TEXT (extracted from the customer PDF):
${buildTextDigest(index)}

USER INSTRUCTION:
${instruction.trim()}

Return the JSON object now.`;
}

/** Tolerant JSON extraction from an LLM response. */
export function parsePdfAiPlan(raw: string): PdfAiPlan {
  let text = (raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The AI reply was not valid JSON. Please rephrase the instruction and try again.');
  }

  const reply = typeof parsed?.reply === 'string' ? parsed.reply : '';
  const rawOps = Array.isArray(parsed?.operations) ? parsed.operations : [];
  const operations: PdfAiOperation[] = [];

  for (const op of rawOps.slice(0, 30)) {
    if (!op || typeof op !== 'object') continue;
    const type = String(op.type || '').toLowerCase();
    const page = Math.max(1, Math.round(Number(op.page) || 1));
    if (type === 'replace' || type === 'remove') {
      const find = String(op.find ?? op.text ?? '').trim();
      if (!find) continue;
      if (type === 'replace') {
        const replaceWith = String(op.replaceWith ?? op.replacement ?? op.with ?? '');
        operations.push({ type: 'replace', page, find, replaceWith, note: op.note });
      } else {
        operations.push({ type: 'remove', page, find, note: op.note });
      }
    } else if (type === 'add' || type === 'insert') {
      const value = String(op.text ?? op.content ?? '').trim();
      if (!value) continue;
      operations.push({
        type: 'add',
        page,
        x: Math.min(0.98, Math.max(0.01, Number(op.x ?? 0.1))),
        y: Math.min(0.98, Math.max(0.01, Number(op.y ?? 0.5))),
        text: value,
        fontSize: Math.min(96, Math.max(6, Number(op.fontSize ?? op.size ?? 12))),
        color: typeof op.color === 'string' ? op.color : '#000000',
        align: op.align === 'center' || op.align === 'right' ? op.align : 'left',
        note: op.note,
      });
    }
  }

  return { reply, operations };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function rectOf(m: { x: number; y: number; w: number; h: number }) {
  return { x: m.x, y: m.y, w: m.w, h: m.h };
}

/** Resolve planner operations into concrete overlays that the editor can apply. */
export function resolvePdfAiPlan(plan: PdfAiPlan, index: PdfTextIndex): AiResolveResult {
  const drafts: AiDraft[] = [];
  const issues: string[] = [];

  for (const op of plan.operations) {
    const pageInfo = index.pages.find((p) => p.page === op.page) ?? index.pages[0];
    if (!pageInfo) {
      issues.push('This PDF has no readable pages.');
      continue;
    }
    const viewW = pageInfo.widthPt;
    const viewH = pageInfo.heightPt;

    if (op.type === 'add') {
      const isUrdu = looksRtl(op.text);
      const fontSize = op.fontSize || 12;
      let overlay: PdfOverlay = {
        id: newOverlayId(),
        pageId: '',
        kind: isUrdu ? 'text_urdu' : 'text_en',
        x: clamp01(op.x),
        y: clamp01(op.y),
        w: 0.2,
        h: 0.04,
        text: op.text,
        fontSize,
        color: op.color || '#000000',
        origin: 'ai',
        note: op.note,
      };
      overlay = fitTextOverlay(overlay, viewW, viewH);
      if (op.align === 'center') overlay.x = clamp01(op.x - overlay.w / 2);
      else if (op.align === 'right') overlay.x = clamp01(op.x - overlay.w);
      if (overlay.x + overlay.w > 1) overlay.x = Math.max(0, 1 - overlay.w);
      if (overlay.y + overlay.h > 1) overlay.y = Math.max(0, 1 - overlay.h);
      drafts.push({
        id: newOverlayId(),
        page: pageInfo.page,
        label: `Page ${pageInfo.page} · Add “${op.text}”`,
        overlays: [overlay],
        warnings: [],
      });
      continue;
    }

    // ---- replace / remove -------------------------------------------------
    const matches = findTextInPage(pageInfo, op.find);
    if (matches.length === 0) {
      issues.push(`Page ${pageInfo.page}: could not find “${op.find}” in the document.`);
      continue;
    }

    // Prefer the first match unless several lines match identically (forms).
    const overlays: PdfOverlay[] = [];
    const warnings: string[] = [];

    for (const match of matches.slice(0, 6)) {
      const padX = match.h * 0.12;
      const padY = match.h * 0.16;
      const box = rectOf({
        x: clamp01(match.x - padX),
        y: clamp01(match.y - padY),
        w: Math.min(1, match.w + padX * 2),
        h: Math.min(1, match.h + padY * 2),
      });

      // Always white-out the old glyphs first.
      overlays.push({
        id: newOverlayId(),
        pageId: '',
        kind: 'whiteout',
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        origin: 'ai',
      });

      const replaceWith = op.type === 'replace' ? op.replaceWith : '';
      if (!replaceWith.trim()) continue; // pure removal

      const isUrdu = looksRtl(replaceWith);
      const kind: PdfOverlay['kind'] = isUrdu ? 'text_urdu' : 'text_en';

      // Fit the replacement into the space the old text occupied.
      let fontSize = Math.max(5, Math.min(96, match.line.fontSize || 11));
      let candidate: PdfOverlay = {
        id: newOverlayId(),
        pageId: '',
        kind,
        x: 0,
        y: 0,
        w: 0.1,
        h: 0.03,
        text: replaceWith,
        fontSize,
        color: '#000000',
        origin: 'ai',
        note: op.note,
      };
      let fitted = fitTextOverlay(candidate, viewW, viewH);
      if (fitted.w > box.w * 1.02) {
        const ratio = box.w / fitted.w;
        const shrunk = Math.max(fontSize * 0.66, fontSize * ratio);
        candidate = { ...candidate, fontSize: shrunk, w: 0.1, h: 0.03 };
        fitted = fitTextOverlay(candidate, viewW, viewH);
        if (fitted.w > box.w * 1.25) {
          warnings.push(
            `“${replaceWith}” is longer than the original text — it may overlap nearby text.`
          );
        }
      }

      // Keep the new text anchored where the old text started (left for Latin,
      // right for Urdu) and centre it vertically on the old glyph box.
      const verticalNudge = (fitted.h - match.h) / 2;
      fitted.x = isUrdu ? match.x + match.w - fitted.w : match.x;
      fitted.y = match.y - verticalNudge;
      if (fitted.x + fitted.w > 1) fitted.x = Math.max(0, 1 - fitted.w);
      fitted.x = clamp01(fitted.x);
      fitted.y = clamp01(fitted.y);
      overlays.push(fitted);
    }

    drafts.push({
      id: newOverlayId(),
      page: pageInfo.page,
      label:
        op.type === 'replace'
          ? `Page ${pageInfo.page} · Replace “${op.find}” → “${op.replaceWith}”`
          : `Page ${pageInfo.page} · Remove “${op.find}”`,
      overlays,
      warnings,
    });
  }

  return { drafts, issues };
}

/** Quick example prompts shown as chips in the assistant panel. */
export const AI_EDIT_EXAMPLES = [
  'Replace the name Ahmed with Bilal',
  'Remove the phone number',
  'Add "For Bank Verification Only" at the bottom',
  'Change the date to 15-11-2026',
  'نام احمد کو بلال سے تبدیل کریں',
  'Is document mein kya likha hai?',
];

export function overlayKindLabel(o: PdfOverlay): string {
  if (o.kind === 'whiteout') return 'Whiteout';
  if (o.kind === 'image') return 'Image';
  return isTextKind(o.kind) ? 'Text' : String(o.kind);
}
