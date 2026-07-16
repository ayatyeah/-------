import { useState } from 'react'
import { Dialog } from './ui'

const PHOTOS = [
  { v: '', label: '— без фото —' },
  { v: '/assets/tractor-green.webp', label: 'Трактор (зелёный)' },
  { v: '/assets/combine-torum.webp', label: 'Комбайн' },
  { v: '/assets/hero-field.webp', label: 'Поле / сев' },
]

/** Редактор характеристик: пары «параметр — значение». */
function SpecsEditor({ specs, onChange }) {
  const set = (i, key, val) =>
    onChange(specs.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)))

  return (
    <div className="field">
      <label>Технические характеристики</label>
      {specs.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input"
            placeholder="Параметр"
            value={s.k}
            onChange={(e) => set(i, 'k', e.target.value)}
          />
          <input
            className="input"
            placeholder="Значение"
            style={{ maxWidth: 150 }}
            value={s.v}
            onChange={(e) => set(i, 'v', e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label="Удалить строку"
            onClick={() => onChange(specs.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...specs, { k: '', v: '' }])}
      >
        + Добавить строку
      </button>
    </div>
  )
}

/** Создание и редактирование модели техники. */
export function ModelForm({ model, cats, onSave, onClose }) {
  const isNew = !model
  const [f, setF] = useState({
    name: model?.name ?? '',
    cat: model?.cat ?? cats[0]?.id ?? '',
    photo: model?.photo ?? '',
    short: model?.short ?? '',
    descr: model?.descr ?? '',
    subsidized: model?.subsidized ?? false,
    published: model?.published ?? true,
  })
  const [specs, setSpecs] = useState(model?.specs ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Пустые строки характеристик в базу не пишем.
      const clean = specs.filter((s) => s.k.trim() || s.v.trim())
      await onSave({ ...f, photo: f.photo || null, specs: clean })
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <Dialog title={isNew ? 'Новая модель техники' : 'Редактирование модели'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="m_name">Название модели *</label>
          <input
            id="m_name"
            className="input"
            required
            value={f.name}
            onChange={(e) => upd('name', e.target.value)}
            placeholder="Трактор СХМ-…"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field">
            <label htmlFor="m_cat">Категория</label>
            <select
              id="m_cat"
              className="input"
              value={f.cat}
              onChange={(e) => upd('cat', e.target.value)}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="m_photo">Фото</label>
            <select
              id="m_photo"
              className="input"
              value={f.photo}
              onChange={(e) => upd('photo', e.target.value)}
            >
              {PHOTOS.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="m_short">Краткое описание</label>
          <input
            id="m_short"
            className="input"
            value={f.short}
            onChange={(e) => upd('short', e.target.value)}
            placeholder="Одна строка для карточки в каталоге"
          />
        </div>

        <div className="field">
          <label htmlFor="m_descr">Полное описание</label>
          <textarea
            id="m_descr"
            className="input"
            value={f.descr}
            onChange={(e) => upd('descr', e.target.value)}
            placeholder="Текст на странице модели"
          />
        </div>

        <SpecsEditor specs={specs} onChange={setSpecs} />

        <div style={{ display: 'flex', gap: 22, marginTop: 6 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={f.subsidized}
              onChange={(e) => upd('subsidized', e.target.checked)}
            />
            Субсидируется
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={f.published}
              onChange={(e) => upd('published', e.target.checked)}
            />
            Опубликовано
          </label>
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Создание и редактирование статьи. Абзацы разделяются пустой строкой. */
export function NewsForm({ item, onSave, onClose }) {
  const isNew = !item
  const [f, setF] = useState({
    title: item?.title ?? '',
    date: item?.date ?? new Date().toISOString().slice(0, 10),
    excerpt: item?.excerpt ?? '',
    cover: item?.cover ?? '',
    published: item?.published ?? true,
  })
  const [body, setBody] = useState((item?.body ?? []).join('\n\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const paragraphs = body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
      await onSave({ ...f, cover: f.cover || null, body: paragraphs })
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <Dialog title={isNew ? 'Новая статья' : 'Редактирование статьи'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="n_title">Заголовок статьи *</label>
          <input
            id="n_title"
            className="input"
            required
            value={f.title}
            onChange={(e) => upd('title', e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field">
            <label htmlFor="n_date">Дата публикации</label>
            <input
              id="n_date"
              type="date"
              className="input"
              value={f.date}
              onChange={(e) => upd('date', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="n_cover">Обложка</label>
            <select
              id="n_cover"
              className="input"
              value={f.cover}
              onChange={(e) => upd('cover', e.target.value)}
            >
              {PHOTOS.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="n_excerpt">Анонс</label>
          <input
            id="n_excerpt"
            className="input"
            value={f.excerpt}
            onChange={(e) => upd('excerpt', e.target.value)}
            placeholder="Одна строка для карточки"
          />
        </div>

        <div className="field">
          <label htmlFor="n_body">Текст статьи</label>
          <textarea
            id="n_body"
            className="input"
            style={{ minHeight: 180 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Абзацы разделяйте пустой строкой"
          />
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={f.published}
            onChange={(e) => upd('published', e.target.checked)}
          />
          Опубликовано
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
