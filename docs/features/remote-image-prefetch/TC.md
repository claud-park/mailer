# remote-image-prefetch — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs, TC-IMG-B*, 기존 TC-IMG-A1~A3 뒤에 이어짐). ground truth: DOM + `--zenmail-e2e` 게이트의 `__debug` 훅(사설 IP fixture URL, `__debugSetImageCacheDir`) + sqlite `image_cache` 테이블 직접 조회 + vitest(`image-cache.ts` 순수 로직).
> **데모 시드 전제**: 기존 `ZENMAIL_DEMO_REMOTE_IMG` 게이트 시드(`demo_img_1`, press@pixelpost.example, 일반 데모에는 미생성)와 하네스 로컬 이미지 서버를 그대로 재사용. 이 feature 전용으로 추가하는 fixture: (a) 사설 IP(`http://127.0.0.1:<임의포트>/probe.png` 또는 `169.254.169.254`)를 가리키는 원격 img 스레드 1건, (b) 5MB 초과 응답을 흉내내는 하네스 로컬 서버 엔드포인트 1건(캐시 상한 prune 검증용).
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)

## A. 무클릭 로드 (동기화 프리페치 → 열람 시 즉시)

- [ ] **TC-IMG-B1** If `autoLoadRemoteImages`가 기본값(true)이고 동기화 tick이 `demo_img_1`을 새 메일로 처리한 뒤, When 사용자가 해당 스레드를 열면, Then "Load remote images" 버튼 없이 즉시 `img[src^="data:"]`로 렌더된다(캐시가 이미 따뜻함).
- [ ] **TC-IMG-B2** If 프리페치가 아직 안 된 스레드(오프라인 중 도착 등 드문 경우)를 처음 열면, When 토글이 true면, Then 열람 시점 즉석 fetch가 일어나 결국 `img[src^="data:"]`로 렌더되고, 그 결과가 sqlite `image_cache`에 기록되어 두 번째 열람부터는 즉시 로드된다.

## B. SSRF 차단

- [ ] **TC-IMG-B3** If 사설 IP(`127.0.0.1`/`169.254.169.254` 등)를 가리키는 fixture 스레드를 동기화 tick이 처리하면, When 프리페치가 시도되면, Then 실제 네트워크 요청이 발생하지 않는다(`isPrefetchableUrl` 차단, 하네스 네트워크 로그로 0건 확인).
- [ ] **TC-IMG-B4** If 사설 IP fixture 스레드를 사용자가 직접 열어 열람 시점 즉석 fetch 경로를 타도, When `getCachedOrFetch`가 호출되면, Then 마찬가지로 요청이 차단되고 이미지는 로드되지 않는다(게이트 버튼도 없음 — CSP가 애초에 `data:`만 허용하므로 깨진 이미지로 조용히 남는다).

## C. 토글 off — 기존 게이트로 완전 fallback

- [ ] **TC-IMG-B5** If Command Palette에서 "Load remote images automatically"를 끄면, When `demo_img_1`을 열면, Then 기존 "Load remote images" 버튼이 노출되고 클릭 전에는 네트워크 요청이 0건이다(기존 TC-IMG-A2 회귀 없음 재확인).
- [ ] **TC-IMG-B6** If 토글이 off인 상태에서 게이트 버튼을 클릭하면, When 이미지가 로드되면, Then 기존 TC-IMG-A3 동작(실제 로드) 그대로 재현된다.

## D. 캐시 상한 / LRU prune

- [ ] **TC-IMG-B7** If 계정 캐시가 200MB 상한에 근접한 상태에서 5MB 초과 fixture 응답을 프리페치 시도하면, When 응답 크기가 상한을 넘으면, Then 즉시 abort되고 캐시에 기록되지 않는다.
- [ ] **TC-IMG-B8** If `pruneCache`를 캐시 총량이 상한을 넘은 상태로 호출하면, When prune이 실행되면, Then `fetched_at`이 가장 오래된 항목부터 삭제되어 총량이 상한 아래로 내려간다(sqlite `image_cache` row 수 감소로 확인).

## E. 오프라인 스킵

- [ ] **TC-IMG-B9** If 계정이 오프라인으로 감지된 상태에서 동기화 tick이 도는 동안, When 새 메일이 있어도, Then 해당 계정의 이미지 프리페치는 스킵된다(네트워크 요청 0건, 다른 계정 처리는 정상 계속).

## F. vitest — 순수 로직

- [ ] **TC-IMG-F1** If URL의 hostname이 `127.0.0.1`/`10.x`/`172.16-31.x`/`192.168.x`/`169.254.x`/`::1`/`fc00::/7` 중 하나면, When `isPrefetchableUrl`을 호출하면, Then `false`를 반환한다. 공인 IP/도메인이면 `true`.
- [ ] **TC-IMG-F2** If 3xx 리다이렉트가 사설 IP로 향하면, When 라이브 fetch가 리다이렉트를 따라가려 하면, Then 그 hop에서 가드가 재적용되어 요청이 중단된다.
- [ ] **TC-IMG-F3** If `Content-Type`이 `image/*`가 아니거나 응답이 5MB를 넘으면, When 라이브 fetch 중이면, Then 즉시 abort되고 캐시에 기록되지 않는다.
- [ ] **TC-IMG-F4** If 캐시 메타데이터 목록에 `fetched_at`이 섞여 있으면, When `pruneCache(maxBytes)`를 호출하면, Then 오래된 순으로 정확히 상한을 만족할 때까지만 삭제된다(과삭제 없음).

## G. 회귀 게이트

- [ ] **TC-IMG-G1** 기존 TC-IMG-A1~A3(email-body-images 버그수정 시 신설된 원격 이미지 게이트 노출/동의 전 요청 0건/동의 후 실제 로드) 전부 무회귀.
- [ ] **TC-IMG-G2** 전체 E2E 스위트 무회귀 — 0 FAIL + SKIP 집합 ⊆ 캐논(`run-tc.mjs` `CANON_SKIPS` 8종).
