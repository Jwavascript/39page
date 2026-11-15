/**
 * ZIP 읽기 · 쓰기 (M12-4, ADR 0034 · ARTWORK_DESIGN §7-2).
 *
 * 표준 ZIP 을 `fflate` 로 만든다 — 자체 형식을 만들지 않는다. 읽기는 **스트리밍으로 풀며 실제 바이트를 센다**:
 * 머리말의 선언 크기는 거짓일 수 있으므로(ZIP bomb) 풀린 양이 한도를 넘는 순간 멈춘다.
 *
 * 읽기 규칙 (부르는 쪽이 정책으로 준다):
 * - 허용 목록에 있는 경로만 — `..` · 절대 경로 · `\` · 빈 이름 · 다른 이름은 거절
 * - 항목 수 · 항목별 크기 · 전체 크기 · 압축률 한도
 * - 같은 경로 두 번은 거절
 * - 압축 방식은 저장(0) · deflate(8) 만
 *
 * 풀어 낸 바이트를 해석하지 않는다 — JSON 은 부르는 쪽이 `JSON.parse`, 이미지는 다시 검증한다.
 */
import { Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  readonly path: string
  readonly bytes: Uint8Array
  /** 이미 압축된 이미지는 `false` (저장만). JSON 은 `true`. */
  readonly compress: boolean
}

/** 다른 realm 의 배열이면 이 realm 으로 복사한다 — 같으면 그대로 (큰 파일을 두 번 들지 않는다). */
function sameRealm(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

/** ZIP 을 만든다. 같은 경로가 둘이면 던진다 (부르는 쪽의 결함). */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const tree: Zippable = {}
  for (const entry of entries) {
    if (entry.path in tree) throw new Error(`duplicate zip path: ${entry.path}`)
    // 이 realm 의 Uint8Array 로 옮긴다 — fflate 는 `instanceof Uint8Array` 로 파일과 폴더를 가르므로, 다른 realm
    // (예: jsdom 의 TextEncoder)에서 온 배열은 폴더로 오인된다. 브라우저에서는 같은 realm 이라 복사일 뿐이다.
    tree[entry.path] = [sameRealm(entry.bytes), { level: entry.compress ? 6 : 0 }]
  }
  return zipSync(tree)
}

/** ZIP 서명 (`PK\x03\x04`) 으로 시작하는가. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

export interface ZipReadPolicy {
  /** 이 경로를 받을지 — 받으면 그 항목의 최대 바이트, 아니면 `null`. */
  allow(path: string): number | null
  readonly maxEntries: number
  readonly maxTotalBytes: number
  /** 압축률 상한 (풀린 크기 / 압축 크기). 풀린 크기가 1 MB 를 넘는 항목에만 본다. */
  readonly maxRatio: number
}

export type ZipReadError =
  | { readonly kind: 'not-zip' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'bad-path'; readonly path: string }
  | { readonly kind: 'duplicate-path'; readonly path: string }
  | { readonly kind: 'too-many-entries' }
  | { readonly kind: 'entry-too-large'; readonly path: string }
  | { readonly kind: 'total-too-large' }
  | { readonly kind: 'suspicious-ratio'; readonly path: string }
  | { readonly kind: 'unsupported-compression'; readonly path: string }

export type ZipReadResult =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly error: ZipReadError }

/** 경로가 모양부터 안전한가 — 허용 목록 이전의 기본 거름. */
export function isSafeZipPath(path: string): boolean {
  if (path === '' || path.length > 200) return false
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  if (/^[a-zA-Z]:/.test(path)) return false
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function hasEndRecord(bytes: Uint8Array): boolean {
  const floor = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return true
    }
  }
  return false
}

class Stop extends Error {
  constructor(readonly error: ZipReadError) {
    super(error.kind)
  }
}

const CHUNK = 64 * 1024
const RATIO_FLOOR = 1024 * 1024

/** ZIP 을 읽는다. 정책을 어기면 **아무것도 돌려주지 않는다** (부분 결과 없음). */
export function readZip(input: Uint8Array, policy: ZipReadPolicy): ZipReadResult {
  let bytes = input
  if (!looksLikeZip(bytes)) return { ok: false, error: { kind: 'not-zip' } }
  bytes = sameRealm(bytes)
  // 끝의 중앙 디렉터리 끝 레코드(EOCD, `PK`)가 없으면 잘린 파일이다. 스트리밍 읽기는 앞쪽만으로도 항목을
  // 내주므로 따로 본다. 레코드는 마지막 22 + 65,535(주석) 바이트 안에 있다.
  if (!hasEndRecord(bytes)) return { ok: false, error: { kind: 'corrupt' } }

  const files = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  let entries = 0
  let total = 0
  let stop: ZipReadError | null = null

  const unzip = new Unzip((file) => {
    if (stop !== null) return
    try {
      entries += 1
      if (entries > policy.maxEntries) throw new Stop({ kind: 'too-many-entries' })
      const path = file.name
      // 디렉터리 항목은 내용이 없다 — 건너뛴다 (허용 목록의 파일만 쓴다).
      if (path.endsWith('/') && (file.originalSize ?? 0) === 0) return
      if (!isSafeZipPath(path)) throw new Stop({ kind: 'bad-path', path })
      const limit = policy.allow(path)
      if (limit === null) throw new Stop({ kind: 'bad-path', path })
      if (seen.has(path)) throw new Stop({ kind: 'duplicate-path', path })
      seen.add(path)
      if (file.compression !== 0 && file.compression !== 8) {
        throw new Stop({ kind: 'unsupported-compression', path })
      }
      if (file.originalSize !== undefined && file.originalSize > limit) {
        throw new Stop({ kind: 'entry-too-large', path })
      }

      const chunks: Uint8Array[] = []
      let size = 0
      file.ondata = (error, chunk, final) => {
        if (stop !== null) return
        try {
          if (error !== null) throw new Stop({ kind: 'corrupt' })
          size += chunk.length
          total += chunk.length
          if (size > limit) throw new Stop({ kind: 'entry-too-large', path })
          if (total > policy.maxTotalBytes) throw new Stop({ kind: 'total-too-large' })
          if (
            file.size !== undefined &&
            file.size > 0 &&
            size > RATIO_FLOOR &&
            size / file.size > policy.maxRatio
          ) {
            throw new Stop({ kind: 'suspicious-ratio', path })
          }
          chunks.push(chunk)
          if (final) {
            if (file.originalSize !== undefined && size !== file.originalSize) {
              throw new Stop({ kind: 'corrupt' })
            }
            const joined = new Uint8Array(size)
            let offset = 0
            for (const part of chunks) {
              joined.set(part, offset)
              offset += part.length
            }
            files.set(path, joined)
          }
        } catch (caught) {
          stop = caught instanceof Stop ? caught.error : { kind: 'corrupt' }
          file.terminate()
        }
      }
      file.start()
    } catch (caught) {
      stop = caught instanceof Stop ? caught.error : { kind: 'corrupt' }
    }
  })
  unzip.register(UnzipInflate)

  try {
    for (let offset = 0; offset < bytes.length && stop === null; offset += CHUNK) {
      const end = Math.min(bytes.length, offset + CHUNK)
      unzip.push(bytes.subarray(offset, end), end === bytes.length)
    }
  } catch {
    if (stop === null) stop = { kind: 'corrupt' }
  }

  if (stop !== null) return { ok: false, error: stop }
  // 허용 목록에 있는데 끝까지 풀리지 않은 항목(잘린 파일)은 seen 에만 있다.
  for (const path of seen) if (!files.has(path)) return { ok: false, error: { kind: 'corrupt' } }
  return { ok: true, files }
}

export const ZIP_ERROR_MESSAGE: Readonly<Record<ZipReadError['kind'], string>> = {
  'not-zip': 'ZIP 파일이 아닙니다.',
  corrupt: 'ZIP 파일이 손상되었습니다.',
  'bad-path': '39page 파일에 없는 항목이 들어 있어 열지 않았습니다.',
  'duplicate-path': '같은 이름의 항목이 두 번 들어 있어 열지 않았습니다.',
  'too-many-entries': '항목이 너무 많아 열지 않았습니다.',
  'entry-too-large': '너무 큰 항목이 들어 있어 열지 않았습니다.',
  'total-too-large': '풀었을 때 크기가 너무 커서 열지 않았습니다.',
  'suspicious-ratio': '압축률이 비정상적으로 높은 항목이 있어 열지 않았습니다 (압축 폭탄 의심).',
  'unsupported-compression': '지원하지 않는 압축 방식입니다.',
}
