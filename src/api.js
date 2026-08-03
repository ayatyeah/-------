const TOKEN_KEY = 'shm_admin_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) headers.Authorization = `Bearer ${getToken()}`

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && auth) {
    clearToken()
    throw new Error('Сессия истекла — войдите заново')
  }
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}))
    throw new Error(msg.error || `Ошибка запроса (${res.status})`)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  login: (password) => request('/login', { method: 'POST', body: { password } }),

  /** Всё для главной одним запросом: настройки, показатели, услуги, сертификаты, новости. */
  home: () => request('/home'),

  categories: () => request('/categories'),
  regions: () => request('/regions'),
  certs: () => request('/certs'),
  stats: () => request('/stats'),
  services: () => request('/services'),
  settings: () => request('/settings'),

  models: (cat) => request(`/models${cat && cat !== 'all' ? `?cat=${cat}` : ''}`),
  model: (id) => request(`/models/${id}`),

  news: (limit) => request(`/news${limit ? `?limit=${limit}` : ''}`),
  article: (id) => request(`/news/${id}`),

  createRequest: (body) => request('/requests', { method: 'POST', body }),

  /** Маячок визита — раз за вкладку браузера, см. src/App.jsx. */
  visit: () => request('/visit', { method: 'POST' }),

  // --- ИИ ---
  ai: {
    /** Какой движок отвечает: gemini, openai или rules (правила без ИИ). */
    status: () => request('/ai/status'),
    chat: (message, history, lang) =>
      request('/ai/chat', { method: 'POST', body: { message, history, lang } }),
    analyzeLeads: () => request('/ai/analyze-leads', { method: 'POST', auth: true }),
  },

  // --- админка ---
  admin: {
    summary: (month) =>
      request(`/admin/summary${month ? `?month=${encodeURIComponent(month)}` : ''}`, { auth: true }),

    models: () => request('/models?all=1', { auth: true }),
    createModel: (body) => request('/models', { method: 'POST', body, auth: true }),
    updateModel: (id, body) => request(`/models/${id}`, { method: 'PUT', body, auth: true }),
    deleteModel: (id) => request(`/models/${id}`, { method: 'DELETE', auth: true }),
    reorderModels: (ids) => request('/models/reorder', { method: 'POST', body: { ids }, auth: true }),

    news: () => request('/news?all=1', { auth: true }),
    createNews: (body) => request('/news', { method: 'POST', body, auth: true }),
    updateNews: (id, body) => request(`/news/${id}`, { method: 'PUT', body, auth: true }),
    deleteNews: (id) => request(`/news/${id}`, { method: 'DELETE', auth: true }),

    // Категории («типы товара») — раньше правились только в коде.
    createCategory: (body) => request('/categories', { method: 'POST', body, auth: true }),
    updateCategory: (id, body) => request(`/categories/${id}`, { method: 'PUT', body, auth: true }),
    deleteCategory: (id, moveTo) =>
      request(`/categories/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`, {
        method: 'DELETE',
        auth: true,
      }),
    reorderCategories: (ids) =>
      request('/categories/reorder', { method: 'POST', body: { ids }, auth: true }),

    createService: (body) => request('/services', { method: 'POST', body, auth: true }),
    updateService: (id, body) => request(`/services/${id}`, { method: 'PUT', body, auth: true }),
    deleteService: (id) => request(`/services/${id}`, { method: 'DELETE', auth: true }),
    reorderServices: (ids) =>
      request('/services/reorder', { method: 'POST', body: { ids }, auth: true }),

    createStat: (body) => request('/stats', { method: 'POST', body, auth: true }),
    updateStat: (id, body) => request(`/stats/${id}`, { method: 'PUT', body, auth: true }),
    deleteStat: (id) => request(`/stats/${id}`, { method: 'DELETE', auth: true }),
    reorderStats: (ids) => request('/stats/reorder', { method: 'POST', body: { ids }, auth: true }),

    createCert: (body) => request('/certs', { method: 'POST', body, auth: true }),
    updateCert: (id, body) => request(`/certs/${id}`, { method: 'PUT', body, auth: true }),
    deleteCert: (id) => request(`/certs/${id}`, { method: 'DELETE', auth: true }),
    reorderCerts: (ids) => request('/certs/reorder', { method: 'POST', body: { ids }, auth: true }),

    saveRegions: (regions) => request('/regions', { method: 'PUT', body: { regions }, auth: true }),

    requests: () => request('/requests', { auth: true }),
    setRequestStatus: (id, status) =>
      request(`/requests/${id}`, { method: 'PATCH', body: { status }, auth: true }),
    deleteRequest: (id) => request(`/requests/${id}`, { method: 'DELETE', auth: true }),

    saveSettings: (body) => request('/settings', { method: 'PUT', body, auth: true }),

    /** Смена пароля админки. Текущий спрашиваем даже у вошедшего. */
    changePassword: (current, next) =>
      request('/admin/password', { method: 'POST', body: { current, next }, auth: true }),

    // --- библиотека фотографий ---
    uploads: () => request('/uploads', { auth: true }),
    deleteUpload: (name, force) =>
      request(`/uploads/${encodeURIComponent(name)}${force ? '?force=1' : ''}`, {
        method: 'DELETE',
        auth: true,
      }),

    /**
     * Загрузка файла.
     *
     * Файл уходит сырым телом запроса, без FormData и multipart: на
     * сервере тогда не нужен разборщик форм (см. server/uploads.js).
     * Имя передаём заголовком, закодировав — в заголовке HTTP не место
     * кириллице и пробелам как есть.
     */
    async upload(blob, fileName) {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': blob.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(fileName || 'photo'),
        },
        body: blob,
      })
      if (res.status === 401) {
        clearToken()
        throw new Error('Сессия истекла — войдите заново')
      }
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}))
        throw new Error(msg.error || `Не удалось загрузить файл (${res.status})`)
      }
      return res.json()
    },

    /** Скачать резервную копию содержимого сайта одним файлом. */
    async exportBackup() {
      const res = await fetch('/api/admin/export', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error('Не удалось выгрузить копию')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `shmagro-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Ссылку освобождаем, иначе браузер держит копию файла в памяти.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  },
}

/** «2026-07-08» → «8 июля 2026». */
export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** «2026-07-08» → «08.07.2026». */
export function formatDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU')
}
