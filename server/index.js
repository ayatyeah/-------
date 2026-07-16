/**
 * REST API сайта СХМ Агро.
 * Запуск: npm run dev:server  (порт 3001, клиент проксирует /api сюда)
 *
 * Базы данных нет: данные лежат в data/store.json (см. server/store.js).
 * Сервер ходит только через методы store.* — когда будем подключать БД,
 * меняется один store.js, эндпоинты остаются как есть.
 */
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as store from './store.js'
import * as ai from './ai.js'
import { REGIONS } from './seed.js'

const { seeded } = store.load()

const app = express()
// gzip: JSON-ответы сжимаются в 3–5 раз, а каталог со спеками весит заметно.
app.use(compression())
// Кого пускаем к API. По умолчанию — только vite-клиент; на проде
// в CORS_ORIGIN указывают домен сайта. '*' открывает API всем.
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((s) => s.trim()) }))
app.use(express.json({ limit: '64kb' }))
// ETag: повторные GET получают 304 вместо тела ответа.
app.set('etag', 'strong')
app.disable('x-powered-by')

// Базовые защитные заголовки — без лишних зависимостей.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

const PORT = process.env.PORT || 3001

/**
 * Ограничитель частоты по IP. Формы заявок открыты всему интернету —
 * без него база забивается спамом, а пароль админки перебирается.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    let rec = hits.get(ip)
    if (!rec || now > rec.reset) {
      rec = { count: 0, reset: now + windowMs }
      hits.set(ip, rec)
    }
    rec.count += 1
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000))
      return res.status(429).json({ error: message })
    }
    // Подчищаем протухшие записи, чтобы Map не рос бесконечно.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k)
    }
    next()
  }
}

const limitRequests = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Слишком много заявок подряд. Попробуйте через несколько минут или позвоните нам.',
})

const limitLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Слишком много попыток входа. Подождите 15 минут.',
})

// Чат открыт всем — бережём и кошелёк, и сервер.
const limitChat = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Слишком много сообщений подряд. Подождите минуту.',
})

const limitAnalyze = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Анализ уже запускался. Подождите минуту.',
})

/* ------------------------------- утилиты ------------------------------- */

/** Обрезает строку по длине и убирает управляющие символы. */
const clean = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : ''

/**
 * Пароль админки: значение из .env перекрывает то, что лежит в данных.
 * Так пароль можно менять на сервере, не трогая контент.
 */
const adminPassword = () => process.env.ADMIN_PASSWORD || store.settings.get('admin_password')

/** Токен сессии админа — производная от пароля, живёт до перезапуска сервера. */
const tokenFor = (password) => createHash('sha256').update(`shm-agro:${password}`).digest('hex')

const requireAdmin = (req, res, next) => {
  const sent = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (sent && sent === tokenFor(adminPassword())) return next()
  res.status(401).json({ error: 'Требуется вход в админку' })
}

/** Оборачивает обработчик, чтобы ошибка превращалась в 500, а не роняла процесс. */
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (e) {
    console.error('API error:', e)
    res.status(500).json({ error: 'Внутренняя ошибка сервера' })
  }
}

/* --------------------------------- auth -------------------------------- */

app.post('/api/login', limitLogin, wrap((req, res) => {
  const { password } = req.body || {}
  if (password && password === adminPassword()) {
    return res.json({ token: tokenFor(password) })
  }
  res.status(401).json({ error: 'Неверный пароль' })
}))

/* -------------------------- агрегат для главной ------------------------- */

/**
 * Главной нужны настройки, показатели, услуги, сертификаты и три новости.
 * Отдаём одним ответом — вместо пяти запросов подряд.
 */
app.get('/api/home', wrap((_req, res) => {
  res.json({
    settings: store.settings.publicAll(),
    stats: store.stats.all(),
    services: store.services.all(),
    certs: store.certs.all(),
    news: store.news.all({ limit: 3 }),
  })
}))

/* ------------------------------ справочники ---------------------------- */

app.get('/api/categories', wrap((_req, res) => res.json(store.categories.all())))
app.get('/api/regions', wrap((_req, res) => res.json(REGIONS)))
app.get('/api/certs', wrap((_req, res) => res.json(store.certs.all())))
app.get('/api/stats', wrap((_req, res) => res.json(store.stats.all())))
app.get('/api/services', wrap((_req, res) => res.json(store.services.all())))

app.put('/api/services/:id', requireAdmin, wrap((req, res) => {
  const s = store.services.update(req.params.id, req.body || {})
  if (!s) return res.status(404).json({ error: 'Услуга не найдена' })
  res.json(s)
}))

/* -------------------------------- модели ------------------------------- */

app.get('/api/models', wrap((req, res) => {
  res.json(store.models.all({ cat: req.query.cat, includeUnpublished: !!req.query.all }))
}))

app.get('/api/models/:id', wrap((req, res) => {
  const m = store.models.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'Модель не найдена' })
  res.json(m)
}))

app.post('/api/models', requireAdmin, wrap((req, res) => {
  const { name, cat } = req.body || {}
  if (!name || !cat) return res.status(400).json({ error: 'Укажите название и категорию' })
  if (!store.categories.exists(cat)) return res.status(400).json({ error: 'Неизвестная категория' })
  res.status(201).json(store.models.create(req.body))
}))

app.put('/api/models/:id', requireAdmin, wrap((req, res) => {
  const b = req.body || {}
  if (b.cat && !store.categories.exists(b.cat)) {
    return res.status(400).json({ error: 'Неизвестная категория' })
  }
  const m = store.models.update(req.params.id, b)
  if (!m) return res.status(404).json({ error: 'Модель не найдена' })
  res.json(m)
}))

app.delete('/api/models/:id', requireAdmin, wrap((req, res) => {
  if (!store.models.remove(req.params.id)) {
    return res.status(404).json({ error: 'Модель не найдена' })
  }
  res.json({ ok: true })
}))

/* -------------------------------- новости ------------------------------ */

app.get('/api/news', wrap((req, res) => {
  res.json(
    store.news.all({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      includeUnpublished: !!req.query.all,
    })
  )
}))

app.get('/api/news/:id', wrap((req, res) => {
  const n = store.news.get(req.params.id)
  if (!n) return res.status(404).json({ error: 'Статья не найдена' })
  res.json(n)
}))

app.post('/api/news', requireAdmin, wrap((req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: 'Укажите заголовок' })
  res.status(201).json(store.news.create(req.body))
}))

app.put('/api/news/:id', requireAdmin, wrap((req, res) => {
  const n = store.news.update(req.params.id, req.body || {})
  if (!n) return res.status(404).json({ error: 'Статья не найдена' })
  res.json(n)
}))

app.delete('/api/news/:id', requireAdmin, wrap((req, res) => {
  if (!store.news.remove(req.params.id)) {
    return res.status(404).json({ error: 'Статья не найдена' })
  }
  res.json({ ok: true })
}))

/* -------------------------------- заявки ------------------------------- */

app.get('/api/requests', requireAdmin, wrap((_req, res) => res.json(store.requests.all())))

// Публичный: формы КП / звонка / обратной связи. Открыт всему интернету,
// поэтому здесь и ограничитель частоты, и обрезка полей по длине.
app.post('/api/requests', limitRequests, wrap((req, res) => {
  const { type, modelId, region, meta } = req.body || {}
  const fio = clean(req.body?.fio, 100)
  const phone = clean(req.body?.phone, 40)
  const comment = clean(req.body?.comment, 1000)

  if (!fio || !phone) return res.status(400).json({ error: 'Укажите имя и телефон' })

  let metaText = clean(meta, 200) || '—'
  if (type === 'КП') {
    const m = modelId ? store.models.get(modelId) : null
    metaText = `${m ? m.name : 'Общая заявка'} · ${clean(region, 60) || '—'}`
  }

  res.status(201).json(store.requests.create({ type, fio, phone, meta: metaText, comment }))
}))

app.patch('/api/requests/:id', requireAdmin, wrap((req, res) => {
  const allowed = ['Новая', 'В работе', 'Обработана']
  if (!allowed.includes(req.body?.status)) {
    return res.status(400).json({ error: 'Недопустимый статус' })
  }
  const r = store.requests.setStatus(req.params.id, req.body.status)
  if (!r) return res.status(404).json({ error: 'Заявка не найдена' })
  res.json(r)
}))

app.delete('/api/requests/:id', requireAdmin, wrap((req, res) => {
  if (!store.requests.remove(req.params.id)) {
    return res.status(404).json({ error: 'Заявка не найдена' })
  }
  res.json({ ok: true })
}))

/* ------------------------------- настройки ----------------------------- */

app.get('/api/settings', wrap((_req, res) => res.json(store.settings.publicAll())))

app.put('/api/settings', requireAdmin, wrap((req, res) => {
  res.json(store.settings.update(req.body || {}))
}))

/* ---------------------------------- ИИ --------------------------------- */

/** Включён ли ИИ — интерфейс показывает это честно, а не притворяется. */
app.get('/api/ai/status', wrap((_req, res) => {
  const engine = ai.aiEngine()
  res.json({
    enabled: ai.aiEnabled(),
    engine,
    hint: ai.aiEnabled()
      ? `ИИ подключён: ${engine}.`
      : 'ИИ не подключён: работают правила. Добавьте GEMINI_API_KEY или OPENAI_API_KEY в .env.',
  })
}))

app.post('/api/ai/analyze-leads', requireAdmin, limitAnalyze, wrap(async (_req, res) => {
  res.json(await ai.analyzeLeads())
}))

app.post('/api/ai/chat', limitChat, wrap(async (req, res) => {
  const message = clean(req.body?.message, 2000)
  if (!message) return res.status(400).json({ error: 'Пустое сообщение' })
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : []
  res.json(await ai.chat(message, history))
}))

/* -------------------------------- сводка ------------------------------- */

app.get('/api/admin/summary', requireAdmin, wrap((_req, res) => {
  const requests = store.requests.all()
  res.json({
    models: store.models.all({ includeUnpublished: true }).length,
    news: store.news.all({ includeUnpublished: true }).length,
    requests: requests.length,
    newRequests: requests.filter((r) => r.status === 'Новая').length,
  })
}))

/* ------------------------- отдача собранного сайта ---------------------- */

/**
 * В разработке фронтенд отдаёт Vite (npm run dev:client).
 * Если рядом лежит dist/ (после npm run build) — сервер отдаёт и его,
 * чтобы прод крутился на одном порту.
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(DIST)) {
  // Ассеты именованы с хешем — кешируем их надолго.
  app.use('/assets', express.static(join(DIST, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(DIST, { maxAge: '1h' }))
  // SPA: любой не-API маршрут отдаёт index.html.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(DIST, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`✓ API СХМ Агро слушает http://localhost:${PORT}`)
  console.log(`  Данные: ${store.STORE_PATH}${seeded ? ' (создан из начальных)' : ''}`)
  console.log(
    `  ИИ: ${ai.aiEnabled() ? ai.aiEngine() + ' подключён' : 'правила (ключи не заданы)'}`
  )
  if (existsSync(DIST)) console.log(`  Собранный сайт: http://localhost:${PORT}`)
})
