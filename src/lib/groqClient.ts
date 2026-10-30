// IK Computers — Groq LPU AI Client (Browser-Direct CORS to api.groq.com)

export interface GroqSettings {
  apiKey: string;
  fastModel: string;
  smartModel: string;
  visionModel: string;
  enableLiveSuggestions: boolean;
}

const STORAGE_KEY = 'ik_groq_settings_v1';

const DEFAULT_SETTINGS: GroqSettings = {
  apiKey: '',
  fastModel: 'llama-3.1-8b-instant',
  smartModel: 'llama-3.3-70b-versatile',
  visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  enableLiveSuggestions: true,
};

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
  const next = { ...getGroqSettings(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('ik-groq-updated', { detail: next }));
  return next;
}

export function hasGroqKey(): boolean {
  const { apiKey } = getGroqSettings();
  return Boolean(apiKey && apiKey.trim().length > 10);
}

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
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return {
        ok: false,
        models: [],
        error: errBody?.error?.message || `HTTP ${res.status}: Invalid Groq API Key`,
      };
    }
    const data = await res.json();
    const models: string[] = (data?.data || []).map((m: { id: string }) => m.id).sort();
    return { ok: true, models };
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err?.message || 'Network error reaching api.groq.com',
    };
  }
}

async function callGroqChat(
  messages: any[],
  options: { model?: string; temperature?: number; maxTokens?: number; fallbackModel?: string } = {}
): Promise<string> {
  const settings = getGroqSettings();
  const key = settings.apiKey.trim();
  if (!key) {
    throw new Error('Groq API Key not configured. Click "Groq AI Key" in the top bar to add your key.');
  }

  const primaryModel = options.model || settings.smartModel;
  const tryModels = [primaryModel];
  if (options.fallbackModel && options.fallbackModel !== primaryModel) {
    tryModels.push(options.fallbackModel);
  }
  if (!tryModels.includes('llama-3.1-8b-instant')) {
    tryModels.push('llama-3.1-8b-instant');
  }

  let lastError = 'Groq request failed';

  for (const model of tryModels) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 1500,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || '';
    }

    const errJson = await res.json().catch(() => ({}));
    lastError = errJson?.error?.message || `Groq HTTP ${res.status}`;
    // If invalid key or rate limit, don't retry other models needlessly on 401
    if (res.status === 401) break;
  }

  throw new Error(lastError);
}

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

// Vision OCR: Extract Urdu & English text from photographed/scanned documents
export async function extractDocumentOcrWithGroq(imageDataUrl: string): Promise<string> {
  const settings = getGroqSettings();
  const key = settings.apiKey.trim();
  if (!key) {
    throw new Error('Please configure your Groq API Key first to use AI Urdu/English OCR.');
  }

  const visionCandidates = [
    settings.visionModel,
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
  ];
  const uniqueModels = Array.from(new Set(visionCandidates.filter(Boolean)));

  let lastErr = 'Vision OCR failed';
  for (const model of uniqueModels) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2500,
        messages: [
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
        ],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || '';
    }
    const errJson = await res.json().catch(() => ({}));
    lastErr = errJson?.error?.message || `Groq Vision HTTP ${res.status}`;
    if (res.status === 401) break;
  }

  throw new Error(lastErr);
}
