import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * Выбор картинки: загрузить свою или взять из уже загруженных.
 *
 * ─── Зачем компонент появился ───────────────────────────────────────────
 * Раньше фото модели выбиралось из выпадающего списка с тремя зашитыми в
 * код файлами. Добавить снимок своей машины заказчик не мог никак — нужен
 * был программист, пересборка образа и деплой. Это и есть главное, что
 * мешало сайту быть автономным.
 *
 * ─── Почему картинка ужимается прямо в браузере ─────────────────────────
 * Снимок с телефона — это 3–6 МБ и 4000 пикселей по длинной стороне.
 * Хранить и раздавать такое на карточке шириной 560 пикселей бессмысленно:
 * страдает и скорость сайта, и место на диске сервера (а кончившийся диск
 * останавливает приём заявок).
 *
 * Ужимать на сервере нельзя без библиотеки обработки изображений (sharp
 * тянет за собой бинарники под каждую платформу — тяжело для проекта из
 * шести зависимостей). Браузер же умеет это сам: рисуем картинку на
 * canvas нужного размера и просим отдать WebP. Заказчик выбирает файл с
 * телефона как обычно и ни о чём не думает.
 *
 * ─── Один файл — два компонента ──────────────────────────────────────────
 * MediaPicker выбирает одну картинку (обложка новости, сертификат и т.п.).
 * GalleryPicker — набор картинок с главной первой (фото модели: одна
 * обязательная, остальные по желанию). Оба открывают одну и ту же
 * библиотеку — MediaLibraryDialog ниже, — только по-разному реагируют на
 * выбор: MediaPicker подставляет и закрывается, GalleryPicker добавляет в
 * список и оставляет диалог открытым, чтобы можно было закинуть ещё.
 */

/** Максимальная сторона готовой картинки и качество сжатия. */
const MAX_SIDE = 1600
const QUALITY = 0.85

/** Человекочитаемый размер файла. */
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`)

/** Снимки из комплекта сайта — доступны, даже если библиотека пуста. */
const BUNDLED = ['/assets/tractor-green.webp', '/assets/combine-torum.webp', '/assets/hero-field.webp']

/**
 * Ужимает выбранный файл до разумного размера.
 * Если что-то пойдёт не так (экзотический формат, отказ canvas) — вернём
 * исходный файл: пусть загрузится большим, это лучше, чем отказ.
 */
async function ужать(file) {
  // GIF не трогаем: перерисовка через canvas убила бы анимацию.
  if (file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))

    // Картинка и так небольшая — незачем пережимать и терять качество.
    if (scale === 1 && file.size < 900 * 1024) {
      bitmap.close?.()
      return file
    }

    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!blob) return file

    // Бывает, что «ужатая» версия крупнее исходника (мелкий JPEG).
    return blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/** Имя для ужатого файла: расширение должно соответствовать содержимому. */
const имяДляЗагрузки = (file, blob) =>
  blob !== file && blob.type === 'image/webp'
    ? file.name.replace(/\.[^.]+$/, '') + '.webp'
    : file.name

/**
 * Библиотека фотографий: список загруженного + комплект сайта, загрузка
 * новых файлов, удаление. Сама не хранит, что выбрано — сообщает о каждом
 * клике через onPick и оставляет решение вызывающему.
 *
 * @param {string[]} selected — пути, уже стоящие у вызывающего (для рамки
 *   вокруг уже выбранных карточек в сетке)
 * @param {(path: string) => void} onPick — клик по карточке или успешная
 *   загрузка файла
 * @param {(path: string) => void} onDeleted — файл удалён из библиотеки:
 *   вызывающий решает, убрать ли его из своего значения
 * @param {boolean} closeOnPick — закрывать ли диалог сразу после выбора
 *   (да для одиночной картинки, нет для галереи — там после каждого фото
 *   логичнее остаться и докинуть ещё)
 */
function MediaLibraryDialog({ selected = [], onPick, onDeleted, onClose, closeOnPick = true }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [quota, setQuota] = useState(null)
  const inputRef = useRef(null)
  const dropRef = useRef(null)

  const загрузитьСписок = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.admin.uploads()
      setFiles(d.files)
      setQuota({ used: d.usedBytes, total: d.quotaBytes })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    загрузитьСписок()
  }, [загрузитьСписок])

  async function отправить(fileList) {
    const list = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'))
    if (!list.length) {
      setError('Выберите файл с картинкой (JPG, PNG, WebP или GIF)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const file of list) {
        const blob = await ужать(file)
        const результат = await api.admin.upload(blob, имяДляЗагрузки(file, blob))
        onPick(результат.path)
      }
      await загрузитьСписок()
      if (closeOnPick) onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function удалить(f) {
    const занята = f.usedBy?.length
    const вопрос = занята
      ? `Картинка стоит в карточках: ${f.usedBy.join(', ')}.\nВсё равно удалить? Там останется пустое место.`
      : 'Удалить картинку из библиотеки?'
    if (!confirm(вопрос)) return
    try {
      await api.admin.deleteUpload(f.name, !!занята)
      onDeleted(f.path)
      await загрузитьСписок()
    } catch (e) {
      setError(e.message)
    }
  }

  function выбрать(path) {
    onPick(path)
    if (closeOnPick) onClose()
  }

  /* Перетаскивание файла в окно. Обработчики на самом блоке, а не на
     документе: иначе перетаскивание в любом месте админки открывало бы
     этот загрузчик. */
  const onDrop = (e) => {
    e.preventDefault()
    dropRef.current?.classList.remove('is-over')
    отправить(e.dataTransfer.files)
  }

  return (
    <div className="media-lib" role="dialog" aria-label="Библиотека фотографий">
      <div className="media-lib-head">
        <b>Фотографии</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Закрыть
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div
        ref={dropRef}
        className="media-drop"
        onDragOver={(e) => {
          e.preventDefault()
          dropRef.current?.classList.add('is-over')
        }}
        onDragLeave={() => dropRef.current?.classList.remove('is-over')}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => отправить(e.target.files)}
        />
        {busy ? (
          <span>Загружаем…</span>
        ) : (
          <>
            <b>Перетащите фото сюда</b>
            <span>или нажмите, чтобы выбрать на компьютере</span>
            <small>
              JPG, PNG, WebP или GIF. Крупные снимки уменьшаются автоматически — грузите
              прямо с телефона.
            </small>
          </>
        )}
      </div>

      {quota && (
        <div className="media-quota">
          Занято: {kb(quota.used)} из {kb(quota.total)}
        </div>
      )}

      {loading ? (
        <div className="media-lib-note">Загружаем список…</div>
      ) : files.length === 0 ? (
        <div className="media-lib-note">Пока ничего не загружено.</div>
      ) : (
        <div className="media-grid">
          {files.map((f) => (
            <div key={f.name} className={`media-item${selected.includes(f.path) ? ' is-active' : ''}`}>
              <button
                type="button"
                className="media-item-pick"
                onClick={() => выбрать(f.path)}
                title={f.title || f.name}
              >
                <img src={f.path} alt="" loading="lazy" />
              </button>
              <div className="media-item-foot">
                <span title={f.usedBy?.length ? `Стоит в: ${f.usedBy.join(', ')}` : 'Нигде не используется'}>
                  {f.usedBy?.length ? `в ${f.usedBy.length} карт.` : kb(f.size)}
                </span>
                <button
                  type="button"
                  className="media-item-del"
                  onClick={() => удалить(f)}
                  aria-label={`Удалить ${f.name}`}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="media-lib-note" style={{ marginTop: 10 }}>
        Стандартные снимки из комплекта сайта остаются доступны, даже если библиотека пуста.
      </div>
      <div className="media-grid">
        {BUNDLED.map((p) => (
          <div key={p} className={`media-item${selected.includes(p) ? ' is-active' : ''}`}>
            <button type="button" className="media-item-pick" onClick={() => выбрать(p)}>
              <img src={p} alt="" loading="lazy" />
            </button>
            <div className="media-item-foot">
              <span>из комплекта</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Одна картинка: обложка новости, сертификат и т.п. */
export default function MediaPicker({ value, onChange, label = 'Фотография' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="field">
      <label>{label}</label>

      <div className="media-pick">
        <div className="media-pick-preview">
          {value ? (
            <img src={value} alt="" />
          ) : (
            <span className="media-pick-empty">Фото не выбрано</span>
          )}
        </div>

        <div className="media-pick-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
            {value ? 'Заменить' : 'Выбрать или загрузить'}
          </button>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>
              Убрать
            </button>
          )}
        </div>
      </div>

      {open && (
        <MediaLibraryDialog
          selected={value ? [value] : []}
          onPick={onChange}
          onDeleted={(path) => {
            if (value === path) onChange('')
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * Набор фотографий: первая — главная (та, что видна в каталоге, JSON-LD и
 * везде, где карточке нужно ровно одно фото), остальные — по желанию.
 * Хранится одним массивом путей, но наружу отдаётся как есть: разложить
 * на «главное + остальные» — дело вызывающего (см. AdminForms.jsx).
 */
export function GalleryPicker({ value, onChange, label = 'Фотографии' }) {
  const [open, setOpen] = useState(false)
  const photos = value || []

  const сделатьГлавной = (i) => {
    if (i === 0) return
    const next = [...photos]
    const [item] = next.splice(i, 1)
    next.unshift(item)
    onChange(next)
  }
  const убрать = (i) => onChange(photos.filter((_, idx) => idx !== i))
  const добавить = (path) => {
    if (!photos.includes(path)) onChange([...photos, path])
  }
  const удалена = (path) => onChange(photos.filter((p) => p !== path))

  return (
    <div className="field">
      <label>{label}</label>

      <div className="gallery-pick">
        {photos.map((p, i) => (
          <div className={`gallery-pick-item${i === 0 ? ' is-main' : ''}`} key={p}>
            <img src={p} alt="" />
            <div className="gallery-pick-tag">
              {i === 0 ? (
                'Главное'
              ) : (
                <button type="button" onClick={() => сделатьГлавной(i)}>
                  Сделать главной
                </button>
              )}
            </div>
            <button
              type="button"
              className="gallery-pick-del"
              onClick={() => убрать(i)}
              aria-label="Убрать фото"
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="gallery-pick-add" onClick={() => setOpen(true)}>
          + Добавить фото
        </button>
      </div>

      {photos.length === 0 && (
        <p className="admin-hint" style={{ marginTop: 8 }}>
          Фото не выбраны. Первое добавленное станет главным — его увидят в каталоге.
        </p>
      )}

      {open && (
        <MediaLibraryDialog
          selected={photos}
          onPick={добавить}
          onDeleted={удалена}
          onClose={() => setOpen(false)}
          closeOnPick={false}
        />
      )}
    </div>
  )
}
