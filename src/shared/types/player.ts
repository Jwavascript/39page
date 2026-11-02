/**
 * 도메인 계층의 재생 상태.
 *
 * YouTube IFrame API의 숫자 상태값(-1, 0, 1, 2, 3, 5)을 **그대로 쓰지 않는다.**
 * 숫자 → `PlayerState` 변환은 `src/features/playback`의 어댑터 안에서만
 * 일어나고, store·테마·위젯은 이 유니온만 본다.
 *
 * 근거: `AGENTS.md` 규칙 4 (재생 로직과 테마 UI 분리),
 * `docs/architecture/SYSTEM_DESIGN.md` §4.6.
 */
export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
