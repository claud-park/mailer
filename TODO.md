# ZenMail TODO — 진행 상황 트래킹

> PRD: [PRD.md](PRD.md) · Spec: [docs/MAIL_APP_SPEC.md](docs/MAIL_APP_SPEC.md)
> Obsidian checkpoint: `_obsidian/Projects/ZenMail.md`
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-07-17 (undo-toast · label-crud · snippets-inline-reply)

## 0. 프로젝트 셋업
- [x] PRD.md / TODO.md 작성
- [x] Obsidian 체크포인트 노트 생성
- [x] Electron Forge + Vite + TS 스캐폴드 (`zenmail/`)
- [x] 의존성 설치 (react, zustand, kbar, react-virtual, googleapis, keytar, better-sqlite3, tailwind v4)
- [x] Tailwind v4 + 디자인 토큰 설정

## 1. Electron shell
- [x] BrowserWindow 생성 (main/index.ts), 다크 배경, hiddenInset 타이틀바
- [x] preload + contextBridge (`window.zenmail` API)
- [x] contextIsolation on / nodeIntegration off 확인

## 2. OAuth flow
- [x] PKCE code verifier/challenge 생성 (auth.ts)
- [x] localhost redirect 서버 + 브라우저 오픈
- [x] 토큰 교환 + keytar Keychain 저장
- [x] refresh token 자동 갱신
- [!] Google Cloud Console OAuth Client ID 발급 — **사용자 액션 필요** (전까지 데모 모드)

## 3. Gmail API wrapper
- [x] gmail.ts: threads.list / threads.get / messages.send / labels.list
- [x] threads.modify (addLabels/removeLabels)
- [x] MIME 메시지 빌더 (RFC 2822, base64url)
- [x] 데모 모드 mock provider (Client ID 없이 UI 개발용)

## 4. SQLite cache
- [x] cache.ts: threads/messages/snoozes 스키마
- [x] FTS5 full-text 인덱스
- [x] read/write 헬퍼 + upsert 동기화

## 5. Thread list
- [x] 가상화 리스트 (@tanstack/react-virtual)
- [x] Row UI: 발신자/제목/스니펫/시각/unread dot/라벨 칩 (56px)
- [x] j/k 내비, Enter 열기
- [x] 트랙패드 스와이프 (우: 아카이브, 좌: 스누즈)

## 6. Thread view
- [x] 샌드박스 HTML 렌더 (iframe sandbox, JS 차단, 외부 이미지 기본 차단)
- [x] 인용문 접기/펼치기
- [x] 인라인 답장 컴포저
- [x] ] / [ 스레드 이동

## 7. Compose
- [x] 풀윈도우 오버레이 UI (To/CC/BCC/제목/본문 contenteditable)
- [x] 수신자 자동완성 (캐시된 발신자 기반)
- [x] ⌘Enter 전송 / ⌘⇧Enter 전송+아카이브
- [x] 10초 undo send
- [x] 예약 전송 (draft + 로컬 리마인더)

## 8. Split inbox
- [x] Primary/Other 필터 로직 (CATEGORY_* 라벨 제외)
- [x] 섹션 UI + ⌘⇧I 토글

## 9. Label sidebar
- [x] labels.list 렌더 + 색상 dot + unread 뱃지
- [x] 클릭 필터, g→l 라벨 피커

## 10. Command palette
- [x] kbar 셋업 + 스펙 §4-3 액션 14개 등록
- [x] 단축키 표시

## 11. Snooze
- [x] SnoozePicker (Later today / Tomorrow morning / Next week / Custom)
- [x] 라벨 스왑 (INBOX 제거 + zenmail/snoozed)
- [x] main 프로세스 1분 타이머 데몬 → 기한 도래 시 INBOX 복귀 + `mail:snooze-fired`

## 12. Polish & 검증
- [x] 포커스 링, empty state, 트랜지션
- [x] TypeScript 전체 typecheck 통과
- [x] `npm start` 앱 구동 확인 (데모 모드)
- [x] TODO/PRD/Obsidian 체크포인트 최종 업데이트

## 사용자 후속 액션 (릴리즈 전)
- [x] Google Cloud Console Desktop-app OAuth Client + Gmail API enable (dreamus.io Internal) — 2026-07-07 확인: Keychain refresh token 유효, labels.list 30개 응답
- [x] 실계정 OAuth 플로우 E2E 확인 — 2026-07-07: 세션 자동 복원(로그인 화면 없음), yr.park@dreamus.io 사이드바 표시, 실 인박스 26행·스플릿 탭 실데이터 렌더 (읽기 전용 검증)
- [x] `npm run make` DMG/ZIP 패키징 — 2026-07-07: ZenMail-1.0.0-arm64.dmg(116M)+zip(128M), 프로젝트 트리 밖 스모크(윈도우·헬퍼·격리 프로필) 통과. 수정 3건: ① forge vite 템플릿이 externals를 asar에 미포함(packageAfterCopy 폐쇄 복사 훅) ② fuses 플립이 adhoc 서명 파손(resetAdHocDarwinSignature) ③ 실사용 버그: 기본(공유) 프로필에서 Keychain ACL 실패(errSecAuthFailed -25293, ad-hoc 서명 불안정)가 auth:get-account를 크래시시켜 첫 화면에 IPC 에러 노출 → keytarStore.get()에 try/catch 추가해 '로그인 필요' 상태로 우아하게 강등(auth.ts). ④ packageAfterCopy 폐쇄 복사기가 이름→최상위 경로만 가정해 npm 중첩 의존성(예: gaxios가 요구하는 node-fetch@3이 다른 node-fetch@2 최상위 호이스트 때문에 gaxios/node_modules 안에 중첩되고, 그 node-fetch@3의 의존성 data-uri-to-buffer는 다시 최상위로 호이스트되는 실제 npm 트리)을 못 찾아 'Sign in with Google' 클릭 시 IPC 크래시 → Node 실제 해석 알고리즘(요청 패키지 자신의 디렉터리부터 상위로 걸어 올라가며 node_modules 확인, 경로 기준 dedup)으로 복사기 재작성(forge.config.ts resolveModuleDir). ⑤ get()만 방어했던 keytar 폴백을 set/del/list에도 동일 패턴으로 확장(auth.ts) — 로그인 완료 후 토큰 저장(store.set) 단계에서도 같은 Keychain ACL 실패가 'auth:sign-in' IPC를 크래시시켰음. 이제 어떤 keytar 연산이든 실패하면 파일 스토어로 폴백해 로그인이 실제로 지속되도록 함. 정식 배포 시 osxSign+공증 필요(부수 효과: Keychain ACL도 안정화됨)

- [x] `select-all-in-view` — post-release 추가 기능(⌘A 전체선택+일괄 액션) — 2026-07-07 완료, E2E 294 PASS·0 FAIL·14 SKIP(기존12+2) (docs/features/select-all-in-view/)
- [x] `light-mode` — 라이트 테마 기본값 + kbar 수동 토글(다크 유지), settings KV persist — 2026-07-13 완료 (docs/features/light-mode/)
- [x] `right-reading-pane` — 상세 패널 상하→좌우 40/60 고정 비율, ThreadRow compact 2줄 — 2026-07-13 완료, E2E 156 PASS·0 FAIL·7 SKIP(집계 관례 수정 후 캐논, TC-LM 5+TC-RP 4 포함) (docs/features/right-reading-pane/)

## v1.x Feature 로드맵 (2026-07-03 확정 — 상세: docs/DEV_WORKFLOW.md)

> 각 feature는 DEV_WORKFLOW.md의 Goal 0~8 프로세스(superpowers plan → PRD → TODO → TC → DECISIONS → react-best-practices → impeccable audit → E2E → Obsidian)를 따른다.

- [x] F1 `split-inbox-plus` — Split Inbox 고도화 (wow #3) — 2026-07-03 완료, TC 35 PASS·3 SKIP·0 FAIL (docs/features/split-inbox-plus/)
- [x] F2 `follow-up-reminders` — remind-if-no-reply / send & remind (wow #4) — 2026-07-03 완료, 58 PASS·0 FAIL (docs/features/follow-up-reminders/)
- [x] F3 `keyboard-mastery` — 인터랙티브 튜토리얼·단축키 힌트·숙련도 통계 (wow #2) — 2026-07-04 완료, E2E 93건 90 PASS·0 FAIL·3 SKIP(F1 기존) (docs/features/keyboard-mastery/)
- [x] F4 `speed-instrumentation` — 100ms 레이턴시 버짓·계측 (wow #1) — 2026-07-04 완료, E2E 112건 109 PASS·0 FAIL·3 SKIP(F1 기존), burst p50 ~13ms (docs/features/speed-instrumentation/)
- [x] F5 `detail-density` — Snippets(⌘; 피커)+Instant Intro, read-status 기각 (wow #5) — 2026-07-05 완료, E2E 128건 125 PASS·0 FAIL·3 SKIP(F1 기존) (docs/features/detail-density/)
- [x] F6 `sync-engine` — 오프라인-퍼스트 전면화 (wow #6) — 2026-07-06 완료, E2E 142건 136 PASS·0 FAIL·5 SKIP(기존3+사유2), warm-hit p50 ~14-21ms (docs/features/sync-engine/) — **v1.x 로드맵 F1~F6 완주**

## post-roadmap Features

- [x] `calendar-integration` — Google Calendar 메일 중심 연동: 초대 RSVP 배너(ICS 자체 파서+낙관 5단계)·이벤트 생성 폼(규칙 프리필, No AI)·`g→c` 아젠다 패널·calendar.events scope+calendarReady 게이트 — 2026-07-14 완료, E2E 183 PASS·0 FAIL·6 SKIP ×2(집계 캐논 재해석 D10: 총 189=164+25) (docs/features/calendar-integration/)
- [x] `inbox-zero-starred` — 사용자 실계정 버그 리포트(외부 아카이브 84행 미수렴) + 제품 요구(인박스=INBOX∪STARRED) — 2026-07-14 완료, 근본원인: SWR revalidate가 removal 미계산+60s 폴 무한 루프, 수정: 뷰 전체 캐시 행 열거 기반 removal 수렴 + 공유 술어(src/shared/view.ts) + 실계정 전용 15s grace 가드(mock=0, D10). E2E TC-IZ 9건 전건 PASS + 전체 스위트 0 FAIL·6 SKIP ×2, 실계정 스모크로 84→22행 수렴·STARRED 20건 확인 (docs/features/inbox-zero-starred/)
- [x] `multi-account` — 2개 이상 Gmail 계정 동시 연동(계정 스위처, 통합 인박스 아님) — 2026-07-15 완료. accountId=email, `accounts.json`+계정별 SQLite 캐시 파일(레거시 `zenmail.db` rename 마이그레이션, all-or-nothing 롤백), main `AccountContext` Map, 60s 데몬 전 계정 순회(스누즈·예약전송·팔로우업·드레인·배지, 계정별 try/catch 격리), IPC 전 데이터 메서드 accountId 필수, ⌃1~⌃9/사이드바 아바타/kbar 전환, 데모 mock 2계정(`demo@zenmail.app`+`work@zenmail.app`). SDD(태스크별 subagent+2단계 리뷰) 9태스크 완주 + 최종 전체 브랜치 리뷰(Opus, With fixes) + react-best-practices 게이트(재렌더 회귀 1건 수정) + code-review low. E2E TC-MA 7건 신규 + 전체 스위트 **200 PASS·0 FAIL·6 SKIP ×2 결정적**(캐논 SKIP 집합 동일). (docs/features/multi-account/)
- [x] `attachments` — 첨부파일 표시·다운로드(사용자 요청: "이메일에 첨부된 image, 첨부파일이 보이고 다운로드 가능하게") — 2026-07-15 완료. 본문 인라인 `cid:` 이미지 렌더링(remote-image 프라이버시 게이트 우회, 본인 계정 데이터라 트래킹 무관)·첨부 스트립(비인라인만, mimetype 아이콘+파일명+용량)·이미지 썸네일+라이트박스·다운로드 폴더 즉시 저장(Save-As 없음, 충돌 시 `(1)` 리네임)·첨부 바이트 sqlite 무캐시(매 요청 fresh fetch). SDD 5태스크(CP1~CP5) 완주 + 최종 whole-branch 리뷰(Opus)에서 Critical 1건 발견·수정(다운로드 파일명이 이메일 발신자 임의 지정 가능해 `path.join` 미새니타이즈 시 `../../` traversal로 Downloads 밖 임의 쓰기 가능 — `path.basename` 새니타이즈+회귀 테스트 3건으로 폐쇄) + react-best-practices Critical 1건(MessageCard cid effect가 `message.attachments` 배열 참조를 deps로 둬 SWR revalidate마다 재fetch 스톰 — `message.id`만으로 축소) + code-review low(none). E2E TC-ATT 17건 신규 + 전체 스위트 **216 PASS·0 FAIL·5 SKIP ×2 결정적**(캐논 SKIP 6종의 부분집합 — `TC-SA-B4`가 신규 데모 첨부 스레드로 벌크 스누즈 후보 조건을 만족해 SKIP→PASS 정당 전환, calendar-integration D10과 동일 패턴). 세션 중 인프라 인시던트 1건 발견·수습: `package.json` pretest가 better-sqlite3를 plain-node ABI로 리빌드하며 Electron Forge 캐시 마커를 무효화 못 시켜 실계정 로그인 실패 유발 — `electron-rebuild` 즉시 복구, 근본 수정(pretest 스크립트 분리)은 후속 과제로 이월. (docs/features/attachments/)
- [x] `post-release 버그수정 3건` — 2026-07-16 완료(사용자 리포트: 인라인 이미지 안 보임·split-view j/k 미동기화+archive 후 빈 화면·snooze 다이얼로그 여백 부족). 근본원인 ①: `extractAttachments`의 인라인 판정이 `Content-Disposition:inline` 헤더 존재만 신뢰(D4) — Outlook 등 다수 실 발신자가 인라인 cid 이미지에도 이 헤더를 생략/attachment로 보내 실계정에서만 재현되는 회귀였음(mock 시드는 하드코딩이라 미재현). 수정: RFC 2392 방식으로 본문 HTML이 실제로 `cid:`를 참조하는지도 OR 조건으로 판정(`extractAttachments(part, html)`), vitest 2건 추가. ②: split-view j/k·↑/↓ 동기화는 기존에 이미 구현·검증되어 있었음(TC-RP-A4)—실제 갭은 archive였다: 현재 열린 스레드를 아카이브하면 `activeThreadId`를 그냥 null로 비워 리딩 패인이 빈 화면이 됐음 → archive 성공 후 새로 선택된 다음 스레드를 자동으로 열도록 수정(mail.ts archiveThread). 순서 주의: 먼저 시도했다가 E2E `TC-SP-Rollback-error`가 FAIL로 드러남 — next-thread open을 modifyLabels 이전에 실행하면 그 스레드가 unread일 때 openThread의 markRead()가 자체 modifyLabels를 트리거해 디버그 전용 "다음 1회 실패" 플래그를 archive 대신 소비해버림(harness가 이미 문서화한 동일 함정) → next-thread open을 archive의 modifyLabels 성공 확인 뒤로 이동해 해결, 재검증 통과. ③: SnoozePicker 폭/패딩 확대(w-72→w-88, p-2→p-4, 프리셋 버튼 py-1.5→py-2.5). `/react-best-practices`(no findings)+`/code-review low`(none) 통과. vitest 177 PASS+tsc clean. E2E 부분 검증: 재실행 3회에 걸쳐 TC-SP-Rollback-error/C1/C4·TC-RP-A4·TC-ATT-* 등 관련 케이스 전부 PASS 확인. ⚠️ **세션 중 발견(무관 사전 존재 이슈)**: 이번 세션 반복 실행에서 E2E 하네스의 재시작(restart) 계열 시나리오(TC-F1/F2/F4, TC-FUP-E1, TC-LM-A4, TC-IZ-B1, TC-MA-A1)가 "shell loaded after demo login" 타임아웃으로 4회 연속 FAIL — `git stash`로 무수정 main 트리에서도 동일 재현되어 이번 변경과 무관함을 확인(세션 내 Electron 반복 기동에 따른 샌드박스 환경 이슈로 추정). 다음 세션에서 별도 조사 필요(후속 과제). 남은 스코프: starred 분리 뷰/label 추가·삭제는 사용자 요청대로 별도 세션에서 정식 Goal 0~8로 진행 예정.
- [x] `starred-view` — 사용자 요청: starred를 분리된 전용 뷰로, 기본 Inbox는 항상 진짜 0으로 수렴하게 — 2026-07-16 완료. 대화형 브레인스토밍 4문항 전부 사용자 확정(배치=사이드바 시스템 항목, 범위=STARRED−Trash/Spam−스누즈, Inbox=순수 INBOX로 복귀, 단축키=`g t`). `inbox-zero-starred` D1/D2/D4/D7("인박스=INBOX∪STARRED", "Starred 전용 뷰는 논스코프")을 사용자가 정반대로 재확정·supersede. 구현: 공유 술어(`src/shared/view.ts`) `isInInboxView` 순수 INBOX로 축소+신규 `isInStarredView`(오케스트레이터 직접, TDD) → SDD 3체크포인트(CP1 main: gmail.ts Real/Mock STARRED q번역+시드+`__debugExternalUnstar`훅, cache.ts SQL 분기 / CP2 renderer: `archiveThread`/`toggleStar` 게이트를 INBOX∪STARRED로 확장(unstar의 `viewLabel!=='INBOX'` 단축조건 제거), Sidebar STARRED 항목+배지, kbar `g t` / CP3 E2E: `TC-IZ-B1/B2/B7` 반전 재작성+`TC-IZ-B3`→`TC-STAR-B3` 이관+`TC-IZ-A2` 단순화+`TC-STAR-*` 8건 신설). 최종 전체 브랜치 리뷰(deep-reasoner/Opus)에서 Important 1건 발견·수정: `viewMembershipLabels`가 뷰당 라벨 하나만 벗기도록 단순화돼 있어, 외부에서 별표 유지한 채 trash된 스레드의 stale INBOX가 캐시에 남아 "0이어야 할" Inbox로 샐 수 있었음 — INBOX/STARRED는 배제 규칙이 동일해 어느 쪽에서 벗겨지든 둘 다 벗기도록 복원(반대쪽 뷰의 다음 revalidate가 서버 원본으로 self-heal함을 근거로 안전성 증명, D9). `/react-best-practices`(해당 없음, none)+`/code-review low`(2회 패스, none). E2E TC-STAR 8건 신규+TC-IZ 4건 반전 재작성, 전체 스위트 **224 PASS·0 FAIL·5 SKIP**(캐논 SKIP 집합 동일, 기존 216 대비 +8) ×3 결정적(review-fix 전 2회+후 1회). 세션 오케스트레이션 메모: E2E 재작성을 맡은 서브에이전트가 백그라운드 프로세스 완료를 스스로 감지 못 해 2회 공회전 — 오케스트레이터가 PID를 직접 관찰·개입해 정상 완료 확인. 남은 스코프: label 사이드바 추가·삭제는 사용자 요청대로 별도 세션 예정. (docs/features/starred-view/)
- [x] `undo-toast` + `label-crud` + `snippets-inline-reply` — 사용자 요청 "UX를 개선할 수 있는 아이디어를 3개 도출(plan) 하고 실행해" — 2026-07-17 완료. 오케스트레이터가 PRD/RESEARCH_SUPERHUMAN/TODO 백로그/DECISIONS 조사(Explore 에이전트)를 근거로 3건 자체 도출 → 사용자가 3개 그대로 + 각각 정식 Goal 0~8 확정. **①undo-toast**: Archive/Trash/Snooze/Label-apply(단건+벌크)에 5초 Undo(로컬 복원+서버 보정 호출, 기존 실패-롤백 `captureRemoval`/`rollbackRemoval`과 별개 경로). **②label-crud**: 사이드바 라벨 생성(`+`인라인 입력)·삭제(hover 아이콘+확인 다이얼로그, Gmail `labels.create`/`labels.delete` 재사용). **③snippets-inline-reply**: Compose 전용이던 Snippets(`⌘;`)를 InlineReply에도 포팅. 구현은 파일 소유권 기준으로 재편(main 배선 2건이 `shared/types.ts`/`ipc.ts`/`preload.ts`를 공유해 CP-A로 통합, renderer 배선 2건이 `store/mail.ts`를 공유해 CP-B로 통합, snippets는 `ThreadView.tsx`만 건드려 CP-C로 완전 병렬) + CP-D(E2E 3건 통합, TC-UNDO/LBL/SNIP 총 27건). 최종 전체 브랜치 리뷰(deep-reasoner/Opus)에서 Important 1건 발견·수정: `applyLabel`/`applyLabelSelected`의 undo가 "이번에 실제로 새로 추가됐는지" 구분 없이 무조건 라벨을 제거해, 벌크 적용 시 원래부터 그 라벨을 갖고 있던 스레드에서도 서버에서 라벨이 영구 삭제될 수 있었음(D8로 수정, self-heal 불가능한 버그였음). 리뷰가 별도로 Minor·self-healing 판정한 `mail:cancel-snooze` 캐시 즉시반영 개선은 오케스트레이터가 시도했다가 E2E(TC-UNDO-A4) 2/2 재현 회귀를 직접 만들어 원복(근본원인 미확정, 원래도 self-heal되던 항목이라 후속 과제로 이월 — 격리 vitest로는 캐시 계층 자체가 정확함을 확인했으나 실제 `mail:snooze` 캐시 상태·타이밍과의 상호작용까지는 규명 못 함). `/react-best-practices`(해당 없음)+`/code-review low`(none). vitest 195 PASS·tsc clean. E2E **250 PASS·0 FAIL·7 SKIP**(캐논 5+신규 2 `{TC-UNDO-B1, TC-LBL-A5}`, 둘 다 하네스로 재현 불가능한 사유 문서화) 클린 확인. 세션 오케스트레이션 메모: E2E 서브에이전트가 자신의 백그라운드 프로세스 완료를 스스로 감지 못 해 재개 필요(starred-view와 동일 패턴 재발) — 결과 자체는 정확하고 상세했음(오케스트레이터가 독립 재실행으로 교차검증). (docs/features/undo-toast/, docs/features/label-crud/, docs/features/snippets-inline-reply/)
- [x] `new-mail-alerts` — 사용자 요청 "새로운 메일이 도착했을 때 app alert(badge + push alert) 기능 추가" — 2026-07-19 완료. macOS Dock 배지(전 계정 unread 합산)+네이티브 알림(발신자/제목, 2건+는 그룹화)을 기존 60s 배지 데몬 확장으로 구현(새 폴링 루프 없음). 콜드스타트 안전(로그인 직후 알림 폭발 없음), 포커스 중 억제, 클릭 시 스레드 오픈/계정전환(개별) 또는 활성계정 Inbox(그룹, 전환 없음). 최종 리뷰(Opus) Critical/Important 0건, Low 2건 문서화(배지-정확성 우선 트레이드오프, 창 완전종료 후 알림클릭 재오픈 불가). E2E TC-ALT 14건 신규, 전체 스위트 **273 어서션 0 FAIL**(신규 정책상 ×1). 세션 중 E2E 하네스 자체 버그(배지 숫자가 섞인 textContent 정확매칭 실패) 1건 발견·수정 + better-sqlite3 ABI 인시던트 재발(electron-rebuild로 복구, 상시 규약에 명문화) + "매 feature마다 전체 E2E 반복 실행"의 토큰 비용 문제 제기로 **E2E 실행 비용 정책** 신설(반복 개발 중엔 신규 feature 세션만 격리 실행, 최종 게이트는 일반 feature ×1). (docs/features/new-mail-alerts/)
