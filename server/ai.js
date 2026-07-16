/**
 * ИИ-функции сайта: анализатор лидов для админки и чат-ассистент на главной.
 *
 * ─── КАК ЭТО РАБОТАЕТ СЕЙЧАС ───────────────────────────────────────────
 * Код обращения к Claude уже написан и включается сам, как только в .env
 * появится ANTHROPIC_API_KEY. Пока ключа нет, работают правила из
 * fallbackAnalyze / fallbackChat — сайт полностью функционален и без ИИ.
 *
 * ─── ЧТОБЫ ВКЛЮЧИТЬ ИИ ─────────────────────────────────────────────────
 *   1) npm install @anthropic-ai/sdk
 *   2) в .env добавить: ANTHROPIC_API_KEY=sk-ant-...
 *   3) перезапустить npm run dev:server
 * Больше ничего менять не нужно: эндпоинты и интерфейс те же.
 * ───────────────────────────────────────────────────────────────────────
 */
import * as store from './store.js'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

/** Клиент создаём один раз и лениво — пакета может не быть вовсе. */
let clientPromise = null

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY

async function getClient() {
  if (!aiEnabled()) return null
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then(({ default: Anthropic }) => new Anthropic())
      .catch((e) => {
        console.warn(
          '⚠ ANTHROPIC_API_KEY задан, но пакет @anthropic-ai/sdk не установлен.\n' +
            '  Выполните: npm install @anthropic-ai/sdk\n' +
            '  Пока работают правила без ИИ. (' + e.message + ')'
        )
        return null
      })
  }
  return clientPromise
}

/** Достаёт текст из ответа Claude (content — массив блоков). */
const textOf = (msg) =>
  (msg?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

/* ======================================================================
   1. АНАЛИЗАТОР ЛИДОВ
   ====================================================================== */

const LEAD_SCHEMA = {
  type: 'object',
  properties: {
    leads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id заявки из входных данных' },
          priority: {
            type: 'string',
            enum: ['Горячий', 'Тёплый', 'Холодный'],
            description: 'Насколько заявка близка к сделке',
          },
          score: { type: 'integer', description: 'Оценка от 0 до 100' },
          summary: { type: 'string', description: 'Один короткий вывод по-русски' },
          action: { type: 'string', description: 'Что менеджеру сделать дальше' },
        },
        required: ['id', 'priority', 'score', 'summary', 'action'],
        additionalProperties: false,
      },
    },
    overview: { type: 'string', description: 'Два-три предложения по всей пачке заявок' },
  },
  required: ['leads', 'overview'],
  additionalProperties: false,
}

const LEAD_SYSTEM = `Ты — аналитик отдела продаж ТОО «СХМ Агро» (производство сельхозтехники в Казахстане: тракторы, комбайны, посевные комплексы).
Тебе дают список входящих заявок с сайта. Оцени каждую и скажи менеджеру, за какую браться первой.

Как оценивать:
- Заявка на КП с конкретной моделью и регионом — сильный сигнал: человек уже выбрал технику.
- Субсидируемая модель — сделка вероятнее: часть цены закрывает государство.
- Комментарий с количеством или сроком («2 шт до осени») — почти готовая сделка.
- Заказ звонка без деталей — интерес есть, но неясный.
- Заявка «Новая» и свежая по дате — важнее давней или уже обработанной.

Пиши по-русски, коротко и по делу, без воды и маркетинговых штампов.
В action пиши конкретное действие («Позвонить сегодня, предложить лизинг»), а не «связаться с клиентом».`

/**
 * Правила на случай, когда ИИ не подключён. Считают тот же формат ответа,
 * поэтому интерфейс админки одинаково работает с ИИ и без него.
 */
function fallbackAnalyze(requests, modelsById) {
  const leads = requests.map((r) => {
    let score = 30
    const why = []

    if (r.type === 'КП') {
      score += 25
      why.push('запрос КП')
    }
    // В meta лежит «Модель · Регион» — ищем совпадение с каталогом.
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

    // Свежесть: заявка недельной давности слабее вчерашней.
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
      'Оценка сделана по правилам (тип заявки, выбранная модель, субсидия, свежесть). ' +
      'Подключите ANTHROPIC_API_KEY, чтобы анализ делал Claude и читал комментарии клиентов.',
    engine: 'rules',
  }
}

/** Анализирует заявки: Claude, если есть ключ, иначе правила. */
export async function analyzeLeads() {
  const requests = store.requests.all()
  const modelsById = Object.fromEntries(
    store.models.all({ includeUnpublished: true }).map((m) => [m.id, m])
  )

  if (requests.length === 0) {
    return { leads: [], overview: 'Заявок пока нет.', engine: aiEnabled() ? 'claude' : 'rules' }
  }

  const client = await getClient()
  if (!client) return fallbackAnalyze(requests, modelsById)

  // Каталог даём моделью, чтобы Claude знал, что субсидируется.
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

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: LEAD_SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: LEAD_SCHEMA },
      },
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

    const parsed = JSON.parse(textOf(msg))
    return {
      leads: (parsed.leads ?? []).sort((a, b) => b.score - a.score),
      overview: parsed.overview ?? '',
      engine: 'claude',
    }
  } catch (e) {
    console.error('Claude не ответил, включаю правила:', e.message)
    const res = fallbackAnalyze(requests, modelsById)
    res.overview = 'ИИ временно недоступен, оценка по правилам. ' + res.overview
    return res
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
  const has = (...words) => words.some((w) => q.includes(w))

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
    return `Есть ${list.map((m) => m.name).join(' и ')}. Открыть характеристики можно в каталоге. Подскажите площадь и задачи — поможем выбрать.`
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

/**
 * Отвечает на сообщение чата.
 * history — массив { role: 'user' | 'assistant', text } предыдущих реплик.
 */
export async function chat(message, history = []) {
  const client = await getClient()
  if (!client) return { reply: fallbackChat(message), engine: 'rules' }

  // Контекст компании собираем из тех же данных, что показывает сайт,
  // — так ассистент не разойдётся с содержимым каталога.
  const s = store.settings.publicAll()
  const catalog = store.models
    .all()
    .map(
      (m) =>
        `- ${m.name} (${m.catName})${m.subsidized ? ' — субсидируется' : ''}: ${m.short}` +
        (m.specs?.length ? ` [${m.specs.slice(0, 3).map((x) => `${x.k}: ${x.v}`).join('; ')}]` : '')
    )
    .join('\n')
  const svc = store.services.all().map((x) => `- ${x.title}: ${x.text}`).join('\n')

  const context = `ДАННЫЕ О КОМПАНИИ
Телефон: ${s.phone}. E-mail: ${s.email}. Адрес: ${s.address}. Часы: ${s.hours}.
Лизинг — КазАгроФинанс: ${s.leasing_url}. Субсидии — ГосАгро: ${s.subsidy_url}.

КАТАЛОГ
${catalog}

УСЛУГИ
${svc}`

  const messages = [
    ...history
      .filter((h) => h?.text)
      .slice(-8) // хвоста диалога хватает, не тащим всю историю
      .map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: String(h.text).slice(0, 2000),
      })),
    { role: 'user', content: String(message).slice(0, 2000) },
  ]

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      // Данные компании кэшируем: они одни и те же в каждом запросе чата.
      system: [
        { type: 'text', text: CHAT_SYSTEM },
        { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { effort: 'low' },
      messages,
    })

    if (msg.stop_reason === 'refusal') {
      return { reply: `Не смогу ответить на это. Позвоните нам: ${s.phone}.`, engine: 'claude' }
    }
    return { reply: textOf(msg) || fallbackChat(message), engine: 'claude' }
  } catch (e) {
    console.error('Claude не ответил в чате, включаю правила:', e.message)
    return { reply: fallbackChat(message), engine: 'rules' }
  }
}
