import { Env, ok, err, SessionUser, SaleRow, MenuRow } from './types';
import { msToYmKst } from './insights';

// 과거 월 AI 인사이트 저장본은 그 월 판매가 변하면 stale — 해당 ym 행 삭제(다음 조회 시 새로 생성).
// 'this 달'(아직 ai_insights에 저장 안 됨)이면 DELETE 0 rows라 비용 무시 가능.
const invalidateInsightsForMonth = (env: Env, userId: number, soldAt: number) =>
  env.DB.prepare('DELETE FROM ai_insights WHERE user_id = ? AND year_month = ?')
    .bind(userId, msToYmKst(soldAt))
    .run();

const safeJson = async <T>(req: Request): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};

interface SaleWithMenu extends SaleRow {
  menu_name: string;
  menu_emoji: string | null;
}

export const handleSales = async (
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
): Promise<Response> => {
  // GET /api/sales?from=&to=&limit=&cursorAt=&cursorId=
  // 커서 페이지네이션 — 정렬 sold_at DESC, id DESC. cursorAt/cursorId = 이전 페이지 마지막 항목 → 그 다음부터.
  // limit+1로 hasMore 판정. 첫 페이지(커서 없음)일 때만 기간 내 전체 건수(total)도 함께 반환.
  if (rest === '' && request.method === 'GET') {
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const limN = Number(url.searchParams.get('limit') ?? 30);
    const limit = Math.min(Math.max(Number.isFinite(limN) ? limN : 30, 1), 100);
    const cursorAt = url.searchParams.get('cursorAt');
    const cursorId = url.searchParams.get('cursorId');
    // 기간 필터 — 목록/COUNT 둘 다 쓰므로 따로 보관
    const baseConds = ['s.user_id = ?'];
    const baseArgs: number[] = [user.id];
    if (fromQ) {
      baseConds.push('s.sold_at >= ?');
      baseArgs.push(Number(fromQ));
    }
    if (toQ) {
      baseConds.push('s.sold_at <= ?');
      baseArgs.push(Number(toQ));
    }
    const hasCursor = !!cursorAt && !!cursorId; // 빈 문자열도 "커서 없음" 취급 (total 누락 방지)
    const conds = [...baseConds];
    const args: number[] = [...baseArgs];
    if (hasCursor) {
      conds.push('(s.sold_at < ? OR (s.sold_at = ? AND s.id < ?))');
      args.push(Number(cursorAt), Number(cursorAt), Number(cursorId));
    }
    const { results } = await env.DB.prepare(
      `SELECT s.*, m.name AS menu_name, m.emoji AS menu_emoji
       FROM sales s LEFT JOIN menus m ON m.id = s.menu_id
       WHERE ${conds.join(' AND ')}
       ORDER BY s.sold_at DESC, s.id DESC
       LIMIT ?`,
    )
      .bind(...args, limit + 1)
      .all<SaleWithMenu>();
    const hasMore = results.length > limit;
    const sales = hasMore ? results.slice(0, limit) : results;
    let total: number | undefined;
    if (!hasCursor) {
      const c = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM sales s WHERE ${baseConds.join(' AND ')}`,
      )
        .bind(...baseArgs)
        .first<{ n: number }>();
      total = c?.n ?? sales.length;
    }
    return ok(total !== undefined ? { sales, hasMore, total } : { sales, hasMore });
  }

  // POST /api/sales
  if (rest === '' && request.method === 'POST') {
    const body = await safeJson<{ menuId: number; quantity?: number; soldAt?: number }>(
      request,
    );
    if (!body || !body.menuId) return err('메뉴를 선택해주세요.');
    const quantity = body.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1)
      return err('수량은 1 이상의 정수여야 합니다.');
    const menu = await env.DB.prepare(
      'SELECT * FROM menus WHERE id = ? AND user_id = ?',
    )
      .bind(body.menuId, user.id)
      .first<MenuRow>();
    if (!menu) return err('메뉴를 찾을 수 없습니다.', 404);
    const soldAt = body.soldAt ?? Date.now();
    const r = await env.DB.prepare(
      `INSERT INTO sales (user_id, menu_id, quantity, cost_at_sale, price_at_sale, sold_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(user.id, menu.id, quantity, menu.cost, menu.price, soldAt)
      .run();
    await invalidateInsightsForMonth(env, user.id, soldAt);
    return ok({
      sale: {
        id: Number(r.meta.last_row_id),
        user_id: user.id,
        menu_id: menu.id,
        quantity,
        cost_at_sale: menu.cost,
        price_at_sale: menu.price,
        sold_at: soldAt,
        menu_name: menu.name,
        menu_emoji: menu.emoji,
      },
    });
  }

  // PUT /api/sales/:id — 수량 수정 (cost/price 스냅샷은 유지)
  const mPut = rest.match(/^\/(\d+)$/);
  if (mPut && request.method === 'PUT') {
    const id = Number(mPut[1]);
    const body = await safeJson<{ quantity: number }>(request);
    if (!body) return err('잘못된 요청입니다.');
    const quantity = body.quantity;
    if (!Number.isInteger(quantity) || quantity < 1)
      return err('수량은 1 이상의 정수여야 합니다.');
    // 판매가 속한 월의 인사이트를 무효화하려면 sold_at을 먼저 알아야 함
    const existing = await env.DB.prepare(
      'SELECT sold_at FROM sales WHERE id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .first<{ sold_at: number }>();
    if (!existing) return err('판매 기록을 찾을 수 없습니다.', 404);
    await env.DB.prepare(
      'UPDATE sales SET quantity = ? WHERE id = ? AND user_id = ?',
    )
      .bind(quantity, id, user.id)
      .run();
    await invalidateInsightsForMonth(env, user.id, existing.sold_at);
    return ok({});
  }

  // DELETE /api/sales/:id
  const m = rest.match(/^\/(\d+)$/);
  if (m && request.method === 'DELETE') {
    const id = Number(m[1]);
    // 삭제 전에 sold_at 확보 — 삭제 후엔 알 수 없음
    const existing = await env.DB.prepare(
      'SELECT sold_at FROM sales WHERE id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .first<{ sold_at: number }>();
    if (!existing) return err('판매 기록을 찾을 수 없습니다.', 404);
    await env.DB.prepare('DELETE FROM sales WHERE id = ? AND user_id = ?')
      .bind(id, user.id)
      .run();
    await invalidateInsightsForMonth(env, user.id, existing.sold_at);
    return ok({});
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
