# 원격 이미지 자동 로드 (remote-image-prefetch) — 설계 스펙

> 2026-07-19 브레인스토밍 확정. `email-body-images` 버그수정(같은 날) 직후 사용자 요청 "load images
> 버튼을 클릭하지 않고도 바로 이미지가 보이게 할 수는 없어?"로 시작.
> 사용자 확정 5건: 목표 수준=**로컬 프리페치**(진짜 익명 프록시=호스팅 서버 필요, 미채택) / 프리페치
> 범위=**동기화된 전체 받은편지**(Gmail 기본값과 동일, 안 읽은 메일도 트래킹 픽셀 발화됨을 감안하고 채택)
> / 백필=**신규 메일부터만**(과거 메일 소급 없음) / 토글 위치=**Command Palette**(theme와 동일 패턴) /
> 토글 기본값=**on, 설정에서 off 가능**.

## 배경

`email-body-images` 버그수정(같은 날 앞선 커밋)으로 `cid:` 인라인 이미지는 항상 자동 로드되지만,
원격 `https:`/`http:` 이미지는 여전히 "Load remote images" 버튼을 눌러야 보인다(`allowImages`
게이트, 트래킹 픽셀 방어). 사용자가 이 클릭을 없애고 싶어했고, Superhuman/Gmail 웹처럼 즉시 보이길
원함. 조사 결과 Superhuman의 무클릭 로드는 **자체 호스팅 프록시 서버**(공유 IP, 비동기 프리페치로
열람 시점과 요청 시점 분리)에서 나오는 것으로 확인됨 — ZenMail은 백엔드가 없는 로컬 Electron
앱이므로 완전히 동일한 익명성은 재현 불가. 대신 **로컬에서 가능한 최대치**로 설계: 메일 동기화
시점에 백그라운드로 이미지를 미리 받아 디스크에 캐시해두면, 실제 IP 노출은 남지만("사용자 본인이
읽었다"는 사실 자체는 여전히 발신자에게 전달됨, Gmail 웹 기본값과 동일한 트레이드오프) 최소한
"정확히 언제 열었는지"는 동기화 시점과 분리된다.

## 목적

1. 원격 `https:`/`http:` 인라인 이미지가 스레드를 열면 **클릭 없이 즉시** 보인다(이미 동기화된
   메일이라면 거의 항상 캐시 hit).
2. 트래킹 픽셀 노출을 원치 않는 사용자를 위해 Command Palette에 on/off 토글 제공(끄면 기존
   "Load remote images" 클릭-게이트 동작으로 복귀).
3. 자동 fetch가 사설 네트워크를 향하지 않도록(SSRF) 안전장치를 갖춘다 — 지금까지는 사용자의 명시적
   클릭 한 번이 방어선이었지만, 이제 도착하는 모든 메일에 대해 자동으로 발화되므로 공격 표면이
   커진다.

## 범위 밖 (명시)

- **진짜 익명 프록시**(공유 IP로 이미지를 릴레이하는 호스팅 백엔드) — 인프라 구축/운영 비용이 이
  프로젝트(미니멀 로컬 Electron 앱) 규모에 맞지 않음. 브레인스토밍에서 사용자가 명시적으로 기각.
- **과거 메일 소급 백필** — 기능을 켠 시점 이전에 이미 동기화된 메일은 여전히 클릭 게이트로 남음
  (열 때 즉석 fetch, 이후엔 그 결과가 캐시돼 다음부터는 즉시 로드). 수년치 백필의 대역폭/시간
  비용을 v1 범위에서 제외.
- **범용 Settings 패널 신설** — 토글 하나 때문에 새 UI 서페이스를 만들지 않고 기존 Command
  Palette(theme 토글과 동일 패턴)에 얹는다.
- **비-이미지 원격 리소스**(외부 폰트, iframe 등) — 기존에도 CSP `default-src 'none'`으로 전부
  차단 중이며 이번 범위 밖.
- **계정별 캐시 공유/이관** — 캐시는 계정별 디렉터리로 완전히 격리, 계정 삭제 시 캐시도 함께 정리.

## 아키텍처

```
동기화 tick (snooze.ts, 60s 데몬)
  └─ 계정별 unread count가 순증해 `diffNewUnread`가 신규 스레드를 골라내는 지점(new-mail-alerts
     D8 훅) — ⚠️ 정정: 그 지점의 기존 `listThreads` 호출은 알림용 `ThreadSummary[]`만 반환하고
     bodyHtml이 없다. 신규 스레드마다 `provider.getThread(threadId)`를 **추가로** 호출해
     bodyHtml을 확보한다(D6, 신규 API 콜이지만 "카운트가 오를 때만"이라는 기존과 동일한 상한선 안)
       └─ 각 메시지 bodyHtml을 정규식으로 스캔해 remote <img src="https?:..."> URL 추출(main
          프로세스에는 DOMParser가 없음 — renderer의 DOM 기반 추출과는 별도 구현, 정규식이
          과매칭해도 무해: fetch 실패는 조용히 스킵되므로 오탐의 비용이 낮음)
            └─ imageCache.prefetch(accountId, url)  [신규: src/main/image-cache.ts]
                 ├─ SSRF 가드 통과 확인 (아래 "보안" 절)
                 ├─ fetch(url, { signal: timeout(8s) })
                 ├─ Content-Type이 image/*가 아니거나 5MB 초과 시 중단
                 └─ userData/image-cache/<accountSlug>/<sha256(url)>에 바이트 저장
                      + sqlite `image_cache` 테이블에 {urlHash, mimeType, byteSize, fetchedAt} 기록

스레드 열람 (ThreadView MessageCard 마운트)
  └─ renderer: message.bodyHtml에서 remote <img src> 목록 추출(REMOTE_IMG_RE 확장 재사용)
       └─ IPC `mail:get-remote-image(accountId, url)` 호출(cid: fetchAttachmentImage와 동일한
          model)
            └─ main: 캐시 hit → 파일 읽어 data URI 반환 (프리페치 덕에 거의 항상 hit)
                     캐시 miss(오프라인 중 도착 등) → autoLoadImages 토글 on이면 그 자리에서 즉시
                     fetch(=현재 "Load remote images" 클릭과 동일한 라이브 요청, 단 자동 발생) →
                     캐시에 채워넣고 반환. 토글 off면 miss를 그대로 반환(기존 게이트 버튼 노출)
       └─ renderer: cid 치환과 동일한 패턴으로 <img src>를 data: URI로 교체.
          **iframe 메타 CSP의 img-src는 계속 `data:`만 허용** — https:/http: 스킴은 이제
          영구적으로 iframe에 노출되지 않는다(기존엔 게이트 통과 시 img-src에 https:/http:를
          더했지만, 이 설계는 그 확장 자체를 없애 구조적으로 더 안전해짐).
```

**주의**: 데몬이 매 틱 프리페치하는 건 "unread count가 순증해 상세조회가 실제로 일어난" 스레드뿐이다
(기존 배지 로직이 이미 그 조건에서만 상세를 가져오므로 별도 트리거를 새로 만들지 않는다). 사용자가
직접 브라우징만 하고 unread count는 그대로인 스레드(예: 이미 읽은 스레드를 다시 열람)는 데몬
프리페치 대상이 아니다 — 다만 그런 스레드를 열면 여느 때처럼 열람 시점 캐시 miss → (토글 on이면)
즉석 fetch → 캐시 저장이 일어나므로, 두 번째 열람부터는 즉시 로드된다(cid: 캐시가 컴포넌트 unmount
시 날아가는 것과 달리, 이 캐시는 디스크에 영속되므로 영구적으로 즉시 로드 상태를 유지한다).

### `src/main/image-cache.ts` (신규)

```ts
interface ImageFetchResult { dataUri: string; mimeType: string }

export function isPrefetchableUrl(url: string): boolean            // 스킴/사설 IP 가드
export async function getCachedOrFetch(
  accountId: string, url: string, opts: { fetchLive: boolean }
): Promise<ImageFetchResult | { error: string }>
export async function prefetch(accountId: string, urls: string[]): Promise<void>  // 실패는 조용히 스킵(로그만)
export function cacheDirFor(accountId: string): string             // userData/image-cache/<slug>/
export function pruneCache(accountId: string, maxBytes: number): void  // LRU, 200MB 기본 상한
```

- `isPrefetchableUrl`: `http(s):`만 허용, hostname을 DNS 조회 없이(SSRF TOCTOU 방지 위해 실제
  connect 단계에서 IP도 재검증) `127.0.0.0/8`·`10.0.0.0/8`·`172.16.0.0/12`·`192.168.0.0/16`·
  `169.254.0.0/16`(link-local, 클라우드 메타데이터 엔드포인트 포함)·`::1`/`fc00::/7` 등을 차단.
  redirect는 최대 3회, **매 hop마다 동일 가드를 재적용**(첫 URL만 검사하고 리다이렉트로 우회하는
  취약점 방지).
- `getCachedOrFetch`: `mail:get-remote-image` IPC 핸들러가 그대로 호출하는 단일 진입점 — 캐시
  조회 → (옵션에 따라) 라이브 fetch → 캐시 기록까지 원자적으로 처리.
- `prefetch`: snooze.ts 틱에서 fire-and-forget으로 호출(기존 배지 로직처럼 계정별 try/catch 격리
  — 한 계정의 프리페치 실패가 다른 계정/틱 자체를 막지 않음).

### sqlite 스키마 (`cache.ts`, `AccountCache`에 테이블 추가)

```sql
CREATE TABLE IF NOT EXISTS image_cache (
  url_hash TEXT PRIMARY KEY,   -- sha256(url), 파일명과 동일
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL  -- LRU pruning 기준
);
```

바이트 자체는 sqlite가 아니라 디스크 파일로 저장(attachments D5의 "바이트는 sqlite 무저장" 원칙과
결이 다르지만 — attachments는 "캐시 자체를 안 함"이 목적이었고, 이 feature는 "캐시가 핵심 목적"이라
정반대. sqlite에는 조회/prune용 메타데이터만).

### `src/shared/types.ts` / `ipc.ts` / `preload.ts`

기존 attachments IPC 4파일 계약과 동일한 모양:

```ts
getRemoteImage(accountId, url): Promise<{ dataUri: string; mimeType: string } | { error: string }>
```

전역 설정(theme과 동일 패턴, `getGlobalSetting`/`setGlobalSetting`):

```ts
autoLoadRemoteImages: boolean  // 기본 true
```

## UI (renderer)

### `ThreadView.tsx`

- `hasRemoteImages`/`allowImages`/"Load remote images" 버튼 로직 제거. 대신 `cid:` 치환과 병렬로
  동작하는 `remoteImages: Map<url, dataUri>` 상태 추가 — mount 시 `autoLoadRemoteImages` 전역
  설정이 true면 본문의 remote `<img src>` 전부를 `getRemoteImage` IPC로 병렬 요청(캐시 hit라
  체감 지연 거의 없음).
- 전역 설정이 false면 기존과 동일하게 게이트 버튼을 그대로 노출(현행 동작 완전 보존 — 이 설계는
  "기본값 전환"이지 "기능 삭제"가 아님).
- 캐시 miss로 라이브 fetch가 실제로 일어난 극히 드문 경우도 사용자에게는 그냥 "약간 늦게 뜨는
  이미지"로 보일 뿐, 별도 로딩 UI 불요(cid 패턴과 동일하게 YAGNI).

### `CommandPalette.tsx`

- `toggleTheme`과 동일한 자리에 "Load remote images automatically" on/off 액션 추가. 상태는
  `useMailStore`에 `autoLoadRemoteImages` 필드로 노출(부팅 시 `getGlobalSetting` 읽기, 토글 시
  `setGlobalSetting` 즉시 persist — theme 로직 그대로 복제).

## 보안 (SSRF 방어 — 필수 요건)

지금까지는 "Load remote images" 클릭이 곧 사용자의 명시적 동의였고, 발생 빈도도 사용자가 실제로
그 메일을 열었을 때 한정이었다. 이 설계는 **도착하는 모든 메일**에 대해 main 프로세스가 자동으로
메일 속 URL에 요청을 보내므로, 피싱 메일이 사설 IP·클라우드 메타데이터 엔드포인트
(`169.254.169.254` 등)·localhost 서비스를 가리키게 해서 사용자의 홈/사내 네트워크를 스캔하거나
내부 서비스를 건드리는 SSRF 공격 표면이 새로 생긴다. 필수 방어:

1. 스킴은 `http:`/`https:`만, hostname이 사설/루프백/링크-로컬 범위면 차단(리다이렉트 매 hop 재검증).
2. `Content-Type: image/*`가 아니면 즉시 중단(응답 바디를 image 파서에 넘기지 않음).
3. 응답 크기 5MB 상한(스트리밍 중 초과 시 즉시 abort) — 첨부 폭탄으로 디스크 채우기 방지.
4. 요청당 8초 타임아웃, 리다이렉트 최대 3회.
5. 계정별 캐시 디렉터리 200MB 상한 도달 시 LRU prune(무제한 디스크 증식 방지).

## 에러·오프라인 정책

- 프리페치 실패(네트워크 오류, SSRF 차단, 크기/타입 초과): 조용히 스킵, 콘솔 로그만 — 사용자에게
  실패를 알리지 않음(어차피 게이트가 없으면 열람 시 캐시 miss → 토글 on이면 자동 재시도되므로
  self-healing).
- 오프라인 상태에서의 프리페치: snooze.ts의 기존 온라인/오프라인 감지(D9)를 그대로 재사용 — 오프라인
  틱은 프리페치도 건너뜀.
- 열람 시점 캐시 miss + 토글 off: 기존 게이트 버튼으로 fallback(회귀 없음).

## 데모 모드 & E2E

- `ZENMAIL_DEMO_REMOTE_IMG` 게이트 데모 시드(`demo_img_1`)를 재사용 — 하네스 로컬 이미지 서버가
  이미 있으므로 그대로 prefetch 대상으로 활용 가능.
- E2E 검증 대상(TC-IMG-B*, 기존 TC-IMG-A1~A3에 추가):
  - 신규 메일 도착(동기화 tick) 후 스레드를 열면 클릭 없이 즉시 이미지가 보임(`img[src^="data:"]`).
  - 프리페치가 사설 IP를 가리키는 fixture URL에는 네트워크 요청 자체를 만들지 않음(SSRF 차단 검증).
  - 토글 off 시 기존 "Load remote images" 버튼 노출 + 클릭 전 네트워크 요청 0건(TC-IMG-A2 회귀
    없음 확인).
  - 캐시 200MB 상한 도달 시 가장 오래된 항목부터 삭제(LRU prune 단위 테스트, E2E는 sqlite 카운트만
    검증).

## 프로세스

DEV_WORKFLOW Goal 0~8 준수: 이 스펙 승인(완료) → feature PRD
(`docs/features/remote-image-prefetch/PRD.md`) → checkpoint TODO → If-When-Then TC → DECISIONS
(로컬 프리페치 vs 진짜 프록시, 전체 받은편지 vs 뷰포트, 신규-only 백필, Command Palette 토글 위치,
SSRF 가드 상세) → react-best-practices → impeccable audit → E2E 전부 통과 → Obsidian 기록.
