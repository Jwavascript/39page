/**
 * 출시 패키지 (M10-6) — `dist/` 를 검사하고 Chrome 웹 스토어에 올릴 ZIP 을 만든다.
 *
 *   npm run package   →  release/39page-extension-<버전>.zip  (+ .sha256)
 *
 * - 의존성을 더하지 않는다. Node 의 zlib(deflateRaw · crc32)로 ZIP 을 직접 쓴다.
 * - 재현 가능하게 — 항목은 경로 순, 시각은 1980-01-01 00:00 고정. 같은 dist 면 같은 해시.
 * - 넣기 전에 검사하고(소스맵 · 개발 주소 · 원격 코드 흔적 · 버전), 만든 뒤 ZIP 을 다시
 *   읽어 항목과 내용이 dist 와 같은지 확인한다. 하나라도 어긋나면 ZIP 을 남기지 않는다.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const releaseDir = join(root, 'release')
const failures = []
const fail = (message) => failures.push(message)

function listFiles(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? listFiles(path) : [path]
    })
    .sort()
}

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json 이 없다 — 먼저 npm run build')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version) {
  fail(`manifest 버전(${manifest.version})과 package.json 버전(${pkg.version})이 다르다`)
}

const files = listFiles(dist).map((path) => ({
  path,
  name: relative(dist, path).split('\\').join('/'),
  data: readFileSync(path),
}))

// ---------- 넣기 전 검사 ----------
const ALLOWED =
  /^(manifest\.json|background\.js|content\.js|icons\/icon-(16|32|48|128)\.png|src\/popup\/index\.html|assets\/[\w.-]+\.(js|css))$/
for (const file of files) {
  if (!ALLOWED.test(file.name)) fail(`예상하지 못한 파일 — ${file.name}`)
  if (file.name.endsWith('.map')) fail(`소스맵 — ${file.name}`)
  if (/\.(js|css|html|json)$/.test(file.name)) {
    const text = file.data.toString('utf8')
    if (/sourceMappingURL/.test(text)) fail(`소스맵 주석 — ${file.name}`)
    if (/localhost|127\.0\.0\.1|dist-dev/.test(text)) fail(`개발 주소·경로 — ${file.name}`)
    if (/\beval\s*\(|new\s+Function\s*\(/.test(text))
      fail(`원격 코드 흔적(eval · new Function) — ${file.name}`)
    if (
      /https?:\/\/(?!39page\.com\b|www\.youtube\.com\b|youtube\.com\b|m\.youtube\.com\b|music\.youtube\.com\b|www\.w3\.org\b|vuejs\.org\b)[a-z0-9.-]+/i.test(
        text,
      )
    ) {
      const found = text.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []
      const odd = [...new Set(found)].filter(
        (url) => !/(39page\.com|youtube\.com|w3\.org|vuejs\.org)$/i.test(url),
      )
      if (odd.length > 0) fail(`예상하지 못한 주소 ${odd.join(', ')} — ${file.name}`)
    }
  }
}
for (const needed of [
  'manifest.json',
  'background.js',
  'content.js',
  'src/popup/index.html',
  'icons/icon-128.png',
]) {
  if (!files.some((file) => file.name === needed)) fail(`빠진 파일 — ${needed}`)
}

if (failures.length > 0) {
  for (const message of failures) console.error(`✖ ${message}`)
  process.exit(1)
}

// ---------- ZIP 쓰기 (deflate, 고정 시각) ----------
const DOS_TIME = 0 // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01
const locals = []
const centrals = []
let offset = 0
for (const file of files) {
  const name = Buffer.from(file.name, 'utf8')
  const compressed = deflateRawSync(file.data, { level: 9 })
  const checksum = crc32(file.data) >>> 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // 필요한 버전
  local.writeUInt16LE(0x0800, 6) // UTF-8 이름
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(file.data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(local, name, compressed)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(file.data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(offset, 42)
  centrals.push(central, name)
  offset += local.length + name.length + compressed.length
}
const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)
const zip = Buffer.concat([...locals, ...centrals, end])

// ---------- 다시 읽어 확인 ----------
function readBack(buffer) {
  const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(endAt + 10)
  let at = buffer.readUInt32LE(endAt + 16)
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const localAt = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const size = buffer.readUInt32LE(localAt + 18)
    const dataAt =
      localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28)
    const data = inflateRawSync(buffer.subarray(dataAt, dataAt + size))
    if (crc32(data) >>> 0 !== buffer.readUInt32LE(at + 16)) throw new Error(`CRC 불일치 — ${name}`)
    entries.push({ name, data })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
const entries = readBack(zip)
const same =
  entries.length === files.length &&
  entries.every(
    (entry, index) => entry.name === files[index].name && entry.data.equals(files[index].data),
  )
if (!same) {
  console.error('✖ ZIP 을 다시 읽은 내용이 dist 와 다르다')
  process.exit(1)
}

mkdirSync(releaseDir, { recursive: true })
const zipName = `39page-extension-${manifest.version}.zip`
const zipPath = join(releaseDir, zipName)
rmSync(zipPath, { force: true })
writeFileSync(zipPath, zip)
const sha256 = createHash('sha256').update(zip).digest('hex')
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`)

console.log(
  `패키지 — release/${zipName} (${String(zip.length)} 바이트, 파일 ${String(files.length)}개)`,
)
for (const file of files) console.log(`  ${file.name} (${String(file.data.length)})`)
console.log(`SHA-256 ${sha256}`)
console.log(
  '검사 통과 — 소스맵 없음 · 개발 주소 없음 · eval/new Function 없음 · 버전 일치 · 다시 읽기 일치',
)
