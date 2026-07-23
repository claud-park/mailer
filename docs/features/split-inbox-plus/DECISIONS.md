# split-inbox-plus — DECISIONS

> Goal 4 산출물: 모든 설계·개발 결정과 그 이유. 결정이 뒤집히면 이 문서에서 해당 항목을 갱신하고 영향 범위를 명시한다.

## 제품 방향 (2026-07-03)

### D1. UI는 Superhuman식 탭 바 (✅ 2026-07-03 사용자 확인 — 유지)
- **결정**: ThreadList 상단에 스플릿 탭 바(+unread 카운트), 한 번에 한 스플릿만 표시. 섹션 스택(현행 Primary/Other 방식) 확장안 기각.
- **이유**: wow #3의 본질이 "시각적 잡음 제거"인데, 섹션 스택은 스플릿이 늘수록 스크롤이 길어져 목적에 역행. Superhuman 실물과 동일한 모델.
- **경위**: AskUserQuestion 60초 무응답 → 추천안 채택. F3 착수 시(2026-07-03) 사용자가 "유지"로 확정.

### D2. 분류는 로컬 규칙 매칭 (✅ 2026-07-03 사용자 확인 — 유지)
- **결정**: 스플릿 정의를 SQLite에 저장하고 렌더러에서 이미 로드된 스레드를 클라이언트 매칭. Gmail 라벨/필터 생성안 기각.
- **이유**: (1) Gmail 계정 상태 불변 — 오염 리스크 없음, 쓰기 스코프 확대 불필요. (2) 데모 모드에서 동작. (3) 규칙 변경 즉시 반영 — 100ms 철학 부합. (4) Gmail API가 labelIds AND만 지원해 발신자 그룹 스플릿은 어차피 자체 매칭 필요.
- **트레이드오프**: ZenMail 밖(Gmail 웹)에서는 스플릿이 안 보임 — v1에서 수용.

### D3. 범위: 기본 3종 + 경량 편집 모달 (✅ 2026-07-03 사용자 확인 — 유지)
- **결정**: VIP(수동 발신자 목록)·Team(도메인 매칭)·Newsletter(카테고리+휴리스틱) 기본 제공 + 스플릿 추가/편집/삭제/순서변경이 가능한 경량 설정 모달. 풀 Settings 화면 기각(YAGNI).
- **이유**: DEV_WORKFLOW의 F1 정의("커스텀 스플릿, 스플릿 탭·카운트, 설정 UI")를 충족하는 최소 완결 범위.

## 아키텍처 (2026-07-03, deep-reasoner 설계 채택 + Codex 델타 합성 완료)

> 병렬 설계 경위: deep-reasoner(Opus)와 Codex에 동일 브리프를 독립 위임(서로의 답 비공개). Codex 1차 시도는 프로세스 유실로 실패, 재시도 성공. 두 안은 핵심(first-match 배타, 순수 매칭 모듈, 로드분 카운트, useKeyboard 소유, 5~6단계 체크포인트)에서 **독립적으로 수렴** — 설계 신뢰도 근거. 델타 판정은 D11~D13.

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

## Codex 델타 합성 (2026-07-03)

### D11. Inbox 탭 추가 (Codex 채택)
- **결정**: 탭 바 맨 앞에 필터 없는 Inbox 탭(전체 로드분, 매칭 우선순위 비참여). `order = ['inbox', ...splits, 'other']`.
- **이유**: 통합 뷰 탈출구가 숨은 토글(⌘⇧I)보다 발견 가능. 사용자에게 제시한 목업과도 일치. ⌘⇧I는 탭바 자체 on/off로 계속 유효(D7 유지).

### D12. 매칭 모듈 단위 테스트 도입 (Codex 채택)
- **결정**: vitest를 `lib/splits.ts` 순수함수에 한정 도입(첫 테스트 인프라). first-match 우선순위·재정박·카운트를 유닛 레벨에서 고정.
- **이유**: 최대 리스크(D5 재정박 회귀)를 E2E 전에 순수함수에서 방어. 프로젝트에 테스트 프레임워크가 없었음.

### D13. Codex 안 기각 항목
- **`rule: {any: SplitRule[]}` OR 조합 스키마**: v1 YAGNI. 단일 규칙 유지(D8). 확장 시 JSON 마이그레이션으로 흡수 가능.
- **per-account 스플릿 스코핑(account_email 컬럼)**: 단일 계정 앱. 계정 무관 로컬 설정 유지. 멀티 계정 도입 시 재검토.
- **selectedIndex를 전역 backing index로 유지 + visibleIndexes 순회**: archive 후 auto-advance가 "다음 보이는 스레드"를 찾는 수동 로직 필요 → D5(visibleThreads 재정박)가 이를 공짜로 보존하므로 불리.
- **활성 탭 비영속(Inbox 리셋)**: 삭제된 스플릿 복원 혼란은 로드 시 폴백(TC-E4/F2)으로 해결되므로 영속 유지(D8).

### D14. /impeccable 부재 → web-design-guidelines로 대체 (Goal 6)
- **상황**: DEV_WORKFLOW Goal 6이 지정한 /impeccable 스킬이 현재 환경에 설치되어 있지 않음.
- **결정**: Web Interface Guidelines 감사(web-design-guidelines 스킬)로 대체 수행. 지적사항(탭 role/aria-selected, 아이콘 버튼 aria-label, spellcheck, tabular-nums) 수정 완료(`11858c1`). react-best-practices 리뷰에서는 StrictMode 이중 호출 no-op 버그와 ChipInput 다중 커밋 유실을 수정(`5b1e5fc`).
- **후속**: /impeccable이 설치되면 F2부터 원래 게이트로 복귀.

### D15. D11 철회 — Inbox를 필터 없는 뷰에서 미매칭 catch-all로 재정의, Other 탭 제거 (2026-07-23 사용자 확인)
- **상황**: 사용자 리포트 — "split inbox 에 들어오는 이메일은 main inbox 에 보이면 안 돼." D11의 "Inbox = 전체 로드분(매칭 무관)" 설계가 정확히 이 불만의 원인으로 확인됨(근본 원인 조사 결과, 버그가 아니라 D11의 의도된 동작이었음).
- **결정**: `computeSplits`에서 미매칭 스레드의 기본 배정을 `OTHER_TAB`이 아닌 `INBOX_TAB`으로 변경. `order = ['inbox', ...splits]`(Other 탭 제거). `selectVisibleThreads`는 이제 activeTab 무관하게 항상 매칭 결과로 필터링 — Inbox도 예외 없이 필터링 대상(Gmail Primary 탭과 동일한 모델로 전환).
- **⌘⇧I(탭바 on/off) 동작 변경**: 탭바를 꺼도 D11 이전처럼 "필터 없는 전체 로드분"으로 복귀하지 않음 — 탭바 유무와 무관하게 Inbox는 항상 미매칭 catch-all만 보여준다(사용자 확정). 탭바는 이제 순수하게 "스플릿 탭 UI 표시 여부"만 토글하고, 뷰의 매칭 결과에는 영향을 주지 않는다.
- **Other 탭 제거 이유**: Inbox가 미매칭 catch-all이 되는 순간 Other 탭과 내용이 100% 겹침(둘 다 "어떤 split에도 안 걸린 메일"). 중복 탭을 유지하는 대신 Other를 Inbox로 흡수(사용자 확정) — 탭 구성이 `[Inbox | VIP | Team | Newsletter]`로 축소.
- **영향 범위**: `lib/splits.ts`(OTHER_TAB 상수 제거, computeSplits/selectVisibleThreads), `SplitTabBar.tsx`(Other 라벨 분기 제거), `SplitSettings.tsx`("Unmatched mail goes to Other." → "Unmatched mail stays in Inbox."), `splits.test.ts`, `e2e/run-tc.mjs`(TC-A1/A3/A5/A6/E1/E2/E5). TC-A6/A5는 검증 방향이 반대로 뒤집힘(과거: Inbox가 전체를 보여주는지 확인 / 현재: split 매칭 스레드가 Inbox에 안 새는지 확인) — 상세는 TC.md 참고.
- **기각 대안**: Inbox/Other 탭을 둘 다 유지하고 중복 허용 — UX적으로 같은 목록이 두 탭에 뜨는 것은 혼란만 가중(사용자가 명시적으로 기각).
- **회귀 버그 발견 및 수정 (구현 중)**: `INBOX_TAB`을 항상 필터링 대상으로 바꾸면서, `ThreadList.tsx`(2곳)/`store/mail.ts`/`FollowupPicker.tsx`가 "스플릿 뷰가 아닐 때"의 fallback으로 `INBOX_TAB`을 재사용하던 기존 관행이 새 버그가 됨 — D11 이전엔 `INBOX_TAB`이 항상 무필터였기 때문에 Sent/Trash/Drafts/커스텀 라벨 뷰나 검색 결과에서도 안전한 sentinel이었지만, D15 이후 그 fallback이 그대로 있으면 **INBOX 라벨이 아닌 뷰까지 split 매칭으로 걸러지는** 의도치 않은 누수가 발생(예: 검색 결과에서 VIP 발신자 메일이 사라짐). 네 지점 모두 `activeLabelId !== 'INBOX' || searchQuery`일 때 `selectVisibleThreads` 호출 자체를 건너뛰고 원본 `threads`를 그대로 반환하도록 가드를 추가해 수정.
- **파급 검증**: `e2e/run-tc.mjs`(전체 287개 TC) 재검증 완료 — split-inbox-plus 자체 테스트 외에 VIP/Team/Newsletter 기본 시드가 다른 기능의 데모 스레드 하드코딩 가정(예: "Q3 roadmap review"가 항상 Inbox 최상단이라는 가정)을 깨뜨린 사례가 follow-up-reminders/keyboard-mastery/speed-instrumentation/detail-density/undo-toast/multi-account 총 6개 기능에서 발견되어 해당 E2E 하네스만 D15에 맞게 갱신(각 기능 자체의 PRD/TC/DECISIONS는 변경하지 않음). 최종: 287 total · 280 PASS · 0 FAIL · 7 SKIP, NO-REGRESSION: CLEAN.
