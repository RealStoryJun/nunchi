// 데모용 guest1~5 샘플 계정 시드. (한 번 실행용 — git에 코드만, 데이터는 D1)
// 실행: node scripts/seed-guests.mjs
const HOST = process.env.NUNCHI_HOST || 'https://nunchi.realstoryjun.workers.dev';
const PW = '1q2w3e4r!@';
const DAY = 86_400_000;
const SALES_PER_ACCOUNT = 100;
const HISTORY_DAYS = 14;

const accounts = [
  {
    email: 'guest1@nunchi.app',
    biz: 'cafe',
    name: '이음 커피',
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
  },
  {
    email: 'guest2@nunchi.app',
    biz: 'restaurant',
    name: '정든 한식당',
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
  },
  {
    email: 'guest3@nunchi.app',
    biz: 'bakery',
    name: '데일리 베이크',
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
  },
  {
    email: 'guest4@nunchi.app',
    biz: 'clothing',
    name: '무드 셀렉트샵',
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
  },
  {
    email: 'guest5@nunchi.app',
    biz: 'beauty',
    name: '살롱 헤어',
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
  },
];

const RECOVERY_Q = '데모용 보안질문 - 답은 guest';
const RECOVERY_A = 'guest';

let cookieHeader = '';
const setCookieFrom = (res) => {
  const sc = res.headers.get('set-cookie');
  if (sc) cookieHeader = sc.split(';')[0];
};
const authHeaders = () => ({
  'content-type': 'application/json',
  cookie: cookieHeader,
});

const j = async (res) => {
  try {
    return await res.json();
  } catch {
    return { ok: false, error: 'non-json' };
  }
};

async function inferEmoji(name) {
  try {
    const r = await fetch(
      `${HOST}/api/infer-emoji?name=${encodeURIComponent(name)}`,
      { headers: authHeaders() },
    );
    const d = await j(r);
    return d.ok ? d.data.emoji : '📦';
  } catch {
    return '📦';
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weightedQty = () =>
  Math.random() < 0.82 ? 1 : Math.random() < 0.7 ? 2 : 3;

async function seedAccount(acc) {
  cookieHeader = '';
  // signup → 실패 시 login
  let r = await fetch(`${HOST}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: acc.email,
      password: PW,
      businessName: acc.name,
      recoveryQuestion: RECOVERY_Q,
      recoveryAnswer: RECOVERY_A,
    }),
  });
  if (r.status === 200) {
    setCookieFrom(r);
  } else {
    r = await fetch(`${HOST}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: PW }),
    });
    if (r.status !== 200) {
      console.error(`  [${acc.email}] login 실패: ${r.status}`, await j(r));
      return;
    }
    setCookieFrom(r);
  }

  // 업종
  await fetch(`${HOST}/api/me/business-type`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ businessType: acc.biz }),
  });

  // 기존 활성 메뉴가 있으면 그대로 활용 (재실행 안전)
  const existing = await j(await fetch(`${HOST}/api/menus`, { headers: authHeaders() }));
  let menuRows = existing.ok ? existing.data.menus : [];

  if (menuRows.length === 0) {
    for (const m of acc.menus) {
      const emoji = await inferEmoji(m.name);
      const mr = await j(
        await fetch(`${HOST}/api/menus`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ ...m, emoji }),
        }),
      );
      if (mr.ok) menuRows.push(mr.data.menu);
    }
  }
  if (menuRows.length === 0) {
    console.error(`  [${acc.email}] 메뉴 0개 — 중단`);
    return;
  }

  // 판매 100건 — 최근 14일 랜덤 분포
  const now = Date.now();
  let batch = [];
  let count = 0;
  for (let i = 0; i < SALES_PER_ACCOUNT; i++) {
    const m = pick(menuRows);
    const daysAgo = Math.floor(Math.random() * HISTORY_DAYS);
    const soldAt =
      now - daysAgo * DAY - Math.floor(Math.random() * DAY);
    const quantity = weightedQty();
    batch.push(
      fetch(`${HOST}/api/sales`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ menuId: m.id, quantity, soldAt }),
      }).then(() => count++),
    );
    if (batch.length >= 12) {
      await Promise.all(batch);
      batch = [];
    }
  }
  if (batch.length) await Promise.all(batch);
  console.log(`  [${acc.email}] ${acc.name} (${acc.biz}) — 메뉴 ${menuRows.length}개, 판매 ${count}건 ✓`);
}

async function main() {
  console.log(`시드 시작 → ${HOST}`);
  for (const acc of accounts) {
    await seedAccount(acc);
  }
  console.log('완료. 로그인: guest1~5@nunchi.app / 비번 1q2w3e4r!@');
}

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
