/**
 * REST API сайта СХМ Агро.
 * Запуск: npm run dev:server  (порт 3001, клиент проксирует /api сюда)
 */
import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db, DB_PATH } from './db.js'
import { REGIONS } from './seed.js'

if (!existsSync(DB_PATH)) {
  console.error('✖ База данных не найдена. Сначала выполните:  npm run init-db')
  process.exit(1)
}

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

/** Обрезает строку и убирает управляющие символы. */
const clean = (v, max) =>
  typeof v === 'string'
    ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
    : ''

/* ------------------------------- утилиты ------------------------------- */

/**
 * Кеш подготовленных запросов: db.prepare() компилирует SQL заново на каждом
 * вызове, а набор запросов у нас фиксированный.
 */
const stmtCache = new Map()
const q = (sql) => {
  let st = stmtCache.get(sql)
  if (!st) {
    st = db.prepare(sql)
    stmtCache.set(sql, st)
  }
  return st
}

const getSetting = (key) =>
  q('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? ''

/**
 * Пароль админки: значение из .env перекрывает то, что лежит в базе.
 * Так пароль можно менять на сервере, не трогая данные.
 */
const adminPassword = () => process.env.ADMIN_PASSWORD || getSetting('admin_password')

const rowToModel = (r) =>
  r && { ...r, specs: JSON.parse(r.specs), subsidized: !!r.subsidized, published: !!r.published }

const rowToNews = (r) =>
  r && { ...r, body: JSON.parse(r.body), published: !!r.published }

const today = () => new Date().toISOString().slice(0, 10)

/** Токен сессии админа — производная от пароля, живёт до перезапуска сервера. */
const tokenFor = (password) =>
  createHash('sha256').update(`shm-agro:${password}`).digest('hex')

const requireAdmin = (req, res, next) => {
  const sent = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (sent && sent === tokenFor(adminPassword())) return next()
  res.status(401).json({ error: 'Требуется вход в админку' })
}

/** Оборачивает обработчик, чтобы ошибка превращалась в 500, а не роняла процесс. */
const wrap = (fn) => (req, res) => {
  try {
    fn(req, res)
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
 * Главная странице нужны настройки, показатели, услуги, сертификаты и
 * три новости. Отдаём одним ответом — вместо пяти запросов подряд.
 */
app.get('/api/home', wrap((_req, res) => {
  const settingsRows = q("SELECT key, value FROM settings WHERE key != 'admin_password'").all()
  res.json({
    settings: Object.fromEntries(settingsRows.map((r) => [r.key, r.value])),
    stats: q('SELECT * FROM stats ORDER BY sort').all(),
    services: q('SELECT * FROM services ORDER BY sort').all(),
    certs: q('SELECT * FROM certs ORDER BY sort').all(),
    news: q('SELECT * FROM news WHERE published = 1 ORDER BY date DESC LIMIT 3').all().map(rowToNews),
  })
}))

/* ------------------------------ справочники ---------------------------- */

app.get('/api/categories', wrap((_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort').all())
}))

app.get('/api/regions', wrap((_req, res) => res.json(REGIONS)))

app.get('/api/certs', wrap((_req, res) => {
  res.json(db.prepare('SELECT * FROM certs ORDER BY sort').all())
}))

app.get('/api/stats', wrap((_req, res) => {
  res.json(db.prepare('SELECT * FROM stats ORDER BY sort').all())
}))

/* -------------------------------- услуги ------------------------------- */

app.get('/api/services', wrap((_req, res) => {
  res.json(db.prepare('SELECT * FROM services ORDER BY sort').all())
}))

app.put('/api/services/:id', requireAdmin, wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id)
  if (!cur) return res.status(404).json({ error: 'Услуга не найдена' })
  const b = req.body || {}
  db.prepare('UPDATE services SET icon = ?, title = ?, text = ?, note = ? WHERE id = ?').run(
    b.icon ?? cur.icon,
    b.title ?? cur.title,
    b.text ?? cur.text,
    b.note ?? cur.note,
    req.params.id
  )
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id))
}))

/* -------------------------------- модели ------------------------------- */

app.get('/api/models', wrap((req, res) => {
  const { cat, all } = req.query
  const where = []
  const args = []
  if (!all) where.push('published = 1')
  if (cat && cat !== 'all') {
    where.push('cat = ?')
    args.push(cat)
  }
  const sql =
    `SELECT m.*, c.name AS catName FROM models m
     JOIN categories c ON c.id = m.cat
     ${where.length ? 'WHERE ' + where.map((w) => `m.${w}`).join(' AND ') : ''}
     ORDER BY m.sort, m.created_at`
  res.json(db.prepare(sql).all(...args).map(rowToModel))
}))

app.get('/api/models/:id', wrap((req, res) => {
  const row = db
    .prepare(
      `SELECT m.*, c.name AS catName FROM models m
       JOIN categories c ON c.id = m.cat WHERE m.id = ?`
    )
    .get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Модель не найдена' })
  res.json(rowToModel(row))
}))

app.post('/api/models', requireAdmin, wrap((req, res) => {
  const { name, cat, short, descr, specs, subsidized, photo, published } = req.body || {}
  if (!name || !cat) return res.status(400).json({ error: 'Укажите название и категорию' })
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat)) {
    return res.status(400).json({ error: 'Неизвестная категория' })
  }
  const id = 'm' + randomUUID().slice(0, 8)
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM models').get().s
  db.prepare(
    `INSERT INTO models (id, name, cat, photo, short, descr, specs, subsidized, published, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name, cat, photo || null,
    short || 'Новая модель (черновик).',
    descr || 'Описание появится позже.',
    JSON.stringify(specs || []),
    subsidized ? 1 : 0,
    published === false ? 0 : 1,
    maxSort + 1
  )
  res.status(201).json(rowToModel(db.prepare('SELECT * FROM models WHERE id = ?').get(id)))
}))

app.put('/api/models/:id', requireAdmin, wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id)
  if (!cur) return res.status(404).json({ error: 'Модель не найдена' })
  const b = req.body || {}
  const cat = b.cat ?? cur.cat
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cat)) {
    return res.status(400).json({ error: 'Неизвестная категория' })
  }
  db.prepare(
    `UPDATE models SET name = ?, cat = ?, photo = ?, short = ?, descr = ?,
     specs = ?, subsidized = ?, published = ? WHERE id = ?`
  ).run(
    b.name ?? cur.name,
    cat,
    b.photo !== undefined ? b.photo || null : cur.photo,
    b.short ?? cur.short,
    b.descr ?? cur.descr,
    b.specs !== undefined ? JSON.stringify(b.specs) : cur.specs,
    b.subsidized !== undefined ? (b.subsidized ? 1 : 0) : cur.subsidized,
    b.published !== undefined ? (b.published ? 1 : 0) : cur.published,
    req.params.id
  )
  res.json(rowToModel(db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id)))
}))

app.delete('/api/models/:id', requireAdmin, wrap((req, res) => {
  const info = db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Модель не найдена' })
  res.json({ ok: true })
}))

/* -------------------------------- новости ------------------------------ */

app.get('/api/news', wrap((req, res) => {
  const { limit, all } = req.query
  let sql = `SELECT * FROM news ${all ? '' : 'WHERE published = 1'} ORDER BY date DESC`
  const args = []
  if (limit) {
    sql += ' LIMIT ?'
    args.push(Number(limit))
  }
  res.json(db.prepare(sql).all(...args).map(rowToNews))
}))

app.get('/api/news/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Статья не найдена' })
  res.json(rowToNews(row))
}))

app.post('/api/news', requireAdmin, wrap((req, res) => {
  const { title, date, excerpt, body, cover, published } = req.body || {}
  if (!title) return res.status(400).json({ error: 'Укажите заголовок' })
  const id = 'n' + randomUUID().slice(0, 8)
  db.prepare(
    'INSERT INTO news (id, date, title, excerpt, body, cover, published) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    date || today(),
    title,
    excerpt || 'Черновик статьи.',
    JSON.stringify(body?.length ? body : ['Текст статьи появится позже.']),
    cover || null,
    published === false ? 0 : 1
  )
  res.status(201).json(rowToNews(db.prepare('SELECT * FROM news WHERE id = ?').get(id)))
}))

app.put('/api/news/:id', requireAdmin, wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id)
  if (!cur) return res.status(404).json({ error: 'Статья не найдена' })
  const b = req.body || {}
  db.prepare(
    'UPDATE news SET date = ?, title = ?, excerpt = ?, body = ?, cover = ?, published = ? WHERE id = ?'
  ).run(
    b.date ?? cur.date,
    b.title ?? cur.title,
    b.excerpt ?? cur.excerpt,
    b.body !== undefined ? JSON.stringify(b.body) : cur.body,
    b.cover !== undefined ? b.cover || null : cur.cover,
    b.published !== undefined ? (b.published ? 1 : 0) : cur.published,
    req.params.id
  )
  res.json(rowToNews(db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id)))
}))

app.delete('/api/news/:id', requireAdmin, wrap((req, res) => {
  const info = db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Статья не найдена' })
  res.json({ ok: true })
}))

/* -------------------------------- заявки ------------------------------- */

app.get('/api/requests', requireAdmin, wrap((_req, res) => {
  res.json(db.prepare('SELECT * FROM requests ORDER BY created_at DESC, date DESC').all())
}))

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
    const m = modelId ? q('SELECT name FROM models WHERE id = ?').get(modelId) : null
    metaText = `${m ? m.name : 'Общая заявка'} · ${clean(region, 60) || '—'}`
  }

  const id = 'r' + randomUUID().slice(0, 8)
  q(
    'INSERT INTO requests (id, date, type, fio, phone, meta, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, today(), type === 'КП' ? 'КП' : 'Звонок', fio, phone, metaText, comment, 'Новая')

  res.status(201).json(q('SELECT * FROM requests WHERE id = ?').get(id))
}))

app.patch('/api/requests/:id', requireAdmin, wrap((req, res) => {
  const { status } = req.body || {}
  const allowed = ['Новая', 'В работе', 'Обработана']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' })
  const info = db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Заявка не найдена' })
  res.json(db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id))
}))

app.delete('/api/requests/:id', requireAdmin, wrap((req, res) => {
  const info = db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: 'Заявка не найдена' })
  res.json({ ok: true })
}))

/* ------------------------------- настройки ----------------------------- */

// Пароль админки наружу не отдаём.
app.get('/api/settings', wrap((_req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key != 'admin_password'").all()
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
}))

app.put('/api/settings', requireAdmin, wrap((req, res) => {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [k, v] of Object.entries(req.body || {})) {
    if (k === 'admin_password') continue
    stmt.run(k, String(v))
  }
  const rows = db.prepare("SELECT key, value FROM settings WHERE key != 'admin_password'").all()
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
}))

/* -------------------------------- сводка ------------------------------- */

app.get('/api/admin/summary', requireAdmin, wrap((_req, res) => {
  res.json({
    models: db.prepare('SELECT COUNT(*) AS n FROM models').get().n,
    news: db.prepare('SELECT COUNT(*) AS n FROM news').get().n,
    requests: db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,
    newRequests: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status = 'Новая'").get().n,
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
  app.use(
    '/assets',
    express.static(join(DIST, 'assets'), { immutable: true, maxAge: '1y' })
  )
  app.use(express.static(DIST, { maxAge: '1h' }))
  // SPA: любой не-API маршрут отдаёт index.html.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(DIST, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`✓ API СХМ Агро слушает http://localhost:${PORT}`)
  console.log(`  База: ${DB_PATH}`)
  if (existsSync(DIST)) console.log(`  Собранный сайт: http://localhost:${PORT}`)
})
