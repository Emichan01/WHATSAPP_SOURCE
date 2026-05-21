# Geliştirme Görevleri (TASKS.md)

Bu dosya projeyi sıfırdan bitirene kadar adım adım yapılması gereken görevleri içerir. Her ana görev altında alt görevler vardır. Sırayla ilerle ve her görevi bitirdiğinde `[x]` ile işaretle.

---

## FAZ 1: Proje Kurulumu ve Altyapı

### Task 1.1: Electron projesi başlatma
- [x] `package.json` oluştur, Electron + gerekli paketleri ekle
- [x] Temel `src/main/index.js` ile boş bir pencere açan Electron uygulaması yap
- [x] `npm run dev` komutu çalışır hale gelsin
- [x] `.gitignore` dosyasını oluştur (`node_modules/`, `data/sessions/`, `data/app.db`, `data/videos/`, `dist/`)

**Gerekli paketler:**
```
electron, electron-builder, whatsapp-web.js, better-sqlite3,
xlsx, qrcode, qrcode-terminal
```

### Task 1.2: SQLite veritabanı kurulumu
- [x] `src/main/database.js` dosyasını oluştur
- [x] CLAUDE.md'deki şemaya göre tabloları oluşturan migration fonksiyonu yaz
- [x] CRUD helper fonksiyonları yaz (insertContact, getContacts, vb.)
- [x] Uygulama ilk açıldığında DB'yi otomatik oluşturacak şekilde ayarla

### Task 1.3: IPC altyapısı
- [x] `src/main/ipc-handlers.js` oluştur
- [x] `src/preload.js` ile güvenli IPC bridge kur
- [x] Renderer'dan main'e mesaj atma test edilebilir hale gelsin

---

## FAZ 2: WhatsApp Bağlantısı

### Task 2.1: whatsapp-web.js entegrasyonu
- [x] `src/main/whatsapp-service.js` oluştur
- [x] Client başlatma, QR kod gösterme, ready event'i dinleme
- [x] QR kodu renderer'a IPC ile gönder, UI'da göster
- [x] Bağlantı durumu (connected/disconnected) UI'da görünsün
- [x] Session'ı `data/sessions/` altında sakla (LocalAuth strategy)

### Task 2.2: Mesaj gönderme fonksiyonu
- [x] Numara normalizasyonu (Türkiye formatına çevir: `+905xxxxxxxxx`)
- [x] Tek bir test mesajı gönderme fonksiyonu yaz
- [x] Video gönderme fonksiyonu (MessageMedia ile)
- [x] Hata yönetimi: numara WhatsApp'ta yok, ağ hatası, vs.

### Task 2.3: Gelen mesaj dinleyicisi
- [x] `message` event'ini dinle
- [x] "Evet" varyasyonlarını regex ile yakala
- [x] Eşleşen kişiyi `leads` tablosuna kaydet
- [x] Renderer'a yeni lead bildirimi gönder (real-time)

---

## FAZ 3: Excel ve Kişi Yönetimi

### Task 3.1: Excel import
- [x] `src/main/excel-service.js` oluştur
- [x] xlsx ile dosya oku, sütunları algıla (isim, telefon)
- [x] Kullanıcı UI'da hangi sütunun ne olduğunu seçebilsin
- [x] 40.000 satırı chunked olarak DB'ye yaz (her chunk 500 satır)
- [x] Progress bar UI'da göster
- [x] Duplicate numaraları atla, kullanıcıya raporla

### Task 3.2: Kişi listesi UI
- [x] `pages/contacts.html` - kişi listesi tablosu (tek HTML içinde section)
- [x] Arama/filtreleme (isim veya numara ile)
- [x] Sayfalama (40.000 kişi için zorunlu, sayfa başı 50 kişi)
- [x] Tekli/toplu silme

---

## FAZ 4: Mesaj ve Video Yönetimi

### Task 4.1: Tek mesaj editörü
- [x] `pages/messages.html` - **tek sabit mesaj** editörü (kampanya kavramı yok, hep aynı mesaj gider)
- [x] `{name}` placeholder kullanım açıklaması göster
- [x] DB'ye kaydet (settings.message_content)
- [x] Önizleme: gerçek bir isimle nasıl görüneceğini göster

### Task 4.2: Video yükleme
- [x] `pages/video.html` - dosya seçici
- [x] Seçilen videoyu `data/videos/` altına kopyala
- [x] 16MB üzeri dosyalar için uyarı ver
- [x] Birden fazla video yüklenebilsin, hangisinin aktif olduğu seçilebilsin
- [x] Video listesi UI

---

## FAZ 5: Otomatik Gönderim Motoru (EN KRİTİK)

### Task 5.1: Scheduler — kampanya kavramı YOK, sürekli otomatik
- [x] `src/main/scheduler.js` oluştur
- [x] WhatsApp bağlı + mesaj var + video var + bekleyen kişi varsa otomatik gönderir
- [x] Her kişi için: sabit mesaj gönder → bekle → video gönder → "Evet/Hayır" mesajı gönder
- [x] **Rate limiting kuralları** (CLAUDE.md'deki kurallar):
  - 30-90 saniye rastgele gecikme (mesajlar arası)
  - Günlük max limit kontrolü (varsayılan 200)
  - Saatlik max limit kontrolü (varsayılan 30)
  - Mesai saatleri kontrolü (varsayılan 09-21)
- [x] Her başarılı/başarısız gönderim `send_logs`'a kaydedilsin
- [x] Renderer'a canlı progress + log akışı (Gösterge Paneli'nde gösterilecek)

### Task 5.2: Ayarlar sayfası
- [x] `pages/settings.html` - rate limit & mesai saati ayarları (opsiyonel ince ayar)
- [x] Varsayılanlar zaten DB'de; kullanıcı değiştirebilsin

### Task 5.3: Devam edebilirlik
- [x] Uygulama kapatılırsa kuyruk durumu DB'de (campaign_queue) zaten kalır
- [x] Yeniden açıldığında kaldığı yerden devam etsin (scheduler döngüsü `app.whenReady` ile otomatik başlar; `campaign_queue` durumu kalıcı)
- [x] Crash recovery (sent/failed olarak işaretlenmemiş `pending` kayıtlar tekrar denenebilir)

---

## FAZ 6: Lead Yönetimi

### Task 6.1: "Evet" diyenler listesi
- [x] `pages/leads.html` - lead tablosu
- [x] İsim, numara, cevap zamanı, cevap metni göster
- [x] WhatsApp'ta direkt sohbete git butonu (link: `https://wa.me/+90...`)
- [x] Lead durumu güncelleme (yeni, iletişimde, kapandı)
- [x] Yeni lead geldiğinde sistem bildirimi (Electron Notification)
- [x] Lead'leri Excel'e export et

---

## FAZ 7: Dashboard ve İstatistikler

### Task 7.1: Ana dashboard
- [x] `pages/dashboard.html`
- [x] Bugün/bu hafta/bu ay gönderilen mesaj sayısı
- [x] Toplam lead sayısı, dönüşüm oranı
- [x] WhatsApp bağlantı durumu
- [x] **Anlık gönderim durumu** (kalan kişi, sonraki gönderim ne zaman)
- [x] Son aktivite logu (canlı)

---

## FAZ 8: Test ve Build

### Task 8.1: Manuel test senaryoları
- [ ] 5 kişilik küçük bir Excel ile uçtan uca test (kullanıcı yapacak)
- [ ] Rate limit'lerin doğru çalıştığını kontrol et (kullanıcı yapacak)
- [ ] Cevap dinleyicinin çalıştığını test et (kullanıcı yapacak)
- [ ] Uygulamayı kapatıp açarak persistence testi (kullanıcı yapacak)

### Task 8.2: Production build
- [x] electron-builder konfigürasyonu (package.json `build` bölümünde)
- [x] Windows için `.exe` installer (`npm run build:win` — NSIS)
- [x] Mac için `.dmg` (`npm run build:mac`)
- [ ] Uygulama ikonu (ikon dosyası eklenmedi; istersen ekleyebilirsin `build/icon.icns`)

---

---

## FAZ 9: Kategori sistemi + Lead detection iyileştirme (2026-05-11)

### Task 9.1: Kişi kategorileri
- [x] `categories` tablosu eklendi (name, label, active_video_id)
- [x] `contacts.category` ve `message_templates.category` kolonları eklendi (legacy migration ile)
- [x] Default kategoriler seed edildi: `default` (Standart), `unreachable` (Cevap Yok / Ulaşılamayan)
- [x] Eski tek-aktif-video ayarı default kategoriye otomatik taşındı
- [x] Kişiler/Mesajlar/Video sayfalarında kategori UI'sı

### Task 9.2: Excel import kategorisi
- [x] Excel import sırasında hedef kategori seçilebilir
- [x] Manuel kişi ekleme formunda kategori seçimi var
- [x] Kişi listesinde kategori filtre + inline kategori değiştirme

### Task 9.3: Lead detection iyileştirme
- [x] `message` + `message_create` event'leri birlikte dinleniyor (whatsapp-web.js bazı sürümlerde `message` sessizce kaçabiliyor)
- [x] Türkçe normalize edici (i/ı, ğ, ş, ü vb. + noktalama temizliği)
- [x] Genişletilmiş "Evet" anahtar kelimeleri + uzatılmış formlar (evettt, tamamm, vb.)
- [x] Her gelen mesaj canlı log'a düşüyor (kullanıcı doğrulayabilsin diye)
- [x] Bilinmeyen numaradan gelen "Evet" cevabı otomatik kişi olarak kaydedilir, lead listesine eklenir

### Task 9.4: Scheduler iyileştirme
- [x] Scheduler her kişi için kişinin kategorisinden şablon + video seçer
- [x] "Bekleyen kişi yok" log spam'i azaltıldı (60sn poll + aynı sebep tekrarlanmaz)

---

## YAPILMAMASI GEREKENLER

- ❌ Aynı anda toplu mesaj gönderme (ban garantili)
- ❌ Rate limit'leri bypass eden seçenekler ekleme
- ❌ Session dosyalarını veya numaraları log'larda açık göstermek
- ❌ Gizli/encrypted iletişim iddiası (kullanıcıya yanlış güvenlik hissi vermek)
- ❌ Cevap olmayan numaralara tekrar tekrar mesaj atma (spam)

## BAŞLANGIÇ İÇİN İLK ADIM

`Task 1.1` ile başla. Her fazı bitirdikten sonra kullanıcıya test etmesi için fırsat ver, sonraki faza geç.
