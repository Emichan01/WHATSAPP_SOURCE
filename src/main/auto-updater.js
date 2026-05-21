const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let _send = null;

function send(channel, payload) {
  if (_send) _send(channel, payload);
}

function init(sendFn) {
  _send = sendFn;

  // Sadece paketlenmiş uygulamada çalış
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Güncelleme] Kontrol ediliyor...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Güncelleme] Yeni sürüm mevcut:', info.version);
    send('update:available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Güncelleme] Uygulama güncel.');
  });

  autoUpdater.on('error', (err) => {
    console.error('[Güncelleme] Hata:', err.message);
  });

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Güncelleme] İndirildi:', info.version);
    send('update:downloaded', { version: info.version });
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Güncelleme] Kontrol hatası:', err.message);
  });
}

function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}

module.exports = { init, checkForUpdates, installUpdate };
