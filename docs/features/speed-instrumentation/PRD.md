# F4 speed-instrumentation — Feature PRD

> 2026-07-04 · Goal 1 산출물. 설계: deep-reasoner(Opus) 독립 2인스턴스 병렬 → 합성([DECISIONS.md](DECISIONS.md) D1~). Codex는 사용량 한도(2026-08-02 리셋)로 불참(F3 D4 선례).
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #1 (+#7) — "모든 액션 100ms"

## 1. 목적

Superhuman의 "100ms 룰"을 제품 약속이 아닌 **측정되는 불변식**으로 만든다. (a) 인터랙션 레이턴시를 앱이 스스로 계측하고, (b) 남은 비관적 뮤테이션 경로를 낙관화 + 실패 복구를 갖추고, (c) 이후 개발에서 예산이 깨지면 E2E 게이트가 잡아낸다. 속도는 대시보드가 아니라 체감으로 전달한다 — 사용자向 레이턴시 UI는 만들지 않는다(D8).

## 2. "100ms"의 조작적 정의 (D1 — 이 feature의 축)

**측정 구간 = 스토어 액션 진입 → 낙관적 `set`의 페인트 커밋(double-rAF).** `await api()` 이후의 서버 재조정 페인트는 예산에서 명시적으로 제외한다.

- 낙관적 `set`은 discrete 이벤트 핸들러 안에서 동기 실행되고, IPC continuation은 별도 배치/페인트다 — 코드 구조상 두 구간이 깨끗이 분리된다.
- F3 `bumpStat`(IPC 완료 후 호출, mail.ts:464)은 이 정의상 종료마크로 부적합 — F4 계측은 coach 계층과 **개념적으로 분리된 별도 계층**이다(coach = 모달리티 집계, latency = 뮤테이션 페인트 비용).
- 낙관적 예산 경로에 `startTransition` 도입 금지(페인트 지연 커밋으로 측정·체감 모두 훼손, D13).

## 3. 범위

### In
- **계측 코어** `lib/latency.ts`(순수, vitest): 액션별 링버퍼(50), p50/p95(n<20이면 null — coach 관례), 버짓 테이블, 위반 판정.
- **계측 배선**: 뮤테이션 액션(archive/trash/markRead/applyLabel/snooze/send/followup 3종) 진입점 시작마크 + 낙관 set 직후 double-rAF 종료마크. set-return 델타를 2차 진단으로 병행 기록(회귀 국소화: 리듀서 비용 vs 렌더 비용). `window.__zenmailLatency.snapshot()` 노출(무조건, read-only — D9).
- **낙관적 전면화**: scheduleFollowup/cancelFollowup/dismissFollowup 낙관 전환(순차 2-await + Map 재구축을 임계경로에서 제거). send는 구조 유지·계측만(IPC가 즉시 리턴하는 undo-window 설계라 이미 저지연 — D6).
- **실패 롤백**: `withOptimistic` 헬퍼 — 엔티티별 역패치(전체 스냅샷 금지, D4) + 에러 토스트 + `refresh()` 사후 조정. 성공 경로는 기존 `notifyThreadsUpdated`→refresh 자가 치유를 그대로 사용.
- **openThread**: "선택/로딩 어포던스 페인트"(100ms 버짓)와 "콘텐츠 준비"(fetch-class 300ms, 정보성)를 분리 계측. 콘텐츠 최적화는 F6(D7).
- **회귀 감시**: 위반 집계만 localStorage `zenmail-latency`에 persist(원시 샘플 persist 금지 — D3), DEV console.warn, E2E 레이턴시 게이트(웜업 폐기 + K≥25 burst + p50≤100ms + 400ms 초과 0건 — D10), 실패 주입 디버그 IPC(D11).
- **개발자 표면**: 숨김 LatencyHud(⌘⌥⇧L 토글, 미광고) — per-action p50/p95/위반수(D8).
- **F3 부채 완화**: `recordEfficient`를 kbar perform 뒤로 이동 — 키보드 임계 경로에서 동기 localStorage 직렬화 제거(D12). TC-KM 회귀로 검증.

### Out
- 사용자向 레이턴시 UI(StatsPanel 확장·상시 HUD 기각 — D8)
- openThread 콘텐츠 낙관화·스레드 목록 캐시 우선 읽기(→ F6 sync-engine)
- 매 뮤테이션 후 전체 refresh churn의 근본 해결(diff 갱신·뮤테이션 큐 → F6; F4는 계측으로 기록만)
- Event Timing API(PerformanceObserver) 기반 계측(D2 기각 — 후속 보강 후보)
- 원시 샘플의 세션 간 persist(기기별 절대값이라 오도적 — D3)

## 4. 버짓 테이블

| 액션 클래스 | actionId | 버짓 | 게이트 |
|---|---|---|---|
| 뮤테이션 | `archive` `trash` `markRead` `applyLabel` `snooze` `send` `followup:add` `followup:cancel` `followup:dismiss` | 100ms | E2E hard(p50) + 400ms gross 0건 |
| 스레드 열기(어포던스) | `openThread:select` | 100ms | E2E hard |
| 스레드 열기(콘텐츠) | `openThread:content` | 300ms | 정보성(리포트만, F6 베이스라인) |

## 5. 성공 기준

1. 데모 모드 E2E에서 뮤테이션 p50 ≤ 100ms(웜업 제외, K≥25), 400ms 초과 0건 — run-tc.mjs 하드 게이트.
2. 실패 주입 시: 낙관 반영 → 에러 토스트 → 엔티티 복원(다른 in-flight 액션 상태 불훼손)이 E2E로 증명된다.
3. followup 3종이 낙관화되어 IPC await가 체감 경로에서 제거된다.
4. 기존 E2E 93건(F1~F3) 무회귀 + vitest 신규 latency 스위트 green + tsc green.
5. 프로덕션 사용자 노출 UI 변화 0(에러 토스트 제외).

## 6. 아키텍처

```
input → 핸들러/kbar → store 액션 진입(t0) → withOptimistic:
  ① mutate set (낙관)  ── double-rAF ──▶ t1 페인트 커밋   [예산 구간 t1-t0]
  ② await IPC ──성공→ notifyThreadsUpdated→refresh (자가 치유, 예산 외)
             └─실패→ 엔티티 역패치 set + 토스트 + refresh() (예산 외)
샘플 → lib/latency.ts 링버퍼(휘발) → 위반 집계만 'zenmail-latency' persist
     → window.__zenmailLatency.snapshot() → E2E 게이트 / LatencyHud(⌘⌥⇧L)
```

신규: `lib/latency.ts`(+test), `store/latency.ts`(휘발 링버퍼 + 위반 집계 persist), `components/LatencyHud.tsx`. 변경: `store/mail.ts`(withOptimistic 배선), `CommandPalette.tsx`(recordEfficient 이동), `main/ipc.ts`(실패 주입 debug IPC), `e2e/run-tc.mjs`(TC-SP-*).
