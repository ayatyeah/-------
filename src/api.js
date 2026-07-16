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

  // --- ИИ ---
  ai: {
    /** Какой движок отвечает: gemini, openai или rules (правила без ИИ). */
    status: () => request('/ai/status'),
    chat: (message, history) => request('/ai/chat', { method: 'POST', body: { message, history } }),
    analyzeLeads: () => request('/ai/analyze-leads', { method: 'POST', auth: true }),
  },

  // --- админка ---
  admin: {
    summary: () => request('/admin/summary', { auth: true }),
    models: () => request('/models?all=1'),
    createModel: (body) => request('/models', { method: 'POST', body, auth: true }),
    updateModel: (id, body) => request(`/models/${id}`, { method: 'PUT', body, auth: true }),
    deleteModel: (id) => request(`/models/${id}`, { method: 'DELETE', auth: true }),

    news: () => request('/news?all=1'),
    createNews: (body) => request('/news', { method: 'POST', body, auth: true }),
    updateNews: (id, body) => request(`/news/${id}`, { method: 'PUT', body, auth: true }),
    deleteNews: (id) => request(`/news/${id}`, { method: 'DELETE', auth: true }),

    updateService: (id, body) => request(`/services/${id}`, { method: 'PUT', body, auth: true }),

    requests: () => request('/requests', { auth: true }),
    setRequestStatus: (id, status) =>
      request(`/requests/${id}`, { method: 'PATCH', body: { status }, auth: true }),
    deleteRequest: (id) => request(`/requests/${id}`, { method: 'DELETE', auth: true }),

    saveSettings: (body) => request('/settings', { method: 'PUT', body, auth: true }),
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
