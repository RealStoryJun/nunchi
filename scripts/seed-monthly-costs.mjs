// 데모 계정 5명에게 이번 달 고정비 시드. Bash curl이 Windows에서 한글을 CP949로 망가뜨려서
// 이 스크립트(Node.js fetch — UTF-8 깨끗)로 다시 채움. 시연 직전 한 번 돌리면 됨.
// 실행: node scripts/seed-monthly-costs.mjs

const HOST = process.env.NUNCHI_HOST || 'https://nunchi.realstoryjun.workers.dev';
const PW = '1q2w3e4r!@';

const now = new Date();
const YM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const SEED = {
  'guest1@nunchi.app': [
    { label: '임대료', amount: 1800000 },
    { label: '공과금', amount: 220000 },
    { label: '통신비', amount: 60000 },
    { label: '알바비', amount: 600000 },
  ],
  'guest2@nunchi.app': [
    { label: '임대료', amount: 2200000 },
    { label: '공과금', amount: 380000 },
    { label: '통신비', amount: 70000 },
    { label: '알바비', amount: 1500000 },
  ],
  'guest3@nunchi.app': [
    { label: '임대료', amount: 1500000 },
    { label: '공과금', amount: 250000 },
    { label: '통신비', amount: 60000 },
    { label: '재료 정기구매', amount: 100000 },
  ],
  'guest4@nunchi.app': [
    { label: '임대료', amount: 1200000 },
    { label: '공과금', amount: 100000 },
    { label: '마케팅', amount: 200000 },
  ],
  'guest5@nunchi.app': [
    { label: '임대료', amount: 2500000 },
    { label: '공과금', amount: 200000 },
    { label: '알바비', amount: 1800000 },
  ],
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

async function seedAccount(email, items) {
  const cookie = await login(email);
  const body = {
    items: items.map((it, i) => ({ ...it, sort_order: i })),
  };
  const r = await fetch(`${HOST}/api/monthly-costs?ym=${YM}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8', cookie },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  await fetch(`${HOST}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  return d.ok ? d.data.total : `error: ${d.error}`;
}

async function main() {
  console.log(`고정비 시드 (UTF-8 정확) → ${HOST} / YM=${YM}`);
  for (const [email, items] of Object.entries(SEED)) {
    const total = await seedAccount(email, items);
    console.log(`  [${email}] 합계 ${total.toLocaleString?.('ko-KR') ?? total}`);
  }
  console.log('완료.');
}

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
