# remote-image-prefetch — Feature PRD

> 2026-07-19 · Goal 1 산출물. 설계: 브레인스토밍 확정([설계 스펙](../../superpowers/specs/2026-07-19-remote-image-prefetch-design.md)) — 사용자 확정: 목표 수준=**로컬 프리페치**(진짜 익명 프록시 미채택) / 프리페치 범위=**동기화된 전체 받은편지**(unread count 순증 훅 재사용) / 백필=**신규 메일부터만** / 토글 위치=**Command Palette** / 토글 기본값=**on**.
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · post-release, `email-body-images` 버그수정 직후 신규 feature.

## 1. 배경 / 목표

같은 날 앞서 고친 `email-body-images` 버그수정으로 `cid:` 인라인 이미지는 항상 자동 로드되지만, 원격 `https:`/`http:` 이미지는 여전히 "Load remote images" 버튼을 눌러야 보인다(`allowImages` 게이트, 트래킹 픽셀 방어). 사용자가 이 클릭 자체를 없애고 Superhuman/Gmail 웹처럼 즉시 로드를 원했다. 조사 결과 그 클라이언트들의 무클릭 로드는 자체 호스팅 프록시(공유 IP, 비동기 프리페치로 시점 분리)에서 나오는 것으로 확인됐고, 백엔드가 없는 로컬 Electron 앱인 ZenMail은 완전히 동일한 익명성을 재현할 수 없다.

이번 feature는 로컬에서 가능한 최대치로 설계한다: 메일 동기화 시점(unread count가 순증해 상세조회가 이미 일어나는 지점)에 본문의 원격 이미지를 백그라운드로 미리 받아 계정별 디스크 캐시에 저장한다. 스레드를 열면 캐시에서 즉시 data URI로 치환되어 보이므로 클릭이 필요 없다. 실제 IP 노출 자체는 남지만("본인이 읽었다"는 사실은 여전히 발신자에게 전달됨 — Gmail 웹 기본값과 동일한 트레이드오프), 정확한 열람 시각은 동기화 시점과 분리된다. 프라이버시를 중시하는 사용자를 위해 Command Palette에 on/off 토글을 두어 끄면 기존 클릭-게이트 동작으로 완전히 복귀한다.

## 2. 사용자 스토리

### US1. 무클릭 로드
- 사용자로서, 이미 동기화된 메일을 열면 원격 이미지(뉴스레터 로고, 알림 아이콘 등)가 버튼을 누르지 않아도 바로 보이길 원한다.
- 사용자로서, 이미지가 아직 캐시에 없는(오프라인 중 도착 등) 드문 경우에도 결과적으로는 자동 로드되길 원한다(약간의 지연은 허용).

### US2. 프라이버시 선택권
- 사용자로서, 트래킹 픽셀 노출을 원치 않으면 Command Palette에서 자동 로드를 끄고 기존처럼 클릭해서만 이미지를 볼 수 있길 원한다.
- 사용자로서, 토글을 꺼도 이미 캐시에 저장된 이미지가 사라지거나 앱이 깨지지 않길 원한다(단순 기본값 전환).

### US3. 안전한 자동 요청
- 사용자로서(암묵적), 피싱 메일이 내 홈 네트워크 장비나 클라우드 메타데이터 엔드포인트를 가리키는 이미지 URL을 심어놔도 앱이 자동으로 그곳에 요청을 보내지 않길 원한다.
- 사용자로서, 거대한 이미지나 이미지가 아닌 응답으로 디스크가 무한정 채워지지 않길 원한다.

## 3. 기능 요구사항 (FR)

### 이미지 캐시 모듈 (`src/main/image-cache.ts`, 신규)
- **FR1**: `isPrefetchableUrl(url)` — `http:`/`https:` 스킴만 허용하고, hostname이 사설/루프백/링크-로컬 대역(`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7` 등)이면 거부한다.
- **FR2**: `getCachedOrFetch(accountId, url, { fetchLive })` — sqlite `image_cache` 메타데이터로 캐시 hit 여부를 조회, hit면 디스크에서 읽어 data URI로 반환. miss + `fetchLive`가 true면 그 자리에서 라이브 fetch 후 캐시에 기록하고 반환. miss + `fetchLive`가 false면 `{ error }` 반환.
- **FR3**: 라이브 fetch는 `Content-Type: image/*`가 아니거나 5MB를 초과하면 즉시 abort한다. 리다이렉트는 최대 3회 허용하고 **매 hop마다 FR1의 가드를 재적용**한다(리다이렉트로 사설망 우회 방지). 타임아웃 8초.
- **FR4**: `prefetch(accountId, urls)` — 여러 URL을 병렬로 `getCachedOrFetch(..., { fetchLive: true })` 호출하되, 개별 실패는 조용히 스킵(throw하지 않음, 콘솔 로그만).
- **FR5**: `pruneCache(accountId, maxBytes)` — 계정별 캐시 디렉터리 총 용량이 상한(기본 200MB)을 넘으면 `fetched_at` 오름차순(LRU)으로 삭제해 상한 아래로 맞춘다.
- **FR6**: 캐시 파일은 `userData/image-cache/<accountSlug>/<sha256(url)>`에 저장하고, sqlite `image_cache` 테이블(`AccountCache`, 계정별 DB)에 `{url_hash, mime_type, byte_size, fetched_at}` 메타데이터를 기록한다.

### 동기화 연동 (`src/main/snooze.ts`)
- **FR7**: 60초 데몬 틱에서 계정별 unread count가 순증해 `diffNewUnread`가 신규 스레드를 골라내는 지점(new-mail-alerts D8 훅)에, 그 신규 스레드마다 `provider.getThread(threadId)`를 **추가로** 호출해 `bodyHtml`을 확보한다(D6 — 기존 `listThreads` 알림용 fetch는 `ThreadSummary`만 반환해 `bodyHtml`이 없으므로 재사용 불가, 새 API 호출로 정정).
- **FR8**: 각 메시지의 `bodyHtml`에서 원격 `<img src="https?:...">` URL을 정규식으로 추출해 `prefetch(accountId, urls)`를 호출한다(main 프로세스에는 DOMParser가 없음; renderer의 기존 DOM 기반 추출과는 별도 구현이며, 정규식 과매칭은 무해 — 실패는 조용히 스킵되므로). `getThread` 자체의 실패는 배지 갱신을 막지 않도록 try/catch로 격리한다.
- **FR9**: 오프라인 상태인 계정의 틱에서는 프리페치를 건너뛴다(기존 온라인/오프라인 감지 D9 재사용).
- **FR10**: 프리페치는 계정별 try/catch로 격리한다 — 한 계정의 실패가 다른 계정 처리나 데몬 틱 자체를 막지 않는다(기존 배지 로직과 동일 원칙).

### IPC 4-파일 계약
- **FR11**: `mail:get-remote-image(accountId, url)` 핸들러 — `image-cache.getCachedOrFetch(accountId, url, { fetchLive: autoLoadRemoteImages 전역 설정 })` 호출 후 `{ dataUri, mimeType } | { error }` 반환.
- **FR12**: `types.ts`(`ZenmailApi.getRemoteImage`) · `ipc.ts`(핸들러) · `preload.ts`(메서드 노출)의 3-파일 계약으로 배선한다(accountId 첫 인자 관례 준수. `gmail.ts` provider 변경은 불필요 — Gmail API가 아닌 임의 URL을 다루므로).
- **FR13**: 전역 설정 `autoLoadRemoteImages: boolean`(기본 `true`)을 `getGlobalSetting`/`setGlobalSetting`(theme과 동일 패턴)으로 persist한다.

### renderer
- **FR14**: `ThreadView.tsx`의 `allowImages`/`hasRemoteImages`/"Load remote images" 버튼 로직을 제거한다. `MessageCard`는 mount 시 전역 설정 `autoLoadRemoteImages`가 true면 본문의 원격 `<img src>` 전체(DOM 기반 추출, 기존 sanitize 파이프라인 재사용)를 `getRemoteImage` IPC로 병렬 요청해 `remoteImages: Map<url, dataUri>` state를 채운다.
- **FR15**: `prepareHtml()`에서 `cid:` 치환과 병렬로, `remoteImages`에 대응 데이터가 있는 `<img src="https?:...">`를 data URI로 치환한다. 매칭 실패(캐시 miss + fetchLive false)는 원본 `src`를 그대로 두되, **iframe 메타 CSP의 `img-src`는 항상 `data:`만 허용**한다 — `https:`/`http:` 스킴을 iframe에 절대 노출하지 않으므로 매칭 실패 시 이미지는 단순히 안 보인다(기존처럼 CSP 위반 네트워크 시도가 없다).
- **FR16**: 전역 설정이 false(사용자가 끈 경우)면 `autoLoadRemoteImages`를 컴포넌트 로컬 `allowImages` state의 초기값으로 사용해 기존 게이트 버튼 UI를 그대로 노출한다(회귀 없는 완전한 fallback).
- **FR17**: `CommandPalette.tsx`에 "Load remote images automatically" on/off 액션을 `toggleTheme`과 동일한 자리에 추가한다. `useMailStore`에 `autoLoadRemoteImages` 필드 + `toggleAutoLoadRemoteImages`(setGlobalSetting persist)를 추가한다.

### 데모 모드 & E2E 지원
- **FR18**: 기존 `ZENMAIL_DEMO_REMOTE_IMG` 게이트 데모 시드(`demo_img_1`)와 하네스 로컬 이미지 서버를 그대로 프리페치 대상으로 재사용한다.
- **FR19**: `--zenmail-e2e` 게이트 안에 사설 IP를 가리키는 fixture URL(SSRF 차단 검증용, 실제 요청이 나가면 안 됨) + 캐시 디렉터리 오버라이드(`__debugSetImageCacheDir`, 실 `userData` 오염 방지) 훅을 추가한다.

## 4. 비기능 요구사항 (NFR)

- **NFR1 (신규 npm 의존성 0)**: 이미지 fetch는 Node/Electron 내장 `fetch`(Electron 33 기준 Node 20+ 전역 fetch)만 사용, 신규 의존성을 추가하지 않는다.
- **NFR2 (No AI)**: v1 No AI 원칙 준수 — 프리페치·캐싱·SSRF 가드는 전부 결정적 규칙이며 AI 분석을 포함하지 않는다.
- **NFR3 (SSRF 방어 필수)**: FR1/FR3의 사설망 차단·리다이렉트 재검증·크기/타입/타임아웃 제한 없이는 이 feature를 출하하지 않는다 — 기존엔 사용자 클릭이 방어선이었으나 이제 자동 발화되므로 공격 표면이 늘어난다.
- **NFR4 (프라이버시 기본값 전환의 가역성)**: `autoLoadRemoteImages` 토글은 언제든 껐다 켤 수 있어야 하며, 꺼짐 상태는 기존 `allowImages` 클릭-게이트 동작과 완전히 동일해야 한다(회귀 없음).
- **NFR5 (캐시 용량 상한)**: 계정별 디스크 캐시는 200MB를 넘지 않도록 LRU prune한다(FR5). 무제한 증식 금지.
- **NFR6 (데모 모드 동작)**: 실계정 OAuth 없이도 `MockGmailProvider`+하네스 로컬 이미지 서버로 프리페치·즉시 로드·SSRF 차단 3가지가 전부 데모에서 검증 가능해야 한다.
- **NFR7 (무회귀)**: 기존 E2E 캐논 SKIP 집합(`run-tc.mjs` `CANON_SKIPS`, 현재 8종: A4·D5·D8·SY-C3·SA-B4·SY-B2·UNDO-B1·LBL-A5)이 그대로 유지되어야 한다(0 FAIL + SKIP 집합 ⊆ 캐논, 정확한 PASS 총계는 Goal 7 실행 시점 실측).

## 5. 범위 밖 (명시)

설계 스펙 §범위 밖 그대로:

- 진짜 익명 프록시(공유 IP 호스팅 백엔드) — 인프라 비용이 프로젝트 규모에 안 맞음, 브레인스토밍에서 명시적으로 기각.
- 과거 메일 소급 백필 — 기능을 켠 시점 이전 동기화된 메일은 열람 시점 즉석 fetch(그 이후로는 캐시돼 즉시 로드).
- 범용 Settings 패널 신설 — 토글은 기존 Command Palette에 얹는다.
- 비-이미지 원격 리소스(외부 폰트 등) — 기존 CSP `default-src 'none'`으로 계속 전부 차단.
- 계정 간 캐시 공유 — 계정별 완전 격리, 계정 삭제 시 캐시도 함께 정리.

## 6. 성공 기준

1. 신규 도착 메일을 동기화 tick이 처리한 뒤 스레드를 열면, 원격 이미지가 "Load remote images" 클릭 없이 즉시 보인다(`img[src^="data:"]`).
2. 사설 IP/링크-로컬을 가리키는 fixture URL은 프리페치 대상이어도 실제 네트워크 요청이 발생하지 않는다(SSRF 차단 E2E 검증).
3. Command Palette에서 토글을 끄면 기존 "Load remote images" 게이트 버튼이 다시 노출되고, 클릭 전에는 네트워크 요청이 0건이다(기존 TC-IMG-A2 동작 완전 보존).
4. 계정별 캐시가 200MB 상한을 넘으면 가장 오래된 항목부터 삭제된다.
5. 신규 TC-IMG-B* E2E 전부 통과 + 기존 E2E 무회귀(NFR7) + vitest(`image-cache.ts` 순수 로직: SSRF 가드, prune 정렬) + tsc clean.
