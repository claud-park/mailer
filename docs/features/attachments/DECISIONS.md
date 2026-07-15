# attachments — DECISIONS

> Goal 4 산출물. 브레인스토밍 확정([설계 스펙](../../superpowers/specs/2026-07-15-attachments-design.md))에서 사용자 확정 항목(D1~D3)과, 스펙 구현 세부를 다루는 추천안(D4~D9)으로 구성.

## D1. 표시 범위 = 본문 인라인 이미지(cid:)까지 렌더링 — **사용자 확정**
- **컨텍스트**: "이미지 attached to email"의 범위를 어디까지 볼지 결정 필요 — 본문에 박힌 인라인(`cid:`) 이미지까지 제대로 렌더링할지, 아니면 첨부 목록에 이미지도 포함되어 아이콘으로만 보이면 충분한지.
- **선택지**: (a) 본문 내 인라인 이미지까지 렌더링(렌더링 대상에 포함, `cid:` 해석 필요), (b) 첨부 목록에 아이콘으로만 노출(본문 인라인은 깨진 채 방치).
- **선택**: (a) 본문 내 인라인 이미지까지.
- **이유**: 서명 로고·인라인 스크린샷이 깨진 아이콘으로 남으면 메일이 "덜 완성된" 느낌을 주고, Superhuman/Apple Mail 대비 체감 품질이 크게 떨어진다. `cid:` 해석은 `getAttachment` 한 번으로 data URI 치환이 가능해 구현 비용 대비 체감 개선이 크다. 아이콘만 노출(b)은 인라인 이미지가 첨부 목록에 중복으로 뜨는 부작용(같은 로고가 본문+목록 양쪽)을 만들어 오히려 지저분하다.

## D2. 첨부 목록 이미지 = 썸네일 미리보기(클릭 시 확대) — **사용자 확정**
- **컨텍스트**: 첨부 목록에서 이미지 파일을 어떻게 보여줄지 — 작은 썸네일 미리보기로 보여줄지, 확장자 아이콘만 보여줄지.
- **선택지**: (a) 썸네일 미리보기 + 클릭 시 라이트박스 확대, (b) mimetype 아이콘만(다운로드해야 내용 확인 가능).
- **선택**: (a) 썸네일 미리보기.
- **이유**: 이미지 첨부는 "무엇인지"가 파일명만으로는 잘 안 보인다 — 썸네일이 있으면 다운로드 없이 즉시 식별된다. 첨부 개수가 적어(메시지당 수 개) 상시 병렬 fetch해도 부담이 없고, lazy-on-scroll 같은 최적화는 YAGNI다. 라이트박스 확대는 기존 SnoozePicker/AgendaPanel 오버레이 템플릿을 그대로 재사용해 구현 비용이 낮다. 비이미지(PDF 등)는 썸네일 생성 비용/복잡도가 크고 No AI 경계와도 얽혀(렌더링 엔진 필요) 아이콘 + 다운로드로 남긴다.

## D3. 다운로드 = 바로 다운로드 폴더로 저장(Save-As 다이얼로그 없음) — **사용자 확정**
- **컨텍스트**: 다운로드 방식 — 바로 OS 다운로드 폴더에 저장할지, 매번 저장 위치를 고르는 Save-As 다이얼로그를 띄울지.
- **선택지**: (a) 다운로드 폴더로 즉시 저장(다이얼로그 없음, 충돌 시 자동 리네임), (b) `dialog.showSaveDialog`로 매번 경로 선택.
- **선택**: (a) 즉시 저장.
- **이유**: ZenMail의 정체성은 "빠른 키보드 중심 워크플로우"다. 다운로드마다 모달 다이얼로그가 뜨면 흐름이 끊긴다 — 대부분의 사용자는 첨부를 다운로드 폴더에 받고 거기서 처리한다(Chrome/Gmail 웹 기본 동작과 동일). 경로 선택이 필요한 소수 케이스는 다운로드 폴더에서 옮기면 되므로, 즉시 저장 + 충돌 시 안전 리네임(`foo (1).pdf`)이 최적의 기본값이다. 이 결정은 main에 파일 저장 IPC 패턴을 처음 도입하게 한다(FR6, D8 참조).

## D4. 인라인 vs 목록 분리 기준 = `inline` 플래그(Content-Disposition:inline + Content-ID) — 추천안
- **컨텍스트**: 한 이미지가 본문에 인라인으로 박히면서 동시에 첨부 파트이기도 하다. 이것을 본문에서 렌더할지, 첨부 스트립에 나열할지, 둘 다 할지 결정 필요.
- **선택지**: (a) `inline` 플래그로 이분 — `inline: true`(본문 cid 참조)면 본문에서만 렌더하고 스트립에서 제외, `inline: false`면 스트립에만 노출, (b) 모든 첨부를 스트립에 나열하고 본문 인라인은 별도 처리(중복 허용), (c) 파일명 유무로만 판정.
- **선택**: (a) `inline` 플래그 이분.
- **이유**: 같은 이미지를 본문+스트립 양쪽에 노출하면(b) 중복으로 지저분하다 — Gmail/Apple Mail도 본문에 인라인된 이미지는 첨부 목록에서 뺀다. 판정 기준은 `Content-Disposition: inline` + `Content-ID` 헤더 존재로, MIME 스펙상 인라인 참조의 정확한 시그널이다(파일명 유무(c)는 인라인 이미지도 filename을 가질 수 있어 오분류). 이 규칙은 `extractAttachments` 순수 함수에 집약해 vitest로 결정적으로 검증한다(TC-ATT-F1).

## D5. 첨부 바이트 무캐시(sqlite 제외, 매 요청 fresh fetch) — 추천안
- **컨텍스트**: 첨부 바이트를 로컬 sqlite에 캐시해 재열람을 빠르게 할지 결정 필요. F6 sync-engine은 메타데이터·스레드 detail을 sqlite에 캐시한다.
- **선택지**: (a) 바이트 무캐시 — `getAttachmentImage`/`downloadAttachment` 매 호출 fresh fetch, in-memory(컴포넌트 state) 세션 한정만, (b) sqlite BLOB 캐시 — 한 번 받은 첨부 바이트를 계정 DB에 저장해 재사용.
- **선택**: (a) 무캐시.
- **이유**: F6의 캐시 원칙은 명시적으로 "메타데이터는 로컬 우선 캐시, 바이트는 캐시 제외"다 — 첨부 바이트는 크고(이미지·PDF 수 MB), sqlite에 쌓으면 DB 파일이 급격히 비대해지며 계정 제거 시 정리 부담도 커진다. 재열람 성능은 로컬 IPC + Gmail 응답이 충분히 빨라 체감 문제가 없고, 인라인/썸네일은 컴포넌트 마운트 동안 in-memory Map으로 유지되므로 같은 스레드를 보는 동안엔 재fetch도 없다. 메타데이터(`AttachmentInfo`)는 `MessageDetail`의 일부로 기존 detail 캐시를 그대로 타므로 별도 캐시 신설이 불필요하다(NFR4).

## D6. eager fetch는 이미지 mimetype 첨부에만 — 추천안
- **컨텍스트**: 스레드를 열 때 어떤 첨부를 자동으로 미리 가져올지 결정 필요. 모든 첨부를 미리 받으면 대역폭·지연이 커진다.
- **선택지**: (a) 이미지 mimetype(`image/*`) 첨부만 eager fetch(인라인 cid 렌더 + 스트립 썸네일), 비이미지(PDF 등)는 다운로드 클릭 시에만 fetch, (b) 모든 첨부 eager fetch, (c) 아무것도 eager fetch 안 함(썸네일도 클릭해야 로드).
- **선택**: (a) 이미지만 eager.
- **이유**: 썸네일/인라인 렌더링은 "보여주기 위해" 반드시 바이트가 필요하지만(그래서 이미지는 eager), PDF·zip 등은 화면에 미리보기하지 않으므로 열자마자 받을 이유가 없다 — 사용자가 다운로드를 누를 때만 받으면 된다(b는 낭비). 아무것도 eager하지 않으면(c) 썸네일이라는 D2 결정의 취지(다운로드 없이 즉시 식별)가 무너진다. mimetype으로 이미지 여부를 판정하는 것은 결정적 규칙이라 No AI 경계와도 맞는다.

## D7. cid: 이미지는 remote-image 프라이버시 게이트를 우회(항상 자동 로드) — 추천안
- **컨텍스트**: ThreadView에는 원격 `https:`/`http:` 이미지를 기본 차단하고 "Load remote images" 클릭 시에만 로드하는 프라이버시 게이트(`allowImages`)가 있다(트래킹 픽셀 방어). cid: 인라인 이미지도 이 게이트를 적용할지 결정 필요.
- **선택지**: (a) cid: 이미지는 게이트 우회 — 항상 자동 로드, 원격(`http(s):`) 이미지 게이트는 그대로 유지, (b) cid: 이미지도 게이트에 편입 — "Load remote images"를 눌러야 인라인 이미지도 표시.
- **선택**: (a) cid: 우회.
- **이유**: remote-image 게이트의 목적은 **발신자가 심은 제3자 트래킹 픽셀**(원격 서버가 열람을 추적)의 차단이다. cid: 바이트는 사용자 본인 Gmail 계정에서 OAuth로 가져오는 데이터라 원격 추적이 발생하지 않는다 — 게이팅할 프라이버시 근거가 없다. cid를 게이트에 묶으면(b) 서명 로고를 보려고 매번 버튼을 눌러야 해 UX만 나빠진다. 구현상으로도 iframe CSP의 `img-src`는 이미 `data:`를 항상 허용하므로(원격은 `allowImages`일 때만 `https: http:` 추가), cid를 data URI로 치환하면 `allowImages` 상태와 무관하게 렌더된다 — CSP 변경 없이 자연스럽게 우회된다.

## D8. Save-As 없음 + 충돌 안전 리네임(`foo (1).pdf`), main 파일 저장 IPC 신규 도입 — 추천안
- **컨텍스트**: D3(즉시 저장)의 구현 세부. main 프로세스에는 아직 사용자 디스크로 파일을 쓰는 IPC 패턴이 전혀 없다(`dialog.showSaveDialog`도, 디스크 쓰기 핸들러도 없음). 다운로드 폴더에 같은 파일명이 이미 있을 때의 처리 필요.
- **선택지**: (a) `app.getPath('downloads')` 고정 + 충돌 시 `foo.pdf`→`foo (1).pdf`→`foo (2).pdf` 자동 리네임(pure `dedupeDownloadPath` 헬퍼로 분리해 vitest), (b) 덮어쓰기(충돌 무시), (c) 충돌 시 Save-As 다이얼로그로 폴백.
- **선택**: (a) 고정 폴더 + 자동 리네임.
- **이유**: 덮어쓰기(b)는 사용자가 이전에 받은 파일을 소리 없이 파괴할 수 있어 위험하다. 충돌 시 다이얼로그 폴백(c)은 D3(다이얼로그 없음)과 모순된다. Chrome/브라우저 다운로드의 표준 동작인 `(1)` 리네임이 가장 안전하고 예측 가능하다. 리네임 로직은 파일 I/O와 분리한 순수 함수(`dedupeDownloadPath(dir, filename)`)로 두어 확장자 유무·다중 충돌을 vitest로 결정적으로 검증한다(TC-ATT-F2). E2E에서는 실제 사용자 Downloads 오염을 막기 위해 `__debugSetDownloadDir`로 임시 폴더를 주입해 저장 경로·리네임을 검증한다(D9).

## D9. E2E는 첨부 실패 1회 주입 + 다운로드 dir 오버라이드 훅으로 결정화 — 추천안
- **컨텍스트**: TC-ATT 에러 케이스(fetch 실패)와 다운로드 케이스(저장 경로·충돌 리네임)를 데모 모드 자동 E2E로 결정적으로 검증해야 한다. 실제 다운로드가 사용자 Downloads를 오염시키면 안 되고, 실패는 결정적으로 재현돼야 한다.
- **선택지**: (a) `MockGmailProvider.failNextAttachmentCall()` one-shot + main `downloadDirOverride`를 `__debug`(`__debugFailNextAttachment`/`__debugSetDownloadDir`, `ZENMAIL_E2E_PORT` 게이트)로 노출, (b) 네트워크/디스크 실제 실패에 의존, (c) 별도 E2E 전용 provider.
- **선택**: (a) `__debug` 훅.
- **이유**: 실제 실패에 의존(b)하면 비결정적이라 무회귀 스위트에 못 넣는다. 별도 provider(c)는 calendar가 이미 확립한 "Mock + `__debug` 게이트" 패턴을 깨는 과설계다. calendar-integration의 `failNextCalendarCall`/`__debugSetCalendarReady`가 확립한 관례를 그대로 따라, 첨부는 `failNextAttachmentCall`(다음 `getAttachment` 1회 throw)과 `downloadDirOverride`(기본 `app.getPath('downloads')`, E2E에서만 임시 폴더로 대체)를 둔다. 두 훅 모두 `ZENMAIL_E2E_PORT`/`--zenmail-e2e` 게이트 안에서만 노출되어 프로덕션 표면적이 0이다.
