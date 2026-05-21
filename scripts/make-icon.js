const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHROME_PATH = '/Users/emirhankaya/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const SVG_PATH = '/Users/emirhankaya/Downloads/Adsız tasarım (1).svg';
const OUT_DIR = path.join(__dirname, '../build');
const ICONSET_DIR = path.join(OUT_DIR, 'icon.iconset');

const SIZES = [16, 32, 64, 128, 256, 512, 1024];

async function main() {
  fs.mkdirSync(ICONSET_DIR, { recursive: true });

  const svgContent = fs.readFileSync(SVG_PATH, 'utf8');
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();

  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`
      <!DOCTYPE html>
      <html><head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
        svg { width: ${size}px; height: ${size}px; }
      </style></head>
      <body>${svgContent}</body></html>
    `, { waitUntil: 'load' });

    const buf = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(ICONSET_DIR, `icon_${size}x${size}.png`), buf);
    // @2x is the same file doubled — macOS convention
    if (size <= 512) {
      fs.copyFileSync(
        path.join(ICONSET_DIR, `icon_${size}x${size}.png`),
        path.join(ICONSET_DIR, `icon_${size}x${size}@2x.png`)
      );
    }
    console.log(`✔ ${size}x${size}`);
  }

  await browser.close();

  // 1024x1024 PNG'yi icon.png olarak kopyala (Windows ico için de kullanılır)
  fs.copyFileSync(path.join(ICONSET_DIR, 'icon_1024x1024.png'), path.join(OUT_DIR, 'icon.png'));

  // .icns oluştur (Mac)
  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${path.join(OUT_DIR, 'icon.icns')}"`);
  console.log('✔ icon.icns oluşturuldu');

  // .ico oluştur (Windows) — sips ile 256x256 png, electron-builder gerisi halleder
  execSync(`sips -z 256 256 "${path.join(OUT_DIR, 'icon.png')}" --out "${path.join(OUT_DIR, 'icon-256.png')}"`);
  fs.copyFileSync(path.join(OUT_DIR, 'icon-256.png'), path.join(OUT_DIR, 'icon.ico'));
  console.log('✔ icon.ico oluşturuldu (256x256 PNG tabanlı)');
  fs.unlinkSync(path.join(OUT_DIR, 'icon-256.png'));

  console.log('\nTüm icon dosyaları build/ klasörüne yazıldı.');
}

main().catch(e => { console.error(e); process.exit(1); });
