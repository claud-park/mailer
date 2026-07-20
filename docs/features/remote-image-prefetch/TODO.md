# remote-image-prefetch — Checkpoint TODO

> Goal 2 산출물. 각 CP는 tsc + npm test 통과, breaking change 시 리뷰 프로토콜(`/react-best-practices` +
> `/code-review low` → 커밋 → push). **CP4 전까지 기존 E2E 캐논(`run-tc.mjs` `CANON_SKIPS` 8종:
> A4·D5·D8·SY-C3·SA-B4·SY-B2·UNDO-B1·LBL-A5) 무회귀가 설계 불변식.**
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 설계 스펙 확정([2026-07-19-remote-image-prefetch-design.md](../../superpowers/specs/2026-07-19-remote-image-prefetch-design.md))
- [x] PRD 작성
- [~] TODO/TC/DECISIONS 작성 (이 문서 + 후속 2건)

## CP1. main 레이어 — image-cache.ts (SSRF 가드 + 디스크 캐시 + sqlite 메타데이터)
- [x] `image-cache.ts` 신설: `isPrefetchableUrl(url)` — 스킴 필터 + 사설/루프백/링크-로컬 IP 차단(FR1)
- [x] `getCachedOrFetch(accountId, url, {fetchLive})` — 캐시 조회 → (옵션) 라이브 fetch → 캐시 기록(FR2)
- [x] 라이브 fetch 가드: `Content-Type: image/*` 아니면 abort, 5MB 초과 시 abort, redirect ≤3회 매 hop 재검증, 8초 타임아웃(FR3)
- [x] `prefetch(accountId, urls)` — 병렬 호출, 개별 실패 조용히 스킵(FR4)
- [x] `pruneCache(accountId, maxBytes=200MB)` — LRU(`fetched_at` 오름차순) 삭제(FR5)
- [x] `cache.ts` `AccountCache`에 `image_cache` 테이블 추가(`url_hash` PK/`mime_type`/`byte_size`/`fetched_at`) + get/set/prune 메서드(FR6)
- [x] vitest: SSRF 가드(사설 IP 케이스별), 5MB/타입 초과 abort, LRU 정렬, 리다이렉트 재검증 — 순수 로직 우선(TDD)
- [x] tsc + npm test

## CP2. 동기화 연동 + IPC 3-파일 계약
- [x] `snooze.ts`: unread count 순증 훅(new-mail-alerts D8 지점, `diffNewUnread` 직후)에서 신규 스레드마다 `provider.getThread(threadId)`를 추가 호출해 `bodyHtml` 확보(D6 정정 — 기존 `listThreads`엔 bodyHtml 없음) → 정규식으로 원격 img URL 추출 → `prefetch()` 호출(FR7/FR8)
- [x] 오프라인 계정 틱은 프리페치 스킵(FR9), 계정별 try/catch 격리(FR10) — Task 6에서 완료(git c344b1b), Task 10에서 TC-IMG-B9로 E2E 확인
- [x] `types.ts`: `ZenmailApi.getRemoteImage(accountId, url)` + `autoLoadRemoteImages` 전역 설정 타입(FR12/FR13) — Task 5에서 완료(git c6bc9cd)
- [x] `ipc.ts`: `mail:get-remote-image` 핸들러(FR11) + `settings:get-global`/`set-global` 기존 채널 재사용 확인(신규 채널 불요, theme과 동일) — Task 5에서 완료. **Task 10 정정(D10)**: 핸들러가 `fetchLive`를 `autoLoadRemoteImages` 전역 설정값으로 넘기던 FR11 원안 버그를 발견·수정(전역 설정 off일 때 게이트 클릭이 절대 로드되지 않던 문제, FR16 위반) — 항상 `fetchLive: true`로 정정.
- [x] `preload.ts`: `getRemoteImage` 노출 — Task 5에서 완료. **Task 10에서 발견·추가**: `mail:debug-set-image-cache-dir` IPC 핸들러(`ipc.ts`)는 이미 있었으나 `preload.ts`/`types.ts`의 `__debugSetImageCacheDir` 노출이 누락돼 렌더러/E2E에서 호출 불가능했다 — 배선 완료(FR19 완결).
- [x] `--zenmail-e2e` 게이트: 사설 IP fixture URL(SSRF 미발화 검증용) + `__debugSetImageCacheDir` 훅(FR19) — Task 10에서 완료. 사설 IP fixture는 `run-tc.mjs`가 띄우는 별도 로컬 probe 서버(`PROBE_URL`, `demo_img_1`의 origin과 다른 포트) + `__debugInjectNewMail`의 `bodyHtml` 오버라이드(Task 10에서 추가)로 구현 — `gmail.ts`에 정적 시드로 추가하지 않고 동적 주입만 사용(정적 시드였다면 `SA_RESERVED_SUBJECTS`/`SY_RESERVED` 등록이 필수였을 것). `__debugSetImageCacheDir`는 배선만 완료, E2E에서 실제 호출은 하지 않음(각 세션이 이미 독립된 `--user-data-dir`로 격리되어 굳이 필요하지 않았음 — 미사용 배선이지만 FR19 문구 요구사항 자체는 완결).
- [x] vitest: snooze.ts URL 추출 정규식 단위 테스트(과매칭 허용 범위 확인) — `image-cache.test.ts`의 `extractRemoteImageUrls` describe 블록(Task 3), `snooze.test.ts`가 데몬 통합 경로까지 커버(Task 6)
- [x] tsc + npm test — Task 10 시점 241/241 통과, tsc clean

## CP3. renderer — ThreadView 게이트 제거/치환 + CommandPalette 토글
- [x] `mail.ts` 스토어: `autoLoadRemoteImages` 필드(부팅 시 `getGlobalSetting` 읽기) + `toggleAutoLoadRemoteImages()`(setGlobalSetting persist, FR17) — Task 7에서 완료(git 215412b)
- [x] `ThreadView.tsx`: `allowImages`/`hasRemoteImages`/"Load remote images" 버튼 로직 제거(FR14) — Task 8에서 완료(git b156454), FR16 폴백 버튼으로 대체
- [x] `MessageCard`: `remoteImages: Map<url, dataUri>` state, mount 시 전역 설정 true면 본문 원격 `<img src>` 전체를 `getRemoteImage` IPC 병렬 요청(FR14) — Task 8에서 완료
- [x] `prepareHtml()`: `cid:` 치환과 병렬로 원격 이미지 data URI 치환, 매칭 실패는 원본 유지 + CSP `img-src`는 계속 `data:`만(https/http 확장 코드 제거, FR15) — Task 8에서 완료
- [x] 전역 설정 false면 기존 게이트 버튼 UI로 완전 fallback(FR16, 회귀 없음 확인) — Task 8에서 UI는 완료했으나 **Task 10에서 fetchLive 버그(D10)로 실제로는 회귀 상태였음을 E2E로 발견·수정** — 지금은 TC-IMG-A3/B6로 실측 회귀 없음 확인
- [x] `CommandPalette.tsx`: "Load remote images automatically" on/off 액션(`toggleTheme`과 동일 자리, FR17)
- [x] tsc + npm test
- [x] `/react-best-practices` — self-check clean(신규 위반 0건, 이월 Minor는 Task 8 리뷰에서 이미 문서화) · `/code-review low` — 사용자 직접 실행 필요(model-invocation 비활성 커맨드, 이전 feature들과 동일 패턴) → 커밋 완료, push는 Task 10 종료 시점에 일괄

## CP4. E2E TC-IMG-B* + 무회귀 (Goal 5~8)
- [x] TC-IMG-B1 (신규 메일 동기화 후 열람 시 클릭 없이 즉시 `img[src^="data:"]`) — PASS
- [x] TC-IMG-B2 (프리페치 안 된 스레드 첫 열람 시 즉석 fetch → 두 번째부터 즉시 로드) — PASS
- [x] TC-IMG-B3/B4 (사설 IP fixture — 데몬 프리페치·열람 즉석 fetch 둘 다 네트워크 요청 0건, SSRF 차단) — PASS
- [x] TC-IMG-B5/B6 (토글 off → 기존 게이트 버튼 노출 + 클릭 전 0건 / 클릭 후 실제 로드, TC-IMG-A1~A3 회귀 없음 재확인) — PASS
- [x] TC-IMG-B7 (5MB 초과 단일 응답 abort, 캐시/렌더 안 됨) — PASS(판단에 의한 부분 검증 — TC.md D절 참고)
- [~] TC-IMG-B8 (LRU prune — sqlite row 수 감소) — SKIP, 판단에 의해 E2E 레이어 제외(사유는 TC.md D절에 상세 기록, vitest TC-IMG-F4 + 정적 배선 확인으로 대체)
- [x] TC-IMG-B9 (오프라인 계정 틱은 프리페치 스킵 — 네트워크 요청 0건) — PASS
- [x] 기존 E2E 무회귀 재실행(표적 probe로 red/green 반복 → 최종 1회 full, 대형 변경이면 ×2 결정적) — 표적 probe(`e2e/_probe-img-b.mjs`, 완료 후 삭제)로 반복 검증 후 전체 스위트 ×2 연속 실행: 둘 다 `TOTAL 287 | PASS 280 | FAIL 0 | SKIP 7 ⊆ canon`, `NO-REGRESSION: CLEAN`(`npm test` 241/241, `tsc` clean 포함)
- [ ] `/impeccable` audit pass — CommandPalette 신규 액션 UI (Task 10 fast-worker 범위 밖 — 사용자 직접 실행 필요, 이전 feature들과 동일 패턴)
- [ ] 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — SSRF 가드 우회 가능성 집중 검토, **특히 Task 10에서 신설한 D9-3 `isPrefetchableUrlE2E` origin-pinning 허용목록을 우선 검토 대상으로**
- [x] TC/TODO 갱신 (이 커밋) — DEV_WORKFLOW/루트 TODO/Obsidian은 컨트롤러가 전체 브랜치 리뷰 뒤 일괄 처리(Task 10 브리프 명시 범위 제외)
