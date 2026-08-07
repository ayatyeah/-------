/**
 * Хранилище данных сайта — без базы данных.
 *
 * Данные живут в памяти процесса, а снимок пишется в data/store.json,
 * чтобы правки из админки переживали перезапуск. Никаких внешних
 * зависимостей и никакой установки СУБД: `npm run dev:server` работает
 * сразу после `npm install`.
 *
 * ─── БАЗА ДАННЫХ ПОДКЛЮЧЕНА (PostgreSQL) ───────────────────────────────
 * Начиная с этой версии рядом с файлом работает PostgreSQL — но не вместо
 * него, а вторым слоем. Смысл ровно такой:
 *
 *   память  →  data/store.json   (как раньше, синхронно, всегда)
 *           →  PostgreSQL        (в фоне, догоняет память)
 *
 * Ни один метод ниже не ходит в базу и не может из-за неё упасть или
 * задержаться. Всё, что здесь добавилось, — вызов db.markDirty() внутри
 * save(): «в памяти что-то поменялось, при случае перелей». Дальше
 * server/db.js сам решает, когда и что отправить, и молча переживает
 * недоступность базы.
 *
 * Поэтому падение контейнера с базой для сайта не событие: посетитель
 * ничего не замечает, заявки принимаются, админка сохраняет. Когда база
 * вернётся, содержимое памяти зальётся в неё целиком.
 *
 * Файл при этом остаётся полноценным: выключите DATABASE_URL — и всё
 * работает ровно как до перехода, без единой правки в коде.
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
import * as db from './db.js'

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
  fileName: 160, // исходное имя файла сертификата, для показа в админке
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

/** Ссылку принимаем только пустую или явный https:// — прочее (в т.ч.
    javascript:, data:, http://) отбрасываем в пустую строку. */
const safeUrl = (v) => (/^https:\/\/\S+$/i.test(v) ? v : '')

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

/** Строка характеристик: {k, v, benefit}. benefit — необязательная подпись
    «через выгоду» под значением (задача 10), например «захват 12 м — на
    треть быстрее однопроходной сеялки». Пустые строки вызывающий
    отбрасывает сам. */
const cleanSpecs = (list) =>
  (Array.isArray(list) ? list : [])
    .slice(0, MAX.specs)
    .map((s) => ({ k: str(s?.k, MAX.specKey), v: str(s?.v, MAX.specVal), benefit: str(s?.benefit, MAX.specVal) }))
    .filter((s) => s.k || s.v)

const BADGES = ['', 'new', 'hit', 'in_stock', 'on_order']
const cleanBadge = (v) => (BADGES.includes(v) ? v : '')

/** Отзыв хозяйства под моделью (задача 10) — необязателен, оба поля пустые
    по умолчанию: выдумывать отзыв за заказчика недопустимо, это должен
    заполнить он сам, когда появится реальный. */
const cleanTestimonial = (t) => ({
  quote: str(t?.quote, MAX.text),
  author: str(t?.author, MAX.note),
})

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
    /* Суточный расход бюджета ИИ (см. store.aiBudget ниже и AI_DAILY_MAX в
       server/index.js). Раньше жил только в переменной процесса и обнулялся
       при каждом деплое — на активной неделе разработки это означало
       фактически безлимитный ИИ вместо суточного потолка. */
    aiBudget: { day: '', used: 0 },
    /* Визиты по дням: { '2026-08-03': 14, ... }. Только счётчик, без адресов
       и идентификаторов посетителей — для сводки в админке этого достаточно,
       а хранить что-то более подробное означало бы собирать персональные
       данные без нужды. */
    visits: {},
    /* Те же приватные счётчики без cookie и идентификаторов, что и visits,
       только по трём дополнительным событиям (задача 2 дорожной карты):
       просмотр карточки модели, начало заполнения формы, открытие AI-чата.
       modelViews — с разбивкой по модели, остальные два — просто по дням. */
    metrics: { modelViews: {}, formStarts: {}, aiChatOpens: {} },
    /* Сервисные центры (п.12 дорожной карты) — пусто по умолчанию: цифра
       «34 сервисных центра» в показателях остаётся маркетинговой оценкой,
       а здесь — только те центры, чей адрес и телефон реально заполнил
       заказчик. Список пуст — раздел на «Контактах» просто не показывается. */
    serviceCenters: [],
    /* Персональные менеджеры — раньше был один на весь сайт (поля
       manager_* в настройках), теперь список: у каждой модели в каталоге
       можно выбрать своего. Пусто по умолчанию — блок на странице модели
       не показывается, пока менеджер не назначен. */
    managers: [],
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
  /* saveNow() зовут в обход save() — заявки пишутся сразу, минуя отложенное
     окно. Флаг для базы взводим и здесь, иначе новая заявка доехала бы до
     PostgreSQL только со следующей правкой каталога. */
  db.markDirty()
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
  /* Отметка для слоя базы. Это не запрос и не ожидание — просто взвод флага
     (одно присваивание). Реальную запись в PostgreSQL сделает фоновая
     сверка; если база лежит, здесь всё равно ничего не произойдёт. */
  db.markDirty()
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
    // Приложенный файл сертификата (фото или PDF/DOC) появился позже —
    // у записей, сохранённых до этой правки, поля в файле нет вовсе.
    file: c.file || '',
    fileName: c.fileName || '',
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
  d.serviceCenters = (Array.isArray(d.serviceCenters) ? d.serviceCenters : []).map((s, i) => ({
    ...s,
    id: String(s.id ?? 'sc' + (i + 1)),
    sort: s.sort ?? i + 1,
  }))
  d.managers = (Array.isArray(d.managers) ? d.managers : []).map((m, i) => ({
    ...m,
    id: String(m.id ?? 'mgr' + (i + 1)),
    position: m.position || '',
    photo: m.photo || '',
    sort: m.sort ?? i + 1,
  }))
  // Единственный менеджер раньше жил в настройках (manager_name/phone/photo).
  // Если он был заполнен, а список менеджеров ещё пуст — переносим его сюда
  // одной записью, а не стираем: у заказчика могли быть реальные данные.
  if (!d.managers.length && d.settings?.manager_name) {
    d.managers.push({
      id: 'mgr1',
      name: d.settings.manager_name,
      position: '',
      phone: d.settings.manager_phone || '',
      photo: d.settings.manager_photo || '',
      sort: 1,
    })
  }
  if (d.settings) {
    delete d.settings.manager_name
    delete d.settings.manager_phone
    delete d.settings.manager_photo
  }

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

/* --------------------------- связка с PostgreSQL -------------------------- */

/**
 * Заменить содержимое памяти данными из базы.
 *
 * Нужно ровно в одном случае: том с data/store.json потеряли, а база
 * уцелела. Тогда сервер стартует на начальных данных, слой базы это видит
 * и возвращает настоящие через этот метод.
 *
 * Обязательно прогоняем через migrate(): в базе может лежать снимок,
 * снятый прежней версией сайта, где ещё не было, скажем, галереи у моделей
 * или файла у сертификата. Без достройки недостающих полей админка упала бы
 * на первой же вкладке — ровно так же, как падала бы на старом JSON-файле.
 */
export function hydrate(raw) {
  data = migrate(raw || {})
  return counts()
}

/** Сырые данные — только для слоя базы, который перекладывает их в таблицы. */
const rawData = () => data

/* Мост регистрируем при загрузке модуля: к моменту db.start() он уже на
   месте. Обратной зависимости нет — db.js про store.js не знает ничего. */
db.attach({
  getData: rawData,
  setData: (d) => hydrate(d),
  saveJson: () => {
    try {
      saveNow()
    } catch (e) {
      console.error('Не удалось записать store.json после подъёма из базы:', e.message)
    }
  },
})

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
/** Назначенный модели менеджер — целиком, а не только имя: карточке модели
    нужны ещё телефон и фото. Без назначения — null, блок на странице просто
    не показывается. */
const managerInfo = (id) => {
  if (!id) return null
  const m = data.managers.find((x) => x.id === id)
  return m ? clone(m) : null
}
/* gallery появилось позже photo: у моделей, сохранённых до этой правки,
   поля в файле нет вовсе — отдаём пустой массив, а не undefined. */
const withCat = (m) => ({
  ...clone(m),
  gallery: m.gallery || [],
  catName: catName(m.cat),
  manager: managerInfo(m.managerId),
})
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
      // Витрина карточки модели (задача 10) — все поля необязательны и по
      // умолчанию пустые/выключены, ничего не подставляется автоматически.
      badge: cleanBadge(body.badge),
      flagship: !!body.flagship,
      testimonial: cleanTestimonial(body.testimonial),
      // Персональный менеджер для этой модели — необязателен, пуст по
      // умолчанию (id проверяется в маршруте, как и cat). Правильность
      // ссылки на существующего менеджера — забота вызывающего кода.
      managerId: str(body.managerId, MAX.name),
      // Переводы (п.16 дорожной карты) — необязательны и пусты по умолчанию:
      // без перевода сайт на kk/en просто показывает русский текст (см.
      // shared/i18n-fallback.js), а не пустую карточку.
      name_kk: str(body.name_kk, MAX.name),
      name_en: str(body.name_en, MAX.name),
      short_kk: str(body.short_kk, MAX.short),
      short_en: str(body.short_en, MAX.short),
      descr_kk: str(body.descr_kk, MAX.descr),
      descr_en: str(body.descr_en, MAX.descr),
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
    if (body.badge !== undefined) m.badge = cleanBadge(body.badge)
    if (body.flagship !== undefined) m.flagship = !!body.flagship
    if (body.testimonial !== undefined) m.testimonial = cleanTestimonial(body.testimonial)
    if (body.managerId !== undefined) m.managerId = str(body.managerId, MAX.name)
    if (body.name_kk !== undefined) m.name_kk = str(body.name_kk, MAX.name)
    if (body.name_en !== undefined) m.name_en = str(body.name_en, MAX.name)
    if (body.short_kk !== undefined) m.short_kk = str(body.short_kk, MAX.short)
    if (body.short_en !== undefined) m.short_en = str(body.short_en, MAX.short)
    if (body.descr_kk !== undefined) m.descr_kk = str(body.descr_kk, MAX.descr)
    if (body.descr_en !== undefined) m.descr_en = str(body.descr_en, MAX.descr)
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
      // Переводы (п.16 дорожной карты) — см. пояснение у models выше.
      title_kk: str(body.title_kk, MAX.title),
      title_en: str(body.title_en, MAX.title),
      excerpt_kk: str(body.excerpt_kk, MAX.excerpt),
      excerpt_en: str(body.excerpt_en, MAX.excerpt),
      body_kk: cleanParagraphs(body.body_kk),
      body_en: cleanParagraphs(body.body_en),
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
    if (b.title_kk !== undefined) n.title_kk = str(b.title_kk, MAX.title)
    if (b.title_en !== undefined) n.title_en = str(b.title_en, MAX.title)
    if (b.excerpt_kk !== undefined) n.excerpt_kk = str(b.excerpt_kk, MAX.excerpt)
    if (b.excerpt_en !== undefined) n.excerpt_en = str(b.excerpt_en, MAX.excerpt)
    if (b.body_kk !== undefined) n.body_kk = cleanParagraphs(b.body_kk)
    if (b.body_en !== undefined) n.body_en = cleanParagraphs(b.body_en)
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
  get: (id) => {
    const c = data.certs.find((x) => x.id === id)
    return c ? clone(c) : null
  },
  create(b) {
    if (data.certs.length >= MAX.list) {
      throw Object.assign(new Error('Сертификатов уже максимум'), { status: 400 })
    }
    const c = {
      id: newId('ct'),
      title: str(b?.title, MAX.name) || 'Новый документ',
      org: str(b?.org, MAX.note),
      // Файл — фото сертификата или PDF/DOC — необязателен: title/org
      // можно ввести без него, а прикрепить позже.
      file: safeMedia(b?.file) || '',
      fileName: str(b?.fileName, MAX.fileName),
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
    // Пустая строка — осознанное «убрать файл», а не ошибка валидации:
    // safeMedia('') вернул бы null, и c.file обнулился бы как и надо.
    if (b.file !== undefined) c.file = safeMedia(b.file) || ''
    if (b.fileName !== undefined) c.fileName = str(b.fileName, MAX.fileName)
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

/**
 * Сервисные центры (п.12 дорожной карты) — адрес и телефон конкретной точки
 * обслуживания, отдельно от общих контактов завода. Публикуется на
 * «Контактах» списком, только если хотя бы один центр заполнен: выдуманные
 * адреса недопустимы, а пустой список — не повод показывать пустой раздел.
 */
export const serviceCenters = {
  all: () => clone(data.serviceCenters).sort(bySort),
  get: (id) => {
    const c = data.serviceCenters.find((x) => x.id === id)
    return c ? clone(c) : null
  },
  create(b) {
    if (data.serviceCenters.length >= MAX.list) {
      throw Object.assign(new Error('Сервисных центров уже максимум'), { status: 400 })
    }
    const c = {
      id: newId('sc'),
      name: str(b?.name, MAX.name) || 'Новый центр',
      region: str(b?.region, MAX.region),
      address: str(b?.address, MAX.name),
      phone: str(b?.phone, MAX.note),
      // Ссылка на карту (2ГИС/Яндекс) — необязательна: без неё карточка
      // всё равно покажет адрес и телефон, просто без ссылки «Показать на карте».
      mapUrl: safeUrl(str(b?.mapUrl, MAX.setting)),
      sort: nextSort(data.serviceCenters),
    }
    data.serviceCenters.push(c)
    save()
    return clone(c)
  },
  update(id, b) {
    const c = data.serviceCenters.find((x) => x.id === id)
    if (!c) return null
    if (b.name !== undefined) c.name = str(b.name, MAX.name) || c.name
    if (b.region !== undefined) c.region = str(b.region, MAX.region)
    if (b.address !== undefined) c.address = str(b.address, MAX.name)
    if (b.phone !== undefined) c.phone = str(b.phone, MAX.note)
    // Пустая строка — осознанное «убрать ссылку», как и с фото сертификата.
    if (b.mapUrl !== undefined) c.mapUrl = safeUrl(str(b.mapUrl, MAX.setting))
    save()
    return clone(c)
  },
  remove(id) {
    const i = data.serviceCenters.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.serviceCenters.splice(i, 1)
    save()
    return true
  },
  reorder: (ids) => applyOrder(data.serviceCenters, ids),
}

/*
 * Персональные менеджеры — раньше был один на весь сайт (настройки
 * manager_name/phone/photo), теперь список: у каждой модели каталога можно
 * выбрать своего (см. managerId в models). Публикуется на карточке модели
 * только когда назначен и у него заполнены имя и телефон — см. withCat().
 */
export const managers = {
  all: () => clone(data.managers).sort(bySort),
  exists: (id) => data.managers.some((x) => x.id === id),
  get: (id) => {
    const m = data.managers.find((x) => x.id === id)
    return m ? clone(m) : null
  },
  create(b) {
    if (data.managers.length >= MAX.list) {
      throw Object.assign(new Error('Менеджеров уже максимум'), { status: 400 })
    }
    const m = {
      id: newId('mgr'),
      name: str(b?.name, MAX.name) || 'Новый менеджер',
      position: str(b?.position, MAX.note),
      phone: str(b?.phone, MAX.note),
      photo: safeMedia(b?.photo),
      sort: nextSort(data.managers),
    }
    data.managers.push(m)
    save()
    return clone(m)
  },
  update(id, b) {
    const m = data.managers.find((x) => x.id === id)
    if (!m) return null
    if (b.name !== undefined) m.name = str(b.name, MAX.name) || m.name
    if (b.position !== undefined) m.position = str(b.position, MAX.note)
    if (b.phone !== undefined) m.phone = str(b.phone, MAX.note)
    if (b.photo !== undefined) m.photo = safeMedia(b.photo)
    save()
    return clone(m)
  },
  /** Удаление менеджера снимает его со всех моделей, где он был назначен —
      иначе карточка модели ссылалась бы на несуществующую запись. */
  remove(id) {
    const i = data.managers.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.managers.splice(i, 1)
    for (const m of data.models) if (m.managerId === id) m.managerId = ''
    save()
    return true
  },
  reorder: (ids) => applyOrder(data.managers, ids),

  /** Пользуется ли кто-то этим фото — спрашивает библиотека медиа. */
  usesPhoto: (path) => data.managers.filter((m) => m.photo === path).map((m) => m.name),
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
    return [...models.usesPhoto(path), ...news.usesCover(path), ...managers.usesPhoto(path)]
  },
}

/* -------------------------------- заявки --------------------------------- */

/** Источник заявки — utm-метка, иначе домен перехода, иначе прямой заход.
    Метки собираются на сайте, см. src/lib/attribution.js. Общая функция для
    разрезов дашборда (задача 6) и фильтра/выгрузки заявок (задача 4). */
const sourceOf = (r) => {
  if (r.utmSource) return r.utmSource
  if (r.referrer) {
    try {
      return new URL(r.referrer).hostname.replace(/^www\./, '')
    } catch {
      return 'Прямой заход'
    }
  }
  return 'Прямой заход'
}

/** Телефон только цифрами — для сравнения независимо от того, как именно
    его набрали («+7 701...» и «8(701)...» должны считаться одним номером). */
const normPhone = (p) => (p || '').replace(/\D/g, '')

/** Сколько раз каждый нормализованный телефон встречается среди ВСЕХ
    заявок — основа для отметки и фильтра дублей (задача 4). */
function phoneCountMap() {
  const counts = new Map()
  for (const r of data.requests) {
    const key = normPhone(r.phone)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/** Сколько дней после закрытия заявки («Обработана») хранить, кто именно
    обращался (задача 20) — дальше store.requests.anonymizeStale() стирает
    имя, телефон и текст обращения, оставляя дату/тип/статус/регион/модель
    для статистики. 730 дней (2 года) — тот же срок, что и гарантия на
    технику: обычно это и есть верхняя граница, когда данные ещё нужны для
    работы с обращением (гарантийный случай, повторная покупка, спор). */
const RETENTION_DAYS = Math.max(1, Number(process.env.REQUEST_RETENTION_DAYS) || 730)

const REQUEST_SORT_KEYS = ['createdAt', 'date', 'fio', 'status', 'aiScore', 'nextContactAt']

/** Общий фильтр + сортировка для requests.query()/exportRows() — без
    пагинации, чтобы выгрузка могла взять весь отфильтрованный список. */
function filteredSortedRequests(params = {}) {
  const {
    status, type, dateFrom, dateTo, modelId, region, source, q, onlyDuplicates,
    sortBy = 'createdAt', sortDir = 'desc',
  } = params

  const phoneCounts = onlyDuplicates ? phoneCountMap() : null
  const qLower = (q || '').trim().toLowerCase()

  let list = data.requests.filter((r) => {
    if (status && r.status !== status) return false
    if (type && r.type !== type) return false
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo && r.date > dateTo) return false
    if (modelId && r.modelId !== modelId) return false
    if (region && r.region !== region) return false
    if (source && !sourceOf(r).toLowerCase().includes(source.toLowerCase())) return false
    if (onlyDuplicates && (phoneCounts.get(normPhone(r.phone)) || 0) < 2) return false
    if (qLower) {
      const hay = `${r.fio} ${r.phone} ${r.comment} ${r.meta}`.toLowerCase()
      if (!hay.includes(qLower)) return false
    }
    return true
  })

  const dir = sortDir === 'asc' ? 1 : -1
  const key = REQUEST_SORT_KEYS.includes(sortBy) ? sortBy : 'createdAt'
  list = [...list].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })

  return list
}

export const requests = {
  all: () => clone(data.requests),
  get: (id) => {
    const r = data.requests.find((x) => x.id === id)
    return r ? clone(r) : null
  },
  create({
    type,
    fio,
    phone,
    meta,
    comment,
    consentAt,
    policyVersion,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    page,
    modelId,
    region,
  }) {
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
      // Атрибуция источника (задача 3 дорожной карты) — откуда пришёл
      // клиент. Может быть пустой у старых заявок и у заявок без меток.
      utmSource: utmSource || '',
      utmMedium: utmMedium || '',
      utmCampaign: utmCampaign || '',
      referrer: referrer || '',
      page: page || '',
      // Модель и регион отдельными полями — meta остаётся готовой строкой
      // для отображения, а эти два поля нужны для разрезов дашборда (задача
      // 6), где строку пришлось бы разбирать обратно на части.
      modelId: modelId || '',
      region: region || '',
      // Обезличивание по сроку хранения (задача 20) — см. requests.anonymizeStale.
      anonymized: false,
      anonymizedAt: null,
      // Рабочие пометки менеджера (задача 4) — не от посетителя, заполняются
      // только в админке.
      notes: '',
      nextContactAt: null,
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
    /* И сразу же — во вторую копию. Без ожидания: клиенту уже можно
       отвечать «отправлено», заявка на диске. Если база лежит, вызов молча
       ничего не делает, а запись доедет ближайшей сверкой после её
       возвращения. Своих исключений не бросает — .catch() тут страховка от
       чужих, чтобы приём заявки не сорвался из-за второстепенного слоя. */
    db.flushNow().catch(() => {})
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
  /** Массовая смена статуса — для чекбоксов в таблице заявок (задача 4).
      Возвращает, сколько заявок реально нашлось и изменилось. */
  setBulkStatus(ids, status) {
    const set = new Set(ids)
    const at = new Date().toISOString()
    let count = 0
    for (const r of data.requests) {
      if (!set.has(r.id)) continue
      r.status = status
      r.resolvedAt = status === 'Обработана' ? at : null
      count++
    }
    if (count) save()
    return count
  },
  /** Заметка менеджера и дата следующего контакта — оба поля необязательны
      по отдельности, null у nextContactAt означает «снять напоминание». */
  setNotes(id, { notes, nextContactAt }) {
    const r = data.requests.find((x) => x.id === id)
    if (!r) return null
    if (notes !== undefined) r.notes = notes
    if (nextContactAt !== undefined) r.nextContactAt = nextContactAt
    save()
    return clone(r)
  },
  /** Заявки списком: фильтры, поиск, сортировка, пагинация — «рабочее
      место» по заявкам (задача 4). Дубли считаются по номеру телефона среди
      ВСЕХ заявок, а не только отфильтрованных, — иначе фильтр мог бы
      случайно спрятать вторую половину пары. */
  query(params = {}) {
    const list = filteredSortedRequests(params)
    const total = list.length
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20))
    const page = Math.max(1, Number(params.page) || 1)
    const phoneCounts = phoneCountMap()
    const items = list
      .slice((page - 1) * pageSize, page * pageSize)
      .map((r) => ({ ...clone(r), duplicateCount: phoneCounts.get(normPhone(r.phone)) || 0 }))
    return { items, total, page, pageSize }
  },
  /** То же самое без пагинации — для выгрузки в CSV/XLSX. Потолок в 5000
      строк защищает процесс от случайной выгрузки без единого фильтра на
      очень большой базе; для реального размера этого бизнеса — с запасом. */
  exportRows(params = {}) {
    const list = filteredSortedRequests(params).slice(0, 5000)
    const phoneCounts = phoneCountMap()
    return list.map((r) => ({ ...clone(r), duplicateCount: phoneCounts.get(normPhone(r.phone)) || 0 }))
  },
  /** Записывает вердикты ИИ-анализатора лидов (см. server/ai.js
      analyzeLeads) прямо в заявки — оценка переживает перезагрузку страницы
      и рестарт сервера, а не живёт только в памяти вкладки браузера. */
  setAiVerdicts(verdicts) {
    if (!verdicts?.length) return
    const at = new Date().toISOString()
    let changed = false
    for (const v of verdicts) {
      const r = data.requests.find((x) => x.id === v.id)
      if (!r) continue
      r.aiScore = v.score
      r.aiPriority = v.priority
      r.aiSummary = v.summary
      r.aiAction = v.action
      r.aiScoredAt = at
      changed = true
    }
    if (changed) save()
  },
  remove(id) {
    const i = data.requests.findIndex((x) => x.id === id)
    if (i === -1) return false
    data.requests.splice(i, 1)
    save()
    return true
  },
  /**
   * Обезличивание по сроку хранения (задача 20).
   *
   * Заявка, закрытая («Обработана») больше RETENTION_DAYS назад, теряет
   * всё, что называет конкретного человека, — имя, телефон, комментарий,
   * рабочие пометки, метки перехода. Дата, тип, статус, регион и модель
   * остаются: это то же событие в статистике дашборда, просто без
   * привязки к личности. Уже обезличенные заявки повторно не трогаем —
   * не бросается ли имя вообще нельзя сравнить, если его уже стёрли.
   *
   * Вызывается по расписанию (см. server/index.js), а не сразу при смене
   * статуса: смысл срока хранения именно в том, что данные нужны какое-то
   * время ПОСЛЕ закрытия — на случай гарантийного обращения, повторной
   * покупки, спора.
   */
  anonymizeStale() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const at = new Date().toISOString()
    let count = 0
    for (const r of data.requests) {
      if (r.anonymized || r.status !== 'Обработана' || !r.resolvedAt) continue
      if (new Date(r.resolvedAt).getTime() > cutoff) continue
      r.fio = 'Обезличено'
      r.phone = ''
      r.comment = ''
      r.notes = ''
      r.utmSource = ''
      r.utmMedium = ''
      r.utmCampaign = ''
      r.referrer = ''
      r.anonymized = true
      r.anonymizedAt = at
      count++
    }
    if (count) save()
    return count
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

/** Держит не больше ~15 месяцев истории у объекта по дням — тот же потолок
    и смысл, что у visits.bump(): старше сводке уже не нужно. */
function capHistory(byDay, maxDays = 450) {
  const days = Object.keys(byDay)
  if (days.length > maxDays) {
    days.sort()
    for (const key of days.slice(0, days.length - maxDays)) delete byDay[key]
  }
}

/* --------------------------- счётчики без cookie (задача 2) -------------- */

export const metrics = {
  /** Просмотр карточки модели — плюс один к счётчику дня для этой модели.
      Дедуп «один раз за вкладку на модель» — на стороне сайта (см.
      ModelPage.jsx), здесь просто считаем, что прислали. */
  bumpModelView(modelId) {
    if (!modelId) return
    const d = today()
    data.metrics.modelViews[d] = data.metrics.modelViews[d] || {}
    data.metrics.modelViews[d][modelId] = (data.metrics.modelViews[d][modelId] || 0) + 1
    capHistory(data.metrics.modelViews)
    save()
  },
  /** Начало заполнения формы (открыли диалог КП/звонка или начали печатать
      на «Контактах») — сигнал интереса отдельно от того, дошли ли до
      отправки. */
  bumpFormStart() {
    const d = today()
    data.metrics.formStarts[d] = (data.metrics.formStarts[d] || 0) + 1
    capHistory(data.metrics.formStarts)
    save()
  },
  /** Открытие панели AI-чата. */
  bumpAiChatOpen() {
    const d = today()
    data.metrics.aiChatOpens[d] = (data.metrics.aiChatOpens[d] || 0) + 1
    capHistory(data.metrics.aiChatOpens)
    save()
  },
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

    // Недельная динамика — то же самое, что и byDay, но свёрнутое по
    // неделям (с понедельника): на месяц из 30 дней отдельные точки читать
    // тяжелее, чем 4-5 недельных.
    const weekStart = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00')
      const dow = (d.getDay() + 6) % 7 // 0 = понедельник
      d.setDate(d.getDate() - dow)
      return d.toISOString().slice(0, 10)
    }
    const weeksMap = new Map()
    for (const row of byDay.values()) {
      const wk = weekStart(row.date)
      if (!weeksMap.has(wk)) weeksMap.set(wk, { weekStart: wk, requests: 0, kp: 0, calls: 0, visits: 0 })
      const w = weeksMap.get(wk)
      w.requests += row.requests
      w.kp += row.kp
      w.calls += row.calls
      w.visits += row.visits
    }
    const weeks = [...weeksMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))

    // Разрез по моделям — только заявки на КП с выбранной моделью (задача 6).
    const modelCounts = new Map()
    for (const r of inMonth) {
      if (!r.modelId) continue
      modelCounts.set(r.modelId, (modelCounts.get(r.modelId) || 0) + 1)
    }
    const byModel = [...modelCounts.entries()]
      .map(([id, count]) => ({ id, name: models.get(id)?.name || 'Модель удалена', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // Разрез по регионам — тоже только там, где регион известен (форма КП).
    const regionCounts = new Map()
    for (const r of inMonth) {
      if (!r.region) continue
      regionCounts.set(r.region, (regionCounts.get(r.region) || 0) + 1)
    }
    const byRegion = [...regionCounts.entries()]
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // Разрез по источникам — utm-метка, иначе домен перехода, иначе прямой
    // заход. Метки собираются на сайте, см. src/lib/attribution.js.
    const sourceCounts = new Map()
    for (const r of inMonth) {
      const key = sourceOf(r)
      sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1)
    }
    const bySource = [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // Свои счётчики без cookie (задача 2) — просмотры карточек моделей за
    // месяц (top-8), начатые формы и открытия AI-чата суммой за месяц.
    const modelViewCounts = new Map()
    for (const d of days) {
      const byModelDay = data.metrics.modelViews[d]
      if (!byModelDay) continue
      for (const [id, count] of Object.entries(byModelDay)) {
        modelViewCounts.set(id, (modelViewCounts.get(id) || 0) + count)
      }
    }
    const modelViewsTotal = [...modelViewCounts.values()].reduce((s, c) => s + c, 0)
    const modelViews = [...modelViewCounts.entries()]
      .map(([id, count]) => ({ id, name: models.get(id)?.name || 'Модель удалена', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
    const formStarts = days.reduce((sum, d) => sum + (data.metrics.formStarts[d] || 0), 0)
    const aiChatOpens = days.reduce((sum, d) => sum + (data.metrics.aiChatOpens[d] || 0), 0)

    return {
      month: m,
      days: [...byDay.values()],
      weeks,
      byModel,
      byRegion,
      bySource,
      modelViews,
      modelViewsTotal,
      formStarts,
      aiChatOpens,
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
  /* Ссылка на встраиваемую карту (2ГИС или Яндекс.Карты). Задаётся в
     админке: заказчик переезжает — меняет ссылку сам, без разработчика.
     Пустая — на «Контактах» показывается адрес текстом и ссылка «Открыть
     в картах», без встраивания. */
  'map_embed_url',
  // Сезонный баннер на карточке модели (задача 10). Персональный менеджер
  // раньше был здесь же (manager_name/phone/photo) — теперь это отдельная
  // сущность managers, назначаемая на модель, см. export const managers.
  /* Строковый флаг, а не булево: все настройки в этом хранилище — строки,
     проверенные str() (см. ниже), а str(true, …) вернул бы '' и стёр бы
     сам флаг. '1' — включено, '' — выключено. */
  'season_banner_enabled',
  'season_banner_text',
]
const URL_KEYS = new Set([
  'leasing_url', 'subsidy_url', 'instagram_url', 'telegram_url', 'whatsapp_url',
  'map_embed_url',
])
/* Фото на главной и на странице «О компании» — не ссылка, а путь к своей
   картинке (/assets/… из комплекта или /uploads/… из библиотеки), поэтому
   проверяются той же safeMedia(), что и фото модели, а не safeUrl(). */
const MEDIA_KEYS = new Set(['hero_photo', 'about_photo'])

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

/**
 * Суточный расход бюджета ИИ (п.18 дорожной карты).
 *
 * Раньше счётчик жил только в переменной процесса server/index.js и
 * обнулялся на каждом деплое или падении — реальный суточный потолок мог
 * оказаться в разы выше заданного, если деплоев за день несколько. Теперь
 * счётчик — часть данных: пишется в store.json (переживает перезапуск
 * контейнера) и через фоновую сверку доезжает до PostgreSQL, если она
 * настроена. Сам потолок (AI_DAILY_MAX) по-прежнему берётся из окружения —
 * это настройка, а не данные.
 */
export const aiBudget = {
  /** Сколько обращений уже потрачено сегодня — со сбросом при смене дня. */
  usedToday() {
    const d = today()
    if (data.aiBudget?.day !== d) {
      data.aiBudget = { day: d, used: 0 }
      save()
    }
    return data.aiBudget.used
  },
  /** Засчитать одно обращение к ИИ. */
  take() {
    aiBudget.usedToday()
    data.aiBudget.used += 1
    save()
  },
}
