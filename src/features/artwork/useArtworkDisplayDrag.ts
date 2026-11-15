import { type Ref } from 'vue'
import type { ArtworkDisplay } from '@/shared/types/artwork'

/** CSS object-position와 같은 기하: left = (frame - scaledImage) * position / 100. */
export function useArtworkDisplayDrag(
  display: Ref<ArtworkDisplay>,
  dimensions: Ref<{ width: number; height: number } | null>,
) {
  let start: {
    x: number
    y: number
    positionX: number
    positionY: number
    gapX: number
    gapY: number
    pointerId: number
  } | null = null
  function down(event: PointerEvent): void {
    if (event.button !== 0 || dimensions.value === null) return
    const target = event.currentTarget as HTMLElement
    const box = target.getBoundingClientRect()
    const image = dimensions.value
    const ratio =
      display.value.fit === 'cover'
        ? Math.max(box.width / image.width, box.height / image.height)
        : Math.min(box.width / image.width, box.height / image.height)
    start = {
      x: event.clientX,
      y: event.clientY,
      positionX: display.value.positionX,
      positionY: display.value.positionY,
      gapX: box.width - image.width * ratio * display.value.zoom,
      gapY: box.height - image.height * ratio * display.value.zoom,
      pointerId: event.pointerId,
    }
    target.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  function move(event: PointerEvent): void {
    if (start === null || event.pointerId !== start.pointerId) return
    const clamp = (value: number) => Math.min(100, Math.max(0, value))
    display.value = {
      ...display.value,
      positionX:
        Math.abs(start.gapX) < 1
          ? start.positionX
          : clamp(start.positionX + ((event.clientX - start.x) / start.gapX) * 100),
      positionY:
        Math.abs(start.gapY) < 1
          ? start.positionY
          : clamp(start.positionY + ((event.clientY - start.y) / start.gapY) * 100),
    }
  }
  function end(): void {
    start = null
  }
  return { down, move, end }
}
