const { contextBridge, ipcRenderer } = require('electron');

const allowedEvents = new Set([
  'whatsapp:qr',
  'whatsapp:status',
  'campaign:progress',
  'campaign:log',
  'lead:new',
  'excel:progress',
  'update:available',
  'update:progress',
  'update:downloaded',
]);

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('app:ping'),
  dataPath: () => ipcRenderer.invoke('app:data-path'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),

  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setMany: (obj) => ipcRenderer.invoke('settings:set-many', obj),
  },

  contacts: {
    list: (opts) => ipcRenderer.invoke('contacts:list', opts),
    add: (name, phone, category) => ipcRenderer.invoke('contacts:add', name, phone, category),
    updateCategory: (id, category) => ipcRenderer.invoke('contacts:update-category', id, category),
    updateVisitDate: (id, visitDate) => ipcRenderer.invoke('contacts:update-visit-date', id, visitDate),
    bulkSetVisitDate: (opts) => ipcRenderer.invoke('contacts:bulk-set-visit-date', opts),
    delete: (id) => ipcRenderer.invoke('contacts:delete', id),
    deleteAll: () => ipcRenderer.invoke('contacts:delete-all'),
    cleanInvalid: () => ipcRenderer.invoke('contacts:clean-invalid'),
    distinctColors: () => ipcRenderer.invoke('contacts:distinct-colors'),
  },

  excel: {
    pick: () => ipcRenderer.invoke('excel:pick'),
    import: (payload) => ipcRenderer.invoke('excel:import', payload),
    updateColors: (payload) => ipcRenderer.invoke('excel:update-colors', payload),
  },

  templates: {
    list: (category, type) => ipcRenderer.invoke('templates:list', category || null, type || null),
    create: (content, category, type) => ipcRenderer.invoke('templates:create', content, category, type || 'main'),
    update: (id, content, isActive) =>
      ipcRenderer.invoke('templates:update', id, content, isActive),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    preview: (content, name) => ipcRenderer.invoke('templates:preview', content, name),
    stats: () => ipcRenderer.invoke('templates:stats'),
  },

  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (name, label) => ipcRenderer.invoke('categories:create', name, label),
    delete: (name) => ipcRenderer.invoke('categories:delete', name),
  },

  video: {
    list: () => ipcRenderer.invoke('video:list'),
    pickAndImport: (category) => ipcRenderer.invoke('video:pick-and-import', category),
    update: (id, opts) => ipcRenderer.invoke('video:update', id, opts),
    delete: (id) => ipcRenderer.invoke('video:delete', id),
  },

  whatsapp: {
    start: () => ipcRenderer.invoke('whatsapp:start'),
    status: () => ipcRenderer.invoke('whatsapp:status'),
    logout: () => ipcRenderer.invoke('whatsapp:logout'),
  },

  scheduler: {
    state: () => ipcRenderer.invoke('scheduler:state'),
  },

  queue: {
    add: (contactIds) => ipcRenderer.invoke('queue:add', contactIds),
    remove: (contactIds) => ipcRenderer.invoke('queue:remove', contactIds),
    addByFilter: (opts) => ipcRenderer.invoke('queue:add-by-filter', opts),
    clear: () => ipcRenderer.invoke('queue:clear'),
    status: () => ipcRenderer.invoke('queue:status'),
  },

  leads: {
    list: (opts) => ipcRenderer.invoke('leads:list', opts),
    updateStatus: (id, status) => ipcRenderer.invoke('leads:update-status', id, status),
    delete: (id) => ipcRenderer.invoke('leads:delete', id),
    updateNotes: (id, notes) => ipcRenderer.invoke('leads:update-notes', id, notes),
    export: () => ipcRenderer.invoke('leads:export'),
    pipeline: () => ipcRenderer.invoke('leads:pipeline'),
  },

  shellOpenWhatsapp: (phone) => ipcRenderer.invoke('shell:open-whatsapp', phone),

  logs: {
    recent: (limit) => ipcRenderer.invoke('logs:recent', limit),
  },

  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats'),
    chartData: () => ipcRenderer.invoke('dashboard:chart-data'),
  },

  paymentPlan: {
    exportExcel: (plans) => ipcRenderer.invoke('payment-plan:export-excel', plans),
    getRates: () => ipcRenderer.invoke('payment-plan:get-rates'),
  },

  notify: (title, body) => ipcRenderer.invoke('notify:show', title, body),
  rescheduleDailyNotif: () => ipcRenderer.invoke('notify:reschedule-daily'),

  updater: {
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
  },

  on: (channel, listener) => {
    if (!allowedEvents.has(channel)) {
      throw new Error(`İzin verilmeyen event kanalı: ${channel}`);
    }
    const wrapped = (_evt, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
