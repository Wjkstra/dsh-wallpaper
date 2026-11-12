/**
 * Host half of the Furina desktop-decoration bundle.
 *
 * Besides the two default media routes this Host face owns the user's custom
 * media: uploading a replacement boot movie or wallpaper, reporting which file
 * is active, and resetting either kind back to the packaged default. Files live
 * under `$DSH_HOME/furina-media` so they survive app updates and restarts.
 *
 * Routes:
 *   GET/HEAD    /dsh-furina/media/boot|background
 *   POST        /dsh-furina/media/boot|background   raw file body
 *   DELETE      /dsh-furina/media/boot|background   restore the packaged default
 *   GET         /dsh-furina/media-info              active source for both kinds
 *   GET/HEAD    /dsh-furina/boot.mp4, /dsh-furina/background.jpg  aliases
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
const MEDIA_DIR = join(DSH_HOME, 'furina-media')
const META_FILE = join(MEDIA_DIR, 'media.json')

const KINDS = {
  boot: {
    defaultPath: join(ROOT, 'assets', 'boot.mp4'),
    defaultMime: 'video/mp4',
    defaultName: 'dsh-boot-original.mp4',
    maxBytes: 300 * 1024 * 1024,
    types: { 'video/mp4': 'mp4', 'video/webm': 'webm' },
  },
  background: {
    defaultPath: join(ROOT, 'assets', 'background.jpg'),
    defaultMime: 'image/jpeg',
    defaultName: '水光歌剧院中的优雅舞者.jpg',
    maxBytes: 50 * 1024 * 1024,
    types: {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/bmp': 'bmp',
    },
  },
}

class TooLargeError extends Error {}
class InvalidMediaError extends Error {}

/** The Host route table needs the web server, the only carrier this bundle uses. */
export const inject = ['webServer']

/**
 * Register the media routes for the lifetime of the plugin fiber.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const exact = (path, handler) => ctx.webServer.register({ kind: 'exact', path, handler })
  ctx.effect(() => {
    const disposers = [
      exact('/dsh-furina/media/boot', (req, res) => { void handleMedia(req, res, 'boot') }),
      exact('/dsh-furina/media/background', (req, res) => { void handleMedia(req, res, 'background') }),
      exact('/dsh-furina/media-info', (req, res) => { void handleInfo(req, res) }),
      // Kept for the first version of the plugin and for direct browser links.
      exact('/dsh-furina/boot.mp4', (req, res) => { void handleMedia(req, res, 'boot') }),
      exact('/dsh-furina/background.jpg', (req, res) => { void handleMedia(req, res, 'background') }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'furina: media routes')
}

/**
 * Answer one media request: read/stream for GET, replace for POST, default for DELETE.
 * @param request - incoming HTTP request.
 * @param response - response owned by this handler.
 * @param kind - 'boot' or 'background'.
 */
async function handleMedia(request, response, kind) {
  try {
    if (request.method === 'POST') {
      await upload(request, response, kind)
      return
    }
    if (request.method === 'DELETE') {
      await reset(response, kind)
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD, POST, DELETE', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Method Not Allowed')
      return
    }
    const state = await mediaState(kind)
    await serve(request, response, state)
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Internal Server Error')
    } else {
      response.destroy()
    }
    console.error('[dsh-furina] media route failed', error)
  }
}

/**
 * Report the active source of both media kinds as JSON.
 * @param request - incoming HTTP request.
 * @param response - response owned by this handler.
 */
async function handleInfo(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Method Not Allowed')
    return
  }
  try {
    const body = {
      boot: await infoFor('boot'),
      background: await infoFor('background'),
    }
    const text = JSON.stringify(body)
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    })
    response.end(request.method === 'HEAD' ? undefined : text)
  } catch (error) {
    console.error('[dsh-furina] media info failed', error)
    sendJson(response, 500, { ok: false, error: '素材信息读取失败' })
  }
}

/** Read the custom-media manifest; a missing or malformed file means "all defaults". */
async function readMeta() {
  try {
    const value = JSON.parse(await readFile(META_FILE, 'utf8'))
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** Persist the custom-media manifest atomically enough for one local user. */
async function writeMeta(meta) {
  await mkdir(MEDIA_DIR, { recursive: true })
  const temporary = `${META_FILE}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(meta, null, 2), 'utf8')
  await rm(META_FILE, { force: true })
  await rename(temporary, META_FILE)
}

/**
 * Resolve one media kind to the custom file when it still exists, otherwise the packaged default.
 * @param kind - 'boot' or 'background'.
 * @returns file path, media type, display name, size, and modification time.
 */
async function mediaState(kind) {
  const spec = KINDS[kind]
  const meta = await readMeta()
  const record = meta[kind]
  if (record !== null && typeof record === 'object' && typeof record.file === 'string') {
    const path = join(MEDIA_DIR, record.file)
    try {
      const info = await stat(path)
      if (info.isFile()) {
        return {
          path,
          mime: typeof record.mime === 'string' ? record.mime : spec.defaultMime,
          name: typeof record.name === 'string' ? record.name : spec.defaultName,
          size: info.size,
          updatedAt: info.mtimeMs,
          source: 'custom',
        }
      }
    } catch {
      // The recorded custom file disappeared; the packaged default takes over.
    }
  }
  const info = await stat(spec.defaultPath)
  return {
    path: spec.defaultPath,
    mime: spec.defaultMime,
    name: spec.defaultName,
    size: info.size,
    updatedAt: info.mtimeMs,
    source: 'default',
  }
}

/**
 * Client-facing summary of one media kind.
 * @param kind - 'boot' or 'background'.
 */
async function infoFor(kind) {
  const state = await mediaState(kind)
  return {
    source: state.source,
    name: state.name,
    mime: state.mime,
    size: state.size,
    updatedAt: new Date(state.updatedAt).toISOString(),
  }
}

/**
 * Stream one file with HEAD, single-range, ETag revalidation, and no stale cache.
 * @param request - incoming HTTP request.
 * @param response - response owned by this handler.
 * @param state - resolved media state.
 */
async function serve(request, response, state) {
  const etag = `"${state.size.toString(16)}-${Math.floor(state.updatedAt).toString(16)}"`
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' })
    response.end()
    return
  }

  let start = 0
  let end = state.size - 1
  let status = 200
  const range = request.headers.range
  if (typeof range === 'string' && range.startsWith('bytes=') && !range.includes(',')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match === null || (match[1] === '' && match[2] === '')) {
      response.writeHead(416, { 'Content-Range': `bytes */${state.size}`, 'Content-Type': state.mime })
      response.end()
      return
    }
    if (match[1] === '') {
      const suffix = Number(match[2])
      if (!Number.isFinite(suffix) || suffix <= 0) {
        response.writeHead(416, { 'Content-Range': `bytes */${state.size}`, 'Content-Type': state.mime })
        response.end()
        return
      }
      start = Math.max(0, state.size - suffix)
    } else {
      start = Number(match[1])
      if (match[2] !== '') end = Math.min(Number(match[2]), state.size - 1)
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= state.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${state.size}`, 'Content-Type': state.mime })
      response.end()
      return
    }
    status = 206
  }

  response.writeHead(status, {
    'Content-Type': state.mime,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    ETag: etag,
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${state.size}` } : {}),
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  const stream = createReadStream(state.path, { start, end })
  stream.on('error', () => { response.destroy() })
  response.on('close', () => { stream.destroy() })
  stream.pipe(response)
}

/**
 * Replace one media kind with the raw request body.
 * @param request - incoming HTTP request carrying the file bytes.
 * @param response - response owned by this handler.
 * @param kind - 'boot' or 'background'.
 */
async function upload(request, response, kind) {
  const spec = KINDS[kind]
  const contentType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const extension = spec.types[contentType]
  if (extension === undefined) {
    sendJson(response, 415, { ok: false, error: `不支持的媒体类型：${contentType || '未知'}` })
    return
  }

  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > spec.maxBytes) {
    sendJson(response, 413, { ok: false, error: `文件超过 ${Math.round(spec.maxBytes / 1024 / 1024)} MB 上限` })
    return
  }

  const rawName = String(request.headers['x-file-name'] ?? '')
  let name = ''
  try {
    name = decodeURIComponent(rawName).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180)
  } catch {
    name = ''
  }
  if (name === '') name = `自定义.${extension}`

  await mkdir(MEDIA_DIR, { recursive: true })
  const temporary = join(MEDIA_DIR, `.upload-${randomUUID()}.tmp`)
  let received = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > spec.maxBytes) {
        callback(new TooLargeError())
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(request, limiter, createWriteStream(temporary, { flags: 'wx' }))
    await validateMagic(temporary, kind, extension)
    const meta = await readMeta()
    const previous = typeof meta[kind]?.file === 'string' ? meta[kind].file : undefined
    const file = `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`
    const destination = join(MEDIA_DIR, file)
    await rm(destination, { force: true })
    await rename(temporary, destination)
    if (previous !== undefined && previous !== file) await rm(join(MEDIA_DIR, previous), { force: true })
    meta[kind] = {
      file,
      mime: contentType,
      name,
      size: received,
      updatedAt: new Date().toISOString(),
    }
    await writeMeta(meta)
    sendJson(response, 200, { ok: true, kind, ...(await infoFor(kind)) })
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    if (error instanceof TooLargeError) {
      sendJson(response, 413, { ok: false, error: `文件超过 ${Math.round(spec.maxBytes / 1024 / 1024)} MB 上限` })
      return
    }
    if (error instanceof InvalidMediaError) {
      sendJson(response, 415, { ok: false, error: error.message })
      return
    }
    console.error('[dsh-furina] upload failed', error)
    sendJson(response, 500, { ok: false, error: '上传失败' })
  }
}

/**
 * Remove the custom file of one kind and return to the packaged default.
 * @param response - response owned by this handler.
 * @param kind - 'boot' or 'background'.
 */
async function reset(response, kind) {
  try {
    const meta = await readMeta()
    const previous = typeof meta[kind]?.file === 'string' ? meta[kind].file : undefined
    if (previous !== undefined) {
      await rm(join(MEDIA_DIR, previous), { force: true })
      delete meta[kind]
      await writeMeta(meta)
    }
    sendJson(response, 200, { ok: true, kind, ...(await infoFor(kind)) })
  } catch (error) {
    console.error('[dsh-furina] reset failed', error)
    sendJson(response, 500, { ok: false, error: '恢复默认失败' })
  }
}

/** Reject a file whose first bytes do not match the declared media type. */
async function validateMagic(path, kind, extension) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead)
    const ascii = head.toString('ascii')
    let valid = false
    if (kind === 'boot') {
      if (extension === 'mp4') valid = head.length >= 8 && head.subarray(4, 8).toString('ascii') === 'ftyp'
      if (extension === 'webm') valid = head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
    } else if (extension === 'jpg') {
      valid = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    } else if (extension === 'png') {
      valid = head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    } else if (extension === 'gif') {
      valid = /^GIF8[79]a/.test(ascii)
    } else if (extension === 'webp') {
      valid = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
    } else if (extension === 'bmp') {
      valid = ascii.startsWith('BM')
    }
    if (!valid) throw new InvalidMediaError('文件内容与所选格式不匹配')
  } finally {
    await handle.close()
  }
}

/** Write one small JSON response without throwing on a disconnected client. */
function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  response.end(text)
}
