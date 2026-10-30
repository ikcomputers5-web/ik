// IK Computers — Urdu Phonetic Keyboard, Roman-to-Urdu Transliterator,
// Smart Word Suggestion Engine (Dictionary + Bigrams + Custom Memory) & Shop Templates

export const PHONETIC_KEY_MAP: Record<string, string> = {
  a: 'ا',
  A: 'آ',
  b: 'ب',
  B: 'بھ',
  c: 'چ',
  C: 'ث',
  d: 'د',
  D: 'ڈ',
  e: 'ع',
  E: 'ؑ',
  f: 'ف',
  F: 'ۂ',
  g: 'گ',
  G: 'غ',
  h: 'ہ',
  H: 'ح',
  i: 'ی',
  I: 'ِ',
  j: 'ج',
  J: 'ض',
  k: 'ک',
  K: 'خ',
  l: 'ل',
  L: 'رحمۃ اللہ علیہ',
  m: 'م',
  M: 'مٰ',
  n: 'ن',
  N: 'ں',
  o: 'و',
  O: 'ۃ',
  p: 'پ',
  P: 'ُ',
  q: 'ق',
  Q: 'ط',
  r: 'ر',
  R: 'ڑ',
  s: 'س',
  S: 'ص',
  t: 'ت',
  T: 'ٹ',
  u: 'ء',
  U: 'ئ',
  v: 'ط',
  V: 'ظ',
  w: 'و',
  W: 'ﷺ',
  x: 'ش',
  X: 'ژ',
  y: 'ی',
  Y: 'ے',
  z: 'ز',
  Z: 'ذ',
  '.': '۔',
  ',': '،',
  '?': '؟',
  ';': '؛',
  "'": 'ٰ',
};

export interface KeyboardKeyInfo {
  en: string;
  ur: string;
  shiftEn?: string;
  shiftUr?: string;
}

export const KEYBOARD_ROWS: KeyboardKeyInfo[][] = [
  [
    { en: 'q', ur: 'ق', shiftEn: 'Q', shiftUr: 'ط' },
    { en: 'w', ur: 'و', shiftEn: 'W', shiftUr: 'ﷺ' },
    { en: 'e', ur: 'ع', shiftEn: 'E', shiftUr: 'ؑ' },
    { en: 'r', ur: 'ر', shiftEn: 'R', shiftUr: 'ڑ' },
    { en: 't', ur: 'ت', shiftEn: 'T', shiftUr: 'ٹ' },
    { en: 'y', ur: 'ی', shiftEn: 'Y', shiftUr: 'ے' },
    { en: 'u', ur: 'ء', shiftEn: 'U', shiftUr: 'ئ' },
    { en: 'i', ur: 'ی', shiftEn: 'I', shiftUr: 'ِ' },
    { en: 'o', ur: 'و', shiftEn: 'O', shiftUr: 'ۃ' },
    { en: 'p', ur: 'پ', shiftEn: 'P', shiftUr: 'ُ' },
  ],
  [
    { en: 'a', ur: 'ا', shiftEn: 'A', shiftUr: 'آ' },
    { en: 's', ur: 'س', shiftEn: 'S', shiftUr: 'ص' },
    { en: 'd', ur: 'د', shiftEn: 'D', shiftUr: 'ڈ' },
    { en: 'f', ur: 'ف', shiftEn: 'F', shiftUr: 'ۂ' },
    { en: 'g', ur: 'گ', shiftEn: 'G', shiftUr: 'غ' },
    { en: 'h', ur: 'ہ', shiftEn: 'H', shiftUr: 'ح' },
    { en: 'j', ur: 'ج', shiftEn: 'J', shiftUr: 'ض' },
    { en: 'k', ur: 'ک', shiftEn: 'K', shiftUr: 'خ' },
    { en: 'l', ur: 'ل', shiftEn: 'L', shiftUr: 'رح' },
  ],
  [
    { en: 'z', ur: 'ز', shiftEn: 'Z', shiftUr: 'ذ' },
    { en: 'x', ur: 'ش', shiftEn: 'X', shiftUr: 'ژ' },
    { en: 'c', ur: 'چ', shiftEn: 'C', shiftUr: 'ث' },
    { en: 'v', ur: 'ط', shiftEn: 'V', shiftUr: 'ظ' },
    { en: 'b', ur: 'ب', shiftEn: 'B', shiftUr: 'بھ' },
    { en: 'n', ur: 'ن', shiftEn: 'N', shiftUr: 'ں' },
    { en: 'm', ur: 'م', shiftEn: 'M', shiftUr: 'مٰ' },
    { en: ',', ur: '،', shiftEn: ';', shiftUr: '؛' },
    { en: '.', ur: '۔', shiftEn: '?', shiftUr: '؟' },
  ],
];

// High-frequency Urdu lexicon (Everyday + Composing Shop + Official + Legal + Cities)
export const URDU_WORDS: string[] = [
  // Official Application & Legal Words
  'بخدمت', 'جناب', 'پرنسپل', 'صاحب', 'صاحبہ', 'عنوان', 'مؤدبانہ', 'گزارش', 'نہایت', 'ادب',
  'التماس', 'درخواست', 'درخواست گزار', 'سائل', 'مظہر', 'حلفاً', 'بیان', 'بیانِ حلفی', 'اقرار', 'اقرار نامہ',
  'کرایہ', 'کرایہ نامہ', 'کرایہ دار', 'مالک', 'مالک مکان', 'دکان', 'مکان', 'پلاٹ', 'جائیداد', 'گاڑی',
  'موٹر سائیکل', 'شناختی', 'شناختی کارڈ', 'نمبر', 'ولد', 'ولدیت', 'دختر', 'زوجہ', 'قوم', 'سکونت',
  'ساکن', 'محلہ', 'گلی', 'تحصیل', 'ضلع', 'لاہور', 'پنجاب', 'پاکستان', 'اسلام آباد', 'کراچی',
  'فیصل آباد', 'راولپنڈی', 'ملتان', 'گوجرانوالہ', 'سیالکوٹ', 'قصور', 'شیخوپورہ', 'اوکاڑہ', 'ساہیوال',
  'تھانہ', 'ایس ایچ او', 'رپورٹ', 'گمشدگی', 'چوری', 'واپڈا', 'لیسکو', 'ایس ڈی او', 'میٹر', 'بجلی',
  'سوئی گیس', 'پانی', 'بل', 'تصحیح', 'تبدیلی', 'نیا', 'کنکشن', 'نادرا', 'دفتر', 'میونسپل',
  'کارپوریشن', 'یونین کونسل', 'چیئرمین', 'سیکرٹری', 'ڈپٹی کمشنر', 'اسسٹنٹ کمشنر', 'عدالت', 'جج',
  'گواہ', 'گواہان', 'گواہ شد', 'العبد', 'دستخط', 'انگوٹھا', 'نشان انگوٹھا', 'مورخہ', 'تاریخ', 'آج',
  'روز', 'دن', 'مہینہ', 'سال', 'ماہانہ', 'کرایہ داری', 'ایڈوانس', 'زرِ ضمانت', 'مبلغ', 'روپے',
  'ہزار', 'لاکھ', 'کروڑ', 'نقد', 'وصول', 'ادا', 'ادائیگی', 'بقایا', 'رسید', 'ذمہ دار',
  'قانونی', 'کارروائی', 'شرائط', 'معاہدہ', 'فریق', 'فریق اول', 'فریق دوم', 'متعلقہ', 'حکام', 'تصدیق',
  'تصدیق شدہ', 'اصلی', 'نقل', 'کاپی', 'فوٹو کاپی', 'منسلک', 'کاغذات', 'دستاویزات', 'سرٹیفکیٹ', 'ڈگری',
  // Politeness & Closing Phrases
  'جنابِ عالی', 'عالی جاہ', 'مہربانی', 'فرما', 'عنایت', 'عین', 'نوازش', 'ہوگی', 'شکریہ', 'مشکور',
  'ممنون', 'دعاگو', 'تابعدار', 'فرمانبردار', 'شاگرد', 'طالب علم', 'طالبہ', 'جماعت', 'کلاس', 'رول نمبر',
  'اسکول', 'کالج', 'یونیورسٹی', 'فیس', 'معافی', 'رخصت', 'چھٹی', 'بیمار', 'بخار', 'ضروری',
  'کام', 'وجہ', 'حاضر', 'قاصر', 'لحاظہ', 'لہٰذا', 'برائے', 'کرم', 'منظور', 'فرمائیں',
  'جاری', 'کیا', 'جائے', 'دیا', 'جائے', 'کی', 'کا', 'کے', 'کو', 'سے', 'میں', 'پر', 'تک', 'اور',
  'یا', 'کہ', 'ہے', 'ہیں', 'تھا', 'تھی', 'تھے', 'گا', 'گی', 'گے', 'ہو', 'ہوں', 'ہونے', 'کر',
  'کرنا', 'کرتا', 'کرتی', 'کرتے', 'کیا', 'کرنے', 'والے', 'والا', 'والی', 'اپنا', 'اپنی', 'اپنے',
  'میرا', 'میری', 'میرے', 'ہمارا', 'ہماری', 'ہمارے', 'آپ', 'تم', 'وہ', 'یہ', 'اس', 'ان', 'جس',
  'جن', 'کون', 'کیا', 'کیوں', 'کیسے', 'کہاں', 'کب', 'کتنا', 'بہت', 'زیادہ', 'کم', 'سب', 'تمام',
  'کچھ', 'کوئی', 'ہر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس',
  // Common Names & Religious Openings
  'بسم اللہ الرحمن الرحیم', 'السلام علیکم', 'ورحمۃ اللہ وبرکاتہ', 'الحمد للہ', 'ان شاء اللہ', 'ماشاء اللہ',
  'محمد', 'احمد', 'علی', 'حسن', 'حسین', 'عمر', 'عثمان', 'ابوبکر', 'عمران', 'کامران',
  'بلال', 'طارق', 'زاہد', 'شاہد', 'ساجد', 'ماجد', 'راشد', 'وسیم', 'ندیم', 'سلیم',
  'نعیم', 'عظیم', 'فہیم', 'ذیشان', 'رضوان', 'عدنان', 'فرحان', 'عرفان', 'ارسلان', 'فیضان',
  'خان', 'ملک', 'چوہدری', 'شیخ', 'سید', 'قریشی', 'انصاری', 'بٹ', 'رانا', 'مغل', 'اعوان', 'راجپوت',
  'فاطمہ', 'عائشہ', 'زینب', 'مریم', 'خدیجہ', 'آمنہ', 'صبا', 'ندا', 'اقرا', 'ثنا', 'حنا',
  // Everyday Urdu Verbs / Nouns / Adjectives
  'زندگی', 'دنیا', 'وقت', 'ملک', 'شہر', 'گاؤں', 'گھر', 'دفتر', 'کاروبار', 'تجارت',
  'کمپیوٹر', 'پرنٹ', 'کمپوزنگ', 'اردو', 'انگریزی', 'فائل', 'صفحہ', 'ورق', 'کتاب', 'کاغذ',
  'پاسپورٹ', 'ویزا', 'تصویر', 'فوٹو', 'موبائل', 'فون', 'رابطہ', 'پتہ', 'ایڈریس', 'ای میل',
  'بینک', 'اکاؤنٹ', 'چیک', 'رقم', 'قرض', 'واپسی', 'مدت', 'معیاد', 'شروع', 'ختم',
  'فروخت', 'خرید', 'خریدار', 'بیچنے', 'قیمت', 'طے', 'پائی', 'گواہی', 'حلف', 'سچ',
  'جھوٹ', 'بالکل', 'درست', 'صحیح', 'غلط', 'مکمل', 'ادھورا', 'واضح', 'موجود', 'غیر موجود',
  'صحت', 'تندرستی', 'خاندان', 'والد', 'والدہ', 'بھائی', 'بہن', 'بیٹا', 'بیٹی', 'بچے',
  'شادی', 'نکاح', 'دعوت', 'ولیمہ', 'بارات', 'خوشی', 'موقع', 'شرکت', 'تشریف', 'لائیں',
  'اعلان', 'اطلاع', 'عوام', 'اہلِ علاقہ', 'مسجد', 'نماز', 'جمعہ', 'جنازہ', 'مغرب', 'عشاء',
];

// Roman Urdu -> Pure Urdu Dictionary for instant transliteration suggestions
export const ROMAN_TO_URDU: Record<string, string[]> = {
  bismillah: ['بسم اللہ الرحمن الرحیم'],
  salam: ['السلام علیکم', 'سلام'],
  assalam: ['السلام علیکم ورحمۃ اللہ وبرکاتہ'],
  bakhidmat: ['بخدمت', 'بخدمت جناب'],
  janab: ['جناب', 'جنابِ عالی'],
  principal: ['پرنسپل', 'پرنسپل صاحب'],
  sahib: ['صاحب', 'صاحبہ'],
  unwan: ['عنوان'],
  darkhwast: ['درخواست', 'درخواست گزار'],
  guzarish: ['گزارش', 'گزارش ہے کہ', 'مؤدبانہ گزارش ہے کہ'],
  modbana: ['مؤدبانہ', 'مؤدبانہ گزارش ہے'],
  nihayat: ['نہایت', 'نہایت ادب سے'],
  adab: ['ادب', 'ادب سے گزارش ہے'],
  hai: ['ہے', 'ہیں'],
  hain: ['ہیں'],
  ke: ['کہ', 'کے'],
  ka: ['کا'],
  ki: ['کی'],
  ko: ['کو'],
  se: ['سے'],
  mein: ['میں'],
  main: ['میں'],
  aur: ['اور'],
  ap: ['آپ', 'آپ کی'],
  aap: ['آپ', 'آپ کی عین نوازش ہوگی'],
  mera: ['میرا'],
  meri: ['میری'],
  mere: ['میرے'],
  apna: ['اپنا'],
  apni: ['اپنی'],
  lahore: ['لاہور'],
  punjab: ['پنجاب'],
  pakistan: ['پاکستان'],
  karachi: ['کراچی'],
  islamabad: ['اسلام آباد'],
  faisalabad: ['فیصل آباد'],
  rawalpindi: ['راولپنڈی'],
  multan: ['ملتان'],
  gujranwala: ['گوجرانوالہ'],
  shanakhti: ['شناختی', 'شناختی کارڈ', 'شناختی کارڈ نمبر'],
  cnic: ['شناختی کارڈ نمبر', 'قومی شناختی کارڈ'],
  card: ['کارڈ', 'شناختی کارڈ'],
  number: ['نمبر'],
  waldiyat: ['ولدیت'],
  wald: ['ولد'],
  sakunat: ['سکونت'],
  sakin: ['ساکن'],
  tehsil: ['تحصیل'],
  zila: ['ضلع'],
  mohalla: ['محلہ'],
  gali: ['گلی'],
  ghar: ['گھر'],
  dukan: ['دکان'],
  makan: ['مکان'],
  kiraya: ['کرایہ', 'کرایہ نامہ', 'کرایہ دار'],
  iqrarnama: ['اقرار نامہ'],
  iqrar: ['اقرار', 'اقرار نامہ'],
  bayan: ['بیان', 'بیانِ حلفی'],
  halfi: ['حلفی', 'بیانِ حلفی', 'حلفاً بیان کرتا ہوں'],
  dastakhat: ['دستخط'],
  angootha: ['نشان انگوٹھا', 'انگوٹھا'],
  morakha: ['مورخہ'],
  tareekh: ['تاریخ'],
  aaj: ['آج'],
  kal: ['کل'],
  chutti: ['چھٹی', 'رخصت'],
  rukhsat: ['رخصت', 'درخواست برائے رخصت'],
  bimari: ['بیماری'],
  bukhar: ['بخار'],
  zaroori: ['ضروری', 'ضروری کام'],
  kaam: ['کام'],
  hazir: ['حاضر'],
  school: ['اسکول'],
  college: ['کالج'],
  fee: ['فیس', 'فیس معافی'],
  maafi: ['معافی'],
  mehrbani: ['مہربانی', 'مہربانی فرما کر'],
  nawazish: ['نوازش', 'عین نوازش ہوگی'],
  shukriya: ['شکریہ'],
  thana: ['تھانہ'],
  sho: ['ایس ایچ او', 'جناب ایس ایچ او صاحب'],
  gumshudgi: ['گمشدگی', 'گمشدگی رپورٹ'],
  wapda: ['واپڈا'],
  lesco: ['لیسکو'],
  sdo: ['ایس ڈی او', 'جناب ایس ڈی او صاحب'],
  bijli: ['بجلی'],
  meter: ['میٹر'],
  bill: ['بل'],
  nadra: ['نادرا'],
  gawah: ['گواہ', 'گواہ شد'],
  malik: ['مالک', 'مالک مکان'],
  rupay: ['روپے', 'مبلغ'],
  hazar: ['ہزار'],
  lakh: ['لاکھ'],
  muhammad: ['محمد'],
  ahmed: ['احمد'],
  ali: ['علی'],
  hassan: ['حسن'],
  hussain: ['حسین'],
  imran: ['عمران'],
  kamran: ['کامران'],
  usman: ['عثمان'],
  umar: ['عمر'],
  bilal: ['بلال'],
  khan: ['خان'],
  choudhary: ['چوہدری'],
  sheikh: ['شیخ'],
  syed: ['سید'],
  rana: ['رانا'],
  butt: ['بٹ'],
  computer: ['کمپیوٹر', 'آئی کے کمپیوٹرز'],
  urdu: ['اردو'],
  tasveer: ['تصویر'],
  passport: ['پاسپورٹ'],
};

// Bigram / Next-Word & Phrase Predictor for Urdu Composing Speed
export const NEXT_WORD_BIGRAMS: Record<string, string[]> = {
  'بخدمت': ['جناب', 'جناب پرنسپل صاحب', 'جناب ایس ایچ او صاحب', 'جناب ایس ڈی او صاحب', 'جناب منیجر صاحب'],
  'جناب': ['پرنسپل صاحب', 'ایس ایچ او صاحب', 'عالی!', 'ایس ڈی او صاحب', 'چیئرمین صاحب'],
  'مؤدبانہ': ['گزارش ہے کہ', 'التماس ہے کہ', 'عرض ہے کہ'],
  'نہایت': ['ادب سے گزارش ہے کہ', 'احترام سے عرض ہے', 'ضروری کام'],
  'ادب': ['سے گزارش ہے کہ', 'سے التماس ہے'],
  'گزارش': ['ہے کہ', 'یہ ہے کہ', 'خدمت میں عرض ہے'],
  'عنوان': ['درخواست برائے', 'درخواست برائے رخصت', 'درخواست برائے گمشدگی شناختی کارڈ', 'درخواست برائے تبدیلی میٹر'],
  'درخواست': ['برائے', 'گزار', 'منظور فرمائیں', 'برائے ضروری کام'],
  'شناختی': ['کارڈ', 'کارڈ نمبر', 'کارڈ کی کاپی'],
  'کارڈ': ['نمبر', 'گم ہو گیا ہے', 'منسلک ہے'],
  'بیان': ['کرتا ہوں کہ', 'کرتی ہوں کہ', 'حلفی'],
  'حلفاً': ['بیان کرتا ہوں کہ', 'بیان کرتی ہوں کہ', 'اقرار کرتا ہوں'],
  'من': ['مظہر', 'مظہر حلفاً بیان کرتا ہوں'],
  'عین': ['نوازش ہوگی۔', 'مہربانی ہوگی۔'],
  'آپ': ['کی عین نوازش ہوگی۔', 'کا بے حد شکریہ۔', 'کی مہربانی ہوگی۔'],
  'مہربانی': ['فرما کر', 'ہوگی'],
  'فرما': ['کر', 'دیں'],
  'تحصیل': ['و ضلع لاہور', 'و ضلع', 'شہر'],
  'ضلع': ['لاہور', 'شیخوپورہ', 'قصور', 'فیصل آباد', 'گوجرانوالہ'],
  'فریق': ['اول', 'دوم', 'اول و دوم'],
  'مالک': ['مکان', 'دکان', 'جائیداد'],
  'کرایہ': ['دار', 'نامہ', 'ماہانہ'],
  'دستخط': ['درخواست گزار', 'گواہ اول', 'گواہ دوم', 'مظہر'],
  'السلام': ['علیکم', 'علیکم ورحمۃ اللہ وبرکاتہ'],
  'بسم': ['اللہ الرحمن الرحیم'],
  'العارض': ['آپ کا تابعدار', 'درخواست گزار'],
};

const CUSTOM_WORDS_STORAGE_KEY = 'ik_custom_urdu_words_v1';

export function getCustomLearnedWords(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_WORDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function learnUrduWordsFromText(text: string): void {
  try {
    const matches = text.match(/[\u0600-\u06FF]{3,}/g);
    if (!matches || matches.length === 0) return;
    const existing = new Set(getCustomLearnedWords());
    const baseSet = new Set(URDU_WORDS);
    let changed = false;
    for (const word of matches) {
      if (!baseSet.has(word) && !existing.has(word)) {
        existing.add(word);
        changed = true;
      }
    }
    if (changed) {
      const arr = Array.from(existing).slice(-400);
      localStorage.setItem(CUSTOM_WORDS_STORAGE_KEY, JSON.stringify(arr));
    }
  } catch {
    // ignore storage errors
  }
}

// Algorithmic fallback Roman -> Urdu phonetic converter for arbitrary words/names
export function phoneticRomanToUrdu(roman: string): string {
  const s = roman.toLowerCase().trim();
  if (!s) return '';

  const digraphs: [string, string][] = [
    ['sh', 'ش'],
    ['ch', 'چ'],
    ['kh', 'خ'],
    ['gh', 'غ'],
    ['ph', 'پھ'],
    ['bh', 'بھ'],
    ['th', 'تھ'],
    ['dh', 'دھ'],
    ['zh', 'ژ'],
    ['aa', 'آ'],
    ['ee', 'ی'],
    ['oo', 'و'],
    ['ai', 'ے'],
    ['ay', 'ے'],
    ['au', 'و'],
  ];

  let out = '';
  let i = 0;
  while (i < s.length) {
    if (i === 0 && s.startsWith('aa')) {
      out += 'آ';
      i += 2;
      continue;
    }
    if (i === 0 && (s[0] === 'a' || s[0] === 'i' || s[0] === 'u')) {
      out += 'ا';
      i += 1;
      continue;
    }

    let matchedDigraph = false;
    for (const [dg, ur] of digraphs) {
      if (s.startsWith(dg, i)) {
        out += ur;
        i += dg.length;
        matchedDigraph = true;
        break;
      }
    }
    if (matchedDigraph) continue;

    const ch = s[i];
    const singleMap: Record<string, string> = {
      a: 'ا',
      b: 'ب',
      c: 'ک',
      d: 'د',
      e: 'ی',
      f: 'ف',
      g: 'گ',
      h: 'ہ',
      i: 'ی',
      j: 'ج',
      k: 'ک',
      l: 'ل',
      m: 'م',
      n: 'ن',
      o: 'و',
      p: 'پ',
      q: 'ق',
      r: 'ر',
      s: 'س',
      t: 'ت',
      u: 'و',
      v: 'و',
      w: 'و',
      x: 'کس',
      y: 'ی',
      z: 'ز',
    };
    out += singleMap[ch] || '';
    i++;
  }
  return out;
}

export function getUrduSuggestions(currentToken: string, previousWord: string, limit = 8): string[] {
  const token = currentToken.trim();
  const prev = previousWord.trim().replace(/[۔،؟!:\s]+$/g, '');
  const results: string[] = [];
  const seen = new Set<string>();

  const add = (w: string) => {
    if (w && !seen.has(w)) {
      seen.add(w);
      results.push(w);
    }
  };

  // Case 1: User just finished a word (token is empty) -> Predict next word/phrase!
  if (!token) {
    if (prev && NEXT_WORD_BIGRAMS[prev]) {
      for (const next of NEXT_WORD_BIGRAMS[prev]) {
        add(next);
      }
    }
    // Common starter / connector chips when idle
    const starters = [
      'بخدمت جناب',
      'مؤدبانہ گزارش ہے کہ',
      'نہایت ادب سے',
      'شناختی کارڈ نمبر',
      'عین نوازش ہوگی۔',
      'درخواست گزار',
      'مورخہ',
      'تحصیل و ضلع لاہور',
    ];
    for (const st of starters) add(st);
    return results.slice(0, limit);
  }

  // Case 2: Token is Latin / Roman Urdu characters -> Suggest Roman-to-Urdu matches!
  if (/^[a-zA-Z']+$/.test(token)) {
    const lower = token.toLowerCase();
    // Exact Roman key match first
    if (ROMAN_TO_URDU[lower]) {
      for (const u of ROMAN_TO_URDU[lower]) add(u);
    }
    // Prefix Roman key matches
    for (const [rk, vals] of Object.entries(ROMAN_TO_URDU)) {
      if (rk.startsWith(lower)) {
        for (const v of vals) add(v);
      }
      if (results.length >= limit) break;
    }
    // Algorithmic phonetic fallback
    const approx = phoneticRomanToUrdu(lower);
    if (approx) add(approx);
    return results.slice(0, limit);
  }

  // Case 3: Token is Urdu script -> Match custom words + dictionary prefix + substring
  const customWords = getCustomLearnedWords();

  // Check if previousWord + token matches a bigram continuation
  if (prev && NEXT_WORD_BIGRAMS[prev]) {
    for (const cand of NEXT_WORD_BIGRAMS[prev]) {
      if (cand.startsWith(token) && cand !== token) add(cand);
    }
  }

  for (const w of customWords) {
    if (w.startsWith(token) && w !== token) add(w);
  }
  for (const w of URDU_WORDS) {
    if (w.startsWith(token) && w !== token) add(w);
    if (results.length >= limit) break;
  }
  if (results.length < limit) {
    for (const w of URDU_WORDS) {
      if (w.includes(token) && w !== token) add(w);
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

export interface ShopTemplate {
  id: string;
  titleUr: string;
  titleEn: string;
  category: 'application' | 'stamp' | 'agreement' | 'notice' | 'english';
  paperSize: 'a4' | 'legal' | 'stamp';
  stampTopInches?: number;
  dir: 'rtl' | 'ltr';
  html: string;
}

export const SHOP_TEMPLATES: ShopTemplate[] = [
  {
    id: 'school-leave',
    titleUr: 'درخواست برائے رخصت / فیس معافی',
    titleEn: 'School / College Application',
    category: 'application',
    paperSize: 'a4',
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <p style="text-align: center; font-size: 20px; font-weight: bold;">بسم اللہ الرحمن الرحیم</p>
        <p><strong>بخدمت جناب پرنسپل صاحب،</strong></p>
        <p>گورنمنٹ ہائی اسکول / کالج، لاہور۔</p>
        <p><strong>عنوان: <u>درخواست برائے رخصت ضروری کام</u></strong></p>
        <p>جنابِ عالی!</p>
        <p style="text-indent: 36px;">مؤدبانہ گزارش ہے کہ فدوی آپ کے ادارے میں جماعت دہم کا طالب علم ہے۔ آج گھر پر ایک نہایت ضروری کام آن پڑا ہے جس کی وجہ سے فدوی آج اسکول حاضر ہونے سے قاصر ہے۔</p>
        <p style="text-indent: 36px;">لہٰذا برائے مہربانی فدوی کو یومِ واحد (ایک دن) کی رخصت عنایت فرمائی جائے۔ آپ کی عین نوازش ہوگی۔</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 24px;">
          <div><strong>مورخہ:</strong> ۳۰ اکتوبر ۲۰۲۶ء</div>
          <div style="text-align: left;">
            <p><strong>العارض</strong></p>
            <p>آپ کا تابعدار شاگرد</p>
            <p>نام: ___________________</p>
            <p>رول نمبر: _______________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'police-cnic-loss',
    titleUr: 'درخواست گمشدگی شناختی کارڈ (تھانہ)',
    titleEn: 'Police Lost CNIC Report',
    category: 'application',
    paperSize: 'a4',
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <p><strong>بخدمت جناب ایس ایچ او (SHO) صاحب،</strong></p>
        <p>تھانہ _______________، ضلع لاہور۔</p>
        <p><strong>عنوان: <u>درخواست برائے اندراج رپورٹ گمشدگی اصل قومی شناختی کارڈ</u></strong></p>
        <p>جنابِ عالی!</p>
        <p style="text-indent: 36px;">نہایت ادب سے گزارش ہے کہ سائل محمد _______________ ولد _______________ ساکن محلہ _______________ تحصیل و ضلع لاہور کا مستقل رہائشی ہے۔ سائل کا اصل قومی شناختی کارڈ نمبر <strong>35202-0000000-0</strong> آج مورخہ _______________ کو بازار جاتے ہوئے راستے میں کہیں گر کر گم ہو گیا ہے، جو کافی تلاش بسیار کے باوجود تاحال نہیں مل سکا۔</p>
        <p style="text-indent: 36px;">لہٰذا حضور والا سے التماس ہے کہ سائل کے شناختی کارڈ کی گمشدگی کی باقاعدہ رپورٹ درج کر کے نقل رپٹ جاری فرمائی جائے تاکہ سائل دفتر نادرا سے نیا شناختی کارڈ بنوا سکے۔ عین نوازش ہوگی۔</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 24px;">
          <div>
            <p><strong>مورخہ:</strong> _______________</p>
            <p><strong>رابطہ نمبر:</strong> _______________</p>
          </div>
          <div style="text-align: left;">
            <p><strong>العبد / درخواست گزار</strong></p>
            <p>نام: ___________________</p>
            <p>دستخط: _________________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'lesco-meter',
    titleUr: 'درخواست تبدیلی میٹر (واپڈا / لیسکو)',
    titleEn: 'WAPDA / LESCO Meter Application',
    category: 'application',
    paperSize: 'a4',
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <p><strong>بخدمت جناب ایس ڈی او (SDO) صاحب،</strong></p>
        <p>لیسکو / واپڈا سب ڈویژن _______________، لاہور۔</p>
        <p><strong>عنوان: <u>درخواست برائے تبدیلی خراب میٹر بجلی</u></strong></p>
        <p>جنابِ عالی!</p>
        <p style="text-indent: 36px;">مؤدبانہ گزارش ہے کہ سائل کے گھر واقع _______________ میں بجلی کا میٹر جس کا ریفرنس نمبر <strong>____________________</strong> ہے، پچھلے چند روز سے اچانک خراب / بند ہو گیا ہے جس کی وجہ سے بجلی کی فراہمی اور درست بلنگ متاثر ہو رہی ہے۔ سائل تمام پچھلے بل باقاعدگی سے ادا کرتا چلا آ رہا ہے اور بل کی فوٹو کاپی درخواست ہٰذا کے ساتھ منسلک ہے۔</p>
        <p style="text-indent: 36px;">لہٰذا برائے کرم موقع کا معائنہ کروا کے خراب میٹر کی جگہ نیا میٹر نصب کروایا جائے۔ آپ کی عین نوازش ہوگی۔</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 24px;">
          <div><strong>مورخہ:</strong> _______________</div>
          <div style="text-align: left;">
            <p><strong>درخواست گزار</strong></p>
            <p>نام و دستخط: _______________</p>
            <p>موبائل نمبر: ________________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'stamp-affidavit',
    titleUr: 'بیانِ حلفی (اسٹامپ پیپر کے لیے)',
    titleEn: 'Stamp Paper Affidavit (بیانِ حلفی)',
    category: 'stamp',
    paperSize: 'stamp',
    stampTopInches: 3.2,
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <h2 style="text-align: center; text-decoration: underline; font-size: 24px; font-weight: bold;">بیانِ حلفی</h2>
        <p>منکہ <strong>محمد _______________</strong> ولد <strong>_______________</strong> قوم _______________ شناختی کارڈ نمبر <strong>35202-0000000-0</strong> ساکن _______________ تحصیل و ضلع لاہور بقائمی ہوش و حواس خمسہ بلا جبر و اکراہ حلفاً بیان کرتا ہوں کہ:</p>
        <ol style="padding-right: 28px;">
          <li>یہ کہ من مظہر مندرجہ بالا پتے کا مستقل سکونتی اور پاکستانی شہری ہے۔</li>
          <li>یہ کہ من مظہر کی طرف سے پیش کردہ تمام کوائف و کاغذات بالکل درست اور اصلی ہیں۔</li>
          <li>یہ کہ اگر من مظہر کا کوئی بیان یا دستاویز غلط ثابت ہو تو من مظہر خود ہر قسم کی قانونی کارروائی کا ذمہ دار ہوگا۔</li>
        </ol>
        <p>مراتب بالا میرے علم و یقین کے مطابق بالکل درست اور سچ ہیں اور کوئی امر مخفی نہیں رکھا گیا۔</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 30px;">
          <div>
            <p><strong>گواہ شد نمبر ۱:</strong> _______________</p>
            <p>شناختی کارڈ: __________________</p>
          </div>
          <div style="text-align: left;">
            <p><strong>المظہر / بیان دہندہ</strong></p>
            <p>دستخط و نشان انگوٹھا: _______________</p>
            <p>مورخہ: _________________________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'rent-agreement',
    titleUr: 'کرایہ نامہ مکان / دکان',
    titleEn: 'Rent Agreement (کرایہ نامہ)',
    category: 'agreement',
    paperSize: 'stamp',
    stampTopInches: 3.0,
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <h2 style="text-align: center; text-decoration: underline; font-size: 24px; font-weight: bold;">معاہدہ کرایہ نامہ دکان / مکان</h2>
        <p><strong>فریقِ اول (مالک):</strong> محمد _______________ ولد _______________ شناختی کارڈ نمبر _______________ ساکن لاہور۔</p>
        <p><strong>فریقِ دوم (کرایہ دار):</strong> محمد _______________ ولد _______________ شناختی کارڈ نمبر _______________ ساکن لاہور۔</p>
        <p>فریقین کے مابین مندرجہ ذیل شرائط پر معاہدہ کرایہ داری طے پایا ہے:</p>
        <ol style="padding-right: 28px;">
          <li>یہ کہ ماہانہ کرایہ مبلغ <strong>__________ روپے</strong> طے پایا ہے جو فریق دوم ہر ماہ کی ۵ تاریخ تک ادا کرنے کا پابند ہوگا۔</li>
          <li>یہ کہ مبلغ <strong>__________ روپے</strong> بطور ایڈوانس / زرِ ضمانت مالک مکان نے وصول کر لیے ہیں جو مکان خالی کرتے وقت قابلِ واپسی ہوں گے۔</li>
          <li>یہ کہ معیاد کرایہ نامہ ۱۱ ماہ مقرر کی گئی ہے۔ بجلی، گیس اور پانی کے بل فریق دوم ادا کرے گا۔</li>
          <li>یہ کہ فریق دوم جائیداد کو کسی غیر قانونی مقصد یا ذیلی کرایہ داری کے لیے استعمال نہیں کرے گا۔</li>
        </ol>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 24px;">
          <div>
            <p><strong>دستخط مالک (فریق اول):</strong> ______________</p>
            <p><strong>گواہ نمبر ۱:</strong> ______________________</p>
          </div>
          <div>
            <p><strong>دستخط کرایہ دار (فریق دوم):</strong> ______________</p>
            <p><strong>گواہ نمبر ۲:</strong> ______________________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'vehicle-sale',
    titleUr: 'اقرار نامہ بیع موٹر سائیکل / گاڑی',
    titleEn: 'Vehicle Sale Iqrarnama',
    category: 'agreement',
    paperSize: 'stamp',
    stampTopInches: 3.0,
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: right;">
        <h2 style="text-align: center; text-decoration: underline; font-size: 24px; font-weight: bold;">اقرار نامہ فروخت موٹر سائیکل / گاڑی</h2>
        <p><strong>فروخت کنندہ (فریق اول):</strong> _______________ ولد _______________ شناختی کارڈ _______________ ساکن لاہور۔</p>
        <p><strong>خریدار (فریق دوم):</strong> _______________ ولد _______________ شناختی کارڈ _______________ ساکن لاہور۔</p>
        <p>منکہ فریق اول اپنی ملکیتی موٹر سائیکل / گاڑی رجسٹریشن نمبر <strong>__________</strong> ماڈل <strong>______</strong> انجن نمبر <strong>______________</strong> چیسز نمبر <strong>______________</strong> بعوض مبلغ <strong>__________ روپے</strong> بدست فریق دوم فروخت کر کے کل رقم نقد روبرو گواہان وصول پا لی ہے اور اصل کاغذات و قبضہ گاڑی آج مورخہ __________ بوقت __________ بجے حوالے خریدار کر دیا ہے۔ آج سے پہلے کے ہر قسم کے چالان یا مقدمے کا فریق اول، اور آج کے بعد فریق دوم ذمہ دار ہوگا۔</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 26px;">
          <div>
            <p><strong>دستخط فروخت کنندہ:</strong> ______________</p>
            <p><strong>گواہ نمبر ۱:</strong> ___________________</p>
          </div>
          <div>
            <p><strong>دستخط خریدار:</strong> _________________</p>
            <p><strong>گواہ نمبر ۲:</strong> ___________________</p>
          </div>
        </div>
      </div>
    `,
  },
  {
    id: 'public-notice',
    titleUr: 'ضروری اعلان / اشتہار',
    titleEn: 'Public Notice / Poster',
    category: 'notice',
    paperSize: 'a4',
    dir: 'rtl',
    html: `
      <div dir="rtl" style="text-align: center; padding: 16px;">
        <h1 style="font-size: 34px; font-weight: bold; margin-bottom: 10px;">ضروری اطلاع / اعلانِ عام</h1>
        <hr style="border-top: 2px solid #000; margin-bottom: 18px;" />
        <p style="font-size: 22px;">تمام اہلِ علاقہ اور معزز صارفین کو مطلع کیا جاتا ہے کہ</p>
        <p style="font-size: 24px; font-weight: bold; margin: 16px 0;">آئی کے کمپیوٹرز (IK Computers)</p>
        <p style="font-size: 20px;">میں اردو و انگلش کمپوزنگ، کلر و بلیک اینڈ وائٹ پرنٹنگ، پی ڈی ایف ایڈیٹنگ، آن لائن فارم، شناختی کارڈ کاپی اور پاسپورٹ سائز تصاویر کی سہولت دستیاب ہے۔</p>
        <br/>
        <p style="font-size: 18px;"><strong>رابطہ و پتہ:</strong> آئی کے کمپیوٹرز، لاہور</p>
      </div>
    `,
  },
  {
    id: 'english-official',
    titleUr: 'انگلش سرکاری درخواست',
    titleEn: 'English Official Application',
    category: 'english',
    paperSize: 'a4',
    dir: 'ltr',
    html: `
      <div dir="ltr" style="text-align: left; font-family: 'Times New Roman', serif; line-height: 1.75; font-size: 16px;">
        <p><strong>To,</strong><br/>The Manager / Principal,<br/>_______________________,<br/>Lahore.</p>
        <p><strong>Subject: <u>APPLICATION FOR ISSUANCE OF CERTIFICATE / OFFICIAL REQUEST</u></strong></p>
        <p>Respected Sir / Madam,</p>
        <p style="text-indent: 36px;">Most respectfully, it is stated that I, <strong>____________________</strong> S/O <strong>____________________</strong>, holder of CNIC No. <strong>35202-0000000-0</strong>, am submitting this request for your kind consideration.</p>
        <p style="text-indent: 36px;">Kindly process my request at your earliest convenience. All required supporting documents are attached herewith for verification. I shall remain deeply grateful for your cooperation.</p>
        <br/>
        <div style="display: flex; justify-content: space-between; margin-top: 28px;">
          <div><strong>Date:</strong> October 30, 2026</div>
          <div>
            <strong>Yours obediently,</strong><br/><br/>
            Name: ___________________<br/>
            Contact: _________________
          </div>
        </div>
      </div>
    `,
  },
];
