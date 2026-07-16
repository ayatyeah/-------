import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from './useReveal'

/**
 * Лёгкий параллакс-наклон по указателю.
 * Пишем сразу в CSS-переменные элемента — React не перерисовывается на кадр.
 */
export function useTilt(strength = 10) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion()) return

    let raf = 0
    let tx = 0
    let ty = 0

    const apply = () => {
      el.style.setProperty('--tilt-x', `${tx.toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${ty.toFixed(2)}deg`)
      raf = 0
    }

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      // -0.5…0.5 от центра элемента
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      ty = px * strength
      tx = -py * strength
      if (!raf) raf = requestAnimationFrame(apply)
    }

    const onLeave = () => {
      tx = 0
      ty = 0
      if (!raf) raf = requestAnimationFrame(apply)
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [strength])

  return ref
}

/**
 * true, пока пользователь листает вниз. Нужен, чтобы плавающая кнопка
 * пряталась и не закрывала текст, а возвращалась, как только человек
 * остановился или пошёл вверх.
 */
export function useHiddenOnScrollDown({ after = 200, idle = 500 } = {}) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let raf = 0
    let idleTimer = 0

    const check = () => {
      const y = window.scrollY
      const goingDown = y > last + 4
      const goingUp = y < last - 4
      if (goingDown && y > after) setHidden(true)
      else if (goingUp) setHidden(false)
      last = y
      raf = 0

      // Остановился — показываем снова.
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => setHidden(false), idle)
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(idleTimer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [after, idle])

  return hidden
}

/** true, когда страница прокручена ниже порога — для «сжатия» шапки. */
export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    let raf = 0
    const check = () => {
      setScrolled(window.scrollY > threshold)
      raf = 0
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [threshold])

  return scrolled
}
