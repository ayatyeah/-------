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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as store from './store.js'
import * as ai from './ai.js'
import * as uploads from './uploads.js'
import { notifyNewRequest } from './notify.js'

const { seeded, recovered } = store.load()

/* Страховочное сохранение раз в минуту. SIGTERM приходит не всегда:
   при kill -9, срабатывании OOM-killer или пропаже питания на VPS его нет,
   и всё, что накопилось в 150-мс окне отложенной записи, терялось. */
store.startAutosave()

const app = express()

/* Доверие заголовку X-Forwarded-For — ТОЛЬКО когда сайт реально стоит за
   прокси. Это критично для безопасности: если доверять XFF всегда, а
   приложение открыто напрямую, любой клиент подделает заголовок случайным
   адресом и обойдёт все лимиты частоты — безлимитный перебор пароля, спам
   заявками и слив бюджета ИИ через открытый чат.

   Поэтому доверие включает только переменная TRUST_PROXY=1, и ставит её
   docker compose, где перед приложением всегда стоит Caddy. При прямом
   запуске (dev, показ по IP) XFF игнорируется и лимиты считаются по
   настоящему адресу сокета. */
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)

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

/* Политика ресурсов (CSP). Всё своё, со своего же домена: скрипты и стили
   собраны Vite, шрифты и картинки лежат в /assets и /fonts, запросы ИИ идут
   на свой же /api. Отсюда почти везде 'self'.
   - style-src разрешает inline: React расставляет стили через style={{…}},
     это inline-атрибуты, без 'unsafe-inline' они бы отвалились;
   - script-src БЕЗ inline: исполняемых инлайн-скриптов на странице нет
     (JSON-LD — это данные, не скрипт), поэтому строгий 'self';
   - object/base/frame-ancestors закрыты: ни встраиваний, ни подмены base,
     ни показа сайта в чужом iframe (кликджекинг). */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Добавлено вместе с загрузкой картинок: даже если в каталог загрузок
  // однажды попадёт html-подобный файл, он не сможет ни открыться рамкой,
  // ни запустить воркер, ни утащить страницу в другой контекст.
  "frame-src 'none'",
  "worker-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
].join('; ')

// Защитные заголовки — без лишних зависимостей.
const PROD = process.env.NODE_ENV === 'production'
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', CSP)
  /* Отключаем то, чем сайт не пользуется. Без этого заголовка любой
     сторонний код на странице (например, попавший через будущий виджет)
     может молча запросить камеру, микрофон или геопозицию посетителя. */
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  )
  // Чужие сайты не должны подтягивать наши картинки и ответы API к себе.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  // HSTS только на проде за HTTPS: на localhost без TLS он бы намертво
  // заставил браузер ходить по https и сломал бы разработку.
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})

/* Cache-Control для /api по умолчанию.
 *
 * Ответ без Cache-Control, но с сильным ETag (см. app.set('etag', 'strong')
 * выше) — это приглашение к эвристическому кешированию: браузер и любые
 * промежуточные кеши вправе сами решать, сколько считать его свежим.
 * Практическое следствие: правка в админке не видна на сайте без жёсткого
 * обновления.
 *
 * no-cache — не «не кешировать», а «перед показом спроси, не устарел ли».
 * С сильным ETag это дешёвый 304 без тела, а правка видна сразу.
 * Для маршрутов за requireAdmin ниже это переопределяется на no-store —
 * там персональные данные заявок и секреты, которым в кеше не место вовсе. */
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache')
  next()
})

const PORT = process.env.PORT || 3001

/* Слушаем на всех интерфейсах явно.
   В контейнере (Railway, Docker) запросы приходят снаружи, и привязка к
   localhost сделала бы сервис недоступным при живом процессе. */
const HOST = process.env.HOST || '0.0.0.0'

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

/* Общий потолок на всё API.
   Дыра, которая закрывается: точечные лимиты стояли только на входе,
   заявках и ИИ. Открытые GET (/api/models, /api/home, /api/sitemap) были
   без ограничений вовсе — а они читают данные из памяти и сериализуют
   JSON. Скрипт в один поток забивал процессор и клал сайт для всех
   остальных, не имея ни пароля, ни какого-либо доступа.

   Порог высокий: живой посетитель, открыв каталог, тратит десяток
   запросов, а SPA докладывает данные при переходах. 300/мин с одного
   адреса человеку не достичь, автоматическому обстрелу — мгновенно. */
const limitGlobal = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL || 300),
  message: 'Слишком много запросов. Подождите минуту.',
})

/* Запись в админке. Токен есть только у своих, но украденный или
   оставленный в чужом браузере токен не должен позволять стереть каталог
   в тысячу запросов за секунду. */
const limitAdminWrite = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Слишком много изменений подряд. Подождите минуту.',
})

/* Загрузка картинок: даже свой человек не грузит больше пары десятков
   снимков в минуту, а вот скрипт забьёт диск за минуты. Диск кончится —
   перестанет писаться store.json, то есть перестанут приниматься заявки. */
const limitUpload = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Слишком много загрузок подряд. Подождите немного.',
})

/**
 * Суточный потолок обращений к ИИ.
 *
 * Чат на главной открыт всему интернету, а каждый ответ стоит денег.
 * Лимит частоты по адресу от этого не спасает: тысяча адресов — тысяча
 * ведёрок. Здесь общий счётчик на весь сайт: исчерпан — чат продолжает
 * работать на правилах, без ИИ. Сайт не ломается, счёт не растёт.
 */
const AI_DAILY_MAX = Number(process.env.AI_DAILY_LIMIT || 500)
let aiDay = ''
let aiUsedToday = 0

function aiBudgetLeft() {
  const day = new Date().toISOString().slice(0, 10)
  if (day !== aiDay) {
    aiDay = day
    aiUsedToday = 0
  }
  return AI_DAILY_MAX - aiUsedToday
}
const aiBudgetTake = () => {
  aiBudgetLeft()
  aiUsedToday += 1
}

/* Общий лимит вешаем на всё дерево /api до объявления маршрутов —
   так под ним оказывается и то, что появится позже. */
app.use('/api', limitGlobal)

/* ------------------------------- утилиты ------------------------------- */

/* Редакция политики конфиденциальности. Записывается в каждую заявку рядом
   с временем согласия, чтобы потом было видно, с какой именно версией текста
   человек согласился.
   Меняете текст политики — поднимите дату и здесь, и в src/pages/Privacy.jsx
   (константа PRIVACY_VERSION там же). */
const PRIVACY_VERSION = '2026-07-24'

/** Обрезает строку по длине и убирает управляющие символы. */
const clean = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : ''

/**
 * Пароль админки.
 *
 * Порядок такой: если заказчик задал свой пароль через админку — работает
 * только он (в данных лежит scrypt-хэш, не сам пароль). Пока свой пароль
 * не задан, действует ADMIN_PASSWORD из окружения: это первый вход и
 * способ восстановления, если пароль забыли (см. npm run reset-password).
 *
 * Почему так, а не «переменная всегда главнее»: пока пароль жил только в
 * .env, сменить его означало зайти по SSH и перезапустить контейнер.
 * Заказчик этого не делает никогда — в том числе после увольнения
 * сотрудника, который пароль знал.
 */
/* Только из окружения. Раньше был запасной путь через настройки, но он
   означал пароль открытым текстом в файле данных и в каждой резервной копии.
   Свой пароль владелец задаёт в админке — он хранится хэшем (см. store.auth). */
const adminPassword = () => process.env.ADMIN_PASSWORD || ''

/** Проверка введённого пароля — по хэшу, если он задан, иначе по .env. */
function passwordOk(password) {
  if (!password) return false
  if (store.auth.hasPassword()) return store.auth.verify(password)
  const expected = adminPassword()
  return !!expected && safeEqual(password, expected)
}

/* На проде вход должен быть закрыт, пока пароль стандартный или пустой:
   иначе публичный сайт со стандартным «admin» пускает в админку кого угодно.
   Проверяем именно при попытке входа (а не при старте): падение процесса
   уронило бы весь сайт и загнало compose в цикл перезапусков — форма заявки
   и каталог должны работать независимо от того, настроен ли вход. */
const loginLocked = () =>
  PROD && !store.auth.hasPassword() && (!adminPassword() || adminPassword() === 'admin')

/* ─── Сессия админки ────────────────────────────────────────────────────
   Раньше токен был просто sha256('shm-agro:' + пароль): без срока жизни, один
   и тот же при каждом входе, и по сути равный хэшу пароля. Утечка такого
   токена (localStorage, чужой компьютер, лог) = утечка пароля навсегда,
   отозвать его нельзя.

   Теперь токен подписан и ограничен по времени: payload с меткой истечения +
   HMAC-подпись. Ключ подписи привязан и к паролю — сменили ADMIN_PASSWORD,
   и все прежние сессии мертвы. Токен уже не восстанавливает пароль и сам
   протухает.

   SESSION_SECRET берём из JWT_SECRET; если он не задан — разовый ключ на
   запуск. Тогда сессии не переживают перезапуск (после каждого деплоя вход
   заново) — не идеально для удобства, но безопасно; чтобы сессии жили,
   задайте JWT_SECRET. */
const SESSION_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex')
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 12) * 3600 * 1000

/* Ключ подписи зависит и от секрета, и от действующего пароля: сменили
   пароль (хоть в админке, хоть в .env) — все выданные ранее токены сразу
   становятся недействительными. Это и есть «выйти со всех устройств». */
const signingKey = () =>
  createHmac('sha256', SESSION_SECRET)
    .update('sess:' + adminPassword() + ':' + store.auth.fingerprint())
    .digest()

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/**
 * Сравнение за постоянное время. Обе стороны сводим к 32-байтному дайджесту:
 * timingSafeEqual требует равной длины, а так не течёт ни содержимое, ни
 * длина исходных строк.
 */
function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest()
  const hb = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(ha, hb)
}

/** Выдаёт подписанный токен со сроком жизни. */
function issueToken(ttl = SESSION_TTL_MS) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + ttl }))
  const sig = b64url(createHmac('sha256', signingKey()).update(payload).digest())
  return `${payload}.${sig}`
}

/** Проверяет подпись и срок. Любая нестыковка — false, без подробностей. */
function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = b64url(createHmac('sha256', signingKey()).update(payload).digest())
  if (!safeEqual(sig, expected)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

/** Есть ли у запроса валидный токен админа. Для эндпоинтов, где доступ к
    неопубликованному разрешён только своим, а публика видит лишь опубликованное. */
const isAdmin = (req) => {
  const sent = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return !!sent && verifyToken(sent)
}

const requireAdmin = (req, res, next) => {
  // Персональные данные заявок и секреты не должны оседать ни в браузере,
  // ни в промежуточных кешах — ни при успехе, ни при отказе в 401.
  res.setHeader('Cache-Control', 'no-store')
  if (isAdmin(req)) return next()
  res.status(401).json({ error: 'Требуется вход в админку' })
}

/** Оборачивает обработчик, чтобы ошибка превращалась в ответ, а не роняла процесс.
 *
 *  Проверки в хранилище бросают ошибки с полем status и человеческим
 *  текстом («Категорий уже максимум»). Их и показываем: раньше любая такая
 *  ошибка превращалась в безликую 500, и в админке было непонятно, что
 *  именно не так. Всё, у чего status нет, — это уже настоящий сбой:
 *  в лог подробности, наружу общая формулировка. */
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (e) {
    if (e?.status && e.status >= 400 && e.status < 500) {
      if (!res.headersSent) res.status(e.status).json({ error: e.message })
      return
    }
    console.error('API error:', e)
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера' })
  }
}

/* --------------------------------- auth -------------------------------- */

app.post('/api/login', limitLogin, wrap((req, res) => {
  // Токен в ответе — секрет не хуже пароля, кешу его показывать незачем.
  res.setHeader('Cache-Control', 'no-store')
  // Пока пароль не сменили со стандартного — на проде вход закрыт целиком.
  if (loginLocked()) {
    return res.status(503).json({
      error: 'Вход в админку не настроен. Задайте свой ADMIN_PASSWORD на сервере.',
    })
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (passwordOk(password)) {
    return res.json({
      token: issueToken(),
      expiresInHours: SESSION_TTL_MS / 3600000,
      // Подсказка панели: пароль всё ещё из .env, свой не задан.
      ownPassword: store.auth.hasPassword(),
    })
  }
  res.status(401).json({ error: 'Неверный пароль' })
}))

/**
 * Смена пароля прямо из админки.
 *
 * Требуем текущий пароль, даже когда человек уже вошёл: иначе оставленная
 * открытой вкладка (или украденный токен) даёт возможность сменить пароль
 * и запереть настоящего владельца снаружи.
 */
app.post('/api/admin/password', requireAdmin, limitLogin, wrap((req, res) => {
  const current = typeof req.body?.current === 'string' ? req.body.current : ''
  const next = typeof req.body?.next === 'string' ? req.body.next : ''

  if (!passwordOk(current)) {
    return res.status(401).json({ error: 'Текущий пароль не подошёл' })
  }
  if (next.length < 10) {
    return res.status(400).json({ error: 'Новый пароль должен быть не короче 10 символов' })
  }
  if (next.length > 200) {
    return res.status(400).json({ error: 'Слишком длинный пароль' })
  }
  if (next === current) {
    return res.status(400).json({ error: 'Новый пароль совпадает с текущим' })
  }

  store.auth.set(next)
  // Ключ подписи привязан к паролю, поэтому старые токены (включая наш
  // собственный) уже недействительны — панель попросит войти заново.
  res.json({ ok: true, relogin: true })
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
app.get('/api/regions', wrap((_req, res) => res.json(store.regions.all())))
app.get('/api/certs', wrap((_req, res) => res.json(store.certs.all())))
app.get('/api/stats', wrap((_req, res) => res.json(store.stats.all())))
app.get('/api/services', wrap((_req, res) => res.json(store.services.all())))

/* ─── Категории («типы товара») ─────────────────────────────────────────
   Раньше их набор был зашит в seed.js: чтобы завести пятую категорию,
   нужен был программист и деплой. Теперь заказчик делает это сам. */

app.post('/api/categories', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.status(201).json(store.categories.create(req.body || {}))
}))

app.put('/api/categories/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const c = store.categories.update(req.params.id, req.body || {})
  if (!c) return res.status(404).json({ error: 'Категория не найдена' })
  res.json(c)
}))

/**
 * Удаление категории. Модели без категории превратились бы в невидимый
 * мусор (каталог фильтрует по категориям), поэтому либо категория пуста,
 * либо в запросе сказано, куда перенести технику.
 */
app.delete('/api/categories/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const r = store.categories.remove(req.params.id, req.query.moveTo || null)
  if (r.ok) return res.json({ ok: true, moved: r.moved })
  if (r.reason === 'not-found') return res.status(404).json({ error: 'Категория не найдена' })
  res.status(409).json({
    error: `В категории ещё ${r.count} модел${r.count === 1 ? 'ь' : 'и'}. Выберите, куда их перенести.`,
    count: r.count,
  })
}))

app.post('/api/categories/reorder', requireAdmin, limitAdminWrite, wrap((req, res) => {
  store.categories.reorder(req.body?.ids)
  res.json(store.categories.all())
}))

/* ─── Услуги ────────────────────────────────────────────────────────────
   Было: только правка текстов у шести неизменяемых карточек. */

app.post('/api/services', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.status(201).json(store.services.create(req.body || {}))
}))

app.put('/api/services/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const s = store.services.update(req.params.id, req.body || {})
  if (!s) return res.status(404).json({ error: 'Услуга не найдена' })
  res.json(s)
}))

app.delete('/api/services/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.services.remove(req.params.id)) {
    return res.status(404).json({ error: 'Услуга не найдена' })
  }
  res.json({ ok: true })
}))

app.post('/api/services/reorder', requireAdmin, limitAdminWrite, wrap((req, res) => {
  store.services.reorder(req.body?.ids)
  res.json(store.services.all())
}))

/* ─── Показатели и сертификаты ──────────────────────────────────────────
   В ревью помечены как выдуманные («18 лет», «12 400+ единиц») и подлежат
   замене перед запуском. Пока они лежали в коде, «заменить» означало
   «позвать разработчика». */

app.post('/api/stats', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.status(201).json(store.stats.create(req.body || {}))
}))
app.put('/api/stats/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const s = store.stats.update(req.params.id, req.body || {})
  if (!s) return res.status(404).json({ error: 'Показатель не найден' })
  res.json(s)
}))
app.delete('/api/stats/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.stats.remove(req.params.id)) return res.status(404).json({ error: 'Показатель не найден' })
  res.json({ ok: true })
}))
app.post('/api/stats/reorder', requireAdmin, limitAdminWrite, wrap((req, res) => {
  store.stats.reorder(req.body?.ids)
  res.json(store.stats.all())
}))

app.post('/api/certs', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.status(201).json(store.certs.create(req.body || {}))
}))
app.put('/api/certs/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const c = store.certs.update(req.params.id, req.body || {})
  if (!c) return res.status(404).json({ error: 'Документ не найден' })
  res.json(c)
}))
app.delete('/api/certs/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.certs.remove(req.params.id)) return res.status(404).json({ error: 'Документ не найден' })
  res.json({ ok: true })
}))
app.post('/api/certs/reorder', requireAdmin, limitAdminWrite, wrap((req, res) => {
  store.certs.reorder(req.body?.ids)
  res.json(store.certs.all())
}))

/* ─── Регионы формы КП ──────────────────────────────────────────────────
   Список заменяется целиком: в админке это одно поле, где области идут
   построчно — так проще, чем заводить карточку на каждую строку. */
app.put('/api/regions', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.json(store.regions.replace(req.body?.regions))
}))

/* -------------------------------- модели ------------------------------- */

app.get('/api/models', wrap((req, res) => {
  // Черновики (неопубликованные) — только для админа. Публике ?all=1 не даёт
  // ничего сверх опубликованного, иначе неготовые карточки утекали бы наружу.
  const includeUnpublished = !!req.query.all && isAdmin(req)
  res.json(store.models.all({ cat: req.query.cat, includeUnpublished }))
}))

app.get('/api/models/:id', wrap((req, res) => {
  const m = store.models.get(req.params.id)
  if (!m) return res.status(404).json({ error: 'Модель не найдена' })
  res.json(m)
}))

app.post('/api/models', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const { name, cat } = req.body || {}
  if (!name || !cat) return res.status(400).json({ error: 'Укажите название и категорию' })
  if (!store.categories.exists(cat)) return res.status(400).json({ error: 'Неизвестная категория' })
  res.status(201).json(store.models.create(req.body))
}))

app.put('/api/models/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const b = req.body || {}
  if (b.cat && !store.categories.exists(b.cat)) {
    return res.status(400).json({ error: 'Неизвестная категория' })
  }
  const m = store.models.update(req.params.id, b)
  if (!m) return res.status(404).json({ error: 'Модель не найдена' })
  res.json(m)
}))

app.delete('/api/models/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.models.remove(req.params.id)) {
    return res.status(404).json({ error: 'Модель не найдена' })
  }
  res.json({ ok: true })
}))

/* Порядок моделей в каталоге. Раньше он назначался при создании и больше
   не менялся: новая модель всегда падала в конец списка, и поднять её
   наверх было нельзя никак. Для каталога, где витриной служат первые
   карточки, это существенно. */
app.post('/api/models/reorder', requireAdmin, limitAdminWrite, wrap((req, res) => {
  store.models.reorder(req.body?.ids)
  res.json(store.models.all({ includeUnpublished: true }))
}))

/* -------------------------------- новости ------------------------------ */

app.get('/api/news', wrap((req, res) => {
  // Черновики статей — только для админа (см. /api/models).
  res.json(
    store.news.all({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      includeUnpublished: !!req.query.all && isAdmin(req),
    })
  )
}))

app.get('/api/news/:id', wrap((req, res) => {
  const n = store.news.get(req.params.id)
  if (!n) return res.status(404).json({ error: 'Статья не найдена' })
  res.json(n)
}))

app.post('/api/news', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: 'Укажите заголовок' })
  res.status(201).json(store.news.create(req.body))
}))

app.put('/api/news/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const n = store.news.update(req.params.id, req.body || {})
  if (!n) return res.status(404).json({ error: 'Статья не найдена' })
  res.json(n)
}))

app.delete('/api/news/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.news.remove(req.params.id)) {
    return res.status(404).json({ error: 'Статья не найдена' })
  }
  res.json({ ok: true })
}))

/* -------------------------------- заявки ------------------------------- */

app.get('/api/requests', requireAdmin, wrap((_req, res) => res.json(store.requests.all())))

// Публичный: формы КП / звонка / обратной связи. Открыт всему интернету,
// поэтому здесь и ограничитель частоты, и обрезка полей по длине.
app.post('/api/requests', limitRequests, wrap(async (req, res) => {
  // Ответ эхом содержит только что введённые имя, телефон и комментарий —
  // те же персональные данные, что и в списке заявок для админа.
  res.setHeader('Cache-Control', 'no-store')
  const { type, modelId, region, meta } = req.body || {}
  const fio = clean(req.body?.fio, 100)
  const phone = clean(req.body?.phone, 40)
  const comment = clean(req.body?.comment, 1000)

  /* Ловушка для ботов. Поле `website` спрятано от людей (см. формы), человек
     его не заполняет, а бот заполняет все поля подряд. Отвечаем ложным
     «успехом»: бот считает, что всё вышло, и не пробует другой способ, а
     заявка никуда не пишется и никого не будит. */
  if (clean(req.body?.website, 100)) {
    return res.status(201).json({ ok: true })
  }

  if (!fio || !phone) return res.status(400).json({ error: 'Укажите имя и телефон' })

  /* Телефон проверяем по числу цифр: 6–15 (диапазон номеров по E.164).
     Жёсткий шаблон формата не навязываем — он отпугивал бы живых клиентов,
     которые пишут номер по-своему. Задача проверки — отсечь мусор, а не
     заставить набрать «правильно». */
  const digits = (phone.match(/\d/g) || []).length
  if (digits < 6 || digits > 15) {
    return res.status(400).json({ error: 'Проверьте номер телефона' })
  }

  /* Согласие проверяем на сервере, а не только галочкой в форме: галочку
     легко обойти запросом мимо интерфейса, а хранить персональные данные
     без согласия нельзя. Нет согласия — нет заявки. */
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: 'Нужно согласие на обработку персональных данных' })
  }

  let metaText = clean(meta, 200) || '—'
  if (type === 'КП') {
    const m = modelId ? store.models.get(modelId) : null
    metaText = `${m ? m.name : 'Общая заявка'} · ${clean(region, 60) || '—'}`
  }

  // Запись синхронная (см. store.requests.create): не записалось — сюда
  // прилетит исключение, wrap вернёт форме честную 500, ложного «успеха» не
  // будет.
  const saved = store.requests.create({
    type,
    fio,
    phone,
    meta: metaText,
    comment,
    consentAt: new Date().toISOString(),
    policyVersion: PRIVACY_VERSION,
  })

  // Отвечаем форме сразу — уведомление в Telegram не должно её задерживать и
  // тем более ронять: заявка уже на диске.
  res.status(201).json(saved)
  notifyNewRequest(saved)
}))

app.patch('/api/requests/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const allowed = ['Новая', 'В работе', 'Обработана']
  if (!allowed.includes(req.body?.status)) {
    return res.status(400).json({ error: 'Недопустимый статус' })
  }
  const r = store.requests.setStatus(req.params.id, req.body.status)
  if (!r) return res.status(404).json({ error: 'Заявка не найдена' })
  res.json(r)
}))

app.delete('/api/requests/:id', requireAdmin, limitAdminWrite, wrap((req, res) => {
  if (!store.requests.remove(req.params.id)) {
    return res.status(404).json({ error: 'Заявка не найдена' })
  }
  res.json({ ok: true })
}))

/* ------------------------------- настройки ----------------------------- */

app.get('/api/settings', wrap((_req, res) => res.json(store.settings.publicAll())))

app.put('/api/settings', requireAdmin, limitAdminWrite, wrap((req, res) => {
  res.json(store.settings.update(req.body || {}))
}))

/* ------------------------------ фотографии ------------------------------ */

/**
 * Библиотека картинок: что загружено и чем занято.
 * `usedBy` — список карточек, где картинка стоит: удалять фото из-под
 * живой модели, ничего об этом не сказав, — верный способ получить
 * каталог с дырами вместо снимков.
 */
app.get('/api/uploads', requireAdmin, wrap((_req, res) => {
  const list = store.media.all().map((m) => ({ ...m, usedBy: store.media.usedBy(m.path) }))
  res.json({
    files: list,
    usedBytes: uploads.usedBytes(),
    quotaBytes: uploads.MAX_TOTAL_BYTES,
  })
}))

/**
 * Загрузка файла.
 *
 * Тело запроса — сам файл, без multipart: браузер шлёт File как есть
 * (см. src/api.js), сервер получает готовый Buffer. Имя приходит
 * заголовком X-File-Name и используется только как основа для читаемого
 * имени; настоящее имя генерирует сервер.
 *
 * express.raw объявлен прямо здесь, а не глобально: общий разбор JSON
 * ограничен 64 КБ, и поднимать этот предел ради одной ручки нельзя — это
 * открыло бы приём мегабайтных тел на всех остальных маршрутах.
 */
app.post(
  '/api/uploads',
  requireAdmin,
  limitUpload,
  express.raw({ type: () => true, limit: uploads.MAX_FILE_BYTES }),
  wrap((req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Пустой файл' })
    }
    // Имя из заголовка декодируем осторожно: там может быть что угодно,
    // включая некорректную последовательность — падать из-за этого нельзя.
    let original = ''
    try {
      original = decodeURIComponent(req.headers['x-file-name'] || '')
    } catch {
      original = ''
    }

    const saved = uploads.saveImage(req.body, original)
    const entry = store.media.add({ ...saved, title: original.slice(0, 120) })
    res.status(201).json(entry)
  })
)

app.delete('/api/uploads/:name', requireAdmin, limitAdminWrite, wrap((req, res) => {
  const name = req.params.name
  const path = `${uploads.UPLOAD_URL_PREFIX}/${name}`
  const usedBy = store.media.usedBy(path)

  // Заставляем подтвердить, если картинка где-то стоит: без этого одно
  // неверное нажатие оставляет карточки без фотографий, и восстановить
  // связь потом можно только вручную по всему каталогу.
  if (usedBy.length && req.query.force !== '1') {
    return res.status(409).json({
      error: `Картинка используется: ${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? '…' : ''}`,
      usedBy,
    })
  }

  uploads.removeFile(name)
  store.media.remove(name)
  res.json({ ok: true })
}))

/**
 * Отдача загруженных картинок.
 *
 * Отдельным маршрутом, а не express.static, по трём причинам:
 *   1. Content-Type ставим сами, по сигнатуре формата из имени файла —
 *      браузер не должен гадать, что ему прислали;
 *   2. Content-Disposition: inline + nosniff — файл показывается как
 *      картинка и никогда не исполняется как страница;
 *   3. каталог загрузок лежит на томе с данными, вне dist/, и статикой
 *      его раздавать было бы неудобно.
 */
app.get('/uploads/:name', (req, res) => {
  const full = uploads.fileExists(req.params.name)
  if (!full) return res.status(404).end()
  res.setHeader('Content-Type', uploads.mimeByName(req.params.name))
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Имя файла уникально и не переиспользуется, поэтому кешируем надолго.
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  res.sendFile(full)
})

/* --------------------------- резервная копия ---------------------------- */

/**
 * Выгрузка всего содержимого сайта одним файлом.
 *
 * На сервере копии делаются сами (контейнер backup), но лежат они там же,
 * где сайт. Кнопка в админке даёт заказчику копию у себя на компьютере —
 * без SSH и без обращения к разработчику. Пароль и кэш ИИ в выгрузку не
 * попадают.
 */
app.get('/api/admin/export', requireAdmin, wrap((_req, res) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="shmagro-${stamp}.json"`)
  res.send(JSON.stringify(store.snapshot(), null, 2))
}))

/* --------------------------- robots и sitemap ---------------------------- */

/* Раньше это были статические файлы в public/, и оба были нерабочими:
   в карте сайта стояло пространство имён sitemap.org вместо sitemaps.org
   и относительные адреса вида <loc>/catalog</loc>. Спецификация требует
   абсолютных — поисковики такую карту отвергают целиком.

   Адрес сайта заранее неизвестен (сегодня IP, завтра домен), поэтому
   собираем его из самого запроса. За обратным прокси req.protocol читает
   X-Forwarded-Proto — работает и по http, и по https. */
const siteOrigin = (req) => `${req.protocol}://${req.get('host')}`

app.get('/robots.txt', wrap((req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      '',
      '# Админка и API в поиске не нужны',
      'Disallow: /admin',
      'Disallow: /api/',
      '',
      `Sitemap: ${siteOrigin(req)}/sitemap.xml`,
      '',
    ].join('\n')
  )
}))

app.get('/sitemap.xml', wrap((req, res) => {
  const origin = siteOrigin(req)
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const pages = [
    { loc: '/', priority: '1.0', freq: 'weekly' },
    { loc: '/catalog', priority: '0.9', freq: 'weekly' },
    { loc: '/about', priority: '0.7', freq: 'monthly' },
    { loc: '/news', priority: '0.7', freq: 'weekly' },
    { loc: '/contacts', priority: '0.6', freq: 'monthly' },
    { loc: '/privacy', priority: '0.3', freq: 'yearly' },
    { loc: '/terms', priority: '0.3', freq: 'yearly' },
    // Карточки техники и статьи берём из данных: каталог пополняется через
    // админку, и вручную поддерживать список бессмысленно.
    ...store.models.all().map((m) => ({ loc: `/catalog/${m.id}`, priority: '0.8', freq: 'monthly' })),
    ...store.news.all().map((n) => ({
      loc: `/news/${n.id}`,
      priority: '0.5',
      freq: 'monthly',
      lastmod: n.date,
    })),
  ]

  const body = pages
    .map(
      (p) =>
        `  <url><loc>${esc(origin + p.loc)}</loc>` +
        (p.lastmod ? `<lastmod>${esc(p.lastmod)}</lastmod>` : '') +
        `<changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>`
    )
    .join('\n')

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  )
}))

/* -------------------------------- здоровье ------------------------------ */

/**
 * Жив ли сервис. По этому адресу стучится Docker (HEALTHCHECK) и любой
 * внешний мониторинг.
 *
 * Намеренно дешёвый и молчаливый: проверяет, что процесс отвечает и данные
 * на месте, но наружу не отдаёт ни версий, ни путей, ни настроек — это
 * открытый адрес, и он не должен помогать разведке.
 */
app.get('/api/health', wrap((_req, res) => {
  const ok = store.counts().models >= 0
  res.status(ok ? 200 : 503).json({ ok, uptime: Math.round(process.uptime()) })
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
  if (aiBudgetLeft() <= 0) {
    return res.status(429).json({
      error: 'Суточный лимит обращений к ИИ исчерпан. Анализ вернётся завтра.',
    })
  }
  aiBudgetTake()
  res.json(await ai.analyzeLeads())
}))

app.post('/api/ai/chat', limitChat, wrap(async (req, res) => {
  const message = clean(req.body?.message, 2000)
  if (!message) return res.status(400).json({ error: 'Пустое сообщение' })

  /* История приходит от клиента, то есть от кого угодно. Раньше сюда
     улетал сырой массив: ограничение стояло только на количество реплик,
     а роль и длина каждой брались как есть. Через такое поле удобно
     подсовывать модели чужие инструкции и раздувать промпт (за токены
     платим мы). Оставляем строго роль + текст, всё лишнее отбрасываем. */
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .slice(-8)
    .map((h) => ({
      role: h?.role === 'assistant' ? 'assistant' : 'user',
      text: clean(h?.text, 1000),
    }))
    .filter((h) => h.text)

  /* Бюджет кончился — не отказываем посетителю, а отвечаем по правилам.
     Чат на главной открыт всем, и «сервис недоступен» на живом сайте
     выглядит как поломка. Правила отвечают хуже, но отвечают. */
  if (aiBudgetLeft() <= 0) {
    return res.json({ ...(await ai.chat(message, history, { rulesOnly: true })), engine: 'rules' })
  }
  aiBudgetTake()
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

/* Маршруты, которые реально существуют в клиенте. Нужны, чтобы отличать
   настоящую страницу от несуществующей: раньше сервер отдавал index.html с
   кодом 200 на ЛЮБОЙ адрес (soft-404), и мусорные ссылки попадали в поисковый
   индекс. Список статических путей + шаблоны карточек с :id.
   При добавлении нового маршрута в App.jsx — добавить и сюда. */
const KNOWN_PATHS = new Set([
  '/',
  '/about',
  '/catalog',
  '/news',
  '/contacts',
  '/privacy',
  '/terms',
  /* Админка — существующая страница, и отдавать по ней 404 неправильно:
     мониторинг и браузер считают адрес битым. От индексации её защищают
     Disallow в robots.txt и noindex на самой странице, а не код ответа. */
  '/admin',
])
const KNOWN_PREFIXES = ['/catalog/', '/news/']
const isKnownRoute = (p) =>
  KNOWN_PATHS.has(p) || KNOWN_PREFIXES.some((pre) => p.startsWith(pre) && p.length > pre.length)

if (existsSync(DIST)) {
  // Ассеты именованы по хешу содержимого — кешируем навсегда.
  app.use('/assets', express.static(join(DIST, 'assets'), { immutable: true, maxAge: '1y' }))

  // index: false — чтобы `/` не отдавался отсюда, а шёл в единственный
  // обработчик ниже. Иначе index.html раздаётся двумя путями с разными
  // заголовками, и поведение зависит от того, с какого адреса зашли.
  app.use(express.static(DIST, { maxAge: '1h', index: false }))

  // SPA: клиент рисует и страницу, и её «не найдено» сам, поэтому отдаём тот
  // же index.html — но известному маршруту со статусом 200, а неизвестному
  // с 404, чтобы поисковик не индексировал несуществующие адреса.
  app.get(/^(?!\/api).*/, (req, res) => {
    const status = isKnownRoute(req.path) ? 200 : 404
    /* no-cache — это не «не кешировать», а «перед показом спроси, не устарел ли».
       Входной документ ссылается на ассеты по хешу; после деплоя старых хешей в
       dist/ уже нет, и закешированный HTML уводит браузер за файлом, которого не
       существует. ETag включён, поэтому проверка обычно стоит один 304 без тела. */
    res.setHeader('Cache-Control', 'no-cache')
    res.status(status).sendFile(join(DIST, 'index.html'))
  })
}

/**
 * Проверки окружения. Обе описывают отказы, которые уже случались на Railway
 * и оба раза выглядели как что угодно, только не своя причина, — поэтому
 * сервер говорит о них сам, в первых строках лога.
 */
function проверитьОкружение() {
  const вКонтейнере = !!(process.env.RAILWAY_ENVIRONMENT || process.env.PORT)

  if (!process.env.PORT) {
    console.warn(
      `\n  ⚠ PORT не задан — слушаю запасной ${PORT}.\n` +
        '    Если это Railway: платформа шлёт трафик на свой порт, а не на этот,\n' +
        '    и снаружи сайт ответит «Application failed to respond».\n' +
        '    Лечится переменной PORT в Variables.\n'
    )
  }

  if (вКонтейнере && !process.env.STORE_PATH) {
    console.warn(
      `\n  ⚠ STORE_PATH не задан — данные лежат в ${store.STORE_PATH}, внутри контейнера.\n` +
        '    Он пересоздаётся при каждом деплое: заявки клиентов будут ПОТЕРЯНЫ.\n' +
        '    Лечится диском на /data и переменной STORE_PATH=/data/store.json.\n'
    )
  }

  if (adminPassword() === 'admin') {
    console.warn(
      '\n  ⚠ ADMIN_PASSWORD = «admin» — стандартный пароль.\n' +
        '    На публичном адресе в админку войдёт кто угодно и удалит каталог,\n' +
        '    новости и заявки. Задайте свой пароль переменной ADMIN_PASSWORD.\n'
    )
  }

  if (вКонтейнере && !process.env.JWT_SECRET) {
    console.warn(
      '\n  ⚠ JWT_SECRET не задан — сессии админки подписаны разовым ключом и\n' +
        '    слетают при каждом перезапуске (после деплоя придётся входить заново).\n' +
        '    Задайте JWT_SECRET (длинная случайная строка), чтобы сессии жили.\n'
    )
  }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`✓ API СХМ Агро слушает ${HOST}:${PORT}`)
  console.log(`  Данные: ${store.STORE_PATH}${seeded ? ' (создан из начальных)' : ''}`)
  if (recovered) {
    console.warn('  ⚠ основной файл данных не читался — поднялись из копии, проверьте содержимое')
  }
  console.log(`  Картинки: ${uploads.UPLOAD_DIR}`)
  console.log(
    `  ИИ: ${ai.aiEnabled() ? ai.aiEngine() + ' подключён' : 'правила (ключи не заданы)'}`
  )
  if (existsSync(DIST)) console.log('  Собранный сайт отдаётся с этого же порта')
  проверитьОкружение()
})

/* ───────────────────── Живучесть процесса ─────────────────────────────
   Всё, что ниже, отвечает на жалобу «сайт сам по себе падает».
   ─────────────────────────────────────────────────────────────────────── */

/* Таймауты сокетов.
   По умолчанию Node держит соединение открытым, пока клиент не отвалится
   сам. Медленный или намеренно «залипший» клиент (классическая атака
   slowloris) занимает соединения одно за другим, и сайт перестаёт
   отвечать живым посетителям при полностью здоровом процессе — снаружи
   это выглядит как падение.

   keepAliveTimeout чуть больше, чем у Caddy впереди: если закрывать
   раньше прокси, тот периодически получает обрыв на уже отправленном
   запросе и отдаёт посетителю 502 на ровном месте. */
server.keepAliveTimeout = 65_000
server.headersTimeout = 70_000
server.requestTimeout = 30_000

/* Аккуратное завершение. Docker при остановке и деплое шлёт SIGTERM: успеваем
   дописать отложенный снимок (правки каталога/статусов из 150-мс окна), иначе
   они потерялись бы. Заявки и так пишутся сразу, но правки админки — нет. */
let выключаемся = false
function shutdown(signal, code = 0) {
  if (выключаемся) return
  выключаемся = true
  console.log(`\n${signal}: завершаюсь, сохраняю данные…`)
  store.flush()
  server.close(() => process.exit(code))
  // Если соединения висят — не ждём вечно.
  setTimeout(() => process.exit(code), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

/**
 * Необработанное отклонение промиса.
 *
 * С Node 15 такое отклонение по умолчанию убивает процесс. Один забытый
 * .catch() в необязательном месте (уведомление в Telegram, запрос к ИИ)
 * ронял весь сайт вместе с приёмом заявок. Это ровно тот случай, когда
 * падать нельзя: сбой второстепенный, а последствия — общие.
 *
 * Поэтому пишем в лог и продолжаем работать. Данные при этом не при чём:
 * состояние в памяти цело, отложенный снимок на месте.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Необработанное отклонение промиса (продолжаю работу):', reason)
})

/**
 * Необработанное исключение — случай тяжелее.
 *
 * После него состояние процесса считается ненадёжным: могли остаться
 * незакрытые ресурсы и половина выполненной операции. Продолжать работу
 * в таком виде опаснее, чем перезапуститься: Docker с restart-политикой
 * поднимет контейнер за секунду.
 *
 * Что важно: перед выходом обязательно дописываем данные. Иначе как раз
 * при аварийном выходе терялись бы правки, сделанные в админке за
 * последние секунды.
 */
process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение — сохраняю данные и перезапускаюсь:', err)
  try {
    store.flush()
  } catch {
    /* если и это не вышло — выходим всё равно, иначе процесс зависнет */
  }
  shutdown('uncaughtException', 1)
})

/* Предупреждение о нехватке памяти.
   На VPS с 1–2 ГБ процесс убивает OOM-killer, и в логах остаётся ровно
   ничего — сайт «просто пропал». Раз в 5 минут смотрим на кучу и заранее
   пишем в лог, если она подобралась к пределу: тогда причина видна до
   того, как контейнер исчезнет. */
const HEAP_WARN_MB = Number(process.env.HEAP_WARN_MB || 0)
if (HEAP_WARN_MB > 0) {
  const t = setInterval(() => {
    const usedMb = Math.round(process.memoryUsage().heapUsed / 1048576)
    if (usedMb >= HEAP_WARN_MB) {
      console.warn(`⚠ Память: занято ${usedMb} МБ кучи (порог ${HEAP_WARN_MB} МБ).`)
    }
  }, 5 * 60 * 1000)
  t.unref()
}
