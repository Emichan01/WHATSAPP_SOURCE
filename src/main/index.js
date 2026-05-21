const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// userData klasörünü sabitle — dev ve production aynı yere yazsın, veriler kaybolmasın
const FIXED_USER_DATA = path.join(app.getPath('appData'), 'emlak-whatsapp');
if (!fs.existsSync(FIXED_USER_DATA)) {
  fs.mkdirSync(FIXED_USER_DATA, { recursive: true });
}
app.setPath('userData', FIXED_USER_DATA);

// Eski Electron klasöründeki verileri yeni sabit klasöre taşı (bir defaya mahsus)
function migrateLegacyData() {
  const newDataDir = path.join(FIXED_USER_DATA, 'data');
  if (!fs.existsSync(newDataDir)) fs.mkdirSync(newDataDir, { recursive: true });

  const candidates = [
    path.join(app.getPath('appData'), 'Emlak WhatsApp', 'data'),
    path.join(app.getPath('appData'), 'emlak-whatsapp-old', 'data'),
  ];
  for (const legacyDir of candidates) {
    const legacyDb = path.join(legacyDir, 'app.db');
    const newDb = path.join(newDataDir, 'app.db');
    if (fs.existsSync(legacyDb) && !fs.existsSync(newDb)) {
      try {
        fs.copyFileSync(legacyDb, newDb);
        for (const sidecar of ['app.db-wal', 'app.db-shm']) {
          const src = path.join(legacyDir, sidecar);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(newDataDir, sidecar));
        }
        console.log(`Eski veriler taşındı: ${legacyDir} → ${newDataDir}`);
      } catch (err) {
        console.error('Eski veri migrasyon hatası:', err);
      }
    }
  }
}
migrateLegacyData();

const { PATHS } = require('./config');
const { initDatabase, closeDatabase } = require('./database');
const { registerIpcHandlers } = require('./ipc-handlers');
const wa = require('./whatsapp-service');
const scheduler = require('./scheduler');
const updater = require('./auto-updater');

let mainWindow = null;

function ensureDataDirs() {
  for (const dir of [PATHS.DATA_DIR, PATHS.SESSIONS_DIR, PATHS.VIDEOS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wireServiceListeners() {
  wa.setListeners({
    onStatus: (payload) => send('whatsapp:status', payload),
    onQr: (qr) => send('whatsapp:qr', qr),
    onLead: (lead) => {
      send('lead:new', lead);
      const icon = lead.response_type === 'yes' ? '✅' : lead.response_type === 'no' ? '❌' : '📩';
      const label = lead.response_type === 'yes' ? 'EVET' : lead.response_type === 'no' ? 'HAYIR' : 'YANIT';
      send('campaign:log', {
        level: lead.response_type === 'yes' ? 'success' : lead.response_type === 'no' ? 'warn' : 'info',
        message: `${icon} ${label}: ${lead.name || ''} (${lead.phone}) → "${(lead.response_text || '').slice(0, 60)}"`,
        ts: new Date().toISOString(),
      });
    },
  });
  scheduler.setListeners({
    onProgress: (payload) => send('campaign:progress', payload),
    onLog: (entry) => send('campaign:log', entry),
  });

  updater.init((channel, payload) => send(channel, payload));
}

function createMainWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
  if (appIcon && process.platform === 'darwin') app.dock.setIcon(appIcon);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Ekşioğlu Connect',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ensureDataDirs();
  initDatabase();
  wireServiceListeners();
  registerIpcHandlers(() => mainWindow);
  createMainWindow();

  scheduler.startLoop().catch((err) => console.error('Scheduler hatası:', err));

  // Uygulama açıldıktan 10 saniye sonra güncelleme kontrolü
  setTimeout(() => updater.checkForUpdates(), 10_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let cleanupDone = false;
app.on('before-quit', async (event) => {
  if (cleanupDone) return;
  event.preventDefault();
  try {
    if (scheduler.isRunning()) {
      scheduler.stop();
    }
    try {
      await wa.shutdown();
    } catch (err) {
      console.error('WA shutdown hatası:', err);
    }
    try {
      closeDatabase();
    } catch (err) {
      console.error('DB kapatılırken hata:', err);
    }
  } finally {
    cleanupDone = true;
    app.quit();
  }
});

process.on('uncaughtException', (err) => {
  console.error('Yakalanmamış istisna:', err);
});
