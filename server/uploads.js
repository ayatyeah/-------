/**
 * Загрузка картинок из админки.
 *
 * Зачем модуль появился: раньше фото модели выбиралось из трёх зашитых в
 * код файлов (`PHOTOS` в src/components/AdminForms.jsx). Добавить снимок
 * новой машины заказчик не мог в принципе — только через программиста,
 * пересборку образа и деплой. Это ровно та зависимость, которую просили
 * убрать.
 *
 * ─── Почему без multer и вообще без библиотек ────────────────────────────
 * У проекта принципиально короткий список зависимостей, и добавлять ради
 * загрузки файлов разбор multipart-формы (multer тянет за собой busboy и
 * работу с временными файлами) не хочется. Вместо этого браузер шлёт файл
 * как есть — сырым телом запроса, а имя передаёт заголовком. Разбирать
 * нечего: `express.raw()` кладёт готовый Buffer, дальше мы сами решаем,
 * картинка это или нет.
 *
 * ─── Как проверяется, что это картинка ───────────────────────────────────
 * НЕ по расширению и НЕ по заголовку Content-Type — и то и другое пишет
 * клиент, то есть любой желающий. Проверяются первые байты файла
 * (сигнатура формата). Файл, который не начинается как JPEG/PNG/WebP/GIF,
 * на диск не попадает.
 *
 * SVG не принимается сознательно, хотя это картинка: внутри SVG может
 * лежать <script>, и открытая напрямую по своему адресу такая «картинка»
 * выполняется браузером в контексте нашего домена. Это классический путь
 * от «залил аватарку» до кражи сессии администратора.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { STORE_PATH, slugify } from './store.js'

/**
 * Где лежат загруженные файлы.
 *
 * По умолчанию — рядом с файлом данных. В Docker это /data, то есть том,
 * который переживает пересборку образа. Важно: класть загрузки внутрь
 * dist/ или public/ нельзя — эти каталоги пересоздаются при каждой сборке,
 * и все фотографии заказчика исчезли бы после первого же деплоя.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR)
  : join(dirname(STORE_PATH), 'uploads')

/** Адрес, по которому файлы отдаются наружу. */
export const UPLOAD_URL_PREFIX = '/uploads'

/** Потолок на один файл. Картинку клиент ужимает до загрузки, так что
    упереться сюда можно только специально; для сканов сертификатов (PDF,
    DOC) сжатия нет, и многостраничный скан весит больше, чем фото —
    поэтому потолок общий и выше, чем нужен был бы одним картинкам. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024

/** Потолок на весь каталог загрузок — чтобы забитый диск не уронил сайт.
    Диск кончится → перестанет записываться store.json → перестанут
    приниматься заявки. Лучше отказать в загрузке сотой фотографии. */
export const MAX_TOTAL_BYTES = Number(process.env.UPLOAD_QUOTA_MB || 512) * 1024 * 1024

/**
 * Сигнатуры форматов. Сверяем первые байты — так узнаём настоящий тип,
 * независимо от того, что написал клиент в имени и Content-Type.
 */
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b) => {
      const head = b.slice(0, 6).toString('ascii')
      return head === 'GIF87a' || head === 'GIF89a'
    },
  },
]

/** Тип файла по содержимому. null — значит не картинка из разрешённых. */
export function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null
  return SIGNATURES.find((s) => s.test(buf)) || null
}

/**
 * Сигнатуры документов — для сертификатов, которые не фото, а скан или
 * PDF/DOC. Та же логика, что и с картинками: по первым байтам, не по
 * расширению или Content-Type.
 *
 * DOCX проверяется по заголовку ZIP (`PK\x03\x04`) — сам формат и есть zip-
 * архив с XML внутри. Проверка не отличает его от XLSX/PPTX/произвольного
 * zip, но здесь это не риск: ручка только для админа, а отдаётся файл со
 * своим Content-Type и nosniff — как бы его ни назвали, браузер не станет
 * исполнять его как страницу.
 */
const DOC_SIGNATURES = [
  { ext: 'pdf', mime: 'application/pdf', test: (b) => b.slice(0, 5).toString('ascii') === '%PDF-' },
  {
    ext: 'doc',
    mime: 'application/msword',
    test: (b) =>
      b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
      b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1,
  },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
]

/** Тип документа по содержимому. null — не PDF/DOC/DOCX. */
export function detectDocument(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null
  return DOC_SIGNATURES.find((s) => s.test(buf)) || null
}

/**
 * Файл-«полиглот»: начинается как картинка, а дальше содержит разметку.
 *
 * Приём известный: берут валидный заголовок GIF (шесть байт `GIF89a`) и
 * дописывают следом HTML со скриптом. Проверка сигнатуры такой файл
 * пропускает — формально это картинка.
 *
 * Сработать он у нас не может: файлы отдаются с точным Content-Type,
 * заголовком nosniff и Content-Disposition: inline, а CSP запрещает
 * выполнение стороннего кода. То есть браузер разметку внутри «картинки»
 * не исполнит. Но полагаться на один рубеж не хочется: заголовок легко
 * потерять при будущей смене способа отдачи (например, если кто-то решит
 * раздавать /uploads напрямую через Caddy). Дешевле не пускать такой файл
 * на диск вовсе.
 *
 * Ищем только однозначно исполняемые конструкции. `<?xml` намеренно НЕ в
 * списке: он честно встречается в XMP-метаданных обычных фотографий, и
 * запрет отвергал бы нормальные снимки с телефона.
 *
 * Оставлены только два шаблона, и это не небрежность.
 * `<script` — единственная конструкция, которая действительно исполняется.
 * `<!doctype html` — однозначный признак веб-страницы, 14 символов, случайно
 * не встречается.
 *
 * Убраны: `<svg` (четыре символа, совпадал с `<svg:width>` в метаданных XMP у
 * файлов из Illustrator — из-за этого отклонялись нормальные фотографии),
 * `<iframe` (без HTML-контекста безвреден), `<?php` (PHP здесь не исполняется),
 * `<html` (поверх `<!doctype html` почти ничего не добавляет, зато ловит
 * подписи, скопированные с веб-страниц в метаданные снимка).
 */
const ОПАСНЫЕ_ФРАГМЕНТЫ = ['<script', '<!doctype html']

/** Возвращает совпавший фрагмент и смещение, либо null. */
export function looksLikePolyglot(buf) {
  // Достаточно проверить начало: разметка, чтобы исполниться, должна
  // попасться браузеру рано, а сплошное сканирование мегабайтов фото на
  // каждой загрузке — лишняя работа.
  const head = buf.slice(0, 4096).toString('latin1').toLowerCase()
  for (const frag of ОПАСНЫЕ_ФРАГМЕНТЫ) {
    const at = head.indexOf(frag)
    if (at !== -1) return { fragment: frag, offset: at }
  }
  return null
}

/** Отдача: какой Content-Type ставить файлу по его имени. */
export function mimeByName(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return [...SIGNATURES, ...DOC_SIGNATURES].find((s) => s.ext === ext)?.mime || 'application/octet-stream'
}

export function ensureDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

/** Сколько места занято загрузками. */
export function usedBytes() {
  ensureDir()
  let total = 0
  for (const f of readdirSync(UPLOAD_DIR)) {
    try {
      total += statSync(join(UPLOAD_DIR, f)).size
    } catch {
      /* файл исчез между чтением списка и статистикой — не страшно */
    }
  }
  return total
}

/**
 * Безопасное имя файла.
 *
 * Имя, присланное клиентом, используется ТОЛЬКО как источник читаемой
 * части — и то после транслитерации и вычистки всего, кроме букв, цифр и
 * дефиса. Уникальность даёт случайный хвост. Так исключены и обход
 * каталога («../../etc/passwd»), и подмена уже существующего файла, и
 * сюрпризы с юникодом в именах.
 */
function safeName(originalName, ext, fallbackStem = 'img') {
  const stem = slugify(String(originalName || '').replace(/\.[^.]+$/, ''), fallbackStem).slice(0, 40)
  return `${stem || fallbackStem}-${randomUUID().slice(0, 8)}.${ext}`
}

/**
 * Общая часть записи: проверка размера, проверка на «полиглот», квота и
 * сама запись на диск через временный файл. Тип уже определён и проверен
 * вызывающим (saveImage / saveCertFile) — у них разные допустимые форматы
 * и разные сообщения об ошибке «не тот формат».
 */
function writeUpload(buf, originalName, kind, fallbackStem) {
  if (buf.length > MAX_FILE_BYTES) {
    throw Object.assign(
      new Error(`Файл слишком большой (максимум ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ)`),
      { status: 413 }
    )
  }
  const подделка = looksLikePolyglot(buf)
  if (подделка) {
    console.warn(
      `Загрузка отклонена: в файле «${originalName}» найден фрагмент ` +
      `${подделка.fragment} на смещении ${подделка.offset}`
    )
    throw Object.assign(
      new Error('Файл не принят: похож на подделку под допустимый формат. Если это обычный файл — сообщите разработчику, отказ записан в лог.'),
      { status: 415 }
    )
  }

  ensureDir()

  if (usedBytes() + buf.length > MAX_TOTAL_BYTES) {
    throw Object.assign(
      new Error('Место под файлы закончилось. Удалите ненужное в разделе «Фотографии».'),
      { status: 507 }
    )
  }

  const name = safeName(originalName, kind.ext, fallbackStem)
  const full = join(UPLOAD_DIR, name)

  // Через временный файл: оборванная загрузка не оставит в библиотеке
  // недописанный файл, который потом молча ломает вёрстку карточки.
  const tmp = full + '.part'
  writeFileSync(tmp, buf)
  renameSync(tmp, full)

  return { name, path: `${UPLOAD_URL_PREFIX}/${name}`, size: buf.length, mime: kind.mime, ext: kind.ext }
}

/**
 * Обработка фото через sharp (задача 20): пересжатие, обрезка по потолку
 * размера и снимок метаданных — EXIF (включая координаты съёмки, если
 * телефон их записал) в исходном файле, а sharp по умолчанию отдаёт
 * буфер БЕЗ метаданных, если явно не попросить их сохранить (.withMetadata()
 * здесь нигде не вызывается). Заказчик может не задумываться, откуда
 * сфотографирован трактор, — координаты не попадут на сайт вместе с фото.
 *
 * Побочный эффект пересжатия — та же защита, что и проверка на «полиглот»
 * ниже, но надёжнее: результат sharp — это заново собранные пиксели,
 * никакой посторонний байт из исходного файла в него попасть не может.
 *
 * GIF не трогаем: sharp разбирает его как один кадр, и анимация терялась
 * бы молча. Единственный формат без строгого потолка размера и обрезки
 * метаданных — риск умеренный (анимации не бывают с гигапиксельной сеткой
 * координат внутри).
 */
const MAX_DIMENSION = 2000
const THUMB_DIMENSION = 480
/* Имя уменьшенной версии предсказуемо: <тот же стем>-sm.jpg (см. makeThumb
   и saveImage ниже). Восьмизначный шестнадцатеричный хвост в стеме —
   случайный (см. safeName) и с обычным именем файла, которое загрузил бы
   человек, не совпадёт. */
const THUMB_RE = /-[0-9a-f]{8}-sm\.jpg$/i
const ENCODERS = {
  jpg: (img) => img.jpeg({ quality: 85, mozjpeg: true }),
  png: (img) => img.png({ compressionLevel: 8 }),
  webp: (img) => img.webp({ quality: 85 }),
}

/** Пересжимает и ужимает до потолка размера. Не смогла — отдаёт буфер как
    есть: заказчику важнее, чтобы фото сохранилось, а не идеальная обработка. */
async function reencode(buf, ext) {
  const encode = ENCODERS[ext]
  if (!encode) return buf
  try {
    // .rotate() без аргументов — поворачивает по EXIF Orientation, ПЕРЕД
    // тем как остальные метаданные (включая эту же Orientation) отбрасываются.
    // Без этого шага снимок с телефона, снятый «на бок», лёг бы на сайт
    // повёрнутым — EXIF, который это компенсировал, мы как раз стираем.
    const pipeline = encode(sharp(buf, { failOn: 'none' }).rotate().resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    }))
    return await pipeline.toBuffer()
  } catch (e) {
    console.warn('sharp: не удалось обработать изображение, сохраняю как есть:', e.message)
    return buf
  }
}

/** Уменьшенная версия для карточек каталога (см. Media в src/components/ui.jsx) —
    всегда JPEG независимо от исходного формата: превью маленькое, точная
    передача формата ему не нужна, а один формат проще кэшировать. */
async function makeThumb(buf) {
  try {
    return await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
  } catch (e) {
    console.warn('sharp: не удалось собрать превью:', e.message)
    return null
  }
}

/**
 * Записывает картинку на диск: основной файл плюс уменьшенную версию
 * `<имя>-sm.<расширение>` рядом (см. makeThumb). Возвращает
 * { name, path, size, thumbPath } либо бросает ошибку с полем status.
 */
export async function saveImage(buf, originalName = '') {
  const kind = detectImage(buf)
  if (!kind) {
    throw Object.assign(
      new Error('Это не картинка. Подойдут JPG, PNG, WebP или GIF (SVG не принимаем — в нём может быть код).'),
      { status: 415 }
    )
  }

  const processed = kind.ext === 'gif' ? buf : await reencode(buf, kind.ext)
  const saved = writeUpload(processed, originalName, kind, 'img')

  let thumbPath = null
  if (kind.ext !== 'gif') {
    const thumbBuf = await makeThumb(buf)
    if (thumbBuf) {
      const stem = saved.name.replace(/\.[^.]+$/, '')
      const thumbName = `${stem}-sm.jpg`
      writeFileSync(join(UPLOAD_DIR, thumbName), thumbBuf)
      thumbPath = `${UPLOAD_URL_PREFIX}/${thumbName}`
    }
  }

  return { ...saved, thumbPath }
}

/**
 * Записывает файл сертификата: фото документа или сам документ (PDF/DOC).
 * В отличие от saveImage принимает оба вида — заказчику может быть проще
 * сфотографировать бумажный сертификат, чем найти его скан.
 */
export function saveCertFile(buf, originalName = '') {
  const kind = detectImage(buf) || detectDocument(buf)
  if (!kind) {
    throw Object.assign(
      new Error('Файл не подходит. Подойдёт фото сертификата (JPG, PNG, WebP, GIF) или документ (PDF, DOC, DOCX).'),
      { status: 415 }
    )
  }
  return writeUpload(buf, originalName, kind, 'doc')
}

/**
 * Удаление файла. Имя проверяем и приводим к basename: даже если в запрос
 * попадёт «../../data/store.json», удалится в худшем случае несуществующий
 * файл внутри каталога загрузок.
 */
export function removeFile(name) {
  const safe = basename(String(name || ''))
  if (!safe || safe.startsWith('.')) return false
  const full = join(UPLOAD_DIR, safe)
  // resolve на случай хитрых имён: путь обязан остаться внутри каталога.
  if (!resolve(full).startsWith(resolve(UPLOAD_DIR))) return false
  if (!existsSync(full)) return false
  unlinkSync(full)

  // Уменьшенная версия удаляется вместе с основной — иначе на диске
  // навсегда остаётся сиротский -sm.jpg без картинки, на которую он ссылался.
  const thumb = join(UPLOAD_DIR, safe.replace(/\.[^.]+$/, '-sm.jpg'))
  if (thumb !== full && existsSync(thumb)) {
    try {
      unlinkSync(thumb)
    } catch {
      /* превью — не главное, ошибку удаления игнорируем */
    }
  }
  return true
}

/** Есть ли такой файл (используется при отдаче). */
export function fileExists(name) {
  const safe = basename(String(name || ''))
  if (!safe || safe.startsWith('.')) return null
  const full = join(UPLOAD_DIR, safe)
  if (!resolve(full).startsWith(resolve(UPLOAD_DIR)) || !existsSync(full)) return null
  return full
}

/**
 * Файлы на диске, которых нет в описи (и наоборот).
 * Пригождается после восстановления из бэкапа: опись и каталог могли
 * разъехаться, и лучше показать это честно, чем рисовать битые картинки.
 *
 * Уменьшенные версии (см. makeThumb выше) сюда не попадают: это не
 * самостоятельная картинка, а служебный файл при основной, в опись он и
 * не должен записываться — иначе библиотека фото в админке задваивалась
 * бы на каждый снимок.
 */
export function listFiles() {
  ensureDir()
  return readdirSync(UPLOAD_DIR)
    .filter((f) => !f.endsWith('.part') && !f.startsWith('.') && !THUMB_RE.test(f))
    .map((f) => {
      const st = statSync(join(UPLOAD_DIR, f))
      return { name: f, path: `${UPLOAD_URL_PREFIX}/${f}`, size: st.size, at: st.mtime.toISOString() }
    })
}
