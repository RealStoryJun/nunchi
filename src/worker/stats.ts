import { Env, ok, SessionUser } from './types';

interface ByMenuRow {
  menu_id: number;
  name: string;
  emoji: string | null;
  category: string | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByDayRow {
  day: string;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByCatRow {
  category: string;
  revenue: number;
  cost: number;
  profit: number;
}
interface ByHourRow {
  hour: number;
  revenue: number;
  qty: number;
}
interface TotalRow {
  revenue: number | null;
  cost: number | null;
  qty: number | null;
}

export const handleStats = async (
  _request: Request,
  env: Env,
  user: SessionUser,
  url: URL,
): Promise<Response> => {
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const tzOffsetMin = Number(url.searchParams.get('tz') ?? 0); // 분 단위
  const conds = ['user_id = ?'];
  const args: (string | number)[] = [user.id];
  if (fromQ) {
    conds.push('sold_at >= ?');
    args.push(Number(fromQ));
  }
  if (toQ) {
    conds.push('sold_at <= ?');
    args.push(Number(toQ));
  }
  const where = conds.join(' AND ');

  // 합계
  const total = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(price_at_sale * quantity), 0) AS revenue,
       COALESCE(SUM(cost_at_sale * quantity), 0) AS cost,
       COALESCE(SUM(quantity), 0) AS qty
     FROM sales WHERE ${where}`,
  )
    .bind(...args)
    .first<TotalRow>();
  const revenue = total?.revenue ?? 0;
  const cost = total?.cost ?? 0;
  const profit = revenue - cost;
  const margin = revenue > 0 ? profit / revenue : 0;

  // 품목별
  const byMenu = await env.DB.prepare(
    `SELECT s.menu_id, m.name, m.emoji, m.category,
            SUM(s.quantity) AS qty,
            SUM(s.price_at_sale * s.quantity) AS revenue,
            SUM(s.cost_at_sale * s.quantity) AS cost,
            SUM((s.price_at_sale - s.cost_at_sale) * s.quantity) AS profit
     FROM sales s LEFT JOIN menus m ON m.id = s.menu_id
     WHERE ${where.replace(/user_id/g, 's.user_id').replace(/sold_at/g, 's.sold_at')}
     GROUP BY s.menu_id, m.name, m.emoji, m.category
     ORDER BY revenue DESC`,
  )
    .bind(...args)
    .all<ByMenuRow>();

  // 일별 (UTC ms → 로컬 날짜 변환은 SQL에서, tz offset 분 단위 적용)
  // 클라이언트는 -getTimezoneOffset() 을 보냄 (KST = +540).
  // unix epoch에 +tzSec 을 더해 SQLite의 'unixepoch'를 사용자 로컬 시간으로 보정.
  const tzSec = tzOffsetMin * 60;
  const byDay = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', datetime((sold_at/1000) + ?, 'unixepoch')) AS day,
            SUM(price_at_sale * quantity) AS revenue,
            SUM(cost_at_sale * quantity) AS cost,
            SUM((price_at_sale - cost_at_sale) * quantity) AS profit
     FROM sales
     WHERE ${where}
     GROUP BY day
     ORDER BY day ASC`,
  )
    .bind(tzSec, ...args)
    .all<ByDayRow>();

  // 시간대별 (0~23시, tz 보정) — "언제 붐비나"
  const byHour = await env.DB.prepare(
    `SELECT CAST(strftime('%H', datetime((sold_at/1000) + ?, 'unixepoch')) AS INTEGER) AS hour,
            SUM(price_at_sale * quantity) AS revenue,
            SUM(quantity) AS qty
     FROM sales
     WHERE ${where}
     GROUP BY hour
     ORDER BY hour ASC`,
  )
    .bind(tzSec, ...args)
    .all<ByHourRow>();

  // 분류별
  const byCategory = await env.DB.prepare(
    `SELECT COALESCE(m.category, '미분류') AS category,
            SUM(s.price_at_sale * s.quantity) AS revenue,
            SUM(s.cost_at_sale * s.quantity) AS cost,
            SUM((s.price_at_sale - s.cost_at_sale) * s.quantity) AS profit
     FROM sales s LEFT JOIN menus m ON m.id = s.menu_id
     WHERE ${where.replace(/user_id/g, 's.user_id').replace(/sold_at/g, 's.sold_at')}
     GROUP BY category
     ORDER BY revenue DESC`,
  )
    .bind(...args)
    .all<ByCatRow>();

  return ok({
    revenue,
    cost,
    profit,
    margin,
    qty: total?.qty ?? 0,
    byMenu: byMenu.results,
    byDay: byDay.results,
    byHour: byHour.results,
    byCategory: byCategory.results,
  });
};
