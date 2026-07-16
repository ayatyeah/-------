import { useEffect, useRef, useState } from 'react'

/** Уважаем системную настройку «уменьшить движение». */
export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Появление при попадании в вьюпорт — на IntersectionObserver,
 * без слушателей скролла и без лишних перерисовок.
 */
export function useReveal({ threshold = 0.12, once = true } = {}) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (reducedMotion()) {
      setShown(true)
      return
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          if (once) io.disconnect()
        } else if (!once) {
          setShown(false)
        }
      },
      { threshold, rootMargin: '0px 0px -60px 0px' }
    )

    io.observe(el)
    return () => io.disconnect()
  }, [threshold, once])

  return [ref, shown]
}
