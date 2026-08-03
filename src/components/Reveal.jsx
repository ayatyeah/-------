import { useEffect, useRef, useState } from 'react'
import { useReveal, reducedMotion } from '../hooks/useReveal'

/**
 * Обёртка появления: снизу вверх с затуханием.
 * variant: 'up' | 'left' | 'right' | 'fade' | 'clip'
 *
 * 'clip' устроен иначе остальных: clip-path висит не на самом
 * наблюдаемом элементе, а на внутренней обёртке. У полностью
 * заклипанного элемента (clip-path: inset(0 0 100% 0) — видимая высота
 * ровно 0) Chromium сам же считает пересечение с вьюпортом нулевым, а
 * IntersectionObserver — не пересекающимся. Получался замкнутый круг:
 * элемент невидим, пока не подтверждено пересечение, а пересечение не
 * подтверждается, пока элемент невидим. Раз на раз срабатывало (первый
 * тик наблюдателя иногда успевал проскочить до применения clip-path),
 * а не работало — так и осталось скрытым навсегда: именно это
 * происходило с главным фото на карточке модели и на главной. Вынося
 * clip-path на дочерний div, сам наблюдаемый элемент остаётся обычной
 * непрозрачной коробкой, и IntersectionObserver видит его нормально.
 *
 * Подстраховка сверху: у 'clip' всегда есть запасной таймаут (см.
 * useReveal). Это именно то, что показывается первым при заходе на
 * страницу (главное фото), — если наблюдатель почему-либо не сработает
 * (мало ли какая браузерная особенность), картинка не должна остаться
 * невидимой навсегда. Обычные карточки/заголовки таймаута не получают —
 * там честное появление по скроллу важнее подстраховки.
 */
export default function Reveal({
  as: Tag = 'div',
  variant = 'up',
  delay = 0,
  className = '',
  children,
  ...rest
}) {
  const [ref, shown] = useReveal({ timeout: variant === 'clip' ? 800 : 0 })

  if (variant === 'clip') {
    return (
      <Tag
        ref={ref}
        className={`reveal reveal--clip-outer${shown ? ' is-in' : ''} ${className}`.trim()}
        style={{ transitionDelay: `${delay}ms` }}
        {...rest}
      >
        <div className="reveal-clip-inner">{children}</div>
      </Tag>
    )
  }

  return (
    <Tag
      ref={ref}
      className={`reveal reveal--${variant}${shown ? ' is-in' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * Счётчик: анимирует число, когда блок попадает в вид.
 * Разбирает строки вида «12 400+» — цифры анимируем, хвост оставляем.
 */
export function CountUp({ value, duration = 1400 }) {
  const [ref, shown] = useReveal()
  const [text, setText] = useState(String(value))
  const raf = useRef(0)

  useEffect(() => {
    const str = String(value)
    // «12 400+» → число 12400, суффикс «+»
    const m = str.match(/^([\d\s  ]+)(.*)$/)
    if (!m || !shown) {
      setText(str)
      return
    }

    const target = Number(m[1].replace(/[\s  ]/g, ''))
    const suffix = m[2]
    if (!Number.isFinite(target)) {
      setText(str)
      return
    }

    if (reducedMotion()) {
      setText(target.toLocaleString('ru-RU') + suffix)
      return
    }

    let start = null
    // easeOutExpo — быстрый разгон, мягкая остановка
    const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

    const step = (ts) => {
      if (start === null) start = ts
      const p = Math.min((ts - start) / duration, 1)
      const n = Math.round(target * ease(p))
      setText(n.toLocaleString('ru-RU') + suffix)
      if (p < 1) raf.current = requestAnimationFrame(step)
    }

    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [shown, value, duration])

  return <span ref={ref}>{text}</span>
}
