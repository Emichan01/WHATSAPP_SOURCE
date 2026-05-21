const XLSX = require('xlsx');

const { APP_LIMITS } = require('./config');
const db = require('./database');
const { normalizePhone } = require('./whatsapp-service');

const NAME_HINTS  = ['ad', 'adi', 'adı', 'isim', 'name', 'müşteri', 'musteri', 'kişi', 'kisi'];
const PHONE_HINTS = ['tel', 'telefon', 'phone', 'gsm', 'mobil', 'numara', 'cep', 'no'];
const DATE_HINTS  = ['tarih', 'date', 'ziyaret', 'visit', 'randevu', 'gelecek', 'gun', 'gün'];

// Excel serial tarih → YYYY-MM-DD (Türkçe DD.MM.YYYY ve ISO desteklenir)
function parseExcelDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    // Excel 1900 epoch: serial 1 = 1 Ocak 1900
    // (25569 = Unix epoch başlangıcı olan 1 Ocak 1970'in Excel seri numarası)
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY veya DD.MM.YYYY veya DD-MM-YYYY
  const tr = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
  if (tr) {
    const [, d, m, y] = tr;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function inspectFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, cellText: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel içinde sayfa bulunamadı');
  }
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (rows.length === 0) {
    throw new Error('Excel boş');
  }
  const firstRow = rows[0].map((c) => String(c).trim());
  const looksLikeHeader = firstRow.some((c) =>
    [...NAME_HINTS, ...PHONE_HINTS].some((h) => c.toLowerCase().includes(h))
  );

  let headers;
  let dataRowsStart;
  if (looksLikeHeader) {
    headers = firstRow;
    dataRowsStart = 1;
  } else {
    headers = firstRow.map((_, i) => `Sütun ${i + 1}`);
    dataRowsStart = 0;
  }

  const guess = guessColumns(headers);
  const sampleRows = rows.slice(dataRowsStart, dataRowsStart + 5).map((r) =>
    headers.map((_, i) => String(r[i] ?? ''))
  );

  return {
    sheetName,
    headers,
    sampleRows,
    rowCount: Math.max(0, rows.length - dataRowsStart),
    suggestedNameIndex: guess.nameIndex,
    suggestedPhoneIndex: guess.phoneIndex,
    suggestedDateIndex: guess.dateIndex,
    hasHeaderRow: looksLikeHeader,
  };
}

function guessColumns(headers) {
  let nameIndex = -1;
  let phoneIndex = -1;
  let dateIndex = -1;
  headers.forEach((h, i) => {
    const lower = String(h).toLowerCase();
    if (nameIndex  === -1 && NAME_HINTS.some((k) => lower.includes(k)))  nameIndex  = i;
    if (phoneIndex === -1 && PHONE_HINTS.some((k) => lower.includes(k))) phoneIndex = i;
    if (dateIndex  === -1 && DATE_HINTS.some((k) => lower.includes(k)))  dateIndex  = i;
  });
  if (phoneIndex === -1 && headers.length >= 2) phoneIndex = 1;
  if (nameIndex  === -1 && headers.length >= 1) nameIndex  = 0;
  return { nameIndex, phoneIndex, dateIndex };
}

// Excel indexed color tablosu (standart 64 renk paleti)
const EXCEL_INDEXED_COLORS = [
  '#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#FF00FF','#00FFFF',
  '#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#FF00FF','#00FFFF',
  '#800000','#008000','#000080','#808000','#800080','#008080','#C0C0C0','#808080',
  '#9999FF','#993366','#FFFFCC','#CCFFFF','#660066','#FF8080','#0066CC','#CCCCFF',
  '#000080','#FF00FF','#FFFF00','#00FFFF','#800080','#800000','#008080','#0000FF',
  '#00CCFF','#CCFFFF','#CCFFCC','#FFFF99','#99CCFF','#FF99CC','#CC99FF','#FFCC99',
  '#3366FF','#33CCCC','#99CC00','#FFCC00','#FF9900','#FF6600','#666699','#969696',
  '#003366','#339966','#003300','#333300','#993300','#993366','#333399','#333333',
];

// Office varsayılan tema renkleri (çoğu Excel dosyası bu temayı kullanır)
const OFFICE_THEME_COLORS = [
  '#FFFFFF','#000000','#E7E6E6','#44546A',
  '#4472C4','#ED7D31','#A9D18E','#FFC000','#5B9BD5','#70AD47',
];

function applyTint(hex, tint) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const blend = (c) => tint < 0
    ? Math.round(c * (1 + tint))
    : Math.round(c + (255 - c) * tint);
  return '#' + [blend(r),blend(g),blend(b)].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');
}

function colorFromFillObj(fill) {
  if (!fill) return null;
  // 1) Doğrudan ARGB hex
  if (fill.rgb) {
    const argb = String(fill.rgb);
    const rgb = argb.length >= 8 ? argb.slice(2) : argb.length === 6 ? argb : null;
    if (rgb) return '#' + rgb.toLowerCase();
  }
  // 2) Indexed renk paleti
  if (fill.indexed != null && fill.indexed >= 0 && fill.indexed < EXCEL_INDEXED_COLORS.length) {
    return EXCEL_INDEXED_COLORS[fill.indexed].toLowerCase();
  }
  // 3) Tema rengi (Office varsayılan teması)
  if (fill.theme != null && fill.theme < OFFICE_THEME_COLORS.length) {
    const base = OFFICE_THEME_COLORS[fill.theme];
    const result = fill.tint ? applyTint(base, fill.tint) : base;
    return result.toLowerCase();
  }
  return null;
}

function isNearWhite(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return r > 240 && g > 240 && b > 240;
}
function isNearBlack(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return r < 15 && g < 15 && b < 15;
}

// Excel hücresinin dolgu rengini döndürür; beyaz/siyah/yok → null
function extractRowColor(sheet, rowIndex, nameColIndex, phoneColIndex) {
  for (const c of [nameColIndex, phoneColIndex]) {
    if (c < 0) continue;
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
    if (!cell || !cell.s) continue;
    // fgColor solid fill için arka plan rengidir
    const color = colorFromFillObj(cell.s.fgColor) || colorFromFillObj(cell.s.bgColor);
    if (!color) continue;
    if (isNearWhite(color) || isNearBlack(color)) continue;
    return color;
  }
  return null;
}

function importContacts({
  filePath,
  nameIndex,
  phoneIndex,
  dateIndex = -1,
  hasHeaderRow = true,
  category = 'default',
  onProgress = () => {},
}) {
  const wb = XLSX.readFile(filePath, { cellStyles: true, cellDates: false, cellText: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const dataStartRow = hasHeaderRow ? range.s.r + 1 : range.s.r;

  const totals = {
    total: Math.max(0, range.e.r - dataStartRow + 1),
    processed: 0,
    inserted: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    withDate: 0,
  };

  let buffer = [];
  const seenInBatch = new Set();
  const CHUNK = APP_LIMITS.EXCEL_CHUNK_SIZE;

  for (let r = dataStartRow; r <= range.e.r; r++) {
    totals.processed++;

    const nameCell  = sheet[XLSX.utils.encode_cell({ r, c: nameIndex })];
    const phoneCell = sheet[XLSX.utils.encode_cell({ r, c: phoneIndex })];

    const rawName  = nameCell  ? String(nameCell.v  ?? '').trim() : '';
    const rawPhone = phoneCell ? String(phoneCell.v ?? '').trim() : '';
    if (!rawName || !rawPhone) { totals.skippedInvalid++; continue; }

    const phone = normalizePhone(rawPhone);
    if (!phone) { totals.skippedInvalid++; continue; }
    if (seenInBatch.has(phone)) { totals.skippedDuplicate++; continue; }
    seenInBatch.add(phone);

    let visitDate = null;
    if (dateIndex >= 0) {
      const dateCell = sheet[XLSX.utils.encode_cell({ r, c: dateIndex })];
      if (dateCell && dateCell.v != null && dateCell.v !== '') {
        visitDate = parseExcelDate(dateCell.v);
        if (visitDate) totals.withDate++;
      }
    }

    const rowColor = extractRowColor(sheet, r, nameIndex, phoneIndex);

    buffer.push({ name: rawName, phone: '+' + phone, category, visitDate, rowColor });

    if (buffer.length >= CHUNK) {
      const res = db.insertContactsBulk(buffer, category);
      totals.inserted += res.inserted;
      totals.skippedDuplicate += res.skipped;
      buffer = [];
      onProgress({ ...totals });
    }
  }

  if (buffer.length > 0) {
    const res = db.insertContactsBulk(buffer, category);
    totals.inserted += res.inserted;
    totals.skippedDuplicate += res.skipped;
  }
  onProgress({ ...totals });
  return totals;
}

// Mevcut kişilerin renklerini Excel'den güncelle (silmeden).
// Telefon numarasıyla eşleşen kişilerin row_color'ını günceller.
function updateColorsFromExcel({ filePath, phoneIndex, nameIndex, hasHeaderRow = true, onProgress = () => {} }) {
  const wb = XLSX.readFile(filePath, { cellStyles: true, cellDates: false, cellText: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const dataStartRow = hasHeaderRow ? range.s.r + 1 : range.s.r;

  const dbi = db.getDatabase();
  const updateStmt = dbi.prepare('UPDATE contacts SET row_color = ? WHERE phone = ?');
  let updated = 0;
  let notFound = 0;
  let noColor = 0;

  const tx = dbi.transaction(() => {
    for (let r = dataStartRow; r <= range.e.r; r++) {
      const phoneCell = sheet[XLSX.utils.encode_cell({ r, c: phoneIndex })];
      const rawPhone = phoneCell ? String(phoneCell.v ?? '').trim() : '';
      if (!rawPhone) continue;
      const phone = normalizePhone(rawPhone);
      if (!phone) continue;
      const stored = '+' + phone;
      const color = extractRowColor(sheet, r, nameIndex, phoneIndex);
      const info = updateStmt.run(color || null, stored);
      if (info.changes > 0) {
        if (color) updated++; else noColor++;
      } else {
        notFound++;
      }
      if ((updated + noColor + notFound) % 1000 === 0) onProgress({ updated, noColor, notFound });
    }
  });
  tx();
  onProgress({ updated, noColor, notFound });
  return { updated, noColor, notFound };
}

module.exports = { inspectFile, importContacts, updateColorsFromExcel };
