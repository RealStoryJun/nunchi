// 데모용 guest1~5 계정에 "업종에 맞는" 3개월치 판매 데이터 시드.
// - 업종별로 거래량·시간대·메뉴 비중·요일/추세 패턴이 다르게 생성된다.
//   (카페·식당·베이커리는 박리다매, 옷가게·미용실은 소량 고가 — 옷가게가 하루 20개씩 안 팔림)
// - 재실행 안전: 각 계정의 기존 판매 기록을 먼저 모두 삭제하고 새로 채운다. 메뉴는 그대로 재사용.
// 실행: node scripts/seed-guests.mjs
//   (대상 변경: NUNCHI_HOST=http://localhost:5173 node scripts/seed-guests.mjs)

const HOST = process.env.NUNCHI_HOST || 'https://nunchi.realstoryjun.workers.dev';
const PW = '1q2w3e4r!@';
const DAY = 86_400_000;
const HISTORY_DAYS = 92; // 약 3개월
const POST_CONCURRENCY = 20;

const RECOVERY_Q = '데모용 보안질문 - 답은 guest';
const RECOVERY_A = 'guest';

// ───────────────────────── 유틸 ─────────────────────────
const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 0.999999));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// items = [[value, weight], ...]
function weightedPick(items) {
  let total = 0;
  for (const it of items) total += it[1];
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}
// hourWeights: 길이 24 배열(0~23시 가중치). → 그 날의 ms 오프셋(0 ~ DAY)
function timeOffset(hourWeights) {
  const hour = weightedPick(hourWeights.map((w, h) => [h, w]));
  return hour * 3600_000 + rndInt(0, 59) * 60_000 + rndInt(0, 59) * 1000;
}

// 시간대 프로파일
const H = {
  cafe:       [0,0,0,0,0,0,0.3, 1.3,1.6,1.3,0.8, 0.5,0.6, 1.1,1.3,1.2,1.0, 0.7,0.5,0.3, 0.1,0,0,0],
  bakery:     [0,0,0,0,0,0,0.2, 0.7,1.5,1.6,1.3,1.0, 0.8,0.7,0.6,0.5, 0.4,0.3,0.2,0.1, 0,0,0,0],
  restaurant: [0,0,0,0,0,0,0,0,0,0,0.2, 1.0,1.7,1.4,0.6, 0.2,0.3,0.8, 1.4,1.6,1.3,0.7, 0.2,0],
  clothing:   [0,0,0,0,0,0,0,0,0,0,0, 0.4,0.6,0.8,1.0,1.1,1.2, 1.2,1.1,1.0,0.7, 0.3,0,0],
  beauty:     [0,0,0,0,0,0,0,0,0,0, 0.7,1.0,1.0,0.8, 1.1,1.2,1.2,1.1,1.0,0.8, 0.3,0,0,0],
};
// 요일 가중치 (0=일 … 6=토)
const DOW = {
  cafe:       [1.05, 0.85, 0.90, 0.95, 1.00, 1.20, 1.25],
  bakery:     [1.15, 0.80, 0.85, 0.90, 0.95, 1.15, 1.25],
  restaurant: [0.95, 0.90, 0.95, 1.00, 1.10, 1.30, 1.15],
  clothing:   [1.10, 0.70, 0.75, 0.80, 0.95, 1.30, 1.40],
  beauty:     [1.20, 0.00, 0.85, 0.90, 1.05, 1.25, 1.30], // 월요일 휴무
};
// 천천히 성장하는 추세 (가게가 자리잡는 느낌)
const trendMult = (dayIdx) => 0.82 + 0.36 * (dayIdx / (HISTORY_DAYS - 1));
const dailyNoise = () => rnd(0.78, 1.22);

// ───────────────────────── 계정/메뉴 정의 ─────────────────────────
const accounts = [
  {
    email: 'guest1@nunchi.app', biz: 'cafe', name: '이음 커피',
    menus: [
      { name: '아메리카노', category: '커피', cost: 800, price: 4500 },
      { name: '카페라떼', category: '커피', cost: 1200, price: 5000 },
      { name: '바닐라라떼', category: '커피', cost: 1400, price: 5500 },
      { name: '카푸치노', category: '커피', cost: 1200, price: 5000 },
      { name: '콜드브루', category: '커피', cost: 1000, price: 5000 },
      { name: '자몽에이드', category: '에이드', cost: 900, price: 5500 },
      { name: '청포도에이드', category: '에이드', cost: 900, price: 5500 },
      { name: '치즈케이크', category: '디저트', cost: 2500, price: 7500 },
      { name: '크루아상', category: '베이커리', cost: 1200, price: 4500 },
      { name: '아이스티', category: '음료', cost: 600, price: 4000 },
    ],
    base: 23, // 하루 평균 거래(잔/건) 기준
    gen(date, dayIdx, menusByName) {
      const dow = date.getDay();
      const n = Math.max(0, Math.round(this.base * DOW.cafe[dow] * trendMult(dayIdx) * dailyNoise()));
      const out = [];
      for (let i = 0; i < n; i++) {
        const name = weightedPick([
          ['아메리카노', 32], ['카페라떼', 16], ['콜드브루', 11], ['바닐라라떼', 8],
          ['카푸치노', 7], ['아이스티', 7], ['자몽에이드', 5], ['청포도에이드', 4],
          ['크루아상', 6], ['치즈케이크', 4],
        ]);
        const qty = weightedPick([[1, 90], [2, 8], [3, 2]]);
        out.push({ menuId: menusByName.get(name), quantity: qty, off: timeOffset(H.cafe) });
      }
      return out;
    },
  },
  {
    email: 'guest2@nunchi.app', biz: 'restaurant', name: '정든 한식당',
    menus: [
      { name: '김치찌개', category: '찌개', cost: 3500, price: 9000 },
      { name: '된장찌개', category: '찌개', cost: 3000, price: 8500 },
      { name: '제육볶음', category: '볶음', cost: 4500, price: 11000 },
      { name: '불고기', category: '구이', cost: 6000, price: 14000 },
      { name: '비빔밥', category: '밥류', cost: 3500, price: 9500 },
      { name: '김치볶음밥', category: '밥류', cost: 2500, price: 8000 },
      { name: '계란말이', category: '반찬', cost: 1500, price: 6000 },
      { name: '공기밥', category: '밥류', cost: 300, price: 1000 },
      { name: '라면', category: '분식', cost: 800, price: 4000 },
      { name: '떡볶이', category: '분식', cost: 1500, price: 5000 },
    ],
    base: 11, // 하루 평균 "테이블" 수 (한 테이블 = 2~4건 POST)
    gen(date, dayIdx, menusByName) {
      const dow = date.getDay();
      const tables = Math.max(0, Math.round(this.base * DOW.restaurant[dow] * trendMult(dayIdx) * dailyNoise()));
      const out = [];
      const add = (name, qty, off) => out.push({ menuId: menusByName.get(name), quantity: qty, off });
      for (let t = 0; t < tables; t++) {
        const off = timeOffset(H.restaurant);
        const jitter = () => off + rndInt(0, 4) * 60_000; // 같은 테이블 = 비슷한 시각
        const roll = Math.random();
        if (roll < 0.65) {
          // 정식 테이블: 메인 1~2 + 공기밥 (+ 계란말이/분식)
          const mains = weightedPick([[1, 70], [2, 30]]);
          for (let i = 0; i < mains; i++) {
            add(weightedPick([
              ['김치찌개', 22], ['된장찌개', 16], ['제육볶음', 18], ['불고기', 9],
              ['비빔밥', 12], ['김치볶음밥', 9],
            ]), weightedPick([[1, 88], [2, 12]]), jitter());
          }
          add('공기밥', rndInt(1, 3), jitter());
          if (Math.random() < 0.28) add('계란말이', 1, jitter());
          if (Math.random() < 0.12) add(weightedPick([['라면', 1], ['떡볶이', 1]]), 1, jitter());
        } else if (roll < 0.85) {
          // 단품 한 그릇
          add(weightedPick([['비빔밥', 10], ['김치볶음밥', 10], ['제육볶음', 6]]),
              weightedPick([[1, 90], [2, 10]]), jitter());
          if (Math.random() < 0.2) add('공기밥', 1, jitter());
        } else {
          // 분식 테이블
          let any = false;
          if (Math.random() < 0.65) { add('떡볶이', weightedPick([[1, 80], [2, 20]]), jitter()); any = true; }
          if (Math.random() < 0.65) { add('라면', weightedPick([[1, 85], [2, 15]]), jitter()); any = true; }
          if (!any) add('라면', 1, jitter());
        }
      }
      return out;
    },
  },
  {
    email: 'guest3@nunchi.app', biz: 'bakery', name: '데일리 베이크',
    menus: [
      { name: '식빵', category: '빵', cost: 1200, price: 4500 },
      { name: '크루아상', category: '빵', cost: 1000, price: 3800 },
      { name: '소금빵', category: '빵', cost: 800, price: 3500 },
      { name: '단팥빵', category: '빵', cost: 700, price: 2800 },
      { name: '베이글', category: '빵', cost: 1100, price: 4200 },
      { name: '치즈케이크', category: '케이크', cost: 2800, price: 7500 },
      { name: '당근케이크', category: '케이크', cost: 2600, price: 7000 },
      { name: '마카롱', category: '디저트', cost: 700, price: 2800 },
      { name: '쿠키', category: '디저트', cost: 400, price: 2000 },
      { name: '스콘', category: '디저트', cost: 900, price: 3500 },
    ],
    base: 26, // 하루 평균 "구매 항목" 수
    gen(date, dayIdx, menusByName) {
      const dow = date.getDay();
      const n = Math.max(0, Math.round(this.base * DOW.bakery[dow] * trendMult(dayIdx) * dailyNoise()));
      const out = [];
      for (let i = 0; i < n; i++) {
        const name = weightedPick([
          ['소금빵', 18], ['크루아상', 16], ['식빵', 14], ['베이글', 10], ['단팥빵', 9],
          ['스콘', 8], ['쿠키', 7], ['마카롱', 7], ['치즈케이크', 6], ['당근케이크', 5],
        ]);
        let qty;
        if (name === '치즈케이크' || name === '당근케이크') qty = weightedPick([[1, 84], [2, 14], [3, 2]]);
        else if (name === '쿠키' || name === '마카롱') qty = weightedPick([[1, 35], [2, 30], [3, 22], [4, 9], [6, 4]]);
        else qty = weightedPick([[1, 50], [2, 30], [3, 14], [4, 5], [5, 1]]);
        out.push({ menuId: menusByName.get(name), quantity: qty, off: timeOffset(H.bakery) });
      }
      return out;
    },
  },
  {
    email: 'guest4@nunchi.app', biz: 'clothing', name: '무드 셀렉트샵',
    menus: [
      { name: '반팔티셔츠', category: '상의', cost: 8000, price: 22000 },
      { name: '맨투맨', category: '상의', cost: 15000, price: 39000 },
      { name: '셔츠', category: '상의', cost: 18000, price: 49000 },
      { name: '청바지', category: '하의', cost: 25000, price: 69000 },
      { name: '슬랙스', category: '하의', cost: 22000, price: 59000 },
      { name: '후드집업', category: '아우터', cost: 28000, price: 79000 },
      { name: '가디건', category: '아우터', cost: 30000, price: 89000 },
      { name: '트레이닝복', category: '세트', cost: 35000, price: 99000 },
      { name: '양말', category: '잡화', cost: 1500, price: 5000 },
      { name: '비니', category: '잡화', cost: 8000, price: 25000 },
    ],
    base: 5, // 하루 평균 판매 점수 — 의류는 소량
    gen(date, dayIdx, menusByName) {
      const dow = date.getDay();
      const n = Math.max(0, Math.round(this.base * DOW.clothing[dow] * trendMult(dayIdx) * dailyNoise()));
      const out = [];
      for (let i = 0; i < n; i++) {
        const name = weightedPick([
          ['반팔티셔츠', 18], ['맨투맨', 15], ['양말', 14], ['셔츠', 11], ['청바지', 10],
          ['슬랙스', 8], ['후드집업', 8], ['비니', 7], ['가디건', 5], ['트레이닝복', 4],
        ]);
        const qty = name === '양말'
          ? weightedPick([[1, 45], [2, 30], [3, 20], [4, 5]])
          : weightedPick([[1, 93], [2, 7]]);
        out.push({ menuId: menusByName.get(name), quantity: qty, off: timeOffset(H.clothing) });
      }
      return out;
    },
  },
  {
    email: 'guest5@nunchi.app', biz: 'beauty', name: '살롱 헤어',
    menus: [
      { name: '남자컷', category: '커트', cost: 3000, price: 18000 },
      { name: '여자컷', category: '커트', cost: 4000, price: 25000 },
      { name: '앞머리컷', category: '커트', cost: 1000, price: 8000 },
      { name: '디지털펌', category: '펌', cost: 15000, price: 89000 },
      { name: '셋팅펌', category: '펌', cost: 18000, price: 110000 },
      { name: '매직스트레이트', category: '매직', cost: 20000, price: 130000 },
      { name: '뿌리염색', category: '염색', cost: 12000, price: 60000 },
      { name: '전체염색', category: '염색', cost: 18000, price: 90000 },
      { name: '클리닉', category: '케어', cost: 8000, price: 40000 },
      { name: '두피스케일링', category: '케어', cost: 6000, price: 35000 },
    ],
    base: 9, // 하루 평균 시술 건수 (의자 수 한정), 월요일 휴무
    gen(date, dayIdx, menusByName) {
      const dow = date.getDay();
      const n = Math.max(0, Math.round(this.base * DOW.beauty[dow] * trendMult(dayIdx) * dailyNoise()));
      const out = [];
      for (let i = 0; i < n; i++) {
        const off = timeOffset(H.beauty);
        const name = weightedPick([
          ['남자컷', 24], ['여자컷', 19], ['앞머리컷', 13], ['뿌리염색', 11], ['전체염색', 8],
          ['클리닉', 8], ['두피스케일링', 6], ['디지털펌', 5], ['셋팅펌', 3], ['매직스트레이트', 3],
        ]);
        out.push({ menuId: menusByName.get(name), quantity: 1, off });
        // 컷 + 추가 케어/염색 콤보 (시술 시간상 같은 손님이 이어서)
        if ((name === '남자컷' || name === '여자컷') && Math.random() < 0.18) {
          const add = weightedPick([['클리닉', 5], ['뿌리염색', 4], ['두피스케일링', 3], ['전체염색', 2]]);
          out.push({ menuId: menusByName.get(add), quantity: 1, off: off + rndInt(20, 60) * 60_000 });
        }
      }
      return out;
    },
  },
];

// ───────────────────────── HTTP ─────────────────────────
let cookieHeader = '';
const setCookieFrom = (res) => {
  const sc = res.headers.get('set-cookie');
  if (sc) cookieHeader = sc.split(';')[0];
};
const authHeaders = () => ({ 'content-type': 'application/json', cookie: cookieHeader });
const j = async (res) => { try { return await res.json(); } catch { return { ok: false, error: 'non-json' }; } };

async function inferEmoji(name) {
  try {
    const r = await fetch(`${HOST}/api/infer-emoji?name=${encodeURIComponent(name)}`, { headers: authHeaders() });
    const d = await j(r);
    return d.ok ? d.data.emoji : '📦';
  } catch { return '📦'; }
}

async function runBatched(items, fn, size = POST_CONCURRENCY) {
  let done = 0;
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
    done += Math.min(size, items.length - i);
  }
  return done;
}

async function wipeSales() {
  let removed = 0;
  // 한 번에 최대 500건씩 가져와 삭제, 더 없을 때까지 반복
  for (let guard = 0; guard < 200; guard++) {
    const r = await j(await fetch(`${HOST}/api/sales?limit=500`, { headers: authHeaders() }));
    const sales = r.ok ? r.data.sales : [];
    if (sales.length === 0) break;
    await runBatched(sales, (s) =>
      fetch(`${HOST}/api/sales/${s.id}`, { method: 'DELETE', headers: authHeaders() }),
    );
    removed += sales.length;
    if (sales.length < 500) break;
  }
  return removed;
}

async function seedAccount(acc) {
  cookieHeader = '';
  // signup → 이미 있으면 login
  let r = await fetch(`${HOST}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: acc.email, password: PW, businessName: acc.name,
      recoveryQuestion: RECOVERY_Q, recoveryAnswer: RECOVERY_A,
    }),
  });
  if (r.status === 200) setCookieFrom(r);
  else {
    r = await fetch(`${HOST}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: PW }),
    });
    if (r.status !== 200) { console.error(`  [${acc.email}] login 실패 ${r.status}`, await j(r)); return; }
    setCookieFrom(r);
  }

  await fetch(`${HOST}/api/me/business-type`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ businessType: acc.biz }),
  });

  // 메뉴: 있으면 재사용, 없으면 생성
  let menuRows = (await j(await fetch(`${HOST}/api/menus`, { headers: authHeaders() }))).data?.menus ?? [];
  if (menuRows.length === 0) {
    for (const m of acc.menus) {
      const emoji = await inferEmoji(m.name);
      const mr = await j(await fetch(`${HOST}/api/menus`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ ...m, emoji }),
      }));
      if (mr.ok) menuRows.push(mr.data.menu);
    }
  }
  if (menuRows.length === 0) { console.error(`  [${acc.email}] 메뉴 0개 — 중단`); return; }
  const menusByName = new Map(menuRows.map((m) => [m.name, m.id]));

  // 기존 판매 전부 삭제 (재실행 안전)
  const wiped = await wipeSales();

  // 3개월치 생성
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const startMs = todayStart.getTime() - (HISTORY_DAYS - 1) * DAY;
  const now = Date.now();
  const events = [];
  let missing = 0;
  for (let d = 0; d < HISTORY_DAYS; d++) {
    const dayStartMs = startMs + d * DAY;
    const date = new Date(dayStartMs);
    for (const ev of acc.gen(date, d, menusByName)) {
      if (ev.menuId == null) { missing++; continue; }
      const soldAt = dayStartMs + ev.off;
      if (soldAt > now) continue; // 오늘의 미래 시각 제외
      events.push({ menuId: ev.menuId, quantity: ev.quantity, soldAt });
    }
  }
  // 시간순으로 (선택사항 — id 순서가 시간과 대체로 일치하도록)
  events.sort((a, b) => a.soldAt - b.soldAt);

  let okCount = 0;
  await runBatched(events, async (e) => {
    try {
      const res = await fetch(`${HOST}/api/sales`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ menuId: e.menuId, quantity: e.quantity, soldAt: e.soldAt }),
      });
      if (res.ok) okCount++;
    } catch { /* skip */ }
  });

  // 요약
  const st = (await j(await fetch(
    `${HOST}/api/stats?from=${startMs}&to=${now}&tz=${-new Date().getTimezoneOffset()}`,
    { headers: authHeaders() },
  ))).data;
  const won = (n) => Math.round(n || 0).toLocaleString('ko-KR');
  console.log(
    `  [${acc.email}] ${acc.name} (${acc.biz}) — 메뉴 ${menuRows.length}개, 기존 ${wiped}건 삭제, ` +
    `신규 ${okCount}건 입력` + (missing ? ` (메뉴 매칭 실패 ${missing})` : '') +
    ` · 총매출 ${won(st?.revenue)}원 / 순이익 ${won(st?.profit)}원 / 판매수량 ${st?.qty ?? '?'}`,
  );
}

async function main() {
  console.log(`시드 시작 → ${HOST}  (최근 ${HISTORY_DAYS}일, 동시 ${POST_CONCURRENCY})`);
  for (const acc of accounts) {
    const t0 = Date.now();
    await seedAccount(acc);
    console.log(`     (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log('완료. 로그인: guest1~5@nunchi.app / 비번 ' + PW);
}

main().catch((e) => { console.error('실패:', e); process.exit(1); });
