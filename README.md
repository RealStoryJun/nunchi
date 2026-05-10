# 눈치 (Nunchi)

1인 사업자(카페·음식점·소매점 사장님)를 위한 매출/원가 관리 데모.
메뉴를 등록하고, 손님한테 팔린 걸 한 탭으로 입력하면, 매출·원가·이익이
한눈에 보입니다.

> **컨셉**: AI가 사장님 대신 가게의 눈치를 채워준다.
> (이번 단계에서는 AI 자리만 비워두고 데이터 흐름만 구현했습니다.)

## 구성

- **호스팅 + 백엔드**: Cloudflare Workers (정적 자산 무료/무제한)
- **DB**: Cloudflare D1 (SQLite)
- **프론트**: Vite + React 18 + TypeScript + Tailwind CSS
- **차트**: Recharts
- **인증**: 자체 구현 (PBKDF2/SHA-256 100k iter, HTTP-only 쿠키, 30일 세션)
- **무료 티어 엄수**: R2 / KV / Durable Objects 사용 안 함

## 디렉토리 구조

```
nunchi/
├── src/
│   ├── worker/                # Cloudflare Worker (백엔드)
│   │   ├── index.ts           # 라우터 (/api/*)
│   │   ├── auth.ts            # 회원가입/로그인/로그아웃/비번찾기
│   │   ├── menus.ts           # 메뉴 CRUD + 보관 + 순서 조정
│   │   ├── sales.ts           # 판매 입력/조회/취소
│   │   ├── stats.ts           # BI 집계
│   │   ├── session.ts         # 세션 미들웨어
│   │   ├── crypto.ts          # PBKDF2 비번 해싱
│   │   └── types.ts
│   └── client/                # React SPA
│       ├── pages/             # Landing/Login/Signup/Recover/Sales/Menus/BI/Account
│       ├── components/        # Layout/BottomNav/Logo/MenuTile/StatCard/CountUp/Protected
│       ├── hooks/useAuth.ts
│       └── lib/               # api.ts, format.ts
├── schema.sql                 # D1 스키마
├── wrangler.jsonc             # Worker + D1 바인딩 설정
└── vite.config.ts             # @cloudflare/vite-plugin 통합
```

## 처음 셋업하기

### 1) 의존성

```bash
npm install
```

### 2) Cloudflare 인증

```bash
npx wrangler login
```

또는 환경변수 `CLOUDFLARE_API_TOKEN` 사용. 토큰에는 다음 권한이 필요합니다:
- **Account → D1 → Edit**
- **Account → Workers Scripts → Edit**

### 3) D1 데이터베이스 생성

```bash
npx wrangler d1 create nunchi-db
```

출력된 `database_id`를 **`wrangler.jsonc`** 의 `d1_databases[0].database_id` 에 붙여넣으세요.

### 4) 스키마 적용

```bash
# 로컬 (개발용)
npm run db:local

# 원격 (배포 전 1회)
npm run db:remote
```

## 개발

```bash
npm run dev
```

→ `http://localhost:5173` 에 워커와 React 앱이 함께 뜹니다.
(`@cloudflare/vite-plugin` 이 Worker + 정적 자산을 통합 처리)

## 배포

```bash
npm run deploy
# 내부적으로: npm run build && wrangler deploy
```

배포 후 `https://nunchi.<your-subdomain>.workers.dev` 에서 접근 가능합니다.

## 데이터 모델

| 테이블 | 핵심 필드 | 비고 |
|---|---|---|
| `users` | email, password_hash, business_name, recovery_question, recovery_answer_hash | PBKDF2 해시 |
| `sessions` | token, user_id, expires_at | HTTP-only 쿠키, 30일 |
| `menus` | name, category, cost, price, emoji, archived, display_order | archived=1로 보관 (삭제 X) |
| `sales` | menu_id, quantity, **cost_at_sale**, **price_at_sale**, sold_at | **스냅샷 저장** (메뉴 가격 변경 후에도 과거 분석 정확) |

## API 엔드포인트

응답 포맷: `{ ok: true, data }` 또는 `{ ok: false, error }`.

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/auth/signup` | 회원가입 |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/auth/recover/start` | 보안질문 조회 |
| POST | `/api/auth/recover/verify` | 답변 검증 + 비번 재설정 |
| GET  | `/api/me` | 현재 사용자 |
| GET  | `/api/menus` | 활성 메뉴 목록 |
| POST | `/api/menus` | 메뉴 추가 |
| PUT  | `/api/menus/:id` | 메뉴 수정 |
| DELETE | `/api/menus/:id` | 메뉴 보관(archived=1) |
| POST | `/api/menus/:id/up` `/down` | 순서 조정 |
| GET  | `/api/sales?from=&to=&limit=` | 판매 조회 |
| POST | `/api/sales` | 판매 기록 |
| DELETE | `/api/sales/:id` | 판매 취소 |
| GET  | `/api/stats?from=&to=&tz=` | BI 집계 (tz=분 단위 오프셋) |

## 다음 단계 (자리 비워둠)

- `/api/insights` 엔드포인트에 Groq API 연결 (예: "오늘 평소보다 라떼가 적게 팔렸어요")
- 다크모드, 직원/팀 기능, OAuth, 결제, 다국어
- R2 기반 메뉴 이미지 업로드 (현재는 이모지로 대체)

---

데모 환경에서 한국어 폰트는 **Pretendard Variable** + 디스플레이는
**Gowun Batang** 을 사용해 한글 명조의 정제된 인상을 살렸습니다.
