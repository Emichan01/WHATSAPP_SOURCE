const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { PATHS } = require('./config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active_video_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'default',
  row_color TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);

CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  category TEXT NOT NULL DEFAULT 'default',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  sent_at DATETIME,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_send_logs_contact ON send_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_send_logs_sent_at ON send_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_send_logs_status ON send_logs(status);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  response_text TEXT,
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS contact_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  response_type TEXT NOT NULL,
  response_text TEXT,
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_responses_type ON contact_responses(response_type);
CREATE INDEX IF NOT EXISTS idx_responses_contact ON contact_responses(contact_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS campaign_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON campaign_queue(status);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'default',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category);
CREATE INDEX IF NOT EXISTS idx_videos_active ON videos(is_active);
`;

const DEFAULT_SETTINGS = {
  daily_limit: '200',
  hourly_limit: '30',
  work_start_hour: '9',
  work_end_hour: '21',
  min_delay_seconds: '30',
  max_delay_seconds: '90',
  active_video_id: '',
  warmup_mode: '1',
  campaign_state: 'idle',
  video_enabled: '1',
};

function initDatabase() {
  if (!fs.existsSync(PATHS.DATA_DIR)) {
    fs.mkdirSync(PATHS.DATA_DIR, { recursive: true });
  }
  db = new Database(PATHS.DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateLegacyColumns();
  seedDefaultCategories();
  seedDefaultSettings();
  migrateToManualQueue();
  return db;
}

function migrateToManualQueue() {
  // Eski sürümde campaign_queue otomatik dolduruluyordu. Manuel kuyruğa geçişten
  // sonra bu eski 'pending' kayıtlar mesaj fırlamasına yol açar. Bir kerelik
  // temizlik yapıp settings ile işaretle.
  const flagRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('manual_queue_migrated');
  if (flagRow && flagRow.value === '1') return;
  const info = db.prepare(`DELETE FROM campaign_queue WHERE status = 'pending'`).run();
  if (info.changes > 0) {
    console.log(`[migration] Eski otomatik kuyruktan ${info.changes} bekleyen kayıt temizlendi (manuel kuyruğa geçiş).`);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('manual_queue_migrated', '1');
}

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function migrateLegacyColumns() {
  if (!hasColumn('contacts', 'category')) {
    db.exec(`ALTER TABLE contacts ADD COLUMN category TEXT NOT NULL DEFAULT 'default'`);
  }
  if (!hasColumn('contacts', 'visit_date')) {
    db.exec(`ALTER TABLE contacts ADD COLUMN visit_date TEXT`);
  }
  if (!hasColumn('contacts', 'row_color')) {
    db.exec(`ALTER TABLE contacts ADD COLUMN row_color TEXT`);
  }
  if (!hasColumn('message_templates', 'category')) {
    db.exec(`ALTER TABLE message_templates ADD COLUMN category TEXT NOT NULL DEFAULT 'default'`);
  }
  if (!hasColumn('message_templates', 'template_type')) {
    db.exec(`ALTER TABLE message_templates ADD COLUMN template_type TEXT NOT NULL DEFAULT 'main'`);
  }
  if (!hasColumn('leads', 'response_type')) {
    db.exec(`ALTER TABLE leads ADD COLUMN response_type TEXT DEFAULT 'yes'`);
  }
  if (!hasColumn('leads', 'notes')) {
    db.exec(`ALTER TABLE leads ADD COLUMN notes TEXT DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_category ON contacts(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_visit_date ON contacts(visit_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_templates_category ON message_templates(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_response_type ON leads(response_type)`);
}

const DEFAULT_CATEGORIES = [
  { name: 'default', label: 'Standart' },
  { name: 'unreachable', label: 'Cevap Yok / Ulaşılamayan' },
];

function seedDefaultCategories() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (name, label) VALUES (?, ?)'
  );
  const legacyActiveVideo = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_video_id');
  for (const c of DEFAULT_CATEGORIES) {
    insert.run(c.name, c.label);
  }
  // Eski tek-video kurulumundan kalan video varsa default kategoriye taşı
  if (legacyActiveVideo && legacyActiveVideo.value) {
    const row = db.prepare('SELECT active_video_id FROM categories WHERE name = ?').get('default');
    if (row && !row.active_video_id) {
      db.prepare('UPDATE categories SET active_video_id = ? WHERE name = ?').run(legacyActiveVideo.value, 'default');
    }
  }
}

function seedDefaultSettings() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const tx = db.transaction((rows) => {
    for (const [key, value] of rows) insert.run(key, value);
  });
  tx(Object.entries(DEFAULT_SETTINGS));
}

function getDatabase() {
  if (!db) throw new Error('Veritabanı henüz başlatılmadı');
  return db;
}

function closeDatabase() {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.error('WAL checkpoint hatası:', err);
    }
    db.close();
    db = null;
  }
}

function getSetting(key) {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDatabase()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getAllSettings() {
  const rows = getDatabase().prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function insertContact(name, phone, category = 'default') {
  return getDatabase()
    .prepare('INSERT OR IGNORE INTO contacts (name, phone, category) VALUES (?, ?, ?)')
    .run(name, phone, category || 'default');
}

function insertContactsBulk(rows, category = 'default') {
  const cat = category || 'default';
  const dbi = getDatabase();
  const insertStmt = dbi.prepare(
    'INSERT OR IGNORE INTO contacts (name, phone, category, visit_date, row_color) VALUES (?, ?, ?, ?, ?)'
  );
  const updateDateStmt = dbi.prepare(
    'UPDATE contacts SET visit_date = ? WHERE phone = ? AND ? IS NOT NULL'
  );
  let inserted = 0;
  let skipped  = 0;
  const tx = dbi.transaction((batch) => {
    for (const c of batch) {
      const vd = c.visitDate || null;
      const color = c.rowColor || null;
      const info = insertStmt.run(c.name, c.phone, c.category || cat, vd, color);
      if (info.changes > 0) {
        inserted++;
      } else {
        skipped++;
        if (vd) updateDateStmt.run(vd, c.phone, vd);
      }
    }
  });
  tx(rows);
  return { inserted, skipped };
}

function buildContactFilter({ search, category, visitDateFrom, visitDateTo, color, excludeSent = false, tableAlias = '' } = {}) {
  const params = [];
  const clauses = [];
  const col = (c) => (tableAlias ? `${tableAlias}.${c}` : c);
  if (search && search.trim().length > 0) {
    clauses.push(`(${col('name')} LIKE ? OR ${col('phone')} LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category && category.trim().length > 0) {
    clauses.push(`${col('category')} = ?`);
    params.push(category);
  }
  if (visitDateFrom && visitDateFrom.trim().length > 0) {
    clauses.push(`${col('visit_date')} >= ?`);
    params.push(visitDateFrom);
  }
  if (visitDateTo && visitDateTo.trim().length > 0) {
    clauses.push(`${col('visit_date')} <= ?`);
    params.push(visitDateTo);
  }
  if (color && color.trim().length > 0) {
    if (color === '__none__') {
      clauses.push(`${col('row_color')} IS NULL`);
    } else {
      clauses.push(`${col('row_color')} = ?`);
      params.push(color);
    }
  }
  if (excludeSent) {
    clauses.push(
      `${col('id')} NOT IN (SELECT DISTINCT contact_id FROM send_logs WHERE status = 'sent' AND contact_id IS NOT NULL)`
    );
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function getContacts({ search = '', limit = 50, offset = 0, category = '' } = {}) {
  const { where, params } = buildContactFilter({ search, category });
  return getDatabase()
    .prepare(
      `SELECT id, name, phone, category, imported_at FROM contacts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
}

function countContacts(search = '', category = '', visitDateFrom = '', visitDateTo = '', color = '', excludeSent = false) {
  const { where, params } = buildContactFilter({ search, category, visitDateFrom, visitDateTo, color, excludeSent });
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) as n FROM contacts ${where}`)
    .get(...params);
  return row.n;
}

function getDistinctColors() {
  return getDatabase()
    .prepare('SELECT DISTINCT row_color FROM contacts WHERE row_color IS NOT NULL ORDER BY row_color ASC')
    .all()
    .map((r) => r.row_color);
}

function updateContactCategory(id, category) {
  return getDatabase()
    .prepare('UPDATE contacts SET category = ? WHERE id = ?')
    .run(category || 'default', id);
}

function deleteContact(id) {
  return getDatabase().prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

function deleteAllContacts() {
  return getDatabase().prepare('DELETE FROM contacts').run();
}

function getTemplates(category = null, type = null) {
  const clauses = [];
  const params = [];
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (type) { clauses.push('template_type = ?'); params.push(type); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDatabase()
    .prepare(`SELECT id, content, is_active, category, template_type, created_at FROM message_templates ${where} ORDER BY category ASC, id ASC`)
    .all(...params);
}

function getActiveTemplates(category = 'default', type = 'main') {
  return getDatabase()
    .prepare('SELECT id, content, category, template_type FROM message_templates WHERE is_active = 1 AND category = ? AND template_type = ?')
    .all(category || 'default', type || 'main');
}

function insertTemplate(content, category = 'default', type = 'main') {
  return getDatabase()
    .prepare('INSERT INTO message_templates (content, is_active, category, template_type) VALUES (?, 1, ?, ?)')
    .run(content, category || 'default', type || 'main');
}

function updateTemplate(id, content, isActive) {
  return getDatabase()
    .prepare('UPDATE message_templates SET content = ?, is_active = ? WHERE id = ?')
    .run(content, isActive ? 1 : 0, id);
}

function deleteTemplate(id) {
  return getDatabase().prepare('DELETE FROM message_templates WHERE id = ?').run(id);
}

// Kategoriler
function listCategories() {
  return getDatabase()
    .prepare('SELECT name, label, active_video_id, created_at FROM categories ORDER BY name ASC')
    .all();
}

function getCategory(name) {
  return getDatabase()
    .prepare('SELECT name, label, active_video_id FROM categories WHERE name = ?')
    .get(name);
}

function upsertCategory(name, label) {
  return getDatabase()
    .prepare(
      `INSERT INTO categories (name, label) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET label = excluded.label`
    )
    .run(name, label);
}

function deleteCategory(name) {
  if (name === 'default') {
    throw new Error('Varsayılan kategori silinemez');
  }
  const dbi = getDatabase();
  const tx = dbi.transaction(() => {
    dbi.prepare(`UPDATE contacts SET category = 'default' WHERE category = ?`).run(name);
    dbi.prepare(`UPDATE message_templates SET category = 'default' WHERE category = ?`).run(name);
    dbi.prepare(`DELETE FROM categories WHERE name = ?`).run(name);
  });
  tx();
  return true;
}

function setCategoryActiveVideo(name, videoId) {
  return getDatabase()
    .prepare('UPDATE categories SET active_video_id = ? WHERE name = ?')
    .run(videoId || null, name);
}

// Videolar (DB destekli, çoklu video + kategori başına aktif/pasif)
function listAllVideos() {
  return getDatabase()
    .prepare('SELECT id, filename, category, is_active, created_at FROM videos ORDER BY category ASC, id ASC')
    .all();
}

function getVideoById(id) {
  return getDatabase().prepare('SELECT id, filename, category, is_active FROM videos WHERE id = ?').get(id);
}

function getVideoByFilename(filename) {
  return getDatabase()
    .prepare('SELECT id, filename, category, is_active FROM videos WHERE filename = ?')
    .get(filename);
}

function insertVideo({ filename, category = 'default', isActive = 1 }) {
  return getDatabase()
    .prepare('INSERT OR IGNORE INTO videos (filename, category, is_active) VALUES (?, ?, ?)')
    .run(filename, category || 'default', isActive ? 1 : 0);
}

function updateVideo(id, { category, isActive }) {
  const fields = [];
  const values = [];
  if (category != null) { fields.push('category = ?'); values.push(category); }
  if (isActive != null) { fields.push('is_active = ?'); values.push(isActive ? 1 : 0); }
  if (fields.length === 0) return;
  values.push(id);
  return getDatabase().prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteVideoRow(id) {
  return getDatabase().prepare('DELETE FROM videos WHERE id = ?').run(id);
}

function getActiveVideosForCategory(category) {
  return getDatabase()
    .prepare('SELECT id, filename, category FROM videos WHERE category = ? AND is_active = 1')
    .all(category || 'default');
}

// ===== Kuyruk yönetimi (manuel) =====
// "Bugün Gönderilecekler" = campaign_queue içinde status='pending' satırı olan kişiler.
// Kullanıcı kişinin yanındaki "Bugün Gönder" checkbox'ını işaretleyince INSERT,
// kaldırınca yalnızca pending kayıt silinir (sent/failed geçmiş kalır).

function isContactQueued(contactId) {
  const row = getDatabase()
    .prepare(`SELECT 1 as x FROM campaign_queue WHERE contact_id = ? AND status = 'pending' LIMIT 1`)
    .get(contactId);
  return !!row;
}

function addContactsToQueue(contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) return { added: 0, alreadyQueued: 0 };
  const dbi = getDatabase();
  const exists = dbi.prepare(
    `SELECT 1 as x FROM campaign_queue WHERE contact_id = ? AND status = 'pending' LIMIT 1`
  );
  const ins = dbi.prepare(`INSERT INTO campaign_queue (contact_id, status) VALUES (?, 'pending')`);
  let added = 0;
  let alreadyQueued = 0;
  const tx = dbi.transaction((ids) => {
    for (const id of ids) {
      if (exists.get(id)) {
        alreadyQueued++;
      } else {
        ins.run(id);
        added++;
      }
    }
  });
  tx(contactIds);
  return { added, alreadyQueued };
}

function removeContactsFromQueue(contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) return { removed: 0 };
  const dbi = getDatabase();
  const stmt = dbi.prepare(`DELETE FROM campaign_queue WHERE contact_id = ? AND status = 'pending'`);
  let removed = 0;
  const tx = dbi.transaction((ids) => {
    for (const id of ids) {
      const info = stmt.run(id);
      removed += info.changes;
    }
  });
  tx(contactIds);
  return { removed };
}

function clearPendingQueue() {
  return getDatabase().prepare(`DELETE FROM campaign_queue WHERE status = 'pending'`).run().changes;
}

function addByFilterToQueue({ search = '', category = '', visitDateFrom = '', visitDateTo = '', color = '', excludeSent = false } = {}) {
  const dbi = getDatabase();
  const { where, params } = buildContactFilter({ search, category, visitDateFrom, visitDateTo, color, excludeSent });
  // Filtreye uyan ve kuyrukta zaten pending'i olmayan kişileri ekle
  const sql = `
    INSERT INTO campaign_queue (contact_id, status)
    SELECT c.id, 'pending' FROM contacts c
    ${where}
    ${where ? 'AND' : 'WHERE'} NOT EXISTS (
      SELECT 1 FROM campaign_queue q WHERE q.contact_id = c.id AND q.status = 'pending'
    )
  `;
  const info = dbi.prepare(sql).run(...params);
  return { added: info.changes };
}

function getQueuedContactIds() {
  return getDatabase()
    .prepare(`SELECT DISTINCT contact_id FROM campaign_queue WHERE status = 'pending'`)
    .all()
    .map((r) => r.contact_id);
}

// Geçersiz telefon numaralı kişileri (LID'den yanlış oluşturulmuş eski kayıtlar)
// temizler. Türkiye'de geçerli numara: 10-13 digit, başında 90 veya 5.
// LID'ler 15+ digit ve country code yok.
function deleteInvalidContacts() {
  const dbi = getDatabase();
  // Geçerli sayılacak: +905XXXXXXXXX (12 digit), 90 ile başlayan, ya da 10 digit (5XXX)
  // Geçersiz: 14+ digit veya WhatsApp'taki @lid pseudo-ID'leri (genelde 15-19 digit)
  const all = dbi.prepare('SELECT id, phone FROM contacts').all();
  const toDelete = [];
  for (const c of all) {
    const digits = String(c.phone || '').replace(/[^\d]/g, '');
    // 10-13 digit dışı → geçersiz say
    if (digits.length < 10 || digits.length > 13) {
      toDelete.push(c.id);
      continue;
    }
    // Türkiye için: 905XXXXXXXXX (12) veya 5XXXXXXXXX (10) bekleniyor.
    // Yabancı ülke kodu olabilir ama 14+ digit olmamalı (LID koruma)
    if (digits.length === 13 && !digits.startsWith('90')) {
      // Çok uzun ve TR değil → şüpheli, sil
      toDelete.push(c.id);
    }
  }
  if (toDelete.length === 0) return { removed: 0, details: [] };
  const details = dbi
    .prepare(`SELECT id, name, phone FROM contacts WHERE id IN (${toDelete.map(() => '?').join(',')})`)
    .all(...toDelete);
  const del = dbi.prepare('DELETE FROM contacts WHERE id = ?');
  const tx = dbi.transaction((ids) => {
    for (const id of ids) del.run(id);
  });
  tx(toDelete);
  return { removed: toDelete.length, details };
}

function getContactsPageWithQueue({ search = '', category = '', visitDateFrom = '', visitDateTo = '', color = '', excludeSent = false, limit = 50, offset = 0 } = {}) {
  const dbi = getDatabase();
  const { where, params } = buildContactFilter({ search, category, visitDateFrom, visitDateTo, color, excludeSent, tableAlias: 'c' });
  const rows = dbi
    .prepare(
      `SELECT c.id, c.name, c.phone, c.category, c.visit_date, c.row_color, c.imported_at,
              EXISTS(SELECT 1 FROM campaign_queue q WHERE q.contact_id = c.id AND q.status = 'pending') AS queued
         FROM contacts c
         ${where}
         ORDER BY c.id DESC
         LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return rows;
}

function insertSendLog({ contactId, templateId, status, error = null }) {
  return getDatabase()
    .prepare(
      `INSERT INTO send_logs (contact_id, template_id, status, sent_at, error_message)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`
    )
    .run(contactId, templateId, status, error);
}

function countSentSince(isoTimestamp) {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) as n FROM send_logs WHERE status = 'sent' AND sent_at >= ?`)
    .get(isoTimestamp);
  return row.n;
}

function insertLead({ contactId, responseText, responseType = 'yes' }) {
  const existing = getDatabase()
    .prepare('SELECT id FROM leads WHERE contact_id = ?')
    .get(contactId);
  if (existing) return null;
  return getDatabase()
    .prepare('INSERT INTO leads (contact_id, response_text, response_type) VALUES (?, ?, ?)')
    .run(contactId, responseText, responseType || 'yes');
}

function getLeads({ status = null, responseType = null, orderBy = 'desc' } = {}) {
  const clauses = [];
  const params = [];
  if (status) { clauses.push('l.status = ?'); params.push(status); }
  if (responseType) { clauses.push('l.response_type = ?'); params.push(responseType); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const dir = orderBy === 'asc' ? 'ASC' : 'DESC';
  return getDatabase()
    .prepare(
      `SELECT l.id, l.response_text, l.responded_at, l.status, l.response_type, l.notes, c.name, c.phone, c.category
       FROM leads l JOIN contacts c ON l.contact_id = c.id
       ${where} ORDER BY l.responded_at ${dir}`
    )
    .all(...params);
}

function deleteLead(id) {
  return getDatabase().prepare('DELETE FROM leads WHERE id = ?').run(id);
}

function updateLeadNotes(id, notes) {
  return getDatabase().prepare('UPDATE leads SET notes = ? WHERE id = ?').run(notes, id);
}

function countLeadsSince(isoTimestamp) {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) as n FROM leads WHERE responded_at >= ?`)
    .get(isoTimestamp);
  return row.n;
}

function getTemplateStats() {
  return getDatabase().prepare(`
    SELECT
      t.id,
      t.content,
      t.category,
      COUNT(DISTINCT sl.contact_id) AS sends,
      COUNT(DISTINCT l.contact_id) AS leads
    FROM message_templates t
    LEFT JOIN send_logs sl ON sl.template_id = t.id AND sl.status = 'sent'
    LEFT JOIN leads l ON l.contact_id = sl.contact_id
    WHERE t.type = 'main'
    GROUP BY t.id
    ORDER BY leads DESC, sends DESC
  `).all();
}

function getLeadPipelineCounts() {
  const rows = getDatabase()
    .prepare(`SELECT status, COUNT(*) as n FROM leads GROUP BY status`)
    .all();
  const counts = { new: 0, contacted: 0, visit_planned: 0, offer_given: 0, sold: 0, closed: 0 };
  for (const r of rows) if (r.status in counts) counts[r.status] = r.n;
  return counts;
}

function getDailyStats(days = 14) {
  const dbi = getDatabase();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const sentRows = dbi
    .prepare(`SELECT date(sent_at) as day, COUNT(*) as count FROM send_logs WHERE status='sent' AND sent_at >= ? GROUP BY day ORDER BY day ASC`)
    .all(sinceIso);
  const responseRows = dbi
    .prepare(`SELECT date(responded_at) as day, COUNT(*) as count FROM leads WHERE responded_at >= ? GROUP BY day ORDER BY day ASC`)
    .all(sinceIso);

  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const dayStr = d.toISOString().slice(0, 10);
    result.push({
      day: dayStr,
      sent: sentRows.find((r) => r.day === dayStr)?.count || 0,
      responses: responseRows.find((r) => r.day === dayStr)?.count || 0,
    });
  }
  return result;
}

function updateLeadStatus(id, status) {
  return getDatabase().prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
}

function findContactByPhone(phone) {
  return getDatabase().prepare('SELECT id, name, phone FROM contacts WHERE phone = ?').get(phone);
}

function getRecentLogs(limit = 50) {
  return getDatabase()
    .prepare(
      `SELECT l.id, l.status, l.sent_at, l.error_message, c.name, c.phone
       FROM send_logs l LEFT JOIN contacts c ON l.contact_id = c.id
       ORDER BY l.id DESC LIMIT ?`
    )
    .all(limit);
}

function insertContactResponse({ contactId, responseType, responseText }) {
  return getDatabase()
    .prepare('INSERT INTO contact_responses (contact_id, response_type, response_text) VALUES (?, ?, ?)')
    .run(contactId, responseType, responseText || '');
}

function countResponsesByType(responseType) {
  return getDatabase()
    .prepare(`SELECT COUNT(*) as n FROM contact_responses WHERE response_type = ?`)
    .get(responseType).n;
}

function addRecentlyImportedToQueue(category, since) {
  const info = getDatabase()
    .prepare(`
      INSERT INTO campaign_queue (contact_id, status)
      SELECT c.id, 'pending' FROM contacts c
      WHERE c.category = ? AND c.imported_at >= ?
      AND NOT EXISTS (
        SELECT 1 FROM campaign_queue q WHERE q.contact_id = c.id AND q.status = 'pending'
      )
    `)
    .run(category, since);
  return { added: info.changes };
}

function updateContactVisitDate(id, visitDate) {
  return getDatabase()
    .prepare('UPDATE contacts SET visit_date = ? WHERE id = ?')
    .run(visitDate || null, id);
}

function bulkSetVisitDateByFilter({ search = '', category = '', visitDateFrom = '', visitDateTo = '', color = '', excludeSent = false, newVisitDate = null } = {}) {
  const { where, params } = buildContactFilter({ search, category, visitDateFrom, visitDateTo, color, excludeSent });
  return getDatabase()
    .prepare(`UPDATE contacts SET visit_date = ? ${where}`)
    .run(newVisitDate || null, ...params);
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDatabase,
  getDistinctColors,
  getSetting,
  setSetting,
  getAllSettings,
  insertContact,
  insertContactsBulk,
  getContacts,
  countContacts,
  updateContactCategory,
  deleteContact,
  deleteAllContacts,
  getTemplates,
  getActiveTemplates,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  insertSendLog,
  countSentSince,
  insertLead,
  getLeads,
  deleteLead,
  updateLeadStatus,
  updateLeadNotes,
  countLeadsSince,
  getTemplateStats,
  getLeadPipelineCounts,
  findContactByPhone,
  getRecentLogs,
  listCategories,
  getCategory,
  upsertCategory,
  deleteCategory,
  setCategoryActiveVideo,
  listAllVideos,
  getVideoById,
  getVideoByFilename,
  insertVideo,
  updateVideo,
  deleteVideoRow,
  getActiveVideosForCategory,
  isContactQueued,
  addContactsToQueue,
  removeContactsFromQueue,
  clearPendingQueue,
  addByFilterToQueue,
  getQueuedContactIds,
  getContactsPageWithQueue,
  deleteInvalidContacts,
  insertContactResponse,
  countResponsesByType,
  addRecentlyImportedToQueue,
  updateContactVisitDate,
  bulkSetVisitDateByFilter,
  getDailyStats,
};
