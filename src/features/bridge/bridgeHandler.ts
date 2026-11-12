/**
 * 확장 저장 브리지 — 요청 처리 (M11-5, ADR 0028 · 0028 결정 11).
 *
 * 원칙
 * - 저장은 **기존 store 명령으로만** 한다 (`addTrack` · `createPlaylist` · Moments `add`).
 *   `localStorage` 를 직접 쓰지 않는다 — 검증 · 보호 상태 · 탭 간 잠금(ADR 0025)을 그대로 지난다.
 * - **통신 성공 ≠ 저장 성공.** store 가 `persisted: true` 라고 해도 저장소를 다시 읽어 그 항목이 있을
 *   때만 `ok` 를 돌려준다.
 * - **정확히 한 번.** 저장 항목의 id 를 요청 ID 에서 정한다(`derivedIds`). 같은 요청을 다시 보내면 store
 *   가 잠금 안에서 "이미 있음" 을 알아보고 쓰지 않는다 — 워커 · offscreen 이 다시 떠 이 파일의 메모리가
 *   사라져도, 응답만 잃었어도 같다. 메모리 기록(`journal`)은 같은 순간 겹쳐 온 재전송을 한 번으로 묶는다.
 * - 보호(`protected`) · 사용 불가(`unavailable`) 면 store 를 부르지 않는다 — store 는 그때 메모리에만
 *   반영하므로(ADR 0007) 브리지 메모리가 저장소와 갈라진다.
 * - 확장에서 만든 목록은 대시보드의 **선택을 바꾸지 않는다** (`select: false`, M11 D4). 재생 큐는 이
 *   페이지에 없다 — 대시보드 탭의 재생 상태를 건드릴 길이 없다.
 * - 요청은 **한 번에 하나씩** 처리하고, 처리 전에 저장소를 다시 읽는다(다른 탭의 변경 · 보호 상태 반영).
 */
import type { ReadResult } from '@/shared/storage'
import type { LibraryData, MomentsData } from '@/shared/types'
import type { useLibraryStore } from '@/stores/library'
import type { useMomentsStore } from '@/stores/moments'

import {
  WRITE_OPS,
  bridgeError,
  derivedIds,
  payloadFingerprint,
  respondError,
  respondOk,
  type BridgeError,
  type BridgeRequest,
  type BridgeResponse,
} from './bridgeProtocol'

type LibraryStore = ReturnType<typeof useLibraryStore>
type MomentsStore = ReturnType<typeof useMomentsStore>

export interface BridgeDeps {
  readonly library: LibraryStore
  readonly moments: MomentsStore
  /** 저장소를 **다시 읽는다** — 메모리가 아니라 저장된 값으로 확인한다. */
  readonly readLibrary: () => ReadResult<LibraryData>
  readonly readMoments: () => ReadResult<MomentsData>
  readonly now?: () => number
}

/** 같은 요청의 재전송을 메모리에서 묶어 두는 시간. 넘으면 store 의 id 확인이 대신 막는다. */
const JOURNAL_TTL_MS = 10 * 60_000
/** 이보다 먼 마감은 믿지 않는다 — 가로챈 요청을 오래 뒤에 다시 보내는 것을 막는다. */
const MAX_DEADLINE_AHEAD_MS = 30_000

interface JournalEntry {
  readonly fingerprint: string
  readonly at: number
  readonly result: Promise<BridgeResponse>
}

export interface BridgeHandler {
  handle(request: BridgeRequest): Promise<BridgeResponse>
  /** 지금 상태 요약 — 준비 신호 · `hello` 가 쓴다. */
  hello(): Record<string, unknown>
  /** 시험용 — 기록 개수. */
  journalSize(): number
}

function failureFromStore(reason: string): BridgeError {
  switch (reason) {
    case 'conflict':
    case 'busy':
    case 'not-found':
    case 'invalid-video-id':
    case 'invalid-time':
    case 'empty-name':
    case 'duplicate-id':
      return bridgeError(reason)
    default:
      return bridgeError('internal', { storeReason: reason })
  }
}

const isReadable = (outcome: string): boolean => outcome === 'stored' || outcome === 'migrated'

export function createBridgeHandler(deps: BridgeDeps): BridgeHandler {
  const now = deps.now ?? Date.now
  const journal = new Map<string, JournalEntry>()
  /** 요청을 한 줄로 세운다 — 앞 요청이 끝난 뒤 다음을 시작한다. */
  let tail: Promise<unknown> = Promise.resolve()

  function prune(): void {
    const limit = now() - JOURNAL_TTL_MS
    for (const [id, entry] of journal) if (entry.at < limit) journal.delete(id)
  }

  function status(): Record<string, unknown> {
    return {
      protocol: 1,
      library: {
        status: deps.library.status,
        protectedReason: deps.library.protectedReason,
        playlists: deps.library.playlists.length,
      },
      moments: {
        status: deps.moments.status,
        protectedReason: deps.moments.protectedReason,
        count: deps.moments.count,
      },
    }
  }

  function libraryBlocked(): BridgeError | null {
    if (deps.library.status === 'ready') return null
    return bridgeError('blocked', {
      store: 'library',
      status: deps.library.status,
      protectedReason: deps.library.protectedReason,
    })
  }

  function momentsBlocked(): BridgeError | null {
    if (deps.moments.status === 'ready') return null
    return bridgeError('blocked', {
      store: 'moments',
      status: deps.moments.status,
      protectedReason: deps.moments.protectedReason,
    })
  }

  /** 저장된 값에 그 곡이 있는지 — 있으면 위치(1부터). */
  function storedTrackPosition(playlistId: string, trackId: string): number | null {
    const stored = deps.readLibrary()
    if (!isReadable(stored.outcome)) return null
    const playlist = stored.value.playlists.find((p) => p.id === playlistId)
    const index = playlist?.tracks.findIndex((t) => t.id === trackId) ?? -1
    return index === -1 ? null : index + 1
  }

  function storedMoment(momentId: string): MomentsData[number] | null {
    const stored = deps.readMoments()
    if (!isReadable(stored.outcome)) return null
    return stored.value.find((m) => m.id === momentId) ?? null
  }

  type Added =
    | { ok: true; trackId: string; position: number; existed: boolean }
    | { ok: false; error: BridgeError }

  async function addTrackVerified(
    playlistId: string,
    videoId: string,
    title: string | null,
    trackId: string,
  ): Promise<Added> {
    const result = await deps.library.addTrack(playlistId, {
      videoId,
      id: trackId,
      ...(title === null ? {} : { title }),
    })
    if (!result.ok) return { ok: false, error: failureFromStore(result.reason) }
    if (!result.persisted) {
      // 메모리에만 들어갔다 — 저장소 상태로 되돌린다 (수집 화면과 같은 처리).
      deps.library.reload()
      return {
        ok: false,
        error: bridgeError('not-persisted', { writeFailure: deps.library.lastWriteFailure }),
      }
    }
    const position = storedTrackPosition(playlistId, trackId)
    if (position === null) return { ok: false, error: bridgeError('not-verified') }
    return { ok: true, trackId, position, existed: result.existed === true }
  }

  function positionsOf(playlistId: string, videoId: string): number[] {
    const playlist = deps.library.getPlaylist(playlistId)
    return playlist?.tracks.flatMap((t, i) => (t.videoId === videoId ? [i + 1] : [])) ?? []
  }

  async function execute(request: BridgeRequest): Promise<BridgeResponse> {
    const { id, payload } = request

    if (WRITE_OPS.includes(payload.op)) {
      const t = now()
      if (request.deadline < t) return respondError(id, bridgeError('expired'))
      if (request.deadline > t + MAX_DEADLINE_AHEAD_MS) {
        return respondError(id, bridgeError('bad-request', { field: 'deadline' }))
      }
    }

    // 다른 탭이 그 사이 쓴 것 · 보호 상태로 바뀐 것을 반영한다. 읽기만 한다 (ADR 0007).
    deps.library.reload()
    deps.moments.reload()

    switch (payload.op) {
      case 'hello':
        return respondOk(id, status())

      case 'library/list':
        return respondOk(id, {
          status: deps.library.status,
          protectedReason: deps.library.protectedReason,
          playlists: deps.library.playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            trackCount: playlist.tracks.length,
            positions:
              payload.videoId === null
                ? []
                : playlist.tracks.flatMap((t, i) => (t.videoId === payload.videoId ? [i + 1] : [])),
          })),
        })

      case 'moment/list-for-video':
        return respondOk(id, {
          status: deps.moments.status,
          atSeconds: deps.moments.momentsForVideo(payload.videoId).map((m) => m.atSeconds),
        })

      case 'track/add': {
        const blocked = libraryBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const { trackId } = derivedIds(id)
        const playlist = deps.library.getPlaylist(payload.playlistId)
        if (playlist === undefined) return respondError(id, bridgeError('not-found'))
        const already = playlist.tracks.some((t) => t.id === trackId)
        const positions = positionsOf(payload.playlistId, payload.videoId)
        // 같은 영상이 이미 있으면 사용자가 "한 번 더" 를 고른 경우만 담는다 (중복은 허용하지만 묻는다).
        if (!already && !payload.allowDuplicate && positions.length > 0) {
          return respondError(
            id,
            bridgeError('already-in-playlist', { positions, playlistName: playlist.name }),
          )
        }
        const added = await addTrackVerified(
          payload.playlistId,
          payload.videoId,
          payload.title,
          trackId,
        )
        if (!added.ok) return respondError(id, added.error)
        return respondOk(id, {
          playlistId: payload.playlistId,
          playlistName: deps.library.getPlaylist(payload.playlistId)?.name ?? playlist.name,
          trackId: added.trackId,
          position: added.position,
          existed: added.existed,
          verified: true,
        })
      }

      case 'playlist/create-and-add': {
        const blocked = libraryBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const { playlistId, trackId } = derivedIds(id)
        const created = await deps.library.createPlaylist(payload.name, {
          select: false,
          id: playlistId,
        })
        if (!created.ok) return respondError(id, failureFromStore(created.reason))
        if (!created.persisted) {
          deps.library.reload()
          return respondError(id, bridgeError('not-persisted', { step: 'create' }))
        }
        /*
         * 두 번째 명령 — 여기서 실패하면 **부분 성공**이다. 목록은 이미 저장됐다. 전체 성공이라 하지
         * 않고 만든 목록 ID 를 돌려준다. 같은 요청 ID 로 다시 보내면 목록은 "이미 있음" 으로 건너뛰고
         * 곡만 담는다 — 같은 이름의 목록이 하나 더 생기지 않는다.
         */
        const added = await addTrackVerified(playlistId, payload.videoId, payload.title, trackId)
        if (!added.ok) {
          return respondError(
            id,
            bridgeError('partial', {
              playlistId,
              playlistName: deps.library.getPlaylist(playlistId)?.name ?? payload.name,
              step: 'add',
              cause: added.error.code,
            }),
          )
        }
        return respondOk(id, {
          playlistId,
          // store 가 다듬은 이름 (저장된 값).
          playlistName: deps.library.getPlaylist(playlistId)?.name ?? payload.name,
          trackId: added.trackId,
          position: added.position,
          created: created.existed !== true,
          existed: added.existed,
          verified: true,
        })
      }

      case 'moment/add': {
        const blocked = momentsBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const { momentId } = derivedIds(id)
        const result = await deps.moments.add({
          videoId: payload.videoId,
          atSeconds: payload.atSeconds,
          note: payload.note,
          id: momentId,
          ...(payload.title === null ? {} : { title: payload.title }),
        })
        if (!result.ok) return respondError(id, failureFromStore(result.reason))
        if (!result.persisted) {
          deps.moments.reload()
          return respondError(
            id,
            bridgeError('not-persisted', { writeFailure: deps.moments.lastWriteFailure }),
          )
        }
        const stored = storedMoment(result.momentId)
        if (stored === null) return respondError(id, bridgeError('not-verified'))
        return respondOk(id, {
          momentId: stored.id,
          videoId: stored.videoId,
          atSeconds: stored.atSeconds,
          noteSaved: stored.note !== '',
          existed: result.existed === true,
          verified: true,
        })
      }

      /*
       * 확인용 조회 — 응답을 잃었을 때(시간 초과 · 워커 재시작 · 권한 철회) 실제로 저장됐는지
       * **저장소 원문**에서 그 요청의 id 로 찾는다. 메모리가 아니라 저장된 값을 본다.
       */
      case 'request/status': {
        const ids = derivedIds(payload.target)
        if (payload.kind === 'moment') {
          const stored = deps.readMoments()
          if (!isReadable(stored.outcome) && stored.outcome !== 'empty') {
            return respondError(id, bridgeError('blocked', { store: 'moments' }))
          }
          const found = stored.value.find((m) => m.id === ids.momentId)
          return respondOk(
            id,
            found === undefined
              ? { state: 'not-found' }
              : {
                  state: 'saved',
                  momentId: found.id,
                  videoId: found.videoId,
                  atSeconds: found.atSeconds,
                  noteSaved: found.note !== '',
                },
          )
        }
        const stored = deps.readLibrary()
        if (!isReadable(stored.outcome) && stored.outcome !== 'empty') {
          return respondError(id, bridgeError('blocked', { store: 'library' }))
        }
        const listId = payload.kind === 'playlist' ? ids.playlistId : payload.playlistId
        const playlist = stored.value.playlists.find((p) => p.id === listId)
        const index = playlist?.tracks.findIndex((t) => t.id === ids.trackId) ?? -1
        if (playlist === undefined) return respondOk(id, { state: 'not-found' })
        if (index === -1) {
          return respondOk(
            id,
            payload.kind === 'playlist'
              ? { state: 'partial', playlistId: playlist.id, playlistName: playlist.name }
              : { state: 'not-found' },
          )
        }
        return respondOk(id, {
          state: 'saved',
          playlistId: playlist.id,
          playlistName: playlist.name,
          position: index + 1,
        })
      }
    }
  }

  return {
    handle(request) {
      prune()
      const fingerprint = payloadFingerprint(request.payload)
      const seen = journal.get(request.id)
      if (seen !== undefined) {
        if (seen.fingerprint !== fingerprint) {
          return Promise.resolve(respondError(request.id, bridgeError('id-reused')))
        }
        // 같은 순간 겹쳐 온 재전송 — 다시 실행하지 않고 처음 결과를 돌려준다.
        return seen.result
      }
      const run = tail.then(() => execute(request))
      const result = run.catch(() => respondError(request.id, bridgeError('internal')))
      tail = result
      // 쓰기만 기억한다 — 읽기는 다시 물으면 최신을 답해야 한다.
      if (WRITE_OPS.includes(request.payload.op)) {
        journal.set(request.id, { fingerprint, at: now(), result })
      }
      return result
    },
    hello: status,
    journalSize: () => journal.size,
  }
}
