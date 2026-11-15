import type { InjectionKey } from 'vue'

export interface ShareTarget {
  readonly playlistId: string
  readonly trackId?: string
}

export interface ShareRequest extends ShareTarget {
  readonly seq: number
}
export const SHARE_DIALOG: InjectionKey<{ open(target: ShareTarget): void }> =
  Symbol('39page.share-dialog')
