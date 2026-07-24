/**
 * Хранилище данных сайта — без базы данных.
 *
 * Данные живут в памяти процесса, а снимок пишется в data/store.json,
 * чтобы правки из админки переживали перезапуск. Никаких внешних
 * зависимостей и никакой установки СУБД: `npm run dev:server` работает
 * сразу после `npm install`.
 *
 * ─── КОГДА БУДЕМ ПОДКЛЮЧАТЬ БАЗУ ───────────────────────────────────────
 * Этот файл — единственный шов. Наружу торчат методы вида
 * models.all() / models.create() и т.д.; сервер (server/index.js) ходит
 * только через них и про хранилище ничего не знает.
 * Чтобы перейти на настоящую БД, достаточно переписать тела методов
 * ниже на SQL-запросы, не трогая ни один эндпоинт.
 * ───────────────────────────────────────────────────────────────────────
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as seed from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const STORE_PATH = process.env.STORE_PATH
  ? resolve(process.env.STORE_PATH)
  : join(__dirname, '..', 'data', 'store.json')

const today = () => new Date().toISOString().slice(0, 10)
const newId = (prefix) => prefix + randomUUID().slice(0, 8)

/** Свежая копия начальных данных (структуру seed.js не мутируем). */
function freshData() {
  return {
    categories: seed.categories.map((c) => ({ ...c })),
    models: seed.models.map((m, i) => ({
      ...m,
      specs: m.specs.map((s) => ({ ...s })),
      published: true,
      sort: m.sort ?? i + 1,
      subsidized: !!m.subsidized,
    })),
    news: seed.news.map((n) => ({ ...n, body: [...n.body], published: true })),
    services: seed.services.map((s) => ({ ...s })),
    certs: seed.certs.map((c, i) => ({ ...c, id: i + 1 })),
    stats: seed.stats.map((s, i) => ({ ...s, id: i + 1 })),
    requests: seed.requests.map((r) => ({ ...r, comment: '' })),
    settings: { ...seed.settings },
    aiCache: {},
  }
}

let data = freshData()

/* ------------------------------ сохранение ------------------------------ */

let saveTimer = null

/** Пишем через временный файл: обрыв записи не оставит битый store.json. */
function saveNow() {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true })
    const tmp = STORE_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, STORE_PATH)
  } catch (e) {
    console.error('Не удалось сохранить store.json:', e.message)
  }
}

/** Частые правки схлопываем в одну запись на диск. */
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 150)
}

/** Загружает снимок с диска; если файла нет — берёт начальные данные. */
export function load() {
  if (!existsSync(STORE_PATH)) {
    data = freshData()
    saveNow()
    return { seeded: true }
  }
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
    // Недостающие разделы добираем из seed — файл мог остаться от старой версии.
    data = { ...freshData(), ...raw }
    return { seeded: false }
  } catch (e) {
    console.error('store.json повреждён, беру начальные данные:', e.message)
    data = freshData()
    saveNow()
    return { seeded: true, recovered: true }
  }
}

/** Сбрасывает данные к начальным (используется npm run init-db). */
export function reset() {
  data = freshData()
  saveNow()
  return counts()
}

export const counts = () => ({
  categories: data.categories.length,
  models: data.models.length,
  news: data.news.length,
  services: data.services.length,
  certs: data.certs.length,
  stats: data.stats.length,
  requests: data.requests.length,
  settings: Object.keys(data.settings).length,
})

/* -------------------------------- чтение -------------------------------- */

const clone = (v) => JSON.parse(JSON.stringify(v))
const catName = (id) => data.categories.find((c) => c.id === id)?.name ?? ''
const withCat = (m) => ({ ...clone(m), catName: catName(m.cat) })

export const categories = {
  all: () => clone(data.categories).sort((a, b) => a.sort - b.sort),
  exists: (id) => data.categories.some((c) => c.id === id),
}

export const models = {
  all({ cat, includeUnpublished = false } = {}) {
    return data.models
      .filter((m) => (includeUnpublished || m.published) && (!cat || cat === 'all' || m.cat === cat))
      .sort((a, b) => a.sort - b.sort)
      .map(withCat)
  },
  get: (id) => {
    const m = data.models.find((x) => x.id === id)
    return m ? withCat(m) : null
  },
  create(body) {
    const maxSort = data.models.reduce((a, m) => Math.max(a, m.sort || 0), 0)
    const m = {
      id: newId('m'),
      name: body.name,
      cat: body.cat,
      photo: body.photo || null,
      short: body.short || 'Новая модель (черновик).',
      descr: body.descr || 'Описание появится позже.',
      specs: body.specs || [],
      subsidized: !!body.subsidized,
      published: body.published !== false,
      sort: maxSort + 1,
    }
    data.models.push(m)
    save()
    return withCat(m)
  },
  update(id, body) {
    const m = data.models.find((x) => x.id === id)
    if (!m) return null
    Object.assign(m, {
      name: body.name ?? m.name,
      cat: body.cat ?? m.cat,
      photo: body.photo !== undefined ? body.photo || null : m.photo,
      short: body.short ?? m.short,
      descr: body.descr ?? m.descr,
      specs: body.specs !== undefined ? body.specs : m.specs,
      subsidized: body.subsidized !== undefined ? !!body.subsidized : m.subsidized,
      published: body.published !== undefined ? !!body.published : m.published,
    })
    save()
    return withCat(m)
  },
  remove(id) {
    const i = data.models.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.models.splice(i, 1)
    save()
    return true
  },
}

export const news = {
  all({ limit, includeUnpublished = false } = {}) {
    const list = data.news
      .filter((n) => includeUnpublished || n.published)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return clone(limit ? list.slice(0, limit) : list)
  },
  get: (id) => {
    const n = data.news.find((x) => x.id === id)
    return n ? clone(n) : null
  },
  create(body) {
    const n = {
      id: newId('n'),
      date: body.date || today(),
      title: body.title,
      excerpt: body.excerpt || 'Черновик статьи.',
      body: body.body?.length ? body.body : ['Текст статьи появится позже.'],
      cover: body.cover || null,
      published: body.published !== false,
    }
    data.news.unshift(n)
    save()
    return clone(n)
  },
  update(id, b) {
    const n = data.news.find((x) => x.id === id)
    if (!n) return null
    Object.assign(n, {
      date: b.date ?? n.date,
      title: b.title ?? n.title,
      excerpt: b.excerpt ?? n.excerpt,
      body: b.body !== undefined ? b.body : n.body,
      cover: b.cover !== undefined ? b.cover || null : n.cover,
      published: b.published !== undefined ? !!b.published : n.published,
    })
    save()
    return clone(n)
  },
  remove(id) {
    const i = data.news.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.news.splice(i, 1)
    save()
    return true
  },
}

export const services = {
  all: () => clone(data.services).sort((a, b) => a.sort - b.sort),
  update(id, b) {
    const s = data.services.find((x) => x.id === id)
    if (!s) return null
    Object.assign(s, {
      icon: b.icon ?? s.icon,
      title: b.title ?? s.title,
      text: b.text ?? s.text,
      note: b.note ?? s.note,
    })
    save()
    return clone(s)
  },
}

export const certs = { all: () => clone(data.certs).sort((a, b) => a.sort - b.sort) }
export const stats = { all: () => clone(data.stats).sort((a, b) => a.sort - b.sort) }

export const requests = {
  all: () => clone(data.requests),
  get: (id) => {
    const r = data.requests.find((x) => x.id === id)
    return r ? clone(r) : null
  },
  create({ type, fio, phone, meta, comment, consentAt, policyVersion }) {
    const r = {
      id: newId('r'),
      date: today(),
      type: type === 'КП' ? 'КП' : 'Звонок',
      fio,
      phone,
      meta: meta || '—',
      comment: comment || '',
      status: 'Новая',
      /* Доказательство согласия на обработку персональных данных.
         Хранится точное время и редакция политики, с которой человек
         согласился: если он потом спросит «на что я подписывался»,
         ответ должен быть предметным, а не «где-то стояла галочка». */
      consentAt: consentAt || new Date().toISOString(),
      policyVersion: policyVersion || '',
    }
    data.requests.unshift(r)
    save()
    return clone(r)
  },
  setStatus(id, status) {
    const r = data.requests.find((x) => x.id === id)
    if (!r) return null
    r.status = status
    save()
    return clone(r)
  },
  remove(id) {
    const i = data.requests.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.requests.splice(i, 1)
    save()
    return true
  },
}

export const settings = {
  /** Публичные настройки — без пароля админки. */
  publicAll() {
    const { admin_password, ...rest } = data.settings
    return clone(rest)
  },
  get: (key) => data.settings[key] ?? '',
  update(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'admin_password') continue // пароль меняется только через .env
      data.settings[k] = String(v)
    }
    save()
    return settings.publicAll()
  },
}

/* ------------------------------- кэш ИИ --------------------------------- */

/* Сколько записей держим. Кэш лежит в том же store.json, что и контент,
   поэтому расти без предела ему нельзя: при переполнении выбрасываем самые
   давно записанные. */
const AI_CACHE_MAX = 500

/**
 * Кэш ответов ИИ: платить за один и тот же вопрос дважды незачем.
 * Ключ задаёт вызывающая сторона и включает в себя всё, от чего ответ
 * зависит, — иначе кэш начнёт врать (см. ai.js).
 *
 * Живёт в snapshot'е вместе с контентом и переживает перезапуск: на Railway
 * контейнер поднимается заново часто, и кэш в памяти терялся бы каждый раз.
 */
export const aiCache = {
  get(key) {
    const e = data.aiCache?.[key]
    if (!e) return null
    if (e.exp && e.exp < Date.now()) {
      delete data.aiCache[key]
      save()
      return null
    }
    return clone(e.v)
  },

  set(key, value, ttlMs = 0) {
    data.aiCache ??= {}
    data.aiCache[key] = { v: value, at: Date.now(), exp: ttlMs ? Date.now() + ttlMs : 0 }

    const keys = Object.keys(data.aiCache)
    if (keys.length > AI_CACHE_MAX) {
      keys
        .sort((a, b) => (data.aiCache[a].at ?? 0) - (data.aiCache[b].at ?? 0))
        .slice(0, keys.length - AI_CACHE_MAX)
        .forEach((k) => delete data.aiCache[k])
    }
    save()
  },

  /** Чистка: всё сразу или только ключи с указанным префиксом. */
  clear(prefix = '') {
    if (!prefix) {
      data.aiCache = {}
    } else {
      for (const k of Object.keys(data.aiCache ?? {})) {
        if (k.startsWith(prefix)) delete data.aiCache[k]
      }
    }
    save()
    return aiCache.size()
  },

  size: () => Object.keys(data.aiCache ?? {}).length,
}
