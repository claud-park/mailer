# split-inbox-plus — DECISIONS

> Goal 4 산출물: 모든 설계·개발 결정과 그 이유. 결정이 뒤집히면 이 문서에서 해당 항목을 갱신하고 영향 범위를 명시한다.

## 제품 방향 (2026-07-03)

### D1. UI는 Superhuman식 탭 바 (⚠️ 사용자 미확인 가정)
- **결정**: ThreadList 상단에 스플릿 탭 바(+unread 카운트), 한 번에 한 스플릿만 표시. 섹션 스택(현행 Primary/Other 방식) 확장안 기각.
- **이유**: wow #3의 본질이 "시각적 잡음 제거"인데, 섹션 스택은 스플릿이 늘수록 스크롤이 길어져 목적에 역행. Superhuman 실물과 동일한 모델.
- **경위**: AskUserQuestion 60초 무응답 → 추천안 채택. **사용자 확인 시 뒤집힐 수 있음** — 뒤집히면 SplitTabBar 컴포넌트와 ThreadList 렌더 경로만 영향(데이터 모델·매칭 엔진은 불변).

### D2. 분류는 로컬 규칙 매칭 (⚠️ 사용자 미확인 가정)
- **결정**: 스플릿 정의를 SQLite에 저장하고 렌더러에서 이미 로드된 스레드를 클라이언트 매칭. Gmail 라벨/필터 생성안 기각.
- **이유**: (1) Gmail 계정 상태 불변 — 오염 리스크 없음, 쓰기 스코프 확대 불필요. (2) 데모 모드에서 동작. (3) 규칙 변경 즉시 반영 — 100ms 철학 부합. (4) Gmail API가 labelIds AND만 지원해 발신자 그룹 스플릿은 어차피 자체 매칭 필요.
- **트레이드오프**: ZenMail 밖(Gmail 웹)에서는 스플릿이 안 보임 — v1에서 수용.

### D3. 범위: 기본 3종 + 경량 편집 모달 (⚠️ 사용자 미확인 가정)
- **결정**: VIP(수동 발신자 목록)·Team(도메인 매칭)·Newsletter(카테고리+휴리스틱) 기본 제공 + 스플릿 추가/편집/삭제/순서변경이 가능한 경량 설정 모달. 풀 Settings 화면 기각(YAGNI).
- **이유**: DEV_WORKFLOW의 F1 정의("커스텀 스플릿, 스플릿 탭·카운트, 설정 UI")를 충족하는 최소 완결 범위.

## 아키텍처 (2026-07-03, deep-reasoner 설계 채택 — Codex 델타 대조 대기 중)

> 병렬 설계 경위: deep-reasoner(Opus)와 Codex에 동일 브리프를 독립 위임. Codex 1차 시도는 프로세스 유실로 실패(세션 로그에 task_started 후 무산출 확인), 재시도 백그라운드 진행 중. **Codex 델타 대조 전까지 구현 착수 금지 게이트** — 델타가 오면 이 문서에 반영.

### D4. first-match 배타 할당 + Other catch-all
- **결정**: position 오름차순으로 첫 매칭 스플릿에만 할당. 미매칭은 항상 존재하는 Other(삭제/편집 불가).
- **이유**: 탭 카운트 합 = 전체 보장 → "메일 실종" 혼란 차단. 현행 partitionThreads도 배타 2분할이라 정신적 모델 연속. Superhuman 동일.
- **기각 대안**: 다중 소속(한 스레드가 여러 탭에) — 카운트 중복과 "어느 탭에서 처리했지" 혼란.

### D5. selectedIndex를 visibleThreads에 재정박 (id 기반 아님)
- **결정**: `selectedIndex`의 의미를 "threads 배열 인덱스"에서 "현재 탭 visibleThreads 인덱스"로 변경. 소비처 6곳(targetThreadId/moveSelection/openThread/openSelected/ThreadList 판정/swipe) 일괄 전환.
- **이유**: archive 후 같은 인덱스가 다음 스레드에 안착 → 현행 auto-advance 동작이 무료로 보존됨.
- **기각 대안**: `selectedThreadId` 기반 — 리스트 변형에 더 강건하지만 auto-advance를 수동 재구현해야 하고 churn이 큼. 구현 중 선택 버그가 반복되면 이 대안으로 전환 재검토.

### D6. 매칭은 렌더러 순수 모듈 + memo 파생 (store 캐시 금지)
- **결정**: `lib/splits.ts` 순수함수를 컴포넌트 useMemo와 store 메서드가 동일하게 호출. 파생값(assignment/counts)을 store state에 저장하지 않음.
- **이유**: threads를 변형하는 모든 액션(archive/markRead/snooze)마다 캐시 재동기화하는 버그 클래스를 원천 제거. O(N·R)로 수백×한자릿수라 성능 무시 가능.

### D7. splitInbox boolean 재해석 (폐기 아님)
- **결정**: `splitInbox=true`→탭바 표시, `false`→통합 리스트. ⌘⇧I·Toolbar Split 버튼 의미 계승. `partitionThreads`와 Primary/Other 헤더만 제거.
- **이유**: "split vs unified"라는 기존 의미가 자연스럽게 이어지고 근육기억·UI 재활용. 별도 showTabs 상태 신설은 상태 중복.

### D8. 영속화: splits + settings KV 테이블, replace-all IPC
- **결정**: `splits`/`settings` 2테이블(CREATE TABLE IF NOT EXISTS 추가 방식 — 기존 관례), IPC는 `getSplits/setSplits(replace-all)/getSetting/setSetting` 4종. 시드는 main의 getSplits에서 빈 테이블일 때(Team 도메인은 계정 이메일에서 지연 파생).
- **이유**: N이 작고 설정 모달이 "로컬 편집→한 번에 저장" UX라 granular CRUD IPC는 과함. settings KV는 F2+ 기능에서도 재사용 가능.

### D9. 탭 카운트는 로드분 기준 + `N+` 표기
- **결정**: 클라이언트 카운트(로드된 스레드), 추가 페이지 존재 시 `N+`.
- **이유**: VIP/Team은 서버 라벨이 없어 서버 카운트 불가 → 전 탭 일관성 위해 전부 클라이언트. 하한값임을 `+`로 정직하게 표시.

### D10. Tab/⇧Tab·⌘1~9 배치
- **결정**: useKeyboard에서 처리. Tab은 isTyping·모달 가드 통과 후에만 preventDefault+탭 전환. ⌘1~9는 `if (e.metaKey) return` early-return보다 위에 배치(⌘⇧I 블록 옆). ⌘1~9 충돌 없음 확인됨(kbar는 ⌘K만).
- **이유**: 단축키 소유권 규약(단일 키=kbar, 수식키/내비=useKeyboard) 준수. Compose/검색 중 Tab 포커스 이동 보존.
