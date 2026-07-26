import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch, useSite } from '../store'
import { Media, Loading, ErrorState, EmptyState } from '../components/ui'
import Reveal from '../components/Reveal'
import usePageMeta from '../hooks/usePageMeta'

export default function Catalog() {
  usePageMeta({
    title: 'Каталог техники',
    description:
      'Тракторы, комбайны, посевная и почвообрабатывающая техника собственного производства. Характеристики, лизинг и субсидии.',
  })
  const { openKP } = useSite()
  const [params, setParams] = useSearchParams()
  const cat = params.get('cat') || 'all'

  const cats = useFetch(() => api.categories(), [])
  // Все модели грузим один раз, фильтруем на клиенте — набор небольшой,
  // зато счётчики категорий всегда точные и переключение мгновенное.
  const models = useFetch(() => api.models(), [])

  const all = models.data ?? []
  const filtered = cat === 'all' ? all : all.filter((m) => m.cat === cat)

  const filters = [
    { id: 'all', name: 'Вся техника', count: all.length },
    ...(cats.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      count: all.filter((m) => m.cat === c.id).length,
    })),
  ]

  const pick = (id) => setParams(id === 'all' ? {} : { cat: id })

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">Продукция</span>
        <h1>Каталог техники</h1>
        <p className="lead" style={{ marginTop: 14 }}>
          {/* Без «слева»: на телефоне категории стоят сверху лентой. */}
          Выберите категорию — по каждой модели покажем характеристики и посчитаем цену.
        </p>
      </div>

      <div className="wrap" style={{ paddingBottom: 72 }}>
        <div className="catalog-layout">
          <aside className="filters">
            <div className="filters-title">Категории</div>
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
                <div className="catalog-count">Показано моделей: {filtered.length}</div>

                {filtered.length === 0 ? (
                  <EmptyState
                    title="В этой категории пока пусто"
                    text="Выберите другую категорию или посмотрите всю технику."
                  />
                ) : (
                  <div className="grid-2">
                    {filtered.map((m, i) => (
                      // key с категорией — при смене фильтра карточки появляются заново
                      <Reveal key={`${cat}-${m.id}`} delay={(i % 2) * 90}>
                        {/* Карточку целиком ссылкой сделать нельзя — внутри
                            кнопка «Получить КП». Поэтому ссылки — фото,
                            название и «Подробнее»: все ведут к модели и
                            доступны с клавиатуры. */}
                        <article className="card card--link" style={{ height: '100%' }}>
                          <Link to={`/catalog/${m.id}`} className="card-media" aria-label={m.name}>
                            {m.subsidized && <span className="tag tag-brass">Субсидируется</span>}
                            <Media src={m.photo} alt={m.name} stub={m.catName} />
                          </Link>
                          <div className="card-body">
                            <span className="card-kicker">{m.catName}</span>
                            <h3 className="card-title">
                              <Link to={`/catalog/${m.id}`} className="card-title-link">
                                {m.name}
                              </Link>
                            </h3>
                            <p className="card-text">{m.short}</p>
                            <div className="card-actions">
                              <Link to={`/catalog/${m.id}`} className="btn btn-primary btn-sm">
                                Подробнее
                              </Link>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openKP(m)}
                              >
                                Получить КП
                              </button>
                            </div>
                          </div>
                        </article>
                      </Reveal>
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
