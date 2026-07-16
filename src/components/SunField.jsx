import { useEffect, useRef } from 'react'
import { reducedMotion } from '../hooks/useReveal'

/**
 * «Солнечное поле» — Canvas 2D, без React-рендера на кадр.
 * Золотые частицы дрейфуют над героем, расступаются и разгораются
 * под курсором. Анимация замирает, когда герой уходит из вида.
 */
export default function SunField() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || reducedMotion()) return

    const ctx = cv.getContext('2d', { alpha: true })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rand = (a, b) => a + Math.random() * (b - a)

    let W = 0
    let H = 0
    let dots = []
    let raf = 0
    let running = false
    const mouse = { x: -1e4, y: -1e4, active: false }

    const build = () => {
      const rect = cv.getBoundingClientRect()
      W = rect.width
      H = rect.height
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Плотность по площади, но не больше 110 частиц.
      const n = Math.round(Math.min(110, (W * H) / 13000))
      dots = Array.from({ length: n }, () => ({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(1, 3.2),
        vx: rand(-0.1, 0.1),
        vy: rand(-0.13, 0.05),
        base: rand(0.12, 0.42),
        tw: rand(0, Math.PI * 2),
        ts: rand(0.008, 0.02),
      }))
    }

    const frame = () => {
      ctx.clearRect(0, 0, W, H)

      for (const d of dots) {
        d.tw += d.ts
        d.x += d.vx
        d.y += d.vy

        // Мягкое расталкивание от курсора.
        if (mouse.active) {
          const dx = d.x - mouse.x
          const dy = d.y - mouse.y
          const dist2 = dx * dx + dy * dy
          const R = 140
          if (dist2 < R * R) {
            const dist = Math.sqrt(dist2) || 1
            const f = (1 - dist / R) * 0.85
            d.x += (dx / dist) * f
            d.y += (dy / dist) * f
          }
        }

        // Заворачиваем по краям.
        if (d.x < -10) d.x = W + 10
        if (d.x > W + 10) d.x = -10
        if (d.y < -10) d.y = H + 10
        if (d.y > H + 10) d.y = -10

        let a = d.base + Math.sin(d.tw) * 0.12
        let r = d.r

        // Вблизи курсора — ярче и крупнее.
        if (mouse.active) {
          const dx = d.x - mouse.x
          const dy = d.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 165) {
            const g = 1 - dist / 165
            a = Math.min(0.85, a + g * 0.5)
            r = d.r + g * 2
          }
        }

        const grd = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 4)
        grd.addColorStop(0, `rgba(255, 214, 92, ${a})`)
        grd.addColorStop(0.4, `rgba(224, 176, 74, ${a * 0.5})`)
        grd.addColorStop(1, 'rgba(224, 176, 74, 0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(d.x, d.y, r * 4, 0, Math.PI * 2)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(d.x, d.y, r * 0.7, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 236, 170, ${Math.min(0.95, a + 0.25)})`
        ctx.fill()
      }

      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    const onMove = (e) => {
      const rect = cv.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.active =
        mouse.x > -60 && mouse.x < W + 60 && mouse.y > -60 && mouse.y < H + 60
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = mouse.y = -1e4
    }

    build()

    // Не жжём кадры, когда герой прокручен за экран.
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0 }
    )
    io.observe(cv)

    const onResize = () => {
      build()
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)

    return () => {
      stop()
      io.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className="sunfield" aria-hidden="true" />
}
