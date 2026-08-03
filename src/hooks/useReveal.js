import { useEffect, useRef, useState } from 'react'

/** Уважаем системную настройку «уменьшить движение». */
export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Появление при попадании в вьюпорт — на IntersectionObserver,
 * без слушателей скролла и без лишних перерисовок.
 *
 * timeout — подстраховка сверх наблюдателя (мс). Без нужды не задаётся:
 * обычные карточки/заголовки честно ждут скролла. Но у элемента, который
 * должен быть виден сразу при открытии страницы (главное фото — LCP),
 * навсегда остаться невидимым из-за браузерной особенности хуже, чем
 * потерять анимацию появления. IntersectionObserver в редких случаях
 * может не отработать вовремя по причинам вне нашего контроля (свёрнутая
   вкладка при загрузке, экономия энергии и т.п.) — таймаут гарантирует,
 * что контент рано или поздно покажется в любом случае. */
export function useReveal({ threshold = 0.12, once = true, timeout = 0 } = {}) {
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
    const fallback = timeout ? setTimeout(() => setShown(true), timeout) : null
    return () => {
      io.disconnect()
      if (fallback) clearTimeout(fallback)
    }
  }, [threshold, once, timeout])

  return [ref, shown]
}
