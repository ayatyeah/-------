import { useEffect } from 'react'
import { Link } from 'react-router-dom'

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
 * Для каждого снимка лежат две версии: `name.webp` (1200w) и `name-sm.webp`
 * (760w). Браузер выбирает подходящую по `sizes` — на телефоне грузится
 * мелкая, на десктопе крупная.
 *
 * priority — для LCP-картинки (герой): грузим сразу, без lazy.
 */
export function Media({ src, alt, stub, sizes = '(max-width: 720px) 100vw, 560px', priority = false }) {
  if (!src) return <MediaStub label={stub} />

  const isWebp = src.endsWith('.webp')
  const srcSet = isWebp
    ? `${src.replace(/\.webp$/, '-sm.webp')} 760w, ${src} 1200w`
    : undefined

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
    />
  )
}

export function Loading({ count = 3 }) {
  return (
    <div className="grid-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card skeleton" />
      ))}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state">
      <div className="state-title">Не удалось загрузить</div>
      <p style={{ marginBottom: 18 }}>
        {message}
        <br />
        Проверьте, запущен ли сервер: <code>npm run dev:server</code>
      </p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Повторить
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
        Я согласен на обработку моих персональных данных и ознакомлен с{' '}
        <Link to="/privacy" target="_blank" rel="noopener noreferrer">
          политикой конфиденциальности
        </Link>
        .
      </span>
    </label>
  )
}

/** Модальное окно: закрытие по Esc и клику по подложке, блокировка скролла. */
export function Dialog({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="backdrop" onClick={onClose}>
      <div
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
