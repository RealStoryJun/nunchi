import { Env, ok, err, SessionUser } from './types';

// 월별 고정 지출 - 사장님 본인 데이터만, 매월 자유 라벨+금액 N행.
// PUT은 그 달 항목 전체 교체(diff X), copy-from-previous는 직전 캘린더 월의 행을 복사.

interface ItemRow {
  id: number;
  label: string;
  amount: number;
  sort_order: number;
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_ITEMS = 30;
const MAX_AMOUNT = 1_000_000_000; // 10억 (원 단위)
const MAX_LABEL_LEN = 20;

function prevYearMonth(ym: string): string {
  // 'YYYY-MM' → 직전 캘린더 월 'YYYY-MM'
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

interface InputItem {
  label: string;
  amount: number;
  sort_order?: number;
}

function sanitizeItems(raw: unknown): { items: InputItem[] } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '잘못된 요청입니다.' };
  const arr = (raw as { items?: unknown }).items;
  if (!Array.isArray(arr)) return { error: '항목 목록이 필요해요.' };
  if (arr.length > MAX_ITEMS) return { error: `한 달에 ${MAX_ITEMS}개까지 등록할 수 있어요.` };
  const out: InputItem[] = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    if (!x || typeof x !== 'object') return { error: '항목 형식이 올바르지 않아요.' };
    const o = x as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (label.length === 0) continue; // 빈 행은 자연스럽게 제외
    if (label.length > MAX_LABEL_LEN)
      return { error: `라벨은 ${MAX_LABEL_LEN}자 이내로 적어주세요.` };
    // 라벨이 있는데 금액이 빠진 행은 의도된 빈 칸 - 조용히 제외 (null/undefined/'' 모두)
    if (o.amount === null || o.amount === undefined || o.amount === '') continue;
    const amountN = Number(o.amount);
    if (!Number.isFinite(amountN) || !Number.isInteger(amountN))
      return { error: '금액은 정수여야 해요.' };
    if (amountN < 0 || amountN > MAX_AMOUNT)
      return { error: '금액은 0원 이상, 10억원 이하여야 해요.' };
    let sortOrder = Number(o.sort_order);
    if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) sortOrder = i;
    if (sortOrder < 0 || sortOrder > 999) sortOrder = i;
    out.push({ label, amount: amountN, sort_order: sortOrder });
  }
  return { items: out };
}

async function readMonth(
  env: Env,
  userId: number,
  ym: string,
): Promise<{ items: ItemRow[]; total: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, label, amount, sort_order
     FROM monthly_cost_items
     WHERE user_id = ? AND year_month = ?
     ORDER BY sort_order ASC, id ASC`,
  )
    .bind(userId, ym)
    .all<ItemRow>();
  const items = results ?? [];
  const total = items.reduce((s, x) => s + x.amount, 0);
  return { items, total };
}

export async function handleMonthlyCosts(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
): Promise<Response> {
  // GET /api/monthly-costs?ym=YYYY-MM
  if (rest === '' && request.method === 'GET') {
    const ym = url.searchParams.get('ym') ?? '';
    if (!YM_RE.test(ym)) return err('잘못된 월 형식이에요.');
    return ok(await readMonth(env, user.id, ym));
  }

  // PUT /api/monthly-costs?ym=YYYY-MM - 그 달 전체 교체 (트랜잭션)
  if (rest === '' && request.method === 'PUT') {
    const ym = url.searchParams.get('ym') ?? '';
    if (!YM_RE.test(ym)) return err('잘못된 월 형식이에요.');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return err('잘못된 요청입니다.');
    }
    const parsed = sanitizeItems(body);
    if ('error' in parsed) return err(parsed.error);
    const now = Date.now();
    const stmts = [
      env.DB.prepare(
        `DELETE FROM monthly_cost_items WHERE user_id = ? AND year_month = ?`,
      ).bind(user.id, ym),
      ...parsed.items.map((it) =>
        env.DB.prepare(
          `INSERT INTO monthly_cost_items (user_id, year_month, label, amount, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(user.id, ym, it.label, it.amount, it.sort_order, now),
      ),
    ];
    await env.DB.batch(stmts);
    // 그 ym 저장 인사이트는 고정비 합계가 변했으므로 stale - 삭제(다음 조회 시 새로 생성)
    await env.DB.prepare(
      'DELETE FROM ai_insights WHERE user_id = ? AND year_month = ?',
    )
      .bind(user.id, ym)
      .run();
    return ok(await readMonth(env, user.id, ym));
  }

  // POST /api/monthly-costs/copy-from-previous?ym=YYYY-MM - 직전 월 복사. 이미 차 있으면 409.
  if (rest === '/copy-from-previous' && request.method === 'POST') {
    const ym = url.searchParams.get('ym') ?? '';
    if (!YM_RE.test(ym)) return err('잘못된 월 형식이에요.');
    const existing = await readMonth(env, user.id, ym);
    if (existing.items.length > 0) return err('이미 항목이 있어요.', 409);
    const prevYm = prevYearMonth(ym);
    const prev = await readMonth(env, user.id, prevYm);
    if (prev.items.length === 0) return err('지난 달 데이터가 없어요.', 404);
    const now = Date.now();
    const stmts = prev.items.map((it) =>
      env.DB.prepare(
        `INSERT INTO monthly_cost_items (user_id, year_month, label, amount, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(user.id, ym, it.label, it.amount, it.sort_order, now),
    );
    await env.DB.batch(stmts);
    return ok(await readMonth(env, user.id, ym));
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
