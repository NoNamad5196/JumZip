# JumZip

보미·산이·아랑과 한국어로 대화하며 타로·사주·궁합 결과를 보고, 상담 기록을 관리하는 웹앱입니다.

[공개 미리보기](https://jumzip.pages.dev) · [개발 현황](docs/EXECUTION.md) · [검증 항목](docs/acceptance-matrix.md) · [배포 안내](docs/deployment-runbook.md)

## 주요 구현 기능

- **캐릭터 대화:** 캐릭터별 말투, 대화 저장, 응답 대기 표시와 재시도.
- **타로:** 한 장·세 장·관계·선택 타로, 오늘의 카드, 저장된 카드의 해석 재시도.
- **사주·궁합:** 출생정보 기반 원국, 오행·십성·신살, 대운·세운·월운, 두 사람의 사주 비교.
- **기록·내보내기:** 상담과 전체 대화 조회, 제목 수정, 텍스트 복사와 결과 이미지 저장.
- **기억·정보 관리:** 대화 기억의 조회·수정·삭제, 관련 인물과 출생정보 관리, 저장 동의 설정.
- **계정 관리:** 익명 시작, 계정 연결을 위한 화면과 처리, 로그아웃·계정 삭제.

위 목록은 코드에 구현된 범위입니다. 공개 환경에서의 전체 기능 검증 완료를 뜻하지는 않습니다.

## 현재 상태

2026-09-20의 마지막 검증 기록 기준입니다.

| 구분 | 상태 |
|---|---|
| 공개 미리보기 | 기존 프런트엔드가 배포되어 있습니다. 저장소의 최신 화면과 차이가 있습니다. |
| 최근 UI 개선 | 즉시 표시되는 내 메시지, 캐릭터 로딩 말풍선, 모바일 타로 배열, 한국어 줄바꿈 수정은 로컬 검증·빌드를 마쳤으며 공개 업로드 대기 중입니다. |
| 운영 AI | Cloudflare Workers AI의 Qwen / Persona-v4 / Intent-v1을 사용합니다. 최근 확인 요청은 HTTP 429로 중단됐으며 제한의 구체적인 원인은 미확인입니다. |
| 개발 중인 AI 수정본 | 소스의 Persona-v12 / Intent-v6와 별도로 준비한 v4.1 수정본은 아직 운영에 배포하지 않았습니다. |
| 남은 검증 | AI 해석의 의미 정확성, 공개 가입 성공 흐름, Google 계정 연결, 전체 공개 사용자 흐름 검증이 남아 있습니다. |
| 문구 정리 | 화면 문구의 삭제·수정 방향을 검토한 계획 단계입니다. 실제 문구 개편은 아직 적용하지 않았습니다. |

**현재 소스의 Edge Functions 전체를 그대로 운영에 덮어쓰지 마세요.** 서버 수정은 [배포 안내](docs/deployment-runbook.md)의 검증된 릴리스 파일 목록과 적용 범위를 확인한 뒤 진행합니다. 최근 UI 수정과 배포 대기 상태는 [채팅 개선 기록](docs/chat-experience-repair.md), 문구 개편안은 [문구 정리 계획](docs/copy-review-plan.md)에 정리되어 있습니다.

## 기술 구성

| 영역 | 구성 |
|---|---|
| 프런트엔드 | React, TypeScript, Vite, React Router, TanStack Query |
| UI·폼 | CSS/Tailwind, Motion, React Hook Form, Zod |
| 인증·데이터·서버 | Supabase Auth, PostgreSQL, RLS, Edge Functions |
| AI 연결 | OpenAI 호환 API, 응답 구조 검증과 제한된 재시도 |
| 사주 계산 | manseryeok와 채택한 JumZip 제품 규칙 |
| 테스트 | Vitest, Testing Library, Playwright, PGlite 및 별도 통합 검증 |
| 배포 | Cloudflare Pages, Supabase |

## 로컬 실행

개발·CI 재현 기준은 **Node.js 24, pnpm 11.19.0**입니다. `package.json`의 Node 최소 선언은 `>=22.12.0`이며, pnpm 버전은 `packageManager`에 지정되어 있습니다.

```sh
git clone https://github.com/NoNamad5196/JumZip.git
cd JumZip
pnpm install --frozen-lockfile
```

[`.env.example`](.env.example)을 참고해 공개 설정을 `.env.local`에 작성합니다. 이 예제 파일에는 서버 항목도 함께 있으므로 아래 구분에 맞춰 나누어 설정하세요.

| 저장 위치 | 설정 |
|---|---|
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, 로그인 화면 활성화 플래그, AI 제공자 안내용 `VITE_LLM_*` |
| `.env.server.local` 또는 Supabase Secrets | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_STRUCTURED_FORMAT`, `ALLOWED_ORIGINS` 등 서버 전용 설정 |

- `VITE_SUPABASE_ANON_KEY`에는 공개 클라이언트 키를 사용합니다. 서비스 역할 키와 AI API 키에는 `VITE_` 접두사를 붙이지 않습니다.
- `VITE_LLM_*`는 개인정보 안내에 표시할 제공자 정보입니다. 실제 모델 연결은 서버의 `LLM_*` 설정으로 구성합니다.
- Google·이메일 로그인 플래그는 기본 `false`입니다. Supabase에서 실제 공급자 설정을 완료한 뒤 활성화합니다. 플래그만 바꿔서는 로그인이 구성되지 않습니다.
- `.env.local`, `.env.server.local` 등 로컬 환경 파일은 Git에서 제외됩니다.

```sh
pnpm dev
```

기본 개발 주소는 `http://127.0.0.1:5173`입니다. 포트를 바꾸면 Supabase Auth 리디렉션과 서버의 허용 출처도 함께 맞춰야 합니다.

프런트엔드 실행·빌드·기본 단위 테스트에는 Docker가 필요하지 않습니다. 실제 대화와 점술 저장에는 연결된 Supabase와 서버 설정이 필요합니다. 서비스가 연결되지 않았거나 모델 응답에 실패하면 사용할 수 없는 상태 또는 부분 실패를 표시합니다.

### 로컬 백엔드

로컬 Supabase/Auth/DB/Edge를 실행할 때는 Docker Desktop이 필요합니다.

```sh
node node_modules/supabase/dist/supabase.js start
```

로컬 API는 `http://127.0.0.1:54321`, Studio는 `http://127.0.0.1:54323`을 사용합니다. 마이그레이션과 Edge Functions 환경 설정은 [배포·복구 안내](docs/deployment-runbook.md)를 참고하세요. 로컬 통합 검증용 연결 정보는 운영 프로젝트의 연결 정보와 구분해야 합니다.

## 검사와 빌드

```sh
pnpm check
pnpm check:source-secrets
pnpm test:e2e
```

`pnpm check`는 lint, 타입 검사, Vitest, 프로덕션 빌드, 에셋 검사, 공개 번들의 비밀값 검사를 순서대로 실행합니다. 소스 비밀값 검사와 Playwright는 위의 별도 명령으로 실행합니다.

개별 실행 명령은 다음과 같습니다.

| 명령 | 용도 |
|---|---|
| `pnpm dev` | 개발 서버 실행 |
| `pnpm lint` | 정적 코드 검사 |
| `pnpm typecheck` | TypeScript 타입 검사 |
| `pnpm test` | 단위·컴포넌트 등 기본 테스트 |
| `pnpm test:e2e` | 브라우저 회귀 테스트 |
| `pnpm build` | `dist/`에 배포 파일 생성 |
| `pnpm preview` | 생성한 빌드 로컬 확인 |
| `pnpm check:assets` | 정본 에셋 무결성 확인 |

브라우저 테스트는 Windows에서 설치된 Microsoft Edge, 그 외 운영체제에서 Playwright Chromium을 사용합니다. Chromium이 없는 환경에서는 먼저 `pnpm exec playwright install chromium`을 실행합니다. CI의 Linux 환경은 `--with-deps` 옵션으로 시스템 의존성도 설치합니다.

Windows에서 `pnpm exec`가 실행 파일을 찾지 못한다면 Node 진입점을 사용할 수 있습니다.

```sh
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js test
```

기본 브라우저 테스트는 합성 응답을 사용합니다. 통과 여부는 실제 공개 가입·OAuth·AI 응답 품질 검증과 구분합니다. 실제 외부 서비스에 연결하는 검사는 해당 스크립트의 실행 조건과 테스트 데이터 생성·정리 범위를 확인한 뒤 별도로 수행합니다.

## 데이터 처리 원칙

- 타로 카드는 서버의 암호학적 난수로 뽑고, AI 해석 전에 결과를 저장합니다. **해석 재시도는 같은 카드를 사용하며, 새로 뽑기와 구분합니다.**
- 요청 ID와 정규화한 요청 내용의 해시로 네트워크 오류 뒤 중복 메시지·중복 추첨을 방지합니다.
- 사용자 데이터는 RLS로 분리합니다. 핵심 결과를 쓰는 서비스 역할 RPC는 서버의 사용자 인증 뒤 호출합니다.
- 대화 기억과 출생정보 저장은 구분하며, 동의·수정·삭제 상태를 반영합니다.
- 사주 계산 규칙과 미확정 결과의 처리 기준은 [규칙 확정 문서](docs/saju-rule-freeze.md)에 기록합니다. 점술 결과는 참고용으로 제공합니다.

## 프로젝트 구조와 문서

```text
src/                  화면, 컴포넌트, 프런트 서비스, 스타일
supabase/functions/   Edge API, 점술 엔진, 페르소나, AI 연결, 데이터 처리
supabase/migrations/  데이터베이스 변경 이력
public/               캐릭터·타로 에셋, 폰트, 정적 배포 설정
tests/                도메인·서버·UI·브라우저 검증
scripts/              검사, 릴리스 준비, 운영 보조 스크립트
docs/                 구현 현황, 규칙, 검토 계획, 검증 근거
```

| 문서 | 내용 |
|---|---|
| [개발 현황](docs/EXECUTION.md) | 최근 변경, 검증 결과와 남은 작업 |
| [검증 항목](docs/acceptance-matrix.md) | M0–M17 구현 및 완료 판정 근거 |
| [배포·복구 안내](docs/deployment-runbook.md) | 환경 설정, 마이그레이션, 검증된 서버 릴리스 |
| [채팅 개선 기록](docs/chat-experience-repair.md) | 채팅·모바일 카드·한국어 줄바꿈 수정과 공개 반영 상태 |
| [문구 정리 계획](docs/copy-review-plan.md) | 화면별 삭제·수정·유지 제안. 아직 미적용 |
| [사주 규칙](docs/saju-rule-freeze.md) | 채택한 제품 규칙과 검증 조건 |
| [대운 시작일 규칙](docs/luck-timing-convention.md) | 시작일·기간 경계의 계산 기준 |
| [에셋 출처와 검증](docs/assets-audit.md) | 캐릭터·타로 이미지의 정본 및 무결성 |
