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

/** Потолок на один файл. Клиент ужимает снимок до загрузки, так что
    упереться сюда можно только специально. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024

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
 */
const ОПАСНЫЕ_ФРАГМЕНТЫ = ['<script', '<html', '<!doctype html', '<?php', '<svg', '<iframe']

export function looksLikePolyglot(buf) {
  // Достаточно проверить начало: разметка, чтобы исполниться, должна
  // попасться браузеру рано, а сплошное сканирование мегабайтов фото на
  // каждой загрузке — лишняя работа.
  const head = buf.slice(0, 4096).toString('latin1').toLowerCase()
  return ОПАСНЫЕ_ФРАГМЕНТЫ.some((frag) => head.includes(frag))
}

/** Отдача: какой Content-Type ставить файлу по его имени. */
export function mimeByName(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return SIGNATURES.find((s) => s.ext === ext)?.mime || 'application/octet-stream'
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
function safeName(originalName, ext) {
  const stem = slugify(String(originalName || '').replace(/\.[^.]+$/, ''), 'img').slice(0, 40)
  return `${stem || 'img'}-${randomUUID().slice(0, 8)}.${ext}`
}

/**
 * Записывает картинку на диск.
 * Возвращает { name, path, size } либо бросает ошибку с полем status.
 */
export function saveImage(buf, originalName = '') {
  const kind = detectImage(buf)
  if (!kind) {
    throw Object.assign(
      new Error('Это не картинка. Подойдут JPG, PNG, WebP или GIF (SVG не принимаем — в нём может быть код).'),
      { status: 415 }
    )
  }
  if (buf.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error('Файл слишком большой (максимум 8 МБ)'), { status: 413 })
  }
  if (looksLikePolyglot(buf)) {
    throw Object.assign(
      new Error('Внутри файла нашлась разметка страницы — такой файл не принимаем. Пересохраните картинку в графическом редакторе.'),
      { status: 415 }
    )
  }

  ensureDir()

  if (usedBytes() + buf.length > MAX_TOTAL_BYTES) {
    throw Object.assign(
      new Error('Место под картинки закончилось. Удалите ненужные в разделе «Фотографии».'),
      { status: 507 }
    )
  }

  const name = safeName(originalName, kind.ext)
  const full = join(UPLOAD_DIR, name)

  // Через временный файл: оборванная загрузка не оставит в библиотеке
  // недописанную картинку, которая потом молча ломает вёрстку карточки.
  const tmp = full + '.part'
  writeFileSync(tmp, buf)
  renameSync(tmp, full)

  return { name, path: `${UPLOAD_URL_PREFIX}/${name}`, size: buf.length, mime: kind.mime }
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
 */
export function listFiles() {
  ensureDir()
  return readdirSync(UPLOAD_DIR)
    .filter((f) => !f.endsWith('.part') && !f.startsWith('.'))
    .map((f) => {
      const st = statSync(join(UPLOAD_DIR, f))
      return { name: f, path: `${UPLOAD_URL_PREFIX}/${f}`, size: st.size, at: st.mtime.toISOString() }
    })
}
