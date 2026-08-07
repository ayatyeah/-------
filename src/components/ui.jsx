import { useEffect, useRef, useState } from 'react'
import Link from './L'
import { useT } from '../i18n'

/** Плашка вместо фотографии — штриховка с подписью. */
export function MediaStub({ label }) {
  return (
    <div className="media-stub">
      <span>{label}</span>
    </div>
  )
}

/**
 * Картинка модели/новости или плашка, если фото нет.
 *
 * Мелкая версия у снимка бывает по одной из двух причин:
 *  - `/assets/…` — из комплекта сайта, там рядом с `name.webp` (1200w)
 *    всегда лежит и `name-sm.webp` (760w), это готовится заранее;
 *  - `/uploads/…` — загружено через админку, сервер сам собирает
 *    уменьшенную версию `<файл>-sm.jpg` при загрузке (задача 20, см.
 *    server/uploads.js). Формат превью всегда JPEG, даже если оригинал
 *    PNG/WebP: это просто маленькая картинка для сетки карточек, точный
 *    формат ей не нужен.
 *
 * Фото, загруженные ДО того как сервер начал делать превью, — исключение:
 * уменьшенной версии у них нет. На такой случай — onError: если браузер
 * не смог загрузить выбранный из srcSet файл, откатываемся на просто src
 * (полноразмерный файл, он точно есть) вместо разбитой картинки.
 *
 * priority — для LCP-картинки (герой): грузим сразу, без lazy.
 */
export function Media({ src, alt, stub, sizes = '(max-width: 720px) 100vw, 560px', priority = false }) {
  // Сбрасываем при смене самого src — иначе после «не нашли уменьшенную
  // версию у фото A» карточка с совсем другим фото B открылась бы сразу
  // без srcSet, хотя у него уменьшенная версия есть.
  const [smallFailed, setSmallFailed] = useState(false)
  useEffect(() => setSmallFailed(false), [src])

  if (!src) return <MediaStub label={stub} />

  const isAsset = src.startsWith('/assets/') && src.endsWith('.webp')
  const isUpload = src.startsWith('/uploads/') && /\.(jpe?g|png|webp)$/i.test(src)
  const hasSmall = !smallFailed && (isAsset || isUpload)
  const srcSet = !hasSmall
    ? undefined
    : isAsset
      ? `${src.replace(/\.webp$/, '-sm.webp')} 760w, ${src} 1200w`
      : `${src.replace(/\.[^.]+$/, '-sm.jpg')} ${THUMB_WIDTH}w, ${src} 1200w`

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width="1200"
      height="655"
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchpriority={priority ? 'high' : undefined}
      onError={() => hasSmall && setSmallFailed(true)}
    />
  )
}

/* Ширина уменьшенной версии загруженного фото — см. THUMB_DIMENSION в
   server/uploads.js, значения намеренно совпадают. */
const THUMB_WIDTH = 480

export function Loading({ count = 3 }) {
  return (
    <div className="grid-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card skeleton" />
      ))}
    </div>
  )
}

/**
 * Экран «не загрузилось».
 *
 * Раньше здесь посетителю сайта показывали строчку «Проверьте, запущен ли
 * сервер: npm run dev:server». Это подсказка разработчику, случайно
 * попавшая на живой сайт: фермеру она не говорит ничего, зато сообщает
 * любому, чем сайт собран и что администратор до него не добрался.
 *
 * Теперь посетитель видит то, что может сделать сам, а команда запуска
 * остаётся только в режиме разработки — там она и правда полезна.
 */
export function ErrorState({ message, onRetry }) {
  const { t } = useT()
  return (
    <div className="state">
      <div className="state-title">{t('err_title')}</div>
      <p style={{ marginBottom: 18 }}>
        {message}
        <br />
        {t('err_hint')}
        {/* import.meta.env.DEV вырезается при сборке продакшена целиком —
            на боевой сайт этот блок не попадает даже в виде мёртвого кода. */}
        {import.meta.env.DEV && (
          <>
            <br />
            <small style={{ opacity: 0.7 }}>
              Разработка: проверьте, запущен ли сервер — <code>npm run dev:server</code>
            </small>
          </>
        )}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, text }) {
  return (
    <div className="state">
      <div className="state-title">{title}</div>
      {text && <p>{text}</p>}
    </div>
  )
}

/**
 * Ловушка для ботов. Обычному человеку это поле не видно и недоступно с
 * клавиатуры (скрыто стилем + aria-hidden + tabIndex -1), а бот, который
 * заполняет все поля подряд, впишет сюда что-нибудь. Сервер, получив
 * непустое поле-ловушку, отвечает ложным «успехом» и заявку не сохраняет.
 *
 * autoComplete="off" — чтобы браузер не подставил сюда сохранённые данные
 * и не подставил живого человека под ложное срабатывание.
 */
export function Honeypot({ name }) {
  const { t } = useT()
  return (
    <div className="hp" aria-hidden="true">
      <label htmlFor={name}>{t('honeypot')}</label>
      <input id={name} name={name} type="text" tabIndex={-1} autoComplete="off" />
    </div>
  )
}

/**
 * Согласие на обработку персональных данных — обязательное перед отправкой
 * любой формы с именем и телефоном.
 *
 * Один компонент на все три формы: текст согласия должен быть везде одним и
 * тем же, иначе непонятно, с чем именно человек согласился.
 *
 * Галочка намеренно не отмечена по умолчанию: заранее проставленная — это уже
 * не согласие. Сервер тоже проверяет его отдельно, мимо интерфейса заявку без
 * согласия не создать.
 */
export function ConsentCheck({ checked, onChange, id }) {
  const { t } = useT()
  return (
    <label className="consent" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
      />
      <span>
        {t('consent_pre')}
        <Link to="/privacy" target="_blank" rel="noopener noreferrer">
          {t('consent_link')}
        </Link>
        {t('consent_post')}
      </span>
    </label>
  )
}

/**
 * Модальное окно: закрытие по Esc и клику по подложке, блокировка скролла.
 *
 * Доступность: Tab заперт внутри окна (иначе фокус уходил под подложку к
 * недоступным элементам), при открытии фокус ставится на первый элемент, при
 * закрытии — возвращается на тот, что открыл диалог. Без этого клавиатурный
 * пользователь после закрытия оказывался в начале страницы.
 */
export function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null)

  useEffect(() => {
    const opener = document.activeElement // на него вернём фокус при закрытии
    const box = ref.current

    const focusable = () =>
      [
        ...box.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.offsetParent !== null)

    // Фокус внутрь — на первый элемент.
    focusable()[0]?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      // Замыкаем кольцо: Shift+Tab с первого → на последний и наоборот.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [onClose])

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="dialog"
        style={wide ? { maxWidth: 620 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="dialog-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}
