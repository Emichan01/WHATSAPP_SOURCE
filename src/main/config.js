const path = require('path');
const { app } = require('electron');

const DATA_DIR = app
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, '..', '..', 'data');

const PATHS = {
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'app.db'),
  SESSIONS_DIR: path.join(DATA_DIR, 'sessions'),
  VIDEOS_DIR: path.join(DATA_DIR, 'videos'),
};

const RATE_LIMITS = {
  MIN_DELAY_MS: 30 * 1000,
  MAX_DELAY_MS: 90 * 1000,
  VIDEO_DELAY_MIN_MS: 5 * 1000,
  VIDEO_DELAY_MAX_MS: 10 * 1000,
  DAILY_MAX: 250,
  DAILY_DEFAULT: 200,
  HOURLY_MAX: 40,
  HOURLY_DEFAULT: 30,
  WARMUP_DAY_LIMIT: 20,
  WORK_HOUR_START: 9,
  WORK_HOUR_END: 21,
};

const APP_LIMITS = {
  MAX_VIDEO_BYTES: 16 * 1024 * 1024,
  EXCEL_CHUNK_SIZE: 500,
  MAX_TEMPLATES: 10,
};

// "evet" benzeri kelimeler — body normalize edildikten sonra (lowercase, noktalama temizlendi)
// her birini boşluklarla çevrili alt-string olarak ararız. \b kullanmıyoruz çünkü
// "evettt", "evet!!", "Evet :)" gibi varyasyonları kaçırmasın.
const RESPONSE_YES_KEYWORDS = [
  'evet', 'evett', 'evetttt', 'evt', 'eet', 'ee',
  'tamam', 'tmm', 'tmam', 'okey', 'okay', 'ok',
  'olur', 'olurr', 'olur tabii',
  'isterim', 'istiyorum',
  'olabilir', 'olabilirr',
  'tabi', 'tabii', 'tabikide', 'tabi ki', 'elbette',
  'kesinlikle',
  'ilgileniyorum', 'ilgilenirim', 'ilgi̇leni̇yorum',
  'bilgi', 'bilgi ver', 'bilgi alayım', 'bilgi alabilirim', 'bilgi alabilir miyim',
  'evet lütfen', 'evet isterim',
];

const RESPONSE_NO_KEYWORDS = [
  'hayir', 'hayır', 'istemiyorum', 'olmaz', 'gerek yok',
  'ilgilenmiyorum', 'almak istemiyorum',
];

const RESPONSE_REGEX = {
  YES: /(evet|tamam|olur|isterim|olabilir|tabii?|elbette|kesinlikle|ilgileniyorum|ilgilenirim|istiyorum)/i,
  NO: /(hayir|istemiyorum|olmaz|gerek yok|ilgilenmiyorum)/i,
};

module.exports = {
  PATHS,
  RATE_LIMITS,
  APP_LIMITS,
  RESPONSE_REGEX,
  RESPONSE_YES_KEYWORDS,
  RESPONSE_NO_KEYWORDS,
};
