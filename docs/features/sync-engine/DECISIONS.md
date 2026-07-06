# sync-engine — DECISIONS

> Goal 4 산출물. 설계 병렬: deep-reasoner(Opus) 독립 2인스턴스(A: 데이터 아키텍처 / B: 큐·동기화) → 오케스트레이터 합성. 두 안은 상호보완(읽기/쓰기)이었고 충돌은 D1 각주의 이벤트 시맨틱 1건.

## 읽기 경로 (설계 A 채택)

### D1. poke → payload 승격: `threads-changed {upserts, removals}` diff-push가 유일한 변경 전파
- **결정**: 기존 `threads-updated`(데이터 없는 poke → 렌더러 full refetch)를 diff payload 이벤트로 대체. 렌더러는 이벤트에 **재fetch로 절대 반응하지 않고** store 병합만.
- **이유**: (a) SWR을 poke 위에 얹으면 revalidate 완료→poke→refetch→또 revalidate의 **무한 재검증 루프**(A 검증 — 이 승격은 선택이 아니라 SWR의 성립 조건). (b) 아카이브 1회 = list 1 + metadata get ×50이던 churn이 0호출로. (c) full-relist의 eventual-consistency 재유입 flicker가 구조적으로 소멸(push는 main이 아는 델타만).
- **B와의 충돌 해소**: B는 drain 후 poke→refresh로 LWW 수렴을 삼았으나, drain 발신부도 payload로 전환(main이 델타를 앎). 서버측 외부 변경의 수렴은 기존 60s 폴링(이미 존재)이 담당.

### D2. 렌더러 store.threads는 뷰 캐시로 유지 — 캐시 투영 강등 기각 (A)
- **이유**: store 낙관·롤백에 F4 액션 전부와 E2E 209 어서션이 묶여 있음. 두 낙관(store/cache)은 동일 델타의 멱등 중복 적용이라 발산하지 않음 — 중복이 아니라 계층(즉시성 vs 영속성). diff 도착 시 캐시(서버 반영)가 최종 승자.

### D3. 캐시 낙관 델타는 IPC 핸들러 진입 시, 큐 enqueue와 원자 (A+B 합의)
- **이유**: 캐시가 cold-read SoT이므로 재시작 직후에도 뮤테이션 반영 상태여야 함. 큐 등록과 같은 SQLite 트랜잭션이면 crash 복구 시 큐·캐시 일관.

### D11. openThread SWR: 캐시 히트 즉시 반환 + 백그라운드 revalidate, 게이트 승격은 보류
- `getCachedThreadDetail` 부활 — 단 messages 테이블엔 subject/labelIds가 없어 threads row와 **조인 조립** 필요(A 발견). 렌더러 stale 가드(activeThreadId 체크)가 이미 있어 늦은 revalidate 안전.
- `openThread:content` 300ms informational 게이트는 유지(cold miss 존재). 캐시 히트 증명은 **warm-hit(2회차 열람) < 100ms 전용 E2E 어서션**으로.

### D12. 데몬 change 발신은 틱 종료 시 1발로 debounce (A)
- 현재 due 항목당 개별 발신(틱당 N회 refetch 유발) → 틱 동안 변경 수집 후 단일 payload push.

## 쓰기 경로 (설계 B 채택)

### D4. 큐 = 낙관 직행 유지 + 일시 실패에만 폴백(Option B), 단일 라이터 큐 기각
- **이유**: 항상-큐(single-writer)는 렌더러의 await-reject 롤백 계약을 이벤트 구동으로 전면 재작성 → TC-SP-C의 "await 실패→행 복원" 타이밍 파손. Option B는 온라인 happy path와 영구실패 롤백 경로의 **렌더러 코드 변경 0**.

### D5. 실패 분류: 미분류(generic Error) = permanent — fail-safe (B의 결정적 발견)
- transient = 문자열 code(ECONNRESET/ENOTFOUND/ETIMEDOUT/EAI_AGAIN/ECONNREFUSED/ENETUNREACH/EPIPE) ∪ status 5xx/429/408. permanent = 그 외 4xx/404 및 **code·status 부재**.
- **이유**: F4/F5의 주입 실패(`new Error('injected failure')`)는 code/status가 없어 자동으로 영구→기존 롤백 경로 → **TC-SP-C1~C4 무수정 보존**. 원칙적으로도 정체불명 오류의 무한 재시도(poison message)보다 사용자 노출이 안전. gaxios 에러 모양(code: string, status: number)은 B가 node_modules에서 직접 검증, snooze.ts 404 처리 선례와 일치.

### D6. 순서 보장 = per-thread FIFO 장벽 (전역 FIFO 기각)
- 직행 전 `hasPendingMutations(threadId)` 검사 — 대기 항목이 있으면 온라인이어도 enqueue(순서 역전 방지). thread 간 라벨 작업은 독립이라 전역 직렬화는 불필요한 지연.

### D7. send는 큐 제외, scheduled_sends에 backoff spill (B)
- send는 비멱등 — 라벨 큐와 섞으면 중복 발송 벡터. undo-window(10s in-memory) 후 발송 실패만 scheduled_sends(+attempts/next_attempt_at)로 spill해 데몬 재시도. **post-commit 응답 유실 시 이중 발송은 at-least-once로 수용·문서화**(Gmail idempotency key 미지원, Sent 대조는 과설계).

### D8. 충돌 = LWW + 멱등 재적용 + drain 404 drop (CRDT/OT/벡터클록 기각)
- 큐 항목 전원이 멱등 라벨 델타(Gmail threads.modify 수렴적). 서버 우세 자연스러움. 엣지: 큐 snooze vs 서버 archive → no-op 수렴, drain 404 → drop(followup 404 정리 선례), 타 기기 변경 → 다음 fetch 정정.

### D9. 네트워크 = 시도-기반 권위 + navigator.onLine 가속기 (단독 onLine 기각)
- transient 실패 → online=false, 성공 → true. 렌더러 online 이벤트는 즉시-drain 트리거로만(라우터-연결·인터넷-없음 오탐 회피). 60s 데몬 틱이 백스톱.

### D10. UI = 사이드바 하단 조용한 한 줄만 (A+B 합의)
- pending>0 "Syncing N…" / offline "Offline — N pending" / 그 외 아무것도 없음. 스레드별 pending 플래그·스피너·차단 모달 금지(미니멀리즘). 큐 배수 중 영구화만 `mutation-permanent-failed` 이벤트 → 렌더러 refresh 조정 + 토스트.

## E2E·범위

### D13. 오프라인 시뮬레이션은 기존 실패 훅과 분리 (A+B 합의)
- `maybeInjectDebugFailure`(generic Error, 400ms)는 **영구-롤백 경로 전용으로 불변** — TC-SP 보존. 오프라인은 신규 `debug-set-online(false)` → Mock provider modify/send가 `{code:'ECONNRESET'}` coded-throw. 주입 방식이 시맨틱을 자연 분기.

### D14. 범위 외 명시
- undo-window 중 크래시 시 send 유실(기존 갭), draft 동기화, openThread:content hard 게이트 승격(F6 후 데이터 축적 뒤), Real Gmail eventual-consistency flicker 실측(diff-push로 구조적 완화, 실계정 검증은 OAuth E2E 백로그와 함께).
