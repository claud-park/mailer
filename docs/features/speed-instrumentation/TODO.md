# F4 speed-instrumentation — Checkpoint TODO

> Goal 2 산출물. 각 CP는 `npx tsc --noEmit` + `npm test` 통과, breaking change 시 리뷰 프로토콜(react-best-practices + code-review low → 커밋 → push).
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] deep-reasoner(Opus) 독립 2인스턴스 병렬 설계 → 합성 (D1~D14)
- [x] PRD/TODO/TC/DECISIONS 작성
- [ ] D8(사용자向 UI 0) 사용자 복귀 시 확인

## CP1. `lib/latency.ts` 순수 코어 (배선 없음)
- [x] 버짓 테이블 상수 + `LatencyAction` 유니온 + `classify(actionId)`(budgeted/informational)
- [x] 고정 링버퍼(액션별 50) push/스냅샷
- [x] p50/p95 — n<20이면 null(coach 관례), 정렬 온디맨드
- [x] 위반 판정 + 집계 리듀서(`zenmail-latency` persist용 모양)
- [x] `lib/latency.test.ts` vitest (경계: 빈 버퍼, n=19/20, 링 순환, gross 카운트)
- [x] tsc + npm test 통과

## CP2. 계측 배선 + F3 부채 완화
- [x] `store/latency.ts` — 휘발 링버퍼 보관 + `begin(actionId)`/`commit` (double-rAF 종료마크, set-return 델타 2차 기록)
- [x] mail.ts 뮤테이션 6종(archive/trash/markRead/applyLabel/snooze/send) 진입점 계측 배선 — 동작 무변경
- [x] `window.__zenmailLatency = { snapshot() }` 노출 (D9, 무조건)
- [x] D12: CommandPalette.tsx `recordEfficient`를 perform() 뒤로 이동
- [x] 위반 시 DEV console.warn
- [x] tsc + npm test (스냅샷 실측 스모크는 CP6 E2E에서 수행)

## CP3. 롤백 (`withOptimistic`)
- [x] `withOptimistic(actionId, mutate, invert)` 헬퍼 — invert set + 에러 토스트 + refresh() 사후 조정 (D4)
- [x] 5개 낙관 액션(archive/trash/markRead/applyLabel/snooze)에 적용 — invert: 재삽입 가드/멱등 필드 반전
- [x] `mail:__debug-fail-next-modify` debug IPC (ZENMAIL_E2E_PORT 게이트, D11)
- [x] invert 동시성 단위 테스트(겹친 in-flight 시나리오)
- [x] tsc + npm test

## CP4. followup 낙관화 + openThread 계측
- [x] scheduleFollowup/cancelFollowup/dismissFollowup 낙관 전환 + invert 롤백 (D5), refreshFollowups는 사후 조정
- [x] followup 실패 주입 경로(debug IPC 확장 또는 공용 플래그)
- [x] openThread `openThread:select`(어포던스 페인트) / `openThread:content`(fetch-class) 분리 계측 (D7)
- [x] tsc + npm test

## CP5. 개발자 표면 + 위반 집계 persist
- [x] `components/LatencyHud.tsx` — ⌘⌥⇧L 토글(미광고), per-action p50/p95/count/위반수, CoachToastHost 형제 마운트 (D8)
- [x] `zenmail-latency` 위반 집계 persist(원시 샘플 제외 — D3)
- [x] HUD 열림 중 전역 단축키 간섭 없음(오버레이 비모달 — 읽기 전용)
- [x] tsc + npm test

## CP6. E2E 게이트 (run-tc.mjs 확장)
- [x] `latencyState(page)` 헬퍼 — `window.__zenmailLatency.snapshot()` 판독
- [x] TC-SP-B* burst 게이트: 웜업 2 폐기, K≥25, p50≤100 && gross(400ms)==0 (D10)
- [x] TC-SP-C* 롤백: 실패 주입 → 복원+토스트, 연타 부분 실패 정합성
- [x] TC-SP-D*/E*/F* followup 낙관·openThread 분리·HUD
- [x] TC-SP-G2: 기존 F1~F3 전체(93건) 무회귀 — 특히 D12 이동 후 TC-KM-*
- [x] 기존 npm test/tsc 게이트 앞에 배선, 연속 2회 재실행 안정성 확인
- [x] TC.md 상태 갱신

## CP7. 마무리 (Goal 5~8)
- [ ] /react-best-practices 리뷰 반영
- [ ] /impeccable 대체(web-design-guidelines, F1 D14 선례) 감사 — HUD·에러 토스트 표면
- [ ] /code-review low → 최종 커밋 → push
- [ ] DEV_WORKFLOW/TODO 스냅샷 갱신 + Obsidian 체크포인트
