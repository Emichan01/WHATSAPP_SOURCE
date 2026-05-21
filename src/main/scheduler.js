const { RATE_LIMITS } = require('./config');
const db = require('./database');
const wa = require('./whatsapp-service');
const video = require('./video-service');


let running = false;
let stopping = false;
let nextSendTimestamp = null;
let listeners = {
  onProgress: () => {},
  onLog: () => {},
};

function setListeners(l) {
  listeners = { ...listeners, ...l };
}

function randomBetween(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

function readNumericSetting(key, fallback) {
  const v = db.getSetting(key);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getRuntimeConfig() {
  return {
    dailyLimit: Math.min(
      readNumericSetting('daily_limit', RATE_LIMITS.DAILY_DEFAULT),
      RATE_LIMITS.DAILY_MAX
    ),
    hourlyLimit: Math.min(
      readNumericSetting('hourly_limit', RATE_LIMITS.HOURLY_DEFAULT),
      RATE_LIMITS.HOURLY_MAX
    ),
    minDelayMs: Math.max(
      readNumericSetting('min_delay_seconds', 30) * 1000,
      RATE_LIMITS.MIN_DELAY_MS
    ),
    maxDelayMs: Math.max(
      readNumericSetting('max_delay_seconds', 90) * 1000,
      RATE_LIMITS.MIN_DELAY_MS + 1000
    ),
    workStartHour: readNumericSetting('work_start_hour', RATE_LIMITS.WORK_HOUR_START),
    workEndHour: readNumericSetting('work_end_hour', RATE_LIMITS.WORK_HOUR_END),
  };
}

function isWithinWorkHours(now, cfg) {
  const h = now.getHours();
  return h >= cfg.workStartHour && h < cfg.workEndHour;
}

function startOfDayIso(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function oneHourAgoIso(d) {
  return new Date(d.getTime() - 60 * 60 * 1000).toISOString();
}

function getQueueStats() {
  const q = db.getDatabase();
  const pending = q.prepare(`SELECT COUNT(*) as n FROM campaign_queue WHERE status = 'pending'`).get().n;
  const sentToday = db.countSentSince(startOfDayIso(new Date()));
  const sentLastHour = db.countSentSince(oneHourAgoIso(new Date()));
  return { pending, sentToday, sentLastHour };
}

// Otomatik kuyruk doldurma KAPATILDI — kullanıcı kişiyi manuel olarak "Bugün
// Gönderilecekler" sırasına ekler. Aşağıdaki fonksiyonu artık scheduler döngüsünde
// çağırmıyoruz; sadece eski IPC çağrıları boş dönsün diye no-op olarak bıraktım.
function ensureQueueFromContacts() {
  return 0;
}

function getNextQueuedContact() {
  return db
    .getDatabase()
    .prepare(
      `SELECT q.id as queue_id, c.id as contact_id, c.name, c.phone, c.category
       FROM campaign_queue q
       JOIN contacts c ON q.contact_id = c.id
       WHERE q.status = 'pending'
       ORDER BY q.id ASC LIMIT 1`
    )
    .get();
}

function markQueue(queueId, status) {
  db.getDatabase()
    .prepare(`UPDATE campaign_queue SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, queueId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message) {
  const entry = { level, message, ts: new Date().toISOString() };
  console.log(`[scheduler] ${level}: ${message}`);
  listeners.onLog(entry);
}

function emitProgress() {
  const stats = getQueueStats();
  listeners.onProgress({
    running,
    nextSendTimestamp,
    ...stats,
  });
}

function pickRandomActiveTemplate(category = 'default') {
  const list = db.getActiveTemplates(category, 'main').filter((t) => (t.content || '').trim().length > 0);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function pickRandomCtaTemplate(category = 'default') {
  const list = db.getActiveTemplates(category, 'cta').filter((t) => (t.content || '').trim().length > 0);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function renderMessage(template, name) {
  return template.replace(/\{name\}/g, name || '');
}

async function startLoop() {
  if (running) return;
  running = true;
  stopping = false;
  log('info', 'Otomatik gönderim döngüsü başladı');
  emitProgress();

  while (!stopping) {
    try {
      const waStatus = wa.getStatus();
      if (waStatus.status !== 'ready') {
        await waitWithProgress(5000, 'WhatsApp hazır değil, bekleniyor');
        continue;
      }

      const cfg = getRuntimeConfig();
      const now = new Date();
      if (!isWithinWorkHours(now, cfg)) {
        await waitWithProgress(60000, `Mesai dışı (${cfg.workStartHour}-${cfg.workEndHour}), bekleniyor`);
        continue;
      }

      const stats = getQueueStats();
      if (stats.sentToday >= cfg.dailyLimit) {
        await waitWithProgress(60000, `Günlük limit doldu (${stats.sentToday}/${cfg.dailyLimit})`);
        continue;
      }
      if (stats.sentLastHour >= cfg.hourlyLimit) {
        await waitWithProgress(60000, `Saatlik limit doldu (${stats.sentLastHour}/${cfg.hourlyLimit})`);
        continue;
      }

      const next = getNextQueuedContact();
      if (!next) {
        await waitWithProgress(
          60000,
          'Sırada kimse yok — Kişiler sayfasından "Bugün Gönder" işaretleyin',
          { quiet: true }
        );
        continue;
      }

      const category = next.category || 'default';
      const tpl = pickRandomActiveTemplate(category);
      if (!tpl) {
        await waitWithProgress(
          15000,
          `"${category}" kategorisi için aktif mesaj şablonu yok — sıradaki kişi (${next.name}) bekliyor`
        );
        continue;
      }

      const videoEnabled = db.getSetting('video_enabled') !== '0';
      let activeVideo = null;
      if (videoEnabled) {
        activeVideo = video.pickRandomActiveVideo(category);
        if (!activeVideo) {
          await waitWithProgress(
            15000,
            `"${category}" kategorisi için aktif video yok — sıradaki kişi (${next.name}) bekliyor`
          );
          continue;
        }
      }

      await processOne(next, tpl, activeVideo, cfg);
    } catch (err) {
      log('error', `Döngü hatası: ${err.message}`);
      await sleep(5000);
    }
  }

  running = false;
  nextSendTimestamp = null;
  log('info', 'Otomatik gönderim döngüsü durdu');
  emitProgress();
}

async function processOne(item, template, activeVideo, cfg) {
  const personalised = renderMessage(template.content, item.name);
  const cat = item.category || 'default';
  const videoInfo = activeVideo ? `video: ${activeVideo.filename}` : 'video: kapalı';
  try {
    log(
      'info',
      `Gönderiliyor → ${item.name} (${item.phone}) [${cat}] · şablon #${template.id} · ${videoInfo}`
    );
    await wa.sendTextMessage(item.phone, personalised);

    if (activeVideo) {
      await sleep(randomBetween(RATE_LIMITS.VIDEO_DELAY_MIN_MS, RATE_LIMITS.VIDEO_DELAY_MAX_MS));
      await wa.sendVideoFile(item.phone, activeVideo.path);
      await sleep(randomBetween(2000, 4000));
    }

    const ctaTpl = pickRandomCtaTemplate(cat);
    if (ctaTpl) {
      await wa.sendTextMessage(item.phone, renderMessage(ctaTpl.content, item.name));
    }

    db.insertSendLog({ contactId: item.contact_id, templateId: template.id, status: 'sent' });
    markQueue(item.queue_id, 'sent');
    log('success', `Gönderildi: ${item.name}`);
  } catch (err) {
    const isCommsErr = err.message && (
      err.message.includes('startComms') ||
      err.message.includes('sendIq') ||
      err.message.includes('comms')
    );
    if (isCommsErr) {
      // WhatsApp bağlantı katmanı hazır değildi — kişiyi sırada bırak, bekle
      db.getDatabase()
        .prepare(`UPDATE campaign_queue SET status = 'pending', processed_at = NULL WHERE id = ?`)
        .run(item.queue_id);
      log('warn', `Bağlantı hazır değildi (${item.name}) — kişi yeniden kuyruğa alındı, 20sn bekleniyor`);
      emitProgress();
      await sleep(20000);
      nextSendTimestamp = null;
      return;
    }
    db.insertSendLog({
      contactId: item.contact_id,
      templateId: template.id,
      status: 'failed',
      error: err.message,
    });
    markQueue(item.queue_id, 'failed');
    log('error', `Başarısız: ${item.name} → ${err.message}`);
  }

  emitProgress();
  const delay = randomBetween(cfg.minDelayMs, cfg.maxDelayMs);
  nextSendTimestamp = Date.now() + delay;
  emitProgress();
  await sleep(delay);
  nextSendTimestamp = null;
}

let lastQuietReason = null;
async function waitWithProgress(ms, reason, opts = {}) {
  nextSendTimestamp = Date.now() + ms;
  // quiet: aynı sebep tekrarlanırsa log'u şişirmesin (örn. "Bekleyen kişi yok")
  if (!opts.quiet || lastQuietReason !== reason) {
    log('info', `Bekleme: ${reason}`);
    lastQuietReason = opts.quiet ? reason : null;
  }
  emitProgress();
  await sleep(ms);
  nextSendTimestamp = null;
}

function stop() {
  stopping = true;
}

function isRunning() {
  return running;
}

function getState() {
  return {
    running,
    nextSendTimestamp,
    ...getQueueStats(),
  };
}

function rebuildQueueAfterImport() {
  return ensureQueueFromContacts();
}

module.exports = {
  setListeners,
  startLoop,
  stop,
  isRunning,
  getState,
  rebuildQueueAfterImport,
};
