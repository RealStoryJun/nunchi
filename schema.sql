CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_type TEXT,
  recovery_question TEXT NOT NULL,
  recovery_answer_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0
);

-- 기존 DB 마이그레이션: 컬럼 없으면 추가
-- ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
