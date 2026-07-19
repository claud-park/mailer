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
- [ ] `image-cache.ts` 신설: `isPrefetchableUrl(url)` — 스킴 필터 + 사설/루프백/링크-로컬 IP 차단(FR1)
- [ ] `getCachedOrFetch(accountId, url, {fetchLive})` — 캐시 조회 → (옵션) 라이브 fetch → 캐시 기록(FR2)
- [ ] 라이브 fetch 가드: `Content-Type: image/*` 아니면 abort, 5MB 초과 시 abort, redirect ≤3회 매 hop 재검증, 8초 타임아웃(FR3)
- [ ] `prefetch(accountId, urls)` — 병렬 호출, 개별 실패 조용히 스킵(FR4)
- [ ] `pruneCache(accountId, maxBytes=200MB)` — LRU(`fetched_at` 오름차순) 삭제(FR5)
- [ ] `cache.ts` `AccountCache`에 `image_cache` 테이블 추가(`url_hash` PK/`mime_type`/`byte_size`/`fetched_at`) + get/set/prune 메서드(FR6)
- [ ] vitest: SSRF 가드(사설 IP 케이스별), 5MB/타입 초과 abort, LRU 정렬, 리다이렉트 재검증 — 순수 로직 우선(TDD)
- [ ] tsc + npm test

## CP2. 동기화 연동 + IPC 3-파일 계약
- [ ] `snooze.ts`: unread count 순증 훅(new-mail-alerts D8 지점, `diffNewUnread` 직후)에서 신규 스레드마다 `provider.getThread(threadId)`를 추가 호출해 `bodyHtml` 확보(D6 정정 — 기존 `listThreads`엔 bodyHtml 없음) → 정규식으로 원격 img URL 추출 → `prefetch()` 호출(FR7/FR8)
- [ ] 오프라인 계정 틱은 프리페치 스킵(FR9), 계정별 try/catch 격리(FR10)
- [ ] `types.ts`: `ZenmailApi.getRemoteImage(accountId, url)` + `autoLoadRemoteImages` 전역 설정 타입(FR12/FR13)
- [ ] `ipc.ts`: `mail:get-remote-image` 핸들러(FR11) + `settings:get-global`/`set-global` 기존 채널 재사용 확인(신규 채널 불요, theme과 동일)
- [ ] `preload.ts`: `getRemoteImage` 노출
- [ ] `--zenmail-e2e` 게이트: 사설 IP fixture URL(SSRF 미발화 검증용) + `__debugSetImageCacheDir` 훅(FR19)
- [ ] vitest: snooze.ts URL 추출 정규식 단위 테스트(과매칭 허용 범위 확인)
- [ ] tsc + npm test

## CP3. renderer — ThreadView 게이트 제거/치환 + CommandPalette 토글
- [ ] `mail.ts` 스토어: `autoLoadRemoteImages` 필드(부팅 시 `getGlobalSetting` 읽기) + `toggleAutoLoadRemoteImages()`(setGlobalSetting persist, FR17)
- [ ] `ThreadView.tsx`: `allowImages`/`hasRemoteImages`/"Load remote images" 버튼 로직 제거(FR14)
- [ ] `MessageCard`: `remoteImages: Map<url, dataUri>` state, mount 시 전역 설정 true면 본문 원격 `<img src>` 전체를 `getRemoteImage` IPC 병렬 요청(FR14)
- [ ] `prepareHtml()`: `cid:` 치환과 병렬로 원격 이미지 data URI 치환, 매칭 실패는 원본 유지 + CSP `img-src`는 계속 `data:`만(https/http 확장 코드 제거, FR15)
- [ ] 전역 설정 false면 기존 게이트 버튼 UI로 완전 fallback(FR16, 회귀 없음 확인)
- [ ] `CommandPalette.tsx`: "Load remote images automatically" on/off 액션(`toggleTheme`과 동일 자리, FR17)
- [ ] tsc + npm test
- [ ] `/react-best-practices` + `/code-review low` → 커밋 → push(breaking change 프로토콜)

## CP4. E2E TC-IMG-B* + 무회귀 (Goal 5~8)
- [ ] TC-IMG-B1 (신규 메일 동기화 후 열람 시 클릭 없이 즉시 `img[src^="data:"]`)
- [ ] TC-IMG-B2 (사설 IP fixture URL — 프리페치 대상이어도 네트워크 요청 0건, SSRF 차단)
- [ ] TC-IMG-B3 (토글 off → 기존 게이트 버튼 노출 + 클릭 전 네트워크 요청 0건, TC-IMG-A2 회귀 없음 재확인)
- [ ] TC-IMG-B4 (캐시 200MB 상한 도달 시 LRU prune — sqlite 카운트 검증)
- [ ] TC-IMG-B5 (오프라인 계정 틱은 프리페치 스킵 — 네트워크 요청 0건)
- [ ] 기존 E2E 무회귀 재실행(표적 probe로 red/green 반복 → 최종 1회 full, 대형 변경이면 ×2 결정적)
- [ ] `/impeccable` audit pass — CommandPalette 신규 액션 UI
- [ ] 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — SSRF 가드 우회 가능성 집중 검토
- [ ] TC/TODO/DEV_WORKFLOW/루트 TODO 갱신 + Obsidian 기록
