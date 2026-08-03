import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSite } from '../store'
import Icon from './Icon'
import MediaPicker from './MediaPicker'

/**
 * Панели админки, которых раньше не было вовсе.
 *
 * До этой правки категории каталога, услуги, показатели на главной,
 * сертификаты и список регионов в форме заявки жили в server/seed.js —
 * то есть в коде. Любая правка означала: разработчик, коммит, пересборка
 * образа, деплой. Заказчик, которому обещали «зайти в админку и всё
 * поменять», упирался в это на первом же шаге.
 *
 * Здесь все они становятся обычными данными с полным набором действий:
 * добавить, изменить, переставить, удалить.
 */

/* Значки, которые есть в src/components/Icon.jsx. Показываем картинками,
   а не названиями: «harrow» заказчику ни о чём не говорит. */
const ICONS = [
  'tractor',
  'combine',
  'seeder',
  'harrow',
  'truck',
  'factory',
  'gear',
  'wrench',
  'compass',
  'percent',
  'shield',
  'doc',
  'bolt',
  'spark',
  'check',
]

function IconPicker({ value, onChange }) {
  return (
    <div className="field">
      <label>Значок</label>
      <div className="icon-picker">
        {ICONS.map((name) => (
          <button
            type="button"
            key={name}
            className={`icon-choice${value === name ? ' is-active' : ''}`}
            onClick={() => onChange(name)}
            aria-label={name}
            aria-pressed={value === name}
          >
            <Icon name={name} size={22} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Кнопки «выше / ниже». Порядок сохраняется сразу, без отдельной кнопки. */
function MoveButtons({ index, total, onMove }) {
  return (
    <div className="spec-move">
      <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} title="Поднять">
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(index, 1)}
        disabled={index === total - 1}
        title="Опустить"
      >
        ↓
      </button>
    </div>
  )
}

/** Общая механика перестановки: меняем соседей местами и шлём новый порядок. */
function useReorder(items, saveOrder, reload) {
  return async (index, шаг) => {
    const j = index + шаг
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[index], next[j]] = [next[j], next[index]]
    try {
      await saveOrder(next.map((x) => x.id))
      reload()
    } catch (e) {
      alert(e.message)
    }
  }
}

/* ----------------------------- категории -------------------------------- */

/**
 * Категории каталога — то, что заказчик называет «типом товара».
 *
 * Удаление отдельно продумано: если в категории есть техника, просто
 * стереть её нельзя — модели остались бы без категории и исчезли из
 * каталога (он фильтрует именно по ним). Поэтому спрашиваем, куда
 * перенести, и переносим.
 */
export function CategoriesPanel({ cats, models, reload }) {
  const { showToast } = useSite()
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ name: '', icon: 'gear', specTemplate: '' })
  const [saving, setSaving] = useState(false)
  const move = useReorder(cats, api.admin.reorderCategories, reload)

  const open = (c) => {
    setEditing(c ?? { id: null })
    setF({
      name: c?.name ?? '',
      icon: c?.icon ?? 'gear',
      specTemplate: (c?.specTemplate ?? []).join('\n'),
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: f.name,
        icon: f.icon,
        specTemplate: f.specTemplate
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      }
      if (editing.id) await api.admin.updateCategory(editing.id, body)
      else await api.admin.createCategory(body)
      showToast(editing.id ? 'Категория обновлена' : 'Категория добавлена')
      setEditing(null)
      reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function del(c) {
    const внутри = models.filter((m) => m.cat === c.id)

    if (внутри.length) {
      const другие = cats.filter((x) => x.id !== c.id)
      if (!другие.length) {
        alert('Это последняя категория — технику некуда переносить. Сначала создайте другую.')
        return
      }
      const список = другие.map((x, i) => `${i + 1}. ${x.name}`).join('\n')
      const ответ = prompt(
        `В категории «${c.name}» ${внутри.length} модел${внутри.length === 1 ? 'ь' : 'и'}.\n` +
          `Куда их перенести? Введите номер:\n\n${список}`
      )
      const выбор = другие[Number(ответ) - 1]
      if (!выбор) return
      try {
        await api.admin.deleteCategory(c.id, выбор.id)
        showToast(`Категория удалена, техника перенесена в «${выбор.name}»`)
        reload()
      } catch (e) {
        alert(e.message)
      }
      return
    }

    if (!confirm(`Удалить категорию «${c.name}»?`)) return
    try {
      await api.admin.deleteCategory(c.id)
      showToast('Категория удалена')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="admin-subhead">
        <div>
          <h3>Категории техники</h3>
          <p className="admin-hint">
            Разделы каталога и фильтры на странице «Каталог». Порядок здесь — порядок на сайте.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(null)}>
          + Категория
        </button>
      </div>

      <div className="admin-panel table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Порядок</th>
              <th>Название</th>
              <th>Значок</th>
              <th>Моделей</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <MoveButtons index={i} total={cats.length} onMove={move} />
                </td>
                <td style={{ fontWeight: 500 }}>{c.name}</td>
                <td>
                  <Icon name={c.icon || 'gear'} size={20} />
                </td>
                <td style={{ color: 'var(--text-2)' }}>
                  {models.filter((m) => m.cat === c.id).length}
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(c)}>
                      Изм.
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: '#a33' }}
                      onClick={() => del(c)}
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

      {editing && (
        <div className="admin-inline-form">
          <form onSubmit={save}>
            <h4>{editing.id ? 'Категория' : 'Новая категория'}</h4>

            <div className="field">
              <label htmlFor="c_name">Название</label>
              <input
                id="c_name"
                className="input"
                required
                value={f.name}
                onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
                placeholder="Например: Опрыскиватели"
              />
            </div>

            <IconPicker value={f.icon} onChange={(v) => setF((p) => ({ ...p, icon: v }))} />

            <div className="field">
              <label htmlFor="c_tpl">Обычные характеристики для этой категории</label>
              <textarea
                id="c_tpl"
                className="input"
                style={{ minHeight: 120 }}
                value={f.specTemplate}
                onChange={(e) => setF((p) => ({ ...p, specTemplate: e.target.value }))}
                placeholder={'Ширина захвата\nЁмкость бака\nМасса'}
              />
              <small className="admin-hint">
                По одному названию в строке. При создании модели эти параметры подставятся
                сразу — останется вписать значения.
              </small>
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
        </div>
      )}
    </>
  )
}

/* ------------------------------- услуги --------------------------------- */

export function ServicesPanel({ services, reload }) {
  const { showToast } = useSite()
  const [editing, setEditing] = useState(null)
  const [f, setF] = useState({ title: '', text: '', note: '', icon: 'gear' })
  const [saving, setSaving] = useState(false)
  const move = useReorder(services, api.admin.reorderServices, reload)

  const open = (s) => {
    setEditing(s ?? { id: null })
    setF({
      title: s?.title ?? '',
      text: s?.text ?? '',
      note: s?.note ?? '',
      icon: s?.icon ?? 'gear',
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing.id) await api.admin.updateService(editing.id, f)
      else await api.admin.createService(f)
      showToast(editing.id ? 'Услуга обновлена' : 'Услуга добавлена')
      setEditing(null)
      reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function del(s) {
    if (!confirm(`Удалить услугу «${s.title}»?`)) return
    try {
      await api.admin.deleteService(s.id)
      showToast('Услуга удалена')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Услуги</h1>
          <p className="admin-hint">
            Блок «Услуги» на главной. Теперь можно не только править тексты, но и добавлять,
            удалять и переставлять карточки.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => open(null)}>
          + Добавить услугу
        </button>
      </div>

      <div className="admin-panel table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Порядок</th>
              <th>Услуга</th>
              <th>Описание</th>
              <th>Подпись</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <MoveButtons index={i} total={services.length} onMove={move} />
                </td>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <Icon name={s.icon || 'gear'} size={16} /> {s.title}
                </td>
                <td style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 420 }}>{s.text}</td>
                <td style={{ color: 'var(--text-3)', fontSize: 13, whiteSpace: 'nowrap' }}>
                  {s.note}
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(s)}>
                      Изм.
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: '#a33' }}
                      onClick={() => del(s)}
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

      {editing && (
        <div className="admin-inline-form">
          <form onSubmit={save}>
            <h4>{editing.id ? 'Услуга' : 'Новая услуга'}</h4>

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

            <IconPicker value={f.icon} onChange={(v) => setF((p) => ({ ...p, icon: v }))} />

            <div className="field">
              <label htmlFor="sv_text">Описание</label>
              <textarea
                id="sv_text"
                className="input"
                style={{ minHeight: 110 }}
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
        </div>
      )}
    </>
  )
}

/* ------------------- показатели и сертификаты ---------------------------- */

/**
 * Простой редактор списка из двух полей. Одинаково устроены показатели
 * («18» / «лет на рынке») и документы («ISO 9001» / «менеджмент качества»),
 * поэтому панель одна на оба случая.
 */
function TwoFieldPanel({ items, labels, reload, apiSet, title, hint }) {
  const { showToast } = useSite()
  const [draft, setDraft] = useState({ a: '', b: '' })
  const [busy, setBusy] = useState(false)
  const move = useReorder(items, apiSet.reorder, reload)

  const изменить = async (item, поле, значение) => {
    try {
      await apiSet.update(item.id, { [поле]: значение })
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  async function добавить(e) {
    e.preventDefault()
    if (!draft.a.trim() && !draft.b.trim()) return
    setBusy(true)
    try {
      await apiSet.create({ [labels.aKey]: draft.a, [labels.bKey]: draft.b })
      setDraft({ a: '', b: '' })
      showToast('Добавлено')
      reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function удалить(item) {
    if (!confirm('Удалить строку?')) return
    try {
      await apiSet.remove(item.id)
      showToast('Удалено')
      reload()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
      <h3>{title}</h3>
      {hint && (
        <p className="admin-hint" style={{ marginBottom: 12 }}>
          {hint}
        </p>
      )}

      {items.map((item, i) => (
        <div key={item.id} className="spec-row">
          <MoveButtons index={i} total={items.length} onMove={move} />
          <input
            className="input"
            style={{ maxWidth: 160 }}
            defaultValue={item[labels.aKey]}
            placeholder={labels.a}
            onBlur={(e) =>
              e.target.value !== item[labels.aKey] && изменить(item, labels.aKey, e.target.value)
            }
          />
          <input
            className="input"
            defaultValue={item[labels.bKey]}
            placeholder={labels.b}
            onBlur={(e) =>
              e.target.value !== item[labels.bKey] && изменить(item, labels.bKey, e.target.value)
            }
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => удалить(item)}
            aria-label="Удалить"
          >
            ✕
          </button>
        </div>
      ))}

      <form onSubmit={добавить} className="spec-row" style={{ marginTop: 14 }}>
        <input
          className="input"
          style={{ maxWidth: 160 }}
          value={draft.a}
          placeholder={labels.a}
          onChange={(e) => setDraft((p) => ({ ...p, a: e.target.value }))}
        />
        <input
          className="input"
          value={draft.b}
          placeholder={labels.b}
          onChange={(e) => setDraft((p) => ({ ...p, b: e.target.value }))}
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
          Добавить
        </button>
      </form>

      <small className="admin-hint">Правки в готовых строках сохраняются при переходе к другому полю.</small>
    </div>
  )
}

export function StatsPanel({ stats, reload }) {
  return (
    <TwoFieldPanel
      items={stats}
      reload={reload}
      title="Показатели на главной"
      hint="Крупные цифры на главной и странице «О компании». Значения из демо-версии (18 лет, 12 400+, 34, 860) обязательно замените своими."
      labels={{ a: 'Число', b: 'Подпись', aKey: 'v', bKey: 'k' }}
      apiSet={{
        create: api.admin.createStat,
        update: api.admin.updateStat,
        remove: api.admin.deleteStat,
        reorder: api.admin.reorderStats,
      }}
    />
  )
}

export function CertsPanel({ certs, reload }) {
  return (
    <TwoFieldPanel
      items={certs}
      reload={reload}
      title="Сертификаты и документы"
      hint="Список документов в разделе «О компании». Указывайте только те, что есть на руках."
      labels={{ a: 'Название', b: 'Пояснение', aKey: 'title', bKey: 'org' }}
      apiSet={{
        create: api.admin.createCert,
        update: api.admin.updateCert,
        remove: api.admin.deleteCert,
        reorder: api.admin.reorderCerts,
      }}
    />
  )
}

/* ------------------------------- фото сайта ------------------------------- */

/**
 * Фото на главной и на странице «О компании». Раньше это были два файла,
 * зашитых в код (/assets/hero-field.webp, /assets/tractor-green.webp) —
 * заменить их мог только программист, через пересборку образа. Пустое
 * поле не ломает страницу: сайт показывает снимок из комплекта.
 */
export function PhotosPanel() {
  const { settings, setSettings, showToast } = useSite()
  const [f, setF] = useState({
    hero_photo: settings.hero_photo ?? '',
    about_photo: settings.about_photo ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Настройки могут догрузиться после монтирования вкладки.
  useEffect(() => {
    setF({ hero_photo: settings.hero_photo ?? '', about_photo: settings.about_photo ?? '' })
  }, [settings.hero_photo, settings.about_photo])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.admin.saveSettings(f)
      setSettings((prev) => ({ ...prev, ...saved }))
      if (saved.rejected?.length) {
        setError(`Не сохранено: ${saved.rejected.join(', ')} — проверьте, что фото выбрано через библиотеку.`)
      } else {
        showToast('Фото сохранены')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Фото сайта</h3>
      <p className="admin-hint" style={{ marginBottom: 12 }}>
        Пустое поле — используется снимок из комплекта сайта, страница не ломается.
      </p>
      {error && <div className="form-error">{error}</div>}
      <MediaPicker
        value={f.hero_photo}
        onChange={(v) => setF((p) => ({ ...p, hero_photo: v }))}
        label="Фото на главной"
      />
      <MediaPicker
        value={f.about_photo}
        onChange={(v) => setF((p) => ({ ...p, about_photo: v }))}
        label="Фото на странице «О компании»"
      />
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: 12 }}
        onClick={save}
        disabled={saving}
      >
        {saving ? 'Сохраняем…' : 'Сохранить фото'}
      </button>
    </div>
  )
}

/* ------------------------------- регионы --------------------------------- */

/**
 * Регионы в форме «Получить КП». Список правится целиком одним полем:
 * заводить карточку на каждую область ради строки текста — лишняя возня.
 */
export function RegionsPanel() {
  const { showToast } = useSite()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .regions()
      .then((r) => {
        setText(r.join('\n'))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const list = text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const saved = await api.admin.saveRegions(list)
      setText(saved.join('\n'))
      showToast('Список регионов сохранён')
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Регионы в форме заявки</h3>
      <p className="admin-hint" style={{ marginBottom: 12 }}>
        Выпадающий список в форме «Получить КП» и бегущая строка на главной. По одной области
        в строке.
      </p>
      <textarea
        className="input"
        style={{ minHeight: 180 }}
        value={text}
        disabled={!loaded}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginTop: 12 }}
        onClick={save}
        disabled={saving || !loaded}
      >
        {saving ? 'Сохраняем…' : 'Сохранить регионы'}
      </button>
    </div>
  )
}

/* ------------------------------- пароль ---------------------------------- */

/**
 * Смена пароля админки.
 *
 * Раньше пароль лежал только в .env на сервере: сменить его мог лишь тот,
 * у кого есть SSH. На практике это означало, что пароль не меняли никогда —
 * в том числе после ухода сотрудника, который его знал.
 */
export function PasswordPanel({ onRelogin }) {
  const [f, setF] = useState({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  async function save(e) {
    e.preventDefault()
    setError(null)

    if (f.next !== f.repeat) {
      setError('Новый пароль и повтор не совпадают')
      return
    }
    if (f.next.length < 10) {
      setError('Новый пароль должен быть не короче 10 символов')
      return
    }

    setBusy(true)
    try {
      await api.admin.changePassword(f.current, f.next)
      setOk(true)
      // Ключ подписи сессий привязан к паролю, поэтому текущий вход тоже
      // стал недействительным — честно отправляем входить заново.
      setTimeout(() => onRelogin(), 2200)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (ok) {
    return (
      <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
        <h3>Пароль админки</h3>
        <p className="admin-hint">
          Пароль изменён. Все открытые сессии (в том числе на других устройствах) завершены —
          сейчас откроется вход.
        </p>
      </div>
    )
  }

  return (
    <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Пароль админки</h3>
      <p className="admin-hint" style={{ marginBottom: 12 }}>
        Меняется прямо здесь, доступ к серверу не нужен. После смены вход на всех устройствах
        придётся выполнить заново. Если пароль забыт — восстановить его сможет только тот, у
        кого есть доступ к серверу.
      </p>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={save} style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="pw_cur">Текущий пароль</label>
          <input
            id="pw_cur"
            type="password"
            className="input"
            autoComplete="current-password"
            value={f.current}
            onChange={(e) => setF((p) => ({ ...p, current: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="pw_new">Новый пароль</label>
          <input
            id="pw_new"
            type="password"
            className="input"
            autoComplete="new-password"
            value={f.next}
            onChange={(e) => setF((p) => ({ ...p, next: e.target.value }))}
            placeholder="Не короче 10 символов"
          />
        </div>
        <div className="field">
          <label htmlFor="pw_rep">Повторите новый</label>
          <input
            id="pw_rep"
            type="password"
            className="input"
            autoComplete="new-password"
            value={f.repeat}
            onChange={(e) => setF((p) => ({ ...p, repeat: e.target.value }))}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Меняем…' : 'Сменить пароль'}
        </button>
      </form>
    </div>
  )
}

/* --------------------------- резервная копия ------------------------------ */

export function BackupPanel() {
  const { showToast } = useSite()
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      await api.admin.exportBackup()
      showToast('Копия скачана')
    } catch (e) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-settings-panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Резервная копия</h3>
      <p className="admin-hint" style={{ marginBottom: 12 }}>
        На сервере копии делаются автоматически каждые сутки, но лежат они там же, где сайт.
        Эта кнопка сохраняет содержимое сайта — каталог, новости, заявки, настройки — файлом к
        вам на компьютер. Пароль в копию не попадает.
      </p>
      <p className="admin-hint" style={{ marginBottom: 12 }}>
        В файле есть имена и телефоны из заявок. Храните его как рабочий документ с
        персональными данными, а не в открытой папке.
      </p>
      <button type="button" className="btn btn-secondary" onClick={download} disabled={busy}>
        {busy ? 'Готовим файл…' : 'Скачать копию'}
      </button>
    </div>
  )
}
