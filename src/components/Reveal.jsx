import { useEffect, useRef, useState } from 'react'
import { useReveal, reducedMotion } from '../hooks/useReveal'

/**
 * Обёртка появления: снизу вверх с затуханием.
 * variant: 'up' | 'left' | 'right' | 'fade' | 'clip'
 */
export default function Reveal({
  as: Tag = 'div',
  variant = 'up',
  delay = 0,
  className = '',
  children,
  ...rest
}) {
  const [ref, shown] = useReveal()

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
