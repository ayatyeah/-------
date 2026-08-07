import { useState } from 'react'
import { api } from '../api'
import { Dialog } from './ui'
import MediaPicker, { GalleryPicker } from './MediaPicker'

/**
 * Редактор характеристик: пары «параметр — значение».
 *
 * Добавлено к прежней версии: перестановка строк и подстановка заготовки
 * из категории. Порядок здесь не косметика — в карточке характеристики
 * идут ровно так, как заданы, а «Мощность двигателя» посреди габаритов
 * читается плохо.
 */
function SpecsEditor({ specs, onChange, template = [] }) {
  const set = (i, key, val) =>
    onChange(specs.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)))

  /** Меняет строку местами с соседней. */
  const move = (i, шаг) => {
    const j = i + шаг
    if (j < 0 || j >= specs.length) return
    const next = [...specs]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  /* Подставляем параметры категории, не затирая уже заполненное:
     повторно нажатая кнопка не должна стирать введённые значения. */
  const подставитьШаблон = () => {
    const есть = new Set(specs.map((s) => s.k.trim().toLowerCase()))
    const добавить = template
      .filter((k) => !есть.has(k.trim().toLowerCase()))
      .map((k) => ({ k, v: '' }))
    onChange([...specs, ...добавить])
  }

  return (
    <div className="field">
      <label>Технические характеристики</label>

      {specs.map((s, i) => (
        <div key={i} className="spec-row-wrap">
          <div className="spec-row">
            <div className="spec-move">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Выше"
                title="Поднять"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === specs.length - 1}
                aria-label="Ниже"
                title="Опустить"
              >
                ↓
              </button>
            </div>
            <input
              className="input"
              placeholder="Параметр"
              value={s.k}
              onChange={(e) => set(i, 'k', e.target.value)}
            />
            <input
              className="input spec-val"
              placeholder="Значение"
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
          {/* Необязательная подпись «через выгоду» под характеристикой —
              задача 10 дорожной карты. Ничего не подставляем сами: цифры
              вроде «12 м ≈ 100 га за смену» должен посчитать и вписать тот,
              кто знает реальную производительность модели. */}
          <input
            className="input spec-benefit"
            placeholder="Выгода для клиента — необязательно, например «на треть быстрее однопроходной сеялки»"
            value={s.benefit || ''}
            onChange={(e) => set(i, 'benefit', e.target.value)}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange([...specs, { k: '', v: '' }])}
        >
          + Добавить строку
        </button>
        {template.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={подставитьШаблон}
            title="Подставит названия параметров, принятые для этой категории"
          >
            + Параметры категории
          </button>
        )}
      </div>
    </div>
  )
}

/** Создание и редактирование модели техники. */
export function ModelForm({ model, cats, managers = [], onSave, onClose }) {
  const isNew = !model
  const [f, setF] = useState({
    name: model?.name ?? '',
    cat: model?.cat ?? cats[0]?.id ?? '',
    photo: model?.photo ?? '',
    gallery: model?.gallery ?? [],
    short: model?.short ?? '',
    descr: model?.descr ?? '',
    subsidized: model?.subsidized ?? false,
    published: model?.published ?? true,
    badge: model?.badge ?? '',
    flagship: model?.flagship ?? false,
    testimonial: model?.testimonial ?? { quote: '', author: '' },
    managerId: model?.managerId ?? '',
    name_kk: model?.name_kk ?? '',
    name_en: model?.name_en ?? '',
    short_kk: model?.short_kk ?? '',
    short_en: model?.short_en ?? '',
    descr_kk: model?.descr_kk ?? '',
    descr_en: model?.descr_en ?? '',
  })
  const [specs, setSpecs] = useState(model?.specs ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [translating, setTranslating] = useState({ kk: false, en: false })

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const updTestimonial = (k, v) => setF((p) => ({ ...p, testimonial: { ...p.testimonial, [k]: v } }))

  /* AI-описание по названию, категории и уже заполненным характеристикам
     (задача 8) — тот же ИИ-слой, что у анализатора лидов и импорта
     каталога: сначала OpenAI, недоступен — Gemini, ничего не настроено
     специально под эту кнопку. Заполненные вручную тексты не трогаем без
     подтверждения — переписать чужую работу молча нельзя. */
  async function generateDescription() {
    if ((f.short || f.descr) && !confirm('Заменить уже введённое краткое и полное описание?')) return
    setGenerating(true)
    setError(null)
    try {
      const res = await api.admin.generateModelDescription({
        name: f.name,
        cat: f.cat,
        specs,
        subsidized: f.subsidized,
      })
      upd('short', res.short)
      upd('descr', res.descr)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  /* Черновик перевода (задача 16) — тот же провайдер и та же дисциплина
     подтверждения перед заменой, что и у описания выше. Перевод ложится в
     поля формы и публикуется только вместе с остальной моделью по кнопке
     «Сохранить» — сам по себе он ничего не меняет на сайте. */
  async function translateTo(targetLang) {
    const label = targetLang === 'kk' ? 'казахский' : 'английский'
    const hasExisting = f[`name_${targetLang}`] || f[`short_${targetLang}`] || f[`descr_${targetLang}`]
    if (hasExisting && !confirm(`Заменить уже введённый перевод (${label})?`)) return
    setTranslating((p) => ({ ...p, [targetLang]: true }))
    setError(null)
    try {
      const res = await api.admin.translateModel({ name: f.name, short: f.short, descr: f.descr, targetLang })
      upd(`name_${targetLang}`, res.name)
      upd(`short_${targetLang}`, res.short)
      upd(`descr_${targetLang}`, res.descr)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating((p) => ({ ...p, [targetLang]: false }))
    }
  }

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

        <div className="field">
          <label htmlFor="m_cat">Категория (тип техники)</label>
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

        <GalleryPicker
          value={[f.photo, ...f.gallery].filter(Boolean)}
          onChange={(list) => setF((p) => ({ ...p, photo: list[0] || '', gallery: list.slice(1) }))}
          label="Фотографии модели"
        />

        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={generateDescription}
            disabled={generating || !f.name.trim()}
            title={!f.name.trim() ? 'Сначала укажите название модели' : 'Составит краткое и полное описание по названию, категории и характеристикам'}
          >
            {generating ? 'Составляю…' : '✨ Сформировать описание (ИИ)'}
          </button>
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

        {/* Переводы (задача 16) — необязательны. Пусто на kk/en — сайт
            просто показывает русский текст на этой карточке, не пустоту. */}
        <details className="admin-translate">
          <summary>Переводы (қазақша / English)</summary>

          <div className="translate-lang">
            <div className="translate-lang-head">
              <b>Қазақша</b>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => translateTo('kk')}
                disabled={translating.kk || !f.name.trim()}
              >
                {translating.kk ? 'Перевожу…' : '✨ Перевести (ИИ)'}
              </button>
            </div>
            <input
              className="input"
              value={f.name_kk}
              onChange={(e) => upd('name_kk', e.target.value)}
              placeholder="Атауы"
              style={{ marginBottom: 8 }}
            />
            <input
              className="input"
              value={f.short_kk}
              onChange={(e) => upd('short_kk', e.target.value)}
              placeholder="Қысқаша сипаттама"
              style={{ marginBottom: 8 }}
            />
            <textarea
              className="input"
              value={f.descr_kk}
              onChange={(e) => upd('descr_kk', e.target.value)}
              placeholder="Толық сипаттама"
            />
          </div>

          <div className="translate-lang">
            <div className="translate-lang-head">
              <b>English</b>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => translateTo('en')}
                disabled={translating.en || !f.name.trim()}
              >
                {translating.en ? 'Translating…' : '✨ Перевести (ИИ)'}
              </button>
            </div>
            <input
              className="input"
              value={f.name_en}
              onChange={(e) => upd('name_en', e.target.value)}
              placeholder="Name"
              style={{ marginBottom: 8 }}
            />
            <input
              className="input"
              value={f.short_en}
              onChange={(e) => upd('short_en', e.target.value)}
              placeholder="Short description"
              style={{ marginBottom: 8 }}
            />
            <textarea
              className="input"
              value={f.descr_en}
              onChange={(e) => upd('descr_en', e.target.value)}
              placeholder="Full description"
            />
          </div>
        </details>

        <SpecsEditor
          specs={specs}
          onChange={setSpecs}
          template={cats.find((c) => c.id === f.cat)?.specTemplate ?? []}
        />

        <div style={{ display: 'flex', gap: 22, marginTop: 6, flexWrap: 'wrap' }}>
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
          <label className="check">
            <input
              type="checkbox"
              checked={f.flagship}
              onChange={(e) => upd('flagship', e.target.checked)}
            />
            Флагман модельного ряда
          </label>
        </div>

        <div className="field">
          <label htmlFor="m_badge">Бейдж на карточке</label>
          <select id="m_badge" className="input" value={f.badge} onChange={(e) => upd('badge', e.target.value)}>
            <option value="">Без бейджа</option>
            <option value="new">Новинка</option>
            <option value="hit">Хит сезона</option>
            <option value="in_stock">В наличии</option>
            <option value="on_order">Под заказ</option>
          </select>
        </div>

        {/* Персональный менеджер — необязателен. Список ведётся в разделе
            «Главная страница» → «Менеджеры»; здесь только назначение на
            конкретную модель, у разных моделей может быть свой. */}
        <div className="field">
          <label htmlFor="m_manager">Персональный менеджер</label>
          <select
            id="m_manager"
            className="input"
            value={f.managerId}
            onChange={(e) => upd('managerId', e.target.value)}
          >
            <option value="">Без менеджера</option>
            {managers.map((mgr) => (
              <option key={mgr.id} value={mgr.id}>
                {mgr.name}
                {mgr.position ? ` — ${mgr.position}` : ''}
              </option>
            ))}
          </select>
          {managers.length === 0 && (
            <small className="admin-hint">
              Список пуст — добавьте менеджеров в «Главная страница» → «Менеджеры».
            </small>
          )}
        </div>

        {/* Отзыв хозяйства — необязателен и пуст по умолчанию: показываем на
            странице модели, только когда оба поля реально заполнены. Никакой
            заготовки текста здесь нет намеренно — выдумывать отзыв за
            заказчика недопустимо. */}
        <div className="field">
          <label htmlFor="m_testimonial_quote">Отзыв хозяйства (необязательно)</label>
          <textarea
            id="m_testimonial_quote"
            className="input"
            value={f.testimonial.quote}
            onChange={(e) => updTestimonial('quote', e.target.value)}
            placeholder="Текст реального отзыва — если его пока нет, оставьте пустым"
          />
        </div>
        {f.testimonial.quote && (
          <div className="field">
            <label htmlFor="m_testimonial_author">Автор отзыва</label>
            <input
              id="m_testimonial_author"
              className="input"
              value={f.testimonial.author}
              onChange={(e) => updTestimonial('author', e.target.value)}
              placeholder="Например: КХ «Алтын дала», Акмолинская обл."
            />
          </div>
        )}

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
    title_kk: item?.title_kk ?? '',
    title_en: item?.title_en ?? '',
    excerpt_kk: item?.excerpt_kk ?? '',
    excerpt_en: item?.excerpt_en ?? '',
  })
  const [body, setBody] = useState((item?.body ?? []).join('\n\n'))
  const [bodyKk, setBodyKk] = useState((item?.body_kk ?? []).join('\n\n'))
  const [bodyEn, setBodyEn] = useState((item?.body_en ?? []).join('\n\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [translating, setTranslating] = useState({ kk: false, en: false })

  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const toParagraphs = (text) =>
    text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)

  /* Черновик перевода (задача 16) — та же дисциплина подтверждения перед
     заменой, что и у модели: результат правится в форме, публикуется
     только вместе со статьёй по кнопке «Сохранить». */
  async function translateTo(targetLang) {
    const label = targetLang === 'kk' ? 'казахский' : 'английский'
    const existingBody = targetLang === 'kk' ? bodyKk : bodyEn
    const hasExisting = f[`title_${targetLang}`] || f[`excerpt_${targetLang}`] || existingBody
    if (hasExisting && !confirm(`Заменить уже введённый перевод (${label})?`)) return
    setTranslating((p) => ({ ...p, [targetLang]: true }))
    setError(null)
    try {
      const res = await api.admin.translateNews({
        title: f.title,
        excerpt: f.excerpt,
        body: toParagraphs(body),
        targetLang,
      })
      upd(`title_${targetLang}`, res.title)
      upd(`excerpt_${targetLang}`, res.excerpt)
      const joined = (res.body || []).join('\n\n')
      if (targetLang === 'kk') setBodyKk(joined)
      else setBodyEn(joined)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating((p) => ({ ...p, [targetLang]: false }))
    }
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...f,
        cover: f.cover || null,
        body: toParagraphs(body),
        body_kk: toParagraphs(bodyKk),
        body_en: toParagraphs(bodyEn),
      })
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

        <MediaPicker value={f.cover} onChange={(v) => upd('cover', v)} label="Обложка статьи" />

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

        {/* Переводы (задача 16) — необязательны. Пусто на kk/en — сайт
            просто показывает русский текст этой статьи, не пустоту. */}
        <details className="admin-translate">
          <summary>Переводы (қазақша / English)</summary>

          <div className="translate-lang">
            <div className="translate-lang-head">
              <b>Қазақша</b>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => translateTo('kk')}
                disabled={translating.kk || !f.title.trim()}
              >
                {translating.kk ? 'Перевожу…' : '✨ Перевести (ИИ)'}
              </button>
            </div>
            <input
              className="input"
              value={f.title_kk}
              onChange={(e) => upd('title_kk', e.target.value)}
              placeholder="Тақырыбы"
              style={{ marginBottom: 8 }}
            />
            <input
              className="input"
              value={f.excerpt_kk}
              onChange={(e) => upd('excerpt_kk', e.target.value)}
              placeholder="Қысқаша аннотация"
              style={{ marginBottom: 8 }}
            />
            <textarea
              className="input"
              style={{ minHeight: 120 }}
              value={bodyKk}
              onChange={(e) => setBodyKk(e.target.value)}
              placeholder="Мәтін — абзацтарды бос жолмен бөліңіз"
            />
          </div>

          <div className="translate-lang">
            <div className="translate-lang-head">
              <b>English</b>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => translateTo('en')}
                disabled={translating.en || !f.title.trim()}
              >
                {translating.en ? 'Translating…' : '✨ Перевести (ИИ)'}
              </button>
            </div>
            <input
              className="input"
              value={f.title_en}
              onChange={(e) => upd('title_en', e.target.value)}
              placeholder="Title"
              style={{ marginBottom: 8 }}
            />
            <input
              className="input"
              value={f.excerpt_en}
              onChange={(e) => upd('excerpt_en', e.target.value)}
              placeholder="Short excerpt"
              style={{ marginBottom: 8 }}
            />
            <textarea
              className="input"
              style={{ minHeight: 120 }}
              value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
              placeholder="Body text — separate paragraphs with a blank line"
            />
          </div>
        </details>

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
