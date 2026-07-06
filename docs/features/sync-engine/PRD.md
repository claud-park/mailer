# F6 sync-engine — Feature PRD

> 2026-07-06 · Goal 1 산출물. 설계: deep-reasoner(Opus) 독립 2인스턴스(A: 데이터 아키텍처·읽기 경로 / B: 큐·동기화·실패 분류) → 합성([DECISIONS.md](DECISIONS.md) D1~D14). Codex 사용량 한도 불참.
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #6 — 오프라인-퍼스트 싱크 엔진

## 1. 목적

로컬 SQLite 캐시를 읽기의 진실로 승격하고, 뮤테이션을 영속 큐로 보증한다. 오프라인은 "실패"가 아니라 "지연"이 된다. F4가 확보한 "상호작용 인지 ≤100ms" 위에 F6는 (a) 콘텐츠 준비 레이턴시(캐시 히트 시 openThread:content ~수 ms), (b) 뮤테이션당 ~50 API 호출의 refresh churn 제거, (c) 오프라인 내성을 얹는다.

**전제(탐색으로 실증)**: 캐시 인프라(threads/messages/FTS)는 이미 write 경로가 완비돼 있으나 read 경로 미연결(`getCachedThreadDetail` 死코드). F6는 신규 저장소가 아니라 **기존 캐시를 read path에 연결 + 큐/분류기 신설**이다.

## 2. 범위

### In
- **읽기 로컬-퍼스트(SWR)**: `fetch-thread`/`fetch-threads`가 캐시 히트 시 즉시 반환 + 백그라운드 revalidate. 재검증 결과는 **diff payload 이벤트**로만 렌더러에 push(D1) — 렌더러는 이벤트에 재fetch로 반응하지 않는다(무한 재검증 루프 차단).
- **diff-push**: `mail:threads-changed {upserts, removals}` / `mail:thread-changed {threadId, detail}` / `mail:sync-state {online, pending}`. 뮤테이션·데몬발 변경은 main이 아는 델타만 push — 아카이브 1회당 ~50 API 호출 → 0. 데몬은 틱 종료 시 1발로 debounce(D12).
- **뮤테이션 캐시 낙관**: IPC 핸들러 진입 시 캐시에 라벨 델타 적용(큐 enqueue와 원자, D3) — 재시작 후 cold read도 뮤테이션 반영 상태.
- **뮤테이션 큐**: `mutations` 테이블(id/kind/payload/thread_id/attempts/next_attempt_at/last_error). **낙관 직행 유지 + 일시 실패에만 큐 폴백**(Option B, D4). per-thread FIFO 장벽(D6). 데몬 60s 틱 drain + 지수 backoff(base 10s·cap 15m·max 8회) + 재접속 즉시 drain 트리거.
- **실패 분류기** `lib/sync/classify`(순수): transient = ECONNRESET/ENOTFOUND/ETIMEDOUT/… 문자열 code ∪ 5xx/429/408, permanent = 그 외 4xx/404, **미분류(generic Error) = permanent**(D5 — F4/F5 주입 실패가 기존 롤백 경로에 그대로 남는 fail-safe). transient → 큐 잔류·낙관 유지(롤백 안 함), permanent → 기존 F4 롤백.
- **충돌 처리 v1**: LWW + 멱등 재적용 + drain 404는 drop(D8). CRDT/벡터클록 기각.
- **네트워크 상태**: 시도-기반이 권위(성공/transient로 플립), 렌더러 `online` 이벤트는 즉시-drain 가속기(D9). 데모/E2E는 `debug-set-online` 토글 + Mock coded-throw.
- **send**: 큐 제외(비멱등, D7). scheduled_sends에 attempts/backoff를 추가해 undo-window 후 발송 실패를 spill. at-least-once 잔여 리스크 문서화.
- **UI**: 사이드바 하단 조용한 한 줄만 — pending>0 "Syncing N…", offline "Offline — N pending", 그 외 없음(D10). 스레드별 pending 플래그·스피너 없음.
- **E2E**: TC-SY-* — 오프라인 낙관 유지(TC-SP-C 롤백과 대비 증명), drain, per-thread 순서, warm-hit openThread:content <100ms(D11), 데몬 debounce 1발, 기존 128건 무회귀 게이트.

### Out
- 렌더러 store.threads의 캐시 투영 강등(D2 기각 — 209 어서션 재작성급; store는 뷰 캐시 계층으로 유지)
- draft 동기화·send 멱등키(Message-ID 대조) — at-least-once 수용(D7)
- undo-window(10s) 중 크래시 시 send 유실 — 기존 갭, 범위 외(D14)
- openThread:content 게이트의 100ms hard 승격 — cold miss 존재, warm-hit 전용 어서션만(D11)
- stale 배지·동기화 스피너(D10), OT/CRDT(D8)

## 3. 성공 기준

1. E2E: 같은 스레드 2회차 열람의 `openThread:content` < 100ms(캐시 히트 증명).
2. E2E: 아카이브 성공 시 list refetch 0회(diff push 증명 — debug 호출 카운터), 데몬 다건 처리 시 change 이벤트 1발.
3. E2E: 오프라인 토글 후 아카이브 → 행 유지(롤백 없음) + 큐 depth 1 + "Offline — 1 pending" → 온라인 복귀 → drain → depth 0 + mock 서버 상태 일치.
4. E2E: 오프라인에서 같은 스레드 archive→applyLabel 순차 큐 → drain 순서 보존. drain 중 4xx → drop + 낙관 원복.
5. 기존 128건(특히 TC-SP-C1~C4 롤백) 전부 **무수정** green + vitest(classify 등 신규) + tsc.
6. 앱 재시작 후 cold read가 뮤테이션 반영 상태로 즉시 paint(캐시 낙관 영속).

## 4. 아키텍처

```
[읽기] loadThreads/openThread → IPC → cache hit? 즉시 반환(SWR)
         └ 백그라운드 revalidate → diff 계산 → threads-changed/thread-changed push
[쓰기] store 낙관 set(F4 유지) → IPC → 캐시 델타(원자) →
         큐 장벽(per-thread pending?) → enqueue : provider 직행
           ├ 성공 → threads-changed(아는 델타만)
           ├ transient → 큐 잔류·resolve(낙관 유지) + sync-state
           └ permanent → reject → 기존 F4 롤백
[drain] snooze.ts 데몬 4번째 루프(60s + 재접속 트리거): next_attempt_at 도래분
         멱등 재적용 → 성공 삭제 / 404·4xx drop+mutation-permanent-failed → 렌더러 refresh 조정
렌더러: threads-changed 병합만(재fetch 금지) · sync-state → 사이드바 한 줄
```

신규: `lib/sync/classify.ts`(+test), main 큐 CRUD(cache.ts), 캐시 리더(`getThreads`/`getCachedThreadDetail` 부활 — threads row+messages 조인 조립), attemptOrEnqueue 래퍼(ipc.ts), 데몬 drain 루프, Sidebar sync 라인. 변경: types.ts(이벤트 3종+syncState), preload, useThreads(병합 핸들러), gmail.ts(Mock coded-throw + debug-set-online).
