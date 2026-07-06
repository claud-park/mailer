# F6 sync-engine — Checkpoint TODO

> Goal 2 산출물. 각 CP는 tsc + npm test 통과, breaking change 시 리뷰 프로토콜. **CP7 전까지 기존 E2E 128건 무회귀가 설계 불변식**(오프라인 미토글·diff-push 전환 CP는 회귀 게이트 동반).
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] deep-reasoner(Opus) 독립 2인스턴스(A: 읽기 / B: 쓰기) 병렬 설계 → 합성 (D1~D14)
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. 순수 코어 + 캐시 계층 (dead-code additive, 배선 없음)
- [x] `mutations` 테이블 + CRUD(enqueue/listDrainable/markAttempt/remove/hasPendingMutations/queueDepth) — scheduled_sends 패턴
- [x] 캐시 리더: `getThreads(query)` · `getCachedThreadDetail`(threads row + messages 조인으로 ThreadDetail 조립)
- [x] 캐시 델타 writer: `applyLabelDelta(threadId, add, remove)` · `removeThreadFromCache`(FTS 동기 포함)
- [x] `src/renderer/lib/sync.ts`(또는 shared) — `classifyError(err): 'transient'|'permanent'`(D5 규칙) 순수 + vitest(coded/status/미분류 경계)
- [x] backoff 계산 순수 함수(base 10s·2^n·cap 15m·jitter) + vitest
- [x] tsc + npm test (기존 96 유지 + 신규)

## CP2. 쓰기 경로 배선 (오프라인 미토글 시 행동 불변)
- [x] main online-flag 모듈 + `mail:sync-state {online, pending}` 이벤트 발신기
- [x] `attemptOrEnqueue` 래퍼: 캐시 델타(원자, D3) → 장벽(hasPending→enqueue, D6) → 직행 → classify 분기(transient=큐 잔류·resolve / permanent=rethrow)
- [x] modify-labels/snooze 핸들러 래핑 (기존 maybeInjectDebugFailure는 래퍼 안쪽에서 generic throw 유지 — TC-SP 보존 확인)
- [x] Mock provider coded-throw(`{code:'ECONNRESET'}`) 분기 + `mail:debug-set-online` 디버그 IPC(ZENMAIL_E2E_PORT 게이트)
- [x] 렌더러 online 이벤트 → main 전달 IPC(가속기, D9)
- [x] tsc + npm test + **기존 E2E 128 무회귀 1회 실행**

## CP3. 데몬 drain + debounce
- [x] snooze.ts 4번째 루프: next_attempt_at 도래분 drain(per-thread 순서), 성공 삭제 / 404·4xx drop + `mail:mutation-permanent-failed` / transient backoff 갱신
- [x] 재접속 즉시 drain 트리거(온라인 플립 시)
- [x] 데몬 change 발신 debounce: 틱 동안 수집 → 종료 시 1발(D12) — 이 시점엔 아직 poke(threads-updated)로
- [x] sync-state 발신(큐 depth 변화 시)
- [x] tsc + npm test

## CP4. openThread SWR (읽기 경로 1)
- [x] fetch-thread: 캐시 히트 즉시 반환 + 백그라운드 revalidate → `mail:thread-changed {threadId, detail}` (변경 시만)
- [x] 렌더러 onThreadChanged: activeThreadId 일치 시만 set(기존 stale 가드 재사용)
- [x] tsc + npm test + E2E 스모크(openThread 관련 기존 TC)

## CP5. diff-push 전환 (최고 위험 — D1)
- [ ] `mail:threads-changed {upserts, removals}` 이벤트 + 뮤테이션 성공·데몬·revalidate 발신부 전환, threads-updated 발신 제거
- [ ] 렌더러 useThreads: refetch 반응 제거 → store 병합(upsert/remove + clampSelection), 60s 폴링은 유지(외부 변경 수렴)
- [ ] followup/labels 갱신 경로 정리(refresh() 의존처 재점검)
- [ ] tsc + npm test + **기존 E2E 128 전체 실행 — green 필수**
- [ ] react-best-practices + code-review low → 커밋 → push

## CP6. fetch-threads cold-read SWR (읽기 경로 2)
- [ ] fetch-threads: 캐시 히트 즉시 반환(초기/라벨전환/검색) + 백그라운드 revalidate → diff push
- [ ] 렌더러 2단 병합의 order/selectedIndex 안정성 — 기존 order TC로 검증
- [ ] tsc + npm test + E2E 전체

## CP7. send spill + UI
- [ ] scheduled_sends에 attempts/next_attempt_at 추가, undo-timer 발송 실패 시 spill → 데몬 재시도(D7)
- [ ] Sidebar 하단 sync 한 줄(D10) + store sync 필드(onSyncState) + mutation-permanent-failed 구독(refresh 조정+토스트)
- [ ] tsc + npm test

## CP8. E2E (TC-SY-*) + 마무리 (Goal 5~8)
- [ ] TC-SY-A~G: 오프라인 낙관 유지·drain·per-thread 순서·warm-hit<100ms·debounce 1발·재시작 cold read·drain 4xx drop
- [ ] provider 호출 카운터 debug 훅(churn 0회 증명)
- [ ] 기존 128 무회귀 게이트 + 연속 2회 안정
- [ ] react-best-practices + web-design-guidelines + code-review low
- [ ] TC/TODO/DEV_WORKFLOW/루트 TODO 갱신 + Obsidian
