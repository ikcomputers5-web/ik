// IK Computers — Groq LPU AI Client (Browser-Direct CORS to api.groq.com)
//
// Groq regularly retires model IDs (Llama 4 vision was pulled without notice),
// so nothing here is allowed to hard-depend on one model id any more:
//   • listGroqModels()       — live model list for this key
//   • resolveVisionModels()  — ordered, self-healing vision candidate list
//   • resolveTextModelChain() — same idea for the writing/assistant models
// A retired model simply 404s and we move on to the next candidate.

export interface GroqSettings {
  apiKey: string;
  fastModel: string;
  smartModel: string;
  visionModel: string;
  enableLiveSuggestions: boolean;
}

const STORAGE_KEY = 'ik_groq_settings_v1';
const VISION_MODEL_KEY = 'ik_groq_vision_model_v1';

const DEFAULT_SETTINGS: GroqSettings = {
  apiKey: '',
  fastModel: 'llama-3.1-8b-instant',
  smartModel: 'llama-3.3-70b-versatile',
  visionModel: 'qwen/qwen3.8-27b',
  enableLiveSuggestions: true,
};

/** Last-resort vision ids — only used when the live list cannot be read. */
export const VISION_MODEL_HINTS = ['qwen/qwen3.8-27b', 'meta-models/muse-spark-open'];

/** Anything that looks like it can read an image. */
const VISION_MODEL_RE = /qwen3.*(-vl)?|vision|muse|llama-4|scout|maverick|omni/i;

/** Models that can never answer a chat completion — keep them out of fallbacks. */
const NON_CHAT_MODEL_RE = /whisper|tts|guard|embed|moderation|rerank|playai/i;

export const INVALID_KEY_MESSAGE =
  'Your Groq key is invalid or expired. Open Groq settings and paste a new key.';
export const RATE_LIMIT_MESSAGE = 'Groq is rate-limiting. Wait 30 seconds and try again.';
export const NO_VISION_MODEL_MESSAGE =
  "No vision model is available on this key. Press 'Test connection' in Groq settings to see the models you can use.";

/** Typed Groq failure so callers can tell "bad key" from "temporary problem". */
export class GroqApiError extends Error {
  status: number;
  code: 'invalid_key' | 'rate_limit' | 'not_found' | 'no_model' | 'http';

  constructor(message: string, status: number, code: GroqApiError['code']) {
    super(message);
    this.name = 'GroqApiError';
    this.status = status;
    this.code = code;
  }
}

export function isGroqApiError(err: unknown): err is GroqApiError {
  return err instanceof GroqApiError;
}

export function getGroqSettings(): GroqSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveGroqSettings(partial: Partial<GroqSettings>): GroqSettings {
  const before = getGroqSettings();
  const next = { ...before, ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (before.apiKey !== next.apiKey) clearGroqModelCache();
  // Picking a vision model by hand means "use this one first next time".
  if (partial.visionModel !== undefined && partial.visionModel.trim()) {
    rememberVisionModel(partial.visionModel.trim());
  }
  window.dispatchEvent(new CustomEvent('ik-groq-updated', { detail: next }));
  return next;
}

export function hasGroqKey(): boolean {
  const { apiKey } = getGroqSettings();
  return Boolean(apiKey && apiKey.trim().length > 10);
}

// =====================================================================
// Model discovery
// =====================================================================

let modelsCache: { key: string; ids: string[]; at: number } | null = null;
const MODELS_CACHE_MS = 120_000;

export function clearGroqModelCache(): void {
  modelsCache = null;
}

/**
 * Live list of model ids this key may use (sorted).
 * Throws a typed `GroqApiError` with status 401 when the key is not valid.
 */
export async function listGroqModels(apiKey?: string): Promise<string[]> {
  const key = (apiKey ?? getGroqSettings().apiKey).trim();
  if (!key) {
    throw new GroqApiError(
      'Please enter your Groq API Key (starts with gsk_...)',
      401,
      'invalid_key'
    );
  }

  if (modelsCache && modelsCache.key === key && Date.now() - modelsCache.at < MODELS_CACHE_MS) {
    return modelsCache.ids;
  }

  let res: Response;
  try {
    res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    throw new Error('Could not reach Groq. Check this PC’s internet connection and try again.');
  }

  if (res.status === 401 || res.status === 403) {
    throw new GroqApiError(INVALID_KEY_MESSAGE, res.status, 'invalid_key');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GroqApiError(
      body?.error?.message || `Groq model list failed (HTTP ${res.status})`,
      res.status,
      'http'
    );
  }

  const data = await res.json().catch(() => ({}));
  const ids: string[] = ((data?.data || []) as Array<{ id?: string }>)
    .map((m) => String(m?.id || '').trim())
    .filter(Boolean)
    .sort();

  modelsCache = { key, ids, at: Date.now() };
  return ids;
}

export function isVisionModelId(id: string): boolean {
  return VISION_MODEL_RE.test(id || '');
}

/** Preferred first: the ids we know work, then the rest alphabetically. */
function orderVisionCandidates(ids: string[]): string[] {
  const rank = (id: string) => {
    const index = VISION_MODEL_HINTS.indexOf(id);
    return index === -1 ? VISION_MODEL_HINTS.length : index;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function getRememberedVisionModel(): string {
  try {
    return (localStorage.getItem(VISION_MODEL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function rememberVisionModel(id: string): void {
  const value = (id || '').trim();
  if (!value) return;
  try {
    localStorage.setItem(VISION_MODEL_KEY, value);
  } catch {
    /* private mode — remembering is best effort */
  }
}

/**
 * Which id should be shown/highlighted as "the" vision model?
 * remembered (if still offered) → first discovered vision model → saved → hint.
 */
export function pickVisionModelFrom(
  models: string[],
  savedModel?: string,
  remembered?: string
): string | null {
  const list = models || [];
  const rememberedId = (remembered ?? '').trim();
  if (rememberedId && list.includes(rememberedId)) return rememberedId;
  const vision = orderVisionCandidates(list.filter(isVisionModelId));
  if (vision.length > 0) return vision[0];
  const saved = (savedModel ?? '').trim();
  if (saved) return saved;
  return VISION_MODEL_HINTS[0] ?? null;
}

/**
 * Ordered vision-model candidates for this key.
 *  1. the model that worked last time (localStorage)
 *  2. vision-capable ids the account actually exposes (live list)
 *  3. the operator's saved `visionModel`
 *  4. last-resort known ids
 * 404s are *not* filtered here — the caller skips them one by one, so a retired
 * id can never block OCR again.
 */
export async function resolveVisionModels(apiKey?: string): Promise<string[]> {
  const settings = getGroqSettings();
  const key = (apiKey ?? settings.apiKey).trim();

  const ordered: string[] = [];
  const add = (id?: string | null) => {
    const value = (id || '').trim();
    if (value && !ordered.includes(value)) ordered.push(value);
  };

  add(getRememberedVisionModel());

  if (key) {
    try {
      const ids = await listGroqModels(key);
      orderVisionCandidates(ids.filter(isVisionModelId)).forEach(add);
    } catch (err) {
      // A bad key must surface; a flaky list must not stop OCR.
      if (isGroqApiError(err) && err.status === 401) throw err;
    }
  }

  add(settings.visionModel);
  VISION_MODEL_HINTS.forEach(add);
  return ordered;
}

/**
 * Ordered text/chat model candidates: requested models first, then every chat
 * model this key can actually use (so a retired smartModel degrades instead of
 * failing).
 */
export async function resolveTextModelChain(requested: string[]): Promise<string[]> {
  const ordered: string[] = [];
  const add = (id?: string | null) => {
    const value = (id || '').trim();
    if (value && !ordered.includes(value)) ordered.push(value);
  };
  requested.forEach(add);
  try {
    const ids = await listGroqModels();
    ids.filter((id) => !NON_CHAT_MODEL_RE.test(id)).forEach(add);
  } catch {
    /* the requested ids (and the final error) still stand */
  }
  return ordered;
}

// =====================================================================
// Connection test (used by the settings modal)
// =====================================================================

export async function testGroqConnection(apiKeyOverride?: string): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  const key = (apiKeyOverride ?? getGroqSettings().apiKey).trim();
  if (!key) {
    return { ok: false, models: [], error: 'Please enter your Groq API Key (starts with gsk_...)' };
  }
  try {
    clearGroqModelCache();
    const models = await listGroqModels(key);
    return { ok: true, models };
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err?.message || 'Network error reaching api.groq.com',
    };
  }
}

// =====================================================================
// Generic chat completion with automatic model recovery
// =====================================================================

const MODEL_GONE_RE = /does not exist|model_not_found|not found|no longer|decommission|deprecat|unsupported model|invalid model/i;
const MAX_MODEL_ATTEMPTS = 6;

function errorMessageOf(body: any, status: number): string {
  return body?.error?.message || `Groq HTTP ${status}`;
}

function isRetiredModel(status: number, message: string): boolean {
  if (status === 404) return true;
  if (status === 400 || status === 422) return MODEL_GONE_RE.test(message);
  return false;
}

async function callGroqChat(
  messages: any[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    fallbackModel?: string;
    jsonMode?: boolean;
  } = {}
): Promise<string> {
  const settings = getGroqSettings();
  const key = settings.apiKey.trim();
  if (!key) {
    throw new Error('Groq API Key not configured. Click "Groq AI Key" in the top bar to add your key.');
  }

  const requested: string[] = [];
  if (options.model) requested.push(options.model);
  if (options.fallbackModel) requested.push(options.fallbackModel);
  if (!requested.includes(settings.smartModel)) requested.push(settings.smartModel);
  if (!requested.includes(settings.fastModel)) requested.push(settings.fastModel);

  const tryModels = await resolveTextModelChain(requested);
  let lastError = 'Groq request failed';
  let sawRateLimit = false;

  for (let i = 0; i < tryModels.length && i < MAX_MODEL_ATTEMPTS; i++) {
    const model = tryModels[i];
    for (const useJsonMode of options.jsonMode ? [true, false] : [false]) {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 1500,
      };
      if (useJsonMode) body.response_format = { type: 'json_object' };

      let res: Response;
      try {
        res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error('Could not reach Groq. Check this PC’s internet connection and try again.');
      }

      if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content?.trim() || '';
      }

      const errJson = await res.json().catch(() => ({}));
      const message = errorMessageOf(errJson, res.status);
      lastError = message;

      // Invalid key -> stop immediately, nothing else can work.
      if (res.status === 401) throw new GroqApiError(INVALID_KEY_MESSAGE, 401, 'invalid_key');
      if (res.status === 429) {
        sawRateLimit = true;
        break; // another model on the same key will be throttled too
      }
      // JSON mode rejected by this model -> retry once without it
      if (useJsonMode && (res.status === 400 || res.status === 422)) continue;
      // Retired / unknown model -> next candidate
      if (isRetiredModel(res.status, message)) break;
      break;
    }
    // Every model shares the same key quota — no point hammering the API.
    if (sawRateLimit) break;
  }

  if (sawRateLimit) throw new GroqApiError(RATE_LIMIT_MESSAGE, 429, 'rate_limit');
  throw new Error(lastError);
}

// =====================================================================
// Vision helpers
// =====================================================================

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

async function callVisionChat(
  messages: unknown[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<{ content: string; model: string }> {
  const settings = getGroqSettings();
  const key = settings.apiKey.trim();
  if (!key) {
    throw new Error('Please configure your Groq API Key first to use AI Urdu/English OCR.');
  }

  let candidates: string[] = [];
  try {
    candidates = await resolveVisionModels(key);
  } catch (err) {
    if (isGroqApiError(err) && err.status === 401) throw err;
    candidates = [];
  }
  if (candidates.length === 0) {
    throw new GroqApiError(NO_VISION_MODEL_MESSAGE, 400, 'no_model');
  }

  for (const model of candidates) {
    for (const useJsonMode of opts.jsonMode ? [true, false] : [false]) {
      const body: Record<string, unknown> = {
        model,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 2500,
        messages,
      };
      if (useJsonMode) body.response_format = { type: 'json_object' };

      let res: Response;
      try {
        res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error('Could not reach Groq. Check this PC’s internet connection and try again.');
      }

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content?.trim() || '';
        rememberVisionModel(model);
        return { content, model };
      }

      const errJson = await res.json().catch(() => ({}));
      const message = errorMessageOf(errJson, res.status);

      if (res.status === 401) throw new GroqApiError(INVALID_KEY_MESSAGE, 401, 'invalid_key');
      if (res.status === 429) throw new GroqApiError(RATE_LIMIT_MESSAGE, 429, 'rate_limit');
      // JSON mode not supported by this vision model -> retry plain text
      if (useJsonMode && (res.status === 400 || res.status === 422)) continue;
      // Retired model, missing endpoint, image unsupported -> try the next one.
      break;
    }
  }

  throw new GroqApiError(NO_VISION_MODEL_MESSAGE, 400, 'no_model');
}

// =====================================================================
// Text features
// =====================================================================

// Fast contextual Urdu word & short-phrase autocomplete suggestions
export async function fetchGroqUrduSuggestions(
  recentContext: string,
  currentToken: string
): Promise<string[]> {
  const settings = getGroqSettings();
  if (!settings.apiKey.trim() || !settings.enableLiveSuggestions) return [];

  const snippet = recentContext.slice(-220);
  const prompt = currentToken
    ? `Context: "${snippet}"\nCurrent partial word/Roman-Urdu: "${currentToken}"\nReturn ONLY a JSON array of 5 likely Urdu script word or 2-word completions in pure Urdu (Nastaliq spelling). No explanation.`
    : `Context: "${snippet}"\nReturn ONLY a JSON array of 5 likely next Urdu words or short 2-3 word phrases in pure Urdu script that naturally follow this text in a Pakistani composing/application context. No explanation.`;

  try {
    const raw = await callGroqChat(
      [
        {
          role: 'system',
          content:
            'You are an ultra-fast Pakistani Urdu composing autocomplete engine. Output strictly a JSON array of strings in Urdu script only, e.g. ["گزارش ہے","مہربانی فرما کر"].',
        },
        { role: 'user', content: prompt },
      ],
      {
        model: settings.fastModel,
        temperature: 0.2,
        maxTokens: 120,
      }
    );

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => String(x).trim())
      .filter((x) => x.length > 0 && x.length < 40)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// Draft full Urdu or English official application, affidavit, agreement, letter, notice
export async function draftShopDocumentWithGroq(
  userPrompt: string,
  language: 'urdu' | 'english' = 'urdu'
): Promise<string> {
  const settings = getGroqSettings();
  const sysPrompt =
    language === 'urdu'
      ? `آپ پاکستان کی مشہور کمپوزنگ شاپ "IK Computers" کے ماہر اردو کمپوزر اور قانونی و دفتری مسودہ نویس ہیں۔
صارف کی ہدایت کے مطابق مکمل، باوقار، درست اور پرنٹ کے لیے تیار اردو دستاویز لکھیں۔
صرف صاف HTML ٹیگز (<div dir="rtl">, <p>, <h2>, <strong>, <u>, <ol>, <li>, <br/>) استعمال کریں، کوئی markdown backticks نہ لگائیں۔`
      : `You are an expert official document composer at "IK Computers" in Pakistan.
Write a complete, formal, print-ready English official document/application/affidavit/letter based on the user's request.
Return clean HTML tags only (<div dir="ltr">, <p>, <h2>, <strong>, <u>, <ol>, <li>, <br/>) with no markdown code fences.`;

  const raw = await callGroqChat(
    [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      model: settings.smartModel,
      temperature: 0.35,
      maxTokens: 2200,
    }
  );

  return raw.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

export type TextTransformMode =
  | 'roman_to_urdu'
  | 'en_to_urdu'
  | 'urdu_to_en'
  | 'fix_urdu'
  | 'formalize_urdu';

export async function transformShopTextWithGroq(
  inputText: string,
  mode: TextTransformMode
): Promise<string> {
  const settings = getGroqSettings();
  const instructions: Record<TextTransformMode, string> = {
    roman_to_urdu:
      'Convert the following Roman Urdu text into accurate, natural, well-spelled Urdu script. Return ONLY the Urdu text.',
    en_to_urdu:
      'Translate the following English text into formal, natural Pakistani Urdu script suitable for official composing/printing. Return ONLY the Urdu translation.',
    urdu_to_en:
      'Translate the following Urdu text into clear, formal, professional English suitable for official documents. Return ONLY the English translation.',
    fix_urdu:
      'Correct all spelling, grammar, punctuation (۔ ، ؟), and honorific phrasing in the following Urdu text while preserving its exact meaning. Return ONLY the corrected Urdu text.',
    formalize_urdu:
      'Rewrite the following Urdu text into formal Pakistani official/legal style (مؤدبانہ دفتری و قانونی انداز). Return ONLY the polished Urdu text.',
  };

  return callGroqChat(
    [
      { role: 'system', content: instructions[mode] },
      { role: 'user', content: inputText },
    ],
    {
      model: settings.smartModel,
      temperature: 0.2,
      maxTokens: 2000,
    }
  );
}

// =====================================================================
// Vision OCR — plain text (documents already in the shop workflow)
// =====================================================================

export async function extractDocumentOcrWithGroq(imageDataUrl: string): Promise<string> {
  const settings = getGroqSettings();
  if (!settings.apiKey.trim()) {
    throw new Error('Please configure your Groq API Key first to use AI Urdu/English OCR.');
  }

  const { content } = await callVisionChat([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract ALL visible Urdu and English text from this document image accurately, preserving line breaks and structure. Return ONLY the extracted text without commentary.',
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl },
        },
      ],
    },
  ]);

  return content;
}

// =====================================================================
// Vision OCR — with positions, so scans become click-to-edit
// =====================================================================

export interface OcrBox {
  text: string;
  /** fraction 0..1 from the TOP-LEFT of the page image */
  x: number;
  y: number;
  w: number;
  h: number;
  rtl?: boolean;
}

export const MAX_OCR_LINES = 200;

/** Turn whatever the model said into safe, ordered boxes. Exported for tests. */
export function parseOcrBoxesJson(raw: string): OcrBox[] {
  if (!raw) return [];
  const cleaned = String(raw)
    .replace(/```json/gi, '')
    .replace(/```/gi, '')
    .trim();

  let parsed: any = null;
  const candidates = [cleaned];
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) candidates.push(cleaned.slice(objStart, objEnd + 1));
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1));

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      if (parsed) break;
    } catch {
      /* try the next slice */
    }
  }
  if (!parsed) return [];

  const rows: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.lines)
    ? parsed.lines
    : [];

  const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const out: OcrBox[] = [];
  for (const row of rows) {
    if (!row || typeof row.text !== 'string') continue;
    const text = row.text.replace(/\r/g, '').trim();
    if (!text) continue;
    const w = clamp01(num(row.w));
    const h = clamp01(num(row.h));
    if (w <= 0 || h <= 0) continue; // no size -> cannot place it
    // Keep the whole box inside the page (model numbers are approximate).
    const x = clamp01(Math.min(num(row.x), 1 - w));
    const y = clamp01(Math.min(num(row.y), 1 - h));
    const box: OcrBox = { text, x, y, w, h };
    if (row.rtl === true || row.rtl === 'true') box.rtl = true;
    out.push(box);
    if (out.length >= MAX_OCR_LINES) break;
  }

  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

/**
 * Read one page image and return every visual line WITH its position.
 * Coordinates are fractions of the image, measured from the top-left.
 */
export async function ocrPageWithBoxes(
  imageDataUrl: string,
  page: { widthPt: number; heightPt: number }
): Promise<OcrBox[]> {
  const prompt = [
    'You are a precise OCR engine for a Pakistani print shop.',
    'Read EVERY visible line of text in this document image — Urdu (Nastaliq/Naskh) and English.',
    '',
    'Return STRICT JSON only, exactly this shape, with no commentary and no markdown fences:',
    '{"lines":[{"text":"…","x":0.12,"y":0.34,"w":0.30,"h":0.02}]}',
    '',
    'Rules:',
    '- x, y, w, h are fractions from 0 to 1 measured from the TOP-LEFT of the image.',
    '- One object per visual line of text. Never merge two lines into one object.',
    '- Preserve Urdu script exactly as printed; never transliterate it.',
    '- Never merge separate columns: the price column stays separate from the description column.',
    '- Include headings, table cells, numbers and stamps. Skip blank space and pictures.',
    `- The page is about ${Math.round(page.widthPt)} x ${Math.round(page.heightPt)} points.`,
    '- Keep each box tight around its own line.',
    '- JSON only.',
  ].join('\n');

  const { content } = await callVisionChat(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    { temperature: 0, maxTokens: 4000, jsonMode: true }
  );

  return parseOcrBoxesJson(content);
}

/**
 * Generic JSON-mode completion used by the AI PDF Assistant.
 * Returns the raw model text (expected to be a JSON object).
 */
export async function groqJsonCompletion(
  systemPrompt: string,
  userPrompt: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const settings = getGroqSettings();
  if (!settings.apiKey.trim()) {
    throw new Error(
      'Please add your Groq API Key first (top bar → "Add Groq Key") to use the AI PDF Assistant.'
    );
  }

  return callGroqChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      model: settings.smartModel,
      fallbackModel: settings.fastModel,
      temperature: opts.temperature ?? 0.15,
      maxTokens: opts.maxTokens ?? 1800,
      jsonMode: true,
    }
  );
}
