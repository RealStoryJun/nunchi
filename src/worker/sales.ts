import { Env, ok, err, SessionUser, SaleRow, MenuRow } from './types';

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
  // GET /api/sales?from=&to=&limit=
  if (rest === '' && request.method === 'GET') {
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const conds = ['s.user_id = ?'];
    const args: (string | number)[] = [user.id];
    if (fromQ) {
      conds.push('s.sold_at >= ?');
      args.push(Number(fromQ));
    }
    if (toQ) {
      conds.push('s.sold_at <= ?');
      args.push(Number(toQ));
    }
    args.push(limit);
    const { results } = await env.DB.prepare(
      `SELECT s.*, m.name AS menu_name, m.emoji AS menu_emoji
       FROM sales s LEFT JOIN menus m ON m.id = s.menu_id
       WHERE ${conds.join(' AND ')}
       ORDER BY s.sold_at DESC, s.id DESC
       LIMIT ?`,
    )
      .bind(...args)
      .all<SaleWithMenu>();
    return ok({ sales: results });
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

  // DELETE /api/sales/:id
  const m = rest.match(/^\/(\d+)$/);
  if (m && request.method === 'DELETE') {
    const id = Number(m[1]);
    const r = await env.DB.prepare(
      'DELETE FROM sales WHERE id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .run();
    if (!r.meta.changes) return err('판매 기록을 찾을 수 없습니다.', 404);
    return ok({});
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
