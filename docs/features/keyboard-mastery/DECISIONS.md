# keyboard-mastery — DECISIONS

> Goal 4 산출물: 모든 설계·개발 결정과 그 이유. 결정이 뒤집히면 해당 항목을 갱신하고 영향 범위를 명시한다.

## 제품 방향 (2026-07-03)

### D1. 튜토리얼은 자동 시작 + 언제든 스킵 (✅ 사용자 확정)
- **결정**: 첫 실행 시 자동 시작하되 Esc/Skip으로 즉시 탈출, 팔레트로 재진입. 완전 강제·옵트인 기각.
- **이유**: Superhuman의 "단축키 체화 = activation" 인사이트를 따르되 강요감 제거. 사용자가 AskUserQuestion에서 직접 선택.

### D2. 게임화 수위: 절제된 통계 + 마일스톤 (✅ 사용자 확정)
- **결정**: 통계 화면 + 조용한 1회성 마일스톤 토스트. 레벨/배지/XP/스트릭 기각.
- **이유**: "미니멀 프로 도구" 포지셔닝과 충돌. 사용자 직접 선택.

### D3. 힌트: 마우스 액션 토스트 + `?` 치트시트 (⚠️ 사용자 미확인 가정)
- **결정**: (a) 단축키 등가물이 있는 마우스 어포던스 사용 시 비침입 토스트, (b) `?` 전체 치트시트. 상시 힌트 바·호버 배지 기각.
- **경위**: AskUserQuestion 60초 무응답 → 추천안 채택(F1 D1 관례). **사용자 확인 시 뒤집힐 수 있음** — 뒤집히면 힌트 트리거 지점(onClick 6곳)과 CoachToastHost만 영향, 계측·통계·튜토리얼은 불변.

### D4. 병렬 설계 경위: Codex 불참 → deep-reasoner 독립 2인스턴스로 대체
- **상황**: F1/F2 패턴(deep-reasoner+Codex 동일 브리프 독립)을 시도했으나 Codex가 사용량 한도(2026-08-02 리셋)로 실패.
- **결정**: 동일 브리프를 deep-reasoner(Opus) 독립 2인스턴스에 부여(서로 답 비공개)로 대체.
- **한계 인지**: 동일 모델 2회는 Codex 이종 관점보다 독립성이 약함. 그럼에도 두 안이 **계측=dispatch 이음새 / localStorage / 별도 스토어 / 실 인박스 튜토리얼+파괴 키 인터셉트 / 신규 토스트 채널 / 팔레트 진입 / `?` kbar-우선+폴백 / F1+F2 E2E 게이트**에서 독립 수렴 — 채택 근거로 유효.

## 아키텍처 (2026-07-03, 합성)

### D5. 계측 2층: totals는 store 종단 액션, modality는 dispatch 이음새 (1안 채택)
- **결정**: 마일스톤·총계는 `mail.ts` 종단 액션 끝 `bumpStat` 1줄(모든 경로 수렴 단일 퍼널). 키보드/마우스 비율은 호출 지점(kbar perform 래핑·useKeyboard·마우스 onClick)에서 태깅.
- **기각(2안)**: "mail.ts 0줄" 원칙 — 이음새 열거로 totals까지 계산. 스와이프 아카이브·⌘Enter 송신·인라인 답장 등 경로 누락이 **조용히** 틀린 카운트를 만들 위험. 종단 액션 1줄 가산은 행동 무변경이며 F1+F2 E2E가 방어.
- **기각(공통)**: 전역 modality 추적기(마지막 입력 타임스탬프 추론) — 비동기 액션 오귀속.

### D6. 저장: localStorage (별도 coach 스토어 + zustand persist)
- **결정**: 신규 `store/coach.ts`에 persist 미들웨어(partialize). SQLite/settings KV 기각.
- **이유**: (1) 렌더러 전용 관심사 — main/데몬 소비자 없음(followups와 다름). (2) 키 입력마다 증가하는 고빈도 카운터에 IPC 왕복은 100ms 철학 위배 + settings KV는 read-modify-write 레이스. (3) Electron localStorage는 user-data-dir 파티션이라 E2E 격리·재시작 영속 무료, `page.evaluate` 판독 가능. (4) 신규 IPC/스키마 0.
- **트레이드오프**: 계정 비스코프(F1 D13 "계정 무관 로컬"과 일관), 앱 데이터 삭제 시 소실 — 코칭 텔레메트리라 수용. F4(계측)에서 main 소비자가 생기면 재검토.
- **주의(성능)**: persist는 set마다 동기 직렬화 — 카운터 blob이 작아 sub-ms 예상, 잔여 jank 발견 시 debounced storage로 전환(watch item).

### D7. 튜토리얼: 실 인박스 + 파괴 키 인터셉트, 진행은 키 입력 감지 (양안 합성)
- **결정**: 별도 샘플 데이터 없이 실(데모) 인박스 위에서 연습. 튜토리얼 활성 중 window **capture-phase** 리스너가 중재: 비파괴 키(j/k/Enter/Esc/c)는 통과시켜 실제 효과 체감, **파괴 키(e/#)는 전 스텝에서 항상 삼킴**(`preventDefault+stopImmediatePropagation`) — e-스텝에서도 설명만 하고 실제 아카이브 없음. 진행 판정은 올바른 키 입력(`e.key ∈ step.keys`).
- **capture가 통하는 근거**: useKeyboard(window bubble)·kbar보다 capture 리스너가 선행. 모달 stopPropagation 규약과 동일 정신.
- **기각**: 샘플 데이터 주입(provider 침습·YAGNI), store tutorial-mode 분기(회귀 표면 폭발), 실 아카이브+자동 undo(타이밍 복잡), store 구독 predicate 진행 판정(1안 — 키 감지로 충분, YAGNI).

### D8. `?` 소유권: kbar 우선, 실패 시 useKeyboard 폴백
- **결정**: 단일 키 액션이므로 규약상 kbar에 등록(팔레트 발견성). kbar가 Shift 산출 `?`를 매칭 못 하면 useKeyboard의 isTyping 가드 뒤 폴백.
- **검증**: CP1에서 최우선 실측(양안 공통 최대 불확실성). 결과를 이 문서에 기록.

### D9. 힌트/마일스톤은 신규 CoachToastHost (store.toast 재사용 기각)
- **결정**: 독립 큐·수명(~4s)·dismiss 액션을 가진 신규 컴포넌트를 기존 Toasts 컨테이너에 형제 마운트(UndoSendToast 동형).
- **이유**: `store.toast`는 단일 슬롯 2.5s 교체(mail.ts) — 액션 확인 토스트("Archived")와 코칭 토스트가 서로 덮어씀.

### D10. 통계 모델: 정직한 비율 + 주간 단일 카운터
- **결정**: 비율은 **dual-modality 액션**(키보드·마우스 두 경로가 실존: compose/toggleSplit/openThread/goToLabel/switchTab/archive[스와이프↔e])만 분모·분자에 산입. 주간 처리량은 `{weekStart, count}` 단일 카운터(ISO 주 경계 리셋). firsts 플래그로 마일스톤 감지.
- **기각**: 전 kbar 액션을 키보드로 산입(마우스 대응 없는 액션이 비율을 100%로 부풀림 — 허수), 일별 버킷·차트(YAGNI).

### D11. Stats·치트시트·튜토리얼 진입은 팔레트 Help 섹션
- **결정**: "Keyboard shortcuts"(`?`)·"Start tutorial"·"Your stats" 3액션. 사이드바 상시 행 기각(미니멀 사이드바에 영구 크롬 추가 — 잡음).

### D12. E2E: 하네스 첫 시나리오가 튜토리얼 자동시작을 검증하며 언블록 (2안 채택)
- **결정**: 신선한 user-data-dir → 튜토리얼 자동 시작이 기존 58 시나리오를 막으므로, run-tc.mjs **첫 F3 시나리오 = "자동시작 확인 + Esc 스킵"**을 demoLogin 직후 배치해 `tutorialSeen`을 남기고 기존 스위트 진행.
- **기각(1안)**: `--zenmail-e2e`에서 자동시작 억제 — 제품 코드에 테스트 분기가 생기고, 자동시작이라는 실제 제품 행동이 영원히 미검증으로 남음.
- ground truth는 DOM + localStorage 판독. 신규 디버그 IPC 없음.

### D13. 설계 승인: 사용자 무응답 → 추천안 채택 (⚠️ 승인 대기)
- **경위**: 합성 설계 승인 AskUserQuestion 60초 무응답 → F1 관례대로 추천안으로 진행. 사용자 복귀 시 D3와 함께 확인 필요. 뒤집히는 축에 따라 영향 범위는 각 D 항목에 명시됨.

### D14. /impeccable 여전히 미설치 → web-design-guidelines 대체 지속 (F1 D14 승계)
- Goal 6 게이트는 이번에도 Web Interface Guidelines 감사 + react-best-practices로 수행. /impeccable 설치 시 원래 게이트로 복귀.
