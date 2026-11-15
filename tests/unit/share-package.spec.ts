/**
 * M12-4 — 파일 공유 패키지 (ARTWORK_DESIGN §8).
 *
 *   A. 만들기의 범위 — 고른 목록(또는 한 곡)과 그 그림만. 다른 목록 · Moments(끄면) 는 들어가지 않는다
 *   B. 가져오기 — 새 목록(새 id · 같은 이름이면 (2)) · 기존 목록에 추가 · 같은 영상 건너뛰기/그래도 추가 · 그림 연결
 *   C. Moments — 켰을 때만, 그 영상들 것만, 같은 것은 건너뜀
 *   D. 검증 — 다른 패키지 형식 · 깨진 곡
 */
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validateArtwork, type ValidatedArtwork } from '@/features/artwork/imageValidation'
import { readSharePackage, shareFileName } from '@/features/backup/sharePackage'
import { useShareExport, useShareImport } from '@/features/backup/useShare'
import { readZip } from '@/features/backup/zipPackage'
import { packagePolicy } from '@/features/backup/packageFormat'
import { useArtworkStore } from '@/stores/artwork'
import { useLibraryStore } from '@/stores/library'
import { useMomentsStore } from '@/stores/moments'

import { fakeImageTools, fileOf, pngBytes } from '../support/artworkFixtures'
import { captureDownloads, inSetup, newProfile, useNodeBlobs } from '../support/transferHarness'

const V1 = 'aaaaaaaaaaa'
const V2 = 'bbbbbbbbbbb'
const V3 = 'ccccccccccc'

let downloads: ReturnType<typeof captureDownloads>

beforeEach(() => {
  useNodeBlobs()
  downloads = captureDownloads()
})

afterEach(() => {
  downloads.restore()
  vi.unstubAllGlobals()
  globalThis.localStorage.clear()
})

async function art(seed: number): Promise<ValidatedArtwork> {
  const result = await validateArtwork(fileOf(pngBytes(seed), 'a.png'), fakeImageTools())
  if (!result.ok) throw new Error(result.reason)
  return result.artwork
}

/** 보내는 쪽: MIX(곡 둘 — 하나는 내 그림, 하나는 기본), SECRET(곡 하나), Moments 셋(그중 하나는 SECRET 곡). */
async function sender() {
  await newProfile()
  const library = useLibraryStore()
  const mix = await library.createPlaylist('MIX')
  const secret = await library.createPlaylist('SECRET')
  if (!mix.ok || !secret.ok) throw new Error('lists')
  const t1 = await library.addTrack(mix.playlistId, { videoId: V1, title: 'One' })
  const t2 = await library.addTrack(mix.playlistId, { videoId: V2, title: 'Two' })
  await library.addTrack(secret.playlistId, { videoId: V3, title: 'Private' })
  const id = (r: typeof t1) => (r.ok ? (r.trackId ?? '') : '')
  const artwork = useArtworkStore()
  await artwork.setCustom({ playlistId: mix.playlistId, trackId: id(t1) }, V1, await art(1), 0)
  await artwork.useDefault({ playlistId: mix.playlistId, trackId: id(t2) }, V2, 0)
  const moments = useMomentsStore()
  await moments.add({ videoId: V1, atSeconds: 5, note: 'intro', title: 'One' })
  await moments.add({ videoId: V2, atSeconds: 9, note: 'drop', title: 'Two' })
  await moments.add({ videoId: V3, atSeconds: 1, note: 'private note', title: 'Private' })
  return { mixId: mix.playlistId, t1: id(t1), t2: id(t2) }
}

async function makeShare(options: {
  playlistId: string
  trackId?: string
  includeMoments: boolean
}) {
  const model = inSetup(() => useShareExport())
  await model.exportShare(options)
  expect(model.failed.value).toBe(false)
  return {
    bytes: await downloads.lastBytes(),
    name: downloads.captured[downloads.captured.length - 1]?.name,
    notice: model.notice.value,
  }
}

function shareJson(bytes: Uint8Array): Record<string, unknown> {
  const zip = readZip(bytes, packagePolicy(['manifest.json', 'share.json']))
  if (!zip.ok) throw new Error(zip.error.kind)
  return JSON.parse(new TextDecoder().decode(zip.files.get('share.json'))) as Record<
    string,
    unknown
  >
}

describe('A. 만들기 — 고른 것만', () => {
  it('목록 하나: 곡 · 순서 · 그림만, 다른 목록 · Moments 는 없다', async () => {
    const s = await sender()
    const { bytes, name, notice } = await makeShare({ playlistId: s.mixId, includeMoments: false })
    expect(name).toBe('MIX.39page-share.zip')
    expect(notice).toContain('곡 2개 · 그림 1개')
    const json = shareJson(bytes)
    const text = JSON.stringify(json)
    expect(json.kind).toBe('playlist')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('Private')
    expect(json.moments).toBeUndefined()
    const tracks = (json.playlist as { tracks: { title: string; artwork?: { mode: string } }[] })
      .tracks
    expect(tracks.map((t) => [t.title, t.artwork?.mode])).toEqual([
      ['One', 'custom'],
      ['Two', 'default'],
    ])
  })

  it('한 곡 + Moments 켬: 그 곡의 영상 Moment 만', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, trackId: s.t2, includeMoments: true })
    const json = shareJson(bytes)
    expect(json.kind).toBe('track')
    expect((json.playlist as { tracks: unknown[] }).tracks).toHaveLength(1)
    expect((json.moments as { note: string }[]).map((m) => m.note)).toEqual(['drop'])
    expect((json.assets as unknown[]).length).toBe(0) // 기본 그림 — 이미지 없음
  })

  it('파일 이름에 쓸 수 없는 글자를 걷어낸다', () => {
    expect(shareFileName('a/b:c*?"<>|')).toBe('a_b_c______.39page-share.zip')
    expect(shareFileName('   ')).toBe('39page.39page-share.zip')
  })
})

describe('B. 가져오기', () => {
  it('새 목록 — 새 id 로 만들고 그림을 연결한다 (다른 프로필)', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, includeMoments: false })

    await newProfile()
    const incoming = inSetup(() => useShareImport())
    await incoming.selectFile(new File([bytes as Uint8Array<ArrayBuffer>], 'MIX.39page-share.zip'))
    expect(incoming.preview.value).toMatchObject({
      kind: 'playlist',
      name: 'MIX',
      tracks: 2,
      images: 1,
      moments: null,
    })
    await incoming.apply()
    expect(incoming.failed.value).toBe(false)

    const library = useLibraryStore()
    const mix = library.playlists.find((p) => p.name === 'MIX')
    expect(mix?.tracks.map((t) => t.title)).toEqual(['One', 'Two'])
    expect(mix?.tracks.map((t) => t.id)).not.toContain(s.t1) // 보낸 쪽 id 를 쓰지 않는다
    const artwork = useArtworkStore()
    expect(artwork.preferenceFor({ playlistId: mix!.id, trackId: mix!.tracks[0]!.id }).mode).toBe(
      'custom',
    )
    expect(artwork.preferenceFor({ playlistId: mix!.id, trackId: mix!.tracks[1]!.id })).toEqual({
      mode: 'default',
    })
    expect(artwork.usage.assets).toBe(1)
    expect(useMomentsStore().count).toBe(0)
  })

  it('같은 이름의 목록이 있으면 "(2)", 같은 그림은 다시 저장하지 않는다', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, includeMoments: false })
    const incoming = inSetup(() => useShareImport())
    await incoming.selectFile(new File([bytes as Uint8Array<ArrayBuffer>], 'x.zip'))
    await incoming.apply()
    expect(useLibraryStore().playlists.map((p) => p.name)).toEqual(['MIX', 'SECRET', 'MIX (2)'])
    expect(useArtworkStore().usage.assets).toBe(1)
  })

  it('기존 목록에 추가 — 같은 영상은 기본으로 건너뛰고, "그래도 추가" 면 더한다', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, includeMoments: false })
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'x.zip')

    const skip = inSetup(() => useShareImport())
    await skip.selectFile(file)
    skip.target.value = s.mixId
    expect(skip.preview.value?.duplicates).toBe(2)
    await skip.apply()
    expect(useLibraryStore().getPlaylist(s.mixId)?.tracks).toHaveLength(2)
    expect(skip.results.value.join(' ')).toContain('2곡은 건너뜀')

    const add = inSetup(() => useShareImport())
    await add.selectFile(file)
    add.target.value = s.mixId
    add.duplicates.value = 'add'
    await add.apply()
    const tracks = useLibraryStore().getPlaylist(s.mixId)?.tracks ?? []
    expect(tracks.map((t) => t.title)).toEqual(['One', 'Two', 'One', 'Two'])
    // 새로 더한 같은 영상의 트랙에도 그림이 따로 연결된다.
    expect(
      useArtworkStore().preferenceFor({ playlistId: s.mixId, trackId: tracks[2]!.id }).mode,
    ).toBe('custom')
  })
})

describe('C. Moments — 켰을 때만, 같은 것은 건너뜀', () => {
  it('들어 있어도 끄면 가져오지 않고, 켜면 가져오며, 두 번째에는 건너뛴다', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, includeMoments: true })
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'x.zip')

    await newProfile()
    const off = inSetup(() => useShareImport())
    await off.selectFile(file)
    expect(off.preview.value?.moments).toBe(2)
    await off.apply()
    expect(useMomentsStore().count).toBe(0)

    const on = inSetup(() => useShareImport())
    await on.selectFile(file)
    on.includeMoments.value = true
    await on.apply()
    expect(
      useMomentsStore()
        .moments.map((m) => m.note)
        .sort(),
    ).toEqual(['drop', 'intro'])

    const again = inSetup(() => useShareImport())
    await again.selectFile(file)
    again.includeMoments.value = true
    await again.apply()
    expect(useMomentsStore().count).toBe(2)
  })
})

describe('D. 검증', () => {
  it('전체 백업 ZIP 을 공유 파일로 가져오면 거절한다 (형식이 다름)', async () => {
    const enc = (v: unknown) => new Uint8Array(new TextEncoder().encode(JSON.stringify(v)))
    const fake = zipSync({
      'manifest.json': enc({ format: '39page-full-backup', formatVersion: 1, files: [] }),
    })
    const read = await readSharePackage(fake, fakeImageTools(), new Date())
    expect(read.ok).toBe(false)
  })

  it('곡의 영상 id 가 형식에 맞지 않으면 받지 않는다', async () => {
    const s = await sender()
    const { bytes } = await makeShare({ playlistId: s.mixId, includeMoments: false })
    const zip = readZip(bytes, packagePolicy(['manifest.json', 'share.json']))
    if (!zip.ok) throw new Error('zip')
    const json = JSON.parse(new TextDecoder().decode(zip.files.get('share.json'))) as {
      playlist: { tracks: { videoId: string }[] }
    }
    json.playlist.tracks[0]!.videoId = '<script>'
    // manifest 가 해시로 막는다 — 고친 share.json 은 manifest 와 다르다.
    const files = Object.fromEntries([...zip.files].map(([k, v]) => [k, new Uint8Array(v)]))
    files['share.json'] = new Uint8Array(new TextEncoder().encode(JSON.stringify(json)))
    const read = await readSharePackage(zipSync(files), fakeImageTools(), new Date())
    expect(read).toMatchObject({ ok: false })
  })
})
