export type { StorageKey } from './keys'
export { REVISION_KEYS, STORAGE_KEYS } from './keys'

export type {
  DefineStorageOptions,
  ReadOutcome,
  ReadResult,
  StorageEnvelope,
  TypedStorage,
  WriteFailureReason,
  WriteResult,
} from './defineStorage'
export { defineStorage } from './defineStorage'

export type {
  Baseline,
  GateOutcome,
  LockManagerLike,
  StorageEventTarget,
  WriteGate,
} from './crossTab'
export {
  CONCURRENT_WRITE_WINDOW_MS,
  LOCK_TIMEOUT_MS,
  RECEIPT_EXPIRY_MS,
  VISIBILITY_TIMEOUT_MS,
  createBaseline,
  createWriteGate,
  currentLockManager,
} from './crossTab'
