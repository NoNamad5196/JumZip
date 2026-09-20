# Cloudflare 우선 · Gemini 보조 전환

> 과거 배포 기록입니다. 2026-09-20 18:28 KST부터 Gemini 연결은 제거됐으며 [OpenAI Luna 보조 전환](openai-fallback.md)이 현재 운영 설정입니다.

2026-09-20 운영 설정에 반영했습니다. Cloudflare Qwen이 기본이며 **Cloudflare가 HTTP 429를 반환할 때만 Gemini 3.5 Flash로 전환**합니다. 다음 작업은 다시 Cloudflare부터 시도하므로 Cloudflare 복구 후 기본 제공자로 돌아갑니다.

전환은 서버 내부의 한 요청에서 수행합니다. 같은 답변의 형식 수정도 이미 선택한 Gemini에서 이어갑니다. 기존 제한시간 안에서 처리하고, 형식 수정은 전체 한 번을 넘기지 않습니다. 인증 오류·네트워크 오류·시간 초과·검증 실패만으로 다른 제공자로 전환하지 않습니다. Gemini도 실패하면 오류를 반환하며 두 제공자를 반복 호출하지 않습니다.

## 등록·배포 범위

- 키는 Git에서 제외된 서버 전용 환경 파일과 Supabase Secrets에만 저장했습니다. Cloudflare 키·모델 설정은 유지했습니다.
- 사용자가 Gemini 프로젝트의 Free Tier와 대화·선택된 기억/맥락·타로·사주·궁합 결과의 Google 전송 및 자동 전환을 확인·승인했습니다. 유료 요금제 변경은 없었습니다.
- 운영 Persona-v4 / Intent-v1의53개 파일에서 provider와 연결 설정 두 파일만 수정했습니다. 나머지51개 파일은 원본과 같습니다. 미검증 Persona-v12·v4.1은 포함하지 않았습니다.
- Google 보조 처리와 무료 API의 데이터 이용 조건을 공개 개인정보 안내에 반영했습니다.
- `LLM_FALLBACK_ENABLED=true` 및 양쪽 모델·주소·별도 키가 원격 설정과 일치함을 해시로 확인했습니다. 비밀 값과 해시는 출력하지 않았습니다.

## 검증과 한계

전체 테스트1,147개, typecheck, lint, production build와 공개/소스 credential 검사가 통과했습니다. 선택적 live 테스트3개는 제외했습니다. 별도의 스테이지 검사에서는53개 파일 해시,51개 원본 일치, staged TypeScript와10개 합성 검증 그룹을 통과했습니다.

실제 Cloudflare429 뒤 Gemini가 보미의 한국어 인사에 응답했고 기존 v4 검증을 통과했습니다. 타로 후속 테스트도 실제 Gemini200 응답과 산이의 별 정방향 해석 검증을 통과했습니다. 타로 후속 테스트의 primary429만 합성이며 사용자·DB·계정 데이터는 사용하지 않았습니다. 총 실제 호출은 Cloudflare1회, Gemini4회였습니다.

첫 타로 테스트는 카드 배열을 실제 운영의 `toolResult.cards` 객체로 감싸지 않은 테스트 입력 오류가 있었습니다. 그 수정 요청에서 실제 Google503도 관측됐습니다. 이 사례를 정상 운영 입력의 품질 결과로 계산하지 않았고, 올바른 입력으로 검증한 후속 사례를 사용합니다. 제공자의 일시적인 실패 가능성은 남아 있습니다.

다섯 운영 함수에서 OPTIONS204, 비인증 POST401과 허용 출처를 확인했습니다. 공개 HTML·JS·CSS10개가 배포 빌드와 일치합니다. 이는 **로그인한 사용자의 전체 DB→Edge→모델 흐름을 새로 검증한 것은 아닙니다.**

[릴리스·검증 기록](evidence/edge-gemini-fallback-release.json) · [공개 빌드 확인](evidence/frontend-gemini-fallback-public.json)

## 운영 설정

서버에서 `LLM_FALLBACK_ENABLED=false`로 바꾸면 보조 전환만 끌 수 있습니다. `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`는 기본 Cloudflare 설정으로 유지합니다. 브라우저용 `VITE_*`에 AI 키를 넣지 않습니다.

공식 참고: [Gemini3.5Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [OpenAI 호환 API](https://ai.google.dev/gemini-api/docs/openai), [요금제](https://ai.google.dev/gemini-api/docs/pricing), [데이터 이용 약관](https://ai.google.dev/gemini-api/terms).
