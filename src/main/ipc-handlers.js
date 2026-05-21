const { ipcMain, dialog, shell, Notification } = require('electron');

const db = require('./database');
const wa = require('./whatsapp-service');
const excel = require('./excel-service');
const video = require('./video-service');
const scheduler = require('./scheduler');

let getMainWindowRef = () => null;

function registerIpcHandlers(getMainWindow) {
  getMainWindowRef = getMainWindow;

  ipcMain.handle('app:ping', async () => ({ ok: true, ts: Date.now() }));

  ipcMain.handle('app:data-path', async () => {
    const { PATHS } = require('./config');
    return PATHS.DATA_DIR;
  });
  ipcMain.handle('app:open-data-folder', async () => {
    const { PATHS } = require('./config');
    await shell.openPath(PATHS.DATA_DIR);
    return true;
  });

  // Settings
  ipcMain.handle('settings:get-all', async () => db.getAllSettings());
  ipcMain.handle('settings:set', async (_evt, key, value) => {
    db.setSetting(key, value);
    return true;
  });
  ipcMain.handle('settings:set-many', async (_evt, obj) => {
    for (const [k, v] of Object.entries(obj || {})) {
      db.setSetting(k, v);
    }
    return true;
  });

  // Contacts
  ipcMain.handle('contacts:list', async (_evt, opts = {}) => ({
    rows: db.getContactsPageWithQueue(opts),
    total: db.countContacts(opts.search || '', opts.category || '', opts.visitDateFrom || '', opts.visitDateTo || '', opts.color || '', !!opts.excludeSent),
  }));
  ipcMain.handle('contacts:distinct-colors', async () => db.getDistinctColors());
  ipcMain.handle('contacts:add', async (_evt, name, phone, category = 'default') => {
    const cleanName = String(name || '').trim();
    const normalized = wa.normalizePhone(phone);
    if (!cleanName) return { error: 'İsim boş olamaz' };
    if (!normalized) return { error: 'Geçersiz telefon numarası' };
    const cat = String(category || 'default').trim() || 'default';
    if (!db.getCategory(cat)) return { error: `Kategori bulunamadı: ${cat}` };
    const stored = '+' + normalized;
    const info = db.insertContact(cleanName, stored, cat);
    if (info.changes === 0) {
      return { error: 'Bu numara zaten kayıtlı' };
    }
    // NOT: Yeni eklenen kişi otomatik sıraya KOYULMAZ.
    // Kullanıcı "Bugün Gönder" checkbox'ını işaretlemediği sürece mesaj atılmaz.
    return { id: info.lastInsertRowid, name: cleanName, phone: stored, category: cat };
  });

  ipcMain.handle('contacts:update-category', async (_evt, id, category) => {
    const cat = String(category || 'default').trim() || 'default';
    if (!db.getCategory(cat)) return { error: `Kategori bulunamadı: ${cat}` };
    db.updateContactCategory(id, cat);
    return true;
  });

  ipcMain.handle('contacts:delete', async (_evt, id) => db.deleteContact(id));
  ipcMain.handle('contacts:delete-all', async () => {
    const dbi = db.getDatabase();
    dbi.prepare('DELETE FROM campaign_queue').run();
    return db.deleteAllContacts();
  });
  ipcMain.handle('contacts:clean-invalid', async () => db.deleteInvalidContacts());
  ipcMain.handle('contacts:update-visit-date', async (_evt, id, visitDate) =>
    db.updateContactVisitDate(id, visitDate || null)
  );
  ipcMain.handle('contacts:bulk-set-visit-date', async (_evt, opts = {}) =>
    db.bulkSetVisitDateByFilter({
      search:        opts.search        || '',
      category:      opts.category      || '',
      visitDateFrom: opts.visitDateFrom || '',
      visitDateTo:   opts.visitDateTo   || '',
      color:         opts.color         || '',
      excludeSent:   !!opts.excludeSent,
      newVisitDate:  opts.newVisitDate  || null,
    })
  );

  // Excel
  ipcMain.handle('excel:pick', async () => {
    const win = getMainWindowRef();
    const res = await dialog.showOpenDialog(win, {
      title: 'Excel dosyası seç',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    try {
      const info = excel.inspectFile(filePath);
      return { filePath, ...info };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle(
    'excel:update-colors',
    async (_evt, { filePath, nameIndex, phoneIndex, hasHeaderRow }) => {
      try {
        const result = excel.updateColorsFromExcel({
          filePath,
          nameIndex: Number(nameIndex),
          phoneIndex: Number(phoneIndex),
          hasHeaderRow: !!hasHeaderRow,
          onProgress: (p) => {
            const win = getMainWindowRef();
            if (win && !win.isDestroyed()) win.webContents.send('excel:progress', p);
          },
        });
        return result;
      } catch (err) {
        return { error: err.message };
      }
    }
  );

  ipcMain.handle(
    'excel:import',
    async (_evt, { filePath, nameIndex, phoneIndex, dateIndex, hasHeaderRow, category, autoQueue }) => {
      try {
        const cat = String(category || 'default').trim() || 'default';
        if (!db.getCategory(cat)) {
          return { error: `Kategori bulunamadı: ${cat}` };
        }
        const importStart = new Date().toISOString();
        const result = excel.importContacts({
          filePath,
          nameIndex,
          phoneIndex,
          dateIndex: dateIndex != null ? Number(dateIndex) : -1,
          hasHeaderRow,
          category: cat,
          onProgress: (p) => {
            const win = getMainWindowRef();
            if (win && !win.isDestroyed()) {
              win.webContents.send('excel:progress', p);
            }
          },
        });
        // İsteğe bağlı: Excel'i yükler yüklemez yeni eklenen kişileri sıraya at
        // Yalnızca bu import'ta eklenen YENİ kişileri sıraya al.
        // addByFilterToQueue tüm kategoriyi tarar — eski gönderilmiş kişileri de açardı.
        let queued = 0;
        if (autoQueue) {
          const r = db.addRecentlyImportedToQueue(cat, importStart);
          queued = r.added;
        }
        return { ...result, category: cat, queued };
      } catch (err) {
        return { error: err.message };
      }
    }
  );

  // Mesaj şablonları (birden fazla kayıt, scheduler kişinin kategorisine göre rastgele seçer)
  ipcMain.handle('templates:list', async (_evt, category = null, type = null) =>
    db.getTemplates(category || null, type || null)
  );
  ipcMain.handle('templates:create', async (_evt, content, category = 'default', type = 'main') => {
    const cat = String(category || 'default').trim() || 'default';
    const tplType = ['main', 'cta'].includes(type) ? type : 'main';
    if (!db.getCategory(cat)) return { error: `Kategori bulunamadı: ${cat}` };
    const info = db.insertTemplate(String(content || ''), cat, tplType);
    return { id: info.lastInsertRowid, category: cat, type: tplType };
  });
  ipcMain.handle('templates:update', async (_evt, id, content, isActive) =>
    db.updateTemplate(id, String(content || ''), !!isActive)
  );
  ipcMain.handle('templates:delete', async (_evt, id) => db.deleteTemplate(id));
  ipcMain.handle('templates:preview', async (_evt, content, name) =>
    String(content || '').replace(/\{name\}/g, name || 'Mehmet')
  );
  ipcMain.handle('templates:stats', async () => db.getTemplateStats());

  ipcMain.handle('leads:pipeline', async () => db.getLeadPipelineCounts());

  // Kategoriler
  ipcMain.handle('categories:list', async () => db.listCategories());
  ipcMain.handle('categories:create', async (_evt, name, label) => {
    const cleanName = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const cleanLabel = String(label || '').trim() || cleanName;
    if (!cleanName) return { error: 'Kategori adı boş olamaz' };
    db.upsertCategory(cleanName, cleanLabel);
    return { name: cleanName, label: cleanLabel };
  });
  ipcMain.handle('categories:delete', async (_evt, name) => {
    try {
      db.deleteCategory(name);
      return true;
    } catch (err) {
      return { error: err.message };
    }
  });

  // Video
  ipcMain.handle('video:list', async () => video.listVideos());
  ipcMain.handle('video:pick-and-import', async (_evt, category = 'default') => {
    const win = getMainWindowRef();
    const res = await dialog.showOpenDialog(win, {
      title: 'Video seç (birden fazla seçebilirsiniz)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', '3gp', 'mkv'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const cat = String(category || 'default').trim() || 'default';
    if (!db.getCategory(cat)) return { error: `Kategori bulunamadı: ${cat}` };
    const imported = [];
    const errors = [];
    for (const fp of res.filePaths) {
      try {
        imported.push(video.importVideo(fp, cat));
      } catch (err) {
        errors.push({ file: fp, error: err.message });
      }
    }
    return { imported, errors };
  });
  ipcMain.handle('video:update', async (_evt, id, opts) => {
    try {
      video.updateVideoSettings(Number(id), opts || {});
      return true;
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('video:delete', async (_evt, id) => video.deleteVideo(Number(id)));

  // WhatsApp
  ipcMain.handle('whatsapp:start', async () => wa.startClient());
  ipcMain.handle('whatsapp:status', async () => wa.getStatus());
  ipcMain.handle('whatsapp:logout', async () => {
    await wa.logout();
    return true;
  });

  // Scheduler / gönderim
  ipcMain.handle('scheduler:state', async () => scheduler.getState());

  // Bugün Gönderilecekler kuyruğu (manuel)
  ipcMain.handle('queue:add', async (_evt, contactIds) => {
    const ids = (Array.isArray(contactIds) ? contactIds : [contactIds])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0);
    return db.addContactsToQueue(ids);
  });
  ipcMain.handle('queue:remove', async (_evt, contactIds) => {
    const ids = (Array.isArray(contactIds) ? contactIds : [contactIds])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && x > 0);
    return db.removeContactsFromQueue(ids);
  });
  ipcMain.handle('queue:add-by-filter', async (_evt, opts = {}) =>
    db.addByFilterToQueue({
      search:        opts.search        || '',
      category:      opts.category      || '',
      visitDateFrom: opts.visitDateFrom || '',
      visitDateTo:   opts.visitDateTo   || '',
      color:         opts.color         || '',
      excludeSent:   !!opts.excludeSent,
    })
  );
  ipcMain.handle('queue:clear', async () => ({ removed: db.clearPendingQueue() }));
  ipcMain.handle('queue:status', async () => {
    const dbi = db.getDatabase();
    const pending = dbi.prepare(`SELECT COUNT(*) as n FROM campaign_queue WHERE status = 'pending'`).get().n;
    return { pending };
  });

  // Leads
  ipcMain.handle('leads:list', async (_evt, opts = {}) => db.getLeads(opts));
  ipcMain.handle('leads:update-status', async (_evt, id, status) =>
    db.updateLeadStatus(id, status)
  );
  ipcMain.handle('leads:delete', async (_evt, id) => db.deleteLead(id));
  ipcMain.handle('leads:update-notes', async (_evt, id, notes) => db.updateLeadNotes(id, notes));
  ipcMain.handle('leads:export', async () => {
    const rows = db.getLeads();
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Ad: r.name,
        Telefon: r.phone,
        Kategori: r.category || 'default',
        Cevap: r.response_text,
        Tarih: r.responded_at,
        Durum: r.status,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leadler');
    const win = getMainWindowRef();
    const res = await dialog.showSaveDialog(win, {
      title: 'Lead listesini kaydet',
      defaultPath: `leadler-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    XLSX.writeFile(wb, res.filePath);
    return res.filePath;
  });

  // Ödeme Planı — TCMB döviz kurları
  ipcMain.handle('payment-plan:get-rates', async () => {
    const https = require('https');

    function httpsGet(url, opts = {}) {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 10000, rejectUnauthorized: false, ...opts }, (res) => {
          // Redirect'leri takip et
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            return httpsGet(res.headers.location, opts).then(resolve).catch(reject);
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', c => { body += c; });
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
    }

    const nowDate = () => new Date().toLocaleDateString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // ── 1. TCMB ──────────────────────────────────────────────
    try {
      const xml = await httpsGet('https://www.tcmb.gov.tr/kurlar/today.xml');
      function parseXmlRate(code) {
        const blockRe = new RegExp(`<Currency[^>]+CurrencyCode="${code}"[^>]*>([\\s\\S]*?)<\\/Currency>`);
        const block = xml.match(blockRe);
        if (!block) return null;
        const unit    = block[1].match(/<Unit>(\d+)<\/Unit>/);
        const selling = block[1].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
        if (!unit || !selling) return null;
        return parseFloat(selling[1]) / parseInt(unit[1]);
      }
      const USD = parseXmlRate('USD');
      const EUR = parseXmlRate('EUR');
      const GBP = parseXmlRate('GBP');
      if (USD) return { USD, EUR, GBP, date: nowDate(), source: 'TCMB' };
    } catch (_) { /* TCMB başarısız, yedek API dene */ }

    // ── 2. Yedek: exchangerate-api (ücretsiz, kimlik doğrulama gereksiz) ──
    try {
      const json = JSON.parse(await httpsGet('https://open.er-api.com/v6/latest/TRY'));
      if (json && json.rates) {
        const r = json.rates;
        // TRY bazlı oran → 1 USD/EUR/GBP = kaç TRY
        const inv = (c) => r[c] ? parseFloat((1 / r[c]).toFixed(4)) : null;
        return { USD: inv('USD'), EUR: inv('EUR'), GBP: inv('GBP'), date: nowDate(), source: 'ExchangeRate-API' };
      }
    } catch (_) { /* yedek de başarısız */ }

    return { USD: null, EUR: null, GBP: null, date: null, error: 'Her iki kaynak da erişilemedi.' };
  });

  // Ödeme Planı Excel export
  ipcMain.handle('payment-plan:export-excel', async (_evt, plans) => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    const fmtMoney = (n) => (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    const fmtDate = (s) => {
      const d = new Date(s + 'T00:00:00');
      return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const typeLabel = (t) => t === 'down' ? 'Peşinat' : t === 'intermediate' ? 'Ara Ödeme' : 'Taksit';

    for (const plan of plans) {
      const summaryRows = [
        ['Toplam Tutar', fmtMoney(plan.totalAmount)],
        ['Peşinat', fmtMoney(plan.downPayment)],
        ['Ara Ödemeler Toplamı', fmtMoney(plan.totalIp)],
        ['Taksit Sayısı', `${plan.installmentCount} ay`],
        ['Aylık Taksit', fmtMoney(plan.monthly)],
        ['Başlangıç Tarihi', fmtDate(plan.startDate)],
        [],
        ['#', 'Tarih', 'Açıklama', 'Tür', 'Tutar', 'Toplam Ödenen', 'Kalan'],
      ];
      const dataRows = (plan.schedule || []).map(row => [
        row.no,
        fmtDate(row.date),
        row.label,
        typeLabel(row.type),
        row.amount,
        row.cumulative,
        row.remaining,
      ]);
      const ws = XLSX.utils.aoa_to_sheet([...summaryRows, ...dataRows]);
      ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 18 }];
      const sheetName = String(plan.name || 'Plan').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (plans.length > 1) {
      const compRows = [
        ['', ...plans.map(p => p.name)],
        ['Toplam Tutar', ...plans.map(p => p.totalAmount)],
        ['Peşinat', ...plans.map(p => p.downPayment)],
        ['Taksit Sayısı', ...plans.map(p => `${p.installmentCount} ay`)],
        ['Aylık Taksit', ...plans.map(p => p.monthly)],
        ['Ara Ödemeler', ...plans.map(p => p.totalIp)],
      ];
      const wsComp = XLSX.utils.aoa_to_sheet(compRows);
      XLSX.utils.book_append_sheet(wb, wsComp, 'Karşılaştırma');
    }

    const win = getMainWindowRef();
    const res = await dialog.showSaveDialog(win, {
      title: 'Ödeme planını kaydet',
      defaultPath: `odeme-plani-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (res.canceled || !res.filePath) return null;
    XLSX.writeFile(wb, res.filePath);
    return res.filePath;
  });

  ipcMain.handle('shell:open-whatsapp', async (_evt, phone) => {
    const clean = String(phone || '').replace(/[^\d]/g, '');
    if (!clean) return false;
    await shell.openExternal(`https://wa.me/${clean}`);
    return true;
  });

  // Logs / dashboard
  ipcMain.handle('logs:recent', async (_evt, limit = 50) => db.getRecentLogs(limit));

  ipcMain.handle('dashboard:stats', async () => {
    const dbi = db.getDatabase();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    const startOfMonth = new Date(startOfDay);
    startOfMonth.setDate(1);

    const sent = (since) =>
      dbi
        .prepare(`SELECT COUNT(*) as n FROM send_logs WHERE status = 'sent' AND sent_at >= ?`)
        .get(since.toISOString()).n;

    const totalContacts = dbi.prepare(`SELECT COUNT(*) as n FROM contacts`).get().n;
    const totalLeads = dbi.prepare(`SELECT COUNT(*) as n FROM leads`).get().n;
    const totalSent = dbi
      .prepare(`SELECT COUNT(*) as n FROM send_logs WHERE status = 'sent'`)
      .get().n;
    const totalFailed = dbi
      .prepare(`SELECT COUNT(*) as n FROM send_logs WHERE status = 'failed'`)
      .get().n;

    const totalAllLeads = totalLeads; // tüm yanıtlar (evet+hayır+diğer)
    const totalYesLeads = dbi
      .prepare(`SELECT COUNT(*) as n FROM leads WHERE response_type = 'yes' OR response_type IS NULL`)
      .get().n;
    const totalNoResponses = dbi
      .prepare(`SELECT COUNT(*) as n FROM leads WHERE response_type = 'no'`)
      .get().n;

    return {
      totalContacts,
      totalLeads: totalAllLeads,
      totalYesLeads,
      totalNoResponses,
      totalSent,
      totalFailed,
      sentToday: sent(startOfDay),
      sentWeek: sent(startOfWeek),
      sentMonth: sent(startOfMonth),
      conversionRate: totalSent > 0 ? +((totalYesLeads / totalSent) * 100).toFixed(2) : 0,
      responseRate: totalSent > 0 ? +((totalAllLeads / totalSent) * 100).toFixed(1) : 0,
      whatsapp: wa.getStatus(),
      scheduler: scheduler.getState(),
    };
  });

  ipcMain.handle('dashboard:chart-data', async () => db.getDailyStats(14));

  ipcMain.handle('notify:show', async (_evt, title, body) => {
    if (!Notification.isSupported()) return false;
    new Notification({ title, body }).show();
    return true;
  });

  // ─── Günlük Özet Bildirimi ────────────────────────────────
  ipcMain.handle('notify:reschedule-daily', async () => {
    const all = db.getAllSettings();
    const hour = parseInt(all.daily_notif_hour ?? '20', 10);
    scheduleDailyNotification(isNaN(hour) ? 20 : Math.min(23, Math.max(0, hour)));
    return true;
  });

  const initHour = parseInt(db.getAllSettings().daily_notif_hour ?? '20', 10);
  scheduleDailyNotification(isNaN(initHour) ? 20 : Math.min(23, Math.max(0, initHour)));

  // ─── Otomatik Güncelleme ──────────────────────────────────
  const updater = require('./auto-updater');
  ipcMain.handle('update:install', async () => updater.installUpdate());
  ipcMain.handle('update:check', async () => updater.checkForUpdates());
}

let _dailyNotifTimeout = null;
let _dailyNotifInterval = null;

function scheduleDailyNotification(hour = 20) {
  // Önceki zamanlayıcıları iptal et
  if (_dailyNotifTimeout)  { clearTimeout(_dailyNotifTimeout);   _dailyNotifTimeout  = null; }
  if (_dailyNotifInterval) { clearInterval(_dailyNotifInterval);  _dailyNotifInterval = null; }

  const msUntilHour = () => {
    const now    = new Date();
    const target = new Date();
    target.setHours(hour, 0, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1);
    return target - now;
  };

  function sendSummary() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();
      const sent     = db.countSentSince(todayIso);
      const leads    = db.countLeadsSince(todayIso);
      const pipeline = db.getLeadPipelineCounts();
      const total    = Object.values(pipeline).reduce((s, n) => s + n, 0);
      if (!Notification.isSupported()) return;
      new Notification({
        title: 'Ekşioğlu Connect — Günlük Özet',
        body: `Bugün ${sent} mesaj gönderildi · ${leads} yeni yanıt · Pipeline: ${total} kişi`,
      }).show();
    } catch (e) {
      console.error('[daily-notif]', e.message);
    }
  }

  _dailyNotifTimeout = setTimeout(() => {
    sendSummary();
    _dailyNotifInterval = setInterval(sendSummary, 24 * 60 * 60 * 1000);
  }, msUntilHour());
}

module.exports = { registerIpcHandlers };
