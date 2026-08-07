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

/* ------------------------------- языки (задача 17) ------------------------ */

/* Тот же принцип, что и на клиенте (см. src/i18n.jsx): язык — часть
   адреса. Русский без префикса, казахский и английский — с /kk и /en.
   Дублируем логику здесь намеренно: серверу нельзя тянуть клиентский
   модуль (он собран для браузера), а сам расчёт — две строки. */
const LANGS = ['ru', 'kk', 'en']
const PREFIX = { kk: '/kk', en: '/en' }
const OG_LOCALE = { ru: 'ru_RU', kk: 'kk_KZ', en: 'en_GB' }

function langFromPath(path) {
  if (path === '/kk' || path.startsWith('/kk/')) return 'kk'
  if (path === '/en' || path.startsWith('/en/')) return 'en'
  return 'ru'
}

function stripLangPrefix(path, lang) {
  if (lang === 'ru') return path
  const rest = path.slice(PREFIX[lang].length)
  return rest || '/'
}

function withLang(lang, path) {
  const prefix = PREFIX[lang]
  if (!prefix) return path
  return path === '/' ? prefix : `${prefix}${path}`
}

/** Переводное поле модели/новости (то же правило, что и tField на клиенте):
    `field_kk`/`field_en`, если заполнено, иначе русский оригинал. */
function pick(obj, field, lang) {
  if (!obj) return ''
  if (lang === 'ru') return obj[field] ?? ''
  return obj[`${field}_${lang}`] || obj[field] || ''
}
function pickParas(obj, field, lang) {
  if (!obj) return []
  if (lang === 'ru') return obj[field] ?? []
  const t = obj[`${field}_${lang}`]
  return Array.isArray(t) && t.length ? t : obj[field] ?? []
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
 *
 * @param {string} path — маршрут БЕЗ языкового префикса (/catalog/t2204,
 *   не /kk/catalog/t2204) — весь разбор ниже написан один раз для всех трёх
 *   языков, префикс к нему отношения не имеет.
 * @param {string} lang — 'ru' | 'kk' | 'en', уже определён вызывающим кодом
 *   по префиксу исходного адреса.
 */
function routeMeta(path, origin, lang) {
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
    inLanguage: lang,
    publisher: { '@id': origin + '/#organization' },
  }

  // item — путь БЕЗ префикса (тот же, что приходит в path); withLang
  // возвращает его на текущем языке, чтобы хлебные крошки вели на
  // /kk/catalog, а не всегда на русскую версию.
  const crumbs = (items) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: origin + withLang(lang, url),
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
    const mName = pick(m, 'name', lang)
    const mShort = pick(m, 'short', lang)
    const mDescr = pick(m, 'descr', lang)
    const pageUrl = origin + withLang(lang, '/catalog/' + m.id)
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: mName,
      description: clip(mDescr || mShort, 300),
      // Главное фото — первым: некоторые агрегаторы берут для сниппета
      // только image[0], а не любое из списка.
      ...(m.photo || m.gallery?.length
        ? { image: [m.photo, ...(m.gallery || [])].filter(Boolean).map(abs) }
        : {}),
      url: pageUrl,
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
        url: pageUrl,
        availability: 'https://schema.org/InStock',
        priceCurrency: 'KZT',
        seller: { '@id': origin + '/#organization' },
      },
    }
    return {
      ...base,
      title: `${mName} — купить у производителя`,
      description: clip(
        `${mShort} Купить ${mName} напрямую у завода СХМ Агро: характеристики, гарантия 2 года, лизинг и субсидии, доставка по Казахстану.`
      ),
      keywords: `${mName}, купить, цена, Казахстан, СХМ Агро, сельхозтехника`,
      image: m.photo ? abs(m.photo) : base.image,
      ld: [...base.ld, product, crumbs([['Главная', '/'], ['Каталог техники', '/catalog'], [mName, '/catalog/' + m.id]])],
    }
  }

  // Статья: /news/:id → schema.org/NewsArticle.
  if (path.startsWith('/news/') && path.length > '/news/'.length) {
    const id = decodeId(path.slice('/news/'.length).replace(/\/+$/, ''))
    const n = store.news.get(id)
    if (!n || n.published === false) return { ...base, title: 'Страница не найдена', description: '', noindex: true }
    const nTitle = pick(n, 'title', lang)
    const nExcerpt = pick(n, 'excerpt', lang)
    const nBodyParas = pickParas(n, 'body', lang)
    const text = nBodyParas.join(' ')
    const article = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: nTitle,
      description: clip(nExcerpt || text),
      ...(n.cover ? { image: abs(n.cover) } : {}),
      datePublished: n.date,
      dateModified: n.date,
      inLanguage: lang,
      mainEntityOfPage: origin + withLang(lang, '/news/' + n.id),
      author: { '@id': origin + '/#organization' },
      publisher: { '@id': origin + '/#organization' },
    }
    return {
      ...base,
      title: nTitle,
      description: clip(nExcerpt || text),
      image: n.cover ? abs(n.cover) : base.image,
      ld: [...base.ld, article, crumbs([['Главная', '/'], ['Новости', '/news'], [nTitle, '/news/' + n.id]])],
    }
  }

  /* Тексты статических страниц на трёх языках (задача 17). Данных из
     store здесь нет — можно просто держать три готовых варианта рядом,
     без отдельного слоя перевода, как у моделей и новостей. */
  const STATIC = {
    '/': {
      ru: {
        title: 'СХМ Агро — сельхозтехника от производителя в Казахстане',
        description:
          'СХМ Агро — казахстанский завод сельхозтехники. Купить трактор, комбайн, сеялку или посевной комплекс напрямую у производителя: цены без посредников, гарантия 2 года, 34 сервисных центра, лизинг и субсидии.',
        keywords:
          'СХМ Агро, сельхозтехника купить, агротехника купить, трактор купить Казахстан, комбайн купить, посевной комплекс, сеялка, производитель сельхозтехники, сельхозтехника Астана',
      },
      kk: {
        title: 'СХМ Агро — Қазақстандағы өндірушіден ауыл шаруашылығы техникасы',
        description:
          'СХМ Агро — қазақстандық ауыл шаруашылығы техникасы зауыты. Тракторды, комбайнды, себу немесе егу кешенін тікелей өндірушіден сатып алыңыз: делдалсыз бағалар, 2 жыл кепілдік, 34 сервис орталығы, лизинг және субсидиялар.',
        keywords:
          'СХМ Агро, ауыл шаруашылығы техникасын сатып алу, трактор сатып алу Қазақстан, комбайн сатып алу, себу кешені, сеялка, ауыл шаруашылығы техникасының өндірушісі',
      },
      en: {
        title: 'SHM Agro — Farm Machinery Manufacturer in Kazakhstan',
        description:
          'SHM Agro is a Kazakhstani farm machinery plant. Buy tractors, combine harvesters, seeders or planting complexes directly from the manufacturer: no middleman markup, 2-year warranty, 34 service centers, leasing and subsidies.',
        keywords:
          'SHM Agro, buy farm machinery, buy agricultural equipment, buy tractor Kazakhstan, buy combine harvester, seeding complex, seeder, farm machinery manufacturer',
      },
    },
    '/catalog': {
      ru: {
        title: 'Каталог сельхозтехники — купить трактор, комбайн, сеялку',
        description:
          'Каталог агротехники завода СХМ Агро: тракторы, зерноуборочные комбайны, сеялки, посевные комплексы и бороны. Характеристики, наличие, лизинг и субсидии. Купить напрямую у производителя в Казахстане.',
        keywords:
          'каталог сельхозтехники, агротехника купить, трактор купить, комбайн купить, сеялка купить, посевной комплекс купить, Казахстан',
      },
      kk: {
        title: 'Ауыл шаруашылығы техникасының каталогы — трактор, комбайн, сеялка сатып алу',
        description:
          'СХМ Агро зауытының агротехника каталогы: тракторлар, астық жинайтын комбайндар, сеялкалар, егу кешендері және тырмалар. Сипаттамалары, қоймадағы саны, лизинг және субсидиялар. Қазақстандағы өндірушіден тікелей сатып алыңыз.',
        keywords: 'ауыл шаруашылығы техникасының каталогы, агротехника сатып алу, трактор сатып алу, комбайн сатып алу, сеялка сатып алу, Қазақстан',
      },
      en: {
        title: 'Farm Machinery Catalog — Tractors, Combines, Seeders',
        description:
          'SHM Agro equipment catalog: tractors, grain combine harvesters, seeders, planting complexes and disc harrows. Specifications, availability, leasing and subsidies. Buy directly from the manufacturer in Kazakhstan.',
        keywords: 'farm machinery catalog, buy agricultural equipment, buy tractor, buy combine harvester, buy seeder, Kazakhstan',
      },
    },
    '/about': {
      ru: {
        title: 'О заводе — производство сельхозтехники в Казахстане',
        description:
          'Собственное производство сельхозтехники в Казахстане: льём узлы, собираем, красим и обкатываем машины на своём полигоне. Завод СХМ Агро — техника, рассчитанная на степь.',
      },
      kk: {
        title: 'Зауыт туралы — Қазақстанда ауыл шаруашылығы техникасын өндіру',
        description:
          'Қазақстанда меншікті ауыл шаруашылығы техникасын өндіру: тораптарды құямыз, жинаймыз, бояймыз және өз полигонымызда сынақтан өткіземіз. СХМ Агро зауыты — далаға арналған техника.',
      },
      en: {
        title: 'About the Plant — Farm Machinery Manufacturing in Kazakhstan',
        description:
          'In-house farm machinery manufacturing in Kazakhstan: we cast components, assemble, paint and test-run machines on our own proving ground. SHM Agro — machinery built for the steppe.',
      },
    },
    '/news': {
      ru: {
        title: 'Новости и статьи о сельхозтехнике',
        description:
          'Новости завода СХМ Агро, обновления модельного ряда сельхозтехники, разборы по субсидиям и лизингу для аграриев Казахстана.',
      },
      kk: {
        title: 'Ауыл шаруашылығы техникасы туралы жаңалықтар мен мақалалар',
        description:
          'СХМ Агро зауытының жаңалықтары, техника үлгілер қатарының жаңартулары, Қазақстан фермерлеріне субсидиялар мен лизинг бойынша талдаулар.',
      },
      en: {
        title: 'Farm Machinery News and Articles',
        description:
          'News from SHM Agro plant, farm machinery lineup updates, subsidy and leasing guides for farmers in Kazakhstan.',
      },
    },
    '/contacts': {
      ru: { title: 'Контакты завода сельхозтехники', lead: 'Купить сельхозтехнику СХМ Агро', tail: 'Оставьте заявку — перезвоним в рабочее время.' },
      kk: {
        title: 'Ауыл шаруашылығы техникасы зауытының байланыстары',
        lead: 'СХМ Агро ауыл шаруашылығы техникасын сатып алыңыз',
        tail: 'Өтінім қалдырыңыз — жұмыс уақытында қоңырау шаламыз.',
      },
      en: {
        title: 'Farm Machinery Plant Contacts',
        lead: 'Buy SHM Agro farm machinery',
        tail: "Leave a request — we'll call you back during business hours.",
      },
    },
    '/privacy': {
      ru: { title: 'Политика конфиденциальности', description: 'Как сайт СХМ Агро обрабатывает и защищает персональные данные посетителей.' },
      kk: { title: 'Құпиялылық саясаты', description: 'СХМ Агро сайты келушілердің дербес деректерін қалай өңдейді және қорғайды.' },
      en: { title: 'Privacy Policy', description: "How the SHM Agro website processes and protects visitors' personal data." },
    },
    '/terms': {
      ru: { title: 'Пользовательское соглашение', description: 'Условия использования сайта ТОО «СХМ Агро».' },
      kk: { title: 'Пайдаланушы келісімі', description: 'ЖШС «СХМ Агро» сайтын пайдалану шарттары.' },
      en: { title: 'Terms of Use', description: 'Terms of use for the SHM Agro LLP website.' },
    },
  }
  // Хлебные крошки на трёх языках — подписи разделов те же, что в навигации сайта.
  const CRUMB_LABEL = {
    home: { ru: 'Главная', kk: 'Басты бет', en: 'Home' },
    catalog: { ru: 'Каталог техники', kk: 'Техника каталогы', en: 'Catalog' },
    about: { ru: 'О компании', kk: 'Компания туралы', en: 'About' },
    news: { ru: 'Новости', kk: 'Жаңалықтар', en: 'News' },
    contacts: { ru: 'Контакты', kk: 'Байланыстар', en: 'Contacts' },
  }
  const cl = (key) => CRUMB_LABEL[key][lang]

  switch (path.replace(/\/+$/, '') || '/') {
    case '/':
      return {
        ...base,
        ...STATIC['/'][lang],
        ld: [...base.ld],
        fullTitle: true,
      }
    case '/catalog':
      return {
        ...base,
        ...STATIC['/catalog'][lang],
        ld: [
          ...base.ld,
          crumbs([[cl('home'), '/'], [cl('catalog'), '/catalog']]),
          {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: STATIC['/catalog'][lang].title,
            itemListElement: store.models
              .all()
              .filter((m) => m.published !== false)
              .map((m, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: pick(m, 'name', lang),
                url: origin + withLang(lang, '/catalog/' + m.id),
              })),
          },
        ],
      }
    case '/about':
      return { ...base, ...STATIC['/about'][lang], ld: [...base.ld, crumbs([[cl('home'), '/'], [cl('about'), '/about']])] }
    case '/news':
      return { ...base, ...STATIC['/news'][lang], ld: [...base.ld, crumbs([[cl('home'), '/'], [cl('news'), '/news']])] }
    case '/contacts': {
      const c = STATIC['/contacts'][lang]
      return {
        ...base,
        title: c.title,
        description: clip(`${c.lead}: ${[s.phone, s.email, s.address].filter(Boolean).join(', ')}. ${c.tail}`),
        ld: [...base.ld, crumbs([[cl('home'), '/'], [cl('contacts'), '/contacts']])],
      }
    }
    case '/privacy':
      return { ...base, ...STATIC['/privacy'][lang] }
    case '/terms':
      return { ...base, ...STATIC['/terms'][lang] }
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

  const lang = langFromPath(path)
  const bare = stripLangPrefix(path, lang)
  const m = routeMeta(bare, origin, lang)
  const fullTitle = m.fullTitle ? m.title : `${m.title} — ${BRAND}`
  const url = origin + path

  let out = html
    .replace(/<html lang="[^"]*">/, `<html lang="${lang}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${esc(m.description)}$2`
    )
    .replace(/(<meta\s+property="og:locale"\s+content=")[^"]*(")/, `$1${OG_LOCALE[lang]}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${esc(fullTitle)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${esc(m.description)}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${esc(url)}$2`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/, `$1${esc(m.image)}$2`)

  /* Шаблонный JSON-LD Organization из index.html убираем: ниже вставляется
     его полная версия с контактами из настроек, дубль поисковику мешает. */
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')

  /* hreflang — только у настоящих, индексируемых страниц: у черновика
     карточки (noindex) альтернативных языковых версий по смыслу нет —
     404 незачем помечать как «есть ещё на казахском». x-default ведёт на
     русскую версию: это язык по умолчанию и единственный, где контент
     всегда полный (см. src/i18n.jsx). */
  const hreflangLinks = m.noindex
    ? []
    : [
        ...LANGS.map(
          (l) => `<link rel="alternate" hreflang="${l}" href="${esc(origin + withLang(l, bare))}" />`
        ),
        `<link rel="alternate" hreflang="x-default" href="${esc(origin + bare)}" />`,
      ]

  const extra = [
    `<link rel="canonical" href="${esc(url)}" />`,
    ...hreflangLinks,
    m.keywords ? `<meta name="keywords" content="${esc(m.keywords)}" />` : '',
    m.noindex ? `<meta name="robots" content="noindex, nofollow" />` : '',
    ...m.ld.map((obj) => `<script type="application/ld+json">${ldjson(obj)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ')

  return out.replace('</head>', `    ${extra}\n  </head>`)
}
