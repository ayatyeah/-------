import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, clearToken, formatDateShort, getToken, setToken } from '../api'
import { useSite } from '../store'
import { ErrorState, EmptyState, Dialog } from '../components/ui'
import { ModelForm, NewsForm } from '../components/AdminForms'
import Icon from '../components/Icon'

const TABS = [
  { id: 'summary', name: 'Сводка' },
  { id: 'catalog', name: 'Каталог' },
  { id: 'services', name: 'Услуги' },
  { id: 'news', name: 'Новости' },
  { id: 'requests', name: 'Заявки' },
  { id: 'settings', name: 'Настройки' },
]

const STATUSES = ['Новая', 'В работе', 'Обработана']

/* ------------------------------ вход ------------------------------------ */

function Login({ onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token } = await api.login(password)
      setToken(token)
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login frame" onSubmit={submit}>
        <span className="kicker">Панель управления</span>
        <h1 style={{ marginTop: 12 }}>Вход в админку</h1>
        <p>Пароль по умолчанию: admin</p>

        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="pw">Пароль</label>
          <input
            id="pw"
            type="password"
            className="input"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Проверяем…' : 'Войти'}
        </button>

        <Link
          to="/"
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10, color: 'var(--text-3)' }}
        >
          ← На сайт
        </Link>
      </form>
    </div>
  )
}

/* ----------------------------- вкладка: сводка --------------------------- */

function SummaryTab({ summary, requests, onGoTab }) {
  const cards = [
    { v: summary?.models ?? '—', k: 'моделей в каталоге', tab: 'catalog' },
    { v: summary?.news ?? '—', k: 'статей и новостей', tab: 'news' },
    { v: summary?.requests ?? '—', k: 'заявок всего', tab: 'requests' },
    { v: summary?.newRequests ?? '—', k: 'новых заявок', tab: 'requests' },
  ]

  const latest = requests.slice(0, 5)

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Сводка</h1>
          <p className="admin-hint">Текущее состояние сайта и последние заявки.</p>
        </div>
      </div>

      <div className="admin-cards">
        {cards.map((c) => (
          <button
            type="button"
            className="admin-card"
            key={c.k}
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => onGoTab(c.tab)}
          >
            <div className="admin-card-v">{c.v}</div>
            <div className="admin-card-k">{c.k}</div>
          </button>
        ))}
      </div>

      <h3 style={{ fontSize: 19, marginBottom: 14 }}>Последние заявки</h3>
      {latest.length === 0 ? (
        <EmptyState title="Заявок пока нет" />
      ) : (
        <div className="admin-panel table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateShort(r.date)}</td>
                  <td>
                    <span className={`tag ${r.type === 'КП' ? 'tag-brass' : 'tag-outline'}`}>
                      {r.type}
                    </span>
                  </td>
                  <td>{r.fio}</td>
                  <td>{r.phone}</td>
                  <td>
                    <span className={`tag ${r.status === 'Новая' ? 'tag-green' : 'tag-muted'}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ---------------------------- вкладка: каталог --------------------------- */

function CatalogTab({ models, cats, reload }) {
  const { showToast } = useSite()
  const [editing, setEditing] = useState(null) // { model } | { model: null } для новой

  const save = async (data) => {
    if (editing.model) {
      await api.admin.updateModel(editing.model.id, data)
      showToast('Модель обновлена')
    } else {
      await api.admin.createModel(data)
      showToast('Модель добавлена в каталог')
    }
    reload()
  }

  const del = async (m) => {
    if (!confirm(`Удалить модель «${m.name}»?`)) return
    try {
      await api.admin.deleteModel(m.id)
      showToast('Модель удалена')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Каталог техники</h1>
          <p className="admin-hint">Модели, категории и признак субсидии.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ model: null })}>
          + Добавить модель
        </button>
      </div>

      {models.length === 0 ? (
        <EmptyState title="Каталог пуст" text="Добавьте первую модель." />
      ) : (
        <div className="admin-panel table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Категория</th>
                <th>Субсидия</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 500 }}>{m.name}</td>
                  <td style={{ color: 'var(--text-2)' }}>{m.catName}</td>
                  <td>
                    {m.subsidized ? (
                      <span className="tag tag-brass">Да</span>
                    ) : (
                      <span className="tag tag-muted">Нет</span>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${m.published ? 'tag-green' : 'tag-outline'}`}>
                      {m.published ? 'Опубликовано' : 'Черновик'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing({ model: m })}
                      >
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: '#a33' }}
                        onClick={() => del(m)}
                      >
                        Удал.
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ModelForm
          model={editing.model}
          cats={cats}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/* ---------------------------- вкладка: услуги ---------------------------- */

function ServicesTab({ services, reload }) {
  const { showToast } = useSite()
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ title: '', text: '', note: '' })
  const [saving, setSaving] = useState(false)

  const open = (s) => {
    setEditing(s)
    setF({ title: s.title, text: s.text, note: s.note })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.admin.updateService(editing.id, f)
      showToast('Услуга обновлена')
      setEditing(null)
      reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Услуги</h1>
          <p className="admin-hint">Блок «Услуги» на главной. Набор фиксирован — тексты меняются.</p>
        </div>
      </div>

      <div className="admin-panel table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Услуга</th>
              <th>Описание</th>
              <th>Подпись</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{s.title}</td>
                <td style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 460 }}>{s.text}</td>
                <td style={{ color: 'var(--text-3)', fontSize: 13, whiteSpace: 'nowrap' }}>
                  {s.note}
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(s)}>
                      Изм.
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Dialog title={`Услуга: ${editing.title}`} onClose={() => setEditing(null)} wide>
          <form onSubmit={save}>
            <div className="field">
              <label htmlFor="sv_title">Заголовок</label>
              <input
                id="sv_title"
                className="input"
                required
                value={f.title}
                onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="sv_text">Описание</label>
              <textarea
                id="sv_text"
                className="input"
                style={{ minHeight: 120 }}
                value={f.text}
                onChange={(e) => setF((p) => ({ ...p, text: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="sv_note">Подпись под текстом</label>
              <input
                id="sv_note"
                className="input"
                value={f.note}
                onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))}
                placeholder="Короткий факт: «2 года гарантии»"
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
                Отмена
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

/* ---------------------------- вкладка: новости --------------------------- */

function NewsTab({ news, reload }) {
  const { showToast } = useSite()
  const [editing, setEditing] = useState(null)

  const save = async (data) => {
    if (editing.item) {
      await api.admin.updateNews(editing.item.id, data)
      showToast('Статья обновлена')
    } else {
      await api.admin.createNews(data)
      showToast('Статья создана')
    }
    reload()
  }

  const del = async (n) => {
    if (!confirm(`Удалить статью «${n.title}»?`)) return
    try {
      await api.admin.deleteNews(n.id)
      showToast('Статья удалена')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Новости и статьи</h1>
          <p className="admin-hint">Публикации в разделе «Новости».</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ item: null })}>
          + Создать статью
        </button>
      </div>

      {news.length === 0 ? (
        <EmptyState title="Статей пока нет" text="Создайте первую публикацию." />
      ) : (
        <div className="admin-panel table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Заголовок</th>
                <th>Дата</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {news.map((n) => (
                <tr key={n.id}>
                  <td style={{ fontWeight: 500 }}>{n.title}</td>
                  <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {formatDateShort(n.date)}
                  </td>
                  <td>
                    <span className={`tag ${n.published ? 'tag-green' : 'tag-outline'}`}>
                      {n.published ? 'Опубликовано' : 'Черновик'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing({ item: n })}
                      >
                        Изм.
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: '#a33' }}
                        onClick={() => del(n)}
                      >
                        Удал.
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <NewsForm item={editing.item} onSave={save} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

/* ------------------------- ИИ-анализатор лидов --------------------------- */

/**
 * Разбирает заявки и говорит, за какую браться первой.
 * Если ИИ не подключён, сервер считает по правилам и честно об этом пишет.
 */
function LeadAnalyzer({ requests, byId, setById }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [aiOn, setAiOn] = useState(null)

  useEffect(() => {
    api.ai
      .status()
      .then((s) => setAiOn(s.enabled))
      .catch(() => setAiOn(false))
  }, [])

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.ai.analyzeLeads()
      setResult(res)
      // Раскладываем оценки по id — таблица заявок подсветит приоритет.
      setById(Object.fromEntries(res.leads.map((l) => [l.id, l])))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-panel-admin">
      <div className="ai-panel-head">
        <div className="ai-badge">
          <Icon name="spark" size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <h3>ИИ-анализатор лидов</h3>
          <p>
            {aiOn === false
              ? 'ИИ не подключён — оценка по правилам (тип заявки, модель, субсидия, свежесть).'
              : 'Оценит заявки и подскажет, кому звонить первым.'}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy || !requests.length}>
          {busy ? 'Анализирую…' : result ? 'Пересчитать' : 'Анализировать'}
        </button>
      </div>

      {error && <div className="form-error" style={{ marginTop: 14 }}>{error}</div>}

      {result && (
        <>
          <div className="ai-overview">
            <Icon name="spark" size={14} />
            <span>{result.overview}</span>
          </div>

          {/* Откуда взялись оценки. Без этой строки непонятно, почему
              «Пересчитать» иногда срабатывает мгновенно. */}
          <div className="ai-source">
            {result.fromCache > 0 && (
              <span>
                Из кэша: {result.fromCache} — эти заявки не менялись с прошлого разбора,
                ИИ их не пересчитывал.
              </span>
            )}
            {result.analyzed > 0 && <span>Разобрано заново: {result.analyzed}.</span>}
            {result.leads.some((l) => l.byRules) && (
              <span>
                Оценок по правилам: {result.leads.filter((l) => l.byRules).length} — ИИ пропустил
                эти заявки, они посчитаны без него.
              </span>
            )}
          </div>

          <div className="ai-leads">
            {result.leads.map((l) => {
              const r = requests.find((x) => x.id === l.id)
              return (
                <div className={`ai-lead ai-lead--${prioClass(l.priority)}`} key={l.id}>
                  <div className="ai-lead-score">{l.score}</div>
                  <div className="ai-lead-main">
                    <div className="ai-lead-top">
                      <span className={`tag ${prioTag(l.priority)}`}>{l.priority}</span>
                      <b>{r?.fio ?? l.id}</b>
                      {r && <span className="ai-lead-meta">{r.meta}</span>}
                    </div>
                    <div className="ai-lead-sum">
                      {l.summary}
                      {l.byRules && <span className="ai-lead-rules">по правилам</span>}
                    </div>
                    <div className="ai-lead-act">
                      <Icon name="bolt" size={13} />
                      {l.action}
                    </div>
                  </div>
                  {r && (
                    <a className="ai-lead-call" href={`tel:${r.phone.replace(/\s/g, '')}`}>
                      {r.phone}
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const prioClass = (p) => (p === 'Горячий' ? 'hot' : p === 'Тёплый' ? 'warm' : 'cold')
const prioTag = (p) =>
  p === 'Горячий' ? 'tag-brass' : p === 'Тёплый' ? 'tag-green' : 'tag-muted'

/* ---------------------------- вкладка: заявки ---------------------------- */

function RequestsTab({ requests, reload }) {
  const { showToast } = useSite()
  // Оценки ИИ по id заявки — подсвечивают строки таблицы.
  const [scored, setScored] = useState({})

  const setStatus = async (r, status) => {
    try {
      await api.admin.setRequestStatus(r.id, status)
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  const del = async (r) => {
    if (!confirm(`Удалить заявку от «${r.fio}»?`)) return
    try {
      await api.admin.deleteRequest(r.id)
      showToast('Заявка удалена')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Заявки</h1>
          <p className="admin-hint">
            Входящие запросы на КП и заказы звонка. Меняйте статус по мере обработки.
          </p>
        </div>
      </div>

      {requests.length > 0 && (
        <LeadAnalyzer requests={requests} byId={scored} setById={setScored} />
      )}

      {requests.length === 0 ? (
        <EmptyState title="Заявок пока нет" text="Здесь появятся запросы с сайта." />
      ) : (
        <div className="admin-panel table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Модель / регион</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className={scored[r.id] ? `row-${prioClass(scored[r.id].priority)}` : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateShort(r.date)}</td>
                  <td>
                    <span className={`tag ${r.type === 'КП' ? 'tag-brass' : 'tag-outline'}`}>
                      {r.type}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{r.fio}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a
                      href={`tel:${r.phone.replace(/\s/g, '')}`}
                      style={{ borderBottom: '1px solid var(--rule-strong)' }}
                    >
                      {r.phone}
                    </a>
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>
                    {r.meta}
                    {r.comment && (
                      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                        «{r.comment}»
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ minWidth: 130, padding: '7px 9px' }}
                      value={r.status}
                      onChange={(e) => setStatus(r, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: '#a33' }}
                      onClick={() => del(r)}
                    >
                      Удал.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* --------------------------- вкладка: настройки -------------------------- */

function SettingsTab() {
  const { settings, setSettings, showToast } = useSite()
  const [f, setF] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Настройки могут догрузиться после монтирования вкладки.
  useEffect(() => setF(settings), [settings])

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.admin.saveSettings(f)
      setSettings((prev) => ({ ...prev, ...saved }))
      showToast('Настройки сохранены')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const field = (key, label, type = 'input') => (
    <div className="field" key={key}>
      <label htmlFor={`s_${key}`}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          id={`s_${key}`}
          className="input"
          value={f[key] ?? ''}
          onChange={(e) => upd(key, e.target.value)}
        />
      ) : (
        <input
          id={`s_${key}`}
          className="input"
          value={f[key] ?? ''}
          onChange={(e) => upd(key, e.target.value)}
        />
      )}
    </div>
  )

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Настройки</h1>
          <p className="admin-hint">Контакты, ссылки и тексты главной страницы.</p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="admin-settings">
        <div className="admin-settings-panel">
          <h3>Контактные данные</h3>
          {field('phone', 'Телефон')}
          {field('email', 'E-mail')}
          {field('address', 'Адрес')}
          {field('hours', 'Часы работы')}
        </div>

        <div className="admin-settings-panel">
          <h3>Внешние ссылки</h3>
          {field('leasing_url', 'КазАгроФинанс (лизинг)')}
          {field('subsidy_url', 'ГосАгро (субсидии)')}
        </div>

        <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
          <h3>Тексты главной</h3>
          {field('hero_title', 'Заголовок героя')}
          {field('hero_subtitle', 'Подзаголовок', 'textarea')}
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить изменения'}
      </button>
    </>
  )
}

/* ------------------------------- оболочка -------------------------------- */

export default function Admin() {
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(() => !!getToken())
  const [tab, setTab] = useState('summary')

  const [models, setModels] = useState([])
  const [cats, setCats] = useState([])
  const [news, setNews] = useState([])
  const [services, setServices] = useState([])
  const [requests, setRequests] = useState([])
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, c, n, r, s, sv] = await Promise.all([
        api.admin.models(),
        api.categories(),
        api.admin.news(),
        api.admin.requests(),
        api.admin.summary(),
        api.services(),
      ])
      setModels(m)
      setCats(c)
      setNews(n)
      setRequests(r)
      setSummary(s)
      setServices(sv)
    } catch (e) {
      // Токен протух или сервер отверг — возвращаем на экран входа.
      if (!getToken()) setAuthed(false)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  const logout = () => {
    clearToken()
    setAuthed(false)
  }

  if (!authed) {
    return (
      <Login
        onDone={() => {
          setAuthed(true)
          setTab('summary')
        }}
      />
    )
  }

  const newCount = requests.filter((r) => r.status === 'Новая').length

  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="admin-brand">
          <span className="admin-badge">СХМ</span>
          Админка
        </div>

        <div className="admin-tabs">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`admin-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.name}
              {t.id === 'requests' && newCount > 0 && (
                <span className="admin-tab-count">{newCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="admin-side-foot">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
            ← На сайт
          </button>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </aside>

      <div className="admin-main">
        {loading && (
          <div className="skeleton" style={{ height: 300, border: '1px solid var(--rule)' }} />
        )}

        {!loading && error && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && (
          <>
            {tab === 'summary' && (
              <SummaryTab summary={summary} requests={requests} onGoTab={setTab} />
            )}
            {tab === 'catalog' && <CatalogTab models={models} cats={cats} reload={load} />}
            {tab === 'services' && <ServicesTab services={services} reload={load} />}
            {tab === 'news' && <NewsTab news={news} reload={load} />}
            {tab === 'requests' && <RequestsTab requests={requests} reload={load} />}
            {tab === 'settings' && <SettingsTab />}
          </>
        )}
      </div>
    </div>
  )
}
