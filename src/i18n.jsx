import { createContext, useContext, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ru from './locales/ru'
import kk from './locales/kk'
import en from './locales/en'

/*
 * Переводы без сторонних библиотек (i18next и т.п.) — по той же логике, по
 * которой метаданные живут в usePageMeta, а не в Helmet: три словаря не
 * оправдывают зависимость.
 *
 * Два вида строк:
 *  - t('key')   — интерфейс: кнопки, заголовки, подписи. Ключи — в словарях
 *    src/locales/*, русский — источник истины и запасной вариант.
 *  - td('Текст') — данные из админки (категории, услуги, показатели,
 *    характеристики), переводимые по точному совпадению строки целиком.
 *  - tField(obj, 'name') / tParas(obj, 'body') — переводные поля моделей и
 *    новостей (задача 16): `field_kk`/`field_en`, если заполнены, иначе
 *    русский оригинал.
 *
 * Язык — часть адреса (задача 17), а не скрытое состояние: русский без
 * префикса (/catalog/…), казахский и английский — с /kk и /en (/kk/catalog/…,
 * /en/catalog/…). Так поисковик индексирует каждый язык отдельной страницей
 * и может показать нужную версию по hreflang (см. server/seo.js), а сервер
 * при отдаче HTML знает, какой язык рисовать, — раньше выбор жил только в
 * localStorage браузера, и краулер видел один и тот же русский текст
 * независимо от того, что выбрал живой посетитель.
 */

const DICTS = { ru, kk, en }

export const LANGS = [
  { code: 'ru', label: 'Рус' },
  { code: 'kk', label: 'Қаз' },
  { code: 'en', label: 'Eng' },
]

/* Префикс адреса на язык. У русского префикса нет — он язык по умолчанию,
   и /catalog остаётся /catalog, а не /ru/catalog. */
const PREFIX = { kk: '/kk', en: '/en' }

const LOCALE = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }

/** «/kk/catalog/t2204» → 'kk'. Без префикса или незнакомый — русский. */
export function langFromPath(pathname) {
  if (pathname === '/kk' || pathname.startsWith('/kk/')) return 'kk'
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en'
  return 'ru'
}

/** Тот же адрес без языкового префикса: «/kk/catalog» → «/catalog». */
export function stripLangPrefix(pathname) {
  const lang = langFromPath(pathname)
  if (lang === 'ru') return pathname
  const rest = pathname.slice(PREFIX[lang].length)
  return rest || '/'
}

/**
 * Внутренняя ссылка с текущим языковым префиксом: withLang('kk', '/catalog')
 * → '/kk/catalog'. Админка не локализуется — у нас нет и не планируется
 * её перевод, а «/kk/admin» выглядело бы как настоящая, но битая страница.
 */
export function withLang(lang, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path
  if (path === '/admin' || path.startsWith('/admin/')) return path
  const prefix = PREFIX[lang]
  if (!prefix) return path
  return path === '/' ? prefix : `${prefix}${path}`
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const lang = langFromPath(location.pathname)

  // <html lang> — для читалок экрана и поисковика. На отданном сервером
  // HTML этот же атрибут уже верный (см. server/seo.js) — здесь только
  // поддерживаем его в переходах внутри SPA, без перезагрузки.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => {
    const dict = DICTS[lang]

    /* Переключение языка — это переход на тот же маршрут под другим
       префиксом, а не смена скрытого состояния: адрес остаётся источником
       истины и для сервера, и для истории браузера (кнопка «назад» работает
       правильно), и для поисковика. */
    const setLang = (code) => {
      if (!DICTS[code]) return
      const bare = stripLangPrefix(location.pathname)
      navigate(`${withLang(code, bare)}${location.search}${location.hash}`)
    }

    /** Строка интерфейса по ключу. Нет перевода — русский; нет ключа — сам ключ. */
    const t = (key) => dict.ui[key] ?? DICTS.ru.ui[key] ?? key

    /** Строка данных из админки: перевод по точному совпадению или как есть. */
    const td = (text) => {
      if (lang === 'ru' || !text) return text
      return dict.data[text] ?? text
    }

    /**
     * Переводное поле модели/новости (п.16 дорожной карты): `field_kk` /
     * `field_en`, если заказчик их заполнил, иначе — русский оригинал.
     * Пустой перевод — это не ошибка, а нормальное состояние: заказчик ещё
     * не перевёл текст, и русский текст лучше пустой карточки.
     */
    const tField = (obj, field) => {
      if (!obj) return ''
      if (lang === 'ru') return obj[field] ?? ''
      return obj[`${field}_${lang}`] || obj[field] || ''
    }

    /** То же для массива абзацев (body новости). */
    const tParas = (obj, field) => {
      if (!obj) return []
      if (lang === 'ru') return obj[field] ?? []
      const translated = obj[`${field}_${lang}`]
      return Array.isArray(translated) && translated.length ? translated : obj[field] ?? []
    }

    /** Дата в формате выбранного языка: «8 июля 2026 г.» / «8 шілде 2026 ж.» / «8 July 2026». */
    const fdate = (iso) => {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      return d.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric' })
    }

    /** «3 модели» с правильной формой слова для каждого языка. */
    const tModels = (n) => {
      if (lang === 'ru') return `${n} ${n === 1 ? 'модель' : n < 5 ? 'модели' : 'моделей'}`
      if (lang === 'kk') return `${n} үлгі`
      return `${n} ${n === 1 ? 'model' : 'models'}`
    }

    return {
      lang,
      setLang,
      t,
      td,
      tField,
      tParas,
      fdate,
      tModels,
      /** Внутренняя ссылка с текущим языковым префиксом — см. withLang() выше. */
      withLang: (path) => withLang(lang, path),
    }
  }, [lang, location.pathname, location.search, location.hash, navigate])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useT = () => useContext(I18nContext)
