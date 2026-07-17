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
    .update(JSON.stringify([r.id, r.date, r.type, r.fio, r.meta, r.comment, r.status]))
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
  if (!aiEnabled()) return fallbackAnalyze(all, modelsById)

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
    return {
      leads: готовые.sort((a, b) => b.score - a.score),
      overview: хвост(обзор || сводкаПоОценкам(готовые)),
      engine: 'кэш',
      fromCache: готовые.length,
      analyzed: 0,
    }
  }

  const catalog = Object.values(modelsById)
    .map((m) => `- ${m.name} (${m.catName}${m.subsidized ? ', субсидируется' : ''})`)
    .join('\n')

  const payload = новые.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    fio: r.fio,
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

const CHAT_SYSTEM = `Ты — консультант на сайте ТОО «СХМ Агро»: производство, продажа и сервис сельхозтехники в Казахстане.

Правила:
- Отвечай по-русски, коротко: два-три предложения, без списков, если не просят.
- Опирайся только на данные о компании ниже. Не выдумывай модели, цены и сроки.
- Цен на сайте нет. Если спрашивают цену — предложи оставить заявку на КП, менеджер посчитает.
- Если не знаешь ответа — честно скажи и предложи позвонить или оставить заявку.
- Не обещай того, чего нет в данных.
- Ты помощник, а не продавец: не дави и не уговаривай.`

/** Ответы без ИИ: узнаём тему по ключевым словам и отвечаем из данных сайта. */
function fallbackChat(message) {
  const q = (message || '').toLowerCase()
  const s = store.settings.publicAll()
  const has = (...w) => w.some((x) => q.includes(x))

  if (has('привет', 'здравств', 'добрый', 'салам')) {
    return 'Здравствуйте! Подскажу по технике, лизингу, субсидиям и сервису. Что интересует?'
  }
  if (has('цена', 'стоим', 'сколько стоит', 'прайс')) {
    return 'Цены зависят от комплектации, поэтому на сайте их нет. Оставьте заявку на КП — менеджер посчитает под ваше хозяйство и учтёт субсидию, если она есть.'
  }
  if (has('субсид', 'госагро', 'qoldau')) {
    const subs = store.models.all().filter((m) => m.subsidized)
    return `Часть техники входит в перечень господдержки: ${subs.map((m) => m.name).join(', ')}. Актуальный список и условия — на портале ГосАгро (${s.subsidy_url}). Поможем с документами.`
  }
  if (has('лизинг', 'рассроч', 'казагро', 'кредит')) {
    return `Работаем через КазАгроФинанс: льготная ставка и понятный график платежей (${s.leasing_url}). Платёж считаем заранее, до сделки.`
  }
  if (has('трактор')) {
    const list = store.models.all({ cat: 'traktory' })
    return `Есть ${list.map((m) => m.name).join(' и ')}. Характеристики — в каталоге. Подскажите площадь и задачи, поможем выбрать.`
  }
  if (has('комбайн', 'уборк')) {
    const list = store.models.all({ cat: 'kombayny' })
    return `${list.map((m) => m.name).join(', ')} — для уборки зерновых, зернобобовых и масличных. Характеристики есть в каталоге.`
  }
  if (has('сеялк', 'посев')) {
    const list = store.models.all({ cat: 'posev' })
    return `По посеву: ${list.map((m) => m.name).join(', ')}. Подберём под ширину захвата и мощность вашего трактора.`
  }
  if (has('гарант')) {
    return 'Гарантия 2 года или 2 000 моточасов — что наступит раньше. При запуске бесплатно обучаем механизатора.'
  }
  if (has('сервис', 'ремонт', 'запчаст', 'ломал')) {
    return 'Сервисная бригада выезжает прямо в хозяйство, у нас 34 центра по стране. Ходовые запчасти держим на складе и отгружаем в день обращения.'
  }
  if (has('контакт', 'телефон', 'адрес', 'позвон', 'где вы', 'почта')) {
    return `Телефон ${s.phone}, почта ${s.email}. Адрес: ${s.address}. Часы работы: ${s.hours}.`
  }
  if (has('доставк', 'привез', 'срок')) {
    return 'Доставляем в хозяйство, запускаем и обучаем механизатора. Точный срок зависит от модели — уточнит менеджер по заявке.'
  }
  if (has('катал', 'техник', 'что есть', 'модел')) {
    const all = store.models.all()
    return `В каталоге ${all.length} моделей: тракторы, комбайны, посевная и почвообрабатывающая техника. Скажите, под какие задачи — подскажу точнее.`
  }
  return `Не уверен, что понял вопрос. Спросите про каталог, лизинг, субсидии, гарантию или сервис — либо позвоните: ${s.phone}.`
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
function chatCacheKey(message, history, context) {
  if (history.length) return null
  const текст = String(message).trim().toLowerCase().replace(/\s+/g, ' ')
  if (!текст) return null
  const данные = createHash('sha1').update(context).digest('hex').slice(0, 8)
  const вопрос = createHash('sha1').update(текст).digest('hex').slice(0, 16)
  return `chat:${данные}:${вопрос}`
}

/**
 * Отвечает на сообщение чата.
 * history — массив { role: 'user' | 'assistant', text } предыдущих реплик.
 */
export async function chat(message, history = []) {
  if (!aiEnabled()) return { reply: fallbackChat(message), engine: 'rules' }

  const context = companyContext()
  const key = chatCacheKey(message, history, context)
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
    label: `чат (реплик в истории: ${messages.length})`,
    system: CHAT_SYSTEM + '\n\n' + context,
    // Чат должен отвечать быстро: у Gemini размышления выключены,
    // у OpenAI запас токенов побольше — иначе reasoning съест ответ.
    maxTokens: 1500,
    think: false,
    messages,
  })

  if (!res) return { reply: fallbackChat(message), engine: 'rules' }
  if (key) store.aiCache.set(key, res.text, CHAT_TTL)
  return { reply: res.text, engine: res.engine }
}
