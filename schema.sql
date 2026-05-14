CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_type TEXT,
  recovery_question TEXT NOT NULL,
  recovery_answer_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  -- 2FA (TOTP) — opt-in. totp_secret NULL이면 비활성. backup_codes는 PBKDF2 hash JSON 배열.
  totp_secret TEXT,
  totp_backup_codes_hash TEXT,
  totp_enabled_at INTEGER,
  -- 데모/시드 계정 마킹 — 시스템 통계에서 제외 (guest1-5, mobile-qa, onboarding-qa)
  is_demo INTEGER NOT NULL DEFAULT 0
);

-- 기존 DB 마이그레이션 (apply by hand): 컬럼 없으면 추가
-- ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN totp_secret TEXT;
-- ALTER TABLE users ADD COLUMN totp_backup_codes_hash TEXT;
-- ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER;
-- ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- Admin step-up auth — mutation 직전 비밀번호 재입력으로 10분 TTL 부여
  admin_verified_until INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- 기존 DB: ALTER TABLE sessions ADD COLUMN admin_verified_until INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  cost INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL,
  emoji TEXT DEFAULT '📦',
  archived INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  cost_at_sale INTEGER NOT NULL,
  price_at_sale INTEGER NOT NULL,
  sold_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

-- 이모지 추론 글로벌 캐시 (이모지는 공개 데이터 — 사용자 격리 불필요)
CREATE TABLE IF NOT EXISTS emoji_cache (
  key TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  source TEXT,
  updated_at INTEGER NOT NULL
);

-- 고객 니즈 간이 조사 (판매 시점에 손님 특성을 가볍게 기록 — 모두 선택 항목)
CREATE TABLE IF NOT EXISTS customer_needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  gender TEXT,         -- 'female' | 'male' | NULL
  age_band TEXT,       -- '10s_20s' | '30s_40s' | '50plus' | NULL
  with_child INTEGER,  -- 1 | 0 | NULL
  purpose TEXT,        -- 'gift' | 'kids_snack' | 'meal_replacement' | NULL
  residence TEXT,      -- 'busan' | 'outside' | NULL
  menu_ids TEXT,       -- 판매제품(등록 메뉴) id JSON 배열, 예 '[5,12]' — NULL/[] 가능 (다중 선택)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 월별 고정 지출(임대료·공과금·인건비 등) — 사장님이 매월 자유 라벨로 입력
CREATE TABLE IF NOT EXISTS monthly_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,        -- 'YYYY-MM' (사용자 로컬 타임존 기준)
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,         -- 원 단위
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2FA 로그인 1단계 통과 후 발급되는 단명 토큰 — 2단계(TOTP 코드 입력) 위한 임시 보관.
-- 쿠키 X (응답 body로만 전달, 새로고침 시 1단계부터). 10분 TTL.
CREATE TABLE IF NOT EXISTS auth_pending (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_pending_user ON auth_pending(user_id);

-- 관리자 액션 감사 로그 — 검색·삭제 등 모든 admin 액션 기록. PII는 user_id만(이메일 본문 X).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,       -- 'users.search' | 'users.delete' | 'step_up' | ...
  target_json TEXT,           -- 행동 맥락 JSON, 예 {"ids":[12,34]}. 정적 메시지만.
  ip TEXT,
  ua TEXT,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  error_msg TEXT,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON admin_audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_user_id, at DESC);

-- 사용자 로그인 이벤트 — 새 IP/UA 첫 로그인 감지용. 의심 활동(=알려지지 않은 디바이스)을 admin이 추적.
-- 90일 보관 후 cron 정리. PII는 ip/ua만(이메일·비번 X).
CREATE TABLE IF NOT EXISTS user_login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip TEXT,
  ua TEXT,
  is_new_device INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_login_events_user_at ON user_login_events(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_at ON user_login_events(at DESC);

-- AI(Groq) 사용량 로그 — 모든 사용자의 LLM 호출 기록. 13개월 보관 후 cron 정리.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  year_month TEXT NOT NULL,   -- 'YYYY-MM' (집계용 인덱스 키)
  in_tokens INTEGER,
  out_tokens INTEGER,
  latency_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ym ON ai_usage_log(year_month, user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log(user_id, at DESC);

-- 과거 월 AI 인사이트 영구 저장 — 한 번 생성된 결과 재진입 시 LLM 호출 없이 재현.
-- 현재 월(이번 달)은 저장하지 않음(데이터 계속 변하므로 기존 클라 TTL 캐시 그대로).
-- 무효화: 해당 월 sales 편집/삭제, 해당 월 고정비 변경, business_type 변경 시 서버에서 DELETE.
CREATE TABLE IF NOT EXISTS ai_insights (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,        -- 'YYYY-MM'
  business_type TEXT,              -- 저장 시점 업종 (참조용)
  monthly_fixed_cost INTEGER NOT NULL DEFAULT 0,  -- 저장 시점 고정비 합계 (참조용)
  insights_json TEXT NOT NULL,     -- string[] JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, year_month),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_menus_user ON menus(user_id, archived);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts(key, attempted_at);
CREATE INDEX IF NOT EXISTS idx_needs_user ON customer_needs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mci_user_ym ON monthly_cost_items(user_id, year_month);
