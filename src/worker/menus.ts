import { Env, ok, err, MenuRow, SessionUser } from './types';

const safeJson = async <T>(req: Request): Promise<T | null> => {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
};

const cleanEmoji = (e: string | undefined | null): string => {
  if (!e) return '📦';
  const t = e.trim();
  return t || '📦';
};

const validateMenu = (b: {
  name?: string;
  cost?: number;
  price?: number;
}): string | null => {
  if (!b.name || !b.name.trim()) return '메뉴 이름을 입력해주세요.';
  if (b.cost == null || !Number.isInteger(b.cost) || b.cost < 0)
    return '원가는 0원 이상의 정수여야 합니다.';
  if (b.price == null || !Number.isInteger(b.price) || b.price < 0)
    return '판매가는 0원 이상의 정수여야 합니다.';
  return null;
};

export const handleMenus = async (
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
): Promise<Response> => {
  // GET /api/menus
  if (rest === '' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM menus
       WHERE user_id = ? AND archived = 0
       ORDER BY display_order ASC, id ASC`,
    )
      .bind(user.id)
      .all<MenuRow>();
    return ok({ menus: results });
  }

  // POST /api/menus
  if (rest === '' && request.method === 'POST') {
    const body = await safeJson<{
      name: string;
      category?: string;
      cost: number;
      price: number;
      emoji?: string;
    }>(request);
    if (!body) return err('잘못된 요청입니다.');
    const v = validateMenu(body);
    if (v) return err(v);
    const orderRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM menus WHERE user_id = ?',
    )
      .bind(user.id)
      .first<{ next_order: number }>();
    const now = Date.now();
    const r = await env.DB.prepare(
      `INSERT INTO menus (user_id, name, category, cost, price, emoji, display_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        body.name.trim(),
        body.category?.trim() || null,
        body.cost,
        body.price,
        cleanEmoji(body.emoji),
        orderRow?.next_order ?? 1,
        now,
      )
      .run();
    const id = Number(r.meta.last_row_id);
    const created = await env.DB.prepare('SELECT * FROM menus WHERE id = ?')
      .bind(id)
      .first<MenuRow>();
    return ok({ menu: created });
  }

  // /:id 또는 /:id/* 형태
  const idMatch = rest.match(/^\/(\d+)(\/[a-z]+)?$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    const sub = idMatch[2] ?? '';

    const owned = await env.DB.prepare(
      'SELECT id FROM menus WHERE id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .first();
    if (!owned) return err('메뉴를 찾을 수 없습니다.', 404);

    // PUT /api/menus/:id — 수정
    if (sub === '' && request.method === 'PUT') {
      const body = await safeJson<{
        name: string;
        category?: string;
        cost: number;
        price: number;
        emoji?: string;
      }>(request);
      if (!body) return err('잘못된 요청입니다.');
      const v = validateMenu(body);
      if (v) return err(v);
      await env.DB.prepare(
        `UPDATE menus SET name = ?, category = ?, cost = ?, price = ?, emoji = ?
         WHERE id = ? AND user_id = ?`,
      )
        .bind(
          body.name.trim(),
          body.category?.trim() || null,
          body.cost,
          body.price,
          cleanEmoji(body.emoji),
          id,
          user.id,
        )
        .run();
      const updated = await env.DB.prepare('SELECT * FROM menus WHERE id = ?')
        .bind(id)
        .first<MenuRow>();
      return ok({ menu: updated });
    }

    // DELETE /api/menus/:id — archived = 1
    if (sub === '' && request.method === 'DELETE') {
      await env.DB.prepare(
        'UPDATE menus SET archived = 1 WHERE id = ? AND user_id = ?',
      )
        .bind(id, user.id)
        .run();
      return ok({});
    }

    // POST /api/menus/:id/up | /down — 같은 카테고리 안에서만 swap
    if ((sub === '/up' || sub === '/down') && request.method === 'POST') {
      const dir = sub === '/up' ? -1 : 1;
      const cur = await env.DB.prepare(
        'SELECT display_order, category FROM menus WHERE id = ? AND user_id = ?',
      )
        .bind(id, user.id)
        .first<{ display_order: number; category: string | null }>();
      if (!cur) return err('메뉴를 찾을 수 없습니다.', 404);
      const neighbor = await env.DB.prepare(
        `SELECT id, display_order FROM menus
         WHERE user_id = ?
           AND archived = 0
           AND COALESCE(category, '') = COALESCE(?, '')
           AND display_order ${dir < 0 ? '<' : '>'} ?
         ORDER BY display_order ${dir < 0 ? 'DESC' : 'ASC'}
         LIMIT 1`,
      )
        .bind(user.id, cur.category, cur.display_order)
        .first<{ id: number; display_order: number }>();
      if (!neighbor) return ok({});
      await env.DB.batch([
        env.DB.prepare('UPDATE menus SET display_order = ? WHERE id = ?').bind(
          neighbor.display_order,
          id,
        ),
        env.DB.prepare('UPDATE menus SET display_order = ? WHERE id = ?').bind(
          cur.display_order,
          neighbor.id,
        ),
      ]);
      return ok({});
    }
  }

  return err('찾을 수 없는 경로입니다.', 404);
};
