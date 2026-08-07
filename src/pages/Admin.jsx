import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, clearToken, formatDateShort, getToken, setToken } from '../api'
import { useSite } from '../store'
import { ErrorState, EmptyState, Dialog } from '../components/ui'
import { ModelForm, NewsForm } from '../components/AdminForms'
import CatalogImportPanel from '../components/AdminCatalogImport'
import MediaPicker from '../components/MediaPicker'
import {
  CategoriesPanel,
  ServicesPanel,
  StatsPanel,
  CertsPanel,
  ServiceCentersPanel,
  PhotosPanel,
  RegionsPanel,
  PasswordPanel,
  BackupPanel,
} from '../components/AdminPanels'
import Icon from '../components/Icon'
import { LineChart, StackedBarChart, Donut, BarList, FunnelChart } from '../components/Charts'
import usePageMeta from '../hooks/usePageMeta'

const TABS = [
  { id: 'summary', name: 'Сводка' },
  { id: 'catalog', name: 'Каталог' },
  { id: 'services', name: 'Услуги' },
  { id: 'news', name: 'Новости' },
  { id: 'requests', name: 'Заявки' },
  // Вкладка появилась вместе с правкой показателей и сертификатов: раньше
  // и то и другое лежало в коде и менялось только через разработчика.
  { id: 'main', name: 'Главная' },
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

/** «5820000» мс → «1 дн 14 ч»/«2 ч 30 мин»/«12 мин». */
function formatDuration(ms) {
  if (ms == null) return '—'
  const totalMin = Math.round(ms / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const min = totalMin % 60
  if (days > 0) return `${days} дн ${hours} ч`
  if (hours > 0) return `${hours} ч ${min} мин`
  return `${min} мин`
}

/** «2026-08» → «Август 2026». */
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number)
  const s = new Date(y, mo - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** «2026-08» ± 1 месяц → «2026-09» / «2026-07», с переходом через год. */
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** «2026-08-03» → «3» — короткая подпись начала недели под графиком. */
const weekLabel = (iso) => String(Number(iso.slice(-2)))

/**
 * Помесячный дашборд: KPI-карточки и графики. Диапазон месяцев, между
 * которыми можно переключаться, приходит от сервера (availableMonths) —
 * там же, где реально есть данные (заявки или визиты), плюс текущий месяц.
 */
function DashboardSection({ summary, onMonthChange }) {
  const [busy, setBusy] = useState(false)
  const dash = summary?.dashboard
  const months = summary?.availableMonths || []
  if (!dash) return null

  const idx = months.indexOf(dash.month)
  const canPrev = idx > 0
  const canNext = idx !== -1 && idx < months.length - 1

  const go = async (delta) => {
    setBusy(true)
    try {
      await onMonthChange(shiftMonth(dash.month, delta))
    } finally {
      setBusy(false)
    }
  }

  const days = dash.days
  const dayLabels = days.map((d) => String(Number(d.date.slice(-2))))

  // Конверсия начатых форм в реально отправленные заявки — начатых бывает
  // меньше, чем заявок (звонок можно оставить и без формы), тогда просто не
  // показываем процент, чтобы не вводить в заблуждение числом больше 100%.
  const formConvPct =
    dash.formStarts > 0 && dash.formStarts >= dash.requests
      ? Math.round((dash.requests / dash.formStarts) * 100)
      : null

  const kpis = [
    { v: dash.requests, k: 'заявок за месяц' },
    { v: dash.kp, k: 'запросов КП' },
    { v: dash.calls, k: 'заявок на звонок' },
    { v: dash.visits, k: 'визитов на сайт' },
    {
      v: formatDuration(dash.avgResolutionMs),
      k: `среднее время обработки${dash.resolvedCount ? ` (${dash.resolvedCount})` : ''}`,
      small: true,
    },
    { v: dash.modelViewsTotal, k: 'просмотров карточек моделей' },
    {
      v: dash.formStarts,
      k: `начатых форм${formConvPct != null ? ` (конверсия ${formConvPct}%)` : ''}`,
      small: formConvPct != null,
    },
    { v: dash.aiChatOpens, k: 'открытий AI-чата' },
  ]

  return (
    <>
      <div className="dash-nav">
        <button type="button" className="btn btn-ghost btn-sm" disabled={!canPrev || busy} onClick={() => go(-1)}>
          ← Пред. месяц
        </button>
        <h3>{monthLabel(dash.month)}</h3>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!canNext || busy} onClick={() => go(1)}>
          След. месяц →
        </button>
      </div>

      <div className="admin-cards" style={{ opacity: busy ? 0.6 : 1 }}>
        {kpis.map((c) => (
          <div className="admin-card" key={c.k}>
            <div className="admin-card-v" style={c.small ? { fontSize: 23 } : undefined}>
              {c.v}
            </div>
            <div className="admin-card-k">{c.k}</div>
          </div>
        ))}
      </div>

      <div className="dash-charts" style={{ opacity: busy ? 0.6 : 1 }}>
        <div className="admin-panel dash-chart-card">
          <h4>Визиты по дням</h4>
          <LineChart values={days.map((d) => d.visits)} labels={dayLabels} color="var(--brass-500)" />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>Заявки по дням</h4>
          <StackedBarChart
            rows={days}
            keys={['kp', 'calls']}
            colors={['var(--green-600)', 'var(--brass-500)']}
            labels={dayLabels}
          />
          <div className="chart-legend">
            <span>
              <i style={{ background: 'var(--green-600)' }} /> КП
            </span>
            <span>
              <i style={{ background: 'var(--brass-500)' }} /> Звонок
            </span>
          </div>
        </div>

        <div className="admin-panel dash-chart-card dash-chart-card--donut">
          <h4>Статусы заявок за месяц</h4>
          <Donut
            segments={[
              { label: 'Новая', value: dash.statusCounts['Новая'] || 0, color: 'var(--green-400)' },
              { label: 'В работе', value: dash.statusCounts['В работе'] || 0, color: 'var(--brass-400)' },
              { label: 'Обработана', value: dash.statusCounts['Обработана'] || 0, color: 'var(--green-800)' },
            ]}
          />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>Заявки по неделям</h4>
          <StackedBarChart
            rows={dash.weeks}
            keys={['kp', 'calls']}
            colors={['var(--green-600)', 'var(--brass-500)']}
            labels={dash.weeks.map((w) => weekLabel(w.weekStart))}
          />
          <div className="chart-legend">
            <span>
              <i style={{ background: 'var(--green-600)' }} /> КП
            </span>
            <span>
              <i style={{ background: 'var(--brass-500)' }} /> Звонок
            </span>
          </div>
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>Воронка по статусам</h4>
          <FunnelChart
            stages={[
              { label: 'Новая', value: dash.statusCounts['Новая'] || 0, color: 'var(--green-400)' },
              { label: 'В работе', value: dash.statusCounts['В работе'] || 0, color: 'var(--brass-400)' },
              { label: 'Обработана', value: dash.statusCounts['Обработана'] || 0, color: 'var(--green-800)' },
            ]}
          />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>Просмотры карточек моделей</h4>
          <BarList items={dash.modelViews.map((m) => ({ id: m.id, label: m.name, value: m.count }))} color="var(--brass-500)" />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>По моделям (запросы КП)</h4>
          <BarList items={dash.byModel.map((m) => ({ id: m.id, label: m.name, value: m.count }))} color="var(--green-600)" />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>По регионам</h4>
          <BarList items={dash.byRegion.map((r) => ({ label: r.region, value: r.count }))} color="var(--brass-500)" />
        </div>

        <div className="admin-panel dash-chart-card">
          <h4>По источникам</h4>
          <BarList items={dash.bySource.map((s) => ({ label: s.source, value: s.count }))} color="var(--green-800)" />
        </div>
      </div>
    </>
  )
}

function SummaryTab({ summary, requests, onGoTab, onMonthChange }) {
  const totals = [
    { v: summary?.models ?? '—', k: 'моделей в каталоге', tab: 'catalog' },
    { v: summary?.news ?? '—', k: 'статей и новостей', tab: 'news' },
    { v: summary?.requests ?? '—', k: 'заявок всего', tab: 'requests' },
    { v: summary?.newRequests ?? '—', k: 'новых заявок', tab: 'requests' },
  ]

  const latest = requests.slice(0, 5)

  // Горячие лиды по сохранённой оценке ИИ — необработанные заявки с
  // приоритетом «Горячий», начиная с самой перспективной. Оценки берутся из
  // заявок напрямую (см. server/ai.js setAiVerdicts), поэтому список виден
  // сразу при заходе в «Сводку», без похода во вкладку «Заявки».
  const hotLeads = requests
    .filter((r) => r.aiPriority === 'Горячий' && r.status !== 'Обработана')
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0))
    .slice(0, 5)

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Сводка</h1>
          <p className="admin-hint">Текущее состояние сайта, помесячная аналитика и последние заявки.</p>
        </div>
      </div>

      <div className="admin-cards">
        {totals.map((c) => (
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

      <DashboardSection summary={summary} onMonthChange={onMonthChange} />

      {hotLeads.length > 0 && (
        <>
          <h3 style={{ fontSize: 19, marginBottom: 14, marginTop: 8 }}>🔥 Горячие лиды</h3>
          <div className="admin-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {hotLeads.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => onGoTab('requests')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  cursor: 'pointer',
                }}
              >
                <span className="tag tag-brass" style={{ flexShrink: 0 }}>{r.aiScore}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{r.fio}</b>
                  {r.meta && r.meta !== '—' && (
                    <span style={{ color: 'var(--text-3)' }}> · {r.meta}</span>
                  )}
                  {r.aiAction && (
                    <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{r.aiAction}</div>
                  )}
                </span>
                <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.phone}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h3 style={{ fontSize: 19, marginBottom: 14, marginTop: 8 }}>Последние заявки</h3>
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
                  <td data-label="Дата">{formatDateShort(r.date)}</td>
                  <td data-label="Тип">
                    <span className={`tag ${r.type === 'КП' ? 'tag-brass' : 'tag-outline'}`}>
                      {r.type}
                    </span>
                  </td>
                  <td className="card-title">{r.fio}</td>
                  <td data-label="Телефон">{r.phone}</td>
                  <td data-label="Статус">
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
  const [importing, setImporting] = useState(false)

  /* Перестановка моделей. Раньше порядок задавался при создании и больше
     не менялся: новая модель всегда падала в конец каталога, а поднять её
     на витрину было нельзя. */
  const move = async (index, шаг) => {
    const j = index + шаг
    if (j < 0 || j >= models.length) return
    const next = [...models]
    ;[next[index], next[j]] = [next[j], next[index]]
    try {
      await api.admin.reorderModels(next.map((m) => m.id))
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

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
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>
            AI-импорт из файла
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ model: null })}>
            + Добавить модель
          </button>
        </div>
      </div>

      {models.length === 0 ? (
        <EmptyState title="Каталог пуст" text="Добавьте первую модель." />
      ) : (
        <div className="admin-panel table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Порядок</th>
                <th>Название</th>
                <th>Категория</th>
                <th>Субсидия</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={m.id}>
                  <td className="card-order">
                    <div className="spec-move">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        title="Поднять"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === models.length - 1}
                        title="Опустить"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="card-title" style={{ fontWeight: 500 }}>
                    {m.photo && <img src={m.photo} alt="" className="admin-thumb" />}
                    {m.name}
                  </td>
                  <td data-label="Категория" style={{ color: 'var(--text-2)' }}>{m.catName}</td>
                  <td data-label="Субсидия">
                    {m.subsidized ? (
                      <span className="tag tag-brass">Да</span>
                    ) : (
                      <span className="tag tag-muted">Нет</span>
                    )}
                  </td>
                  <td data-label="Статус">
                    <span className={`tag ${m.published ? 'tag-green' : 'tag-outline'}`}>
                      {m.published ? 'Опубликовано' : 'Черновик'}
                    </span>
                  </td>
                  <td className="card-actions">
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

      {/* Категории прямо здесь же: заводить отдельную вкладку ради четырёх
          строк незачем, а рядом с каталогом им самое место. */}
      <div style={{ marginTop: 40 }}>
        <CategoriesPanel cats={cats} models={models} reload={reload} />
      </div>

      {editing && (
        <ModelForm
          model={editing.model}
          cats={cats}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {importing && (
        <CatalogImportPanel
          cats={cats}
          onClose={() => setImporting(false)}
          onImported={reload}
        />
      )}
    </>
  )
}

/* ---------------------------- вкладка: услуги ----------------------------
   Панель переехала в src/components/AdminPanels.jsx: там она умеет не
   только править тексты, но и добавлять, удалять и переставлять карточки.
   ------------------------------------------------------------------------ */

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
                  <td className="card-title" style={{ fontWeight: 500 }}>{n.title}</td>
                  <td data-label="Дата" style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {formatDateShort(n.date)}
                  </td>
                  <td data-label="Статус">
                    <span className={`tag ${n.published ? 'tag-green' : 'tag-outline'}`}>
                      {n.published ? 'Опубликовано' : 'Черновик'}
                    </span>
                  </td>
                  <td className="card-actions">
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

/** «2026-07-24T09:15:00.000Z» → «24.07.2026, 15:15» — время согласия. */
function formatConsent(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const prioClass = (p) => (p === 'Горячий' ? 'hot' : p === 'Тёплый' ? 'warm' : 'cold')
const prioTag = (p) =>
  p === 'Горячий' ? 'tag-brass' : p === 'Тёплый' ? 'tag-green' : 'tag-muted'

/** Короткая подпись источника заявки: utm-метка, домен перехода или ничего
    (прямой заход без меток — самый частый случай, писать его незачем). */
function sourceLabel(r) {
  if (r.utmSource) return [r.utmSource, r.utmMedium].filter(Boolean).join(' / ')
  if (r.referrer) {
    try {
      return new URL(r.referrer).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  }
  return ''
}

/* ---------------------------- вкладка: заявки ---------------------------- */

/** Вердикты ИИ, уже сохранённые на заявках (см. server/ai.js
    analyzeLeads → store.requests.setAiVerdicts) — таблица подсвечивает и
    умеет сортировать по ним сразу при открытии, не дожидаясь повторного
    клика «Анализировать» после перезагрузки страницы. */
const scoresFromRequests = (requests) =>
  Object.fromEntries(
    requests
      .filter((r) => r.aiScore != null)
      .map((r) => [r.id, { priority: r.aiPriority, score: r.aiScore, summary: r.aiSummary, action: r.aiAction }])
  )

const todayISO = () => new Date().toISOString().slice(0, 10)

const SORT_COLUMNS = [
  { key: 'createdAt', label: 'Дата' },
  { key: 'aiScore', label: 'Балл ИИ' },
  { key: 'fio', label: 'Имя' },
  { key: 'status', label: 'Статус' },
]

const EMPTY_FILTERS = {
  status: '',
  type: '',
  dateFrom: '',
  dateTo: '',
  modelId: '',
  region: '',
  source: '',
  q: '',
  onlyDuplicates: false,
}

/** Заметка менеджера + дата следующего контакта, сохраняются по уходу из
    поля (blur) — без отдельной кнопки «Сохранить» на каждую строку. */
function NotesCell({ r, onSaved }) {
  const [notes, setNotes] = useState(r.notes || '')
  const [nextContactAt, setNextContactAt] = useState(r.nextContactAt || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNotes(r.notes || '')
    setNextContactAt(r.nextContactAt || '')
  }, [r.id, r.notes, r.nextContactAt])

  const save = async (patch) => {
    setSaving(true)
    try {
      const updated = await api.admin.setRequestNotes(r.id, patch)
      onSaved(updated)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const overdue = nextContactAt && nextContactAt < todayISO() && r.status !== 'Обработана'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 170 }}>
      <textarea
        className="input"
        rows={2}
        style={{ fontSize: 13, padding: '6px 8px', resize: 'vertical' }}
        placeholder="Заметка…"
        value={notes}
        disabled={saving}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (r.notes || '') && save({ notes })}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="date"
          className="input"
          style={{ fontSize: 12, padding: '5px 7px' }}
          value={nextContactAt || ''}
          disabled={saving}
          onChange={(e) => {
            const v = e.target.value
            setNextContactAt(v)
            save({ nextContactAt: v || null })
          }}
        />
        {overdue && (
          <span className="tag tag-danger" title="Дата следующего контакта уже прошла">
            просрочено
          </span>
        )}
      </div>
    </div>
  )
}

function RequestsTab({ requests, reload, models }) {
  const { showToast } = useSite()
  // Оценки ИИ по id заявки — подсвечивают строки таблицы. Берутся из
  // полного списка заявок, а не из текущей страницы, поэтому не зависят от
  // фильтров и пагинации ниже.
  const [scored, setScored] = useState(() => scoresFromRequests(requests))
  useEffect(() => setScored(scoresFromRequests(requests)), [requests])

  const [regions, setRegions] = useState([])
  useEffect(() => {
    api.regions().then(setRegions).catch(() => setRegions([]))
  }, [])

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [qInput, setQInput] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [table, setTable] = useState({ items: [], total: 0, pageSize: 20 })
  const [tableLoading, setTableLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkStatus, setBulkStatus] = useState('В работе')
  const [exporting, setExporting] = useState(false)

  // Текстовый поиск — с задержкой: иначе каждый символ уходил бы отдельным
  // запросом. Остальные фильтры применяются сразу по изменению.
  const debounceRef = useRef(null)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }))
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [qInput])

  const loadTable = useCallback(async () => {
    setTableLoading(true)
    try {
      const res = await api.admin.requestsQuery({ ...filters, page, sortBy, sortDir })
      setTable(res)
    } catch (e) {
      showToast(e.message)
    } finally {
      setTableLoading(false)
    }
  }, [filters, page, sortBy, sortDir, showToast])

  useEffect(() => {
    loadTable()
  }, [loadTable])

  // Смена любого фильтра или сортировки возвращает на первую страницу —
  // иначе легко застрять на «странице 4», где после фильтра уже пусто.
  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }
  const toggleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  const setStatus = async (r, status) => {
    try {
      await api.admin.setRequestStatus(r.id, status)
      loadTable()
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
      setSelected((s) => {
        const next = new Set(s)
        next.delete(r.id)
        return next
      })
      loadTable()
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  const applyBulkStatus = async () => {
    try {
      const { count } = await api.admin.bulkSetRequestStatus([...selected], bulkStatus)
      showToast(`Статус изменён у заявок: ${count}`)
      setSelected(new Set())
      loadTable()
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  const doExport = async (format) => {
    setExporting(true)
    try {
      await api.admin.exportRequests(filters, format)
    } catch (e) {
      showToast(e.message)
    } finally {
      setExporting(false)
    }
  }

  const onNoteSaved = (updated) => {
    setTable((t) => ({ ...t, items: t.items.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }))
  }

  const toggleRow = (id) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allOnPageSelected = table.items.length > 0 && table.items.every((r) => selected.has(r.id))
  const toggleAllOnPage = () => {
    setSelected((s) => {
      const next = new Set(s)
      if (allOnPageSelected) table.items.forEach((r) => next.delete(r.id))
      else table.items.forEach((r) => next.add(r.id))
      return next
    })
  }

  const totalPages = Math.max(1, Math.ceil(table.total / table.pageSize))
  const filtersActive = Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Заявки</h1>
          <p className="admin-hint">
            Входящие запросы на КП и заказы звонка. Фильтруйте, ищите, меняйте статус — по одной или пачкой.
          </p>
        </div>
      </div>

      {requests.length > 0 && (
        <LeadAnalyzer requests={requests} byId={scored} setById={setScored} />
      )}

      <div className="req-filters">
        <input
          className="input"
          style={{ minWidth: 200, flex: '1 1 220px' }}
          placeholder="Поиск: имя, телефон, комментарий…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select className="input" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="">Любой статус</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="input" value={filters.type} onChange={(e) => setFilter({ type: e.target.value })}>
          <option value="">Любой тип</option>
          <option value="КП">КП</option>
          <option value="Звонок">Звонок</option>
        </select>
        <select className="input" value={filters.modelId} onChange={(e) => setFilter({ modelId: e.target.value })}>
          <option value="">Любая модель</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select className="input" value={filters.region} onChange={(e) => setFilter({ region: e.target.value })}>
          <option value="">Любой регион</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 140 }}
          placeholder="Источник"
          value={filters.source}
          onChange={(e) => setFilter({ source: e.target.value })}
        />
        <input
          type="date"
          className="input"
          style={{ maxWidth: 150 }}
          value={filters.dateFrom}
          onChange={(e) => setFilter({ dateFrom: e.target.value })}
          title="С даты"
        />
        <input
          type="date"
          className="input"
          style={{ maxWidth: 150 }}
          value={filters.dateTo}
          onChange={(e) => setFilter({ dateTo: e.target.value })}
          title="По дату"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            checked={filters.onlyDuplicates}
            onChange={(e) => setFilter({ onlyDuplicates: e.target.checked })}
          />
          только дубли
        </label>
        {filtersActive && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setQInput('')
              setPage(1)
            }}
          >
            Сбросить
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => doExport('csv')}>
          Экспорт CSV
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => doExport('xlsx')}>
          Экспорт XLSX
        </button>
      </div>

      {selected.size > 0 && (
        <div className="req-bulkbar">
          <span>Выбрано: {selected.size}</span>
          <select className="input" style={{ padding: '6px 9px' }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={applyBulkStatus}>
            Применить статус
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Снять выбор
          </button>
        </div>
      )}

      {!tableLoading && table.total === 0 ? (
        <EmptyState
          title={filtersActive ? 'Ничего не найдено' : 'Заявок пока нет'}
          text={filtersActive ? 'Попробуйте изменить фильтры.' : 'Здесь появятся запросы с сайта.'}
        />
      ) : (
        <div className="admin-panel table-scroll" style={{ opacity: tableLoading ? 0.6 : 1 }}>
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                </th>
                {SORT_COLUMNS.map((c) => (
                  <th key={c.key} className="th-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sortBy === c.key && <span> {sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
                <th>Телефон</th>
                <th>Модель / регион</th>
                <th className="th-sort" onClick={() => toggleSort('nextContactAt')}>
                  Заметка / контакт
                  {sortBy === 'nextContactAt' && <span> {sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.items.map((r) => (
                <tr key={r.id} className={scored[r.id] ? `row-${prioClass(scored[r.id].priority)}` : ''}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                  </td>
                  <td data-label="Дата" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateShort(r.date)}
                    <div>
                      <span className={`tag ${r.type === 'КП' ? 'tag-brass' : 'tag-outline'}`}>{r.type}</span>
                    </div>
                  </td>
                  <td data-label="Балл ИИ">
                    {scored[r.id] ? (
                      <span className={`tag ${prioTag(scored[r.id].priority)}`} title={scored[r.id].summary}>
                        {scored[r.id].score}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="card-title" style={{ fontWeight: 500 }}>
                    {r.fio}
                    {/* Доказательство согласия на обработку данных: когда его
                        дали и с какой редакцией политики. Если человек
                        спросит «на что я подписывался» — ответ здесь. */}
                    {r.consentAt && (
                      <div className="consent-mark" title={`Редакция политики: ${r.policyVersion || '—'}`}>
                        согласие {formatConsent(r.consentAt)}
                      </div>
                    )}
                  </td>
                  <td data-label="Статус">
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
                  <td data-label="Телефон" style={{ whiteSpace: 'nowrap' }}>
                    <a
                      href={`tel:${r.phone.replace(/\s/g, '')}`}
                      style={{ borderBottom: '1px solid var(--rule-strong)' }}
                    >
                      {r.phone}
                    </a>
                    {r.duplicateCount > 1 && (
                      <div className="tag tag-danger" style={{ marginTop: 4 }} title="Этот телефон встречается в нескольких заявках">
                        дубль ×{r.duplicateCount}
                      </div>
                    )}
                  </td>
                  <td data-label="Модель / регион" style={{ color: 'var(--text-2)' }}>
                    {r.meta}
                    {r.comment && (
                      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                        «{r.comment}»
                      </div>
                    )}
                    {sourceLabel(r) && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                        источник: {sourceLabel(r)}
                      </div>
                    )}
                  </td>
                  <td>
                    <NotesCell r={r} onSaved={onNoteSaved} />
                  </td>
                  <td className="card-actions">
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

          {totalPages > 1 && (
            <div className="req-pagination">
              <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Пред.
              </button>
              <span>
                Стр. {table.page} из {totalPages} ({table.total} заявок)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                След. →
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/* --------------------------- вкладка: настройки -------------------------- */

/* Подписи полей — нужны и для <label>, и для текста ошибки («Не сохранено:
   Instagram»), поэтому одна карта на оба случая. */
const SETTINGS_FIELD_LABELS = {
  phone: 'Телефон',
  email: 'E-mail',
  address: 'Адрес',
  hours: 'Часы работы',
  legal_name: 'Полное наименование',
  bin: 'БИН',
  leasing_url: 'КазАгроФинанс (лизинг)',
  subsidy_url: 'ГосАгро (субсидии)',
  instagram_url: 'Instagram',
  telegram_url: 'Telegram',
  whatsapp_url: 'WhatsApp',
  hero_title: 'Заголовок героя',
  hero_subtitle: 'Подзаголовок',
  map_embed_url: 'Карта на «Контактах»',
  manager_name: 'Имя менеджера',
  manager_phone: 'Телефон менеджера',
  season_banner_text: 'Текст баннера',
}

function SettingsTab({ onRelogin }) {
  const { settings, setSettings, showToast } = useSite()
  const [f, setF] = useState(settings)
  const [savingGroup, setSavingGroup] = useState(null)
  const [groupError, setGroupError] = useState({})

  // Настройки могут догрузиться после монтирования вкладки.
  useEffect(() => setF(settings), [settings])

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))

  /* Каждая карточка сохраняется своим набором ключей, а не всей формой сразу:
     раньше одна кнопка внизу отправляла ВСЁ разом, и правка телефона могла
     утащить с собой недописанную ссылку в соцсетях. Заодно ошибка теперь не
     проглатывается молча: сервер (см. store.js settings.update) отдельно
     сообщает, какие ссылки не принял — раньше невалидная ссылка (без
     https://) молча превращалась в пустую строку, а тост всё равно говорил
     «сохранено». */
  async function saveGroup(groupKey, keys, label) {
    setSavingGroup(groupKey)
    setGroupError((e) => ({ ...e, [groupKey]: null }))
    try {
      const patch = Object.fromEntries(keys.map((k) => [k, f[k] ?? '']))
      const saved = await api.admin.saveSettings(patch)
      setSettings((prev) => ({ ...prev, ...saved }))
      if (saved.rejected?.length) {
        const names = saved.rejected.map((k) => SETTINGS_FIELD_LABELS[k] || k).join(', ')
        setGroupError((e) => ({
          ...e,
          [groupKey]: `Не сохранено: ${names} — ссылка должна начинаться с https://`,
        }))
      } else {
        showToast(`Сохранено: ${label}`)
      }
    } catch (e) {
      setGroupError((er) => ({ ...er, [groupKey]: e.message }))
    } finally {
      setSavingGroup(null)
    }
  }

  const field = (key, label, type = 'input', placeholder) => (
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
          placeholder={placeholder}
          value={f[key] ?? ''}
          onChange={(e) => upd(key, e.target.value)}
        />
      )}
    </div>
  )

  const saveButton = (groupKey, keys, label) => (
    <>
      {groupError[groupKey] && <div className="form-error">{groupError[groupKey]}</div>}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => saveGroup(groupKey, keys, label)}
        disabled={savingGroup === groupKey}
      >
        {savingGroup === groupKey ? 'Сохраняем…' : `Сохранить (${label})`}
      </button>
    </>
  )

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Настройки</h1>
          <p className="admin-hint">Контакты, ссылки и тексты главной страницы. Каждая карточка сохраняется своей кнопкой.</p>
        </div>
      </div>

      <div className="admin-settings">
        <div className="admin-settings-panel">
          <h3>Контактные данные</h3>
          {field('phone', 'Телефон')}
          {field('email', 'E-mail')}
          {field('address', 'Адрес')}
          {field('hours', 'Часы работы')}
          {saveButton('contacts', ['phone', 'email', 'address', 'hours'], 'Контакты')}
        </div>

        <div className="admin-settings-panel">
          <h3>Карта проезда</h3>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Ссылка на встраиваемую карту 2ГИС или Яндекс.Карт. Где взять: откройте
            карту, найдите свою точку, «Поделиться» → «Встроить на сайт» и скопируйте
            адрес из <code>src=&quot;…&quot;</code>. Должен начинаться с https://.
          </p>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Пустое поле — на «Контактах» показывается адрес и ссылка «Открыть в 2ГИС»,
            без встроенной карты. Сама карта в любом случае загружается только после
            того, как посетитель нажмёт «Показать карту»: до нажатия его данные
            в 2ГИС не уходят.
          </p>
          {field('map_embed_url', 'Ссылка на карту', 'input', 'https://2gis.kz/…/firm/…')}
          {saveButton('map', ['map_embed_url'], 'Карта')}
        </div>

        <div className="admin-settings-panel">
          <h3>Юридические реквизиты</h3>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Показываются в подвале, контактах и политике. Пустое поле — строка
            не отображается.
          </p>
          {field('legal_name', 'Полное наименование (ТОО «…»)')}
          {field('bin', 'БИН')}
          {saveButton('legal', ['legal_name', 'bin'], 'Реквизиты')}
        </div>

        <div className="admin-settings-panel">
          <h3>Внешние ссылки</h3>
          {field('leasing_url', 'КазАгроФинанс (лизинг)', 'input', 'https://…')}
          {field('subsidy_url', 'ГосАгро (субсидии)', 'input', 'https://…')}
          {saveButton('links', ['leasing_url', 'subsidy_url'], 'Внешние ссылки')}
        </div>

        <div className="admin-settings-panel">
          <h3>Соцсети</h3>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Пустое поле — значок не показывается в подвале. Ссылка должна
            начинаться с https://, иначе она не сохранится.
          </p>
          {field('instagram_url', 'Instagram', 'input', 'https://instagram.com/…')}
          {field('telegram_url', 'Telegram', 'input', 'https://t.me/…')}
          {field('whatsapp_url', 'WhatsApp', 'input', 'https://wa.me/77001234567')}
          {saveButton('social', ['instagram_url', 'telegram_url', 'whatsapp_url'], 'Соцсети')}
        </div>

        <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
          <h3>Тексты главной</h3>
          {field('hero_title', 'Заголовок героя')}
          {field('hero_subtitle', 'Подзаголовок', 'textarea')}
          {saveButton('hero', ['hero_title', 'hero_subtitle'], 'Тексты главной')}
        </div>

        <div className="admin-settings-panel">
          <h3>Персональный менеджер</h3>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Показывается на странице модели как «выезд в хозяйство» / «демо-показ» —
            блок появляется, только когда указаны имя и телефон. Пустое поле —
            блока просто нет, ничего выдуманного на сайт не попадёт.
          </p>
          {field('manager_name', 'Имя и должность', 'input', 'Айдос, менеджер по продажам')}
          {field('manager_phone', 'Телефон', 'input', '+7 700 123 45 67')}
          <MediaPicker value={f.manager_photo} onChange={(v) => upd('manager_photo', v)} label="Фото менеджера" />
          {saveButton('manager', ['manager_name', 'manager_phone', 'manager_photo'], 'Менеджер')}
        </div>

        <div className="admin-settings-panel">
          <h3>Сезонный баннер</h3>
          <p className="admin-hint" style={{ marginBottom: 12 }}>
            Строка над каталогом и карточкой модели на время посевной/уборочной —
            включайте и выключайте вручную по сезону.
          </p>
          <label className="check" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={f.season_banner_enabled === '1'}
              onChange={(e) => upd('season_banner_enabled', e.target.checked ? '1' : '')}
            />
            Баннер включён
          </label>
          {field('season_banner_text', 'Текст баннера', 'input', 'Успейте до посевной — техника в наличии')}
          {saveButton('season', ['season_banner_enabled', 'season_banner_text'], 'Сезонный баннер')}
        </div>
      </div>

      {/* Ниже — блоки со своей логикой сохранения (пароль требует текущий
          пароль, регионы и бэкап не завязаны на форму выше вообще). */}
      <div className="admin-settings" style={{ marginTop: 34 }}>
        <RegionsPanel />
        <PasswordPanel onRelogin={onRelogin} />
        <BackupPanel />
        {/* DatabasePanel временно убрана из интерфейса (см. AdminPanels.jsx) —
            сама база и синхронизация продолжают работать в фоне как обычно,
            просто не показываются в админке. */}
      </div>
    </>
  )
}

/* --------------------------- вкладка: главная ---------------------------- */

/**
 * Показатели и сертификаты. Раньше и то и другое лежало в server/seed.js,
 * а в ревью помечено как выдуманные данные, подлежащие замене до запуска, —
 * то есть заказчику обязательно нужно их поменять, и он должен мочь это
 * сделать сам.
 */
function MainTab({ stats, certs, serviceCenters, reload }) {
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Главная страница</h1>
          <p className="admin-hint">Цифры и документы, которые видит посетитель на главной и в разделе «О компании».</p>
        </div>
      </div>

      <div className="admin-settings">
        <PhotosPanel />
        <StatsPanel stats={stats} reload={reload} />
        <CertsPanel certs={certs} reload={reload} />
        <ServiceCentersPanel centers={serviceCenters} reload={reload} />
      </div>
    </>
  )
}

/* ------------------------------- оболочка -------------------------------- */

export default function Admin() {
  usePageMeta({ title: 'Админка', noindex: true })
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(() => !!getToken())
  const [tab, setTab] = useState('summary')

  const [models, setModels] = useState([])
  const [cats, setCats] = useState([])
  const [news, setNews] = useState([])
  const [services, setServices] = useState([])
  const [stats, setStats] = useState([])
  const [certs, setCerts] = useState([])
  const [serviceCenters, setServiceCenters] = useState([])
  const [requests, setRequests] = useState([])
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, c, n, r, s, sv, st, ct, scs] = await Promise.all([
        api.admin.models(),
        api.categories(),
        api.admin.news(),
        api.admin.requests(),
        api.admin.summary(),
        api.services(),
        api.stats(),
        api.certs(),
        api.serviceCenters(),
      ])
      setModels(m)
      setCats(c)
      setNews(n)
      setRequests(r)
      setSummary(s)
      setServices(sv)
      setStats(st)
      setCerts(ct)
      setServiceCenters(scs)
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

  // Переключение месяца в дашборде сводки: тянет только summary, а не весь
  // набор данных админки заново — каталог и заявки от месяца не зависят.
  const loadSummaryMonth = useCallback(async (month) => {
    const s = await api.admin.summary(month)
    setSummary(s)
  }, [])

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
              onClick={(e) => {
                setTab(t.id)
                // На телефоне лента вкладок шире экрана — без этого выбранная
                // вкладка могла остаться за тающим краем, и было не видно,
                // куда на самом деле переключились.
                e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
              }}
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
              <SummaryTab
                summary={summary}
                requests={requests}
                onGoTab={setTab}
                onMonthChange={loadSummaryMonth}
              />
            )}
            {tab === 'catalog' && <CatalogTab models={models} cats={cats} reload={load} />}
            {tab === 'services' && <ServicesPanel services={services} reload={load} />}
            {tab === 'news' && <NewsTab news={news} reload={load} />}
            {tab === 'requests' && <RequestsTab requests={requests} reload={load} models={models} />}
            {tab === 'main' && (
              <MainTab stats={stats} certs={certs} serviceCenters={serviceCenters} reload={load} />
            )}
            {tab === 'settings' && <SettingsTab onRelogin={logout} />}
          </>
        )}
      </div>
    </div>
  )
}
