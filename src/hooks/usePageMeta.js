import { useEffect } from 'react'

/*
 * Мета-теги страницы без сторонних библиотек (Helmet и т.п.).
 *
 * Проблема, которую решает: у SPA один <title> на весь сайт — карточка
 * модели, статья и контакты выглядели в поиске одинаково. Это главный
 * SEO-дефект такого сайта.
 *
 * Хук на каждой странице ставит свои title / description / canonical и
 * синхронизирует og:*. Страницы, которым не место в индексе (админка, 404,
 * «не найдено»), передают noindex — и получают <meta name="robots"
 * content="noindex">.
 *
 * SITE_URL (тот же, что для og в index.html) даёт абсолютный canonical.
 * Пустой — canonical относительный, что тоже допустимо.
 */

const BASE_TITLE = 'ТОО «СХМ Агро»'
const SITE_URL = (import.meta.env.VITE_SITE_URL || '').replace(/\/$/, '')

/** Находит <meta> по name/property или создаёт его. */
function meta(attr, key) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  return el
}

function linkCanonical() {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  return el
}

/**
 * @param {object} opts
 * @param {string} opts.title     — заголовок вкладки (без «— ТОО «СХМ Агро»»)
 * @param {string} [opts.description]
 * @param {boolean} [opts.noindex] — закрыть страницу от поисковиков
 */
export default function usePageMeta({ title, description, noindex = false } = {}) {
  useEffect(() => {
    const full = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE
    document.title = full
    meta('property', 'og:title').setAttribute('content', full)

    if (description) {
      meta('name', 'description').setAttribute('content', description)
      meta('property', 'og:description').setAttribute('content', description)
    }

    const url = SITE_URL + window.location.pathname
    linkCanonical().setAttribute('href', url)
    meta('property', 'og:url').setAttribute('content', url)

    // robots: noindex ставим только когда просят; иначе убираем прежний тег,
    // чтобы обычная страница не осталась случайно закрытой от индексации.
    const robots = document.head.querySelector('meta[name="robots"]')
    if (noindex) {
      meta('name', 'robots').setAttribute('content', 'noindex, nofollow')
    } else if (robots) {
      robots.remove()
    }
  }, [title, description, noindex])
}
