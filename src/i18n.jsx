import { createContext, useContext, useEffect, useMemo, useState } from 'react'
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
 *    характеристики). Админ пишет по-русски; словарь data сопоставляет
 *    известные строки с переводом ЦЕЛИКОМ, по точному совпадению. Если
 *    заказчик ввёл что-то новое — строка показывается по-русски, а не
 *    ломается. Это честный компромисс: контент из админки одноязычный,
 *    и до появления полей «на трёх языках» лучше русский текст, чем пустота.
 *
 * Выбор языка хранится в localStorage и живёт между визитами. Русский —
 * язык по умолчанию.
 */

const DICTS = { ru, kk, en }

export const LANGS = [
  { code: 'ru', label: 'Рус' },
  { code: 'kk', label: 'Қаз' },
  { code: 'en', label: 'Eng' },
]

const KEY = 'shm_lang'
const LOCALE = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const v = localStorage.getItem(KEY)
      if (v && DICTS[v]) return v
    } catch {
      /* приватный режим — работаем с языком по умолчанию */
    }
    return 'ru'
  })

  // <html lang> — для читалок экрана и поисковика.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (code) => {
    if (!DICTS[code]) return
    setLangState(code)
    try {
      localStorage.setItem(KEY, code)
    } catch {
      /* ок: выбор проживёт до перезагрузки */
    }
  }

  const value = useMemo(() => {
    const dict = DICTS[lang]

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

    return { lang, setLang, t, td, tField, tParas, fdate, tModels }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useT = () => useContext(I18nContext)
