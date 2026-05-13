// 미래 데이터 시드 — guest1~5에 "지금 → 5/14 23:59" 윈도우로 판매·니즈 데이터 채움.
// 기존 데이터(과거 92일분)는 안 건드림. 재실행 안전: future 영역만 와이프 후 재채움.
// 시연 대비 — 5/14에 데모할 때 "오늘"이 비어 보이지 않게.
// 실행: node scripts/seed-future.mjs

const HOST = process.env.NUNCHI_HOST || 'https://nunchi.realstoryjun.workers.dev';
const PW = '1q2w3e4r!@';
const GUESTS = ['guest1', 'guest2', 'guest3', 'guest4', 'guest5'].map(
  (g) => `${g}@nunchi.app`,
);

const NOW = Date.now();
// 목표 종료 시각: 로컬 5/14 23:59:59.999 (스크립트 실행 시각의 연도 기준)
const targetEnd = new Date(NOW);
targetEnd.setMonth(4); // May (0-indexed)
targetEnd.setDate(14);
targetEnd.setHours(23, 59, 59, 999);
const TARGET_END = targetEnd.getTime();

if (TARGET_END <= NOW) {
  console.log('이미 5/14 지남 — 채울 미래 시간이 없어요.');
  process.exit(0);
}

const BIZ_START = 8; // 영업 시작 시 (KST)
const BIZ_END = 22; // 영업 종료 시 (exclusive)
// 미래 윈도우(일 단위, 부분일 포함). 페이스는 계정별 기존 30일 일평균에서 측정.
const WINDOW_DAYS = (TARGET_END - NOW) / 86_400_000;

const GENDER = [['female', 55], ['male', 45]];
const AGE = [['10s_20s', 28], ['30s_40s', 48], ['50plus', 24]];
const RESID = [['busan', 74], ['outside', 26]];
const N_MENUS = [[1, 56], [2, 30], [3, 11], [4, 3]];
const QTY = [[1, 80], [2, 17], [3, 3]];

// 업태별 손님 특성 분포 — 차량 정비/공방/세탁 등엔 "식사대용/자녀간식용"이 안 어울림.
const PURPOSE_BY_TYPE = {
  cafe: [['meal_replacement', 35], ['gift', 25], ['kids_snack', 20], [null, 20]],
  restaurant: [['meal_replacement', 60], ['gift', 10], ['kids_snack', 15], [null, 15]],
  bakery: [['gift', 35], ['kids_snack', 30], ['meal_replacement', 25], [null, 10]],
  clothing: [['gift', 55], [null, 45]],
  beauty: [['gift', 18], [null, 82]], // 미용은 거의 본인용
  auto_repair: [['gift', 8], [null, 92]], // 차주 본인이 의뢰
  motorcycle: [['gift', 6], [null, 94]],
  wrap_tuning: [['gift', 12], [null, 88]],
  craft: [['gift', 55], [null, 40], ['kids_snack', 5]], // 선물·자기 취미 위주
  laundry: [[null, 95], ['gift', 5]],
  sidedish: [['meal_replacement', 70], ['gift', 12], [null, 18]],
  default: [['meal_replacement', 40], ['gift', 25], ['kids_snack', 20], [null, 15]],
};
const CHILD_BY_TYPE = {
  cafe: [[true, 22], [false, 70], [null, 8]],
  restaurant: [[true, 30], [false, 60], [null, 10]],
  bakery: [[true, 38], [false, 55], [null, 7]], // 아이들 빵 사러
  clothing: [[true, 10], [false, 80], [null, 10]],
  beauty: [[false, 92], [null, 8]],
  auto_repair: [[false, 92], [null, 8]],
  motorcycle: [[false, 96], [null, 4]],
  wrap_tuning: [[false, 93], [null, 7]],
  craft: [[true, 15], [false, 78], [null, 7]],
  laundry: [[false, 88], [null, 12]],
  sidedish: [[true, 28], [false, 64], [null, 8]], // 가족용으로 사 가는 손님
  default: [[true, 22], [false, 70], [null, 8]],
};

const wpick = (items) => {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
};

// (NOW, TARGET_END] 안에서 영업시간만 골라 ms 단위로 반환
const rndBusinessMs = () => {
  for (let i = 0; i < 200; i++) {
    const t = NOW + Math.random() * (TARGET_END - NOW);
    const h = new Date(t).getHours();
    if (h >= BIZ_START && h < BIZ_END) return Math.floor(t);
  }
  // fallback — 영업시간을 못 찾는 케이스(좁은 윈도우, 모두 야간)면 그냥 시점 그대로
  return Math.floor(NOW + Math.random() * (TARGET_END - NOW));
};

const j = async (r) => {
  try {
    return await r.json();
  } catch {
    return { ok: false };
  }
};

async function login(email) {
  const r = await fetch(`${HOST}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`);
  return r.headers.get('set-cookie').split(';')[0];
}

async function wipeFutureSales(cookie) {
  let removed = 0;
  for (let guard = 0; guard < 50; guard++) {
    const r = await j(
      await fetch(`${HOST}/api/sales?from=${NOW}&limit=100`, { headers: { cookie } }),
    );
    const list = r.ok ? r.data.sales : [];
    if (list.length === 0) break;
    let batch = [];
    for (const s of list) {
      batch.push(
        fetch(`${HOST}/api/sales/${s.id}`, { method: 'DELETE', headers: { cookie } }),
      );
      if (batch.length >= 15) {
        await Promise.all(batch);
        batch = [];
      }
    }
    if (batch.length) await Promise.all(batch);
    removed += list.length;
    if (list.length < 100) break;
  }
  return removed;
}

async function wipeFutureNeeds(cookie) {
  let removed = 0;
  for (let guard = 0; guard < 50; guard++) {
    const r = await j(
      await fetch(`${HOST}/api/needs?from=${NOW}&limit=500`, { headers: { cookie } }),
    );
    const list = r.ok ? r.data.needs : [];
    if (list.length === 0) break;
    let batch = [];
    for (const n of list) {
      batch.push(
        fetch(`${HOST}/api/needs/${n.id}`, { method: 'DELETE', headers: { cookie } }),
      );
      if (batch.length >= 15) {
        await Promise.all(batch);
        batch = [];
      }
    }
    if (batch.length) await Promise.all(batch);
    removed += list.length;
    if (list.length < 500) break;
  }
  return removed;
}

async function fillAccount(email) {
  const cookie = await login(email);
  const meRes = await j(await fetch(`${HOST}/api/me`, { headers: { cookie } }));
  const businessType = meRes.ok ? meRes.data.user.business_type : 'default';
  const menusRes = await j(await fetch(`${HOST}/api/menus`, { headers: { cookie } }));
  const menus = menusRes.ok ? menusRes.data.menus : [];
  if (menus.length === 0) {
    console.log(`  [${email}] 메뉴 없음 — 스킵`);
    await fetch(`${HOST}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    return;
  }

  // 기존 30일 일평균 측정 → 미래 윈도우만큼만 비례해서 채움 (업태별 페이스 자동 반영).
  const F30 = NOW - 30 * 86_400_000;
  const pastR = await j(
    await fetch(`${HOST}/api/sales?from=${F30}&to=${NOW}&limit=1`, { headers: { cookie } }),
  );
  const past30Total = pastR.ok ? pastR.data.total ?? 0 : 0;
  const dailyRate = past30Total / 30;
  const salesCount = Math.max(2, Math.round(dailyRate * WINDOW_DAYS));
  // 니즈는 판매의 약 15% (옷가게처럼 일평균 5건이면 1~2건만 들어가게)
  const needsCount = Math.max(1, Math.round(salesCount * 0.15));

  const wipedSales = await wipeFutureSales(cookie);
  const wipedNeeds = await wipeFutureNeeds(cookie);

  const PURPOSE = PURPOSE_BY_TYPE[businessType] ?? PURPOSE_BY_TYPE.default;
  const CHILD = CHILD_BY_TYPE[businessType] ?? CHILD_BY_TYPE.default;

  // 판매
  let salesOk = 0;
  let batch = [];
  for (let i = 0; i < salesCount; i++) {
    const menu = menus[Math.floor(Math.random() * menus.length)];
    batch.push(
      fetch(`${HOST}/api/sales`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          menuId: menu.id,
          quantity: wpick(QTY),
          soldAt: rndBusinessMs(),
        }),
      }).then((r) => {
        if (r.ok) salesOk++;
      }),
    );
    if (batch.length >= 15) {
      await Promise.all(batch);
      batch = [];
    }
  }
  if (batch.length) await Promise.all(batch);

  // 니즈
  const menuIdsAll = menus.map((m) => m.id);
  let needsOk = 0;
  batch = [];
  for (let i = 0; i < needsCount; i++) {
    const want = Math.min(wpick(N_MENUS), menuIdsAll.length);
    const picked = [];
    let g = 0;
    while (picked.length < want && g++ < 50) {
      const m = menuIdsAll[Math.floor(Math.random() * menuIdsAll.length)];
      if (!picked.includes(m)) picked.push(m);
    }
    batch.push(
      fetch(`${HOST}/api/needs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          gender: wpick(GENDER),
          ageBand: wpick(AGE),
          withChild: wpick(CHILD),
          purpose: wpick(PURPOSE),
          residence: wpick(RESID),
          menuIds: picked,
          createdAt: rndBusinessMs(),
        }),
      }).then((r) => {
        if (r.ok) needsOk++;
      }),
    );
    if (batch.length >= 15) {
      await Promise.all(batch);
      batch = [];
    }
  }
  if (batch.length) await Promise.all(batch);

  await fetch(`${HOST}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  console.log(
    `  [${email}] (${businessType}, 일평균 ${dailyRate.toFixed(1)}건) ` +
      `기존 미래(판매 ${wipedSales}/니즈 ${wipedNeeds}) 삭제 → ` +
      `신규 판매 ${salesOk}/${salesCount}, 니즈 ${needsOk}/${needsCount}`,
  );
}

async function main() {
  console.log(`미래 데이터 시드 → ${HOST}`);
  console.log(
    `  window: ${new Date(NOW).toLocaleString('ko-KR')} → ${new Date(TARGET_END).toLocaleString('ko-KR')}`,
  );
  for (const g of GUESTS) await fillAccount(g);
  console.log('완료.');
}

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
