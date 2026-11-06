/**
 * 타입 안전한 `localStorage` 래퍼.
 *
 * 설계 원칙 (`docs/architecture/SYSTEM_DESIGN.md` §7, `MVP_SPEC.md` F9):
 * - 읽기는 방어적이다. 어떤 입력에도 예외를 던지지 않고 기본값으로 복구한다.
 * - **읽기는 저장소에 쓰지 않는다.** 검증·마이그레이션이 실패해도 기존 데이터를
 *   지우거나 덮어쓰지 않는다. 복구 가능성을 사용자에게서 빼앗지 않기 위해서다.
 * - 쓰기 실패는 삼키지 않고 호출자에게 결과로 알린다.
 * - 저장 객체는 `{ version, data }` 형태다. 키에는 버전을 넣지 않는다.
 */

/** 저장소에 들어가는 봉투 형태. */
export interface StorageEnvelope<T> {
  version: number
  data: T
}

export type ReadOutcome =
  /** 저장된 데이터를 현재 버전으로 읽었다. */
  | 'stored'
  /** 이전 버전 데이터를 마이그레이션해서 읽었다. 호출자가 저장을 고려할 수 있다. */
  | 'migrated'
  /** 저장된 값이 없다. 첫 실행이다. */
  | 'empty'
  /** 저장소 자체에 접근할 수 없다 (사생활 보호 모드, 차단 등). */
  | 'unavailable'
  /** JSON으로 해석할 수 없거나 봉투 형태가 아니다. */
  | 'malformed'
  /** 봉투는 읽었지만 `validate`가 거부했다. */
  | 'invalid'
  /** 버전이 다르고 마이그레이션 수단이 없다 (`migrate` 미제공 또는 상위 버전). */
  | 'version-mismatch'
  /** 마이그레이션을 시도했지만 실패했다 (예외 또는 결과가 검증 실패). */
  | 'migration-failed'

export interface ReadResult<T> {
  /** 항상 사용 가능한 값. 실패 시 `fallback()`의 결과다. */
  value: T
  /**
   * 값의 출처. `'stored'`와 `'migrated'`만 저장된 데이터를 쓴 경우다.
   * 나머지는 모두 기본값이며, 저장소는 **변경되지 않았다.**
   */
  outcome: ReadOutcome
}

export type WriteFailureReason =
  /** 저장소에 접근할 수 없다. */
  | 'unavailable'
  /** 용량을 초과했다. */
  | 'quota-exceeded'
  /** 값을 JSON으로 직렬화할 수 없다. */
  | 'serialize-failed'
  /** 그 외의 오류. */
  | 'unknown'

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: WriteFailureReason; readonly error?: unknown }

export interface DefineStorageOptions<T> {
  /** 고정 저장 키. `STORAGE_KEYS`를 쓴다. */
  key: string
  /** 현재 스키마 버전. 정수여야 한다. */
  version: number
  /**
   * 기본값 **팩토리**.
   *
   * 값이 아니라 함수인 이유: 값으로 받으면 모든 읽기가 같은 객체를 돌려주고,
   * 호출자가 그것을 변형하면 이후의 모든 기본값이 오염된다.
   * 매 호출마다 새 객체를 만들어 돌려주어야 한다.
   */
  fallback: () => T
  /**
   * 필수 검증기. 저장소에서 읽은 알 수 없는 값을 받아
   * 유효하면 `T`를, 아니면 `null`을 돌려준다.
   *
   * 정규화된 값을 돌려줘도 된다 (불량 항목 제거, 깨진 참조 보정 등).
   * 돌려준 값이 그대로 쓰인다.
   */
  validate: (value: unknown) => T | null
  /**
   * 이전 버전 데이터를 현재 버전 형태로 옮긴다.
   *
   * 반환값은 다시 `validate`를 통과해야 한다. 예외를 던져도 안전하게
   * 처리되며 저장소는 변경되지 않는다.
   */
  migrate?: (data: unknown, fromVersion: number) => unknown
}

export interface TypedStorage<T> {
  readonly key: string
  readonly version: number
  read(): ReadResult<T>
  write(value: T): WriteResult

  /**
   * 저장된 **원문** 그대로. 값이 없거나 저장소를 쓸 수 없으면 `null` (M8-3).
   *
   * 왜 필요한가: 해석하지 못한 원본을 사용자에게 **파일로 넘겨주기** 위해서다.
   * 백업 가져오기가 보호 상태의 원본을 덮어쓰기 전에 "원문 내려받기" 를
   * 제공하는데, 우리가 파싱하지 못한 문자열이므로 `read()` 로는 꺼낼 수 없다.
   *
   * 읽기 전용이고 저장소를 바꾸지 않는다. 매체를 아는 쪽이 이 계층이므로
   * 호출부가 `localStorage` 를 직접 만지지 않아도 된다
   * (`SYSTEM_DESIGN.md` §7.4).
   */
  raw(): string | null

  /**
   * 저장소에 **접근할 수 있는지** (M8-3).
   *
   * `raw()` 의 `null` 은 "값이 없다" 와 "저장소를 못 쓴다" 를 구분하지
   * 못한다. 그 둘은 데이터 보호 판단이 달라진다 — 값이 없으면 덮어쓸 것이
   * 없고, 못 쓰는 상태면 원본을 꺼낼 수도 없다.
   */
  available(): boolean
}

/**
 * `localStorage`를 가져온다.
 *
 * 접근 자체가 던질 수 있다 (차단된 쿠키, 일부 브라우저의 사생활 보호 모드).
 * 모듈 로드 시점에 캐시하지 않는다. 테스트에서 교체할 수 있고,
 * 늦게 사용 가능해지는 환경도 처리하기 위해서다.
 */
function getBackend(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isQuotaExceeded(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22
    )
  }
  return error instanceof Error && error.name === 'QuotaExceededError'
}

/** 파싱된 값이 `{ version: number, data: unknown }` 형태인지 확인한다. */
function asEnvelope(parsed: unknown): StorageEnvelope<unknown> | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  if (!('version' in parsed) || !('data' in parsed)) {
    return null
  }
  const { version, data } = parsed as { version: unknown; data: unknown }
  if (!Number.isInteger(version)) {
    return null
  }
  return { version: version as number, data }
}

export function defineStorage<T>(options: DefineStorageOptions<T>): TypedStorage<T> {
  const { key, version, fallback, validate, migrate } = options

  if (!Number.isInteger(version)) {
    throw new TypeError(`defineStorage: version must be an integer, received ${String(version)}`)
  }

  function fallbackResult(outcome: ReadOutcome): ReadResult<T> {
    return { value: fallback(), outcome }
  }

  function read(): ReadResult<T> {
    const backend = getBackend()
    if (backend === null) {
      return fallbackResult('unavailable')
    }

    let raw: string | null
    try {
      raw = backend.getItem(key)
    } catch {
      return fallbackResult('unavailable')
    }

    if (raw === null) {
      return fallbackResult('empty')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fallbackResult('malformed')
    }

    const envelope = asEnvelope(parsed)
    if (envelope === null) {
      return fallbackResult('malformed')
    }

    if (envelope.version === version) {
      const validated = validate(envelope.data)
      return validated === null
        ? fallbackResult('invalid')
        : { value: validated, outcome: 'stored' }
    }

    // 버전이 다르다. 상위 버전은 되돌릴 수 없고, migrate가 없으면 옮길 수 없다.
    if (migrate === undefined || envelope.version > version) {
      return fallbackResult('version-mismatch')
    }

    let migrated: unknown
    try {
      migrated = migrate(envelope.data, envelope.version)
    } catch {
      return fallbackResult('migration-failed')
    }

    const validated = validate(migrated)
    if (validated === null) {
      return fallbackResult('migration-failed')
    }

    // 저장소에 다시 쓰지 않는다. 호출자가 다음 저장 시점에 반영한다.
    return { value: validated, outcome: 'migrated' }
  }

  function write(value: T): WriteResult {
    let serialized: string
    try {
      serialized = JSON.stringify({ version, data: value } satisfies StorageEnvelope<T>)
    } catch (error) {
      return { ok: false, reason: 'serialize-failed', error }
    }

    const backend = getBackend()
    if (backend === null) {
      return { ok: false, reason: 'unavailable' }
    }

    try {
      backend.setItem(key, serialized)
      return { ok: true }
    } catch (error) {
      if (isQuotaExceeded(error)) {
        return { ok: false, reason: 'quota-exceeded', error }
      }
      return { ok: false, reason: 'unknown', error }
    }
  }

  function raw(): string | null {
    const backend = getBackend()
    if (backend === null) return null

    try {
      return backend.getItem(key)
    } catch {
      return null
    }
  }

  function available(): boolean {
    const backend = getBackend()
    if (backend === null) return false

    try {
      // 접근 자체가 던지는 환경이 있다. 읽어 봐야 알 수 있다.
      backend.getItem(key)
      return true
    } catch {
      return false
    }
  }

  return { key, version, read, write, raw, available }
}
