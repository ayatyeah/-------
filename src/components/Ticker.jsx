import { useEffect, useState } from 'react'
import { api } from '../api'
import { useT } from '../i18n'

/**
 * Бегущая строка регионов присутствия — чистый CSS-keyframes.
 * Лента дублируется, поэтому прокрутка на -50% выглядит бесшовной.
 */
export default function Ticker() {
  const { t, td } = useT()
  const [regions, setRegions] = useState([])

  useEffect(() => {
    api
      .regions()
      .then((r) => setRegions(r.filter((x) => x !== 'Другой регион')))
      .catch(() => setRegions([]))
  }, [])

  if (regions.length === 0) return null

  const lane = [...regions, ...regions]

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-label">{t('ticker_label')}</div>
      <div className="ticker-mask">
        <div className="ticker-lane">
          {lane.map((r, i) => (
            <span className="ticker-item" key={i}>
              {td(r)}
              <i className="ticker-dot" />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
