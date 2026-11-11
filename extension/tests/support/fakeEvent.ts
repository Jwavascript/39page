/** `chrome.events.Event` 처럼 리스너를 모으고 직접 쏠 수 있는 가짜. */
export interface FakeEvent<L extends (...args: never[]) => unknown> {
  addListener(listener: L): void
  removeListener(listener: L): void
  hasListener(listener: L): boolean
  readonly listeners: L[]
  emit(...args: Parameters<L>): ReturnType<L>[]
}

export function fakeEvent<L extends (...args: never[]) => unknown>(): FakeEvent<L> {
  const listeners: L[] = []
  return {
    listeners,
    addListener: (listener) => {
      listeners.push(listener)
    },
    removeListener: (listener) => {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    },
    hasListener: (listener) => listeners.includes(listener),
    emit: (...args) => listeners.map((listener) => listener(...args) as ReturnType<L>),
  }
}
