import type { InjectionKey } from 'vue'

/**
 * 공유 대화상자를 열 때의 대상 — 목록 하나, 그 목록의 곡 하나, 또는 Moment 하나 (ADR 0040 에서 Moment 를 더했다).
 * Moment 는 링크로만 공유한다 — 파일(ZIP) 공유는 목록 · 곡 단위다.
 */
export type ShareTarget =
  { readonly playlistId: string; readonly trackId?: string } | { readonly momentId: string }

export type ShareRequest = ShareTarget & { readonly seq: number }

export const SHARE_DIALOG: InjectionKey<{ open(target: ShareTarget): void }> =
  Symbol('39page.share-dialog')
