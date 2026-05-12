// 고객 니즈 샘플 데이터 시드 — guest1~5에 각각 ~250건, 최근 3개월(92일)에 분산.
// 재실행 안전: 각 계정의 기존 니즈 기록을 먼저 모두 삭제하고 새로 채움. 판매·메뉴는 안 건드림.
// 실행: node scripts/seed-needs.mjs

const HOST = process.env.NUNCHI_HOST || 'https://nunchi.realstoryjun.workers.dev';
const PW = '1q2w3e4r!@';
const DAY = 86_400_000;
const GUESTS = ['guest1', 'guest2', 'guest3', 'guest4', 'guest5'].map(
  (g) => `${g}@nunchi.app`,
);
const PER_ACCOUNT = 250;
const HISTORY_DAYS = 92;

const rnd = (a, b) => a + Math.random() * (b - a);
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

const GENDER = [['female', 55], ['male', 45]];
const AGE = [['10s_20s', 28], ['30s_40s', 48], ['50plus', 24]];
const CHILD = [[true, 22], [false, 70], [null, 8]];
const PURPOSE = [['meal_replacement', 40], ['gift', 25], ['kids_snack', 20], [null, 15]];
const RESID = [['busan', 74], ['outside', 26]];
const N_MENUS = [[1, 56], [2, 30], [3, 11], [4, 3]];

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

async function wipeNeeds(cookie) {
  let removed = 0;
  for (let guard = 0; guard < 50; guard++) {
    const r = await j(await fetch(`${HOST}/api/needs?limit=500`, { headers: { cookie } }));
    const list = r.ok ? r.data.needs : [];
    if (list.length === 0) break;
    let batch = [];
    for (const n of list) {
      batch.push(fetch(`${HOST}/api/needs/${n.id}`, { method: 'DELETE', headers: { cookie } }));
      if (batch.length >= 15) { await Promise.all(batch); batch = []; }
    }
    if (batch.length) await Promise.all(batch);
    removed += list.length;
    if (list.length < 500) break;
  }
  return removed;
}

async function seedAccount(email) {
  const cookie = await login(email);
  const menusRes = await j(await fetch(`${HOST}/api/menus`, { headers: { cookie } }));
  const menuIds = menusRes.ok ? menusRes.data.menus.map((m) => m.id) : [];
  const wiped = await wipeNeeds(cookie);
  const now = Date.now();
  let okCount = 0;
  let batch = [];
  for (let i = 0; i < PER_ACCOUNT; i++) {
    // 메뉴 1~4개 무작위 (중복 없이)
    const want = menuIds.length ? Math.min(wpick(N_MENUS), menuIds.length) : 0;
    const picked = [];
    let guard = 0;
    while (picked.length < want && guard++ < 50) {
      const m = menuIds[Math.floor(Math.random() * menuIds.length)];
      if (!picked.includes(m)) picked.push(m);
    }
    const body = {
      gender: wpick(GENDER),
      ageBand: wpick(AGE),
      withChild: wpick(CHILD),
      purpose: wpick(PURPOSE),
      residence: wpick(RESID),
      menuIds: picked,
      createdAt: now - Math.floor(rnd(0, HISTORY_DAYS * DAY)),
    };
    batch.push(
      fetch(`${HOST}/api/needs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }).then((r) => {
        if (r.ok) okCount++;
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
    `  [${email}] 기존 ${wiped}건 삭제, 신규 ${okCount}/${PER_ACCOUNT}건 (메뉴 풀 ${menuIds.length}개)`,
  );
}

async function main() {
  console.log(`고객 니즈 샘플 시드 시작 → ${HOST}  (계정당 ${PER_ACCOUNT}건, 최근 ${HISTORY_DAYS}일)`);
  for (const g of GUESTS) await seedAccount(g);
  console.log('완료.');
}

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
