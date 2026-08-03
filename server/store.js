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
 *
 * ─── ЧТО ИЗМЕНИЛОСЬ В ВЕРСИИ «АВТОНОМНАЯ АДМИНКА» ──────────────────────
 * Раньше редактировать через админку можно было только модели, новости,
 * тексты услуг и часть настроек. Категории, показатели, сертификаты,
 * регионы и порядок карточек были зашиты в seed.js — чтобы поменять хоть
 * что-то из этого, требовался программист и деплой.
 *
 * Теперь редактируется всё перечисленное, а данные при этом жёстко
 * проверяются на входе: длина каждого поля ограничена, количество
 * элементов в списках ограничено, пути к картинкам разрешены только
 * свои (/assets и /uploads). Это не паранойя: store.json целиком лежит
 * в оперативной памяти, и раздутое поле — это не «некрасиво», это
 * съеденная память сервера.
 * ───────────────────────────────────────────────────────────────────────
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  statSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import * as seed from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const STORE_PATH = process.env.STORE_PATH
  ? resolve(process.env.STORE_PATH)
  : join(__dirname, '..', 'data', 'store.json')

/** Последний заведомо целый снимок. Из него поднимаемся, если основной
    файл окажется битым (обрыв записи, кончился диск, сбой тома). */
const BACKUP_PATH = STORE_PATH + '.bak'

const today = () => new Date().toISOString().slice(0, 10)
const newId = (prefix) => prefix + randomUUID().slice(0, 8)

/* ------------------------- проверка входных данных ----------------------- */

/**
 * Ограничители длины. Все правки из админки проходят через них.
 *
 * Зачем: данные лежат в памяти и целиком сериализуются в JSON при каждом
 * сохранении. Поле без ограничения длины — это способ забить память и
 * положить сервер, даже не имея злого умысла (например, вставив в описание
 * скопированную книгу).
 */
const MAX = {
  name: 200,
  short: 400,
  descr: 8000,
  specKey: 120,
  specVal: 240,
  specs: 60, // строк характеристик на модель
  title: 250,
  excerpt: 500,
  paragraph: 4000,
  paragraphs: 120, // абзацев в статье
  text: 1200,
  note: 160,
  setting: 600,
  region: 120,
  regions: 60,
  list: 60, // элементов в справочниках (категории, услуги, показатели…)
  models: 500,
  news: 500,
  gallery: 12, // дополнительных фото на модель, сверх главного
}

/**
 * Чистая строка: убираем управляющие символы, обрезаем по длине.
 * Перевод строки и табуляцию оставляем — они нужны в описаниях и статьях.
 */
export function str(v, max) {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

/**
 * Путь к картинке. Разрешаем только свои каталоги: /assets (лежит в
 * образе) и /uploads (загружено через админку).
 *
 * Зачем так строго: значение попадает в src изображения на странице. Без
 * проверки в него можно записать чужой адрес (тогда сайт молча грузит
 * картинки со стороннего сервера — это и утечка адресов посетителей, и
 * нарушение собственной CSP) или конструкцию вида `javascript:` /
 * `data:text/html`. Проверка адреса — единственное место, где это ловится.
 */
const MEDIA_RE = /^\/(assets|uploads)\/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/
export const safeMedia = (v) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.includes('..') || !MEDIA_RE.test(s)) return null
  return s
}

/** Число в заданных границах, иначе значение по умолчанию. */
const num = (v, def, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Транслитерация для читаемых идентификаторов категорий. */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
}

/** «Посевная техника» → «posevnaya-tehnika». Пусто → случайный id. */
export function slugify(sourceName, prefix = 'c') {
  const base = String(sourceName || '')
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || newId(prefix)
}

/** Строка характеристик: {k, v}. Пустые строки вызывающий отбрасывает сам. */
const cleanSpecs = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, MAX.specs)
    .map((s) => ({ k: str(s?.k, MAX.specKey), v: str(s?.v, MAX.specVal) }))
    .filter((s) => s.k || s.v)

/** Дополнительные фото модели, сверх главного. Каждый путь проходит ту же
    проверку, что и главное фото; мусор и дубли отбрасываем молча. */
const cleanGallery = (list) => {
  const seen = new Set()
  return (Array.isArray(list) ? list : [])
    .map(safeMedia)
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .slice(0, MAX.gallery)
}

/** Абзацы статьи. */
const cleanParagraphs = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, MAX.paragraphs)
    .map((p) => str(p, MAX.paragraph))
    .filter(Boolean)

/* --------------------------- начальные данные ---------------------------- */

/** Свежая копия начальных данных (структуру seed.js не мутируем). */
function freshData() {
  return {
    categories: seed.categories.map((c) => ({
      ...c,
      icon: c.icon || 'gear',
      specTemplate: [...(c.specTemplate || [])],
    })),
    models: seed.models.map((m, i) => ({
      ...m,
      specs: m.specs.map((s) => ({ ...s })),
      published: true,
      sort: m.sort ?? i + 1,
      subsidized: !!m.subsidized,
    })),
    news: seed.news.map((n) => ({ ...n, body: [...n.body], published: true })),
    services: seed.services.map((s) => ({ ...s })),
    certs: seed.certs.map((c, i) => ({ ...c, id: 'cert' + (i + 1) })),
    stats: seed.stats.map((s, i) => ({ ...s, id: 'stat' + (i + 1) })),
    /* Регионы для формы КП раньше были константой в коде: чтобы добавить
       область, приходилось править seed.js и пересобирать образ. Теперь
       это обычные данные и правятся в админке. */
    regions: [...seed.REGIONS],
    /* Демо-заявки с выдуманными ФИО и телефонами — только для разработки и
       показа. На проде свежая база начинается с пустого списка: фейковые
       имена в живой админке выглядят как утечка чужих данных. */
    requests:
      process.env.NODE_ENV === 'production'
        ? []
        : seed.requests.map((r) => ({ ...r, comment: '' })),
    settings: { ...seed.settings },
    /* Список загруженных через админку картинок: имя файла, размер, дата.
       Сами файлы лежат в каталоге загрузок (см. server/uploads.js), здесь
       только опись — чтобы показать библиотеку, не читая диск на каждый
       запрос. */
    media: [],
    /* Пароль администратора в виде scrypt-хэша. Появляется, когда пароль
       меняют через админку; до этого вход работает по ADMIN_PASSWORD. */
    auth: {},
    aiCache: {},
    /* Визиты по дням: { '2026-08-03': 14, ... }. Только счётчик, без адресов
       и идентификаторов посетителей — для сводки в админке этого достаточно,
       а хранить что-то более подробное означало бы собирать персональные
       данные без нужды. */
    visits: {},
  }
}

let data = freshData()

/* ------------------------------ сохранение ------------------------------ */

let saveTimer = null
let dirty = false

/** Пишем через временный файл: обрыв записи не оставит битый store.json.
    Ошибку не глотаем, а пробрасываем — вызывающий решает, что делать
    (заявку, например, откатить и вернуть форме честную ошибку). */
function saveNow() {
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')

  /* Перед подменой прячем предыдущий целый снимок в .bak. Это стоит одного
     копирования файла в сотню килобайт, зато превращает «файл побился —
     данные потеряны» в «файл побился — откатились на прошлую версию».
     Раньше повреждённый store.json молча заменялся демо-данными, и заявки
     клиентов исчезали. */
  try {
    if (existsSync(STORE_PATH) && statSync(STORE_PATH).size > 0) {
      copyFileSync(STORE_PATH, BACKUP_PATH)
    }
  } catch {
    /* нет прошлого снимка или не хватило прав — не повод падать */
  }

  renameSync(tmp, STORE_PATH)
  dirty = false
}

/** Частые правки схлопываем в одну запись на диск (правки каталога, статусов). */
function save() {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      saveNow()
    } catch (e) {
      console.error('Не удалось сохранить store.json:', e.message)
    }
  }, 150)
}

/** Немедленно дописать отложенный снимок, если он есть. Зовётся при
    завершении процесса (SIGTERM перед деплоем), чтобы правки из 150-мс окна
    не потерялись. */
export function flush() {
  clearTimeout(saveTimer)
  saveTimer = null
  if (!dirty) return
  try {
    saveNow()
  } catch (e) {
    console.error('Не удалось сохранить store.json при завершении:', e.message)
  }
}

/**
 * Страховочное сохранение раз в минуту.
 *
 * Обычно хватает отложенной записи и дозаписи на SIGTERM. Но SIGTERM
 * приходит не всегда: kill -9, OOM-killer, отключение питания VPS. Раз в
 * минуту сбрасываем накопленное на диск, и худшая потеря — правки за
 * последнюю минуту, а не за всё время работы процесса.
 */
export function startAutosave(everyMs = 60_000) {
  const t = setInterval(() => {
    if (!dirty) return
    try {
      saveNow()
    } catch (e) {
      console.error('Автосохранение не удалось:', e.message)
    }
  }, everyMs)
  t.unref?.()
  return t
}

/* ------------------------------- загрузка -------------------------------- */

/**
 * Достраивает недостающие разделы и поля.
 *
 * Файл на сервере может остаться от прежней версии сайта — в нём нет ни
 * регионов, ни описи картинок, ни иконок у категорий. Без этого шага
 * админка на живом сервере падала бы на первой же попытке открыть вкладку.
 */
function migrate(raw) {
  const base = freshData()
  const d = { ...base, ...raw }

  // Настройки дополняем недостающими ключами, не затирая заданные.
  d.settings = { ...base.settings, ...(raw.settings || {}) }

  /* Пароль в настройках — наследие от версии без хэширования. Он попадал в
     store.json открытым текстом, а оттуда — в автоматические копии на диске
     (ручная выгрузка и публичный API его вырезали, а backup.sh копирует файл
     целиком). Сейчас пароль хранится scrypt-хэшем в d.auth, и это поле мёртвое.
     Удаляем при первой же загрузке. */
  delete d.settings.admin_password

  if (!Array.isArray(d.regions) || d.regions.length === 0) d.regions = [...base.regions]
  if (!Array.isArray(d.media)) d.media = []
  if (!d.auth || typeof d.auth !== 'object') d.auth = {}

  d.categories = (Array.isArray(d.categories) ? d.categories : []).map((c, i) => ({
    ...c,
    icon: c.icon || 'gear',
    sort: c.sort ?? i + 1,
    specTemplate: Array.isArray(c.specTemplate) ? c.specTemplate : [],
  }))

  // У сертификатов и показателей раньше был числовой id — приводим к строке,
  // иначе редактирование по id ведёт себя непредсказуемо.
  d.certs = (Array.isArray(d.certs) ? d.certs : []).map((c, i) => ({
    ...c,
    id: String(c.id ?? 'cert' + (i + 1)),
    sort: c.sort ?? i + 1,
  }))
  d.stats = (Array.isArray(d.stats) ? d.stats : []).map((s, i) => ({
    ...s,
    id: String(s.id ?? 'stat' + (i + 1)),
    sort: s.sort ?? i + 1,
  }))
  d.services = (Array.isArray(d.services) ? d.services : []).map((s, i) => ({
    ...s,
    sort: s.sort ?? i + 1,
  }))

  return d
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
    const hadLegacyPassword = raw?.settings?.admin_password !== undefined
    data = migrate(raw)
    /* Миграция чистит поле только в памяти. Если на диске оно ещё лежало,
       сохраняем сразу: иначе файл ждал бы первой правки в админке или
       ближайшего автосохранения, а оно срабатывает раз в минуту и только
       когда что-то само пометило данные изменёнными — то есть могло не
       сработать вовсе. Копия, снятая в этом окне, унесла бы старое
       значение с собой ровно из-за того пути, который и чиним. */
    if (hadLegacyPassword) saveNow()
    return { seeded: false }
  } catch (e) {
    console.error('store.json не читается:', e.message)

    /* Битый файл НЕ затираем — переименовываем. Раньше здесь молча
       подставлялись демо-данные поверх, и восстанавливать было уже нечего:
       единственная копия заявок исчезала вместе с ошибкой разбора. */
    const parked = `${STORE_PATH}.broken-${Date.now()}`
    try {
      renameSync(STORE_PATH, parked)
      console.error(`  повреждённый файл сохранён как ${parked}`)
    } catch {
      /* переименовать не вышло — идём дальше, данные всё равно не читаются */
    }

    // Пробуем прошлый целый снимок.
    if (existsSync(BACKUP_PATH)) {
      try {
        data = migrate(JSON.parse(readFileSync(BACKUP_PATH, 'utf8')))
        saveNow()
        console.error('  ✓ поднялись из .bak — потеряны только последние правки')
        return { seeded: false, recovered: true }
      } catch (e2) {
        console.error('  .bak тоже не читается:', e2.message)
      }
    }

    data = freshData()
    saveNow()
    console.error('  ⚠ поднялись на начальных данных. Заявки и правки — в бэкапах (папка backups).')
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
  regions: data.regions.length,
  media: data.media.length,
  requests: data.requests.length,
  settings: Object.keys(data.settings).length,
})

/** Полный снимок — для выгрузки резервной копии из админки.
    Пароль и кэш ИИ не отдаём: в копии контента им делать нечего. */
export const snapshot = () => {
  const { aiCache, auth, settings, ...rest } = data
  const { admin_password, ...safeSettings } = settings
  return clone({ ...rest, settings: safeSettings })
}

/* -------------------------------- чтение -------------------------------- */

const clone = (v) => JSON.parse(JSON.stringify(v))
const catName = (id) => data.categories.find((c) => c.id === id)?.name ?? ''
/* gallery появилось позже photo: у моделей, сохранённых до этой правки,
   поля в файле нет вовсе — отдаём пустой массив, а не undefined. */
const withCat = (m) => ({ ...clone(m), gallery: m.gallery || [], catName: catName(m.cat) })
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0)

/** Следующий номер в списке (новый элемент встаёт в конец). */
const nextSort = (list) => list.reduce((a, x) => Math.max(a, x.sort || 0), 0) + 1

/**
 * Расставляет порядок по присланному списку идентификаторов.
 * Общая механика для категорий, услуг, показателей, сертификатов и моделей.
 */
function applyOrder(list, ids) {
  if (!Array.isArray(ids)) return false
  const pos = new Map(ids.map((id, i) => [String(id), i + 1]))
  let touched = false
  for (const item of list) {
    const p = pos.get(String(item.id))
    if (p && item.sort !== p) {
      item.sort = p
      touched = true
    }
  }
  if (touched) save()
  return touched
}

/* ------------------------------ категории -------------------------------- */

/* Категории («тип товара») редактируются из админки: добавить, переименовать,
   поменять значок и порядок, удалить с переносом моделей. Идентификатор
   создаётся один раз из названия и дальше не меняется — на него ссылаются
   модели и адреса вида /catalog?cat=traktory. */
export const categories = {
  all: () => clone(data.categories).sort(bySort),
  exists: (id) => data.categories.some((c) => c.id === id),
  get: (id) => {
    const c = data.categories.find((x) => x.id === id)
    return c ? clone(c) : null
  },

  create(body) {
    if (data.categories.length >= MAX.list) {
      throw Object.assign(new Error('Категорий уже максимум'), { status: 400 })
    }
    const name = str(body?.name, MAX.name)
    if (!name) throw Object.assign(new Error('Укажите название категории'), { status: 400 })

    // Идентификатор из названия; при совпадении добавляем цифру.
    let id = slugify(name)
    let n = 2
    while (data.categories.some((c) => c.id === id)) id = `${slugify(name)}-${n++}`

    const c = {
      id,
      name,
      icon: str(body?.icon, 40) || 'gear',
      sort: nextSort(data.categories),
      specTemplate: cleanSpecTemplate(body?.specTemplate),
    }
    data.categories.push(c)
    save()
    return clone(c)
  },

  update(id, body) {
    const c = data.categories.find((x) => x.id === id)
    if (!c) return null
    if (body?.name !== undefined) c.name = str(body.name, MAX.name) || c.name
    if (body?.icon !== undefined) c.icon = str(body.icon, 40) || c.icon
    if (body?.specTemplate !== undefined) c.specTemplate = cleanSpecTemplate(body.specTemplate)
    save()
    return clone(c)
  },

  /**
   * Удаление категории. Модели без категории превратились бы в мусор,
   * поэтому либо переносим их в другую категорию, либо отказываем и
   * говорим, сколько моделей мешает.
   */
  remove(id, moveTo = null) {
    const i = data.categories.findIndex((x) => x.id === id)
    if (i === -1) return { ok: false, reason: 'not-found' }

    const inUse = data.models.filter((m) => m.cat === id)
    if (inUse.length) {
      if (!moveTo || !categories.exists(moveTo) || moveTo === id) {
        return { ok: false, reason: 'in-use', count: inUse.length }
      }
      inUse.forEach((m) => {
        m.cat = moveTo
      })
    }

    data.categories.splice(i, 1)
    save()
    return { ok: true, moved: inUse.length }
  },

  reorder: (ids) => applyOrder(data.categories, ids),
}

/** Шаблон характеристик категории — просто список названий параметров. */
const cleanSpecTemplate = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, MAX.specs)
    .map((k) => str(k, MAX.specKey))
    .filter(Boolean)

/* -------------------------------- модели -------------------------------- */

export const models = {
  all({ cat, includeUnpublished = false } = {}) {
    return data.models
      .filter((m) => (includeUnpublished || m.published) && (!cat || cat === 'all' || m.cat === cat))
      .sort(bySort)
      .map(withCat)
  },
  get: (id) => {
    const m = data.models.find((x) => x.id === id)
    return m ? withCat(m) : null
  },
  create(body) {
    if (data.models.length >= MAX.models) {
      throw Object.assign(new Error('В каталоге уже максимум моделей'), { status: 400 })
    }
    const m = {
      id: newId('m'),
      name: str(body.name, MAX.name),
      cat: body.cat,
      photo: safeMedia(body.photo),
      gallery: cleanGallery(body.gallery),
      short: str(body.short, MAX.short) || 'Новая модель (черновик).',
      descr: str(body.descr, MAX.descr) || 'Описание появится позже.',
      specs: cleanSpecs(body.specs),
      subsidized: !!body.subsidized,
      published: body.published !== false,
      sort: nextSort(data.models),
    }
    data.models.push(m)
    save()
    return withCat(m)
  },
  update(id, body) {
    const m = data.models.find((x) => x.id === id)
    if (!m) return null
    if (body.name !== undefined) m.name = str(body.name, MAX.name) || m.name
    if (body.cat !== undefined) m.cat = body.cat ?? m.cat
    if (body.photo !== undefined) m.photo = safeMedia(body.photo)
    if (body.gallery !== undefined) m.gallery = cleanGallery(body.gallery)
    if (body.short !== undefined) m.short = str(body.short, MAX.short)
    if (body.descr !== undefined) m.descr = str(body.descr, MAX.descr)
    if (body.specs !== undefined) m.specs = cleanSpecs(body.specs)
    if (body.subsidized !== undefined) m.subsidized = !!body.subsidized
    if (body.published !== undefined) m.published = !!body.published
    if (body.sort !== undefined) m.sort = num(body.sort, m.sort, 0, 100000)
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
  reorder: (ids) => applyOrder(data.models, ids),

  /** Пользуется ли кто-то этой картинкой — спрашивает библиотека медиа. */
  usesPhoto: (path) =>
    data.models
      .filter((m) => m.photo === path || (m.gallery || []).includes(path))
      .map((m) => m.name),
}

/* -------------------------------- новости ------------------------------- */

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
    if (data.news.length >= MAX.news) {
      throw Object.assign(new Error('Статей уже максимум'), { status: 400 })
    }
    const n = {
      id: newId('n'),
      date: /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today(),
      title: str(body.title, MAX.title),
      excerpt: str(body.excerpt, MAX.excerpt) || 'Черновик статьи.',
      body: cleanParagraphs(body.body).length
        ? cleanParagraphs(body.body)
        : ['Текст статьи появится позже.'],
      cover: safeMedia(body.cover),
      published: body.published !== false,
    }
    data.news.unshift(n)
    save()
    return clone(n)
  },
  update(id, b) {
    const n = data.news.find((x) => x.id === id)
    if (!n) return null
    if (b.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) n.date = b.date
    if (b.title !== undefined) n.title = str(b.title, MAX.title) || n.title
    if (b.excerpt !== undefined) n.excerpt = str(b.excerpt, MAX.excerpt)
    if (b.body !== undefined) n.body = cleanParagraphs(b.body)
    if (b.cover !== undefined) n.cover = safeMedia(b.cover)
    if (b.published !== undefined) n.published = !!b.published
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
  usesCover: (path) => data.news.filter((n) => n.cover === path).map((n) => n.title),
}

/* --------------------------------- услуги -------------------------------- */

/* Раньше набор услуг был фиксирован: менялись только тексты, а добавить
   седьмую услугу или убрать ненужную можно было только правкой seed.js. */
export const services = {
  all: () => clone(data.services).sort(bySort),

  create(b) {
    if (data.services.length >= MAX.list) {
      throw Object.assign(new Error('Услуг уже максимум'), { status: 400 })
    }
    const s = {
      id: newId('s'),
      icon: str(b?.icon, 40) || 'gear',
      title: str(b?.title, MAX.name) || 'Новая услуга',
      text: str(b?.text, MAX.text),
      note: str(b?.note, MAX.note),
      sort: nextSort(data.services),
    }
    data.services.push(s)
    save()
    return clone(s)
  },

  update(id, b) {
    const s = data.services.find((x) => x.id === id)
    if (!s) return null
    if (b.icon !== undefined) s.icon = str(b.icon, 40) || s.icon
    if (b.title !== undefined) s.title = str(b.title, MAX.name) || s.title
    if (b.text !== undefined) s.text = str(b.text, MAX.text)
    if (b.note !== undefined) s.note = str(b.note, MAX.note)
    save()
    return clone(s)
  },

  remove(id) {
    const i = data.services.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.services.splice(i, 1)
    save()
    return true
  },

  reorder: (ids) => applyOrder(data.services, ids),
}

/* ---------------------- сертификаты и показатели ------------------------- */

/* Показатели («18 лет на рынке», «12 400+ единиц техники») в ревью помечены
   как выдуманные — их обязательно менять перед запуском. Пока они были в
   коде, «поменять» означало «позвать программиста». */
export const stats = {
  all: () => clone(data.stats).sort(bySort),
  create(b) {
    if (data.stats.length >= MAX.list) {
      throw Object.assign(new Error('Показателей уже максимум'), { status: 400 })
    }
    const s = {
      id: newId('st'),
      v: str(b?.v, 40),
      k: str(b?.k, MAX.note),
      sort: nextSort(data.stats),
    }
    data.stats.push(s)
    save()
    return clone(s)
  },
  update(id, b) {
    const s = data.stats.find((x) => x.id === id)
    if (!s) return null
    if (b.v !== undefined) s.v = str(b.v, 40)
    if (b.k !== undefined) s.k = str(b.k, MAX.note)
    save()
    return clone(s)
  },
  remove(id) {
    const i = data.stats.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.stats.splice(i, 1)
    save()
    return true
  },
  reorder: (ids) => applyOrder(data.stats, ids),
}

export const certs = {
  all: () => clone(data.certs).sort(bySort),
  create(b) {
    if (data.certs.length >= MAX.list) {
      throw Object.assign(new Error('Сертификатов уже максимум'), { status: 400 })
    }
    const c = {
      id: newId('ct'),
      title: str(b?.title, MAX.name) || 'Новый документ',
      org: str(b?.org, MAX.note),
      sort: nextSort(data.certs),
    }
    data.certs.push(c)
    save()
    return clone(c)
  },
  update(id, b) {
    const c = data.certs.find((x) => x.id === id)
    if (!c) return null
    if (b.title !== undefined) c.title = str(b.title, MAX.name) || c.title
    if (b.org !== undefined) c.org = str(b.org, MAX.note)
    save()
    return clone(c)
  },
  remove(id) {
    const i = data.certs.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.certs.splice(i, 1)
    save()
    return true
  },
  reorder: (ids) => applyOrder(data.certs, ids),
}

/* -------------------------------- регионы -------------------------------- */

export const regions = {
  all: () => clone(data.regions),
  /** Список заменяется целиком: в админке это одно текстовое поле построчно. */
  replace(list) {
    const next = (Array.isArray(list) ? list : [])
      .slice(0, MAX.regions)
      .map((r) => str(r, MAX.region))
      .filter(Boolean)
    if (!next.length) {
      throw Object.assign(new Error('Список регионов не может быть пустым'), { status: 400 })
    }
    data.regions = [...new Set(next)]
    save()
    return clone(data.regions)
  },
}

/* --------------------------------- медиа --------------------------------- */

/**
 * Опись загруженных картинок. Сами файлы пишет server/uploads.js, здесь
 * хранится только список — чтобы админка показывала библиотеку без чтения
 * каталога на каждый запрос.
 */
export const media = {
  all: () => clone(data.media).sort((a, b) => (a.at < b.at ? 1 : -1)),
  add(entry) {
    data.media.unshift({
      name: entry.name,
      path: entry.path,
      size: entry.size,
      at: new Date().toISOString(),
      title: str(entry.title, MAX.name),
    })
    /* Потолка на число записей нет сознательно. Раньше опись обрезалась на 400
       записях — но обрезалась только она, а файлы оставались на диске: занимали
       квоту, не показывались в библиотеке и не удалялись через админку. Реальный
       предел задаёт квота на размер каталога (UPLOAD_QUOTA_MB), и опись должна
       отражать диск, а не расходиться с ним. */
    save()
    return clone(data.media[0])
  },
  remove(name) {
    const i = data.media.findIndex((m) => m.name === name)
    if (i === -1) return false
    data.media.splice(i, 1)
    save()
    return true
  },
  /** Кто использует эту картинку — чтобы не удалить фото из-под живой карточки. */
  usedBy(path) {
    return [...models.usesPhoto(path), ...news.usesCover(path)]
  },
}

/* -------------------------------- заявки --------------------------------- */

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
      // Полное время создания — отдельно от даты (see date): по нему считаем
      // среднее время обработки в сводке админки, дата нужна только для
      // группировки по дню и отображения.
      createdAt: new Date().toISOString(),
      resolvedAt: null,
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
    // Заявку — сразу на диск, не через отложенный save(): показать клиенту
    // «отправлено» и потерять заявку в 150-мс окне или на ошибке записи
    // недопустимо. Не записалось — откатываем и сообщаем об ошибке наверх.
    try {
      saveNow()
    } catch (e) {
      data.requests.shift()
      throw e
    }
    return clone(r)
  },
  setStatus(id, status) {
    const r = data.requests.find((x) => x.id === id)
    if (!r) return null
    r.status = status
    // «Обработана» — фиксируем момент, чтобы считать среднее время
    // обработки; уйдя со статуса обратно, отметку снимаем — заявка ещё не
    // закрыта, и старая отметка только исказила бы среднее.
    r.resolvedAt = status === 'Обработана' ? new Date().toISOString() : null
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

/* -------------------------------- визиты ---------------------------------- */

export const visits = {
  /** Один визит сайта — плюс один к счётчику текущего дня. */
  bump() {
    const d = today()
    data.visits[d] = (data.visits[d] || 0) + 1
    // Держим не больше ~15 месяцев истории: старше сводке уже не нужно,
    // а без потолка счётчик рос бы вечно, по записи в день.
    const days = Object.keys(data.visits)
    if (days.length > 450) {
      days.sort()
      for (const key of days.slice(0, days.length - 450)) delete data.visits[key]
    }
    save()
  },
  all: () => clone(data.visits),
}

/* -------------------------------- сводка ----------------------------------- */

const STATUS_LIST = ['Новая', 'В работе', 'Обработана']

/** Сводка админки за календарный месяц (YYYY-MM). */
export const dashboard = {
  forMonth(month) {
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7)
    const [y, mo] = m.split('-').map(Number)
    const daysInMonth = new Date(y, mo, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)

    const byDay = new Map(
      days.map((d) => [d, { date: d, requests: 0, kp: 0, calls: 0, visits: data.visits[d] || 0 }])
    )

    const inMonth = data.requests.filter((r) => (r.date || '').startsWith(m))
    const statusCounts = { 'Новая': 0, 'В работе': 0, 'Обработана': 0 }
    for (const r of inMonth) {
      const row = byDay.get(r.date)
      if (row) {
        row.requests += 1
        if (r.type === 'КП') row.kp += 1
        else row.calls += 1
      }
      if (STATUS_LIST.includes(r.status)) statusCounts[r.status] += 1
    }

    // Среднее время обработки — только по заявкам, у которых есть обе метки
    // времени: старые заявки (созданные до этой правки) их не имеют и в
    // среднее не попадают, а не искажают его нулём или ошибкой.
    const resolved = inMonth.filter((r) => r.createdAt && r.resolvedAt)
    const avgResolutionMs = resolved.length
      ? Math.round(
          resolved.reduce((sum, r) => sum + (new Date(r.resolvedAt) - new Date(r.createdAt)), 0) /
            resolved.length
        )
      : null

    return {
      month: m,
      days: [...byDay.values()],
      requests: inMonth.length,
      kp: inMonth.filter((r) => r.type === 'КП').length,
      calls: inMonth.filter((r) => r.type === 'Звонок').length,
      visits: days.reduce((sum, d) => sum + (data.visits[d] || 0), 0),
      avgResolutionMs,
      resolvedCount: resolved.length,
      statusCounts,
    }
  },

  /** Месяцы, за которые вообще есть хоть какие-то данные — плюс текущий,
      чтобы в списке всегда было куда переключиться. */
  availableMonths() {
    const set = new Set([today().slice(0, 7)])
    for (const r of data.requests) if (r.date) set.add(r.date.slice(0, 7))
    for (const d of Object.keys(data.visits)) set.add(d.slice(0, 7))
    return [...set].sort()
  },
}

/* ------------------------------- настройки ------------------------------- */

/* Что вкладка «Настройки» вправе менять. Всё остальное игнорируется: раньше
   update() писал ЛЮБОЙ присланный ключ любой длины — их можно было засорить,
   раздуть и подсунуть в системный промпт ИИ. Поля-ссылки (*_url) отдельно:
   в href подвала мог попасть `javascript:…` и стать хранимым XSS. */
const SETTING_KEYS = [
  'phone',
  'email',
  'address',
  'hours',
  'legal_name',
  'bin',
  'leasing_url',
  'subsidy_url',
  'instagram_url',
  'telegram_url',
  'whatsapp_url',
  'hero_title',
  'hero_subtitle',
  'hero_photo',
  'about_photo',
]
const URL_KEYS = new Set(['leasing_url', 'subsidy_url', 'instagram_url', 'telegram_url', 'whatsapp_url'])
/* Фото на главной и на странице «О компании» — не ссылка, а путь к своей
   картинке (/assets/… из комплекта или /uploads/… из библиотеки), поэтому
   проверяются той же safeMedia(), что и фото модели, а не safeUrl(). */
const MEDIA_KEYS = new Set(['hero_photo', 'about_photo'])

/** Ссылку принимаем только пустую или явный https:// — прочее (в т.ч.
    javascript:, data:, http://) отбрасываем в пустую строку. */
const safeUrl = (v) => (/^https:\/\/\S+$/i.test(v) ? v : '')

export const settings = {
  /** Публичные настройки — без пароля админки. */
  publicAll() {
    const { admin_password, ...rest } = data.settings
    return clone(rest)
  },
  get: (key) => data.settings[key] ?? '',
  update(patch) {
    const rejected = []
    for (const key of SETTING_KEYS) {
      if (!(key in patch)) continue
      const v = str(patch[key], MAX.setting)
      if (URL_KEYS.has(key) && v && !safeUrl(v)) {
        /* Раньше невалидная ссылка молча превращалась в '' и затирала уже
           сохранённое значение — админ вводил Instagram без https://,
           получал тост «Настройки сохранены» и терял рабочую ссылку, даже
           не поняв, что что-то пошло не так. Теперь просто не трогаем
           сохранённое значение и говорим, что именно не приняли. Пустую
           строку по-прежнему принимаем как есть — так поле осознанно чистят. */
        rejected.push(key)
        continue
      }
      if (MEDIA_KEYS.has(key) && v && !safeMedia(v)) {
        // Та же логика, что и для ссылок: битый путь не затирает фото,
        // которое уже стоит на сайте, а просто не принимается.
        rejected.push(key)
        continue
      }
      data.settings[key] = MEDIA_KEYS.has(key) ? safeMedia(v) || '' : v
    }
    save()
    return { ...settings.publicAll(), rejected }
  },
}

/* ---------------------------- пароль админки ----------------------------- */

/**
 * Пароль администратора, заданный через саму админку.
 *
 * Зачем: раньше пароль жил только в .env на сервере. Сменить его —
 * значит зайти по SSH, отредактировать файл и перезапустить контейнер.
 * Для заказчика, который «просто заходит в админку», это недостижимо: на
 * практике пароль не меняли никогда, в том числе после увольнения
 * сотрудника.
 *
 * Хранится scrypt-хэш со случайной солью — не сам пароль. Утечка
 * store.json (бэкап, случайный доступ к диску) не даёт войти в админку.
 * ADMIN_PASSWORD из окружения продолжает работать, пока свой пароль не
 * задан: это начальный вход и способ восстановления.
 */
export const auth = {
  hasPassword: () => !!data.auth?.hash,

  set(password) {
    const salt = randomBytes(16)
    const hash = scryptSync(String(password), salt, 64)
    data.auth = {
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      updatedAt: new Date().toISOString(),
    }
    save()
    return true
  },

  /** Проверка за постоянное время: длина и содержимое не утекают. */
  verify(password) {
    if (!data.auth?.hash || !data.auth?.salt) return false
    try {
      const expected = Buffer.from(data.auth.hash, 'hex')
      const got = scryptSync(String(password), Buffer.from(data.auth.salt, 'hex'), expected.length)
      return timingSafeEqual(expected, got)
    } catch {
      return false
    }
  },

  /** Метка для ключа подписи сессий: сменили пароль — прежние сессии мертвы. */
  fingerprint: () => data.auth?.hash?.slice(0, 32) || '',

  clear() {
    data.auth = {}
    save()
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
