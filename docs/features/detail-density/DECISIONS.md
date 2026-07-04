# detail-density — DECISIONS

> Goal 4 산출물. 설계 병렬: deep-reasoner(Opus) 독립 2인스턴스(A: 워크플로우 / B: 에디터·입력 시스템) → 오케스트레이터 합성. Codex 사용량 한도 불참(2026-08-02 리셋).

## 제품 방향 (2026-07-05, ✅ 사용자 확정 3건)

### D1. read-status(픽셀 트래킹) 기각 (✅ 사용자 확정)
- **이유**: 스펙 §4-5가 수신 메일의 외부 이미지(=타인의 트래킹 픽셀)를 기본 차단하는데 발신 메일에 픽셀을 심는 건 자기모순. Superhuman도 2019 프라이버시 백래시. "zen" 포지셔닝 유지.

### D2. Snippets 삽입 = ⌘; 피커 모달 (✅ 사용자 확정)
- **이유**: 인라인 `;트리거`는 contenteditable + 한글 IME 조합 엣지 리스크. 피커는 기존 모달 규약(stopPropagation+Escape) 재사용, IME는 경로에서 구조적으로 배제(검색 input + 프로그램적 삽입).
- ⌘;는 kbar($mod+k·단일키)·useKeyboard(j/k/Enter/[/]/Esc/⌘⇧I/⌘⌥⇧L) 어디에도 미등록 — 충돌 없음. Compose 루트 stopPropagation 방패 안이므로 Compose 내부 핸들러에서만 처리.

### D3. Instant Intro 채택 (✅ 사용자 확정)
- reply-all에서 소개자 To→Bcc + 제3자 To 승격 + 감사 문구. 배너 제안 + 원클릭, **자동 적용 절대 금지**(잘못된 수신자 재배치는 치명, 배너 무시는 무해 — 실패 비용 비대칭).

## 기술 결정

### D4. 저장 = settings KV JSON 단일 키, 신규 IPC 0 (A+B 합의)
- **이유**: `settings(key,value)` + getSetting/setSetting IPC가 이미 완비. 전용 테이블 선례(splits)조차 `replaceSplits`가 DELETE+전량 재삽입하는 whole-blob 시맨틱이라 테이블의 쿼리 이점이 실재하지 않음(A가 cache.ts:239-260으로 실증). 스니펫은 항상 전량 로드·클라이언트 필터. localStorage는 기각 — coach는 휘발성 텔레메트리지만 스니펫은 durable 콘텐츠(B).
- 규모 성장 시 테이블 마이그레이션은 store의 load/save 뒤에 은닉되어 국소적.

### D5. 스니펫 body = plain text, 삽입은 텍스트 노드로만 (B 위협 모델 채택)
- **이유**: 발신 경로가 compose innerHTML → MIME bodyHtml로 **무새니타이즈 직행**(새니타이즈는 수신 렌더 측에만 존재). compose 에디터는 iframe sandbox 밖 특권 렌더러 — HTML 스니펫은 자기 XSS·스타일 오염 표면을 신설. plain text + `textToFragment`(createTextNode+`<br>`)는 escape 자체가 불필요(텍스트 노드는 마크업으로 해석 안 됨 — 구성상 원천 차단). 저작 UI도 `<textarea>`로 IME/붙여넣기 이슈 소거.
- 확장 seam: `format?: 'text'` 필드 여지만 문서화, v2로 유예.

### D6. 삽입 프리미티브 = Range 스냅샷 복원 + execCommand('insertText') 1차, insertNode 폴백 (A 1차안 + B 순서 규약 합성)
- **결정**: ⌘; keydown 시점(포커스 이탈 전) `getRangeAt(0).cloneRange()` 저장 → 삽입 시 `editor.focus()` → `removeAllRanges()+addRange(saved)` → `execCommand('insertText', false, body)` → 캐럿 삽입물 끝 → 피커 닫기(마지막). execCommand 실패 시 `range.deleteContents()+insertNode(textToFragment)` 폴백. 본문 무포커스면 끝 append 폴백.
- **A vs B 판정**: B는 execCommand를 deprecated로 기각하고 insertNode를 1차로 했으나, execCommand는 **네이티브 ⌘Z 1스텝 undo 통합**을 제공(insertNode 수동 DOM 조작은 undo 스택에 안 들어감) — "디테일의 밀도"라는 feature 목적상 undo 동작이 결정적이라 A안을 1차로. Chromium 130에 완전 구현·제거 계획 없음. 두 안 모두 Range 복원이 선행되므로 폴백 전환 비용은 함수 1개.
- 기각: "selection 미이탈"(이중 포커스 — IME 재발), 단순 append(커서 보존 실패).

### D7. {firstName} 변수 치환 defer (A+B 합의)
- compose `to`는 bare email 배열이라 이름 미해결 — 오치환("Hi user@x.com")은 미치환보다 나쁨(B). 치환 패스 삽입 지점(textToFragment 직전) 1점만 seam으로 유지.

### D8. 인트로 감지 = 구조 ∧ 스레드 길이 ∧ subject 키워드 AND 게이트 (A+B 게이트 결합)
- **규칙**: `mode==='replyAll'` ∧ `last.from ≠ me` ∧ 제3자(cc 후보) ≥ 1 ∧ `messages.length ≤ 2`(B — 인트로는 스레드 초두) ∧ `subject`에 en(intro/introduc/connect)·ko(소개) 키워드(A).
- **이유**: 구조+길이만으로는 "신규 그룹 스레드 reply-all"(팀 메일 — 흔함)과 동형이라 배너 피로 필연. 키워드가 정밀도를 확보하고, ko 포함으로 B의 i18n 반론을 부분 해소. 미탐은 수동 reply-all로 처리 가능(무해) — 정밀도 > 재현율. 임계값·키워드는 lib/intro.ts 상수로 노출(튜닝 가능).
- 판정 위치: `openReply` 내부 동기 호출(activeThread 인메모리, IPC 0) → `composeInit.intro`. Compose는 배너만 렌더(dumb).

### D9. 감사 문구 = 내장 상수 템플릿, 설정 override defer
- "{name}, moving you to Bcc — thanks for the intro!" 류 상수 1개. A의 `getSetting('introTemplate')` override는 오버빌드로 defer. 삽입은 textToFragment 재사용(prepend).

### D10. F4 latency 계측·coach bumpStat 모두 제외 (A 부분 채택 후 축소)
- latency: IPC/롤백 없는 즉시 로컬 DOM 편집 — budget/percentile 무의미, 지표 오염(A·B 합의).
- bumpStat('intro')는 A가 선택 권고했으나 기각 — coach kind 유니온·persist 확장 대비 노출면(StatsPanel)이 없어 죽은 데이터(YAGNI).

### D11. E2E 전략 (B 채택)
- 시드: `window.zenmail.setSetting`(상시 노출)으로 스니펫 주입 — **신규 debug 훅 불요**(settings-JSON의 부수 이점).
- 커서 정합성 결정적 어서션: 에디터에 "AB" → ←로 캐럿 A|B → ⌘; → 검색 → Enter → `AXB` 확인 → 이어서 "Y" 타이핑으로 `AXYB`(캐럿이 삽입물 끝) 확인.
- 인트로 fixture: 데모 시드에 인트로형 스레드(제3자 To 포함 + subject 키워드) 부재 시에만 `__debugSeedIntroThread` 훅(--zenmail-e2e 게이트, F2 관례) 신설 — CP4 착수 시 데모 mock 확인 후 결정.
- 셀렉터: compose와 InlineReply가 `[contenteditable]` 공유 — compose 오버레이로 스코핑.

### D12. InlineReply로의 스니펫 확장은 범위 외 (B)
- InlineReply는 제어형(onInput 동기화)이라 프로그램적 삽입 시 input 이벤트 재발화 필요 — v1 범위 밖, 백로그 기록.
