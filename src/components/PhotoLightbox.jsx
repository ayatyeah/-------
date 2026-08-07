import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.4
const ZOOM_CLICK = 2.2

/** Расстояние между двумя касаниями — для pinch-зума на телефоне. */
const touchDist = (touches) => {
  const [a, b] = touches
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * Полноэкранный просмотр фото модели с зумом: колесо мыши/pinch — приближает,
 * перетаскивание — двигает приближенный кадр, клик — быстрый зум туда-сюда,
 * стрелки — листают галерею. Без сторонних библиотек: только CSS transform.
 */
export default function PhotoLightbox({ photos, startIndex = 0, alt, onClose }) {
  const { t } = useT()
  const [index, setIndex] = useState(startIndex)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const frameRef = useRef(null)
  const dragRef = useRef(null) // { startX, startY, panX, panY } во время перетаскивания
  const pinchRef = useRef(null) // { dist, zoom } во время pinch
  // Актуальные значения для обработчиков, которым нельзя пересоздаваться при
  // каждом изменении zoom/pan (нативный wheel-слушатель вешаем один раз).
  const stateRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } })
  useEffect(() => {
    stateRef.current = { zoom, pan }
  }, [zoom, pan])

  const go = (delta) => {
    setZoom(ZOOM_MIN)
    setPan({ x: 0, y: 0 })
    setIndex((i) => (i + delta + photos.length) % photos.length)
  }

  /** Не даёт утащить приближенное фото за край рамки в пустоту. */
  const clampPan = (x, y, z) => {
    const el = frameRef.current
    if (!el) return { x, y }
    const maxX = (el.clientWidth * (z - 1)) / 2
    const maxY = (el.clientHeight * (z - 1)) / 2
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }

  const applyZoom = (nextZoom, fromPan) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom))
    setZoom(z)
    setPan(z === ZOOM_MIN ? { x: 0, y: 0 } : clampPan((fromPan ?? stateRef.current.pan).x, (fromPan ?? stateRef.current.pan).y, z))
  }

  // Клавиатура: Esc закрывает, стрелки листают галерею.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowLeft' && photos.length > 1) return go(-1)
      if (e.key === 'ArrowRight' && photos.length > 1) return go(1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, onClose])

  /* Колесо мыши/трекпад — зум под курсором. React делает свои onWheel/
     onTouchMove пассивными по умолчанию, и preventDefault внутри них молча
     не срабатывает (страница ещё и скроллится вместе с зумом) — поэтому
     слушатель здесь настоящий, DOM-овый, с explicit passive: false. */
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      applyZoom(stateRef.current.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDoubleClick = () => {
    applyZoom(zoom > ZOOM_MIN ? ZOOM_MIN : ZOOM_CLICK)
  }

  // Перетаскивание мышью — только когда есть что двигать (zoom > 1).
  const onMouseDown = (e) => {
    if (zoom <= ZOOM_MIN) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }
  const onMouseMove = (e) => {
    if (!dragRef.current) return
    const d = dragRef.current
    setPan(clampPan(d.panX + (e.clientX - d.startX), d.panY + (e.clientY - d.startY), zoom))
  }
  const endDrag = () => {
    dragRef.current = null
  }

  /* Палец на телефоне: один — перетаскивание, два — pinch-зум. Отдельного
     preventDefault здесь не нужно — за это отвечает touch-action: none у
     .photo-lightbox-frame (см. styles.css), без риска той же ошибки, что и
     с колесом мыши. */
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchRef.current = { dist: touchDist(e.touches), zoom }
      dragRef.current = null
    } else if (e.touches.length === 1 && zoom > ZOOM_MIN) {
      const t0 = e.touches[0]
      dragRef.current = { startX: t0.clientX, startY: t0.clientY, panX: pan.x, panY: pan.y }
    }
  }
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const scale = touchDist(e.touches) / pinchRef.current.dist
      applyZoom(pinchRef.current.zoom * scale)
    } else if (e.touches.length === 1 && dragRef.current) {
      const t0 = e.touches[0]
      const d = dragRef.current
      setPan(clampPan(d.panX + (t0.clientX - d.startX), d.panY + (t0.clientY - d.startY), zoom))
    }
  }
  const onTouchEnd = () => {
    dragRef.current = null
    pinchRef.current = null
  }

  return (
    <div className="backdrop photo-lightbox-backdrop" onClick={onClose}>
      <div className="photo-lightbox" onClick={(e) => e.stopPropagation()}>
        <div
          ref={frameRef}
          className="photo-lightbox-frame"
          onDoubleClick={onDoubleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <img
            src={photos[index]}
            alt={alt}
            className="photo-lightbox-img"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: zoom > ZOOM_MIN ? 'grab' : 'zoom-in',
            }}
            draggable={false}
          />
        </div>

        {photos.length > 1 && (
          <>
            <button type="button" className="photo-lightbox-nav photo-lightbox-nav--prev" onClick={() => go(-1)} aria-label={t('prev')}>
              ‹
            </button>
            <button type="button" className="photo-lightbox-nav photo-lightbox-nav--next" onClick={() => go(1)} aria-label={t('next')}>
              ›
            </button>
          </>
        )}

        <div className="photo-lightbox-bar">
          {photos.length > 1 && (
            <span className="photo-lightbox-count">
              {index + 1} / {photos.length}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('close_x')}
          </button>
        </div>
      </div>
    </div>
  )
}
