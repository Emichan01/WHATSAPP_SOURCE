# WhatsApp Emlak Pazarlama Otomasyonu

## Proje Özeti

Emlak satışı için müşteri listesine WhatsApp üzerinden otomatik kişiselleştirilmiş mesaj + video gönderen masaüstü uygulaması. Excel'den çekilen ~40.000 kişiye, ban yememek için kontrollü hızda gönderim yapar. Mesaj sonunda kullanıcıdan "Evet/Hayır" cevabı bekler, "Evet" diyenleri ayrı bir listede toplar.

## Teknoloji Stack

- **Electron** — Masaüstü uygulama (Windows + Mac + Linux)
- **whatsapp-web.js** — WhatsApp Web otomasyonu (QR ile bağlanır, ücretsiz)
- **SQLite** (better-sqlite3) — Lokal veritabanı
- **xlsx** (SheetJS) — Excel okuma
- **React** veya **Vanilla JS + HTML/CSS** — UI (Claude Code karar versin, basit tutsun)
- **Node.js 18+**

## Klasör Yapısı

```
emlak-whatsapp/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.js             # Uygulama giriş noktası
│   │   ├── whatsapp-service.js  # whatsapp-web.js wrapper
│   │   ├── excel-service.js     # Excel okuma/parse
│   │   ├── database.js          # SQLite işlemleri
│   │   ├── scheduler.js         # Mesaj kuyruğu + rate limiting
│   │   └── ipc-handlers.js      # Renderer ile iletişim
│   ├── renderer/                # UI (frontend)
│   │   ├── index.html
│   │   ├── pages/
│   │   │   ├── dashboard.html
│   │   │   ├── messages.html    # 10 mesaj şablonu yönetimi
│   │   │   ├── video.html       # Video yükleme
│   │   │   ├── contacts.html    # Excel yükleme + kişi listesi
│   │   │   ├── campaign.html    # Gönderim başlat/durdur
│   │   │   └── leads.html       # "Evet" diyenler listesi
│   │   └── assets/
│   └── preload.js
├── data/
│   ├── app.db                   # SQLite veritabanı (gitignore'da)
│   ├── videos/                  # Yüklenmiş videolar
│   └── sessions/                # WhatsApp oturum dosyaları (gitignore'da)
├── CLAUDE.md
├── TASKS.md
├── package.json
└── .gitignore
```

## Veritabanı Şeması (SQLite)

```sql
-- Kişiler (Excel'den import edilir)
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mesaj şablonları (10 tane)
CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,  -- {name} placeholder destekler
  is_active INTEGER DEFAULT 1
);

-- Gönderim geçmişi
CREATE TABLE send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id),
  template_id INTEGER REFERENCES message_templates(id),
  status TEXT,  -- 'sent', 'failed', 'pending'
  sent_at DATETIME,
  error_message TEXT
);

-- "Evet" cevabı verenler (lead'ler)
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id),
  response_text TEXT,
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'new'  -- 'new', 'contacted', 'closed'
);

-- Uygulama ayarları
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## Kritik Kurallar (BAN ÖNLEME)

WhatsApp ban riskini minimize etmek için bu kurallar **kesinlikle** uygulanmalı:

1. **Rastgele gecikme**: Her mesaj arası 30-90 saniye arası rastgele bekleme
2. **Günlük limit**: Maksimum 200-250 mesaj/gün (kullanıcı ayarlayabilir ama bu üst sınır)
3. **Saatlik limit**: Maksimum 30-40 mesaj/saat
4. **Mesai saatleri**: Sadece 09:00-21:00 arası gönderim (kullanıcı ayarlayabilir)
5. **Mesaj çeşitliliği**: 10 şablon arasından rastgele seçim (aynı mesaj art arda gitmesin)
6. **Yeni numara warmup**: İlk gün max 20 mesaj, kademeli artış
7. **Video gönderiminden sonra ekstra bekleme**: 5-10 saniye

## Mesaj Akışı

```
Excel'den kişi al
  ↓
Rastgele şablon seç (10'dan biri)
  ↓
{name} placeholder'ını gerçek isimle değiştir
  ↓
Mesajı gönder
  ↓
5-10 saniye bekle
  ↓
Videoyu gönder
  ↓
"Bilgi almak ister misiniz? Evet/Hayır yazın" mesajı gönder
  ↓
send_logs tablosuna kaydet
  ↓
30-90 saniye rastgele bekle
  ↓
Sonraki kişi
```

## Gelen Cevap Dinleyici

- whatsapp-web.js `message` event'i ile dinle
- Cevap "evet", "Evet", "EVET", "evt", "e" gibi varyasyonları kapsasın (regex: `/^(evet|evt|e|tamam|olur|isterim)$/i`)
- Eşleşirse `leads` tablosuna ekle, UI'da bildirim göster
- "Hayır" cevaplarını da log'la ama lead'e ekleme

## Komutlar

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modu
npm run dev

# Production build (Windows)
npm run build:win

# Production build (Mac)
npm run build:mac
```

## Kod Stil Kuralları

- **Async/await** kullan, callback hell'den kaçın
- Hata yönetimi her async fonksiyonda try/catch ile olmalı
- WhatsApp ve DB işlemlerinde log tut (`console.log` + dosyaya yazma)
- IPC üzerinden geçen mesajlarda her zaman validasyon yap
- Magic number kullanma, sabitleri `src/main/config.js` içinde tanımla
- Kullanıcının erişebileceği tüm metinler Türkçe olsun (UI metinleri)

## Önemli Notlar

- WhatsApp session dosyalarını **asla** git'e commit etme (`.gitignore` zorunlu)
- Excel dosyası 40.000 satır olabilir → streaming/chunked okuma kullan, memory'ye komple yükleme
- Telefon numaralarını normalize et (başında "+90" yoksa ekle, boşluk/tire temizle)
- Video dosya boyutu WhatsApp limiti: 16MB. Bunun üstündeyse uyar.
- Uygulama kapanırken kuyrukta kalan mesajları DB'ye kaydet, yeniden açılınca devam edebilsin

## Geliştirme Sırası

Detaylı task listesi için `TASKS.md` dosyasına bak. Sırayla ilerle, her task biten kısımda test et.
