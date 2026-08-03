/**
 * Серверная подстановка SEO-метаданных в index.html.
 *
 * Зачем: сайт — SPA, и без этого модуля поисковый робот на ЛЮБОМ адресе
 * получал один и тот же index.html с общим заголовком. Google исполняет JS
 * и в итоге видит title от usePageMeta, но со второй волны и с задержкой;
 * Яндекс и превью мессенджеров (WhatsApp/Telegram) JS почти не исполняют —
 * для них карточка трактора и статья выглядели одинаково. Это главный
 * SEO-дефект SPA, и чинится он здесь: сервер знает данные (store) и перед
 * отдачей HTML вписывает в него настоящие title / description / canonical /
 * og:* и структурированные данные schema.org для каждого маршрута.
 *
 * Клиентский usePageMeta остаётся: он ведёт метаданные при навигации внутри
 * SPA (без перезагрузки). Тексты здесь и там намеренно совпадают.
 *
 * Никакой новой зависимости: только строковые замены в собранном index.html.
 * JSON-LD — данные, не скрипт, поэтому строгий CSP script-src 'self' его
 * не блокирует.
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as store from './store.js'

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html')

/* Шаблон кешируем, но следим за mtime: после деплоя dist/ подменяется,
   и отдавать HTML со старыми хешами ассетов нельзя. stat() на каждый
   запрос дешевле readFile и на порядки дешевле рендера React. */
let cachedHtml = null
let cachedMtime = 0
function template() {
  if (!existsSync(INDEX)) return null
  const mtime = statSync(INDEX).mtimeMs
  if (!cachedHtml || mtime !== cachedMtime) {
    cachedHtml = readFileSync(INDEX, 'utf8')
    cachedMtime = mtime
  }
  return cachedHtml
}

/** Экранирование для HTML-атрибутов и текста. */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/* Внутри <script type="application/ld+json"> опасна только последовательность
   `</script` — экранируем `<`, JSON от этого остаётся валидным. */
const ldjson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c')

/** Безопасный decodeURIComponent: кривой энкодинг — просто пустой id. */
function decodeId(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return ''
  }
}

/** Обрезка описания до разумной для сниппета длины, по границе слова. */
function clip(s, max = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)) + '…'
}

const BRAND = 'ТОО «СХМ Агро»'

/* ------------------------- метаданные по маршрутам ------------------------ */

/**
 * Возвращает { title, description, keywords, image, ld: [], noindex } для пути.
 * Тексты совпадают с usePageMeta соответствующих страниц (см. src/pages/*).
 */
function routeMeta(path, origin) {
  const abs = (p) => (p && /^https?:/i.test(p) ? p : origin + (p || ''))
  const s = store.settings.publicAll()

  /* Организация присутствует на каждой странице: телефон и адрес берём из
     настроек, поэтому они не разойдутся с тем, что видно на сайте. */
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': origin + '/#organization',
    name: BRAND,
    alternateName: ['СХМ Агро', 'SHM Agro'],
    url: origin + '/',
    logo: abs('/assets/logo.png'),
    description:
      'Казахстанский производитель сельскохозяйственной техники: тракторы, комбайны, посевные комплексы. Продажа, сервис, запчасти.',
    ...(s.phone ? { telephone: s.phone } : {}),
    ...(s.email ? { email: s.email } : {}),
    ...(s.address
      ? { address: { '@type': 'PostalAddress', streetAddress: s.address, addressCountry: 'KZ' } }
      : {}),
    ...(s.phone
      ? {
          contactPoint: [
            {
              '@type': 'ContactPoint',
              telephone: s.phone,
              contactType: 'sales',
              availableLanguage: ['ru', 'kk'],
              areaServed: 'KZ',
            },
          ],
        }
      : {}),
  }

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': origin + '/#website',
    url: origin + '/',
    name: 'СХМ Агро',
    inLanguage: 'ru',
    publisher: { '@id': origin + '/#organization' },
  }

  const crumbs = (items) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: origin + url,
    })),
  })

  // Фото на превью в мессенджерах — то же, что видит посетитель на главной:
  // редактируется в админке, дефолт — снимок из комплекта сайта.
  const base = {
    keywords: null,
    image: abs(s.hero_photo || '/assets/hero-field.webp'),
    ld: [organization, website],
    noindex: false,
  }

  // Карточка техники: /catalog/:id → schema.org/Product.
  if (path.startsWith('/catalog/') && path.length > '/catalog/'.length) {
    const id = decodeId(path.slice('/catalog/'.length).replace(/\/+$/, ''))
    const m = store.models.get(id)
    if (!m || m.published === false) {
      return { ...base, title: 'Страница не найдена', description: '', noindex: true }
    }
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: m.name,
      description: clip(m.descr || m.short, 300),
      // Главное фото — первым: некоторые агрегаторы берут для сниппета
      // только image[0], а не любое из списка.
      ...(m.photo || m.gallery?.length
        ? { image: [m.photo, ...(m.gallery || [])].filter(Boolean).map(abs) }
        : {}),
      url: origin + '/catalog/' + m.id,
      brand: { '@type': 'Brand', name: 'СХМ Агро' },
      manufacturer: { '@id': origin + '/#organization' },
      ...(Array.isArray(m.specs) && m.specs.length
        ? {
            additionalProperty: m.specs.map((sp) => ({
              '@type': 'PropertyValue',
              name: sp.k,
              value: sp.v,
            })),
          }
        : {}),
      /* Цены на сайте нет (продажа по КП), поэтому Offer без price:
         availability и продавец — честные и полезные поисковику данные. */
      offers: {
        '@type': 'Offer',
        url: origin + '/catalog/' + m.id,
        availability: 'https://schema.org/InStock',
        priceCurrency: 'KZT',
        seller: { '@id': origin + '/#organization' },
      },
    }
    return {
      ...base,
      title: `${m.name} — купить у производителя`,
      description: clip(
        `${m.short || ''} Купить ${m.name} напрямую у завода СХМ Агро: характеристики, гарантия 2 года, лизинг и субсидии, доставка по Казахстану.`
      ),
      keywords: `${m.name}, купить, цена, Казахстан, СХМ Агро, сельхозтехника`,
      image: m.photo ? abs(m.photo) : base.image,
      ld: [...base.ld, product, crumbs([['Главная', '/'], ['Каталог техники', '/catalog'], [m.name, '/catalog/' + m.id]])],
    }
  }

  // Статья: /news/:id → schema.org/NewsArticle.
  if (path.startsWith('/news/') && path.length > '/news/'.length) {
    const id = decodeId(path.slice('/news/'.length).replace(/\/+$/, ''))
    const n = store.news.get(id)
    if (!n || n.published === false) return { ...base, title: 'Страница не найдена', description: '', noindex: true }
    const text = Array.isArray(n.body) ? n.body.join(' ') : String(n.body || '')
    const article = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: n.title,
      description: clip(n.excerpt || text),
      ...(n.cover ? { image: abs(n.cover) } : {}),
      datePublished: n.date,
      dateModified: n.date,
      inLanguage: 'ru',
      mainEntityOfPage: origin + '/news/' + n.id,
      author: { '@id': origin + '/#organization' },
      publisher: { '@id': origin + '/#organization' },
    }
    return {
      ...base,
      title: n.title,
      description: clip(n.excerpt || text),
      image: n.cover ? abs(n.cover) : base.image,
      ld: [...base.ld, article, crumbs([['Главная', '/'], ['Новости', '/news'], [n.title, '/news/' + n.id]])],
    }
  }

  switch (path.replace(/\/+$/, '') || '/') {
    case '/':
      return {
        ...base,
        title: 'СХМ Агро — сельхозтехника от производителя в Казахстане',
        /* Ключевые коммерческие запросы («купить сельхозтехнику», «агротехника»,
           «трактор», «комбайн») — прямо в описании: это и сниппет, и релевантность. */
        description:
          'СХМ Агро — казахстанский завод сельхозтехники. Купить трактор, комбайн, сеялку или посевной комплекс напрямую у производителя: цены без посредников, гарантия 2 года, 34 сервисных центра, лизинг и субсидии.',
        keywords:
          'СХМ Агро, сельхозтехника купить, агротехника купить, трактор купить Казахстан, комбайн купить, посевной комплекс, сеялка, производитель сельхозтехники, сельхозтехника Астана',
        ld: [...base.ld],
        fullTitle: true,
      }
    case '/catalog':
      return {
        ...base,
        title: 'Каталог сельхозтехники — купить трактор, комбайн, сеялку',
        description:
          'Каталог агротехники завода СХМ Агро: тракторы, зерноуборочные комбайны, сеялки, посевные комплексы и бороны. Характеристики, наличие, лизинг и субсидии. Купить напрямую у производителя в Казахстане.',
        keywords:
          'каталог сельхозтехники, агротехника купить, трактор купить, комбайн купить, сеялка купить, посевной комплекс купить, Казахстан',
        ld: [
          ...base.ld,
          crumbs([['Главная', '/'], ['Каталог техники', '/catalog']]),
          {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'Каталог сельхозтехники СХМ Агро',
            itemListElement: store.models
              .all()
              .filter((m) => m.published !== false)
              .map((m, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: m.name,
                url: origin + '/catalog/' + m.id,
              })),
          },
        ],
      }
    case '/about':
      return {
        ...base,
        title: 'О заводе — производство сельхозтехники в Казахстане',
        description:
          'Собственное производство сельхозтехники в Казахстане: льём узлы, собираем, красим и обкатываем машины на своём полигоне. Завод СХМ Агро — техника, рассчитанная на степь.',
        ld: [...base.ld, crumbs([['Главная', '/'], ['О компании', '/about']])],
      }
    case '/news':
      return {
        ...base,
        title: 'Новости и статьи о сельхозтехнике',
        description:
          'Новости завода СХМ Агро, обновления модельного ряда сельхозтехники, разборы по субсидиям и лизингу для аграриев Казахстана.',
        ld: [...base.ld, crumbs([['Главная', '/'], ['Новости', '/news']])],
      }
    case '/contacts':
      return {
        ...base,
        title: 'Контакты завода сельхозтехники',
        description: clip(
          `Купить сельхозтехнику СХМ Агро: ${[s.phone, s.email, s.address].filter(Boolean).join(', ')}. Оставьте заявку — перезвоним в рабочее время.`
        ),
        ld: [...base.ld, crumbs([['Главная', '/'], ['Контакты', '/contacts']])],
      }
    case '/privacy':
      return { ...base, title: 'Политика конфиденциальности', description: 'Как сайт СХМ Агро обрабатывает и защищает персональные данные посетителей.' }
    case '/terms':
      return { ...base, title: 'Пользовательское соглашение', description: 'Условия использования сайта ТОО «СХМ Агро».' }
    case '/admin':
      return { ...base, title: 'Админка', description: '', noindex: true }
    default:
      return { ...base, title: 'Страница не найдена', description: '', noindex: true }
  }
}

/* ------------------------------ сама подстановка ------------------------- */

/**
 * Собирает HTML страницы для пути: берёт dist/index.html и вписывает в него
 * метаданные маршрута. Возвращает null, если dist ещё не собран (dev-режим) —
 * тогда вызывающий код отдаёт файл как раньше.
 *
 * @param {string} origin — «https://домен» из запроса (см. siteOrigin в index.js)
 * @param {string} path   — req.path
 */
export function renderPage(origin, path) {
  const html = template()
  if (!html) return null

  const m = routeMeta(path, origin)
  const fullTitle = m.fullTitle ? m.title : `${m.title} — ${BRAND}`
  const url = origin + path

  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${esc(m.description)}$2`
    )
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${esc(fullTitle)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${esc(m.description)}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/, `$1${esc(m.image)}$2`)

  /* Шаблонный JSON-LD Organization из index.html убираем: ниже вставляется
     его полная версия с контактами из настроек, дубль поисковику мешает. */
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')

  const extra = [
    `<link rel="canonical" href="${esc(url)}" />`,
    m.keywords ? `<meta name="keywords" content="${esc(m.keywords)}" />` : '',
    m.noindex ? `<meta name="robots" content="noindex, nofollow" />` : '',
    ...m.ld.map((obj) => `<script type="application/ld+json">${ldjson(obj)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ')

  return out.replace('</head>', `    ${extra}\n  </head>`)
}
