// ---------- Kategori durumu (global) ----------
let categoriesCache = [];

async function refreshCategoriesCache() {
  try {
    categoriesCache = await window.api.categories.list();
  } catch (err) {
    console.error('kategori yükleme hatası', err);
    categoriesCache = [
      { name: 'default', label: 'Standart' },
      { name: 'unreachable', label: 'Cevap Yok / Ulaşılamayan' },
    ];
  }
  populateCategorySelects();
}

function categoryLabel(name) {
  const found = categoriesCache.find((c) => c.name === name);
  return found?.label || name || 'default';
}

function populateCategorySelects() {
  const filterIds = new Set(['contactCategoryFilter', 'videoCategoryFilter']);
  const selectIds = ['manualCategory', 'excelCategory', 'contactCategoryFilter', 'videoUploadCategory', 'videoCategoryFilter'];
  selectIds.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const isFilter = filterIds.has(id);
    sel.innerHTML = '';
    if (isFilter) {
      sel.appendChild(new Option('Tüm kategoriler', ''));
    }
    categoriesCache.forEach((c) => sel.appendChild(new Option(c.label, c.name)));
    if (current && [...sel.options].some((o) => o.value === current)) {
      sel.value = current;
    } else if (!isFilter) {
      sel.value = 'default';
    }
  });
  renderMessageCategoryTabs();
  renderCategoryManagement();
}

// ---------- Navigation ----------
const navButtons = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const pageInitOnce = new Set();

function showPage(name) {
  navButtons.forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  pages.forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
  if (!pageInitOnce.has(name)) {
    pageInitOnce.add(name);
    if (pageInitiators[name]) pageInitiators[name]();
  }
  if (pageRefreshers[name]) pageRefreshers[name]();
}

navButtons.forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));

// ---------- Status / WhatsApp realtime ----------
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const qrImage = document.getElementById('qrImage');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const waStatusSpan = document.getElementById('waStatus');

const STATUS_TR = {
  idle: 'bağlanmadı',
  initializing: 'başlatılıyor',
  qr: 'QR bekleniyor',
  authenticated: 'kimlik doğrulandı — yükleniyor…',
  loading: 'yükleniyor',
  ready: 'bağlandı',
  disconnected: 'bağlantı koptu',
  auth_failure: 'kimlik doğrulama hatası',
  error: 'hata',
};

function setStatusUI(payload) {
  const s = payload?.status || 'idle';
  const isLoading = s === 'loading';
  const label = isLoading
    ? `yükleniyor %${payload.percent ?? '?'} — ${payload.message || ''}`
    : (STATUS_TR[s] || s);
  statusText.textContent = `WhatsApp: ${label}`;
  waStatusSpan.textContent = label;
  statusDot.classList.remove('connected', 'disconnected', 'waiting');
  if (s === 'ready') statusDot.classList.add('connected');
  else if (['qr', 'initializing', 'authenticated', 'loading'].includes(s)) statusDot.classList.add('waiting');
  else if (['disconnected', 'error', 'auth_failure'].includes(s)) statusDot.classList.add('disconnected');

  if (s !== 'qr' && s !== 'initializing') {
    qrImage.style.display = 'none';
    if (s === 'ready') qrPlaceholder.textContent = 'Bağlandı ✓';
    else if (isLoading) qrPlaceholder.textContent = `Yükleniyor %${payload.percent ?? '?'}…`;
    else if (s === 'authenticated') qrPlaceholder.textContent = 'Kimlik doğrulandı, WhatsApp Web yükleniyor…';
    else qrPlaceholder.textContent = 'QR bekleniyor…';
  }
}

window.api.on('whatsapp:status', setStatusUI);
window.api.on('whatsapp:qr', (dataUrl) => {
  qrImage.src = dataUrl;
  qrImage.style.display = 'block';
  qrPlaceholder.textContent = '';
});

// ---------- WhatsApp page actions ----------
document.getElementById('waStartBtn').addEventListener('click', async () => {
  await window.api.whatsapp.start();
});
document.getElementById('waLogoutBtn').addEventListener('click', async () => {
  if (!confirm('WhatsApp oturumunu kapatmak istiyor musunuz?')) return;
  await window.api.whatsapp.logout();
});

// ---------- Dashboard Chart ----------
function renderDashboardChart(data) {
  const container = document.getElementById('dashboardChart');
  if (!container || !data || data.length === 0) return;
  const W = container.clientWidth || 760;
  const H = 140;
  const padL = 32, padR = 8, padT = 10, padB = 34;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const maxVal = Math.max(...data.map((d) => Math.max(d.sent, d.responses)), 1);
  const yMax = Math.max(Math.ceil(maxVal * 1.25), 5);
  const slotW = cW / data.length;
  const barW = Math.max(3, Math.floor(slotW * 0.28));
  const lines = [], bars = [], xlabels = [], ylabels = [];
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(yMax * i / 4);
    const y = padT + cH - (i * cH / 4);
    lines.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#f3f4f6" stroke-width="1"/>`);
    ylabels.push(`<text x="${padL - 4}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#d1d5db">${v}</text>`);
  }
  lines.push(`<line x1="${padL}" y1="${(padT + cH).toFixed(1)}" x2="${W - padR}" y2="${(padT + cH).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`);
  data.forEach((d, i) => {
    const cx = padL + i * slotW + slotW / 2;
    const bx1 = cx - barW - 1;
    if (d.sent > 0) {
      const bh = (d.sent / yMax) * cH;
      bars.push(`<rect x="${bx1.toFixed(1)}" y="${(padT + cH - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="2" fill="#c41414"/>`);
    }
    if (d.responses > 0) {
      const bh = (d.responses / yMax) * cH;
      bars.push(`<rect x="${(cx + 1).toFixed(1)}" y="${(padT + cH - bh).toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="2" fill="#3b82f6"/>`);
    }
    if (i % 2 === 0 || data.length <= 7) {
      const parts = d.day.split('-');
      xlabels.push(`<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#d1d5db">${parts[2]}/${parts[1]}</text>`);
    }
  });
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">${lines.join('')}${bars.join('')}${ylabels.join('')}${xlabels.join('')}</svg>`;
}

let lastChartFetch = 0;
async function fetchAndRenderChart() {
  try {
    const data = await window.api.dashboard.chartData();
    renderDashboardChart(data);
    lastChartFetch = Date.now();
  } catch (err) {
    console.error('chart data hatası', err);
  }
}

// ---------- Dashboard ----------
async function refreshDashboard() {
  try {
    const s = await window.api.dashboard.stats();
    setText('statContacts', s.totalContacts);
    setText('statToday', s.sentToday);
    setText('statWeek', s.sentWeek);
    setText('statMonth', s.sentMonth);
    setText('statLeads', s.totalLeads);
    setText('statConv', `${s.conversionRate}%`);
    setText('statNoResp', s.totalNoResponses ?? 0);
    setText('statRespRate', `${s.responseRate ?? 0}%`);
    setText('statFailed', s.totalFailed);
    setText('statSentAll', s.totalSent);

    setText('schedRunning', s.scheduler.running ? 'Aktif (otomatik)' : 'Beklemede');
    setText('schedPending', s.scheduler.pending);
    setText('schedHour', s.scheduler.sentLastHour);
    if (s.scheduler.nextSendTimestamp) {
      const secs = Math.max(0, Math.round((s.scheduler.nextSendTimestamp - Date.now()) / 1000));
      setText('schedNext', `~${secs} saniye sonra`);
    } else {
      setText('schedNext', '—');
    }

    setStatusUI(s.whatsapp);
  } catch (err) {
    console.error('dashboard refresh', err);
  }
}

setInterval(refreshDashboard, 3000);
setInterval(() => {
  if (document.getElementById('page-dashboard')?.classList.contains('active')) {
    fetchAndRenderChart();
  }
}, 60000);
refreshDashboard();

(async () => {
  try {
    const p = await window.api.dataPath();
    const label = document.getElementById('dataPathLabel');
    if (label) label.textContent = p;
  } catch (_) {}
})();

const openDataBtn = document.getElementById('openDataFolderBtn');
if (openDataBtn) {
  openDataBtn.addEventListener('click', () => window.api.openDataFolder());
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v ?? 0;
}

// Live log
const liveLog = document.getElementById('liveLog');
function appendLog(entry) {
  const line = document.createElement('div');
  line.classList.add('log-entry', entry.level || 'info');
  const t = new Date(entry.ts || Date.now()).toLocaleTimeString();
  line.textContent = `[${t}] ${entry.message}`;
  liveLog.appendChild(line);
  while (liveLog.childElementCount > 200) liveLog.removeChild(liveLog.firstChild);
  liveLog.scrollTop = liveLog.scrollHeight;
}
window.api.on('campaign:log', appendLog);
window.api.on('campaign:progress', () => {
  refreshDashboard();
  refreshQueueStatus();
});

// ---------- Contacts ----------
let contactPage = 0;
const PAGE_SIZE = 50;
let activeColorFilter = '';

function getDateRangeFilter() {
  return {
    visitDateFrom: document.getElementById('visitDateFrom')?.value || '',
    visitDateTo:   document.getElementById('visitDateTo')?.value   || '',
  };
}

async function refreshColorSwatches() {
  const colors = await window.api.contacts.distinctColors();
  const panel = document.getElementById('colorFilterPanel');
  const container = document.getElementById('colorSwatches');
  const clearBtn = document.getElementById('colorFilterClearBtn');
  if (!panel || !container) return;

  if (!colors || colors.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  container.innerHTML = '';

  for (const hex of colors) {
    const btn = document.createElement('button');
    btn.title = hex;
    btn.dataset.color = hex;
    btn.style.cssText = `
      width:22px; height:22px; border-radius:50%; border:2px solid transparent;
      background:${hex}; cursor:pointer; padding:0; flex-shrink:0;
      box-shadow:0 1px 3px rgba(0,0,0,.25);
      transition:transform .1s, border-color .1s;
    `;
    if (activeColorFilter === hex) {
      btn.style.borderColor = '#fff';
      btn.style.transform = 'scale(1.25)';
      btn.style.outline = '2px solid ' + hex;
    }
    btn.addEventListener('click', () => {
      activeColorFilter = (activeColorFilter === hex) ? '' : hex;
      contactPage = 0;
      refreshColorSwatches();
      refreshContacts();
    });
    container.appendChild(btn);
  }

  // "Renk yok" butonu
  const noneBtn = document.createElement('button');
  noneBtn.title = 'Renk atanmamış';
  noneBtn.dataset.color = '__none__';
  noneBtn.style.cssText = `
    width:22px; height:22px; border-radius:50%; border:2px solid var(--border);
    background: repeating-linear-gradient(45deg,#ccc 0,#ccc 2px,#fff 2px,#fff 6px);
    cursor:pointer; padding:0; flex-shrink:0;
    box-shadow:0 1px 3px rgba(0,0,0,.15);
    transition:transform .1s, border-color .1s;
  `;
  if (activeColorFilter === '__none__') {
    noneBtn.style.borderColor = '#6366f1';
    noneBtn.style.transform = 'scale(1.25)';
  }
  noneBtn.addEventListener('click', () => {
    activeColorFilter = (activeColorFilter === '__none__') ? '' : '__none__';
    contactPage = 0;
    refreshColorSwatches();
    refreshContacts();
  });
  container.appendChild(noneBtn);

  if (clearBtn) {
    if (activeColorFilter) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
}

document.getElementById('colorFilterClearBtn')?.addEventListener('click', () => {
  activeColorFilter = '';
  contactPage = 0;
  refreshColorSwatches();
  refreshContacts();
});

function getExcludeSent() {
  return !!(document.getElementById('excludeSentFilter')?.checked);
}

async function refreshContacts() {
  const search      = document.getElementById('contactSearch').value;
  const category    = document.getElementById('contactCategoryFilter')?.value || '';
  const excludeSent = getExcludeSent();
  const res = await window.api.contacts.list({
    search,
    category,
    color: activeColorFilter,
    excludeSent,
    ...getDateRangeFilter(),
    limit: PAGE_SIZE,
    offset: contactPage * PAGE_SIZE,
  });
  setText('contactCount', res.total);
  const tbody = document.getElementById('contactRows');
  tbody.innerHTML = '';
  for (const c of res.rows) {
    const cat = c.category || 'default';
    const isQueued = !!c.queued;
    const tr = document.createElement('tr');
    if (isQueued) tr.classList.add('queued-row');
    const catOptions = categoriesCache
      .map((opt) => `<option value="${opt.name}" ${opt.name === cat ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`)
      .join('');
    const vd = c.visit_date || '';
    const colorDot = c.row_color
      ? `<span title="${escapeHtml(c.row_color)}" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${escapeHtml(c.row_color)};box-shadow:0 1px 2px rgba(0,0,0,.3);cursor:pointer;" data-colorclick="${escapeHtml(c.row_color)}"></span>`
      : `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:transparent;border:1px dashed var(--border);"></span>`;
    tr.innerHTML = `
      <td>
        <label class="switch">
          <input type="checkbox" data-queue="${c.id}" ${isQueued ? 'checked' : ''} />
        </label>
      </td>
      <td style="text-align:center;">${colorDot}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>
        <select data-catfor="${c.id}" class="cat-select">${catOptions}</select>
      </td>
      <td>
        <input type="date" class="date-input" data-vdate="${c.id}" value="${escapeHtml(vd)}" />
      </td>
      <td>${new Date(c.imported_at).toLocaleDateString()}</td>
      <td><button class="ghost-danger" data-del="${c.id}">Sil</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('[data-colorclick]').forEach((dot) => {
    dot.addEventListener('click', () => {
      const hex = dot.dataset.colorclick;
      activeColorFilter = (activeColorFilter === hex) ? '' : hex;
      contactPage = 0;
      refreshColorSwatches();
      refreshContacts();
    });
  });
  tbody.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.contacts.delete(Number(btn.dataset.del));
      refreshContacts();
      refreshQueueStatus();
    });
  });
  tbody.querySelectorAll('select[data-catfor]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await window.api.contacts.updateCategory(Number(sel.dataset.catfor), sel.value);
    });
  });
  tbody.querySelectorAll('input[data-vdate]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      await window.api.contacts.updateVisitDate(Number(inp.dataset.vdate), inp.value || null);
    });
  });
  tbody.querySelectorAll('input[data-queue]').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const id = Number(chk.dataset.queue);
      if (chk.checked) {
        await window.api.queue.add([id]);
      } else {
        await window.api.queue.remove([id]);
      }
      chk.closest('tr')?.classList.toggle('queued-row', chk.checked);
      refreshQueueStatus();
    });
  });
  const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
  setText('contactPageInfo', `Sayfa ${contactPage + 1} / ${pages}`);
}

async function refreshQueueStatus() {
  try {
    const s = await window.api.queue.status();
    const badge = document.getElementById('queueCountBadge');
    if (badge) badge.textContent = s.pending;
  } catch (_) {}
}

document.getElementById('contactSearch').addEventListener('input', debounce(() => {
  contactPage = 0;
  refreshContacts();
}, 250));

document.getElementById('contactPrev').addEventListener('click', () => {
  if (contactPage > 0) { contactPage--; refreshContacts(); }
});
document.getElementById('contactNext').addEventListener('click', () => {
  contactPage++;
  refreshContacts();
});
document.getElementById('contactDeleteAllBtn').addEventListener('click', async () => {
  if (!confirm('TÜM kişileri silmek istediğinize emin misiniz?')) return;
  await window.api.contacts.deleteAll();
  contactPage = 0;
  refreshContacts();
  refreshQueueStatus();
});

document.getElementById('contactCleanInvalidBtn')?.addEventListener('click', async () => {
  if (!confirm('Geçersiz / LID kaynaklı numaraları silmek istiyor musunuz?\n\n(WhatsApp\'taki "@lid" maskeli ID\'lerden yanlış oluşturulmuş kayıtlar — örn. 14+ haneli numara veya Türkiye olmayan 13 haneliler.)')) return;
  const res = await window.api.contacts.cleanInvalid();
  if (res.removed === 0) {
    alert('Temizlenecek geçersiz numara bulunamadı ✓');
  } else {
    const list = (res.details || []).map((d) => `• ${d.name} (${d.phone})`).join('\n');
    alert(`${res.removed} geçersiz kayıt silindi:\n\n${list}`);
  }
  refreshContacts();
  refreshQueueStatus();
});

document.getElementById('manualAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('manualName');
  const phoneInput = document.getElementById('manualPhone');
  const statusEl = document.getElementById('manualAddStatus');
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const cat = document.getElementById('manualCategory').value || 'default';
  if (!name || !phone) return;

  const res = await window.api.contacts.add(name, phone, cat);
  if (res?.error) {
    statusEl.textContent = `Hata: ${res.error}`;
    statusEl.style.color = '#b91c1c';
    return;
  }
  statusEl.textContent = `Eklendi: ${res.name} (${res.phone}) → ${categoryLabel(res.category)}`;
  statusEl.style.color = '#15803d';
  nameInput.value = '';
  phoneInput.value = '';
  nameInput.focus();
  contactPage = 0;
  refreshContacts();
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

document.getElementById('contactCategoryFilter')?.addEventListener('change', () => {
  contactPage = 0;
  refreshContacts();
});

document.getElementById('excludeSentFilter')?.addEventListener('change', () => {
  contactPage = 0;
  refreshContacts();
});

// Tarih aralığı filtreleri değişince liste yenilensin
['visitDateFrom', 'visitDateTo'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', () => {
    contactPage = 0;
    refreshContacts();
  });
});

// Hızlı preset yardımcıları
function toIso(d) { return d.toISOString().slice(0, 10); }

function setDateRange(from, to) {
  const f = document.getElementById('visitDateFrom');
  const t = document.getElementById('visitDateTo');
  if (f) f.value = from;
  if (t) t.value = to;
  contactPage = 0;
  refreshContacts();
}

document.getElementById('presetToday')?.addEventListener('click', () => {
  const today = toIso(new Date());
  setDateRange(today, today);
});

document.getElementById('presetWeekend')?.addEventListener('click', () => {
  const now = new Date();
  const day = now.getDay(); // 0=Paz, 6=Cmt
  const diffToSat = (6 - day + 7) % 7 || 7; // bu hafta sonu cumartesi
  const sat = new Date(now); sat.setDate(now.getDate() + diffToSat);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  setDateRange(toIso(sat), toIso(sun));
});

document.getElementById('presetThisWeek')?.addEventListener('click', () => {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = (day + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - diffToMon);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  setDateRange(toIso(mon), toIso(sun));
});

document.getElementById('presetClearDate')?.addEventListener('click', () => {
  setDateRange('', '');
});

// Toplu tarih ata (filtredeki kişilerin hepsine yeni tarih yaz)
document.getElementById('bulkSetDateBtn')?.addEventListener('click', async () => {
  const newVisitDate = document.getElementById('bulkVisitDate')?.value;
  if (!newVisitDate) { alert('Lütfen atanacak tarihi seçin'); return; }
  const search   = document.getElementById('contactSearch').value;
  const category = document.getElementById('contactCategoryFilter')?.value || '';
  const { visitDateFrom, visitDateTo } = getDateRangeFilter();
  const rangeHint = visitDateFrom || visitDateTo
    ? ` (${visitDateFrom || '?'} — ${visitDateTo || '?'} aralığındaki)`
    : '';
  if (!confirm(`Filtredeki${rangeHint} tüm kişilere ziyaret tarihi "${newVisitDate}" atansın mı?`)) return;
  await window.api.contacts.bulkSetVisitDate({ search, category, visitDateFrom, visitDateTo, color: activeColorFilter, excludeSent: getExcludeSent(), newVisitDate });
  refreshContacts();
});

// Filtredeki kişilerin tarihlerini temizle
document.getElementById('bulkClearDateBtn')?.addEventListener('click', async () => {
  const search   = document.getElementById('contactSearch').value;
  const category = document.getElementById('contactCategoryFilter')?.value || '';
  const { visitDateFrom, visitDateTo } = getDateRangeFilter();
  if (!confirm('Filtredeki kişilerin ziyaret tarihleri temizlensin mi?')) return;
  await window.api.contacts.bulkSetVisitDate({ search, category, visitDateFrom, visitDateTo, color: activeColorFilter, excludeSent: getExcludeSent(), newVisitDate: null });
  refreshContacts();
});

// Filtredeki tarihe göre tüm kişileri sıraya ekle
document.getElementById('queueByDateBtn')?.addEventListener('click', async () => {
  const { visitDateFrom, visitDateTo } = getDateRangeFilter();
  const search   = document.getElementById('contactSearch').value;
  const category = document.getElementById('contactCategoryFilter')?.value || '';
  if (!visitDateFrom && !visitDateTo) {
    alert('Önce tarih başlangıç veya bitiş girin ya da bir preset seçin');
    return;
  }
  const label = visitDateFrom && visitDateTo
    ? `${visitDateFrom} — ${visitDateTo}`
    : (visitDateFrom || visitDateTo);
  if (!confirm(`"${label}" tarih aralığındaki tüm kişiler sıraya eklensin mi?`)) return;
  const res = await window.api.queue.addByFilter({ search, category, visitDateFrom, visitDateTo, color: activeColorFilter, excludeSent: getExcludeSent() });
  alert(`${res.added} kişi sıraya eklendi`);
  refreshContacts();
  refreshQueueStatus();
});

document.getElementById('queueAddFilterBtn')?.addEventListener('click', async () => {
  const search   = document.getElementById('contactSearch').value;
  const category = document.getElementById('contactCategoryFilter')?.value || '';
  const { visitDateFrom, visitDateTo } = getDateRangeFilter();
  if (!confirm(`Mevcut filtreye uyan tüm kişiler "Bugün Gönder" sırasına eklensin mi?`)) return;
  const res = await window.api.queue.addByFilter({ search, category, visitDateFrom, visitDateTo, color: activeColorFilter, excludeSent: getExcludeSent() });
  alert(`${res.added} kişi sıraya eklendi`);
  refreshContacts();
  refreshQueueStatus();
});

document.getElementById('queueClearBtn')?.addEventListener('click', async () => {
  if (!confirm('"Bugün Gönder" sırasındaki tüm kişiler kaldırılsın mı? (Kişiler silinmez, sadece sıradan çıkar.)')) return;
  const res = await window.api.queue.clear();
  alert(`${res.removed} kişi sıradan kaldırıldı`);
  refreshContacts();
  refreshQueueStatus();
});

// ---------- Excel ----------
let excelFilePath = null;

document.getElementById('excelPickBtn').addEventListener('click', async () => {
  const res = await window.api.excel.pick();
  if (!res) return;
  if (res.error) { alert(`Hata: ${res.error}`); return; }
  excelFilePath = res.filePath;
  document.getElementById('excelFileLabel').textContent =
    `${res.filePath.split('/').pop()} (${res.rowCount} satır)`;

  const nameSel  = document.getElementById('nameColumn');
  const phoneSel = document.getElementById('phoneColumn');
  const dateSel  = document.getElementById('dateColumn');
  nameSel.innerHTML  = '';
  phoneSel.innerHTML = '';
  // Tarih için "yok" seçeneği başta kalır, sütunlar sonra eklenir
  dateSel.innerHTML  = '<option value="-1">— Tarih yok —</option>';
  res.headers.forEach((h, i) => {
    nameSel.appendChild(new Option(h, i));
    phoneSel.appendChild(new Option(h, i));
    dateSel.appendChild(new Option(h, i));
  });
  if (res.suggestedNameIndex  >= 0) nameSel.value  = res.suggestedNameIndex;
  if (res.suggestedPhoneIndex >= 0) phoneSel.value = res.suggestedPhoneIndex;
  if (res.suggestedDateIndex  >= 0) dateSel.value  = res.suggestedDateIndex;
  document.getElementById('hasHeaderRow').checked = res.hasHeaderRow;

  const sample = document.getElementById('excelSample');
  sample.innerHTML = '';
  if (res.sampleRows.length > 0) {
    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    res.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    res.sampleRows.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((c) => {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    sample.appendChild(tbl);
  }

  document.getElementById('excelMappingBox').classList.remove('hidden');
});

document.getElementById('excelImportBtn').addEventListener('click', async () => {
  if (!excelFilePath) return;
  const nameIndex  = Number(document.getElementById('nameColumn').value);
  const phoneIndex = Number(document.getElementById('phoneColumn').value);
  const dateIndex  = Number(document.getElementById('dateColumn')?.value ?? -1);
  const hasHeaderRow = document.getElementById('hasHeaderRow').checked;
  const category = document.getElementById('excelCategory').value || 'default';

  document.getElementById('excelProgress').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = 'Başlatılıyor…';

  const autoQueue = document.getElementById('excelAutoQueue')?.checked;
  const res = await window.api.excel.import({
    filePath: excelFilePath,
    nameIndex,
    phoneIndex,
    dateIndex,
    hasHeaderRow,
    category,
    autoQueue,
  });

  if (res?.error) {
    alert(`İçe aktarma hatası: ${res.error}`);
  } else {
    document.getElementById('progressFill').style.width = '100%';
    const queuedMsg = res.queued  ? ` · ${res.queued} kişi sıraya eklendi`   : '';
    const dateMsg   = res.withDate > 0 ? ` · ${res.withDate} kişide tarih` : '';
    document.getElementById('progressText').textContent =
      `Tamamlandı (${categoryLabel(res.category)}) — yeni: ${res.inserted}, mükerrer: ${res.skippedDuplicate}, hatalı: ${res.skippedInvalid}${dateMsg}${queuedMsg}`;
    refreshContacts();
    refreshColorSwatches();
    refreshQueueStatus();
  }
});

document.getElementById('excelUpdateColorsBtn')?.addEventListener('click', async () => {
  if (!excelFilePath) return;
  const nameIndex  = Number(document.getElementById('nameColumn').value);
  const phoneIndex = Number(document.getElementById('phoneColumn').value);
  const hasHeaderRow = document.getElementById('hasHeaderRow').checked;

  document.getElementById('excelProgress').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = 'Renkler güncelleniyor…';

  const res = await window.api.excel.updateColors({ filePath: excelFilePath, nameIndex, phoneIndex, hasHeaderRow });

  if (res?.error) {
    alert(`Renk güncelleme hatası: ${res.error}`);
  } else {
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('progressText').textContent =
      `Renkler güncellendi — renkli: ${res.updated}, renksiz: ${res.noColor}, bulunamadı: ${res.notFound}`;
    refreshContacts();
    refreshColorSwatches();
  }
});

window.api.on('excel:progress', (p) => {
  const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressText').textContent =
    `${p.processed}/${p.total} işlendi — yeni: ${p.inserted}, mükerrer: ${p.skippedDuplicate}, hatalı: ${p.skippedInvalid}`;
});

// ---------- Mesajlar (kategori başına birden fazla) ----------
const previewName = document.getElementById('previewName');
const messagesList = document.getElementById('messagesList');

let activeMessageCategory = 'default';

function getPreviewName() {
  return previewName.value.trim() || 'Mehmet';
}

function renderMessageCategoryTabs() {
  const container = document.getElementById('messageCategoryTabs');
  if (!container) return;
  container.innerHTML = '';
  if (!categoriesCache.find((c) => c.name === activeMessageCategory)) {
    activeMessageCategory = categoriesCache[0]?.name || 'default';
  }
  categoriesCache.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (cat.name === activeMessageCategory ? ' active' : '');
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      activeMessageCategory = cat.name;
      renderMessageCategoryTabs();
      loadTemplates();
    });
    container.appendChild(btn);
  });
}

function renderCategoryManagement() {
  const container = document.getElementById('categoriesList');
  if (!container) return;
  container.innerHTML = '';
  categoriesCache.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const isDefault = cat.name === 'default';
    row.innerHTML = `
      <div class="info">
        <span class="name">${escapeHtml(cat.label)}</span>
        <span class="meta">kısa ad: <code>${escapeHtml(cat.name)}</code></span>
      </div>
      <div class="row gap">
        ${isDefault ? '<span class="muted small">silinemez</span>' : `<button class="danger" data-catdel="${cat.name}">Sil</button>`}
      </div>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('button[data-catdel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.catdel;
      if (!confirm(`"${name}" kategorisini silmek istediğine emin misin? Bu kategorideki kişiler ve mesajlar Standart kategoriye taşınacak.`)) return;
      const res = await window.api.categories.delete(name);
      if (res?.error) { alert(res.error); return; }
      await refreshCategoriesCache();
      loadTemplates();
      refreshContacts();
      refreshVideos();
    });
  });
}

document.getElementById('catAddForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('catNewName').value.trim();
  const label = document.getElementById('catNewLabel').value.trim();
  const statusEl = document.getElementById('catAddStatus');
  if (!name || !label) {
    statusEl.textContent = 'Ad ve gösterim ismi gerekli';
    statusEl.style.color = '#b91c1c';
    return;
  }
  const res = await window.api.categories.create(name, label);
  if (res?.error) {
    statusEl.textContent = res.error;
    statusEl.style.color = '#b91c1c';
    return;
  }
  statusEl.textContent = `Eklendi: ${res.label}`;
  statusEl.style.color = '#15803d';
  document.getElementById('catNewName').value = '';
  document.getElementById('catNewLabel').value = '';
  await refreshCategoriesCache();
  refreshVideos();
  setTimeout(() => (statusEl.textContent = ''), 2000);
});

function renderTemplatePreview(card) {
  const ta = card.querySelector('textarea');
  const preview = card.querySelector('.message-preview');
  preview.textContent = ta.value.replace(/\{name\}/g, getPreviewName());
}

function recountMessages() {
  const info = document.getElementById('msgCountInfo');
  if (!info) return;
  const cards = messagesList.querySelectorAll('.template-card');
  let active = 0;
  cards.forEach((c) => {
    const toggle = c.querySelector('.active-toggle');
    const ta = c.querySelector('textarea');
    if (toggle?.checked && (ta?.value || '').trim()) active++;
  });
  if (cards.length === 0) {
    info.textContent = '0 aktif mesaj';
  } else if (cards.length === 1 && active === 1) {
    info.textContent = '1 mesaj kayıtlı (aktif). Sadece bu mesaj gönderiliyor.';
  } else {
    info.textContent = `${cards.length} mesaj kayıtlı · ${active} aktif → her gönderimde aralarından rastgele biri seçilir`;
  }
}

function makeTemplateCard(tpl) {
  const card = document.createElement('div');
  card.classList.add('template-card');
  card.dataset.id = tpl.id;
  card.innerHTML = `
    <div class="row gap between template-head">
      <div class="row gap">
        <label class="checkbox">
          <input type="checkbox" class="active-toggle" ${tpl.is_active ? 'checked' : ''} />
          Aktif
        </label>
        <span class="muted small">#${tpl.id}</span>
        <span class="save-status muted small"></span>
      </div>
      <div class="row gap">
        <button class="danger delete-btn">Sil</button>
      </div>
    </div>
    <textarea rows="5" placeholder="Merhaba {name}, ..."></textarea>
    <div class="preview-area">
      <div class="muted small">Önizleme:</div>
      <div class="message-preview"></div>
    </div>
  `;

  const ta = card.querySelector('textarea');
  ta.value = tpl.content || '';
  const toggle = card.querySelector('.active-toggle');
  const delBtn = card.querySelector('.delete-btn');
  const statusEl = card.querySelector('.save-status');

  renderTemplatePreview(card);

  let saveTimer = null;
  async function persist() {
    try {
      await window.api.templates.update(tpl.id, ta.value, toggle.checked);
      statusEl.textContent = '✓ kaydedildi';
      statusEl.style.color = '#15803d';
      setTimeout(() => { statusEl.textContent = ''; }, 1500);
      recountMessages();
    } catch (err) {
      statusEl.textContent = `hata: ${err.message}`;
      statusEl.style.color = '#b91c1c';
    }
  }

  ta.addEventListener('input', () => {
    renderTemplatePreview(card);
    statusEl.textContent = 'yazılıyor…';
    statusEl.style.color = '#6b7280';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 800);
  });

  ta.addEventListener('blur', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      persist();
    }
  });

  toggle.addEventListener('change', persist);

  delBtn.addEventListener('click', async () => {
    if (!confirm('Bu mesajı silmek istediğine emin misin?')) return;
    await window.api.templates.delete(tpl.id);
    card.remove();
    const remaining = messagesList.querySelectorAll('.template-card').length;
    if (remaining === 0) loadTemplates();
    else recountMessages();
  });

  return card;
}

async function loadTemplates() {
  const list = await window.api.templates.list(activeMessageCategory, 'main');
  messagesList.innerHTML = '';
  const info = document.getElementById('msgCountInfo');
  const catLabel = categoryLabel(activeMessageCategory);
  if (!list || list.length === 0) {
    messagesList.innerHTML =
      `<div class="muted small">"${escapeHtml(catLabel)}" kategorisinde henüz mesaj yok. Yukarıdan "+ Yeni Mesaj" ile başlayın.</div>`;
    if (info) info.textContent = `${catLabel}: 0 aktif mesaj`;
  } else {
    for (const tpl of list) messagesList.appendChild(makeTemplateCard(tpl));
    if (info) {
      const active = list.filter((t) => t.is_active && (t.content || '').trim()).length;
      info.textContent = `${catLabel}: ${list.length} mesaj kayıtlı · ${active} aktif → bu kategorideki kişilere bunlardan rastgele biri gider`;
    }
  }
  await loadCtaTemplates();
}

document.getElementById('msgAddBtn').addEventListener('click', async () => {
  const res = await window.api.templates.create('', activeMessageCategory, 'main');
  if (res?.error) { alert(res.error); return; }
  if (res?.id) {
    await loadTemplates();
    const card = messagesList.querySelector(`.template-card[data-id="${res.id}"]`);
    if (card) {
      card.querySelector('textarea').focus();
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

// ---- CTA (Cevap İstek) Mesajları ----
const ctaMessagesList = document.getElementById('ctaMessagesList');

function recountCtaMessages() {
  const info = document.getElementById('ctaCountInfo');
  if (!info || !ctaMessagesList) return;
  const cards = ctaMessagesList.querySelectorAll('.template-card');
  let active = 0;
  cards.forEach((c) => {
    const toggle = c.querySelector('.active-toggle');
    const ta = c.querySelector('textarea');
    if (toggle?.checked && (ta?.value || '').trim()) active++;
  });
  if (cards.length === 0) {
    info.textContent = 'CTA mesajı yok — hiç cevap isteği gönderilmez.';
  } else {
    info.textContent = `${cards.length} CTA mesajı · ${active} aktif — gönderim sonrası aralarından rastgele biri seçilir`;
  }
}

function makeCtaCard(tpl) {
  const card = document.createElement('div');
  card.classList.add('template-card');
  card.dataset.id = tpl.id;
  card.innerHTML = `
    <div class="row gap between template-head">
      <div class="row gap">
        <label class="checkbox">
          <input type="checkbox" class="active-toggle" ${tpl.is_active ? 'checked' : ''} />
          Aktif
        </label>
        <span class="muted small">#${tpl.id} · CTA</span>
        <span class="save-status muted small"></span>
      </div>
      <button class="danger delete-btn">Sil</button>
    </div>
    <textarea rows="3" placeholder="Bilgi almak ister misiniz? Evet/Hayır yazın..."></textarea>
    <div class="preview-area">
      <div class="muted small">Önizleme:</div>
      <div class="message-preview"></div>
    </div>
  `;
  const ta = card.querySelector('textarea');
  ta.value = tpl.content || '';
  const toggle = card.querySelector('.active-toggle');
  const delBtn = card.querySelector('.delete-btn');
  const statusEl = card.querySelector('.save-status');

  function renderCtaPreview() {
    card.querySelector('.message-preview').textContent = ta.value.replace(/\{name\}/g, getPreviewName());
  }
  renderCtaPreview();

  let saveTimer = null;
  async function persist() {
    try {
      await window.api.templates.update(tpl.id, ta.value, toggle.checked);
      statusEl.textContent = '✓ kaydedildi';
      statusEl.style.color = '#15803d';
      setTimeout(() => { statusEl.textContent = ''; }, 1500);
      recountCtaMessages();
    } catch (err) {
      statusEl.textContent = `hata: ${err.message}`;
      statusEl.style.color = '#b91c1c';
    }
  }

  ta.addEventListener('input', () => {
    renderCtaPreview();
    statusEl.textContent = 'yazılıyor…';
    statusEl.style.color = '#6b7280';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 800);
  });
  ta.addEventListener('blur', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; persist(); }
  });
  toggle.addEventListener('change', persist);
  delBtn.addEventListener('click', async () => {
    if (!confirm('Bu CTA mesajını silmek istediğine emin misin?')) return;
    await window.api.templates.delete(tpl.id);
    card.remove();
    recountCtaMessages();
  });
  return card;
}

async function loadCtaTemplates() {
  if (!ctaMessagesList) return;
  const list = await window.api.templates.list(activeMessageCategory, 'cta');
  ctaMessagesList.innerHTML = '';
  const info = document.getElementById('ctaCountInfo');
  if (!list || list.length === 0) {
    ctaMessagesList.innerHTML = '<div class="muted small">Henüz CTA mesajı yok. Eklerseniz gönderim sonrası kullanılır. Boş bırakırsanız cevap isteği atlanır.</div>';
    if (info) info.textContent = 'CTA mesajı yok — hiç cevap isteği gönderilmez.';
    return;
  }
  for (const tpl of list) ctaMessagesList.appendChild(makeCtaCard(tpl));
  recountCtaMessages();
}

document.getElementById('ctaAddBtn')?.addEventListener('click', async () => {
  const res = await window.api.templates.create('', activeMessageCategory, 'cta');
  if (res?.error) { alert(res.error); return; }
  if (res?.id) {
    await loadCtaTemplates();
    const card = ctaMessagesList?.querySelector(`.template-card[data-id="${res.id}"]`);
    if (card) {
      card.querySelector('textarea').focus();
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
});

previewName.addEventListener('input', () => {
  messagesList.querySelectorAll('.template-card').forEach(renderTemplatePreview);
});

// ---------- Video ----------
async function refreshVideos() {
  const list = await window.api.video.list();
  const filter = document.getElementById('videoCategoryFilter')?.value || '';
  const visible = filter ? list.filter((v) => v.category === filter) : list;

  const summaryEl = document.getElementById('videoSummary');
  if (summaryEl) {
    const byCat = {};
    for (const v of list) {
      if (!byCat[v.category]) byCat[v.category] = { total: 0, active: 0, usable: 0 };
      byCat[v.category].total++;
      if (v.isActive) byCat[v.category].active++;
      if (v.isActive && !v.oversized) byCat[v.category].usable++;
    }
    const parts = categoriesCache.map((cat) => {
      const c = byCat[cat.name];
      if (!c) return `${cat.label}: 0`;
      return `${cat.label}: ${c.usable}/${c.total} kullanılabilir`;
    });
    summaryEl.textContent = parts.join(' · ');
  }

  setText('videoCount', list.length);
  const container = document.getElementById('videoList');
  container.innerHTML = '';
  if (!visible || visible.length === 0) {
    container.innerHTML = '<div class="muted small">Bu kategoride video yok. "+ Video seç" ile yükleyin.</div>';
    return;
  }
  for (const v of visible) {
    const item = document.createElement('div');
    item.classList.add('video-item');
    if (v.isActive && !v.oversized) item.classList.add('active');
    if (v.oversized) item.classList.add('warn');
    const catOptions = categoriesCache
      .map((opt) => `<option value="${opt.name}" ${opt.name === v.category ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`)
      .join('');
    item.innerHTML = `
      <div class="info">
        <span class="name">${escapeHtml(v.filename)}</span>
        <span class="meta ${v.oversized ? 'warn' : ''}">
          ${v.sizeMb} MB${v.oversized ? ' — 16MB üzeri, gönderilemez' : ''}
        </span>
      </div>
      <div class="row gap">
        <label class="inline-label">Kategori
          <select data-vcat="${v.id}">${catOptions}</select>
        </label>
        <label class="switch">
          <input type="checkbox" data-vactive="${v.id}" ${v.isActive ? 'checked' : ''} />
          <span>Aktif</span>
        </label>
        <button class="danger ghost-danger" data-vdel="${v.id}">Sil</button>
      </div>
    `;
    container.appendChild(item);
  }
  container.querySelectorAll('select[data-vcat]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      await window.api.video.update(Number(sel.dataset.vcat), { category: sel.value });
      refreshVideos();
    })
  );
  container.querySelectorAll('input[data-vactive]').forEach((chk) =>
    chk.addEventListener('change', async () => {
      await window.api.video.update(Number(chk.dataset.vactive), { isActive: chk.checked });
      refreshVideos();
    })
  );
  container.querySelectorAll('button[data-vdel]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Bu videoyu silmek istiyor musunuz?')) return;
      await window.api.video.delete(Number(b.dataset.vdel));
      refreshVideos();
    })
  );
}

document.getElementById('videoCategoryFilter')?.addEventListener('change', refreshVideos);

document.getElementById('videoPickBtn').addEventListener('click', async () => {
  const cat = document.getElementById('videoUploadCategory')?.value || 'default';
  const res = await window.api.video.pickAndImport(cat);
  if (!res) return;
  if (res.error) { alert(`Hata: ${res.error}`); return; }
  if (res.imported && res.imported.length > 0) {
    const overs = res.imported.filter((v) => v.oversized);
    if (overs.length > 0) {
      alert(`${overs.length} video 16MB üzerinde — gönderim sırasında atlanacak: ${overs.map((v) => v.filename).join(', ')}`);
    }
  }
  if (res.errors && res.errors.length > 0) {
    alert(`Bazı dosyalar yüklenemedi:\n${res.errors.map((e) => `${e.file}: ${e.error}`).join('\n')}`);
  }
  refreshVideos();
});

// ---------- Leads ----------
const PIPELINE_STAGES = [
  { key: 'new',           label: 'Yeni',              color: '#6366f1' },
  { key: 'contacted',     label: 'İletişimde',         color: '#3b82f6' },
  { key: 'visit_planned', label: 'Ziyaret Planlandı',  color: '#f59e0b' },
  { key: 'offer_given',   label: 'Teklif Verildi',     color: '#f97316' },
  { key: 'sold',          label: 'Satış',              color: '#22c55e' },
  { key: 'closed',        label: 'Kapandı',            color: '#a1a1aa' },
];

const leadBadge = document.getElementById('leadBadge');

const RESPONSE_TYPE_LABEL = { yes: 'Evet', no: 'Hayır', other: 'Diğer' };
const RESPONSE_TYPE_CLASS = { yes: 'resp-yes', no: 'resp-no', other: 'resp-other' };

let leadSortOrder = 'desc';

function updateLeadSortBtn() {
  const btn = document.getElementById('leadsSortBtn');
  if (!btn) return;
  btn.textContent = leadSortOrder === 'desc' ? 'Yeniden Eskiye ↓' : 'Eskiden Yeniye ↑';
}

async function refreshLeads() {
  const statusFilter = document.getElementById('leadStatusFilter').value;
  const typeFilter = document.getElementById('leadTypeFilter')?.value || '';
  const opts = { orderBy: leadSortOrder };
  if (statusFilter) opts.status = statusFilter;
  if (typeFilter) opts.responseType = typeFilter;

  const [rows, pipeline] = await Promise.all([
    window.api.leads.list(opts),
    window.api.leads.pipeline(),
  ]);

  // Pipeline bar render
  const pipelineEl = document.getElementById('leadPipeline');
  if (pipelineEl) {
    const mainStages = PIPELINE_STAGES.filter(s => s.key !== 'closed');
    const closedStage = PIPELINE_STAGES.find(s => s.key === 'closed');
    pipelineEl.innerHTML = `
      <div class="pipeline-stages">
        ${mainStages.map((s, i) => `
          <div class="pipeline-stage" title="${s.label} aşamasına geç — filtrele" data-filter="${s.key}">
            <div class="pipeline-dot" style="background:${s.color};"></div>
            <div class="pipeline-count" style="color:${s.color};">${pipeline[s.key] || 0}</div>
            <div class="pipeline-label">${s.label}</div>
          </div>
          ${i < mainStages.length - 1 ? '<div class="pipeline-arrow">›</div>' : ''}
        `).join('')}
      </div>
      <div class="pipeline-closed" data-filter="${closedStage.key}">
        <span style="color:${closedStage.color};">Kapandı: ${pipeline.closed || 0}</span>
      </div>`;
    pipelineEl.querySelectorAll('[data-filter]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const sel = document.getElementById('leadStatusFilter');
        sel.value = sel.value === el.dataset.filter ? '' : el.dataset.filter;
        refreshLeads();
      });
    });
  }

  setText('leadCount', rows.length);
  const tbody = document.getElementById('leadRows');
  tbody.innerHTML = '';
  const statusOptions = PIPELINE_STAGES.map(s =>
    `<option value="${s.key}">${s.label}</option>`
  ).join('');
  for (const l of rows) {
    const cat = l.category || 'default';
    const rtype = l.response_type || 'yes';
    const stage = PIPELINE_STAGES.find(s => s.key === l.status) || PIPELINE_STAGES[0];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(l.name || '-')}</td>
      <td>${escapeHtml(l.phone || '-')}</td>
      <td><span class="cat-pill ${escapeHtml(cat)}">${escapeHtml(categoryLabel(cat))}</span></td>
      <td><span class="resp-pill ${escapeHtml(RESPONSE_TYPE_CLASS[rtype] || 'resp-other')}">${escapeHtml(RESPONSE_TYPE_LABEL[rtype] || rtype)}</span></td>
      <td>${escapeHtml(l.response_text || '')}</td>
      <td>${new Date(l.responded_at).toLocaleString()}</td>
      <td>
        <select class="pipeline-select" data-status="${l.id}" style="border-left:3px solid ${stage.color};">
          ${statusOptions.replace(`value="${l.status}"`, `value="${l.status}" selected`)}
        </select>
      </td>
      <td><input class="lead-notes-input" type="text" data-notes-id="${l.id}" value="${escapeHtml(l.notes || '')}" placeholder="Not ekle..." /></td>
      <td class="lead-actions">
        <button class="lead-wa-btn" data-wa="${escapeHtml(l.phone)}" title="WhatsApp'ta Aç">WA</button>
        <button class="lead-del-btn" data-lead-del="${l.id}" title="Sil">Sil</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('select[data-status]').forEach((s) =>
    s.addEventListener('change', async () => {
      await window.api.leads.updateStatus(Number(s.dataset.status), s.value);
      const stage = PIPELINE_STAGES.find(st => st.key === s.value) || PIPELINE_STAGES[0];
      s.style.borderLeftColor = stage.color;
      // Pipeline sayaçlarını yenile (tabloyu yeniden çizmeden)
      const counts = await window.api.leads.pipeline();
      const pEl = document.getElementById('leadPipeline');
      if (pEl) {
        pEl.querySelectorAll('.pipeline-count').forEach(el => {
          const key = el.closest('.pipeline-stage')?.dataset.filter;
          if (key && counts[key] !== undefined) el.textContent = counts[key];
        });
        const closedEl = pEl.querySelector('.pipeline-closed span');
        if (closedEl) closedEl.textContent = `Kapandı: ${counts.closed || 0}`;
      }
    })
  );
  tbody.querySelectorAll('button[data-wa]').forEach((b) =>
    b.addEventListener('click', () => window.api.shellOpenWhatsapp(b.dataset.wa))
  );
  tbody.querySelectorAll('button[data-lead-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Bu yanıtı silmek istediğinize emin misiniz?')) return;
      await window.api.leads.delete(Number(b.dataset.leadDel));
      refreshLeads();
    })
  );
  tbody.querySelectorAll('input.lead-notes-input').forEach((inp) => {
    inp.addEventListener('change', () =>
      window.api.leads.updateNotes(Number(inp.dataset.notesId), inp.value)
    );
  });
}

document.getElementById('leadsSortBtn')?.addEventListener('click', () => {
  leadSortOrder = leadSortOrder === 'desc' ? 'asc' : 'desc';
  updateLeadSortBtn();
  refreshLeads();
});

document.getElementById('leadsRefreshBtn').addEventListener('click', refreshLeads);
document.getElementById('leadStatusFilter').addEventListener('change', refreshLeads);
document.getElementById('leadTypeFilter')?.addEventListener('change', refreshLeads);
document.getElementById('leadsExportBtn').addEventListener('click', async () => {
  const path = await window.api.leads.export();
  if (path) alert(`Kaydedildi: ${path}`);
});

window.api.on('lead:new', async (lead) => {
  refreshLeads();
  refreshDashboard();
  // Yalnızca "evet" yanıtları için masaüstü bildirimi — diğerleri sessizce listeye eklenir
  if (!lead.response_type || lead.response_type === 'yes') {
    await window.api.notify('Yeni Yanıt!', `${lead.name || ''} → ${lead.response_text || ''}`);
  }
  const cur = Number(leadBadge.textContent || 0) + 1;
  leadBadge.textContent = cur;
  leadBadge.classList.remove('hidden');
});

// ---------- Settings ----------
async function loadSettings() {
  const all = await window.api.settings.getAll();
  document.getElementById('setDaily').value = all.daily_limit || 200;
  document.getElementById('setHourly').value = all.hourly_limit || 30;
  document.getElementById('setMin').value = all.min_delay_seconds || 30;
  document.getElementById('setMax').value = all.max_delay_seconds || 90;
  document.getElementById('setStart').value = all.work_start_hour || 9;
  document.getElementById('setEnd').value = all.work_end_hour || 21;
  const videoChk = document.getElementById('setVideoEnabled');
  if (videoChk) videoChk.checked = (all.video_enabled !== '0');
  const notifHourEl = document.getElementById('setNotifHour');
  if (notifHourEl) notifHourEl.value = all.daily_notif_hour ?? 20;
}

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  await window.api.settings.setMany({
    daily_limit: document.getElementById('setDaily').value,
    hourly_limit: document.getElementById('setHourly').value,
    min_delay_seconds: document.getElementById('setMin').value,
    max_delay_seconds: document.getElementById('setMax').value,
    work_start_hour: document.getElementById('setStart').value,
    work_end_hour: document.getElementById('setEnd').value,
  });
  const s = document.getElementById('settingsSaveStatus');
  s.textContent = 'Kaydedildi ✓';
  setTimeout(() => (s.textContent = ''), 2000);
});

document.getElementById('videoSettingSaveBtn')?.addEventListener('click', async () => {
  const enabled = document.getElementById('setVideoEnabled')?.checked;
  await window.api.settings.set('video_enabled', enabled ? '1' : '0');
  const s = document.getElementById('videoSettingSaveStatus');
  if (s) { s.textContent = 'Kaydedildi ✓'; setTimeout(() => (s.textContent = ''), 2000); }
});

document.getElementById('notifSettingSaveBtn')?.addEventListener('click', async () => {
  const hour = document.getElementById('setNotifHour')?.value ?? '20';
  await window.api.settings.set('daily_notif_hour', hour);
  await window.api.rescheduleDailyNotif();
  const s = document.getElementById('notifSettingSaveStatus');
  if (s) {
    s.textContent = `Kaydedildi ✓ — her gün ${hour}:00'de bildirim gelecek`;
    setTimeout(() => (s.textContent = ''), 3000);
  }
});

// ---------- Page initiators / refreshers ----------
async function refreshTemplateStats() {
  const el = document.getElementById('templateStatsBody');
  if (!el) return;
  el.innerHTML = '<p class="muted small">Yükleniyor…</p>';
  const rows = await window.api.templates.stats();
  if (!rows || !rows.length) {
    el.innerHTML = '<p class="muted small" style="font-style:italic;">Henüz gönderim verisi yok.</p>';
    return;
  }
  const maxSends = Math.max(...rows.map(r => r.sends), 1);
  el.innerHTML = `<div class="tpl-stats-list">
    ${rows.map((r, i) => {
      const rate = r.sends > 0 ? ((r.leads / r.sends) * 100).toFixed(1) : '0.0';
      const barW = Math.round((r.sends / maxSends) * 100);
      const preview = (r.content || '').replace(/\n/g, ' ').slice(0, 72) + ((r.content || '').length > 72 ? '…' : '');
      return `<div class="tpl-stat-row ${i % 2 === 0 ? '' : 'alt'}">
        <div class="tpl-stat-preview">${escapeHtml(preview)}</div>
        <div class="tpl-stat-bar-wrap">
          <div class="tpl-stat-bar" style="width:${barW}%;"></div>
        </div>
        <div class="tpl-stat-nums">
          <span class="tpl-sends">${r.sends} gönderim</span>
          <span class="tpl-leads">${r.leads} lead</span>
          <span class="tpl-rate ${parseFloat(rate) >= 5 ? 'good' : parseFloat(rate) >= 2 ? 'ok' : ''}">${rate}%</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

const pageInitiators = {
  'odeme-plani': () => OP.init(),
  whatsapp: async () => {
    const s = await window.api.whatsapp.status();
    setStatusUI(s);
  },
  contacts: async () => { await refreshColorSwatches(); refreshContacts(); },
  messages: async () => { await loadTemplates(); refreshTemplateStats(); },
  video: refreshVideos,
  dashboard: fetchAndRenderChart,
  leads: () => {
    leadBadge.textContent = '0';
    leadBadge.classList.add('hidden');
    refreshLeads();
  },
  settings: loadSettings,
};
const pageRefreshers = {
  dashboard: refreshDashboard,
  contacts: refreshContacts,
  messages: async () => { await loadTemplates(); refreshTemplateStats(); },
  video: refreshVideos,
  leads: refreshLeads,
};

document.getElementById('templateStatsRefreshBtn')?.addEventListener('click', refreshTemplateStats);

// ---------- Helpers ----------
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// İlk açılış: kategorileri yükle, sonra dashboard.
(async () => {
  await refreshCategoriesCache();
  refreshDashboard();
  refreshQueueStatus();
})();

// ============================================================
// ÖDEME PLANI
// ============================================================
const OP = (() => {
  const PRESET_MONTHS = [12, 18, 24, 36, 48, 60];
  // Marka renkleri: kırmızı, koyu, kahverengi-kırmızı
  const COLORS = ['#c41414', '#1a1a1a', '#7f1d1d'];
  const COLORS_LIGHT = ['#fde8e8', '#f4f4f6', '#fde8e8'];

  let plans = [];
  let ipNextId = 1;
  let planNextId = 1;
  let initialized = false;
  let opRates = { USD: null, EUR: null, GBP: null, date: null };

  // ─── Yardımcı fonksiyonlar ────────────────────────────────
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function nextMonthStr() {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  function addMonths(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  }
  function fmtDate(s) {
    return new Date(s + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
  }
  function fmtMoneyShort(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1_000_000) return Number(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 3 }) + ' M ₺';
    return fmtMoney(n);
  }

  // Yazarken anlık nokta formatlama (5000000 → 5.000.000)
  function fmtInput(raw) {
    // Sadece rakam ve virgül kalsın
    const parts = raw.replace(/[^\d,]/g, '').split(',');
    // Tam sayı kısmına her 3 basamakta nokta
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (parts.length > 2) parts.length = 2; // en fazla bir virgül
    return parts.join(',');
  }
  function parseInput(formatted) {
    return parseFloat(formatted.replace(/\./g, '').replace(',', '.')) || 0;
  }
  // Sayısal değeri formatlı string olarak göster
  function displayInput(n) {
    if (!n) return '';
    return Math.round(n).toLocaleString('tr-TR');
  }
  // Input'a anlık formatlama uygula, imleci koru
  function attachMoneyInput(inputEl, onValue) {
    inputEl.addEventListener('input', (e) => {
      const el = e.target;
      const cursor = el.selectionStart;
      const before = el.value;
      const formatted = fmtInput(before);
      // Kaç nokta eklendi/çıktı → imleci kaydır
      const dotsBefore = (before.slice(0, cursor).match(/\./g) || []).length;
      el.value = formatted;
      const dotsAfter = (formatted.slice(0, cursor).match(/\./g) || []).length;
      const newCursor = Math.max(0, cursor + (dotsAfter - dotsBefore));
      el.setSelectionRange(newCursor, newCursor);
      onValue(parseInput(formatted));
    });
  }

  function newPlan() {
    return {
      id: planNextId++,
      name: `Plan ${plans.length + 1}`,
      totalAmount: 0,
      downPayment: 0,
      downPaymentDate: todayStr(),
      startDate: nextMonthStr(),
      installmentCount: 24,
      intermediatePayments: [],
      targetMonthly: 0,
      computedIp: null, // { amount, month } — hedef aylık taksit modunda otomatik hesaplanan ara ödeme
    };
  }

  // Hedef aylık taksit → gerekli ara ödeme tutarını hesapla (toplam fiyata dokunmaz)
  function syncComputedIp(plan) {
    if (!plan.targetMonthly || !plan.totalAmount) { plan.computedIp = null; return; }
    const manualIpTotal = plan.intermediatePayments.reduce((s, p) => s + (p.amount || 0), 0);
    const needed = plan.totalAmount - plan.downPayment - manualIpTotal - plan.targetMonthly * plan.installmentCount;
    const month = plan.computedIp ? plan.computedIp.month : Math.max(1, Math.floor(plan.installmentCount / 2));
    plan.computedIp = { amount: Math.max(0, Math.round(needed)), month };
  }

  // ─── Hesaplama ────────────────────────────────────────────
  function calcPlan(plan) {
    const manualIpTotal = plan.intermediatePayments.reduce((s, p) => s + (p.amount || 0), 0);
    const computedIpAmount = plan.computedIp ? (plan.computedIp.amount || 0) : 0;
    const totalIp = manualIpTotal + computedIpAmount;
    const remaining = plan.totalAmount - plan.downPayment - totalIp;
    if (remaining < 0) return { error: 'Peşinat ve ara ödemeler toplamı satış fiyatını aşıyor.' };
    if (plan.installmentCount <= 0) return { error: 'Taksit sayısı 0\'dan büyük olmalı.' };

    const monthly = remaining / plan.installmentCount;
    const schedule = [];
    let cum = 0, no = 0;

    if (plan.downPayment > 0) {
      no++; cum += plan.downPayment;
      schedule.push({ no, date: plan.downPaymentDate, type: 'down', label: 'Peşinat',
        amount: plan.downPayment, cumulative: cum, remaining: plan.totalAmount - cum });
    }

    const ipMap = {};
    for (const ip of plan.intermediatePayments) {
      if (!ipMap[ip.month]) ipMap[ip.month] = [];
      ipMap[ip.month].push(ip);
    }
    if (plan.computedIp && plan.computedIp.amount > 0) {
      const m = plan.computedIp.month;
      if (!ipMap[m]) ipMap[m] = [];
      ipMap[m].push({ label: 'Hedef Ara Ödeme', amount: plan.computedIp.amount });
    }

    for (let i = 1; i <= plan.installmentCount; i++) {
      const date = addMonths(plan.startDate, i - 1);
      for (const ip of (ipMap[i] || [])) {
        if (!ip.amount) continue;
        no++; cum += ip.amount;
        schedule.push({ no, date, type: 'intermediate', label: ip.label || 'Ara Ödeme',
          amount: ip.amount, cumulative: cum, remaining: plan.totalAmount - cum });
      }
      no++; cum += monthly;
      schedule.push({ no, date, type: 'installment', label: `${i}. Taksit`,
        amount: monthly, cumulative: cum, remaining: plan.totalAmount - cum });
    }
    return { monthly, totalIp, schedule };
  }

  // ─── Tablo render ─────────────────────────────────────────
  function renderTable(result, plan, color) {
    const rows = result.schedule.map((row, i) => {
      const isDown = row.type === 'down';
      const isIp   = row.type === 'intermediate';
      const bg = isDown ? '#f0fdf4' : isIp ? '#fff8f0' : (i % 2 === 0 ? '#fff' : 'var(--surface-2)');
      const tc = isDown ? '#15803d' : isIp ? '#9a3412' : 'var(--text)';
      const fw = (isDown || isIp) ? '600' : '400';
      const icon = isDown ? '● ' : isIp ? '◆ ' : '';
      return `<tr style="background:${bg};border-bottom:1px solid #f0f0f0;">
        <td style="padding:7px 10px;text-align:center;color:${tc};font-weight:${fw};font-size:12px;">${row.no}</td>
        <td style="padding:7px 10px;color:${tc};font-weight:${fw};font-size:12px;white-space:nowrap;">${fmtDate(row.date)}</td>
        <td style="padding:7px 10px;color:${tc};font-weight:${fw};font-size:12px;">${icon}${escapeHtml(row.label)}</td>
        <td style="padding:7px 10px;text-align:right;color:${tc};font-weight:${fw};font-size:12px;white-space:nowrap;">${fmtMoney(row.amount)}</td>
        <td style="padding:7px 10px;text-align:right;color:var(--text-muted);font-size:12px;white-space:nowrap;">${fmtMoney(row.cumulative)}</td>
        <td style="padding:7px 10px;text-align:right;color:var(--text-muted);font-size:12px;white-space:nowrap;">${fmtMoney(row.remaining < 0.01 && row.remaining > -0.01 ? 0 : row.remaining)}</td>
      </tr>`;
    }).join('');

    return `<div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border);">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:${color};color:#fff;">
          <th style="padding:9px 10px;text-align:center;width:36px;font-size:12px;">#</th>
          <th style="padding:9px 10px;text-align:left;font-size:12px;">Tarih</th>
          <th style="padding:9px 10px;text-align:left;font-size:12px;">Açıklama</th>
          <th style="padding:9px 10px;text-align:right;font-size:12px;">Tutar</th>
          <th style="padding:9px 10px;text-align:right;font-size:12px;">Toplam Ödenen</th>
          <th style="padding:9px 10px;text-align:right;font-size:12px;">Kalan</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:var(--surface-2);border-top:2px solid var(--border-strong);font-weight:700;">
          <td colspan="3" style="padding:9px 10px;font-size:12px;">TOPLAM</td>
          <td style="padding:9px 10px;text-align:right;font-size:12px;">${fmtMoney(plan.totalAmount)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:12px;">${fmtMoney(plan.totalAmount)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:12px;color:#15803d;font-weight:700;">0,00 ₺</td>
        </tr></tfoot>
      </table>
    </div>`;
  }

  // ─── Sonuçlar ─────────────────────────────────────────────
  function renderResults() {
    const valid = plans
      .filter(p => p.totalAmount > 0)
      .map(p => ({ plan: p, r: calcPlan(p) }))
      .filter(x => !x.r.error);

    // Hata mesajları
    const errDiv = document.getElementById('opErrors');
    if (errDiv) {
      const errs = plans
        .filter(p => p.totalAmount > 0)
        .map(p => ({ plan: p, r: calcPlan(p) }))
        .filter(x => x.r.error);
      errDiv.innerHTML = errs.map(e =>
        `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 12px;font-size:13px;color:#b91c1c;margin-bottom:6px;">
          <strong>${escapeHtml(e.plan.name)}:</strong> ${e.r.error}
        </div>`
      ).join('');
    }

    const resultsDiv = document.getElementById('opResults');
    const exportBtns = document.getElementById('opExportBtns');
    if (!valid.length) {
      resultsDiv.classList.add('hidden');
      if (exportBtns) exportBtns.style.display = 'none';
      return;
    }
    resultsDiv.classList.remove('hidden');
    if (exportBtns) exportBtns.style.removeProperty('display');

    // Print tarihi
    const printDate = document.getElementById('opPrintDate');
    if (printDate) {
      printDate.textContent = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }) + ' tarihli';
    }

    const summaryDiv = document.getElementById('opSummary');
    const tableArea  = document.getElementById('opTableArea');

    if (valid.length === 1) {
      const { plan, r } = valid[0];
      summaryDiv.innerHTML = `<div class="op-stats">
        <div class="op-stat highlight">
          <div class="op-stat-label">Aylık Taksit</div>
          <div class="op-stat-value">${fmtMoneyShort(r.monthly)}</div>
        </div>
        <div class="op-stat">
          <div class="op-stat-label">Peşinat</div>
          <div class="op-stat-value">${fmtMoneyShort(plan.downPayment)}</div>
        </div>
        <div class="op-stat">
          <div class="op-stat-label">Taksit Sayısı</div>
          <div class="op-stat-value">${plan.installmentCount} ay</div>
        </div>
        <div class="op-stat">
          <div class="op-stat-label">Ara Ödemeler</div>
          <div class="op-stat-value">${fmtMoneyShort(r.totalIp)}</div>
        </div>
        <div class="op-stat">
          <div class="op-stat-label">Taksit Toplamı</div>
          <div class="op-stat-value">${fmtMoneyShort(r.monthly * plan.installmentCount)}</div>
        </div>
        <div class="op-stat">
          <div class="op-stat-label">Toplam Fiyat</div>
          <div class="op-stat-value">${fmtMoneyShort(plan.totalAmount)}</div>
        </div>
      </div>`;
      tableArea.innerHTML = renderTable(r, plan, COLORS[0]);
    } else {
      const headers = valid.map((x, i) =>
        `<th style="background:${COLORS[i%3]};color:#fff;padding:10px 16px;font-weight:600;font-size:13px;">${escapeHtml(x.plan.name)}</th>`
      ).join('');
      const compareRows = [
        { label: 'Aylık Taksit',      fn: x => fmtMoney(x.r.monthly),                          bold: true },
        { label: 'Peşinat',           fn: x => fmtMoney(x.plan.downPayment) },
        { label: 'Taksit Sayısı',     fn: x => `${x.plan.installmentCount} ay` },
        { label: 'Ara Ödemeler',      fn: x => fmtMoney(x.r.totalIp) },
        { label: 'Taksit Toplamı',    fn: x => fmtMoney(x.r.monthly * x.plan.installmentCount) },
        { label: 'Toplam Fiyat',      fn: x => fmtMoney(x.plan.totalAmount) },
      ].map((row, i) => `<tr style="background:${i%2===0?'#fff':'var(--surface-2)'};">
        <td style="padding:9px 16px;font-size:12px;font-weight:600;color:var(--text-muted);">${row.label}</td>
        ${valid.map(x =>
          `<td style="padding:9px 16px;text-align:center;${row.bold ? 'font-weight:700;font-size:14px;color:var(--primary);' : 'color:var(--text);font-size:13px;'}">${row.fn(x)}</td>`
        ).join('')}
      </tr>`).join('');

      summaryDiv.innerHTML = `<div class="op-comparison-table">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="background:var(--surface-2);padding:10px 16px;text-align:left;font-size:11px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Karşılaştırma</th>
            ${headers}
          </tr></thead>
          <tbody>${compareRows}</tbody>
        </table>
      </div>`;

      tableArea.innerHTML = valid.map((x, i) =>
        `<div style="margin-top:18px;">
          <div style="font-size:12px;font-weight:700;color:${COLORS[i%3]};text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;padding:6px 12px;background:${COLORS_LIGHT[i%3]};border-radius:6px;display:inline-block;">${escapeHtml(x.plan.name)}</div>
          ${renderTable(x.r, x.plan, COLORS[i%3])}
        </div>`
      ).join('');
    }
  }

  // ─── Form HTML ────────────────────────────────────────────
  function buildFormHtml(plan, idx) {
    const color      = COLORS[idx % 3];
    const canRemove  = plans.length > 1;

    const manualIpHtml = plan.intermediatePayments.map(ip => `
        <div class="op-ip-row" data-ip="${ip.id}">
          <input class="op-ip-label"  type="text"   value="${escapeHtml(ip.label)}" placeholder="Açıklama" />
          <span style="font-size:11px;color:var(--text-muted);">Ay:</span>
          <input class="op-ip-month"  type="number" min="1" max="${plan.installmentCount}" value="${ip.month}" />
          <input class="op-ip-amount" type="text" inputmode="numeric" value="${displayInput(ip.amount)}" placeholder="Tutar (₺)" />
          <button class="op-ip-remove">✕</button>
        </div>`).join('');
    const computedIpRowHtml = plan.computedIp ? `
        <div class="op-ip-row op-ip-computed">
          <input class="op-computed-ip-label" type="text" value="Hedef Ara Ödeme" readonly />
          <span style="font-size:11px;color:var(--text-muted);">Ay:</span>
          <input class="op-computed-ip-month" type="number" min="1" max="${plan.installmentCount}" value="${plan.computedIp.month}" />
          <input class="op-computed-ip-amount" type="text" value="${displayInput(plan.computedIp.amount)}" readonly />
          <button class="op-computed-ip-clear" title="Temizle">✕</button>
        </div>` : '';
    const ipHtml = (manualIpHtml || computedIpRowHtml)
      ? manualIpHtml + computedIpRowHtml
      : '<div class="muted small" style="font-style:italic;padding:2px 0;">Ara ödeme eklenmedi.</div>';

    const presetsHtml = PRESET_MONTHS.map(n =>
      `<button class="op-preset ghost small ${plan.installmentCount === n ? 'active' : ''}" data-n="${n}">${n}</button>`
    ).join('');
    const customVal = PRESET_MONTHS.includes(plan.installmentCount) ? '' : plan.installmentCount;

    return `<div class="op-form card" data-plan="${plan.id}">
      <div class="op-form-header" style="background:${color};">
        <input class="op-name-input" type="text" value="${escapeHtml(plan.name)}" placeholder="Plan adı" />
        ${canRemove ? `<button class="op-remove-plan">✕</button>` : ''}
      </div>
      <div class="op-form-body">

        <div class="op-field">
          <span class="op-label">Toplam Satış Fiyatı (₺)</span>
          <input class="op-total" type="text" inputmode="numeric" value="${displayInput(plan.totalAmount)}" placeholder="örn. 5.000.000" />
        </div>

        <div class="op-or-divider">— hedef aylık taksit girerek gerekli ara ödemeyi hesapla —</div>

        <div class="op-field">
          <span class="op-label">Hedef Aylık Taksit (₺)</span>
          <input class="op-target-monthly" type="text" inputmode="numeric" value="${displayInput(plan.targetMonthly)}" placeholder="örn. 50.000" />
        </div>

        <div class="row gap">
          <div class="op-field" style="flex:1;">
            <span class="op-label">Peşinat (₺)</span>
            <input class="op-down" type="text" inputmode="numeric" value="${displayInput(plan.downPayment)}" placeholder="0" />
          </div>
          <div class="op-field" style="flex:1;">
            <span class="op-label">Peşinat Tarihi</span>
            <input class="op-down-date" type="date" value="${plan.downPaymentDate}" />
          </div>
        </div>

        <div class="row gap" style="align-items:flex-start;">
          <div class="op-field" style="flex:1;">
            <span class="op-label">Taksit Sayısı (Ay)</span>
            <div class="op-preset-btns">
              ${presetsHtml}
              <input class="op-custom-count" type="number" min="1" max="360" value="${customVal}" placeholder="Özel ay" />
            </div>
          </div>
          <div class="op-field" style="flex:1;">
            <span class="op-label">1. Taksit Tarihi</span>
            <input class="op-start-date" type="date" value="${plan.startDate}" />
          </div>
        </div>

        <div class="op-field">
          <div class="row gap between" style="margin-bottom:6px;">
            <span class="op-label" style="margin:0;">Ara Ödemeler</span>
            <button class="op-add-ip ghost small">+ Ekle</button>
          </div>
          <div class="op-ip-list">${ipHtml}</div>
        </div>

      </div>
    </div>`;
  }

  // ─── Event'ler ────────────────────────────────────────────
  function attachEvents(planId) {
    const el   = document.querySelector(`.op-form[data-plan="${planId}"]`);
    const plan = plans.find(p => p.id === planId);
    if (!el || !plan) return;

    function attachComputedIpRowEvents(row) {
      row.querySelector('.op-computed-ip-month').addEventListener('change', e => {
        if (plan.computedIp) { plan.computedIp.month = parseInt(e.target.value) || 1; renderResults(); }
      });
      row.querySelector('.op-computed-ip-clear').addEventListener('click', () => {
        plan.targetMonthly = 0;
        plan.computedIp = null;
        const tmEl = el.querySelector('.op-target-monthly');
        if (tmEl) tmEl.value = '';
        syncComputedIpDom();
        renderResults();
      });
    }

    function syncComputedIpDom() {
      const ipList = el.querySelector('.op-ip-list');
      if (!ipList) return;
      let row = ipList.querySelector('.op-ip-computed');

      if (!plan.computedIp) {
        if (row) row.remove();
        if (!plan.intermediatePayments.length && !ipList.querySelector('.op-ip-row')) {
          ipList.innerHTML = '<div class="muted small" style="font-style:italic;padding:2px 0;">Ara ödeme eklenmedi.</div>';
        }
        return;
      }

      // Placeholder "Ara ödeme eklenmedi" varsa kaldır
      const placeholder = ipList.querySelector('.muted.small');
      if (placeholder) placeholder.remove();

      if (row) {
        // Sadece tutarı güncelle — odak kaybı olmaz
        const amtEl = row.querySelector('.op-computed-ip-amount');
        if (amtEl) amtEl.value = displayInput(plan.computedIp.amount);
      } else {
        // Satır yoksa oluştur, sonuna ekle
        const tmp = document.createElement('div');
        tmp.innerHTML = `<div class="op-ip-row op-ip-computed">
          <input class="op-computed-ip-label" type="text" value="Hedef Ara Ödeme" readonly />
          <span style="font-size:11px;color:var(--text-muted);">Ay:</span>
          <input class="op-computed-ip-month" type="number" min="1" max="${plan.installmentCount}" value="${plan.computedIp.month}" />
          <input class="op-computed-ip-amount" type="text" value="${displayInput(plan.computedIp.amount)}" readonly />
          <button class="op-computed-ip-clear" title="Temizle">✕</button>
        </div>`;
        row = tmp.firstElementChild;
        ipList.appendChild(row);
        attachComputedIpRowEvents(row);
      }
    }

    el.querySelector('.op-name-input').addEventListener('input', e => { plan.name = e.target.value; });

    attachMoneyInput(el.querySelector('.op-total'), v => {
      plan.totalAmount = v;
      if (plan.targetMonthly > 0) { syncComputedIp(plan); syncComputedIpDom(); }
      renderResults();
    });

    attachMoneyInput(el.querySelector('.op-target-monthly'), v => {
      plan.targetMonthly = v;
      syncComputedIp(plan);
      syncComputedIpDom();
      renderResults();
    });

    attachMoneyInput(el.querySelector('.op-down'), v => {
      plan.downPayment = v;
      if (plan.targetMonthly > 0) { syncComputedIp(plan); syncComputedIpDom(); }
      renderResults();
    });

    // Computed ip satırı form build sırasında render edilmişse event'lerini bağla
    const staticComputedRow = el.querySelector('.op-ip-computed');
    if (staticComputedRow) attachComputedIpRowEvents(staticComputedRow);

    el.querySelector('.op-down-date').addEventListener('change', e => { plan.downPaymentDate = e.target.value; renderResults(); });
    el.querySelector('.op-start-date').addEventListener('change', e => { plan.startDate = e.target.value; renderResults(); });

    el.querySelectorAll('.op-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        plan.installmentCount = parseInt(btn.dataset.n);
        el.querySelectorAll('.op-preset').forEach(b => b.classList.toggle('active', b === btn));
        el.querySelector('.op-custom-count').value = '';
        if (plan.targetMonthly > 0) { syncComputedIp(plan); syncComputedIpDom(); }
        renderResults();
      });
    });
    el.querySelector('.op-custom-count').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      if (v > 0) {
        plan.installmentCount = v;
        el.querySelectorAll('.op-preset').forEach(b => b.classList.remove('active'));
        if (plan.targetMonthly > 0) { syncComputedIp(plan); syncComputedIpDom(); }
        renderResults();
      }
    });

    const rmBtn = el.querySelector('.op-remove-plan');
    if (rmBtn) rmBtn.addEventListener('click', () => { plans = plans.filter(p => p.id !== planId); renderForms(); });

    el.querySelector('.op-add-ip').addEventListener('click', () => {
      plan.intermediatePayments.push({
        id: ipNextId++,
        month: Math.max(1, Math.floor(plan.installmentCount / 2)),
        amount: 0,
        label: 'Ara Ödeme',
      });
      renderForms();
    });

    el.querySelectorAll('.op-ip-row').forEach(row => {
      const ipId = parseInt(row.dataset.ip);
      const ip   = plan.intermediatePayments.find(p => p.id === ipId);
      if (!ip) return;
      row.querySelector('.op-ip-label').addEventListener('input', e => { ip.label = e.target.value; });
      row.querySelector('.op-ip-month').addEventListener('input', e => { ip.month = parseInt(e.target.value) || 1; renderResults(); });
      attachMoneyInput(row.querySelector('.op-ip-amount'), v => {
        ip.amount = v;
        if (plan.targetMonthly > 0) { syncComputedIp(plan); syncComputedIpDom(); }
        renderResults();
      });
      row.querySelector('.op-ip-remove').addEventListener('click', () => {
        plan.intermediatePayments = plan.intermediatePayments.filter(p => p.id !== ipId);
        renderForms();
      });
    });
  }

  function renderForms() {
    const container = document.getElementById('opPlanForms');
    const addBtn    = document.getElementById('opAddPlanBtn');
    if (!container) return;
    addBtn.disabled = plans.length >= 3;
    const cols = plans.length === 1 ? 1 : plans.length === 2 ? 2 : 3;
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.innerHTML = plans.map((p, i) => buildFormHtml(p, i)).join('');
    plans.forEach(p => attachEvents(p.id));
    renderResults();
  }

  // ─── Döviz kurları ────────────────────────────────────────
  function renderRates() {
    const body    = document.getElementById('opRatesBody');
    const dateEl  = document.getElementById('opRatesDate');
    const convRes = document.getElementById('opConvResult');
    if (!body) return;

    if (!opRates.USD) {
      body.innerHTML = '<span class="muted small" style="color:var(--danger);">Kur yüklenemedi. Yenile butonuna basın.</span>';
      return;
    }

    if (dateEl) dateEl.textContent = opRates.date ? `— TCMB, ${opRates.date}` : '';

    body.innerHTML = `<div class="op-rate-badges">
      ${[['USD', 'Amerikan Doları', '$'], ['EUR', 'Euro', '€'], ['GBP', 'İng. Sterlini', '£']].map(([code, name, sym]) =>
        opRates[code] ? `<div class="op-rate-badge">
          <span class="op-rate-code">${sym} ${code}</span>
          <span class="op-rate-val">${Number(opRates[code]).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺</span>
          <span class="op-rate-sub">${name}</span>
        </div>` : ''
      ).join('')}
    </div>`;

    // Çevirici güncelle
    updateConverter();
  }

  function updateConverter() {
    const amount   = parseFloat(document.getElementById('opConvAmount')?.value) || 0;
    const currency = document.getElementById('opConvCurrency')?.value || 'USD';
    const convRes  = document.getElementById('opConvResult');
    const applyBtn = document.getElementById('opConvApplyBtn');
    if (!convRes) return;

    const rate = opRates[currency];
    if (!rate || !amount) {
      convRes.textContent = '—';
      if (applyBtn) applyBtn.style.display = 'none';
      return;
    }
    const tl = amount * rate;
    convRes.textContent = Number(tl).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
    if (applyBtn) applyBtn.style.removeProperty('display');
  }

  async function loadRates() {
    const btn = document.getElementById('opRefreshRatesBtn');
    if (btn) { btn.disabled = true; btn.textContent = '↻ Yükleniyor…'; }
    try {
      const result = await window.api.paymentPlan.getRates();
      if (result && result.USD) {
        opRates = result;
        renderRates();
      }
    } catch (e) {
      console.error('Kur yükleme hatası', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Yenile'; }
    }
  }

  // ─── Excel export ─────────────────────────────────────────
  async function exportExcel() {
    const valid = plans
      .filter(p => p.totalAmount > 0)
      .map(p => ({ plan: p, r: calcPlan(p) }))
      .filter(x => !x.r.error);
    if (!valid.length) return;
    await window.api.paymentPlan.exportExcel(valid.map(x => ({
      name: x.plan.name,
      totalAmount: x.plan.totalAmount,
      downPayment: x.plan.downPayment,
      installmentCount: x.plan.installmentCount,
      monthly: x.r.monthly,
      totalIp: x.r.totalIp,
      startDate: x.plan.startDate,
      schedule: x.r.schedule,
    })));
  }

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    if (initialized) { renderResults(); return; }
    initialized = true;

    plans = [newPlan()];

    document.getElementById('opAddPlanBtn').addEventListener('click', () => {
      if (plans.length < 3) { plans.push(newPlan()); renderForms(); }
    });
    document.getElementById('opExportPdfBtn').addEventListener('click', () => window.print());
    document.getElementById('opExportExcelBtn').addEventListener('click', exportExcel);
    document.getElementById('opRefreshRatesBtn').addEventListener('click', loadRates);

    const convAmount   = document.getElementById('opConvAmount');
    const convCurrency = document.getElementById('opConvCurrency');
    const convApply    = document.getElementById('opConvApplyBtn');

    if (convAmount)   convAmount.addEventListener('input', updateConverter);
    if (convCurrency) convCurrency.addEventListener('change', updateConverter);
    if (convApply) {
      convApply.addEventListener('click', () => {
        const amount   = parseFloat(convAmount?.value) || 0;
        const currency = convCurrency?.value || 'USD';
        const rate     = opRates[currency];
        if (!rate || !amount || !plans.length) return;
        plans[0].totalAmount = Math.round(amount * rate);
        renderForms();
      });
    }

    renderForms();
    loadRates();
  }

  return { init };
})();

// ─── Güncelleme Bandı ────────────────────────────────────────
(function () {
  const banner   = document.getElementById('updateBanner');
  const text     = document.getElementById('updateBannerText');
  const progress = document.getElementById('updateProgressBar');
  const fill     = document.getElementById('updateProgressFill');
  const btn      = document.getElementById('updateInstallBtn');
  if (!banner) return;

  function showBanner() { banner.style.display = 'flex'; }

  window.api.on('update:available', ({ version }) => {
    text.textContent = `Yeni güncelleme mevcut: v${version} — indiriliyor…`;
    progress.style.display = 'block';
    btn.style.display = 'none';
    showBanner();
  });

  window.api.on('update:progress', ({ percent }) => {
    fill.style.width = percent + '%';
    text.textContent = `Güncelleme indiriliyor… %${percent}`;
  });

  window.api.on('update:downloaded', ({ version }) => {
    text.textContent = `v${version} hazır — şimdi yükleyebilirsiniz.`;
    progress.style.display = 'none';
    btn.style.display = 'inline-block';
    showBanner();
  });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Yeniden başlatılıyor…';
    window.api.updater.install();
  });
})();
