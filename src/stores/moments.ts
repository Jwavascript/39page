/**
 * Music Moments 상태 (M9-2).
 *
 * 영상의 한 순간(타임스탬프 + 메모)을 저장·조회·수정·삭제하고 영속화한다.
 *
 * **라이브러리와 완전히 분리된다.** 이 store 는 `library` store 를 import
 * 하지 않고, `39page.library` 를 읽지도 쓰지도 않는다. Moment 는 `videoId`
 * 만을 외부 참조로 가지므로 트랙·플레이리스트를 지워도 남는다
 * (ADR 0019 결정 1·3 / `AGENTS.md` 규칙 2).
 *
 * **재생도 모른다.** 현재 시점 조회와 그 시점으로의 이동은 어댑터와
 * 코디네이터의 일이다 (ADR 0020, M9-3). 이 store 에는 플레이어가 없다.
 *
 * **데이터 보존을 우선한다.** 라이브러리와 **같은 정책**이다 (ADR 0007) —
 * 저장된 원본을 읽지 못했거나 일부만 복구한 경우 `protected` 상태가 되어
 * 평범한 수정이 원본을 조용히 덮어쓰지 않는다. 수정은 메모리에서 계속
 * 되지만 저장만 막힌다.
 */
import { computed, readonly, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  STORAGE_KEYS,
  defineStorage,
  type ReadOutcome,
  type WriteFailureReason,
} from '@/shared/storage'
import { isYouTubeVideoId } from '@/shared/utils/youtube'
import { createId } from '@/shared/utils/id'
import type { Moment, MomentsData } from '@/shared/types'

/** Moments 저장 스키마 버전. 새 키이므로 1 에서 시작한다. */
export const MOMENTS_STORAGE_VERSION = 1

/**
 * 메모 최대 길이.
 *
 * M9-1 이 확정하지 않았고 **M9-2 에서 정했다** (ADR 0019 결정 7).
 * 제목(100자)보다 길게 두는 이유는 메모가 문장이기 때문이고, 상한을 두는
 * 이유는 길이가 곧 저장 용량이기 때문이다. 최대 길이 메모 하나는 봉투까지
 * 합쳐 1 KB 안팎이고, M8-4 가 실측한 `localStorage` 5.12 MB 기준으로
 * **그런 Moment 5000개**가 들어간다.
 *
 * 이 상한은 **입력에만 적용된다.** 저장된 값을 읽을 때는 길이를 보지 않는다
 * (아래 `normalizeMoment` 주석).
 */
export const MAX_MOMENT_NOTE_LENGTH = 500

/**
 * 제목 스냅샷 최대 길이.
 *
 * `MAX_TRACK_TITLE_LENGTH` 와 같은 값이지만 **import 하지 않는다.** 두
 * store 를 독립적으로 두기 위해서다 (`AGENTS.md` 규칙 2). 두 값이 갈라지지
 * 않게 하는 것은 테스트가 한다 (`tests/unit/moments-store.spec.ts`).
 */
export const MAX_MOMENT_TITLE_LENGTH = 100

/* ------------------------------------------------------------------ *
 * 검증과 정규화 — 순수
 * ------------------------------------------------------------------ */

/** 정규화 과정에서 원본과 달라진 내용. */
export interface MomentsNormalizationReport {
  /** 버린 Moment 수. */
  droppedMoments: number
}

export interface MomentsNormalizationResult {
  data: MomentsData
  report: MomentsNormalizationReport
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** 0 이상 유한 정수. `0` 은 **유효한 값**이다 — 영상의 맨 앞이다. */
export function isValidAtSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Moment 하나를 검증한다. 형식이 맞지 않으면 `null`.
 *
 * `normalizeTrack` 과 같은 태도다. 되살릴 수 있는 것만 살리고, **고쳐서
 * 받지 않는다.**
 *
 * - `atSeconds` 가 소수나 문자열이면 **반올림해 살리지 않고 버린다.** 우리가
 *   쓴 값이 아니라는 뜻이고, 고쳐서 받으면 출처를 모르는 값을 사용자
 *   데이터로 승격시키는 셈이다 (`MOMENTS_DESIGN.md` §2).
 * - `videoId` 패턴은 트랙 검증이 쓰는 **같은** `isYouTubeVideoId` 다. 두 벌을
 *   만들면 갈라진다.
 * - 날짜는 **문자열인지만 본다.** 파싱해서 거부하지 않는다 — 해석하지 못하는
 *   타임스탬프 때문에 Moment 전체를 버리면 메모와 시점까지 함께 잃는다.
 *   사용자에게 값있는 부분은 그 둘이다.
 * - 길이 상한을 **보지 않는다.** 상한은 입력 경로의 규칙이고, 이미 저장된
 *   긴 메모를 읽는 자리에서 버리거나 자르면 사용자 데이터가 조용히 사라진다.
 */
export function normalizeMoment(value: unknown): Moment | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.id)) return null
  // M9 의 Moment 출처는 YouTube 단독이다.
  if (value.source !== 'youtube') return null
  if (!isYouTubeVideoId(value.videoId)) return null
  if (!isValidAtSeconds(value.atSeconds)) return null
  if (typeof value.note !== 'string') return null
  if (typeof value.title !== 'string') return null
  if (typeof value.createdAt !== 'string') return null
  if (typeof value.updatedAt !== 'string') return null

  return {
    id: value.id,
    source: 'youtube',
    videoId: value.videoId,
    atSeconds: value.atSeconds,
    note: value.note,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

/**
 * 저장소나 백업에서 읽은 알 수 없는 값을 `MomentsData` 로 정규화한다.
 *
 * `normalizeLibraryData` 와 **같은 모양**이다. 던지지 않고, 버린 것을 세어
 * 보고한다. 호출자는 이 보고를 보고 원본을 덮어쓸지 판단한다.
 *
 * 배열이 아니면 `null` — 복구할 것이 없다. **빈 배열은 유효하다.**
 */
export function normalizeMomentsData(value: unknown): MomentsNormalizationResult | null {
  if (!Array.isArray(value)) return null

  const report: MomentsNormalizationReport = { droppedMoments: 0 }
  const moments: Moment[] = []
  const seenIds = new Set<string>()

  for (const candidate of value) {
    const moment = normalizeMoment(candidate)
    // 중복 id 는 조회·수정·삭제를 모호하게 만든다. 처음 것만 남긴다.
    if (moment === null || seenIds.has(moment.id)) {
      report.droppedMoments += 1
      continue
    }
    seenIds.add(moment.id)
    // 순서를 유지한다.
    moments.push(moment)
  }

  return { data: moments, report }
}

/** 앞뒤 공백을 떼고 길이를 자른다. **빈 값을 거부하지 않는다.** */
function normalizeNote(note: string | undefined): string {
  return (note ?? '').trim().slice(0, MAX_MOMENT_NOTE_LENGTH)
}

/**
 * 제목 스냅샷을 다듬는다.
 *
 * 라이브러리의 `normalizeTitle` 과 달리 **빈 값을 대체 표기로 채우지
 * 않는다.** 빈 스냅샷은 "저장 당시 제목을 몰랐다" 는 뜻이고, 표시 단계의
 * 3단계 규칙이 그것을 구별해야 한다 (`MOMENTS_DESIGN.md` §1-1).
 * 여기서 `YouTube · <videoId>` 를 채우면 2단계와 3단계가 같아진다.
 */
function normalizeSnapshotTitle(title: string | undefined): string {
  return (title ?? '').trim().slice(0, MAX_MOMENT_TITLE_LENGTH)
}

/**
 * Moment 하나를 만든다. **순수 함수다.**
 *
 * `now` 와 `id` 를 밖에서 받는다. `createBackup` 이 `exportedAt: Date` 를
 * 받는 것과 같은 이유다 — 시계와 난수를 건드리지 않으면 테스트가 고정값으로
 * 전부 확인할 수 있고, M10 확장이 같은 함수를 쓸 수 있다 (ADR 0020 §6).
 *
 * **검증하지 않는다.** 검증은 `normalizeMomentsData` 가 한 곳에서 한다
 * (`MOMENTS_DESIGN.md` §6). 호출부가 검증된 값을 넘긴다 — store 의 `add` 는
 * 부르기 전에 `videoId` 와 `atSeconds` 를 확인하고 실패 이유를 돌려준다.
 */
export function createMoment(input: {
  videoId: string
  atSeconds: number
  note: string
  title: string
  now: Date
  id: string
}): Moment {
  const timestamp = input.now.toISOString()

  return {
    id: input.id,
    source: 'youtube',
    videoId: input.videoId,
    atSeconds: input.atSeconds,
    note: normalizeNote(input.note),
    title: normalizeSnapshotTitle(input.title),
    createdAt: timestamp,
    // 만든 직후에는 같다. 메모를 고치면 이쪽만 움직인다.
    updatedAt: timestamp,
  }
}

/* ------------------------------------------------------------------ *
 * 영속화
 * ------------------------------------------------------------------ */

/** 키가 없을 때의 값. **없음은 오류가 아니다** (`MOMENTS_DESIGN.md` §3). */
function emptyMoments(): MomentsData {
  return []
}

/**
 * 마지막 정규화 보고.
 *
 * `defineStorage` 의 `validate` 는 `T | null` 만 돌려줄 수 있어서 무엇을
 * 버렸는지 전달할 수 없다. `validate` 는 `read()` 안에서 **동기적으로**
 * 한 번 호출되므로, 여기에 적어두고 `read()` 직후에 읽으면 안전하다.
 * (라이브러리 store 와 같은 방식이다.)
 */
let lastReport: MomentsNormalizationReport | null = null

/**
 * 보고를 꺼내고 비운다. `read()` 직후에 한 번만 호출한다.
 *
 * 함수로 감싼 이유: 변수를 직접 읽으면 TypeScript 가 바로 위의 `= null`
 * 대입만 보고 `never` 로 좁힌다.
 */
function takeNormalizationReport(): MomentsNormalizationReport | null {
  const report = lastReport
  lastReport = null
  return report
}

export const momentsStorage = defineStorage<MomentsData>({
  key: STORAGE_KEYS.moments,
  version: MOMENTS_STORAGE_VERSION,
  fallback: emptyMoments,
  validate: (value) => {
    const result = normalizeMomentsData(value)
    lastReport = result?.report ?? null
    return result?.data ?? null
  },
})

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/**
 * 저장소에 대한 현재 상태. 라이브러리와 **같은 세 가지**다 (ADR 0007).
 *
 * - `ready` — 정상. 수정하면 저장된다.
 * - `unavailable` — 저장소에 접근할 수 없다. 메모리에서만 동작한다.
 * - `protected` — 저장된 원본을 읽지 못했거나 일부만 복구했다.
 *   **덮어쓰기를 막는다.** 수정은 메모리에서 되지만 저장되지 않는다.
 */
export type MomentsStatus = 'ready' | 'unavailable' | 'protected'

/** 원본을 보호하는 이유. 라이브러리와 같은 네 가지다. */
export type MomentsProtectedReason =
  'malformed' | 'invalid' | 'version-mismatch' | 'partial-recovery'

export type MomentMutationFailure =
  /** 해당 id 의 Moment 가 없다. */
  | 'not-found'
  /** 11자 YouTube 영상 ID 형식이 아니다. */
  | 'invalid-video-id'
  /** 0 이상 유한 정수가 아니다 (음수 · 소수 · `NaN` · `Infinity`). */
  | 'invalid-time'

export type MomentMutationResult =
  | {
      readonly ok: true
      /** 변경 대상 Moment 의 id. 생성 시에는 새로 발급한 id. */
      readonly momentId: string
      /** 저장소에 반영됐는지. `false` 면 메모리에만 반영됐다. */
      readonly persisted: boolean
    }
  | { readonly ok: false; readonly reason: MomentMutationFailure }

function failure(reason: MomentMutationFailure): MomentMutationResult {
  return { ok: false, reason }
}

/**
 * 묶음 추가의 결과.
 *
 * 개별 액션과 모양이 다르다. 대상 id 가 하나가 아니고, **버린 개수를
 * 돌려준다** — 알 수 없는 출처(M10 확장, 백업)에서 온 목록은 일부가 불량일
 * 수 있고, 호출부가 그것을 사용자에게 말해야 한다.
 */
export interface MomentsBulkAddResult {
  readonly ok: true
  /** 실제로 더해진 개수. */
  readonly added: number
  /** 형식이 맞지 않거나 id 가 이미 있어서 버린 개수. */
  readonly dropped: number
  /** 저장소에 반영됐는지. */
  readonly persisted: boolean
}

/**
 * `replaceAllMoments` 의 결과.
 *
 * `LibraryReplaceResult` 와 같은 모양이다 — 가져오기가 "반영은 됐지만 저장은
 * 실패했다" 를 사용자에게 정확히 말해야 하기 때문이다 (M8-3 · M8-4).
 */
export interface MomentsReplaceResult {
  /** 메모리 반영은 항상 성공한다. 이 값은 저장 여부가 아니다. */
  readonly ok: true
  readonly persisted: boolean
  readonly writeFailure: WriteFailureReason | null
  /** 쓴 값을 **다시 읽어 확인했는지** (M8-4 와 같은 이유). */
  readonly verified: boolean
}

/**
 * 비교를 위한 정규 형태.
 *
 * 키 순서가 달라도 같은 데이터로 보려면 한 번 다시 쌓아야 한다. 호출부가
 * 필드를 다른 순서로 넘겨도 확인이 헛되게 실패하지 않는다.
 */
function canonicalMoments(data: MomentsData): string {
  return JSON.stringify(
    data.map((moment) => ({
      id: moment.id,
      source: moment.source,
      videoId: moment.videoId,
      atSeconds: moment.atSeconds,
      note: moment.note,
      title: moment.title,
      createdAt: moment.createdAt,
      updatedAt: moment.updatedAt,
    })),
  )
}

export const useMomentsStore = defineStore('moments', () => {
  const items = ref<Moment[]>([])

  const status = ref<MomentsStatus>('ready')
  const protectedReason = ref<MomentsProtectedReason | null>(null)
  const restoreOutcome = ref<ReadOutcome | null>(null)
  const lastWriteFailure = ref<WriteFailureReason | null>(null)

  /** 수정이 저장소에 반영될 수 있는 상태인지. */
  const canPersist = computed<boolean>(() => status.value === 'ready')

  const count = computed<number>(() => items.value.length)

  /** id 로 찾는다. 없으면 `undefined`. */
  function getMoment(id: string): Moment | undefined {
    return items.value.find((moment) => moment.id === id)
  }

  /**
   * 한 영상의 Moment 를 시점 오름차순으로 돌려준다.
   *
   * **파생값이다.** 저장 배열은 추가된 순서를 유지한다 (ADR 0019 결정 5) —
   * 정렬을 저장하면 보기 방식을 바꿀 때마다 사용자 데이터를 다시 쓰게 된다.
   * 같은 영상에 Moment 가 여러 개 있을 수 있고, 그것이 정상이다.
   */
  function momentsForVideo(videoId: string): Moment[] {
    return items.value
      .filter((moment) => moment.videoId === videoId)
      .sort((a, b) => a.atSeconds - b.atSeconds)
  }

  /**
   * 현재 상태를 저장한다.
   *
   * `protected` / `unavailable` 상태에서는 쓰지 않는다. 저장 실패는
   * 예외로 전파하지 않고 결과로 알린다.
   */
  function persist(): boolean {
    if (!canPersist.value) return false

    const result = momentsStorage.write(items.value)
    lastWriteFailure.value = result.ok ? null : result.reason
    return result.ok
  }

  function success(momentId: string): MomentMutationResult {
    return { ok: true, momentId, persisted: persist() }
  }

  /**
   * 저장된 Moment 를 복원한다.
   *
   * **읽기만 한다.** 손상된 데이터나 상위 버전 데이터를 지우거나 덮어쓰지
   * 않는다. 복구할 수 없으면 빈 목록을 화면에 주되 원본은 보호한다.
   */
  function restore(): ReadOutcome {
    lastReport = null
    const { value, outcome } = momentsStorage.read()
    const report = takeNormalizationReport()

    restoreOutcome.value = outcome
    items.value = value

    if (outcome === 'unavailable') {
      status.value = 'unavailable'
      protectedReason.value = null
      return outcome
    }

    if (outcome === 'malformed' || outcome === 'invalid' || outcome === 'version-mismatch') {
      status.value = 'protected'
      protectedReason.value = outcome
      return outcome
    }

    if (outcome === 'migration-failed') {
      status.value = 'protected'
      protectedReason.value = 'invalid'
      return outcome
    }

    // 'stored' / 'migrated' / 'empty'.
    // 일부만 살린 경우에도 원본을 덮어쓰면 버린 항목을 영구히 잃는다.
    const lostData = report !== null && report.droppedMoments > 0
    status.value = lostData ? 'protected' : 'ready'
    protectedReason.value = lostData ? 'partial-recovery' : null

    return outcome
  }

  /**
   * Moment 를 **끝에** 더한다.
   *
   * `videoId` 와 `atSeconds` 를 복원 때와 **같은 기준**으로 검증한다
   * (`isYouTubeVideoId` · `isValidAtSeconds`). 그래서 더한 Moment 가 다음
   * 복원에서 버려지는 일이 없다.
   *
   * 같은 영상의 같은 시점을 두 번 저장할 수 있다. 메모가 다를 수 있으므로
   * 합치지 않는다 (ADR 0019 TODO — 합칠지는 M9-4 에서 정한다).
   */
  function add(input: {
    videoId: string
    atSeconds: number
    note?: string
    title?: string
  }): MomentMutationResult {
    if (!isYouTubeVideoId(input.videoId)) return failure('invalid-video-id')
    if (!isValidAtSeconds(input.atSeconds)) return failure('invalid-time')

    const moment = createMoment({
      videoId: input.videoId,
      atSeconds: input.atSeconds,
      note: input.note ?? '',
      title: input.title ?? '',
      now: new Date(),
      id: createId(),
    })

    items.value = [...items.value, moment]
    return success(moment.id)
  }

  /**
   * 알 수 없는 출처의 목록을 한 번에 더한다 (M10 확장의 입구).
   *
   * **항목마다 검증한다.** 불량 항목과 이미 있는 id 는 버리고 개수로 알린다.
   * 기존 Moment 는 그대로 남는다 — 이 액션은 교체가 아니다.
   */
  function addMoments(list: unknown): MomentsBulkAddResult {
    const normalized = normalizeMomentsData(list)
    if (normalized === null) {
      // 배열이 아니다. 더할 것이 없고 기존 데이터도 건드리지 않는다.
      return { ok: true, added: 0, dropped: 0, persisted: false }
    }

    const existingIds = new Set(items.value.map((moment) => moment.id))
    const accepted: Moment[] = []
    let dropped = normalized.report.droppedMoments

    for (const moment of normalized.data) {
      if (existingIds.has(moment.id)) {
        dropped += 1
        continue
      }
      existingIds.add(moment.id)
      accepted.push(moment)
    }

    if (accepted.length === 0) {
      return { ok: true, added: 0, dropped, persisted: false }
    }

    items.value = [...items.value, ...accepted]
    return { ok: true, added: accepted.length, dropped, persisted: persist() }
  }

  /**
   * 메모만 고친다 (F16).
   *
   * `id` · `videoId` · `atSeconds` · `createdAt` 은 그대로다. **시점은 고치지
   * 못한다** — 다른 시점을 원하면 새로 저장한다. `updatedAt` 만 움직인다.
   */
  function updateNote(id: string, note: string): MomentMutationResult {
    const index = items.value.findIndex((moment) => moment.id === id)
    if (index === -1) return failure('not-found')

    const current = items.value[index]
    if (current === undefined) return failure('not-found')

    const next = [...items.value]
    next[index] = {
      ...current,
      note: normalizeNote(note),
      updatedAt: new Date().toISOString(),
    }
    items.value = next

    return success(id)
  }

  /**
   * Moment 하나를 지운다.
   *
   * **그 Moment 만** 지운다. 트랙·플레이리스트 삭제와 연쇄 관계를 만들지
   * 않는다 (양방향 모두). "전부 지우기" 도 두지 않는다 — 사용자 데이터
   * 일괄 삭제는 명시적 요구 없이 만들지 않는다 (`MUSIC_MOMENTS.md` §4).
   */
  function remove(id: string): MomentMutationResult {
    if (!items.value.some((moment) => moment.id === id)) return failure('not-found')

    items.value = items.value.filter((moment) => moment.id !== id)
    return success(id)
  }

  /**
   * Moment 를 **통째로 교체한다**. ⚠ **보호 우회 경로다.**
   *
   * `library.replaceAll` 과 같은 자리의 액션이다 (M8-3). ADR 0007 은
   * `protected` / `unavailable` 에서 **평범한 수정**의 저장을 막지만,
   * "기존 데이터를 버리고 교체" 라는 **명시적 조작**은 남겨 두었다.
   *
   * **백업 가져오기 경로에서만 부른다** (M9-5) — 사용자가 미리보기를 보고
   * 승인한 뒤에만. 다른 곳에서 부르면 ADR 0007 이 무의미해지므로 호출
   * 지점을 테스트로 고정한다.
   *
   * 저장이 실패하면 **`status` 를 바꾸지 않는다.** 원본이 아직 저장소에
   * 그대로 있으므로 보호를 풀 이유가 없다.
   *
   * @param data **이미 검증된** `MomentsData`. 방어적으로 다시 정규화하지
   *   않는다 — 호출부가 `normalizeMomentsData` 로 검증하고 사용자에게 버린
   *   항목까지 보여준 뒤에 넘긴다. 여기서 또 버리면 사용자가 승인한 것과
   *   저장되는 것이 달라진다.
   */
  function replaceAllMoments(data: MomentsData): MomentsReplaceResult {
    // 항목까지 복사한다. 호출부가 넘긴 객체와 store 가 참조를 공유하지 않는다.
    items.value = data.map((moment) => ({ ...moment }))

    const result = momentsStorage.write(items.value)
    lastWriteFailure.value = result.ok ? null : result.reason

    if (!result.ok) {
      return { ok: true, persisted: false, writeFailure: result.reason, verified: false }
    }

    /*
     * 사용자가 원본을 버리기로 **결정했고** 그 결정이 저장됐다. 보호할
     * 원본이 더는 없으므로 보호를 푼다.
     */
    status.value = 'ready'
    protectedReason.value = null

    const readBack = momentsStorage.read()
    const verified =
      readBack.outcome === 'stored' &&
      canonicalMoments(readBack.value) === canonicalMoments(items.value)

    return { ok: true, persisted: true, writeFailure: null, verified }
  }

  return {
    // 상태 — 읽기 전용으로 노출한다. 변경은 액션으로만 한다.
    moments: readonly(items),
    status: readonly(status),
    protectedReason: readonly(protectedReason),
    restoreOutcome: readonly(restoreOutcome),
    lastWriteFailure: readonly(lastWriteFailure),

    // 파생
    canPersist,
    count,

    // 조회
    getMoment,
    momentsForVideo,

    // 액션
    restore,
    add,
    addMoments,
    updateNote,
    remove,

    // ⚠ 보호 우회. 백업 가져오기 경로에서만 부른다 (ADR 0007 · 0019).
    replaceAllMoments,
  }
})
