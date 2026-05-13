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
const SALES_PER_ACCOUNT = 32; // ~22/일 × 1.5일치 정도
const NEEDS_PER_ACCOUNT = 7;

const GENDER = [['female', 55], ['male', 45]];
const AGE = [['10s_20s', 28], ['30s_40s', 48], ['50plus', 24]];
const CHILD = [[true, 22], [false, 70], [null, 8]];
const PURPOSE = [['meal_replacement', 40], ['gift', 25], ['kids_snack', 20], [null, 15]];
const RESID = [['busan', 74], ['outside', 26]];
const N_MENUS = [[1, 56], [2, 30], [3, 11], [4, 3]];
const QTY = [[1, 80], [2, 17], [3, 3]];

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
  const menusRes = await j(await fetch(`${HOST}/api/menus`, { headers: { cookie } }));
  const menus = menusRes.ok ? menusRes.data.menus : [];
  if (menus.length === 0) {
    console.log(`  [${email}] 메뉴 없음 — 스킵`);
    await fetch(`${HOST}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    return;
  }
  const wipedSales = await wipeFutureSales(cookie);
  const wipedNeeds = await wipeFutureNeeds(cookie);

  // 판매
  let salesOk = 0;
  let batch = [];
  for (let i = 0; i < SALES_PER_ACCOUNT; i++) {
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
  for (let i = 0; i < NEEDS_PER_ACCOUNT; i++) {
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
    `  [${email}] 기존 미래(판매 ${wipedSales}/니즈 ${wipedNeeds}) 삭제 → 신규 판매 ${salesOk}/${SALES_PER_ACCOUNT}, 니즈 ${needsOk}/${NEEDS_PER_ACCOUNT}`,
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
