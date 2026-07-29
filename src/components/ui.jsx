import { useEffect, useRef } from 'react'
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

  /* Мелкая версия (`-sm.webp`) существует только у снимков из комплекта,
     которые лежат в /assets. У загруженных через админку фотографий её
     нет: сервер картинки не пережимает (это потребовало бы тяжёлой
     библиотеки), их ужимает браузер при загрузке.

     Раньше srcSet собирался для любого .webp — и для загруженного фото
     браузер на телефоне честно шёл за несуществующим `-sm.webp`, получал
     404 и показывал вместо карточки пустоту. Поэтому набор размеров
     объявляем только там, где он действительно есть. */
  const hasSmall = src.startsWith('/assets/') && src.endsWith('.webp')
  const srcSet = hasSmall
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
 * Ловушка для ботов. Обычному человеку это поле не видно и недоступно с
 * клавиатуры (скрыто стилем + aria-hidden + tabIndex -1), а бот, который
 * заполняет все поля подряд, впишет сюда что-нибудь. Сервер, получив
 * непустое поле-ловушку, отвечает ложным «успехом» и заявку не сохраняет.
 *
 * autoComplete="off" — чтобы браузер не подставил сюда сохранённые данные
 * и не подставил живого человека под ложное срабатывание.
 */
export function Honeypot({ name }) {
  return (
    <div className="hp" aria-hidden="true">
      <label htmlFor={name}>Не заполняйте это поле</label>
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
