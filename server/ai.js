/**
 * ИИ-функции сайта: анализатор лидов для админки и чат-ассистент на главной.
 *
 * ─── ПРОВАЙДЕРЫ ────────────────────────────────────────────────────────
 * Порядок такой: Gemini → OpenAI → правила.
 *   1. Gemini (основной). Ключей может быть до трёх: GEMINI_API_KEY,
 *      GEMINI_API_KEY_2, GEMINI_API_KEY_3. Если ключ упёрся в лимит (429),
 *      берём следующий — поэтому их и несколько.
 *   2. OpenAI (резерв). Включается, когда Gemini не ответил.
 *   3. Правила. Работают всегда, даже без ключей: сайт остаётся живым.
 *
 * Внешних библиотек нет — только fetch, он есть в Node 22 из коробки.
 *
 * ─── ОСОБЕННОСТЬ gpt-5-mini ────────────────────────────────────────────
 * Это reasoning-модель: часть бюджета уходит на внутренние рассуждения.
 * При max_completion_tokens=20 ответ приходит ПУСТОЙ (finish_reason:
 * 'length') — токены кончились на размышлениях. Поэтому лимиты здесь
 * заведомо щедрые, иначе получим пустоту вместо текста.
 */
import * as store from './store.js'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini'

const geminiKeys = () =>
  [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(
    Boolean
  )

const openaiKey = () => process.env.OPENAI_API_KEY || ''

/** Включён ли ИИ вообще. */
export const aiEnabled = () => geminiKeys().length > 0 || !!openaiKey()

/** Какой провайдер сейчас главный — показываем это в интерфейсе честно. */
export function aiEngine() {
  if (geminiKeys().length) return 'gemini'
  if (openaiKey()) return 'openai'
  return 'rules'
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
      if (text) return text
      lastErr = 'пустой ответ (' + (d.candidates?.[0]?.finishReason || 'без причины') + ')'
    } catch (e) {
      lastErr = e.message.slice(0, 100)
    }
  }
  console.warn('Gemini не ответил:', lastErr)
  return null
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
            json_schema: { name: 'ответ', schema, strict: true },
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
    return text
  } catch (e) {
    console.warn('OpenAI не ответил:', e.message.slice(0, 100))
    return null
  }
}

/** Сначала Gemini, если не вышло — OpenAI. Возвращает {text, engine} или null. */
async function ask(opts) {
  const g = await callGemini(opts)
  if (g) return { text: g, engine: 'gemini' }
  const o = await callOpenAI(opts)
  if (o) return { text: o, engine: 'openai' }
  return null
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

/* Схема ответа. Типы заглавными — так их ждёт Gemini; OpenAI понимает и так. */
const LEAD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    leads: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'id заявки из входных данных' },
          priority: { type: 'STRING', enum: ['Горячий', 'Тёплый', 'Холодный'] },
          score: { type: 'INTEGER', description: 'Оценка 0-100' },
          summary: { type: 'STRING', description: 'Один короткий вывод по-русски' },
          action: { type: 'STRING', description: 'Конкретное действие менеджеру' },
        },
        required: ['id', 'priority', 'score', 'summary', 'action'],
      },
    },
    overview: { type: 'STRING', description: 'Два-три предложения по всей пачке' },
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
В action — конкретное действие («Позвонить сегодня, предложить лизинг»), а не «связаться с клиентом».`

/**
 * Правила на случай, когда ИИ недоступен. Формат ответа тот же,
 * поэтому админка одинаково работает и с ИИ, и без него.
 */
function fallbackAnalyze(requests, modelsById) {
  const leads = requests.map((r) => {
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
  })

  const hot = leads.filter((l) => l.priority === 'Горячий').length
  return {
    leads: leads.sort((a, b) => b.score - a.score),
    overview:
      `Разобрано заявок: ${leads.length}, из них горячих — ${hot}. ` +
      'Оценка сделана по правилам (тип заявки, выбранная модель, субсидия, свежесть).',
    engine: 'rules',
  }
}

/** Анализирует заявки: ИИ, если доступен, иначе правила. */
export async function analyzeLeads() {
  const requests = store.requests.all()
  const modelsById = Object.fromEntries(
    store.models.all({ includeUnpublished: true }).map((m) => [m.id, m])
  )

  if (!requests.length) {
    return { leads: [], overview: 'Заявок пока нет.', engine: aiEngine() }
  }
  if (!aiEnabled()) return fallbackAnalyze(requests, modelsById)

  const catalog = Object.values(modelsById)
    .map((m) => `- ${m.name} (${m.catName}${m.subsidized ? ', субсидируется' : ''})`)
    .join('\n')

  const payload = requests.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    fio: r.fio,
    meta: r.meta,
    comment: r.comment,
    status: r.status,
  }))

  const res = await ask({
    system: LEAD_SYSTEM,
    schema: LEAD_SCHEMA,
    maxTokens: 4000,
    think: true, // на разборе заявок размышления окупаются
    messages: [
      {
        role: 'user',
        content:
          `Сегодня ${new Date().toISOString().slice(0, 10)}.\n\n` +
          `Каталог техники:\n${catalog}\n\n` +
          `Заявки (JSON):\n${JSON.stringify(payload, null, 2)}\n\n` +
          'Оцени каждую заявку и верни JSON по схеме.',
      },
    ],
  })

  const parsed = res && parseJson(res.text)
  if (!parsed?.leads?.length) {
    const r = fallbackAnalyze(requests, modelsById)
    r.overview = 'ИИ сейчас недоступен, оценка по правилам. ' + r.overview
    return r
  }

  return {
    leads: parsed.leads.sort((a, b) => b.score - a.score),
    overview: parsed.overview ?? '',
    engine: res.engine,
  }
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

/**
 * Отвечает на сообщение чата.
 * history — массив { role: 'user' | 'assistant', text } предыдущих реплик.
 */
export async function chat(message, history = []) {
  if (!aiEnabled()) return { reply: fallbackChat(message), engine: 'rules' }

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
    system: CHAT_SYSTEM + '\n\n' + companyContext(),
    // Чат должен отвечать быстро: у Gemini размышления выключены,
    // у OpenAI запас токенов побольше — иначе reasoning съест ответ.
    maxTokens: 1500,
    think: false,
    messages,
  })

  if (!res) return { reply: fallbackChat(message), engine: 'rules' }
  return { reply: res.text, engine: res.engine }
}
