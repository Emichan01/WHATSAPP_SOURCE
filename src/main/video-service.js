const fs = require('fs');
const path = require('path');

const { PATHS, APP_LIMITS } = require('./config');
const db = require('./database');

function ensureDir() {
  if (!fs.existsSync(PATHS.VIDEOS_DIR)) {
    fs.mkdirSync(PATHS.VIDEOS_DIR, { recursive: true });
  }
}

// Disk'teki yeni eklenen videoları DB'ye senkronize et + eski "active_video_id"
// ayarından kalan videoları doğru kategoriye taşı.
function syncFromDisk() {
  ensureDir();
  const filesOnDisk = fs
    .readdirSync(PATHS.VIDEOS_DIR)
    .filter((f) => !f.startsWith('.'));
  const known = new Set(db.listAllVideos().map((v) => v.filename));

  // Eski kurulumdan kalan: categories.active_video_id'de geçen dosyalar
  // (Schema'da hâlâ duruyor; varsa onları korumak için kategoriye kaydet.)
  const cats = db.listCategories();
  for (const f of filesOnDisk) {
    if (known.has(f)) continue;
    let category = 'default';
    for (const cat of cats) {
      if (cat.active_video_id === f) {
        category = cat.name;
        break;
      }
    }
    db.insertVideo({ filename: f, category, isActive: 1 });
  }
}

function fileStat(filename) {
  const full = path.join(PATHS.VIDEOS_DIR, filename);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return {
    path: full,
    size: stat.size,
    sizeMb: +(stat.size / (1024 * 1024)).toFixed(2),
    oversized: stat.size > APP_LIMITS.MAX_VIDEO_BYTES,
  };
}

function listVideos() {
  syncFromDisk();
  return db
    .listAllVideos()
    .map((row) => {
      const stat = fileStat(row.filename);
      if (!stat) {
        // Dosya silinmişse DB'den de temizle
        db.deleteVideoRow(row.id);
        return null;
      }
      return {
        id: row.id,
        filename: row.filename,
        category: row.category,
        isActive: !!row.is_active,
        ...stat,
      };
    })
    .filter(Boolean);
}

function importVideo(sourcePath, category = 'default') {
  ensureDir();
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Kaynak video bulunamadı');
  }
  const stat = fs.statSync(sourcePath);
  const original = path.basename(sourcePath);
  const safe = original.replace(/[^\w.\-]+/g, '_');
  let target = path.join(PATHS.VIDEOS_DIR, safe);
  let finalName = safe;
  // Aynı isimden varsa numara ekle
  if (fs.existsSync(target)) {
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let i = 2;
    while (fs.existsSync(path.join(PATHS.VIDEOS_DIR, `${base}_${i}${ext}`))) i++;
    finalName = `${base}_${i}${ext}`;
    target = path.join(PATHS.VIDEOS_DIR, finalName);
  }
  fs.copyFileSync(sourcePath, target);

  const cat = db.getCategory(category) ? category : 'default';
  db.insertVideo({ filename: finalName, category: cat, isActive: 1 });
  const row = db.getVideoByFilename(finalName);

  return {
    id: row?.id,
    filename: finalName,
    category: cat,
    isActive: true,
    size: stat.size,
    sizeMb: +(stat.size / (1024 * 1024)).toFixed(2),
    path: target,
    oversized: stat.size > APP_LIMITS.MAX_VIDEO_BYTES,
  };
}

function updateVideoSettings(id, { category, isActive }) {
  if (category != null && !db.getCategory(category)) {
    throw new Error(`Kategori bulunamadı: ${category}`);
  }
  db.updateVideo(id, { category, isActive });
  return true;
}

function deleteVideo(id) {
  const row = db.getVideoById(id);
  if (!row) return false;
  const target = path.join(PATHS.VIDEOS_DIR, row.filename);
  if (fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch (err) { console.error('video sil hatası:', err); }
  }
  db.deleteVideoRow(id);
  return true;
}

// Scheduler için: bu kategoride aktif olan videolardan rastgele bir tanesini döndür.
// Şablon seçimiyle aynı mantık — ban riskini düşürür.
function pickRandomActiveVideo(category = 'default') {
  const list = db.getActiveVideosForCategory(category);
  if (!list || list.length === 0) return null;
  // Önce dosyası gerçekten var olanları + 16MB altı olanları filtrele
  const usable = list
    .map((row) => {
      const stat = fileStat(row.filename);
      if (!stat) return null;
      return { ...row, ...stat };
    })
    .filter((v) => v && !v.oversized);
  if (usable.length === 0) return null;
  const pick = usable[Math.floor(Math.random() * usable.length)];
  return {
    id: pick.id,
    filename: pick.filename,
    category: pick.category,
    path: pick.path,
    size: pick.size,
    oversized: pick.oversized,
  };
}

// Geriye dönük uyumluluk için — scheduler bu fonksiyonu kullanıyordu
function getActiveVideo(category = 'default') {
  return pickRandomActiveVideo(category);
}

module.exports = {
  listVideos,
  importVideo,
  updateVideoSettings,
  deleteVideo,
  pickRandomActiveVideo,
  getActiveVideo,
};
