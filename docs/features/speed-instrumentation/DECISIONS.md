# speed-instrumentation — DECISIONS

> Goal 4 산출물: 모든 설계·개발 결정과 그 이유. 결정이 뒤집히면 해당 항목을 갱신하고 영향 범위를 명시한다.
> 설계 병렬: deep-reasoner(Opus) 독립 2인스턴스(A: 워크플로우 관점 / B: 성능 엔지니어 관점) → 오케스트레이터 합성. Codex 사용량 한도 불참(F3 D4 선례).

## 측정 정의

### D1. 측정 구간 = 스토어 액션 진입 → 낙관적 페인트 커밋, await 이후 제외 (A+B 합의, 시작점은 A안)
- **결정**: 시작마크는 스토어 액션 진입점(액션당 초크포인트 1개), 종료마크는 낙관 `set` 직후 double-rAF. `await api()` 이후 서버 재조정은 예산 외.
- **이유**: 낙관 set은 discrete 핸들러 내 동기, IPC continuation은 별도 페인트 — 구간이 구조적으로 분리됨(B 논증). 이벤트 핸들러→스토어 홉은 <1ms라 event.timeStamp 스레딩(B안, 8개 사이트 침습)은 이득 대비 기각(A 논증). 부수 효과: B가 플래그한 "kbar perform 동기성 미검증" 리스크가 시작점 정의에서 원천 소멸.

### D2. 종료마크 프리미티브: double-rAF 1차, Event Timing API 기각 (A안 채택)
- **결정**: `rAF(rAF(commit))`로 페인트 커밋 근사. set-return 델타를 2차 진단으로 병행 기록.
- **이유**: B안(PerformanceObserver type:'event')은 실제 presentation time이지만 (a) 비동기 보고라 actionId 귀속이 까다롭고 (b) durationThreshold 하향·8ms 양자화 등 Electron 33 실측 불확실성 존재. double-rAF는 결정론적·동기 귀속 가능이고, 최대 16.7ms 과대계상은 버짓 판정에 **보수적(안전한) 방향**. Event Timing은 후속 보강 스트림 후보로만 기록.
- **2차 진단 근거**: set-return이 크면 리듀서/파생계산 비용, double-rAF만 크면 렌더/페인트 비용 — 회귀 국소화(A).

### D3. 원시 샘플 persist 금지, 위반 집계만 `zenmail-latency` (A+B 합의)
- **결정**: 액션별 링버퍼 50개 in-memory 휘발. persist는 `{actionId, count, budgetViolations, lastP95, updatedAt}` 집계만, 별도 키 `zenmail-latency`(coach 파티션과 분리 — F1 D6 논리 계승).
- **이유**: (a) 고빈도 per-sample 동기 localStorage 직렬화는 계측이 성능을 해치는 자기모순(B가 F3 부채로 실증), (b) 기기별 절대값이라 세션 이월이 오도적(A). p50/p95 계산은 온디맨드, n<20이면 null(coach `meetsMinSample` 관례).

## 낙관화·롤백

### D4. 롤백 = 엔티티별 역패치 + 실패 시 refresh() 사후 조정 (A+B 합성)
- **결정**: `withOptimistic(actionId, mutate, invert)` 헬퍼. 실패 시 ① invert set(즉시 시각 복원 — 제거 액션은 "id 부재 시에만 재삽입" 가드, 필드 액션은 멱등 반전) ② 에러 토스트 ③ `refresh()`(서버 진실 재조회). 전체 스토어 스냅샷 복원 기각.
- **이유**: j-j-e-e 연타로 in-flight가 겹칠 때 전역 스냅샷은 후행 액션의 낙관 상태를 클로버(양안 동일 논증). 엔티티별 invert는 즉시성(A), refresh는 동시성-자명-정확성(B) — 합성으로 둘 다 확보. 재삽입 인덱스 stale은 clampSelection 재파생으로 수용(멤버십이 핵심, 정확 위치 복원은 동시성 위험 재도입이라 기각).
- **B의 결정적 발견**: 성공 경로는 `modify-labels`→`notifyThreadsUpdated`→refresh(ipc.ts:150)로 이미 자가 치유 — 롤백은 실패 경로만 필요.

### D5. followup 3종(schedule/cancel/dismiss) 낙관 전환 (A+B 합의)
- **결정**: Map에 낙관 set → await → 실패 시 invert. `refreshFollowups()`는 임계경로에서 제거하고 사후 조정으로.
- **이유**: cache 전용 IPC라 레이턴시 이득은 marginal이지만, 순차 2-await + 전체 Map 재구축이 임계경로에 있는 구조 자체가 부채(A). 패턴 통일로 이후 액션 추가 시 낙관화가 기본값이 됨.

### D6. send는 구조 유지, 계측만
- **결정**: B안(compose 즉시 닫기 낙관화)은 채택하지 않음. 계측을 붙이고, 측정이 100ms 초과를 보이면 그때 재검토.
- **이유**: `mail:send` 핸들러는 gmail 호출 없이 즉시 리턴(undo-window 설계, 실발송은 main setTimeout 10초 후) — await 비용이 IPC 왕복뿐이라 이미 저지연. 검증 없는 구조 변경은 undo 경로 회귀 리스크만 추가.

### D7. openThread: F4는 계측만, 최적화는 F6 (A+B 합의)
- **결정**: `openThread:select`(선택 하이라이트+로딩 어포던스 페인트, 100ms 버짓)와 `openThread:content`(fetch-class, 300ms 정보성) 분리 계측. 콘텐츠 낙관화(로컬 본문 캐시)는 F6 sync-engine.
- **이유**: fetch가 본질이라 낙관할 콘텐츠가 없음. F4 = "상호작용 인지 ≤100ms", F6 = "콘텐츠 준비" — 이 경계로 F6에 베이스라인 데이터를 남긴다. 매 뮤테이션 후 전체 refresh churn(ipc.ts:150→useThreads refresh)도 같은 이유로 F6 이관, F4는 계측 기록만.

## 표면·게이트

### D8. 사용자向 레이턴시 UI 0, 숨김 LatencyHud(⌘⌥⇧L)만 (⚠️ 사용자 미확인 추천안)
- **결정**: StatsPanel 확장(B안) 기각, 상시 HUD 기각. DEV/진단용 숨김 HUD(미광고 단축키 ⌘⌥⇧L, CoachToastHost 형제 오버레이)만.
- **이유**: 이 feature의 페이오프는 속도의 *체감*이지 대시보드가 아님. StatsPanel은 동기부여형(키보드 비율·마일스톤)인데 "archive p95 47ms"는 진단형 — 성격 충돌(A 논증). Superhuman의 100ms도 내부 엔지니어링 버짓. **사용자 복귀 시 확인 필요**: 통계 패널에 "속도" 섹션 노출 원하면 CP5에서 소폭 확장 가능.

### D9. `window.__zenmailLatency.snapshot()` 무조건 노출 (A안 변형)
- **결정**: read-only 스냅샷 함수를 게이트 없이 노출. HUD 마운트도 게이트 없이(토글은 미광고 단축키).
- **이유**: A안의 `import.meta.env.DEV` 게이트는 forge start/`npm run make` 간 거동 실측이 필요한 불확실성(A 스스로 플래그). read-only 성능 수치 노출은 보안·프라이버시 무해하고, 게이트 제거로 E2E flake 요인과 검증 비용이 소멸. 위반 console.warn만 DEV 게이트.

### D10. E2E 게이트: 웜업 폐기 + K≥25 burst + p50 ≤ 100ms + 400ms 초과 0건 (A+B 합성)
- **결정**: 첫 2 샘플(콜드 렌더) 폐기, archive burst K≥25, 어서션 = `count≥25 && p50≤100 && grossOver(400ms)==0`. 타이트 p95 hard 게이트 기각.
- **이유**: 게이트의 임무는 회귀 탐지지 버짓 인증이 아님(A). 낙관 페인트는 서브프레임(수 ms)이라 p50≤100은 mock 120ms 지연과 무관하게 거대한 헤드룸(B) — 제품 약속을 그대로 어서션해도 플레이크 없음. p95는 소표본에서 이상치 1개에 flap(A). gross 상한이 5×/10× 사고를 잡는다.

### D11. 실패 주입: `ZENMAIL_E2E_PORT` 게이트 debug IPC (F2 관례)
- **결정**: `mail:__debug-fail-next-modify` — 다음 modifyThread 1회 reject. 롤백 E2E(TC-SP-C*)의 ground truth.
- **이유**: 데모 mock은 항상 성공이라 실패 경로가 E2E 불가침 영역이 됨. 기존 `__debug*` 관례(ipc.ts:238) 그대로 — 프로덕션 표면 오염 없음.

### D12. F3 부채 완화: recordEfficient를 kbar perform 뒤로 이동 (B 발견)
- **결정**: CommandPalette.tsx perform 래퍼에서 `recordEfficient` 호출을 `perform()` 뒤로.
- **이유**: 현재 perform 앞에서 실행되어 coach persist의 동기 localStorage 직렬화가 모든 키보드 액션의 낙관 페인트 임계 경로에 얹혀 있음(B 실증). F4의 100ms 예산에 직접 기여. **리스크**: F3 튜토리얼/힌트 순서 의존성 — TC-KM 전체 회귀로 검증(TC-SP-G2). 회귀 시 이 결정 롤백하고 coach persist debounce로 대체.

### D13. 낙관 예산 경로에 startTransition 금지 (B)
- **결정**: 뮤테이션 낙관 set 경로에 `startTransition`/`useTransition` 도입 금지 규약. 현재 코드베이스 사용 0건(B grep 검증).
- **이유**: transition은 페인트를 지연 커밋시켜 측정과 체감을 동시에 훼손. 규약 위반은 E2E p50 게이트가 잡는다.

### D14. markRead의 loadLabels는 현행 유지 (A 검증)
- **결정**: mail.ts:505는 이미 `void get().loadLabels()`(fire-and-forget) — 변경 없음. 사전 브리핑의 "await" 표기는 오인이었음.
- **이유**: markRead 예산을 블록하지 않음. 종료마크는 스레드 행 재페인트에 귀속되고 사이드바 재렌더는 예산 외.
