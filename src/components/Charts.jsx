import { useId } from 'react'

/**
 * Лёгкие SVG-графики без зависимостей — для дашборда в админке.
 * Ни один сторонний пакет графиков сюда не тащим: три несложных вида
 * (линия, столбцы, кольцо) не стоят полноценной библиотеки в бандле, а
 * viewBox + preserveAspectRatio="none" сами по себе дают отзывчивость.
 */

const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n)

/** Заливка + линия. values — числа по дням месяца, labels — подписи под ними. */
export function LineChart({ values, labels, color = 'var(--green-600)', height = 140 }) {
  const gid = useId()
  const n = values.length
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1

  const x = (i) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const y = (v) => 96 - ((v - min) / span) * 88

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)},${y(v)}`).join(' ')
  const area = `M ${x(0)},96 ${values.map((v, i) => `L ${x(i)},${y(v)}`).join(' ')} L ${x(n - 1)},96 Z`

  // Показываем не каждую дату — на 31 дне подписи бы слиплись. Первая,
  // последняя и несколько равномерно между ними.
  const labelStep = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="chart-box">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: '100%' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels">
        {labels.map((l, i) =>
          i === 0 || i === n - 1 || i % labelStep === 0 ? (
            <span key={l} style={{ left: `${x(i)}%` }}>
              {l}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

/** Столбцы из двух слоёв (например, КП снизу, звонки сверху) по дням месяца. */
export function StackedBarChart({ rows, keys, colors, labels, height = 140 }) {
  const max = Math.max(1, ...rows.map((r) => keys.reduce((s, k) => s + (r[k] || 0), 0)))
  const n = rows.length
  const barW = Math.min(3.2, (100 / n) * 0.62)
  const labelStep = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="chart-box">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: '100%' }}>
        {rows.map((r, i) => {
          const cx = (n <= 1 ? 50 : (i / (n - 1)) * 100) - barW / 2
          let acc = 0
          return keys.map((k, ki) => {
            const v = r[k] || 0
            const h = (v / max) * 88
            const barY = 96 - acc - h
            acc += h
            if (!v) return null
            return (
              <rect
                key={k}
                x={cx}
                y={barY}
                width={barW}
                height={h}
                fill={colors[ki]}
                rx="0.6"
              />
            )
          })
        })}
      </svg>
      <div className="chart-labels">
        {labels.map((l, i) =>
          i === 0 || i === n - 1 || i % labelStep === 0 ? (
            <span key={l} style={{ left: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%` }}>
              {l}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

/** Кольцевая диаграмма долей с легендой. segments: [{ label, value, color }]. */
export function Donut({ segments, size = 130 }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const r = 40
  const c = 2 * Math.PI * r
  let acc = 0

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--rule)" strokeWidth="16" />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const frac = s.value / total
              const dash = frac * c
              const offset = -acc * c
              acc += frac
              return (
                <circle
                  key={s.label}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={offset}
                  transform="rotate(-90 50 50)"
                />
              )
            })}
        <text x="50" y="47" textAnchor="middle" className="donut-total-v">
          {fmt(total)}
        </text>
        <text x="50" y="61" textAnchor="middle" className="donut-total-k">
          всего
        </text>
      </svg>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            {s.label} — {fmt(s.value)}
          </li>
        ))}
      </ul>
    </div>
  )
}
