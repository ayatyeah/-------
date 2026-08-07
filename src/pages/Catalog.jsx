import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch } from '../store'
import { Loading, ErrorState, EmptyState } from '../components/ui'
import ModelCard from '../components/ModelCard'
import SeasonBanner from '../components/SeasonBanner'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'
import { buildFacets, matchesFacets, matchesQuery } from '../lib/catalogFilters'

export default function Catalog() {
  usePageMeta({
    title: 'Каталог сельхозтехники — купить трактор, комбайн, сеялку',
    description:
      'Каталог агротехники завода СХМ Агро: тракторы, зерноуборочные комбайны, сеялки, посевные комплексы и бороны. Характеристики, наличие, лизинг и субсидии. Купить напрямую у производителя в Казахстане.',
  })
  const { t, td } = useT()
  const [params, setParams] = useSearchParams()
  const cat = params.get('cat') || 'all'

  const cats = useFetch(() => api.categories(), [])
  // Все модели грузим один раз, фильтруем на клиенте — набор небольшой,
  // зато счётчики категорий всегда точные и переключение мгновенное.
  const models = useFetch(() => api.models(), [])

  const all = models.data ?? []
  const byCat = cat === 'all' ? all : all.filter((m) => m.cat === cat)

  const filters = [
    { id: 'all', name: t('cat_all'), count: all.length },
    ...(cats.data ?? []).map((c) => ({
      id: c.id,
      name: td(c.name),
      count: all.filter((m) => m.cat === c.id).length,
    })),
  ]

  const pick = (id) => {
    setParams(id === 'all' ? {} : { cat: id })
    setActiveFacets({})
  }

  // Текстовый поиск и признаки «субсидируется»/«в наличии» — по всему
  // каталогу сразу. Разрезы по характеристикам считаются от byCat: вне
  // категории параметры разных типов техники всё равно не сравнить, и
  // список фильтров каждый раз пересобирается под выбранную категорию.
  const [q, setQ] = useState('')
  const [onlySubsidized, setOnlySubsidized] = useState(false)
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [activeFacets, setActiveFacets] = useState({})
  const facets = useMemo(() => buildFacets(byCat), [byCat])
  // Категория сменилась — старые разрезы («Мощность двигателя» у трактора)
  // к сеялке уже не относятся, оставлять их включёнными означало бы молча
  // фильтровать по несуществующему параметру.
  useEffect(() => setActiveFacets({}), [cat])

  const filtered = byCat.filter(
    (m) =>
      matchesQuery(m, q) &&
      (!onlySubsidized || m.subsidized) &&
      (!onlyInStock || m.badge === 'in_stock') &&
      matchesFacets(m, activeFacets)
  )

  const setRangeFacet = (key, patch) =>
    setActiveFacets((f) => ({ ...f, [key]: { kind: 'range', ...f[key], ...patch } }))
  const toggleSetFacet = (key, value) =>
    setActiveFacets((f) => {
      const prevSelected = f[key]?.selected ?? new Set()
      const selected = new Set(prevSelected)
      if (selected.has(value)) selected.delete(value)
      else selected.add(value)
      return { ...f, [key]: { kind: 'set', selected } }
    })
  const clearFacet = (key) =>
    setActiveFacets((f) => {
      const next = { ...f }
      delete next[key]
      return next
    })
  const facetsActive = Object.keys(activeFacets).length > 0 || onlySubsidized || onlyInStock || q.trim()

  /* Адрес карточки модели с сохранением выбранной категории.

     Раньше из карточки возвращались в каталог без фильтра: посетитель
     отбирал «Посевную технику», открывал одну сеялку, жал «назад» — и
     получал весь каталог заново. На сорока моделях это означает искать
     сначала, и на этом уходят с сайта.

     Категорию кладём в адрес, а не в состояние роутера, сознательно: так
     фильтр переживает обновление страницы и остаётся в ссылке, которой
     делятся с агрономом или бухгалтером. */
  const toModel = (id) => `/catalog/${id}${cat !== 'all' ? `?cat=${cat}` : ''}`

  return (
    <main className="route-fade">
      <SeasonBanner />

      <div className="wrap page-head">
        <span className="kicker">{t('cat_kicker')}</span>
        <h1>{t('cat_title')}</h1>
        <p className="lead" style={{ marginTop: 14 }}>
          {/* Без «слева»: на телефоне категории стоят сверху лентой. */}
          {t('cat_lead')}
        </p>
      </div>

      <div className="wrap" style={{ paddingBottom: 72 }}>
        <div className="catalog-layout">
          <aside className="filters">
            <input
              type="search"
              className="input"
              style={{ marginBottom: 18 }}
              placeholder={t('cat_search_ph')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('cat_search_ph')}
            />

            <div className="filters-title">{t('cat_filters')}</div>
            <div className="filters-list">
              {filters.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`filter${cat === f.id ? ' active' : ''}`}
                  onClick={() => pick(f.id)}
                  aria-pressed={cat === f.id}
                >
                  <span>{f.name}</span>
                  <span className="filter-count">{f.count}</span>
                </button>
              ))}
            </div>

            <label className="check" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={onlySubsidized} onChange={(e) => setOnlySubsidized(e.target.checked)} />
              {t('subsidized')}
            </label>
            <label className="check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
              {t('badge_in_stock')}
            </label>

            {/* Разрезы по характеристикам категории (задача 9) — набор
                параметров пересобирается под выбранную категорию, поэтому
                у «Всей техники» их обычно нет: мощность трактора и ширина
                захвата сеялки — разные вещи, сравнивать нечего. */}
            {facets.length > 0 && (
              <div className="filter-facets">
                <div className="filters-title" style={{ marginTop: 22 }}>
                  {t('cat_specs_filter')}
                </div>
                {facets.map((facet) => (
                  <div className="facet" key={facet.key}>
                    <div className="facet-head">
                      <span>{td(facet.key)}</span>
                      {activeFacets[facet.key] && (
                        <button type="button" className="facet-clear" onClick={() => clearFacet(facet.key)}>
                          {t('cat_facet_reset')}
                        </button>
                      )}
                    </div>
                    {facet.kind === 'range' ? (
                      <div className="facet-range">
                        <input
                          type="number"
                          className="input"
                          placeholder={String(facet.min)}
                          value={activeFacets[facet.key]?.min ?? ''}
                          onChange={(e) =>
                            setRangeFacet(facet.key, { min: e.target.value === '' ? undefined : Number(e.target.value) })
                          }
                        />
                        <span>—</span>
                        <input
                          type="number"
                          className="input"
                          placeholder={String(facet.max)}
                          value={activeFacets[facet.key]?.max ?? ''}
                          onChange={(e) =>
                            setRangeFacet(facet.key, { max: e.target.value === '' ? undefined : Number(e.target.value) })
                          }
                        />
                      </div>
                    ) : (
                      <div className="facet-values">
                        {facet.values.map((v) => (
                          <label className="check facet-value" key={v}>
                            <input
                              type="checkbox"
                              checked={!!activeFacets[facet.key]?.selected?.has(v)}
                              onChange={() => toggleSetFacet(facet.key, v)}
                            />
                            {v}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {facetsActive && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 16 }}
                onClick={() => {
                  setQ('')
                  setOnlySubsidized(false)
                  setOnlyInStock(false)
                  setActiveFacets({})
                }}
              >
                {t('cat_reset_all')}
              </button>
            )}
          </aside>

          <div>
            {models.loading && <Loading count={4} />}

            {models.error && <ErrorState message={models.error} onRetry={models.reload} />}

            {!models.loading && !models.error && (
              <>
                <div className="catalog-count">{t('cat_shown')} {filtered.length}</div>

                {filtered.length === 0 ? (
                  <EmptyState
                    title={facetsActive ? t('cat_empty_filtered_t') : t('cat_empty_t')}
                    text={facetsActive ? t('cat_empty_filtered_p') : t('cat_empty_p')}
                  />
                ) : (
                  <div className="grid-2">
                    {filtered.map((m, i) => (
                      // key с категорией — при смене фильтра карточки появляются заново
                      <ModelCard key={`${cat}-${m.id}`} model={m} href={toModel(m.id)} delay={(i % 2) * 90} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
