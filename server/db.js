/**
 * Хранение данных в PostgreSQL — вторым, надёжным слоем поверх store.json.
 *
 * ─── ГЛАВНОЕ ПРАВИЛО ─────────────────────────────────────────────────────
 * Сайт НИКОГДА не зависит от базы. Совсем. Источник истины во время работы
 * — данные в памяти процесса, снимок которых по-прежнему пишется в
 * data/store.json ровно так, как раньше. База — второй экземпляр этих же
 * данных, который догоняет память в фоне.
 *
 * Отсюда всё поведение:
 *   • база не поднялась при старте — сайт стартует и работает как раньше;
 *   • база упала на ходу — посетитель ничего не замечает, заявки
 *     принимаются, админка сохраняет; в лог идёт предупреждение;
 *   • база вернулась — данные из памяти доливаются в неё целиком, без
 *     ручных действий; ничего из накопленного за простой не теряется;
 *   • базы нет в принципе (DATABASE_URL не задан) — модуль спит и не
 *     тратит ни соединения, ни памяти.
 *
 * Ни один вызов отсюда не бросает исключение наружу и не блокирует запрос
 * посетителя. Всё, что здесь может сломаться, ломается тихо и в фоне.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─── ЗАЧЕМ ТОГДА БАЗА, ЕСЛИ И БЕЗ НЕЁ РАБОТАЕТ ───────────────────────────
 * JSON-файл — это один файл на одном томе. Он переживает перезапуск
 * контейнера, но не переживает потерю тома, и он целиком лежит в
 * оперативной памяти: на тысячах заявок это перестанет быть бесплатным.
 * База даёт вторую независимую копию, индексы (свежие заявки, поиск по
 * телефону, разрезы по статусу) и точку, к которой можно подключиться
 * извне — выгрузить, посчитать, отдать в 1С.
 *
 * Переход мягкий и обратимый: JSON остаётся на месте и остаётся рабочим.
 * В любой момент можно выключить DATABASE_URL и продолжить как раньше.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─── КАК ДАННЫЕ ПОПАДАЮТ В БАЗУ ──────────────────────────────────────────
 * Не по одному запросу на каждую правку. Раз в несколько секунд (SYNC_MS)
 * происходит сверка: для каждой записи считается отпечаток содержимого и
 * сравнивается с отпечатком, отправленным в прошлый раз. В базу уезжает
 * только изменившееся, исчезнувшее из памяти — удаляется.
 *
 * Такой способ выбран потому, что не требует трогать ни один из двух
 * десятков методов store.js: сверка сама видит, что поменялось. Побочная
 * выгода — при обрыве связи не нужен журнал недоставленного: память и есть
 * полный журнал, после переподключения сверка просто идёт целиком.
 *
 * Исключение — заявки. Они уезжают в базу немедленно (см. flushNow из
 * store.requests.create): потерять обращение клиента в трёхсекундном окне
 * недопустимо, а всё остальное подождёт.
 * ─────────────────────────────────────────────────────────────────────────
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(__dirname, 'db-schema.sql')

/* ---------------------------- настройка ---------------------------------- */

/** Строка подключения. Пусто — модуль не работает вовсе, и это нормально. */
const URL = () => process.env.DATABASE_URL || ''

export const configured = () => !!URL()

/**
 * Кто главный при расхождении данных, если и в файле, и в базе что-то есть.
 *   auto (по умолчанию) — разбираемся сами, см. decideSource();
 *   json — всегда файл (база приводится к нему);
 *   db   — всегда база (файл перезаписывается из неё).
 * Ручной режим нужен ровно в двух случаях: восстановление после аварии и
 * разбор «а почему у меня старые данные».
 */
const SOURCE = () => (process.env.DB_SOURCE || 'auto').toLowerCase()

/** Период фоновой сверки. Чаще — лишняя нагрузка, реже — больше окно потери. */
const SYNC_MS = Math.max(1000, Number(process.env.DB_SYNC_MS) || 3000)

/**
 * Потолок паузы между попытками переподключения.
 *
 * Пауза удваивается: 2, 4, 8, 16, 30, 30 с… Замер на испытании подтвердил
 * именно такой рост. Потолок в 30 с выбран как компромисс: реже — и
 * вернувшаяся база полминуты числилась бы упавшей (данные при этом целы,
 * но в админке горит красное и человек идёт разбираться на пустом месте);
 * чаще — бессмысленный стук в лежащую базу. Стучаться раз в 30 секунд не
 * стоит практически ничего.
 */
const RETRY_MAX_MS = Math.max(5000, Number(process.env.DB_RETRY_MAX_MS) || 30_000)

/* --------------------------- состояние модуля ----------------------------- */

/** 'off' — не настроено; 'starting'; 'up' — работает; 'down' — база недоступна. */
let state = 'off'
let pool = null
let lastError = ''
let lastErrorAt = null
let lastSyncAt = null
let lastSyncMs = 0
let downSince = null
let retryMs = 2000
let retryTimer = null
let syncTimer = null
let syncing = false
/** Нужна полная перезаливка: после переподключения или ошибки посреди сверки. */
let needFullSync = true
/** Что-то поменялось в памяти с прошлой сверки. Ставится из store.save(). */
let dirty = true
/** Отпечатки отправленного: коллекция → Map(ключ → отпечаток). */
const sent = new Map()
/** Счётчики для админки и логов. */
const stats = { syncs: 0, rowsUpserted: 0, rowsDeleted: 0, reconnects: 0, errors: 0 }

/* Мост к store.js. Заполняется вызовом attach() — так модуль ничего не знает
   про хранилище, а хранилище не знает про SQL. */
let bridge = null

/**
 * Связывает модуль с хранилищем.
 * @param {object} b
 * @param {() => object} b.getData      сырые данные из памяти (тот самый объект)
 * @param {(d: object) => void} b.setData  положить данные в память
 * @param {() => void} b.saveJson       немедленно записать снимок в store.json
 */
export function attach(b) {
  bridge = b
}

/** Отметить, что данные в памяти изменились (зовётся из store.save()). */
export function markDirty() {
  dirty = true
}

/**
 * Куда сообщать о смене состояния базы (упала / поднялась).
 *
 * Отдельно от attach() потому, что это разные вещи: мост к хранилищу
 * ставит store.js, а канал оповещений — server/index.js, где известно про
 * Telegram. Не задан — сообщения просто идут в лог.
 */
let alertFn = null
export function attachAlert(fn) {
  alertFn = typeof fn === 'function' ? fn : null
}
const alert = (msg) => {
  try {
    alertFn?.(msg)
  } catch {
    /* оповещение — вспомогательная вещь, ронять из-за него ничего нельзя */
  }
}

/* ------------------------------ описание данных --------------------------- */

/**
 * Соответствие «что лежит в памяти» → «куда ложится в базе».
 *
 * rows()  — разложить кусок памяти на строки таблицы;
 * apply() — собрать этот кусок обратно из строк базы.
 *
 * Формат записи (поле data) при этом не меняется вообще: как лежало в
 * store.json, так и уезжает в jsonb. Именно поэтому обратная дорога из базы
 * в файл безопасна и не теряет полей, о которых этот файл не знает.
 */
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
const s = (v) => (typeof v === 'string' ? v : v == null ? null : String(v))

const COLLECTIONS = [
  {
    name: 'categories',
    table: 'categories',
    key: 'id',
    cols: ['name', 'sort'],
    rows: (d) => (d.categories || []).map((x) => ({ key: x.id, cols: [s(x.name), int(x.sort)], doc: x })),
    apply: (d, docs) => { d.categories = docs.sort(bySort) },
  },
  {
    name: 'services',
    table: 'services',
    key: 'id',
    cols: ['title', 'sort'],
    rows: (d) => (d.services || []).map((x) => ({ key: x.id, cols: [s(x.title), int(x.sort)], doc: x })),
    apply: (d, docs) => { d.services = docs.sort(bySort) },
  },
  {
    name: 'stats',
    table: 'stats',
    key: 'id',
    cols: ['sort'],
    rows: (d) => (d.stats || []).map((x) => ({ key: x.id, cols: [int(x.sort)], doc: x })),
    apply: (d, docs) => { d.stats = docs.sort(bySort) },
  },
  {
    name: 'certs',
    table: 'certs',
    key: 'id',
    cols: ['title', 'sort'],
    rows: (d) => (d.certs || []).map((x) => ({ key: x.id, cols: [s(x.title), int(x.sort)], doc: x })),
    apply: (d, docs) => { d.certs = docs.sort(bySort) },
  },
  {
    name: 'serviceCenters',
    table: 'service_centers',
    key: 'id',
    cols: ['name', 'sort'],
    rows: (d) => (d.serviceCenters || []).map((x) => ({ key: x.id, cols: [s(x.name), int(x.sort)], doc: x })),
    apply: (d, docs) => { d.serviceCenters = docs.sort(bySort) },
  },
  {
    name: 'models',
    table: 'models',
    key: 'id',
    cols: ['cat', 'name', 'sort', 'published', 'subsidized'],
    rows: (d) =>
      (d.models || []).map((x) => ({
        key: x.id,
        cols: [s(x.cat), s(x.name), int(x.sort), !!x.published, !!x.subsidized],
        doc: x,
      })),
    apply: (d, docs) => { d.models = docs.sort(bySort) },
  },
  {
    name: 'news',
    table: 'news',
    key: 'id',
    cols: ['date', 'title', 'published'],
    rows: (d) =>
      (d.news || []).map((x) => ({ key: x.id, cols: [s(x.date), s(x.title), !!x.published], doc: x })),
    // Новости показываются свежими сверху — восстанавливаем тот же порядок.
    apply: (d, docs) => { d.news = docs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) },
  },
  {
    name: 'requests',
    table: 'requests',
    key: 'id',
    cols: ['date', 'created_at', 'status', 'type', 'fio', 'phone'],
    rows: (d) =>
      (d.requests || []).map((x) => ({
        key: x.id,
        cols: [s(x.date), tstamp(x.createdAt), s(x.status), s(x.type), s(x.fio), s(x.phone)],
        doc: x,
      })),
    /* Заявки в памяти лежат свежими сверху (create делает unshift). Тот же
       порядок восстанавливаем при подъёме из базы: у старых записей нет
       createdAt, поэтому запасной ключ — дата. */
    apply: (d, docs) => {
      d.requests = docs.sort((a, b) =>
        String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || ''))
      )
    },
  },
  {
    name: 'media',
    table: 'media',
    key: 'name',
    cols: ['path', 'size', 'at'],
    rows: (d) =>
      (d.media || []).map((x) => ({ key: x.name, cols: [s(x.path), int(x.size), s(x.at)], doc: x })),
    apply: (d, docs) => { d.media = docs.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) },
  },
]

const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0)

/** ISO-строка → значение для timestamptz. Мусор превращаем в NULL, не в ошибку. */
function tstamp(v) {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/* Коллекции-не-списки: настройки, регионы, визиты, кэш ИИ, пароль. Каждой
   нужна своя раскладка, поэтому они обрабатываются отдельно, а не общим
   механизмом выше. */

const fp = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16)

/* ------------------------------- подключение ------------------------------ */

function makePool() {
  const p = new pg.Pool({
    connectionString: URL(),
    // Маленький VPS: больше четырёх соединений здесь не нужно никому, а
    // каждое стоит памяти и на стороне Postgres.
    max: Math.max(2, Number(process.env.DB_POOL_MAX) || 4),
    // Не ждём подключения дольше нескольких секунд: если база не отвечает,
    // нам важно быстро это понять и уйти в режим «работаем без базы», а не
    // держать таймер на минуту.
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30_000,
    // Потолок на запрос. Без него зависший на блокировке запрос держал бы
    // соединение и очередь сверки бесконечно.
    statement_timeout: 15_000,
    query_timeout: 15_000,
    // Незакрытая транзакция не должна жить вечно и копить мусор.
    idle_in_transaction_session_timeout: 20_000,
    keepAlive: true,
    application_name: 'shm-agro',
    ssl: process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : false,
  })

  /* Самое важное место во всём файле.
     У пула бывают ошибки на ПРОСТАИВАЮЩЕМ соединении — база перезапустилась,
     сеть моргнула, администратор сделал pg_terminate_backend. Без этого
     обработчика Node считает такую ошибку необработанной и убивает процесс.
     То есть падение контейнера с базой роняло бы сам сайт — ровно то, чего
     мы здесь избегаем.

     ВНИМАНИЕ: этого обработчика достаточно только для простаивающих
     соединений. За выданные наружу отвечает withClient() ниже — см.
     объяснение там, это отдельная и не менее опасная дыра. */
  p.on('error', (e) => {
    goDown(e)
  })

  return p
}

/**
 * Работа с отдельным соединением из пула.
 *
 * Зачем обёртка, а не просто pool.connect(): пока соединение выдано
 * наружу, пул за него не отвечает и своего обработчика ошибок на нём не
 * держит. Если база оборвёт связь ровно в этот момент (перезапуск
 * контейнера, OOM, pg_terminate_backend), соединение отправит событие
 * 'error' в пустоту, а Node такое событие без слушателя превращает в
 * падение процесса.
 *
 * Именно так это и повело себя на испытании: остановка базы командой
 * `pg_ctl -m immediate stop` посреди сверки убивала сайт целиком. Ошибку
 * запроса при этом честно возвращает отклонённый промис ниже, поэтому
 * слушателю здесь достаточно просто существовать.
 *
 * Второе: сломавшееся соединение возвращается в пул с флагом уничтожения.
 * Иначе оно вернулось бы в оборот и следующая же операция снова упала бы
 * на нём — уже без внятной причины в логе.
 */
async function withClient(fn) {
  const client = await pool.connect()
  const глушитель = () => {}
  client.on('error', глушитель)
  let сломалось = false
  try {
    return await fn(client)
  } catch (e) {
    сломалось = true
    throw e
  } finally {
    /* Снимаем свой слушатель до возврата в пул: соединение переиспользуется,
       и без этого слушатели копились бы с каждым циклом сверки. Между
       снятием и release нет ни одного await — проскочить событию некуда. */
    client.removeListener('error', глушитель)
    try {
      client.release(сломалось)
    } catch {
      /* соединение уже уничтожено — возвращать нечего */
    }
  }
}

/**
 * Одиночный запрос вне транзакции. Тот же разговор, что и в withClient:
 * pool.query() внутри тоже берёт соединение, и обрыв на нём не должен
 * ронять процесс.
 */
const query = (text, params) => withClient((c) => c.query(text, params))

function goDown(e) {
  const msg = e?.message || String(e)
  if (state !== 'down') {
    downSince = new Date()
    console.error(`⚠ PostgreSQL недоступен: ${msg}`)
    console.error('  Сайт продолжает работать на data/store.json. Данные не теряются.')
    alert(`База данных недоступна: ${msg}. Сайт работает, данные пишутся в файл.`)
  }
  state = 'down'
  lastError = msg
  lastErrorAt = new Date()
  stats.errors += 1
  needFullSync = true
  sent.clear()
  scheduleRetry()
}

function scheduleRetry() {
  if (retryTimer || !configured()) return
  retryTimer = setTimeout(async () => {
    retryTimer = null
    const ok = await connect()
    if (!ok) {
      // Пауза удваивается до потолка: не долбим упавшую базу каждую секунду.
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2)
      scheduleRetry()
    }
  }, retryMs)
  retryTimer.unref?.()
}

/** Одна попытка подключиться и убедиться, что схема на месте. */
async function connect() {
  if (!configured()) return false
  try {
    if (!pool) pool = makePool()
    await query('select 1')
    await ensureSchema()

    const wasDown = state === 'down'
    state = 'up'
    lastError = ''
    retryMs = 2000
    if (wasDown) {
      stats.reconnects += 1
      const secs = downSince ? Math.round((Date.now() - downSince) / 1000) : 0
      console.log(`✓ PostgreSQL снова доступен (простой ~${secs} с). Доливаю данные из памяти…`)
      alert(`База данных снова доступна (простой ~${secs} с). Данные восстановлены из памяти.`)
      downSince = null
      needFullSync = true
      // Немедленная полная сверка: за время простоя память ушла вперёд.
      syncSoon()
    }
    return true
  } catch (e) {
    goDown(e)
    return false
  }
}

async function ensureSchema() {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
  await query(sql)
}

/* ------------------------------- запись ----------------------------------- */

/**
 * Пакетная запись строк. Пишем группами: одним запросом с сотней записей
 * вместо сотни запросов. Больше 200 за раз не берём — у Postgres потолок на
 * число параметров в запросе, и упереться в него на большом каталоге легко.
 */
async function upsertRows(client, spec, rows) {
  if (!rows.length) return
  const CHUNK = 200
  const colNames = [spec.key, ...spec.cols, 'data', 'updated_at']
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK)
    const params = []
    const tuples = part.map((r) => {
      const base = params.length
      params.push(r.key, ...r.cols, JSON.stringify(r.doc))
      const ph = colNames.slice(0, -1).map((_, j) => `$${base + j + 1}`)
      return `(${ph.join(',')}, now())`
    })
    const setList = colNames
      .slice(1)
      .map((c) => (c === 'updated_at' ? 'updated_at = now()' : `${c} = excluded.${c}`))
      .join(', ')
    await client.query(
      `insert into ${spec.table} (${colNames.join(',')}) values ${tuples.join(',')}
       on conflict (${spec.key}) do update set ${setList}`,
      params
    )
  }
}

async function deleteKeys(client, spec, keys) {
  if (!keys.length) return
  const CHUNK = 500
  for (let i = 0; i < keys.length; i += CHUNK) {
    await client.query(`delete from ${spec.table} where ${spec.key} = any($1)`, [keys.slice(i, i + CHUNK)])
  }
}

/**
 * Сверка одной коллекции: что изменилось — обновляем, что исчезло — удаляем.
 * Возвращает [сколько записано, сколько удалено].
 */
async function syncCollection(client, spec, data, full) {
  const rows = spec.rows(data)
  const prev = sent.get(spec.name) || new Map()
  const now = new Map()
  const changed = []

  for (const r of rows) {
    if (r.key == null || r.key === '') continue
    const h = fp(r.doc)
    now.set(String(r.key), h)
    if (full || prev.get(String(r.key)) !== h) changed.push(r)
  }

  const gone = full ? [] : [...prev.keys()].filter((k) => !now.has(k))

  await upsertRows(client, spec, changed)
  await deleteKeys(client, spec, gone)

  /* При полной сверке удаляем всё, чего нет в памяти, одним запросом: после
     простоя базы список удалённых записей у нас не сохранился. */
  if (full) {
    const keys = [...now.keys()]
    if (keys.length) {
      await client.query(`delete from ${spec.table} where not (${spec.key} = any($1))`, [keys])
    } else {
      await client.query(`delete from ${spec.table}`)
    }
  }

  sent.set(spec.name, now)
  return [changed.length, gone.length]
}

/** Настройки: плоские ключ→строка. */
async function syncSettings(client, data, full) {
  const map = data.settings || {}
  const prev = sent.get('settings') || new Map()
  const now = new Map()
  const changed = []
  for (const [k, v] of Object.entries(map)) {
    const val = v == null ? '' : String(v)
    const h = fp(val)
    now.set(k, h)
    if (full || prev.get(k) !== h) changed.push([k, val])
  }
  if (changed.length) {
    await client.query(
      `insert into settings (key, value, updated_at)
       select k, v, now() from unnest($1::text[], $2::text[]) as t(k, v)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [changed.map((c) => c[0]), changed.map((c) => c[1])]
    )
  }
  const keys = [...now.keys()]
  if (full) {
    await client.query(`delete from settings where not (key = any($1))`, [keys.length ? keys : ['']])
  } else {
    const gone = [...prev.keys()].filter((k) => !now.has(k))
    if (gone.length) await client.query('delete from settings where key = any($1)', [gone])
  }
  sent.set('settings', now)
  return changed.length
}

/** Визиты по дням: день → счётчик. */
async function syncVisits(client, data, full) {
  const map = data.visits || {}
  const prev = sent.get('visits') || new Map()
  const now = new Map()
  const days = []
  const counts = []
  for (const [day, n] of Object.entries(map)) {
    const c = int(n) ?? 0
    const h = String(c)
    now.set(day, h)
    if (full || prev.get(day) !== h) {
      days.push(day)
      counts.push(c)
    }
  }
  if (days.length) {
    await client.query(
      `insert into visits (day, count)
       select * from unnest($1::text[], $2::int[])
       on conflict (day) do update set count = excluded.count`,
      [days, counts]
    )
  }
  if (full) {
    const all = [...now.keys()]
    await client.query('delete from visits where not (day = any($1))', [all.length ? all : ['']])
  } else {
    const gone = [...prev.keys()].filter((k) => !now.has(k))
    if (gone.length) await client.query('delete from visits where day = any($1)', [gone])
  }
  sent.set('visits', now)
  return days.length
}

/** Кэш ИИ. Приоритет низкий: потеря кэша — это только лишние деньги за токены. */
async function syncAiCache(client, data, full) {
  const map = data.aiCache || {}
  const prev = sent.get('aiCache') || new Map()
  const now = new Map()
  const keys = []
  const vals = []
  const saved = []
  const exps = []
  for (const [k, e] of Object.entries(map)) {
    if (!e || typeof e !== 'object') continue
    const h = fp(e)
    now.set(k, h)
    if (full || prev.get(k) !== h) {
      keys.push(k)
      vals.push(JSON.stringify(e.v ?? null))
      saved.push(int(e.at) ?? 0)
      exps.push(int(e.exp) ?? 0)
    }
  }
  if (keys.length) {
    await client.query(
      `insert into ai_cache (key, value, saved_at, expires_at)
       select * from unnest($1::text[], $2::jsonb[], $3::bigint[], $4::bigint[])
       on conflict (key) do update set value = excluded.value,
         saved_at = excluded.saved_at, expires_at = excluded.expires_at`,
      [keys, vals, saved, exps]
    )
  }
  const gone = full ? [] : [...prev.keys()].filter((k) => !now.has(k))
  if (gone.length) await client.query('delete from ai_cache where key = any($1)', [gone])
  if (full) {
    const all = [...now.keys()]
    await client.query('delete from ai_cache where not (key = any($1))', [all.length ? all : ['']])
  }
  sent.set('aiCache', now)
  return keys.length
}

/** Мелкие документы одним куском: регионы и хэш пароля админки. */
async function syncKv(client, data, full) {
  const items = [
    ['regions', data.regions || []],
    ['auth', data.auth || {}],
    ['aiBudget', data.aiBudget || { day: '', used: 0 }],
  ]
  const prev = sent.get('kv') || new Map()
  const now = new Map()
  let n = 0
  for (const [k, v] of items) {
    const h = fp(v)
    now.set(k, h)
    if (full || prev.get(k) !== h) {
      await client.query(
        `insert into kv (key, value, updated_at) values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [k, JSON.stringify(v)]
      )
      n += 1
    }
  }
  sent.set('kv', now)
  return n
}

/* ------------------------------ полная сверка ----------------------------- */

/**
 * Один проход сверки памяти с базой.
 *
 * Всё внутри одной транзакции: либо база догнала память целиком, либо
 * осталась в прежнем состоянии. Промежуточных состояний, где половина
 * каталога новая, а половина старая, не бывает.
 */
async function runSync() {
  if (state !== 'up' || syncing || !bridge) return
  if (!dirty && !needFullSync) return

  syncing = true
  const t0 = Date.now()
  const full = needFullSync
  const data = bridge.getData()
  let up = 0
  let del = 0

  try {
    await withClient(async (client) => {
      await client.query('begin')
      try {
        for (const spec of COLLECTIONS) {
          const [u, d] = await syncCollection(client, spec, data, full)
          up += u
          del += d
        }
        up += await syncSettings(client, data, full)
        up += await syncVisits(client, data, full)
        up += await syncAiCache(client, data, full)
        up += await syncKv(client, data, full)

        await client.query(
          `insert into store_meta (key, value, updated_at) values ('last_sync', $1::jsonb, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [JSON.stringify({ at: new Date().toISOString(), full, upserted: up, deleted: del })]
        )

        await client.query('commit')
      } catch (e) {
        try {
          await client.query('rollback')
        } catch {
          /* соединение уже мертво — откатывать нечего и незачем */
        }
        throw e
      }
    })

    dirty = false
    needFullSync = false
    lastSyncAt = new Date()
    lastSyncMs = Date.now() - t0
    stats.syncs += 1
    stats.rowsUpserted += up
    stats.rowsDeleted += del

    if (full) {
      console.log(`✓ Полная сверка с PostgreSQL: ${up} записей, удалено ${del}, ${lastSyncMs} мс`)
    }
  } catch (e) {
    /* Отпечатки после сбоя недостоверны: часть строк могла уехать, часть нет.
       goDown() их сбрасывает, и следующая сверка пройдёт целиком. */
    goDown(e)
  } finally {
    syncing = false
  }
}

let soonTimer = null
/** Провести сверку вне расписания (после переподключения, после заявки). */
function syncSoon(delay = 50) {
  if (soonTimer) return
  soonTimer = setTimeout(() => {
    soonTimer = null
    runSync().catch(() => {})
  }, delay)
  soonTimer.unref?.()
}

/**
 * Немедленно дописать в базу. Зовётся из store.requests.create() и при
 * завершении процесса. Никогда не бросает и не задерживает вызывающего
 * дольше нескольких секунд.
 */
export async function flushNow() {
  if (state !== 'up') return false
  markDirty()
  try {
    await runSync()
    return true
  } catch {
    return false
  }
}

/* ------------------------- подъём данных из базы -------------------------- */

/** Сколько записей в базе — по этому решается, пустая она или нет. */
async function dbCounts() {
  const out = {}
  for (const spec of COLLECTIONS) {
    const r = await query(`select count(*)::int as n from ${spec.table}`)
    out[spec.name] = r.rows[0].n
  }
  for (const t of ['settings', 'visits', 'ai_cache', 'kv']) {
    const r = await query(`select count(*)::int as n from ${t}`)
    out[t] = r.rows[0].n
  }
  return out
}

/** Есть ли в базе хоть какой-то настоящий контент (кэш ИИ и визиты не в счёт). */
const hasContent = (c) =>
  (c.models || 0) + (c.news || 0) + (c.requests || 0) + (c.categories || 0) + (c.settings || 0) > 0

/**
 * Собрать данные из базы в тот же формат, что лежит в store.json.
 * Возвращает объект data целиком — его можно отдать store.hydrate().
 */
async function readAll() {
  const d = {}
  for (const spec of COLLECTIONS) {
    const r = await query(`select data from ${spec.table}`)
    spec.apply(d, r.rows.map((x) => x.data))
  }

  const st = await query('select key, value from settings')
  d.settings = Object.fromEntries(st.rows.map((r) => [r.key, r.value ?? '']))

  const vs = await query('select day, count from visits')
  d.visits = Object.fromEntries(vs.rows.map((r) => [r.day, r.count]))

  const ac = await query('select key, value, saved_at, expires_at from ai_cache')
  d.aiCache = Object.fromEntries(
    ac.rows.map((r) => [r.key, { v: r.value, at: Number(r.saved_at) || 0, exp: Number(r.expires_at) || 0 }])
  )

  const kv = await query('select key, value from kv')
  const kvMap = Object.fromEntries(kv.rows.map((r) => [r.key, r.value]))
  d.regions = Array.isArray(kvMap.regions) ? kvMap.regions : []
  d.auth = kvMap.auth && typeof kvMap.auth === 'object' ? kvMap.auth : {}
  d.aiBudget =
    kvMap.aiBudget && typeof kvMap.aiBudget === 'object' ? kvMap.aiBudget : { day: '', used: 0 }

  return d
}

/**
 * Кто главный на этом старте.
 *
 * Разбор случаев (режим auto):
 *   1. База пустая → главный файл. Это первичная миграция: содержимое
 *      store.json переезжает в базу как есть.
 *   2. Файла не было или он не читался (store.load() вернул seeded), а в
 *      базе данные есть → главная база. Это восстановление: том с файлом
 *      потеряли, база уцелела — поднимаем сайт из неё и заново пишем файл.
 *   3. Есть и то и другое → главный файл. Он и был источником истины всё
 *      время работы; база просто догоняет.
 *
 * Случай 3 сознательно решён в пользу файла, а не «кто новее». «Новее» тут
 * ненадёжно: восстановление вчерашней копии store.json — это осознанное
 * действие администратора, и база в этот момент новее, но неправа.
 */
function decideSource(seeded, counts) {
  const mode = SOURCE()
  if (mode === 'json') return { from: 'json', why: 'DB_SOURCE=json — файл задан главным вручную' }
  if (mode === 'db') return { from: 'db', why: 'DB_SOURCE=db — база задана главной вручную' }

  if (!hasContent(counts)) return { from: 'json', why: 'база пуста — первичный перенос данных из файла' }
  if (seeded) return { from: 'db', why: 'файла данных не было — поднимаемся из базы' }
  return { from: 'json', why: 'файл на месте и он главный — база догоняет' }
}

/* --------------------------------- запуск --------------------------------- */

/**
 * Поднять слой базы. Вызывается ПОСЛЕ store.load() и НЕ блокирует запуск
 * сервера: сайт уже отвечает на запросы, пока здесь идёт подключение.
 *
 * @param {{ seeded: boolean }} opts
 */
export async function start({ seeded = false } = {}) {
  if (!configured()) {
    state = 'off'
    console.log('  База данных: не настроена (DATABASE_URL пуст) — работаем на data/store.json')
    return { state }
  }
  if (!bridge) throw new Error('db.start() до db.attach() — забыт вызов из store.js')

  state = 'starting'
  console.log('  База данных: подключаюсь к PostgreSQL…')

  const ok = await connect()
  if (!ok) {
    // Сайт уже работает. Переподключение назначено, дальше — в фоне.
    console.warn('  ⚠ подключиться сейчас не вышло — сайт работает на файле, попытки продолжатся')
    startSyncLoop()
    return { state }
  }

  try {
    const counts = await dbCounts()
    const decision = decideSource(seeded, counts)
    console.log(`  Источник данных: ${decision.from === 'db' ? 'PostgreSQL' : 'store.json'} (${decision.why})`)

    if (decision.from === 'db') {
      const fromDb = await readAll()
      bridge.setData(fromDb)
      bridge.saveJson()
      console.log(
        `  ✓ подняли из базы: моделей ${counts.models}, новостей ${counts.news}, заявок ${counts.requests}`
      )
      /* Файл теперь совпадает с базой, но отпечатков у нас ещё нет —
         следующая сверка пройдёт полностью и всё сойдётся. */
      needFullSync = true
    } else {
      needFullSync = true
      await runSync()
    }

    await query(
      `insert into store_meta (key, value, updated_at) values ('boot', $1::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify({ at: new Date().toISOString(), source: decision.from, why: decision.why })]
    )
  } catch (e) {
    goDown(e)
  }

  startSyncLoop()
  return { state }
}

function startSyncLoop() {
  clearInterval(syncTimer)
  syncTimer = setInterval(() => {
    if (state === 'up') runSync().catch(() => {})
  }, SYNC_MS)
  syncTimer.unref?.()
}

/* ------------------------------- наблюдение -------------------------------- */

/** Состояние для /api/health и админки. Ничего не читает из базы — дёшево. */
export function status() {
  return {
    configured: configured(),
    state,
    ok: state === 'up' || state === 'off',
    lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
    lastSyncMs,
    downSince: downSince ? downSince.toISOString() : null,
    lastError: lastError || null,
    lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
    pendingFullSync: needFullSync,
    ...stats,
  }
}

/** Подробное состояние для админки: со счётчиками строк прямо из базы. */
export async function statusDetailed() {
  const base = status()
  if (state !== 'up') return { ...base, counts: null }
  try {
    return { ...base, counts: await dbCounts() }
  } catch (e) {
    return { ...base, counts: null, lastError: e.message }
  }
}

/** Принудительная полная перезаливка памяти в базу (кнопка в админке). */
export async function resync() {
  if (!configured()) return { ok: false, error: 'База не настроена' }
  if (state !== 'up') {
    const ok = await connect()
    if (!ok) return { ok: false, error: lastError || 'База недоступна' }
  }
  needFullSync = true
  sent.clear()
  await runSync()
  return { ok: state === 'up', ...status() }
}

/** Закрыть соединения при остановке процесса. */
export async function close() {
  clearInterval(syncTimer)
  clearTimeout(retryTimer)
  clearTimeout(soonTimer)
  syncTimer = retryTimer = soonTimer = null
  if (!pool) return
  try {
    await pool.end()
  } catch {
    /* база уже недоступна — закрывать нечего */
  }
  pool = null
  state = configured() ? 'down' : 'off'
}

/* --------------------------- ручные операции (CLI) ------------------------- */

/** Прочитать всё из базы — для server/db-cli.js (экспорт в файл). */
export async function readAllForCli() {
  if (!pool) pool = makePool()
  await query('select 1')
  await ensureSchema()
  return readAll()
}

/** Счётчики строк — для server/db-cli.js. */
export async function countsForCli() {
  if (!pool) pool = makePool()
  await query('select 1')
  await ensureSchema()
  return dbCounts()
}
