# remote-image-prefetch — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs, TC-IMG-B*, 기존 TC-IMG-A1~A3 뒤에 이어짐). ground truth: DOM + `--zenmail-e2e` 게이트의 `__debug` 훅(사설 IP fixture URL, `__debugSetImageCacheDir`) + sqlite `image_cache` 테이블 직접 조회 + vitest(`image-cache.ts` 순수 로직).
> **데모 시드 전제**: 기존 `ZENMAIL_DEMO_REMOTE_IMG` 게이트 시드(`demo_img_1`, press@pixelpost.example, 일반 데모에는 미생성)와 하네스 로컬 이미지 서버를 그대로 재사용. 이 feature 전용으로 추가하는 fixture: (a) 사설 IP(`http://127.0.0.1:<임의포트>/probe.png` 또는 `169.254.169.254`)를 가리키는 원격 img 스레드 1건, (b) 5MB 초과 응답을 흉내내는 하네스 로컬 서버 엔드포인트 1건(캐시 상한 prune 검증용).
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
>
> **Task 10 실행 결과 (2026-07-20, `node e2e/run-tc.mjs` ×2 연속 실행, 둘 다 동일 판정)**:
> `TOTAL 287 | PASS 280 | FAIL 0 | SKIP 7` (SKIP ⊆ 캐논 8종), `NO-REGRESSION: CLEAN`.
> `npm test` 241/241, `npx tsc --noEmit` clean. TC-IMG-B1~B7/B9 + A1~A3 + G1/G2 전부 `[x]` PASS.
> B8만 E2E 레이어에서 판단상 SKIP(사유는 해당 항목에 병기) — vitest F4가 이미 순수 로직을 커버.
>
> **Task 10에서 발견·수정한 두 가지 구현 버그** (E2E를 처음 구동해보고 나서야 드러남 — 상세는
> `DECISIONS.md` D9-3/D10):
> 1. **D9-3**: 이 하네스의 로컬 이미지 서버(`demo_img_1`이 재사용하는 것, FR18)가 `127.0.0.1`에
>    바인딩되는데, D9의 SSRF 가드는 루프백을 무조건 차단해 하네스 자신의 "원격" 이미지조차 절대
>    로드될 수 없었다(TC-IMG-A3가 애초에 항상 실패하는 상태였음). `image-cache.ts`에
>    `isPrefetchableUrlE2E`를 추가해 `ZENMAIL_E2E_PORT`가 설정된 프로세스에서만
>    `ZENMAIL_DEMO_REMOTE_IMG` origin 하나만 예외 허용(그 외 사설 IP는 전부 그대로 차단 — B3/B4용
>    별도 probe fixture로 직접 검증).
> 2. **D10**: `mail:get-remote-image` 핸들러가 FR11 원안 그대로 `fetchLive`를
>    `autoLoadRemoteImages` 전역 설정값으로 넘겼는데, 이는 정확히 게이트 버튼이 보이는 조건(설정
>    off)에서 클릭해도 라이브 fetch가 아예 시도되지 않게 만드는 버그였다(FR16 "회귀 없는 완전한
>    폴백" 위반, TC-IMG-A3/B6가 처음엔 재현 가능하게 실패). 이 IPC가 호출된 시점 자체가 이미
>    렌더러의 로드 의도 확정이므로 항상 `fetchLive: true`로 정정.
>
> 두 수정 모두 `docs/features/remote-image-prefetch/DECISIONS.md`에 근거·대안 비교와 함께 기록.
> 후속 전체 브랜치 리뷰(Step 8)에서 특히 D9-3(origin-pinning 허용목록)을 SSRF 가드 정합성 관점에서
> 우선 검토할 것.

## A. 무클릭 로드 (동기화 프리페치 → 열람 시 즉시)

- [x] **TC-IMG-B1** If `autoLoadRemoteImages`가 기본값(true)이고 동기화 tick이 `demo_img_1`을 새 메일로 처리한 뒤, When 사용자가 해당 스레드를 열면, Then "Load remote images" 버튼 없이 즉시 `img[src^="data:"]`로 렌더된다(캐시가 이미 따뜻함). PASS — `run-tc.mjs` `runImgBSession`. `demo_img_1`은 `unread:false`로 시드되어 데몬의 "새 unread 순증" 프리페치 트리거를 절대 타지 않으므로(FR7/FR8 전제 자체가 신규 unread 도착), 대신 `__debugInjectNewMail`로 새 unread 스레드를 주입 + `__debugTick`으로 동일한 데몬 프리페치 경로를 정확히 재현. (부수 발견: 계정의 첫 rise-tick은 `notify.ts diffNewUnread`의 cold-start 가드(baseline만 시딩, `newThreads=[]`)에 흡수돼 프리페치가 스킵되므로 — TC-ALT-C1과 동일 메커니즘 — 세션 시작 시 throwaway 스레드로 한 번 미리 흡수한 뒤 B1의 실제 fixture를 주입.) 오픈 시 게이트 버튼 없음 + `img[src^="data:"]` 즉시 + 오픈 시점 추가 네트워크 요청 0건까지 확인.
- [x] **TC-IMG-B2** If 프리페치가 아직 안 된 스레드(오프라인 중 도착 등 드문 경우)를 처음 열면, When 토글이 true면, Then 열람 시점 즉석 fetch가 일어나 결국 `img[src^="data:"]`로 렌더되고, 그 결과가 sqlite `image_cache`에 기록되어 두 번째 열람부터는 즉시 로드된다. PASS — daemon tick 없이 스레드를 바로 열어 on-demand fetch(네트워크 hit 확인) → data: 렌더 → 재오픈 시 추가 네트워크 요청 0건(sqlite 기록 자체가 아니라 그 관측 가능한 결과인 "즉시 캐시 hit"으로 검증 — sqlite 직접 조회 훅은 아래 B8 노트 참고).

## B. SSRF 차단

- [x] **TC-IMG-B3** If 사설 IP(`127.0.0.1`/`169.254.169.254` 등)를 가리키는 fixture 스레드를 동기화 tick이 처리하면, When 프리페치가 시도되면, Then 실제 네트워크 요청이 발생하지 않는다(`isPrefetchableUrl` 차단, 하네스 네트워크 로그로 0건 확인). PASS — `demo_img_1`의 IMG_URL과는 다른 origin(다른 포트)에 실제로 살아있는 두 번째 로컬 서버를 fixture로 써서, "타임아웃이 아니라 가드 자체가 막았다"를 직접 증명(probeHits 불변).
- [x] **TC-IMG-B4** If 사설 IP fixture 스레드를 사용자가 직접 열어 열람 시점 즉석 fetch 경로를 타도, When `getCachedOrFetch`가 호출되면, Then 마찬가지로 요청이 차단되고 이미지는 로드되지 않는다(게이트 버튼도 없음 — CSP가 애초에 `data:`만 허용하므로 깨진 이미지로 조용히 남는다). PASS — 오픈 후 probeHits 불변 + 게이트 버튼 부재 + `naturalWidth===0` 모두 확인.

## C. 토글 off — 기존 게이트로 완전 fallback

- [x] **TC-IMG-B5** If Command Palette에서 "Toggle automatic remote image loading"을 끄면, When `demo_img_1`을 열면, Then 기존 "Load remote images" 버튼이 노출되고 클릭 전에는 네트워크 요청이 0건이다(기존 TC-IMG-A2 회귀 없음 재확인). PASS — `scenario_img`가 A1~A3 앞에서 토글을 명시적으로 끈 뒤 동일 흐름을 타므로, A1/A2와 완전히 같은 증거를 공유해 함께 기록(끝에서 토글 원복).
- [x] **TC-IMG-B6** If 토글이 off인 상태에서 게이트 버튼을 클릭하면, When 이미지가 로드되면, Then 기존 TC-IMG-A3 동작(실제 로드) 그대로 재현된다. PASS — 위 D10 버그 수정 후 통과(수정 전에는 100% 재현 가능하게 실패했음).

## D. 캐시 상한 / LRU prune

- [x] **TC-IMG-B7** If 계정 캐시가 200MB 상한에 근접한 상태에서 5MB 초과 fixture 응답을 프리페치 시도하면, When 응답 크기가 상한을 넘으면, Then 즉시 abort되고 캐시에 기록되지 않는다. PASS — **판단에 의한 부분 검증**: `fetchImageBytes`의 5MB 캡 체크는 누적 캐시 총량과 무관하게 응답 1건 단위로 무조건 적용되므로(코드 확인), "200MB 상한 근접" 사전조건 없이도 이 가드의 핵심(단일 응답이 5MB를 넘으면 절대 캐시/렌더되지 않는다)을 E2E로 직접 관측 가능 — 실제로 검증(요청은 서버에 도달함=`imgHits` 증가로 확인, 그러나 끝내 `data:`로 렌더되지 않음=abort 확인). "200MB 근접" 시나리오까지 실제로 스테이징하는 것은 진짜 이미지 바이트 수백MB를 E2E에서 실제 전송해야 해 비현실적/불안정하다고 판단 — 이 부분은 아래 B8과 함께 vitest에 위임.
- [~] **TC-IMG-B8** If `pruneCache`를 캐시 총량이 상한을 넘은 상태로 호출하면, When prune이 실행되면, Then `fetched_at`이 가장 오래된 항목부터 삭제되어 총량이 상한 아래로 내려간다(sqlite `image_cache` row 수 감소로 확인). **SKIP — 판단에 의한 E2E 레이어 제외, 사유**: (1) 200MB 상한을 실제로 넘기려면 E2E 하네스가 진짜 이미지 바이트 수백 MB를 로컬 서버로 왕복 전송해야 해 비현실적으로 느리고 불안정하다. (2) `pruneCache`의 핵심 로직(오래된 순 삭제, 과삭제 없음, 상한 만족까지만 삭제)은 이미 vitest `TC-IMG-F4`(`image-cache.test.ts` "pruneCache deletes oldest entries..."/"...is a no-op when total is already under maxBytes")가 순수 함수 단위로 정확히 검증한다. (3) "매 틱 무조건 prune이 실제로 호출되는가"라는 배선(wiring) 질문은 코드 확인으로 충분히 정적으로 검증 가능하다 — `snooze.ts`의 데몬 틱 루프가 계정마다 매 틱 조건 없이 `pruneCache(ctx.cache, imageCacheDir(ctx.email), IMAGE_CACHE_MAX_BYTES)`를 호출한다(오프라인이어도 — 디스크 정리라 네트워크 불요, TC-IMG-B9와 별개로 이미 `snooze.test.ts`의 "skips prefetch (but still prunes) for an offline account" 유닛 테스트가 이 배선까지 함께 확인함). sqlite `image_cache` 테이블을 E2E에서 직접 조회하는 debug 훅은 이번 task에서 신설하지 않았다 — 오직 이 SKIP 하나만을 위해 새 IPC 표면(공격 표면 확장 없음이 자명하더라도)을 추가하는 것보다, 이미 있는 유닛 테스트 커버리지 + 정적 배선 확인으로 충분하다고 판단.

## E. 오프라인 스킵

- [x] **TC-IMG-B9** If 계정이 오프라인으로 감지된 상태에서 동기화 tick이 도는 동안, When 새 메일이 있어도, Then 해당 계정의 이미지 프리페치는 스킵된다(네트워크 요청 0건, 다른 계정 처리는 정상 계속). PASS(요청 0건 부분). **"다른 계정 처리는 정상 계속" 부분은 판단에 의해 별도 2계정 재현을 새로 만들지 않음** — `snooze.ts`의 틱 루프가 계정마다 독립된 try/catch로 격리되어 있다는 구조 자체가 이미 이 불변식의 근거이고, 동일한 격리 메커니즘이 `TC-MA-B2`(비활성 계정 데몬 처리) 등 기존 E2E로 이미 반복 검증됨 — 이 feature 전용으로 중복 테스트를 새로 만드는 대신 근거를 명시.

## F. vitest — 순수 로직

- [x] **TC-IMG-F1** If URL의 hostname이 `127.0.0.1`/`10.x`/`172.16-31.x`/`192.168.x`/`169.254.x`/`::1`/`fc00::/7` 중 하나면, When `isPrefetchableUrl`을 호출하면, Then `false`를 반환한다. 공인 IP/도메인이면 `true`. PASS — `image-cache.test.ts` `describe('isPrefetchableUrl')`(Task 3/Task 10 D9-1/D9-2 정정분 포함, 11 tests).
- [x] **TC-IMG-F2** If 3xx 리다이렉트가 사설 IP로 향하면, When 라이브 fetch가 리다이렉트를 따라가려 하면, Then 그 hop에서 가드가 재적용되어 요청이 중단된다. PASS — `image-cache.test.ts` "rejects a redirect that points to a private IP, even mid-chain, despite the origin being trusted".
- [x] **TC-IMG-F3** If `Content-Type`이 `image/*`가 아니거나 응답이 5MB를 넘으면, When 라이브 fetch 중이면, Then 즉시 abort되고 캐시에 기록되지 않는다. PASS — "rejects a non-image content-type" / "rejects a response over 5MB" / "rejects a response that lies about its size via streaming".
- [x] **TC-IMG-F4** If 캐시 메타데이터 목록에 `fetched_at`이 섞여 있으면, When `pruneCache(maxBytes)`를 호출하면, Then 오래된 순으로 정확히 상한을 만족할 때까지만 삭제된다(과삭제 없음). PASS — "pruneCache deletes oldest entries until under maxBytes" / "pruneCache is a no-op when total is already under maxBytes".
- [x] **TC-IMG-F5 (신설, Task 10)** `isPrefetchableUrlE2E`(D9-3) — `ZENMAIL_DEMO_REMOTE_IMG` 미설정 시 `isPrefetchableUrl`과 완전히 동일(프로덕션 기본값), 설정 시 그 origin만 정확히 예외 허용하고 다른 사설 IP/포트는 여전히 차단, 공인 URL은 무관하게 항상 허용. PASS — `image-cache.test.ts` `describe('isPrefetchableUrlE2E')` (3 tests).

## G. 회귀 게이트

- [x] **TC-IMG-G1** 기존 TC-IMG-A1~A3(email-body-images 버그수정 시 신설된 원격 이미지 게이트 노출/동의 전 요청 0건/동의 후 실제 로드) 전부 무회귀. PASS — `run-tc.mjs` `TC-IMG-G1` record, A1/A2/A3 전부 PASS 확인(D10 수정 후).
- [x] **TC-IMG-G2** 전체 E2E 스위트 무회귀 — 0 FAIL + SKIP 집합 ⊆ 캐논(`run-tc.mjs` `CANON_SKIPS` 8종). PASS — 2026-07-20 ×2 연속 실행 모두 `TOTAL 287 | PASS 280 | FAIL 0 | SKIP 7 ⊆ canon`, `NO-REGRESSION: CLEAN`.
