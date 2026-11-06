/**
 * 백업 파일 내려받기 (M8-2). **브라우저 경계다.**
 *
 * 조립(`createBackup`)과 분리해 둔 이유: 조립은 순수 함수로 전수 검증하고,
 * 여기는 Blob·`URL.createObjectURL`·`<a download>` 처럼 환경에 기대는 것만
 * 모은다. 섞으면 조립을 jsdom 에서 검증할 수 없다.
 *
 * 실패를 **던지지 않고 결과로 알린다.** 저장 계층의 `write()` 와 같은 방식이다
 * (`SYSTEM_DESIGN.md` §7.1) — 호출부가 사용자 안내를 결정한다.
 */
import type { BackupFile } from './backupSchema'

/** 파일 이름 접두사. 날짜가 뒤에 붙는다. */
export const BACKUP_FILE_PREFIX = '39page-backup'

/**
 * `39page-backup-20261106-1321.json`
 *
 * **로컬 시각**이다. 사용자가 "어제 받은 것" 을 찾을 때 자기 시계로 보는 것이
 * 맞다. 파일 안의 `exportedAt` 은 UTC 이므로 기계가 읽을 값은 따로 있다.
 *
 * 콜론을 쓰지 않는다 — Windows 파일 이름에서 금지 문자다. 초도 넣지 않는다.
 * 같은 분에 두 번 받으면 브라우저가 `(1)` 을 붙인다.
 */
export function backupFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${BACKUP_FILE_PREFIX}-${date}-${time}.json`
}

/**
 * 읽지 못한 원본을 원문 그대로 꺼낼 때의 이름 (M8-3).
 *
 * `.txt` 다. 우리가 JSON 으로 해석하지 못한 문자열이므로 `.json` 을 붙이면
 * 거짓말이 된다.
 */
export function rawDumpFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `39page-raw-library-${date}-${time}.txt`
}

export type DownloadFailureReason =
  /** 객체를 JSON 으로 만들 수 없다. */
  | 'serialize-failed'
  /** 이 환경에 내려받기 수단이 없다 (`URL.createObjectURL` 부재 등). */
  | 'unsupported'
  /** 그 외. */
  | 'unknown'

export type DownloadResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: DownloadFailureReason; readonly error?: unknown }

/**
 * 들여쓰기 두 칸으로 직렬화한다.
 *
 * 파일이 20% 쯤 커지지만 **사람이 열어볼 수 있어야 한다.** 평문이라는 사실을
 * 사용자에게 알리는 기능이므로, 열었을 때 읽히는 편이 정직하다.
 */
function serialize(file: BackupFile): string {
  return JSON.stringify(file, null, 2)
}

/**
 * 문자열을 파일로 내려받는다 (M8-3 에서 분리).
 *
 * 백업 JSON 과 **읽지 못한 원본 원문**이 같은 경계를 쓴다. 원문은 우리가
 * 해석하지 못한 문자열이므로 직렬화할 것이 없다 — 그래서 조립과 내려받기를
 * 나눠 두면 그대로 재사용된다.
 *
 * `localStorage` 도 store 도 건드리지 않는다.
 */
export function downloadText(
  text: string,
  fileName: string,
  type = 'application/json;charset=utf-8',
): DownloadResult {
  if (typeof URL.createObjectURL !== 'function' || typeof Blob !== 'function') {
    return { ok: false, reason: 'unsupported' }
  }

  let url: string | null = null
  try {
    /*
     * `application/json` 은 RFC 8259 에 따라 UTF-8 이고, Blob 은 문자열을
     * UTF-8 로 인코딩한다. `charset` 을 적어 의도를 드러낸다.
     */
    const blob = new Blob([text], { type })
    url = URL.createObjectURL(blob)

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()

    /*
     * 즉시 해제하지 않는다. 클릭 직후 동기적으로 `revokeObjectURL` 을 부르면
     * 일부 브라우저에서 다운로드가 시작되기 전에 주소가 사라진다. 다음
     * 매크로태스크에서 해제한다.
     *
     * 마운트 시점에 만드는 타이머가 아니므로 수명주기 정리 대상이 아니다 —
     * 사용자가 누를 때 한 번 생기고 즉시 끝난다.
     */
    const revoke = url
    setTimeout(() => {
      URL.revokeObjectURL(revoke)
    }, 0)
    url = null

    // 바이트 수는 UTF-8 기준이다. 문자 수가 아니다.
    return { ok: true, fileName, bytes: blob.size }
  } catch (error) {
    if (url !== null) URL.revokeObjectURL(url)
    return { ok: false, reason: 'unknown', error }
  }
}

/**
 * 백업 객체를 파일로 내려받는다.
 *
 * 직렬화만 하고 나머지는 `downloadText` 에 넘긴다.
 */
export function downloadBackup(file: BackupFile, fileName: string): DownloadResult {
  let text: string
  try {
    text = serialize(file)
  } catch (error) {
    return { ok: false, reason: 'serialize-failed', error }
  }

  return downloadText(text, fileName)
}
