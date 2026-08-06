/**
 * Извлечение текста из прайс-листа/спецификации для AI-импорта каталога
 * (задача 7 дорожной карты). Поддерживаются XLSX, DOCX, PDF — то же самое,
 * чем обычно присылают прайс от завода. Дальше сырой текст уходит в
 * server/ai.js importCatalog(), который уже раскладывает его на модели.
 *
 * Здесь только извлечение, без ИИ: так проще проверить и переиспользовать
 * при желании отдельно от AI-слоя.
 */
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

/** Сколько символов текста отдаём дальше в ИИ. Прайс-лист на полсотни
    моделей укладывается с большим запасом; всё, что длиннее, — почти
    наверняка не то, что нужно, и раздувает счёт за токены без пользы. */
export const MAX_TEXT_LENGTH = 40000

const EXT_BY_MIME = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
}

/** Расширение файла — по имени, а если его нет, то по MIME из заголовка. */
export function detectExt(fileName, mime) {
  const byName = (fileName || '').toLowerCase().match(/\.(xlsx|docx|pdf)$/)?.[1]
  return byName || EXT_BY_MIME[mime] || null
}

/** XLSX → построчный текст: лист за листом, ячейки через таб. Формулы не
    трогаем — ExcelJS сам отдаёт последнее посчитанное значение. */
async function extractXlsx(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const parts = []
  wb.eachSheet((sheet) => {
    parts.push(`### Лист: ${sheet.name}`)
    sheet.eachRow((row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null) return ''
        if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
        if (typeof v === 'object' && 'text' in v) return String(v.text ?? '')
        return String(v)
      })
      if (cells.some((c) => c.trim())) parts.push(cells.join('\t'))
    })
  })
  return parts.join('\n')
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer })
  try {
    const { text } = await parser.getText()
    return text
  } finally {
    await parser.destroy()
  }
}

/** Извлекает текст из файла. Бросает понятную ошибку, если формат не
    поддержан или файл не читается (битый/зашифрованный/не тот формат под
    чужим расширением). */
export async function extractText(buffer, ext) {
  let raw
  try {
    if (ext === 'xlsx') raw = await extractXlsx(buffer)
    else if (ext === 'docx') raw = await extractDocx(buffer)
    else if (ext === 'pdf') raw = await extractPdf(buffer)
    else throw Object.assign(new Error('Поддерживаются только файлы XLSX, DOCX и PDF'), { status: 415 })
  } catch (e) {
    if (e.status) throw e
    throw Object.assign(new Error('Не удалось прочитать файл — возможно, он повреждён'), { status: 400 })
  }

  const text = (raw || '').trim()
  if (!text) {
    throw Object.assign(new Error('В файле не нашлось текста'), { status: 400 })
  }

  const truncated = text.length > MAX_TEXT_LENGTH
  return {
    text: truncated ? text.slice(0, MAX_TEXT_LENGTH) : text,
    truncated,
  }
}
