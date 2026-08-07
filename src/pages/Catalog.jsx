import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch } from '../store'
import { Loading, ErrorState, EmptyState } from '../components/ui'
import ModelCard from '../components/ModelCard'
import SeasonBanner from '../components/SeasonBanner'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

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
  const filtered = cat === 'all' ? all : all.filter((m) => m.cat === cat)

  const filters = [
    { id: 'all', name: t('cat_all'), count: all.length },
    ...(cats.data ?? []).map((c) => ({
      id: c.id,
      name: td(c.name),
      count: all.filter((m) => m.cat === c.id).length,
    })),
  ]

  const pick = (id) => setParams(id === 'all' ? {} : { cat: id })

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
          </aside>

          <div>
            {models.loading && <Loading count={4} />}

            {models.error && <ErrorState message={models.error} onRetry={models.reload} />}

            {!models.loading && !models.error && (
              <>
                <div className="catalog-count">{t('cat_shown')} {filtered.length}</div>

                {filtered.length === 0 ? (
                  <EmptyState title={t('cat_empty_t')} text={t('cat_empty_p')} />
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
