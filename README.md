# 성경학교 참석자 관리

Vite + React + Supabase + Vercel 배포를 기준으로 만든 성경학교 운영 웹앱입니다.

Supabase 환경변수가 없으면 로컬 개발 모드로 실행되며, 데이터는 브라우저 localStorage에 저장됩니다. Supabase 환경변수를 넣으면 로그인과 중앙 저장소를 사용합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 엽니다.

```text
http://127.0.0.1:5173/
```

## 빌드

```bash
npm run build
```

## Supabase 준비

1. Supabase 프로젝트를 만듭니다.
2. `supabase/schema.sql` 내용을 Supabase SQL Editor에서 실행합니다.
3. Authentication에서 계정 3개를 만듭니다.
   - 관리자 계정
   - 선생님 공용 계정
   - 의료인 계정
4. 생성된 user id를 `schema.sql` 하단의 `user_roles` insert 예시에 넣어 실행합니다.
5. `.env.example`을 참고해서 Vercel 환경변수에 아래 값을 넣습니다.

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Vercel 배포

GitHub 저장소를 Vercel에 연결하고, Framework Preset은 Vite로 둡니다.

- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variables: `.env.example`의 두 값

## CSV / 엑셀 권장 열

```text
역할,이름,성별,나이,보호자,본인연락처,보호자연락처,교우관계,특이사항,조장
```

학생 필수값:

```text
이름, 성별, 나이, 보호자연락처
```

선생님 필수값:

```text
이름, 성별, 본인연락처
```

## 현재 권한 모델

- 관리자: 참석자 등록/수정/삭제, 조 편성, 사역팀 관리, 출석, 의무기록
- 선생님: 조회, 조/조직도 확인, 출석 체크
- 의료인: 조회, 의무기록 수정

## 담임용 명단 출력

`담임용 명단` 화면에서 조별 학생 명단을 확인하고 `인쇄 / PDF 저장` 버튼으로 출력합니다.

- 포함 항목: 이름, 성별, 나이, 보호자연락처, 조장 여부, 교우관계, 특이사항
- 한 조에 선생님이 여러 명이면 같은 조 명단을 함께 사용합니다.
- 미배정 학생은 화면에 경고로 표시되며, 기본 인쇄 명단에는 포함되지 않습니다.

현재 Supabase MVP는 `app_state` JSON 문서 하나에 앱 상태를 저장합니다. 더 강한 RLS가 필요하면 다음 단계에서 `participants`, `groups`, `teams`, `attendance`, `medical_records` 테이블로 분리하는 것이 좋습니다.
