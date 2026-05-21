const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { app } = require('electron');

const { PATHS, RESPONSE_REGEX, RESPONSE_YES_KEYWORDS, RESPONSE_NO_KEYWORDS } = require('./config');
const db = require('./database');


// Türkçe karakterleri ve noktalama işaretlerini sadeleştir → "Évet!!" → "evet"
function normalizeText(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isYesResponse(body) {
  const norm = normalizeText(body);
  if (!norm) return false;
  // 1) Hızlı kelime bazlı kontrol
  const words = norm.split(' ');
  for (const w of words) {
    for (const kw of RESPONSE_YES_KEYWORDS) {
      const nkw = normalizeText(kw);
      if (w === nkw) return true;
      // "evettt" gibi uzatılmış formlar
      if (nkw.length >= 3 && w.startsWith(nkw)) return true;
    }
  }
  // 2) Yedek: regex (daha esnek substring eşleşmesi)
  return RESPONSE_REGEX.YES.test(norm);
}

function isNoResponse(body) {
  const norm = normalizeText(body);
  if (!norm) return false;
  for (const kw of RESPONSE_NO_KEYWORDS) {
    if (norm.includes(normalizeText(kw))) return true;
  }
  return RESPONSE_REGEX.NO.test(norm);
}

let client = null;
let status = 'idle';
let lastQrDataUrl = null;
let listeners = {
  onStatus: () => {},
  onQr: () => {},
  onLead: () => {},
};

function setListeners(l) {
  listeners = { ...listeners, ...l };
}

function normalizePhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    s = s.slice(2);
  } else if (s.startsWith('0')) {
    s = '90' + s.slice(1);
  } else if (s.length === 10 && s.startsWith('5')) {
    s = '90' + s;
  }
  if (!/^\d{10,15}$/.test(s)) return null;
  return s;
}

function toJid(normalized) {
  return `${normalized}@c.us`;
}

function updateStatus(next) {
  status = next;
  listeners.onStatus({ status, hasQr: !!lastQrDataUrl });
}

function getStatus() {
  return { status, hasQr: !!lastQrDataUrl, qr: lastQrDataUrl };
}

function getWindowsSystemChrome() {
  if (process.platform !== 'win32') return undefined;
  const lad = process.env.LOCALAPPDATA || '';
  const pf  = process.env.ProgramFiles  || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    lad + '\\Google\\Chrome\\Application\\chrome.exe',
    pf  + '\\Google\\Chrome\\Application\\chrome.exe',
    pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
    lad + '\\Chromium\\Application\\chrome.exe',
    pf  + '\\Chromium\\Application\\chrome.exe',
    // Edge (Chromium tabanlı) — yedek
    pf  + '\\Microsoft\\Edge\\Application\\msedge.exe',
    pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  // puppeteer v20+ kendi cache'ine Chrome indirir: %LOCALAPPDATA%\puppeteer\chrome\...
  if (lad) {
    const puppCacheBase = path.join(lad, 'puppeteer', 'chrome');
    try {
      if (fs.existsSync(puppCacheBase)) {
        const builds = fs.readdirSync(puppCacheBase).sort().reverse();
        for (const build of builds) {
          const chromePath = path.join(puppCacheBase, build, 'chrome-win64', 'chrome.exe');
          const chromePath32 = path.join(puppCacheBase, build, 'chrome-win32', 'chrome.exe');
          if (fs.existsSync(chromePath)) return chromePath;
          if (fs.existsSync(chromePath32)) return chromePath32;
        }
      }
    } catch (_) {}
  }
  return undefined;
}

function getChromiumExecPath() {
  // Windows exe'de önce sisteme kurulu Chrome'u dene — Mac binary sorunundan kaçınır
  if (process.platform === 'win32' && app?.isPackaged) {
    const sysCh = getWindowsSystemChrome();
    if (sysCh) {
      console.log('[WA] Windows sistem Chrome kullanılıyor:', sysCh);
      return sysCh;
    }
  }

  const fixAsarPath = (p) => {
    if (!p) return p;
    if (app && app.isPackaged) return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
    return p;
  };
  try {
    const puppeteer = require('puppeteer');
    const execPath = fixAsarPath(puppeteer.executablePath());
    if (execPath && fs.existsSync(execPath)) return execPath;
  } catch (_) {}
  try {
    const puppeteerCore = require('puppeteer-core');
    const execPath = fixAsarPath(puppeteerCore.executablePath());
    if (execPath && fs.existsSync(execPath)) return execPath;
  } catch (_) {}
  return undefined;
}

async function startClient() {
  if (client) return getStatus();

  if (!fs.existsSync(PATHS.SESSIONS_DIR)) {
    fs.mkdirSync(PATHS.SESSIONS_DIR, { recursive: true });
  }

  updateStatus('initializing');

  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-zygote',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
  ];

  const chromiumPath = getChromiumExecPath();
  if (chromiumPath) console.log('[WA] Chromium yolu:', chromiumPath);

  const puppeteerOpts = {
    headless: true,
    args: puppeteerArgs,
    protocolTimeout: 300000,
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  };

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'emlak-wa-main',
      dataPath: PATHS.SESSIONS_DIR,
    }),
    // Sabit bir WA Web sürümü kullan; remote CDN'den çek → "authenticated ama ready gelmiyor" sorununu çözer
    webVersion: '2.3000.1039501489',
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/',
    },
    puppeteer: puppeteerOpts,
  });

  client.on('qr', async (qr) => {
    try {
      lastQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 1 });
      updateStatus('qr');
      listeners.onQr(lastQrDataUrl);
    } catch (err) {
      console.error('QR kod üretim hatası:', err);
    }
  });

  client.on('authenticated', () => {
    lastQrDataUrl = null;
    updateStatus('authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('WhatsApp kimlik doğrulama hatası:', msg);
    updateStatus('auth_failure');
  });

  client.on('ready', () => {
    lastQrDataUrl = null;
    updateStatus('ready');
    console.log('[WA] ready — gelen mesajlar dinleniyor (message + message_create)');
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`[WA] yükleniyor %${percent}: ${message || ''}`);
    listeners.onStatus({ status: 'loading', percent, message: message || '', hasQr: false });
  });

  client.on('change_state', (state) => {
    console.log(`[WA] state: ${state}`);
  });

  client.on('disconnected', (reason) => {
    console.warn('WhatsApp bağlantısı koptu:', reason);
    updateStatus('disconnected');
  });

  // Hem 'message' hem 'message_create' dinlenir. Bazı whatsapp-web.js sürümlerinde
  // 'message' event'i sessizce kaçabiliyor; 'message_create' her mesajı (giden dahil)
  // yakalar — fromMe filtresiyle yalnızca karşı taraftan gelenler işlenir.
  const dedupe = new Set();
  function withDedupe(handler) {
    return async (msg) => {
      try {
        const key = msg?.id?._serialized || msg?.id?.id || `${msg?.from}-${msg?.timestamp}-${(msg?.body || '').slice(0, 40)}`;
        if (key && dedupe.has(key)) return;
        if (key) {
          dedupe.add(key);
          if (dedupe.size > 500) {
            const first = dedupe.values().next().value;
            dedupe.delete(first);
          }
        }
        await handler(msg);
      } catch (err) {
        console.error('Gelen mesaj işleme hatası:', err);
      }
    };
  }
  client.on('message', withDedupe(handleIncomingMessage));
  client.on('message_create', withDedupe(handleIncomingMessage));

  try {
    await client.initialize();
  } catch (err) {
    console.error('WhatsApp client başlatılamadı:', err);
    updateStatus('error');
  }

  return getStatus();
}

async function handleIncomingMessage(msg) {
  if (msg.fromMe) return;
  const fromId = msg.from || msg?.id?.remote || '';
  if (!fromId) return;
  if (fromId.endsWith('@g.us') || fromId.endsWith('@broadcast') || fromId.includes('status@')) {
    return;
  }

  const body = (msg.body || '').trim();
  const isLid = fromId.endsWith('@lid');

  // KRİTİK: whatsapp-web.js Contact.number (userid) LID kişiler için LID rakamlarını
  // döndürebiliyor — yani 137378874306715 gibi sahte sayı. Bu yüzden:
  //   - LID gelmişse ÖNCE Store'dan gerçek telefonu çöz (c.number'a güvenME).
  //   - Yalnız c.us ID'lerinde c.number / c.id.user güvenli.

  let realPhone = null;
  let contactName = null;

  // 1) Önce isim çek (debug + lead'e fallback name için)
  try {
    const c = await msg.getContact();
    if (c) {
      contactName = c.pushname || c.name || c.shortName || null;
      // Sadece c.us server için telefon kabul et
      if (!isLid && c.id && c.id.server === 'c.us' && c.id.user && /^\d{8,15}$/.test(c.id.user)) {
        realPhone = c.id.user;
      } else if (!isLid && c.number && /^\d{8,15}$/.test(c.number)) {
        realPhone = c.number;
      }
    }
  } catch (err) {
    console.error('getContact hatası:', err);
  }

  // 2) from doğrudan @c.us ise digits
  if (!realPhone && fromId.endsWith('@c.us')) {
    const digits = fromId.replace(/@.+$/, '').replace(/[^\d]/g, '');
    if (/^\d{8,15}$/.test(digits)) realPhone = digits;
  }

  // 3) LID → Store'dan gerçek telefon çöz (enforceLidAndPnRetrieval)
  //    İlk mesajda WhatsApp Store henüz LID-PN map'i kurmamış olabilir;
  //    küçük bir gecikmeyle birkaç deneme yap.
  if (!realPhone && isLid && client) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await client.getContactLidAndPhone([fromId]);
        const pn = res?.[0]?.pn;
        if (pn) {
          const digits = String(pn).split('@')[0].replace(/[^\d]/g, '');
          if (/^\d{8,15}$/.test(digits)) {
            realPhone = digits;
            console.log(`[WA] LID → telefon çözümlendi (${attempt}. deneme): ${fromId} → +${realPhone}`);
            break;
          }
        }
      } catch (err) {
        console.error(`getContactLidAndPhone hatası (${attempt}. deneme):`, err);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800));
    }
  }

  // 4) Son yedek — pupPage üzerinden contact.phoneNumber'ı oku
  if (!realPhone && isLid && client?.pupPage) {
    try {
      const pn = await client.pupPage.evaluate(async (lid) => {
        try {
          const wid = window.require('WAWebWidFactory').createWid(lid);
          const phone = window.require('WAWebApiContact').getPhoneNumber(wid);
          return phone?._serialized || null;
        } catch (e) {
          return null;
        }
      }, fromId);
      if (pn) {
        const digits = String(pn).split('@')[0].replace(/[^\d]/g, '');
        if (/^\d{8,15}$/.test(digits)) {
          realPhone = digits;
          console.log(`[WA] LID → telefon (pupPage fallback): ${fromId} → +${realPhone}`);
        }
      }
    } catch (err) {
      console.error('pupPage LID resolution hatası:', err);
    }
  }

  // Debug log — bir sonraki bug'da kolay teşhis için
  if (!realPhone) {
    console.warn(`[WA] Telefon ÇÖZÜLEMEDİ: from=${fromId} contactName=${contactName} body="${body.slice(0, 50)}"`);
  }

  const phoneForDisplay = realPhone
    ? `+${realPhone}`
    : (isLid ? '(@lid: telefon maskeli)' : '(bilinmiyor)');

  if (!body) return;

  if (!realPhone) {
    console.warn(`[WA] Telefon çözümlenemedi, mesaj atlandı: from=${fromId}`);
    return;
  }

  const contact = findContactByAnyPhone(realPhone);
  if (!contact) {
    // Kampanya listesinde olmayan biri — yok say
    return;
  }

  // Tüm yanıtları (evet/hayır/diğer) leads tablosuna kaydet
  const responseType = isYesResponse(body) ? 'yes' : (isNoResponse(body) ? 'no' : 'other');
  try {
    const info = db.insertLead({ contactId: contact.id, responseText: body, responseType });
    listeners.onLead({
      id: info.lastInsertRowid,
      name: contact.name,
      phone: contact.phone,
      response_text: body,
      responded_at: new Date().toISOString(),
      response_type: responseType,
    });
  } catch (err) {
    console.error('Yanıt kayıt hatası:', err);
  }
}

function findContactByAnyPhone(normalized) {
  let c = db.findContactByPhone(normalized);
  if (c) return c;
  c = db.findContactByPhone('+' + normalized);
  if (c) return c;
  return null;
}

function isCommsNotReady(err) {
  const msg = err?.message || '';
  return msg.includes('startComms') || msg.includes('sendIq') || msg.includes('comms');
}

async function sendTextMessage(rawPhone, text) {
  if (!client || status !== 'ready') {
    throw new Error('WhatsApp henüz hazır değil');
  }
  const normalized = normalizePhone(rawPhone);
  if (!normalized) {
    throw new Error(`Geçersiz telefon numarası: ${rawPhone}`);
  }
  const jid = toJid(normalized);

  const numberId = await client.getNumberId(normalized);
  if (!numberId) {
    throw new Error('Numara WhatsApp\'ta kayıtlı değil');
  }

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await client.sendMessage(jid, text);
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && isCommsNotReady(err)) {
        console.warn(`[WA] Bağlantı katmanı hazır değil (${attempt}. deneme), 12sn bekleniyor…`);
        await new Promise((r) => setTimeout(r, 12000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function sendVideoFile(rawPhone, filePath, caption = '') {
  if (!client || status !== 'ready') {
    throw new Error('WhatsApp henüz hazır değil');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error('Video dosyası bulunamadı');
  }
  const normalized = normalizePhone(rawPhone);
  if (!normalized) {
    throw new Error(`Geçersiz telefon numarası: ${rawPhone}`);
  }
  const media = MessageMedia.fromFilePath(filePath);
  const jid = toJid(normalized);

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await client.sendMessage(jid, media, { caption });
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && isCommsNotReady(err)) {
        console.warn(`[WA] Video gönderimi bağlantı hatası (${attempt}. deneme), 12sn bekleniyor…`);
        await new Promise((r) => setTimeout(r, 12000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function logout() {
  if (!client) return;
  try {
    await client.logout();
  } catch (err) {
    console.error('logout hatası:', err);
  }
  try {
    await client.destroy();
  } catch (err) {
    console.error('destroy hatası:', err);
  }
  client = null;
  lastQrDataUrl = null;
  updateStatus('idle');
}

async function shutdown() {
  if (!client) return;
  try {
    await client.destroy();
  } catch (err) {
    console.error('shutdown destroy hatası:', err);
  }
  client = null;
}

module.exports = {
  setListeners,
  startClient,
  getStatus,
  sendTextMessage,
  sendVideoFile,
  logout,
  shutdown,
  normalizePhone,
};
