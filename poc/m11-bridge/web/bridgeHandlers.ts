/**
 * M11-1 저장 브리지 PoC — 요청 처리 (store 경유).
 *
 * ⚠ 실험 코드다. 운영 빌드에 들어가지 않는다.
 *
 * 원칙
 * - 저장은 **기존 store 명령으로만** 한다 (`addTrack` · `createPlaylist` · Moments `add`).
 *   `localStorage` 를 직접 쓰지 않는다 — 검증 · 보호 상태 · 탭 간 잠금(ADR 0025)을 그대로 지난다.
 * - **통신 성공 ≠ 저장 성공.** store 가 `persisted: true` 라고 해도 저장소를 다시 읽어 그 항목이
 *   있을 때만 `ok` 를 돌려준다 (`verified`).
 * - 보호(`protected`) · 사용 불가(`unavailable`) 상태면 store 를 부르지 않는다 — store 는 그때
 *   메모리에만 반영하므로(ADR 0007) 브리지 메모리가 저장소와 갈라진다.
 * - 같은 요청 ID 는 한 번만 실행한다 (메모리 기록). 다른 내용으로 같은 ID 가 오면 거절.
 */
import type { useLibraryStore } from '@/stores/library'
import type { useMomentsStore } from '@/stores/moments'
import type { LibraryData, MomentsData } from '@/shared/types'
import type { ReadResult } from '@/shared/storage'

import {
  WRITE_OPS,
  bridgeError,
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

/** 요청 기록을 얼마나 들고 있는지. 브리지가 다시 뜨면 사라진다 (§실패 · 재시도). */
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
      return bridgeError(reason)
    default:
      return bridgeError('internal', { storeReason: reason })
  }
}

export function createBridgeHandler(deps: BridgeDeps): BridgeHandler {
  const now = deps.now ?? Date.now
  const journal = new Map<string, JournalEntry>()

  function prune(): void {
    const limit = now() - JOURNAL_TTL_MS
    for (const [id, entry] of journal) if (entry.at < limit) journal.delete(id)
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
  function verifyTrack(playlistId: string, trackId: string): number | null {
    const stored = deps.readLibrary()
    if (stored.outcome !== 'stored' && stored.outcome !== 'migrated') return null
    const playlist = stored.value.playlists.find((p) => p.id === playlistId)
    const index = playlist?.tracks.findIndex((t) => t.id === trackId) ?? -1
    return index === -1 ? null : index + 1
  }

  function verifyMoment(momentId: string): boolean {
    const stored = deps.readMoments()
    if (stored.outcome !== 'stored' && stored.outcome !== 'migrated') return false
    return stored.value.some((m) => m.id === momentId)
  }

  async function addTrackVerified(
    id: string,
    playlistId: string,
    videoId: string,
    title: string | null,
  ): Promise<{ ok: true; trackId: string; position: number } | { ok: false; error: BridgeError }> {
    const result = await deps.library.addTrack(playlistId, {
      videoId,
      ...(title === null ? {} : { title }),
    })
    if (!result.ok) return { ok: false, error: failureFromStore(result.reason) }
    if (!result.persisted || result.trackId === undefined) {
      // 메모리에만 들어갔다 — 저장소 상태로 되돌린다 (수집 화면과 같은 처리, M10-3 §5-2 의 9).
      deps.library.reload()
      return {
        ok: false,
        error: bridgeError('not-persisted', { writeFailure: deps.library.lastWriteFailure }),
      }
    }
    const position = verifyTrack(playlistId, result.trackId)
    if (position === null)
      return { ok: false, error: bridgeError('not-verified', { requestId: id }) }
    return { ok: true, trackId: result.trackId, position }
  }

  async function execute(request: BridgeRequest): Promise<BridgeResponse> {
    const { id, payload } = request
    const isWrite = WRITE_OPS.includes(payload.op)

    if (isWrite) {
      const t = now()
      if (request.deadline < t) return respondError(id, bridgeError('expired'))
      if (request.deadline > t + MAX_DEADLINE_AHEAD_MS) {
        return respondError(id, bridgeError('bad-request', { field: 'deadline' }))
      }
    }

    switch (payload.op) {
      case 'hello':
        return respondOk(id, {
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
        })

      case 'library/list':
        return respondOk(id, {
          status: deps.library.status,
          selectedPlaylistId: deps.library.selectedPlaylistId,
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

      case 'track/add': {
        const blocked = libraryBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const added = await addTrackVerified(id, payload.playlistId, payload.videoId, payload.title)
        if (!added.ok) return respondError(id, added.error)
        const playlist = deps.library.getPlaylist(payload.playlistId)
        return respondOk(id, {
          playlistId: payload.playlistId,
          playlistName: playlist?.name ?? '',
          trackId: added.trackId,
          position: added.position,
          verified: true,
        })
      }

      case 'playlist/create-and-add': {
        const blocked = libraryBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const created = await deps.library.createPlaylist(payload.name)
        if (!created.ok) return respondError(id, failureFromStore(created.reason))
        if (!created.persisted) {
          deps.library.reload()
          return respondError(id, bridgeError('not-persisted', { step: 'create' }))
        }
        const playlistId = created.playlistId
        /*
         * 두 번째 명령 — 여기서 실패하면 **부분 성공**이다. 목록은 이미 저장됐다.
         * 전체 성공이라 하지 않고, 만든 목록 ID 를 돌려줘 그 목록에 다시 담게 한다
         * (다시 "만들고 담기" 를 하면 같은 이름의 목록이 하나 더 생긴다).
         */
        const added = await addTrackVerified(id, playlistId, payload.videoId, payload.title)
        if (!added.ok) {
          return respondError(
            id,
            bridgeError('partial', {
              playlistId,
              playlistName: payload.name,
              step: 'add',
              cause: added.error.code,
            }),
          )
        }
        return respondOk(id, {
          playlistId,
          playlistName: payload.name,
          trackId: added.trackId,
          position: added.position,
          created: true,
          verified: true,
        })
      }

      case 'moment/add': {
        const blocked = momentsBlocked()
        if (blocked !== null) return respondError(id, blocked)
        const result = await deps.moments.add({
          videoId: payload.videoId,
          atSeconds: payload.atSeconds,
          note: payload.note,
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
        if (!verifyMoment(result.momentId)) {
          return respondError(id, bridgeError('not-verified', { requestId: id }))
        }
        return respondOk(id, { momentId: result.momentId, verified: true })
      }

      case 'moment/list-for-video':
        return respondOk(id, {
          status: deps.moments.status,
          moments: deps.moments.momentsForVideo(payload.videoId).map((m) => ({
            id: m.id,
            atSeconds: m.atSeconds,
            note: m.note,
          })),
        })

      /*
       * 확인용 조회 — 응답을 잃었을 때(시간 초과 · 워커 재시작) 같은 쓰기를 **다시 보내기 전에**
       * 실제로 저장됐는지 저장소를 읽어 본다. 메모리가 아니라 저장된 값을 본다.
       */
      case 'track/find': {
        const stored = deps.readLibrary()
        const playlist = stored.value.playlists.find((p) => p.id === payload.playlistId)
        return respondOk(id, {
          found: playlist !== undefined,
          positions:
            playlist?.tracks.flatMap((t, i) => (t.videoId === payload.videoId ? [i + 1] : [])) ??
            [],
        })
      }

      case 'moment/find': {
        const since = Date.parse(payload.since)
        const stored = deps.readMoments()
        const matches = stored.value.filter(
          (m) =>
            m.videoId === payload.videoId &&
            m.atSeconds === payload.atSeconds &&
            Date.parse(m.createdAt) >= since,
        )
        return respondOk(id, { matches: matches.map((m) => ({ id: m.id, note: m.note })) })
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
        // 같은 요청의 재전송 — 다시 실행하지 않고 처음 결과를 돌려준다.
        return seen.result
      }
      const result = execute(request).catch(() => respondError(request.id, bridgeError('internal')))
      journal.set(request.id, { fingerprint, at: now(), result })
      return result
    },
    journalSize: () => journal.size,
  }
}
