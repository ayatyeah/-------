/**
 * ИИ-функции сайта: анализатор лидов для админки и чат-ассистент на главной.
 *
 * ─── ПРОВАЙДЕРЫ ────────────────────────────────────────────────────────
 * Порядок по умолчанию: OpenAI → Gemini → правила.
 *   1. OpenAI (основной). Модель в OPENAI_MODEL, по умолчанию gpt-5-mini.
 *   2. Gemini (резерв). Ключей может быть до трёх: GEMINI_API_KEY,
 *      GEMINI_API_KEY_2, GEMINI_API_KEY_3. Если ключ упёрся в лимит (429),
 *      берём следующий — поэтому их и несколько.
 *   3. Правила. Работают всегда, даже без ключей: сайт остаётся живым.
 *
 * Порядок меняется переменной AI_ORDER без правки кода, например
 * AI_ORDER=gemini,openai — вернуть Gemini на первое место.
 *
 * Внешних библиотек нет — только fetch, он есть в Node 22 из коробки.
 *
 * ─── ОСОБЕННОСТЬ gpt-5-mini ────────────────────────────────────────────
 * Это reasoning-модель: часть бюджета уходит на внутренние рассуждения.
 * При max_completion_tokens=20 ответ приходит ПУСТОЙ (finish_reason:
 * 'length') — токены кончились на размышлениях. Поэтому лимиты здесь
 * заведомо щедрые, иначе получим пустоту вместо текста.
 *
 * ─── СХЕМЫ ОТВЕТА ──────────────────────────────────────────────────────
 * Схемы здесь пишутся по стандарту JSON Schema, типы строчными. Gemini
 * такие принимает как есть. OpenAI в режиме strict дополнительно требует
 * "additionalProperties": false у каждого объекта — их дописывает
 * strictSchema() перед отправкой, а Gemini на это поле отвечает 400,
 * поэтому в исходной схеме его нет.
 */
import { createHash } from 'node:crypto'
import * as store from './store.js'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini'

const geminiKeys = () =>
  [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(
    Boolean
  )

const openaiKey = () => process.env.OPENAI_API_KEY || ''

/** Есть ли ключ у провайдера. */
const hasKey = {
  openai: () => !!openaiKey(),
  gemini: () => geminiKeys().length > 0,
}

/** Порядок провайдеров: из AI_ORDER или по умолчанию OpenAI → Gemini. */
function providerOrder() {
  return (process.env.AI_ORDER || 'openai,gemini')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((p) => p in hasKey)
}

/** Включён ли ИИ вообще. */
export const aiEnabled = () => providerOrder().some((p) => hasKey[p]())

/** Какой провайдер сейчас главный — показываем это в интерфейсе честно. */
export function aiEngine() {
  return providerOrder().find((p) => hasKey[p]()) ?? 'rules'
}

/* ======================================================================
   ВЫЗОВЫ ПРОВАЙДЕРОВ
   ====================================================================== */

const TIMEOUT = 40000

/**
 * Запрос к Gemini. Перебирает ключи: если один упёрся в лимит или
 * оказался недействительным, пробуем следующий.
 * schema — необязательная JSON-схема ответа (Gemini вернёт валидный JSON).
 */
async function callGemini({ system, messages, schema, maxTokens = 1200, think = false }) {
  const keys = geminiKeys()
  if (!keys.length) return null

  const body = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      // 2.5-flash умеет «думать». Для чата это лишняя задержка, а на
      // разборе заявок размышления окупаются. Бюджет ограничен: без
      // ограничения (-1) разбор занимал ~16 секунд, менеджер столько ждать
      // не станет.
      thinkingConfig: { thinkingBudget: think ? 1024 : 0 },
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  let lastErr = ''
  for (const [i, key] of keys.entries()) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT),
        }
      )

      if (r.status === 429 || r.status === 403) {
        lastErr = `ключ ${i + 1}: HTTP ${r.status}`
        continue // лимит или доступ — пробуем следующий ключ
      }
      if (!r.ok) {
        lastErr = `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`
        continue
      }

      const d = await r.json()
      const text = (d.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text || '')
        .join('')
        .trim()
      if (text) {
        const u = d.usageMetadata ?? {}
        return {
          text,
          usage: {
            вход: u.promptTokenCount ?? 0,
            размышления: u.thoughtsTokenCount ?? 0,
            ответ: u.candidatesTokenCount ?? 0,
            всего: u.totalTokenCount ?? 0,
          },
        }
      }
      lastErr = 'пустой ответ (' + (d.candidates?.[0]?.finishReason || 'без причины') + ')'
    } catch (e) {
      lastErr = e.message.slice(0, 100)
    }
  }
  console.warn('Gemini не ответил:', lastErr)
  return null
}

/**
 * Достраивает схему под strict-режим OpenAI: каждому объекту нужен
 * "additionalProperties": false, иначе запрос отклоняется с 400.
 * Отдельной функцией, потому что Gemini на это поле, наоборот, ругается —
 * добавляем его только в момент отправки в OpenAI.
 */
function strictSchema(node) {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== 'object') return node

  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = strictSchema(v)
  if (out.type === 'object') out.additionalProperties = false
  return out
}

/**
 * Запрос к OpenAI. Лимит токенов держим большим: reasoning-модели
 * тратят его на рассуждения и иначе возвращают пустую строку.
 */
async function callOpenAI({ system, messages, schema, maxTokens = 2000 }) {
  const key = openaiKey()
  if (!key) return null

  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
  const body = {
    model: OPENAI_MODEL,
    messages: msgs,
    max_completion_tokens: maxTokens,
    ...(schema
      ? {
          response_format: {
            type: 'json_schema',
            // Имя строго по [a-zA-Z0-9_-]. Раньше здесь стояло русское
            // «ответ» — из-за этого КАЖДЫЙ запрос со схемой отклонялся с 400,
            // и разбор заявок на OpenAI не работал ни разу.
            json_schema: { name: 'leads_answer', schema: strictSchema(schema), strict: true },
          },
        }
      : {}),
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!r.ok) {
      console.warn('OpenAI не ответил:', r.status, (await r.text()).slice(0, 120))
      return null
    }
    const d = await r.json()
    const text = d.choices?.[0]?.message?.content?.trim()
    if (!text) {
      // Пустая строка при finish_reason: 'length' — весь бюджет съели рассуждения.
      console.warn('OpenAI вернул пустоту, finish_reason:', d.choices?.[0]?.finish_reason)
      return null
    }
    const u = d.usage ?? {}
    return {
      text,
      usage: {
        вход: u.prompt_tokens ?? 0,
        размышления: u.completion_tokens_details?.reasoning_tokens ?? 0,
        ответ: (u.completion_tokens ?? 0) - (u.completion_tokens_details?.reasoning_tokens ?? 0),
        всего: u.total_tokens ?? 0,
      },
    }
  } catch (e) {
    console.warn('OpenAI не ответил:', e.message.slice(0, 100))
    return null
  }
}

const PROVIDERS = { openai: callOpenAI, gemini: callGemini }

/**
 * Обходит провайдеров в порядке AI_ORDER и возвращает первый удавшийся ответ:
 * { text, engine, usage } или null, если не ответил никто.
 * Расход токенов пишем в лог: по нему видно, во что обходится ИИ.
 */
async function ask(opts) {
  for (const name of providerOrder()) {
    if (!hasKey[name]()) continue
    const r = await PROVIDERS[name](opts)
    if (r) {
      logUsage(name, opts.label, r.usage)
      return { text: r.text, engine: name, usage: r.usage }
    }
  }
  return null
}

function logUsage(engine, label, u) {
  if (!u) return
  console.log(
    `  [ИИ] ${engine} · ${label ?? 'запрос'}: вход ${u.вход}, размышления ${u.размышления}, ` +
      `ответ ${u.ответ}, всего ${u.всего} токенов`
  )
}

/** Достаёт JSON из ответа — модель иногда заворачивает его в ```json. */
function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/([[{][\s\S]*[\]}])/)
  if (m) {
    try {
      return JSON.parse(m[1])
    } catch {}
  }
  return null
}

/* ======================================================================
   1. АНАЛИЗАТОР ЛИДОВ
   ====================================================================== */

/* Схема ответа по стандарту JSON Schema — типы строчными.
   Раньше они были ЗАГЛАВНЫМИ (тип Gemini) с пометкой «OpenAI понимает и так».
   Не понимает: на 'STRING' он отвечает 400. Gemini же строчные принимает,
   поэтому строчные — общий знаменатель.
   additionalProperties здесь намеренно нет: Gemini на него ругается, а для
   OpenAI его дописывает strictSchema(). Все свойства перечислены в required —
   этого требует strict-режим. */
const LEAD_SCHEMA = {
  type: 'object',
  properties: {
    leads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id заявки из входных данных' },
          priority: { type: 'string', enum: ['Горячий', 'Тёплый', 'Холодный'] },
          score: { type: 'integer', description: 'Оценка 0-100' },
          summary: { type: 'string', description: 'Один короткий вывод по-русски' },
          action: { type: 'string', description: 'Конкретное действие менеджеру' },
        },
        required: ['id', 'priority', 'score', 'summary', 'action'],
      },
    },
    overview: { type: 'string', description: 'Два-три предложения по всей пачке' },
  },
  required: ['leads', 'overview'],
}

const LEAD_SYSTEM = `Ты — аналитик отдела продаж ТОО «СХМ Агро» (производство сельхозтехники в Казахстане: тракторы, комбайны, посевные комплексы).
Тебе дают список входящих заявок с сайта. Оцени каждую и скажи менеджеру, за какую браться первой.

Как оценивать:
- Заявка на КП с конкретной моделью и регионом — сильный сигнал: человек уже выбрал технику.
- Субсидируемая модель — сделка вероятнее: часть цены закрывает государство.
- Комментарий с количеством или сроком («2 шт до осени») — почти готовая сделка.
- Заказ звонка без деталей — интерес есть, но неясный.
- Свежая заявка со статусом «Новая» важнее давней или уже обработанной.

Пиши по-русски, коротко и по делу, без воды и рекламных штампов.
В action — конкретное действие («Позвонить сегодня, предложить лизинг»), а не «связаться с клиентом».

Важно: верни оценку для КАЖДОЙ присланной заявки — ровно по одному объекту на заявку, с тем же id.
Неинтересных заявок не бывает: слабую пометь «Холодный» с низким баллом, но не пропускай.
Решение, что заявка не стоит внимания, принимает менеджер, а не ты.`

/**
 * Оценка одной заявки по правилам.
 * Нужна в двух местах: когда ИИ недоступен целиком и когда он вернул
 * не все заявки (см. analyzeLeads) — тогда ею закрываем пропуск.
 */
function ruleVerdict(r, modelsById) {
  let score = 30
  const why = []

  if (r.type === 'КП') {
    score += 25
    why.push('запрос КП')
  }
  const model = Object.values(modelsById).find((m) => r.meta?.includes(m.name))
  if (model) {
    score += 20
    why.push('выбрана модель')
    if (model.subsidized) {
      score += 10
      why.push('модель субсидируется')
    }
  }
  if (r.comment?.trim()) {
    score += 10
    why.push('есть комментарий')
  }
  if (r.status === 'Новая') score += 10
  if (r.status === 'Обработана') score -= 30

  const days = Math.max(0, Math.round((Date.now() - new Date(r.date).getTime()) / 86400000))
  if (days <= 1) score += 10
  else if (days > 7) score -= 10

  score = Math.max(0, Math.min(100, score))
  const priority = score >= 70 ? 'Горячий' : score >= 45 ? 'Тёплый' : 'Холодный'

  const action =
    r.status === 'Обработана'
      ? 'Уже обработана — можно вернуться позже за повторной продажей.'
      : priority === 'Горячий'
        ? `Позвонить сегодня${model ? `, подготовить КП на «${model.name}»` : ''}${model?.subsidized ? ' и посчитать субсидию' : ''}.`
        : priority === 'Тёплый'
          ? 'Позвонить в течение двух дней, уточнить площадь и сроки.'
          : 'Отправить каталог, поставить напоминание на неделю.'

  return {
    id: r.id,
    priority,
    score,
    summary: why.length ? `${r.type}: ${why.join(', ')}.` : `${r.type} без деталей.`,
    action,
  }
}

/**
 * Правила на случай, когда ИИ недоступен. Формат ответа тот же,
 * поэтому админка одинаково работает и с ИИ, и без него.
 */
function fallbackAnalyze(requests, modelsById) {
  const leads = requests.map((r) => ruleVerdict(r, modelsById))

  const hot = leads.filter((l) => l.priority === 'Горячий').length
  return {
    leads: leads.sort((a, b) => b.score - a.score),
    overview:
      `Разобрано заявок: ${leads.length}, из них горячих — ${hot}. ` +
      'Оценка сделана по правилам (тип заявки, выбранная модель, субсидия, свежесть).',
    engine: 'rules',
  }
}

/**
 * Сколько заявок отдаём ИИ за раз. Ограничение не ради экономии, а ради
 * работоспособности: на 50 заявках ответ упирался в лимит токенов, JSON
 * обрывался и разбор молча откатывался на правила. Что не влезло —
 * честно пишем в overview, а не прячем.
 */
const LEADS_PER_RUN = 30

/* Сколько живёт оценка заявки. Отпечаток и так меняется вместе с заявкой,
   так что срок нужен для другого: «свежесть» — один из критериев оценки, и
   вчерашний «Горячий» сегодня уже не обязательно горячий. */
const LEAD_TTL = 24 * 60 * 60 * 1000

/**
 * Отпечаток заявки. Включает ВСЁ, от чего зависит оценка: поменяется
 * комментарий, статус или дата — отпечаток другой, и заявка уйдёт в ИИ
 * заново. Не включай сюда ничего лишнего: любое лишнее поле обнуляет кэш
 * при каждой правке.
 */
const leadFingerprint = (r) =>
  createHash('sha1')
    .update(JSON.stringify([r.id, r.date, r.type, r.meta, r.comment, r.status]))
    .digest('hex')
    .slice(0, 16)

/** Анализирует заявки: ИИ, если доступен, иначе правила. */
export async function analyzeLeads() {
  const all = store.requests.all()
  const modelsById = Object.fromEntries(
    store.models.all({ includeUnpublished: true }).map((m) => [m.id, m])
  )

  if (!all.length) {
    return { leads: [], overview: 'Заявок пока нет.', engine: aiEngine() }
  }
  if (!aiEnabled()) {
    const r = fallbackAnalyze(all, modelsById)
    store.requests.setAiVerdicts(r.leads)
    return r
  }

  // Сначала те, с которыми ещё работать: обработанные менеджеру не нужны.
  const actionable = all.filter((r) => r.status !== 'Обработана')
  const queue = (actionable.length ? actionable : all).slice(0, LEADS_PER_RUN)
  const skipped = (actionable.length ? actionable : all).length - queue.length

  // Заявки, оценённые раньше и с тех пор не изменившиеся, второй раз не
  // отправляем: это и есть основная экономия.
  const готовые = []
  const новые = []
  for (const r of queue) {
    const v = store.aiCache.get('lead:' + leadFingerprint(r))
    if (v) готовые.push({ ...v, id: r.id })
    else новые.push(r)
  }

  const хвост = (o) =>
    skipped > 0
      ? `${o} Показаны ${queue.length} заявок из ${queue.length + skipped}: остальные разберутся при следующем запуске.`
      : o

  // Ничего нового — ИИ не зовём вовсе, ни одного токена.
  if (!новые.length) {
    const обзор = store.aiCache.get('lead-overview:' + отпечатокПачки(queue))
    const leads = готовые.sort((a, b) => b.score - a.score)
    store.requests.setAiVerdicts(leads)
    return {
      leads,
      overview: хвост(обзор || сводкаПоОценкам(готовые)),
      engine: 'кэш',
      fromCache: готовые.length,
      analyzed: 0,
    }
  }

  const catalog = Object.values(modelsById)
    .map((m) => `- ${m.name} (${m.catName}${m.subsidized ? ', субсидируется' : ''})`)
    .join('\n')

  /* ФИО и телефон сюда сознательно не попадают. Раньше клалось ФИО клиента —
     то есть имена людей уезжали на сторонний сервис (OpenAI/Google) без
     всякой на то нужды: чтобы расставить приоритеты, модели нужны тип
     заявки, техника, регион, комментарий, статус и дата, а не имя. Телефон
     не отправлялся и раньше. Имя менеджер видит у себя в админке — оно
     берётся из своей базы по id, а не из ответа ИИ.

     Это не значит, что персональных данных здесь не бывает вовсе: `comment` —
     свободный текст с формы (КП-заявка, обратная связь на «Контактах»), и
     посетитель может вписать туда что угодно, включая своё имя или номер.
     Так и должно быть раскрыто в политике конфиденциальности — задача не
     скрыть комментарий от ИИ, а не выдавать туда то, что можно не отправлять
     (ФИО, телефон). */
  const payload = новые.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    meta: r.meta,
    comment: r.comment,
    status: r.status,
  }))

  // Уже оценённые отдаём сжато — только вердикт, без сырых полей. Это ~25
  // токенов против ~95, но общий вывод всё равно получается по всей пачке.
  const ужеОценены = готовые.length
    ? 'Эти заявки оценены ранее, переоценивать их не нужно — учти только в общем выводе:\n' +
      готовые.map((l) => `- ${l.id}: ${l.priority}, ${l.score} — ${l.summary}`).join('\n') +
      '\n\n'
    : ''

  // Бюджет ответа считаем от числа заявок: замерено ~95 токенов на заявку
  // плюс до ~1000 на размышления. Фиксированные 4000 обрывали разбор.
  const maxTokens = Math.min(16000, 1500 + новые.length * 130)

  const res = await ask({
    label: `разбор ${новые.length} заявок (из кэша ${готовые.length})`,
    system: LEAD_SYSTEM,
    schema: LEAD_SCHEMA,
    maxTokens,
    think: true, // на разборе заявок размышления окупаются
    messages: [
      {
        role: 'user',
        content:
          `Сегодня ${new Date().toISOString().slice(0, 10)}.\n\n` +
          `Каталог техники:\n${catalog}\n\n` +
          ужеОценены +
          `Новые заявки (${новые.length} шт., JSON):\n${JSON.stringify(payload, null, 2)}\n\n` +
          `Верни JSON по схеме: в leads ровно ${новые.length} объектов — по одному на каждую ` +
          `новую заявку (id: ${новые.map((r) => r.id).join(', ')}), ни одной не пропуская. ` +
          'В overview — вывод по всей пачке.',
      },
    ],
  })

  const parsed = res && parseJson(res.text)
  if (!parsed?.leads?.length) {
    const r = fallbackAnalyze(all, modelsById)
    r.overview = 'ИИ сейчас недоступен, оценка по правилам. ' + r.overview
    store.requests.setAiVerdicts(r.leads)
    return r
  }

  // Берём только вердикты по реально отправленным заявкам: модель иногда
  // возвращает лишний id, и он затёр бы чужую оценку в кэше.
  const поId = new Map(новые.map((r) => [r.id, r]))
  const свежие = parsed.leads.filter((l) => поId.has(l.id))
  for (const l of свежие) {
    store.aiCache.set('lead:' + leadFingerprint(поId.get(l.id)), l, LEAD_TTL)
  }

  // Модель может молча пропустить заявку — gpt-5-mini, например, опустил
  // «звонок без деталей», решив, что он неинтересен. Решать это не ей:
  // пропущенную заявку менеджер просто никогда не увидит. Закрываем такие
  // оценкой по правилам и помечаем, что это не вывод ИИ.
  const оценённые = new Set(свежие.map((l) => l.id))
  const пропущенные = новые
    .filter((r) => !оценённые.has(r.id))
    .map((r) => ({ ...ruleVerdict(r, modelsById), byRules: true }))
  if (пропущенные.length) {
    console.warn(
      `  [ИИ] модель пропустила заявок: ${пропущенные.length} ` +
        `(${пропущенные.map((l) => l.id).join(', ')}) — оценены по правилам`
    )
  }

  const leads = [...готовые, ...свежие, ...пропущенные].sort((a, b) => b.score - a.score)
  const overview = parsed.overview ?? сводкаПоОценкам(leads)
  store.aiCache.set('lead-overview:' + отпечатокПачки(queue), overview, LEAD_TTL)
  store.requests.setAiVerdicts(leads)

  return {
    leads,
    overview: хвост(overview),
    engine: res.engine,
    fromCache: готовые.length,
    analyzed: свежие.length,
  }
}

/** Отпечаток всей пачки — по нему кэшируется общий вывод. */
const отпечатокПачки = (queue) =>
  createHash('sha1')
    .update(queue.map(leadFingerprint).sort().join('|'))
    .digest('hex')
    .slice(0, 16)

/** Запасной общий вывод, когда всё взято из кэша, а сохранённого нет. */
function сводкаПоОценкам(leads) {
  const hot = leads.filter((l) => l.priority === 'Горячий').length
  const top = [...leads].sort((a, b) => b.score - a.score)[0]
  return (
    `Заявок в работе: ${leads.length}, горячих — ${hot}.` +
    (top ? ` Начать стоит с ${top.id}: ${top.summary}` : '')
  )
}

/* ======================================================================
   2. ЧАТ-АССИСТЕНТ НА ГЛАВНОЙ
   ====================================================================== */

/* Язык ответа задаёт интерфейс (переключатель Рус/Қаз/Eng), а не то, на
   каком языке написан вопрос: посетитель мог переключить язык сайта и
   писать по привычке смесью языков — ответ всё равно должен быть на
   выбранном языке сайта, это ожидаемое поведение, а не догадка. */
const LANG_NAME = { ru: 'русском', kk: 'казахском', en: 'английском' }

const chatSystem = (lang) => `Ты — консультант на сайте ТОО «СХМ Агро»: производство, продажа и сервис сельхозтехники в Казахстане.

Правила:
- Отвечай на ${LANG_NAME[lang] || 'русском'} языке, коротко: два-три предложения, без списков, если не просят.
- Опирайся только на данные о компании ниже. Не выдумывай модели, цены и сроки.
- Цен на сайте нет. Если спрашивают цену — предложи оставить заявку на КП, менеджер посчитает.
- Ничего не гарантируй и не обещай: ни точный срок поставки, ни точную сумму
  субсидии, ни одобрение лизинга, ни итоговую цену, ни исход спорной ситуации.
  Это решает менеджер по конкретной заявке — не бери на себя чужие обещания.
- Если ответа нет в данных ниже, вопрос спорный, юридический, конфликтный
  (жалоба, гарантийный спор, задержка) или ты просто не уверен — не угадывай
  и не сочиняй правдоподобное. Прямо скажи, что здесь точнее ответит
  менеджер, и предложи позвонить по телефону компании (он есть в данных
  ниже) или написать через раздел «Контакты» на сайте.
- Ты помощник, а не продавец: не дави и не уговаривай.
- Не спрашивай персональные данные: ни телефон, ни ФИО, ни адрес, ни оплату.
  Переписка уходит на сторонний ИИ-сервис, поэтому её не место для таких
  данных. Нужно оставить контакты — отправь человека к форме заявки или
  дай телефон компании.
- Если человек всё же прислал свои данные — не повторяй их в ответе.`

/**
 * Ответы без ИИ: узнаём тему по ключевым словам (в т.ч. на всех трёх
 * языках сайта — иначе вопрос на казахском без единого русского слова
 * никогда бы не совпал) и отвечаем из данных сайта на языке интерфейса.
 * Всё, что не опознано, — не догадка, а честный уход в сторону: список тем
 * и телефон компании, без попытки сочинить ответ.
 */
function fallbackChat(message, lang = 'ru') {
  const q = (message || '').toLowerCase()
  const s = store.settings.publicAll()
  const has = (...w) => w.some((x) => q.includes(x))
  const L = (ru, kk, en) => (lang === 'kk' ? kk : lang === 'en' ? en : ru)

  if (has('привет', 'здравств', 'добрый', 'салам', 'сәлем', 'сәлеметсіз', 'қайырлы', 'hi', 'hello')) {
    return L(
      'Здравствуйте! Подскажу по технике, лизингу, субсидиям и сервису. Что интересует?',
      'Сәлеметсіз бе! Техника, лизинг, субсидиялар және сервис бойынша кеңес беремін. Немен қызығасыз?',
      'Hello! I can help with machinery, leasing, subsidies and service. What would you like to know?'
    )
  }
  /* Условные и спорные формулировки — «а если сломается через год, почините
     бесплатно?», «обязаны ли вы» — проверяем ДО тематических веток. Иначе
     слово «трактор» в таком вопросе утаскивает его в обычный список
     тракторов, и посетитель получает уверенный ответ не на тот вопрос. Это
     не тема, а форма вопроса — она должна перебивать совпадение по теме. */
  if (
    has(
      'а если',
      'что если',
      'обязаны ли',
      'должны ли',
      'гарантируете ли',
      'а вдруг',
      'бесплатно почин',
      'бесплатно отремонт',
      'ал егер',
      'егер де',
      'міндетті ме',
      'кепілдік бересіз бе',
      'тегін жөндейсіздер ме',
      'what if',
      'will you cover',
      'are you obligated',
      'do you guarantee',
      'for free if'
    )
  ) {
    return L(
      `Такие вопросы точнее решит менеджер по конкретной ситуации — не хочу гадать и обещать лишнего. Позвоните: ${s.phone}, или напишите через раздел «Контакты».`,
      `Мұндай сұрақты менеджер нақты жағдайға қарай дәлірек шешеді — болжап, артық уәде бергім келмейді. Қоңырау шалыңыз: ${s.phone}, немесе «Байланыс» бөлімі арқылы жазыңыз.`,
      `A question like this is best answered by our manager based on the specific situation — I don't want to guess or over-promise. Call us: ${s.phone}, or write via the Contacts section.`
    )
  }
  if (has('цена', 'стоим', 'сколько стоит', 'прайс', 'баға', 'құны', 'қанша тұрады', 'price', 'cost', 'how much')) {
    return L(
      'Цены зависят от комплектации, поэтому на сайте их нет. Оставьте заявку на КП — менеджер посчитает под ваше хозяйство и учтёт субсидию, если она есть.',
      'Баға жинақталуына байланысты, сондықтан сайтта көрсетілмейді. Коммерциялық ұсынысқа өтінім қалдырыңыз — менеджер шаруашылығыңызға есептеп, субсидияны да ескереді.',
      "Prices depend on configuration, so we don't list them on the site. Request a quote and our manager will calculate it for your farm, including any subsidy."
    )
  }
  if (has('субсид', 'госагро', 'qoldau', 'мемлекеттік қолдау', 'subsid')) {
    const subs = store.models.all().filter((m) => m.subsidized)
    const names = subs.map((m) => m.name).join(', ')
    return L(
      `Часть техники входит в перечень господдержки: ${names}. Актуальный список и условия — на портале ГосАгро (${s.subsidy_url}). Поможем с документами.`,
      `Техниканың бір бөлігі мемлекеттік қолдау тізбесіне кіреді: ${names}. Өзекті тізім мен шарттар — ГосАгро порталында (${s.subsidy_url}). Құжаттармен көмектесеміз.`,
      `Some of our machinery qualifies for state support: ${names}. Check the current list and terms on the GosAgro portal (${s.subsidy_url}). We'll help with the paperwork.`
    )
  }
  if (has('лизинг', 'рассроч', 'казагро', 'кредит', 'несие', 'бөліп төлеу', 'leasing', 'installment')) {
    return L(
      `Работаем через КазАгроФинанс: льготная ставка и понятный график платежей (${s.leasing_url}). Платёж считаем заранее, до сделки.`,
      `ҚазАгроҚаржы арқылы жұмыс істейміз: жеңілдікті мөлшерлеме және түсінікті төлем кестесі (${s.leasing_url}). Төлемді мәмілеге дейін алдын ала есептейміз.`,
      `We work through KazAgroFinance: a subsidized rate and a clear payment schedule (${s.leasing_url}). The payment is calculated before the deal.`
    )
  }
  if (has('трактор', 'tractor')) {
    const list = store.models.all({ cat: 'traktory' }).map((m) => m.name)
    return L(
      `Есть ${list.join(' и ')}. Характеристики — в каталоге. Подскажите площадь и задачи, поможем выбрать.`,
      `${list.join(' және ')} бар. Сипаттамалары — каталогта. Алаңыңыз бен міндеттеріңізді айтыңыз, таңдауға көмектесеміз.`,
      `We have ${list.join(' and ')}. Specs are in the catalog. Tell us your acreage and tasks and we'll help you choose.`
    )
  }
  if (has('комбайн', 'уборк', 'жинау', 'combine', 'harvest')) {
    const list = store.models.all({ cat: 'kombayny' }).map((m) => m.name).join(', ')
    return L(
      `${list} — для уборки зерновых, зернобобовых и масличных. Характеристики есть в каталоге.`,
      `${list} — дәнді, дәнді-бұршақты және майлы дақылдарды жинауға арналған. Сипаттамалары каталогта бар.`,
      `${list} — for harvesting grain, legumes and oilseed crops. Specs are in the catalog.`
    )
  }
  if (has('сеялк', 'посев', 'себу', 'тұқым себу', 'seed', 'sowing', 'planter')) {
    const list = store.models.all({ cat: 'posev' }).map((m) => m.name).join(', ')
    return L(
      `По посеву: ${list}. Подберём под ширину захвата и мощность вашего трактора.`,
      `Себу техникасы: ${list}. Қамту енін және трактордың қуатын ескеріп таңдаймыз.`,
      `For seeding: ${list}. We'll match it to your working width and tractor power.`
    )
  }
  if (has('гарант', 'кепілдік', 'warrant')) {
    return L(
      'Гарантия 2 года или 2 000 моточасов — что наступит раньше. При запуске бесплатно обучаем механизатора.',
      'Кепілдік — 2 жыл немесе 2 000 мотосағат, қайсысы бұрын келсе. Іске қосу кезінде механизаторды тегін оқытамыз.',
      'Warranty is 2 years or 2,000 engine hours, whichever comes first. We train the operator for free at commissioning.'
    )
  }
  if (has('сервис', 'ремонт', 'запчаст', 'ломал', 'жөндеу', 'қосалқы бөлшек', 'бұзыл', 'service', 'repair', 'parts', 'broke')) {
    return L(
      'Сервисная бригада выезжает прямо в хозяйство, у нас 34 центра по стране. Ходовые запчасти держим на складе и отгружаем в день обращения.',
      'Сервис бригадасы тікелей шаруашылыққа шығады, елімізде 34 орталық бар. Жүріс қосалқы бөлшектерін қоймада ұстап, өтінім түскен күні жөнелтеміз.',
      'Our service crew comes straight to your farm — we have 34 centers nationwide. High-demand parts are kept in stock and ship the same day.'
    )
  }
  if (has('контакт', 'телефон', 'адрес', 'позвон', 'где вы', 'почта', 'байланыс', 'мекенжай', 'қоңырау', 'қайдасыздар', 'contact', 'phone', 'address', 'email', 'where are you')) {
    return L(
      `Телефон ${s.phone}, почта ${s.email}. Адрес: ${s.address}. Часы работы: ${s.hours}.`,
      `Телефон ${s.phone}, пошта ${s.email}. Мекенжай: ${s.address}. Жұмыс уақыты: ${s.hours}.`,
      `Phone: ${s.phone}, email: ${s.email}. Address: ${s.address}. Hours: ${s.hours}.`
    )
  }
  if (has('доставк', 'привез', 'срок', 'жеткізу', 'әкел', 'мерзім', 'delivery', 'deliver')) {
    return L(
      'Доставляем в хозяйство, запускаем и обучаем механизатора. Точный срок зависит от модели — уточнит менеджер по заявке.',
      'Шаруашылыққа жеткіземіз, іске қосамыз және механизаторды оқытамыз. Нақты мерзімі үлгіге байланысты — менеджер өтінім бойынша нақтылайды.',
      'We deliver to your farm, commission the machine and train the operator. Exact timing depends on the model — the manager will confirm it for your request.'
    )
  }
  if (has('катал', 'техник', 'что есть', 'модел', 'каталог', 'не бар', 'үлгі', 'catalog', 'machinery', 'what do you have', 'models')) {
    const n = store.models.all().length
    return L(
      `В каталоге ${n} моделей: тракторы, комбайны, посевная и почвообрабатывающая техника. Скажите, под какие задачи — подскажу точнее.`,
      `Каталогта ${n} үлгі бар: тракторлар, комбайндар, себу және топырақ өңдеу техникасы. Қандай міндеттерге қажет екенін айтыңыз — нақтырақ айтамын.`,
      `The catalog has ${n} models: tractors, combines, seeding and tillage equipment. Tell me what you need it for and I'll narrow it down.`
    )
  }
  // Тема не опознана — не гадаем, а честно разводим руками и даём телефон.
  return L(
    `Не уверен, что понял вопрос. Спросите про каталог, лизинг, субсидии, гарантию или сервис — либо позвоните: ${s.phone}.`,
    `Сұрағыңызды түсінбедім. Каталог, лизинг, субсидиялар, кепілдік немесе сервис туралы сұраңыз — немесе қоңырау шалыңыз: ${s.phone}.`,
    `I'm not sure I understood. Ask about the catalog, leasing, subsidies, warranty or service — or call us: ${s.phone}.`
  )
}

/** Собирает контекст компании из тех же данных, что показывает сайт. */
function companyContext() {
  const s = store.settings.publicAll()
  const catalog = store.models
    .all()
    .map(
      (m) =>
        `- ${m.name} (${m.catName})${m.subsidized ? ' — субсидируется' : ''}: ${m.short}` +
        (m.specs?.length
          ? ` [${m.specs.slice(0, 3).map((x) => `${x.k}: ${x.v}`).join('; ')}]`
          : '')
    )
    .join('\n')
  const svc = store.services.all().map((x) => `- ${x.title}: ${x.text}`).join('\n')

  return `ДАННЫЕ О КОМПАНИИ
Телефон: ${s.phone}. E-mail: ${s.email}. Адрес: ${s.address}. Часы: ${s.hours}.
Лизинг — КазАгроФинанс: ${s.leasing_url}. Субсидии — ГосАгро: ${s.subsidy_url}.

КАТАЛОГ
${catalog}

УСЛУГИ
${svc}`
}

/* Сколько живёт ответ чата. Ключ и так завязан на содержимое сайта, так что
   срок — просто страховка от залежавшихся формулировок. */
const CHAT_TTL = 24 * 60 * 60 * 1000

/**
 * Ключ кэша ответа чата.
 *
 * Кэшируем ТОЛЬКО первый вопрос в диалоге: дальше ответ зависит от всей
 * переписки, и одинаковая последняя реплика в разных разговорах означает
 * разное. Возвращает null, когда кэшировать нельзя.
 *
 * В ключ входит отпечаток данных о компании: поправили каталог или телефон
 * в админке — старые ответы перестают подходить сами собой.
 */
function chatCacheKey(message, history, context, lang) {
  if (history.length) return null
  const текст = String(message).trim().toLowerCase().replace(/\s+/g, ' ')
  if (!текст) return null
  const данные = createHash('sha1').update(context).digest('hex').slice(0, 8)
  const вопрос = createHash('sha1').update(текст).digest('hex').slice(0, 16)
  // Язык — часть ключа: один и тот же вопрос на разных языках сайта
  // не должен получать ответ, закэшированный для другого языка.
  return `chat:${lang}:${данные}:${вопрос}`
}

/**
 * Отвечает на сообщение чата.
 * history — массив { role: 'user' | 'assistant', text } предыдущих реплик.
 * lang — язык интерфейса посетителя ('ru' | 'kk' | 'en'), на нём и отвечаем.
 */
export async function chat(message, history = [], { rulesOnly = false, lang = 'ru' } = {}) {
  if (rulesOnly || !aiEnabled()) return { reply: fallbackChat(message, lang), engine: 'rules' }

  const context = companyContext()
  const key = chatCacheKey(message, history, context, lang)
  if (key) {
    const готовый = store.aiCache.get(key)
    if (готовый) return { reply: готовый, engine: 'кэш' }
  }

  const messages = [
    ...history
      .filter((h) => h?.text)
      .slice(-8) // хвоста диалога достаточно, всю историю не тащим
      .map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: String(h.text).slice(0, 2000),
      })),
    { role: 'user', content: String(message).slice(0, 2000) },
  ]

  const res = await ask({
    label: `чат (реплик в истории: ${messages.length}, язык: ${lang})`,
    system: chatSystem(lang) + '\n\n' + context,
    // Чат должен отвечать быстро: у Gemini размышления выключены,
    // у OpenAI запас токенов побольше — иначе reasoning съест ответ.
    maxTokens: 1500,
    think: false,
    messages,
  })

  if (!res) return { reply: fallbackChat(message, lang), engine: 'rules' }
  if (key) store.aiCache.set(key, res.text, CHAT_TTL)
  return { reply: res.text, engine: res.engine }
}

/* ======================================================================
   3. AI-ИМПОРТ КАТАЛОГА ИЗ ДОКУМЕНТОВ
   ====================================================================== */

const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Название модели техники' },
          catId: {
            type: 'string',
            description: 'id категории из присланного списка, ближайшая по смыслу; пустая строка, если ни одна не подходит',
          },
          short: { type: 'string', description: 'Одно-два предложения о модели' },
          specs: {
            type: 'array',
            description: 'Найденные характеристики: ключ — по возможности из шаблона категории, значение — с единицами измерения как в тексте',
            items: {
              type: 'object',
              properties: {
                k: { type: 'string' },
                v: { type: 'string' },
              },
              required: ['k', 'v'],
            },
          },
          subsidized: { type: 'boolean', description: 'true только если в тексте явно упомянута субсидия/господдержка' },
          confidence: { type: 'integer', description: 'Уверенность 0-100: ниже, если категория или характеристики — скорее догадка' },
          note: { type: 'string', description: 'Коротко, что именно неточно или откуда взято название; пусто, если всё ясно' },
        },
        required: ['name', 'catId', 'short', 'specs', 'subsidized', 'confidence', 'note'],
      },
    },
    overview: { type: 'string', description: 'Два-три предложения: что за документ и что удалось найти' },
  },
  required: ['items', 'overview'],
}

const IMPORT_SYSTEM = `Ты помогаешь наполнить каталог сайта ТОО «СХМ Агро» (производство и продажа сельхозтехники в Казахстане) из присланного документа — обычно это прайс-лист или техническая спецификация от завода.

Тебе дают: список категорий каталога (id, название, шаблон характеристик) и сырой текст, извлечённый из файла (таблица могла превратиться в текст со табуляцией — это нормально).

Задача: найди в тексте КАЖДУЮ отдельную модель техники и опиши её по схеме.
- catId бери из присланного списка категорий, максимально близко по смыслу (трактор → категория тракторов и т.д.). Если техника явно не сельскохозяйственная или категория непонятна — оставь catId пустым.
- specs заполняй тем, что реально нашлось в тексте: ключи бери из шаблона характеристик категории, когда значение им соответствует, но не выдумывай значения, которых в тексте нет. Характеристики вне шаблона тоже включай — лучше больше данных, чем меньше.
- confidence — честная самооценка: 80-100, если модель и цифры прямо читаются из текста; 40-79, если часть данных пришлось додумывать по контексту; ниже 40, если запись почти наверняка ошибочная или неполная.
- note — только если confidence не максимальный: одна короткая фраза, что именно под вопросом.
- Не пропускай модели с неполными данными — верни их с низким confidence, решать, включать ли, будет человек.
- Если в тексте вообще нет техники (например, это счёт-фактура или письмо не по теме) — верни пустой items и объясни это в overview.

Пиши по-русски, без рекламных штампов.`

/**
 * Раскладывает сырой текст документа на черновики моделей каталога.
 * Не кэшируется и не имеет запасного пути без ИИ — в отличие от анализа
 * лидов, здесь нет осмысленного алгоритма «по правилам» для произвольного
 * прайс-листа, поэтому при недоступном ИИ честно возвращаем пустой список.
 */
export async function importCatalog(text) {
  if (!aiEnabled()) {
    return {
      items: [],
      overview: 'ИИ сейчас недоступен — импорт из документов требует подключённого ИИ-провайдера.',
      engine: 'rules',
    }
  }

  const categories = store.categories.all()
  const catList = categories
    .map((c) => `- ${c.id}: ${c.name} (шаблон: ${(c.specTemplate || []).join(', ') || '—'})`)
    .join('\n')

  const res = await ask({
    label: `импорт каталога (${text.length} симв. текста)`,
    system: IMPORT_SYSTEM,
    schema: IMPORT_SCHEMA,
    maxTokens: 12000,
    think: true,
    messages: [
      {
        role: 'user',
        content:
          `Категории каталога:\n${catList}\n\n` +
          `Текст документа:\n${text}\n\n` +
          'Верни JSON по схеме: items — по одной записи на каждую найденную модель техники, overview — краткий общий вывод.',
      },
    ],
  })

  const parsed = res && parseJson(res.text)
  if (!parsed?.items) {
    return { items: [], overview: 'ИИ не смог разобрать документ. Попробуйте другой файл или формат.', engine: res?.engine || 'ошибка' }
  }

  const catIds = new Set(categories.map((c) => c.id))
  const items = parsed.items.map((it) => ({
    name: String(it.name || '').slice(0, 200),
    catId: catIds.has(it.catId) ? it.catId : '',
    short: String(it.short || '').slice(0, 400),
    specs: Array.isArray(it.specs)
      ? it.specs.slice(0, 60).map((s) => ({ k: String(s.k || '').slice(0, 120), v: String(s.v || '').slice(0, 240) }))
      : [],
    subsidized: !!it.subsidized,
    confidence: Math.max(0, Math.min(100, Math.round(it.confidence ?? 0))),
    note: String(it.note || '').slice(0, 300),
  }))

  return { items, overview: String(parsed.overview || ''), engine: res.engine }
}

/* ======================================================================
   4. AI-ОПИСАНИЕ МОДЕЛИ (задача 8)
   ====================================================================== */

const DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    short: { type: 'string', description: 'Одно предложение для карточки в каталоге, до 200 символов' },
    descr: { type: 'string', description: 'Два-четыре предложения для страницы модели' },
  },
  required: ['short', 'descr'],
}

const DESCRIPTION_SYSTEM = `Ты пишешь тексты для каталога сайта ТОО «СХМ Агро» (производство и продажа сельхозтехники в Казахстане).

По названию модели, категории и списку характеристик составь два текста:
- short — одно ёмкое предложение для карточки в каталоге (что это за техника и для чего), без характеристик и цифр из списка внутри самого предложения, если это не ключевая цифра (например, мощность или ширина захвата).
- descr — два-четыре предложения для страницы модели: назначение, для какого хозяйства подходит, что выделяет её среди аналогов. Характеристики из списка не перечисляй построчно — они и так показаны в таблице рядом, повторять их текстом незачем.

Пиши по-русски, по-деловому, без рекламных превосходных степеней («лучший», «уникальный») и без выдуманных фактов, которых нет в присланных данных.`

/** Составляет короткое и полное описание модели по названию, категории и
    характеристикам — кнопка в форме модели в админке. Тот же провайдер и
    бюджет, что у остальных ИИ-функций сайта. */
export async function generateModelDescription({ name, catName, specs, subsidized }) {
  if (!aiEnabled()) {
    return { short: '', descr: '', engine: 'rules', error: 'ИИ сейчас недоступен' }
  }

  const specsText = (specs || [])
    .filter((s) => s.k && s.v)
    .map((s) => `- ${s.k}: ${s.v}`)
    .join('\n')

  const res = await ask({
    label: `описание модели «${name}»`,
    system: DESCRIPTION_SYSTEM,
    schema: DESCRIPTION_SCHEMA,
    maxTokens: 2000,
    think: false,
    messages: [
      {
        role: 'user',
        content:
          `Модель: ${name}\nКатегория: ${catName || '—'}\nСубсидируется: ${subsidized ? 'да' : 'нет'}\n\n` +
          `Характеристики:\n${specsText || '(не указаны)'}\n\n` +
          'Верни JSON по схеме.',
      },
    ],
  })

  const parsed = res && parseJson(res.text)
  if (!parsed?.short && !parsed?.descr) {
    return { short: '', descr: '', engine: res?.engine || 'ошибка', error: 'Не удалось составить описание' }
  }

  return {
    short: String(parsed.short || '').slice(0, 400),
    descr: String(parsed.descr || '').slice(0, 8000),
    engine: res.engine,
  }
}
