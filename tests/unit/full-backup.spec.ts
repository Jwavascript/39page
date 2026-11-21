/**
 * M12-4 — 앨범아트 포함 전체 백업(ZIP) · 복원 (ADR 0034 · ARTWORK_DESIGN §7).
 *
 *   A. 왕복 — 프로필 A 에서 만들고 빈 프로필 B 에 복원: 목록 · 순서 · Moments · 테마 · 그림 · 연결이 같다
 *   B. 만들기의 정직함 — 저장소를 열 수 없음 · 그림이 사라짐 · 목록에 없는 곡의 연결
 *   C. 읽기 검증 — 변조 · 목록에 없는 파일 · 미래 버전 · 같은 그림 두 번 · 깨진 이미지 (아무것도 쓰지 않는다)
 *   D. 단계 복원의 실패 복구 — 공간 부족(스테이징) · 다른 탭 변경(텍스트 거절) · 연결 저장 실패 → 다시 시도
 *   E. 기존 JSON 백업과의 관계 — ZIP 의 backup.json 은 기존 형식 그대로
 */
import { zipSync } from 'fflate'
import { IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtworkRepository, openArtworkDb } from '@/features/artwork/artworkRepository'
import { validateArtwork, type ValidatedArtwork } from '@/features/artwork/imageValidation'
import { readBackup } from '@/features/backup/readBackup'
import { readFullBackupZip } from '@/features/backup/fullBackup'
import { useBackupImport } from '@/features/backup/useBackupImport'
import { useFullBackupExport, useFullBackupImport } from '@/features/backup/useFullBackup'
import { readZip } from '@/features/backup/zipPackage'
import { packagePolicy } from '@/features/backup/packageFormat'
import { useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'
import { useThemeStore } from '@/stores/theme'

import { fakeImageTools, fileOf, gifBytes, pngBytes } from '../support/artworkFixtures'
import {
  captureDownloads,
  inSetup,
  newProfile,
  useNodeBlobs,
  type Profile,
  rewritePackage,
} from '../support/transferHarness'

const V1 = 'aaaaaaaaaaa'
const V2 = 'bbbbbbbbbbb'

let downloads: ReturnType<typeof captureDownloads>

beforeEach(() => {
  useNodeBlobs()
  downloads = captureDownloads()
})

afterEach(() => {
  downloads.restore()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  globalThis.localStorage.clear()
})

async function art(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<ValidatedArtwork> {
  const result = await validateArtwork(fileOf(bytes, name), fakeImageTools())
  if (!result.ok) throw new Error(result.reason)
  return result.artwork
}

/** 목록 A(곡 둘) · B(A1 과 같은 영상 하나), Moments 둘, 그림: A1 PNG · A2 기본 · B1 GIF. */
async function seed() {
  const library = useLibraryStore()
  const moments = useMomentsStore()
  const artwork = useArtworkStore()
  const a = await library.createPlaylist('LIST A')
  const b = await library.createPlaylist('LIST B')
  if (!a.ok || !b.ok) throw new Error('playlists')
  const a1 = await library.addTrack(a.playlistId, { videoId: V1, title: 'A one' })
  const a2 = await library.addTrack(a.playlistId, { videoId: V2, title: 'A two' })
  const b1 = await library.addTrack(b.playlistId, { videoId: V1, title: 'B one' })
  const key = (p: string, r: typeof a1) => ({
    playlistId: p,
    trackId: r.ok ? (r.trackId ?? '') : '',
  })
  const keys = { a1: key(a.playlistId, a1), a2: key(a.playlistId, a2), b1: key(b.playlistId, b1) }
  // 순서를 바꿔 둔다 — 복원 뒤 순서가 같은지 본다.
  await library.moveTrackTo(a.playlistId, keys.a2.trackId, 0)
  await moments.add({ videoId: V1, atSeconds: 10, note: 'hi', title: 'A one' })
  await moments.add({ videoId: V2, atSeconds: 20, note: 'yo', title: 'A two' })
  useThemeStore().setTheme('mono-vinyl')
  expect(await artwork.setCustom(keys.a1, V1, await art(pngBytes(1), 'a.png'), 0)).toEqual({
    ok: true,
  })
  expect(await artwork.useDefault(keys.a2, V2, 0)).toEqual({ ok: true })
  expect(await artwork.setCustom(keys.b1, V1, await art(gifBytes(2), 'b.gif'), 0)).toEqual({
    ok: true,
  })
  return keys
}

async function exportZip(): Promise<{ bytes: Uint8Array; notice: string; failed: boolean }> {
  const model = inSetup(() => useFullBackupExport())
  await model.exportZip()
  return {
    bytes: await downloads.lastBytes(),
    notice: model.notice.value,
    failed: model.failed.value,
  }
}

function importer() {
  return inSetup(() => {
    const restore = useBackupImport()
    return { restore, full: useFullBackupImport(restore) }
  })
}

const snapshotLibrary = () =>
  useLibraryStore().playlists.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.tracks.map((track) => [track.id, track.videoId, track.title]),
  }))

describe('A. 왕복 — 다른 프로필에서 그대로', () => {
  it('v1 ZIP은 생략한 구도를 기본값으로 새 프로필에 복원한다', async () => {
    await newProfile()
    const keys = await seed()
    const { bytes } = await exportZip()
    const old = await rewritePackage(
      bytes,
      'artwork.json',
      (value) => {
        value.version = 1
      },
      1,
    )
    await newProfile()
    const { full } = importer()
    await full.selectZip(new File([old as Uint8Array<ArrayBuffer>], 'v1.zip'))
    await full.apply()
    expect(full.artworkResult.value?.outcome).toBe('saved')
    expect(useArtworkStore().displayFor(keys.a1)).toEqual({
      fit: 'cover',
      positionX: 50,
      positionY: 50,
      zoom: 1,
    })
  })
  it('목록 · 순서 · Moments · 테마 · 그림(PNG · GIF 포스터) · 연결이 같다', async () => {
    await newProfile()
    const keys = await seed()
    const crop = { fit: 'contain' as const, positionX: 15, positionY: 85, zoom: 1.75 }
    await useArtworkStore().setDisplay(keys.b1, V1, crop, 1)
    const before = snapshotLibrary()
    const beforeMoments = useMomentsStore().moments.map((m) => [m.videoId, m.atSeconds, m.note])
    const exported = await exportZip()
    expect(exported.failed).toBe(false)
    expect(exported.notice).toContain('전체 백업')
    expect(exported.notice).toContain('이미지 2개')
    expect(downloads.captured[0]?.name).toMatch(/^39page-backup-\d{8}-\d{4}\.zip$/)

    // 다른 컴퓨터.
    const profileB: Profile = await newProfile()
    const { restore, full } = importer()
    await full.selectZip(new File([exported.bytes as Uint8Array<ArrayBuffer>], 'backup.zip'))
    expect(full.notice.value).toBe('')
    expect(full.active.value).toBe(true)
    expect(full.artworkPreview.value).toMatchObject({
      links: 3,
      images: 2,
      existing: 0,
      problems: [],
    })
    expect(restore.preview.value?.incoming).toEqual({ playlists: 2, tracks: 3 })

    await full.apply()
    expect(restore.results.value.find((r) => r.name === '플레이리스트')?.outcome).toBe('saved')
    expect(full.artworkResult.value?.outcome).toBe('saved')

    expect(snapshotLibrary()).toEqual(before)
    expect(useMomentsStore().moments.map((m) => [m.videoId, m.atSeconds, m.note])).toEqual(
      beforeMoments,
    )
    expect(useThemeStore().current).toBe('mono-vinyl')
    const artwork = useArtworkStore()
    expect(artwork.preferenceFor(keys.a1).mode).toBe('custom')
    expect(artwork.preferenceFor(keys.a2)).toEqual({ mode: 'default' })
    expect(artwork.preferenceFor(keys.b1).mode).toBe('custom')
    expect(artwork.displayFor(keys.b1)).toEqual(crop)
    expect(artwork.usage.assets).toBe(2)
    // 같은 영상의 두 트랙(A1 · B1)이 서로 다른 그림이다.
    expect(artwork.preferenceFor(keys.a1)).not.toEqual(artwork.preferenceFor(keys.b1))
    // GIF 포스터가 다시 만들어졌다.
    const gif = [...artwork.assets.values()].find((asset) => asset.animated)
    expect((await artwork.loadBlob(gif?.id ?? ''))?.poster).not.toBeNull()

    // 실제 저장소(새로 연 연결)에서도 같다.
    const repo = createArtworkRepository(await openArtworkDb(profileB.factory))
    expect((await repo.snapshot()).assignments).toHaveLength(3)
    repo.close()
  })

  it('ZIP 의 backup.json 은 기존 JSON 백업 형식 그대로다 — 옛 빌드도 그 파일만 꺼내 가져올 수 있다', async () => {
    await newProfile()
    await seed()
    const { bytes } = await exportZip()
    const zip = readZip(bytes, packagePolicy(['manifest.json', 'backup.json', 'artwork.json']))
    expect(zip.ok).toBe(true)
    if (!zip.ok) return
    const json = readBackup(new TextDecoder().decode(zip.files.get('backup.json')))
    expect(json.ok).toBe(true)
    expect(json.ok && json.counts).toEqual({ playlists: 2, tracks: 3 })
    expect([...zip.files.keys()].sort()).toEqual(
      [
        'artwork.json',
        'assets/' +
          [...useArtworkStore().assets.values()].find((a) => a.mimeType === 'image/gif')?.id +
          '.gif',
        'assets/' +
          [...useArtworkStore().assets.values()].find((a) => a.mimeType === 'image/png')?.id +
          '.png',
        'backup.json',
        'manifest.json',
      ].sort(),
    )
  })
})

describe('B. 만들기 — 빠진 것을 숨기지 않는다', () => {
  it('앨범아트 저장소를 열 수 없으면 그림 없이 만들고 "완료" 라고 하지 않는다', async () => {
    await newProfile({ artwork: 'broken' })
    await useLibraryStore().createPlaylist('X')
    const exported = await exportZip()
    expect(exported.failed).toBe(true)
    expect(exported.notice).toContain('그림이 빠졌습니다')
    const read = await readFullBackupZip(exported.bytes, fakeImageTools(), new Date())
    expect(read.ok && read.incompleteAtExport).toEqual({ artwork: 'unavailable' })
  })

  it('연결은 있는데 그림 바이트가 사라졌으면 그 수를 적고 완료라 하지 않는다', async () => {
    const profile = await newProfile()
    await seed()
    const db = await openArtworkDb(profile.factory)
    const tx = db.transaction('blobs', 'readwrite')
    const png = [...useArtworkStore().assets.values()].find((a) => a.mimeType === 'image/png')
    tx.objectStore('blobs').delete(png?.id ?? '')
    await new Promise((resolve) => (tx.oncomplete = resolve))
    db.close()

    const exported = await exportZip()
    expect(exported.failed).toBe(true)
    expect(exported.notice).toContain('그림 1개를 넣지 못했습니다')
    const read = await readFullBackupZip(exported.bytes, fakeImageTools(), new Date())
    expect(read.ok && read.links.length).toBe(2)
  })
})

describe('C. 읽기 검증 — 아무것도 쓰지 않는다', () => {
  async function exported() {
    await newProfile()
    await seed()
    return (await exportZip()).bytes
  }

  async function expectRejected(bytes: Uint8Array, message: RegExp) {
    await newProfile()
    await useLibraryStore().createPlaylist('KEEP')
    const before = snapshotLibrary()
    const { restore, full } = importer()
    await full.selectZip(new File([bytes as Uint8Array<ArrayBuffer>], 'x.zip'))
    expect(full.notice.value).toMatch(message)
    expect(full.active.value).toBe(false)
    expect(restore.preview.value).toBeNull()
    expect(snapshotLibrary()).toEqual(before)
    expect(useArtworkStore().usage.assets).toBe(0)
  }

  it('해시가 유효해도 잘못된 구도·미래 내부 버전은 어떤 저장도 하기 전에 거절한다', async () => {
    expect.hasAssertions()
    const base = await exported()
    const invalid = await rewritePackage(base, 'artwork.json', (value) => {
      const rows = value.assignments as Record<string, unknown>[]
      rows.find((row) => row.mode === 'custom')!.display = {
        fit: 'cover',
        positionX: -1,
        positionY: 50,
        zoom: 2,
      }
    })
    await expectRejected(invalid, /연결이 올바르지/)
    const future = await rewritePackage(base, 'artwork.json', (value) => {
      value.version = 3
    })
    await expectRejected(future, /읽을 수 없/)
  })

  it('그림 바이트 하나를 바꾸면(변조 · 손상) manifest 해시가 맞지 않아 받지 않는다', async () => {
    const bytes = new Uint8Array(await exported())
    // 저장(압축 없음)된 PNG 의 서명 뒤 바이트를 바꾼다.
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const at = bytes.findIndex((_, i) => sig.every((v, k) => bytes[i + k] === v))
    expect(at).toBeGreaterThan(0)
    bytes[at + 20] = (bytes[at + 20]! + 1) % 256
    await expectRejected(bytes, /manifest|손상/)
  })

  it('manifest 에 없는 파일 · 다른 형식 · 미래 버전', async () => {
    expect.hasAssertions()
    const base = await exported()
    const zip = readZip(base, packagePolicy(['manifest.json', 'backup.json', 'artwork.json']))
    if (!zip.ok) throw new Error('zip')
    const files = Object.fromEntries([...zip.files].map(([k, v]) => [k, new Uint8Array(v)]))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as Record<
      string,
      unknown
    >
    const enc = (v: unknown) => new Uint8Array(new TextEncoder().encode(JSON.stringify(v)))

    await expectRejected(zipSync({ ...files, 'artwork.json.bak': enc({}) }), /항목/)
    const extraAsset = 'assets/' + 'c'.repeat(64) + '.png'
    await expectRejected(
      zipSync({ ...files, [extraAsset]: new Uint8Array(pngBytes(9)) }),
      /manifest 에 없는 파일/,
    )
    await expectRejected(
      zipSync({ ...files, 'manifest.json': enc({ ...manifest, format: '39page-share' }) }),
      /종류/,
    )
    await expectRejected(
      // ADR 0045 — 3 은 데크 그림이 든 전체 백업이다. 그보다 새 것만 거절한다.
      zipSync({ ...files, 'manifest.json': enc({ ...manifest, formatVersion: 4 }) }),
      /더 새 39page/,
    )
  })

  it('경로 순회가 든 ZIP', async () => {
    expect.hasAssertions()
    await expectRejected(zipSync({ '../manifest.json': new Uint8Array([1]) }), /항목/)
  })

  it('깨진 그림(디코딩 실패)은 그 연결만 빼고 미리보기에 적는다', async () => {
    const bytes = await exported()
    await newProfile()
    const tools = fakeImageTools({ failDecode: true })
    const read = await readFullBackupZip(bytes, tools, new Date())
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.artwork.assets).toHaveLength(0)
    expect(read.artwork.problems.map((p) => p.reason)).toEqual(['invalid-image', 'invalid-image'])
    expect(read.links.map((l) => l.mode)).toEqual(['default'])
    expect(read.dropped).toHaveLength(2)
  })
})

describe('D. 단계 복원 — 실패해도 기존 데이터를 지킨다', () => {
  async function prepared() {
    await newProfile()
    await seed()
    const { bytes } = await exportZip()
    await newProfile()
    await useLibraryStore().createPlaylist('MINE')
    const before = snapshotLibrary()
    const parts = importer()
    await parts.full.selectZip(new File([bytes as Uint8Array<ArrayBuffer>], 'x.zip'))
    expect(parts.full.active.value).toBe(true)
    return { ...parts, before }
  }

  it('그림을 저장할 공간이 없으면(스테이징 실패) 라이브러리를 건드리지 않는다', async () => {
    const { full, restore, before } = await prepared()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'blobs') throw new DOMException('full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await full.apply()
    expect(full.notice.value).toContain('공간이 부족')
    expect(snapshotLibrary()).toEqual(before)
    expect(restore.results.value).toEqual([])
    vi.restoreAllMocks()
    expect(useArtworkStore().usage.assets).toBe(0)
  })

  it('미리보기 뒤 다른 탭이 라이브러리를 바꿨으면 텍스트가 거절되고 스테이징한 그림을 되돌린다', async () => {
    const { full, restore } = await prepared()
    const raw = globalThis.localStorage.getItem('39page.library') ?? ''
    globalThis.localStorage.setItem('39page.library', raw.replace('MINE', 'MINE (other tab)'))
    await full.apply()
    expect(restore.stale.value).toBe(true)
    expect(useLibraryStore().playlists.map((p) => p.name)).not.toContain('LIST A')
    // 스테이징한 그림이 남지 않았다 (어느 연결도 쓰지 않음).
    const repo = useArtworkStore().repositoryForTransfer()
    expect((await repo?.snapshot())?.assets).toHaveLength(0)
  })

  it('연결 저장이 실패하면 "다시 시도" — 곡은 복원됐고, 다시 저장하면 그림까지 맞는다', async () => {
    const { full } = await prepared()
    const repo = useArtworkStore().repositoryForTransfer()
    if (repo === null) throw new Error('repo')
    const original = repo.replaceAssignments.bind(repo)
    repo.replaceAssignments = async () => ({ ok: false, reason: 'failed' })
    await full.apply()
    expect(useLibraryStore().playlists.map((p) => p.name)).toContain('LIST A')
    expect(full.artworkResult.value?.outcome).toBe('unsaved')
    expect(full.canRetryArtwork.value).toBe(true)

    repo.replaceAssignments = original
    await full.retryArtwork()
    expect(full.artworkResult.value?.outcome).toBe('saved')
    expect(useArtworkStore().assignments.size).toBe(3)
  })
})
