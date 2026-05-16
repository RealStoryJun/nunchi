import type { Env } from '../types';
import { ok, err } from '../types';

// 어드민 시스템 통계: 사용자·매출·니즈·AI 호출 카운트 (데모 계정 제외).

export async function handleAdminStats(
  rest: string,
  request: Request,
  env: Env,
): Promise<Response> {
  // GET /api/admin/stats - 시스템 통계 (데모 계정 제외)
  if (rest === '/stats' && request.method === 'GET') {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const ym = (() => {
      const d = new Date(now + 9 * 3600 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    const [totalUsers, demoUsers, weekNew, totalSales, totalNeeds, monthAi] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 0').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1').first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM users WHERE is_demo = 0 AND created_at >= ?',
      ).bind(weekAgo).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM sales s JOIN users u ON u.id = s.user_id WHERE u.is_demo = 0`,
      ).first<{ n: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM customer_needs cn JOIN users u ON u.id = cn.user_id WHERE u.is_demo = 0`,
      ).first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM ai_usage_log WHERE year_month = ?',
      ).bind(ym).first<{ n: number }>(),
    ]);
    return ok({
      total_users: totalUsers?.n ?? 0,
      demo_users: demoUsers?.n ?? 0,
      week_new_users: weekNew?.n ?? 0,
      total_sales: totalSales?.n ?? 0,
      total_needs: totalNeeds?.n ?? 0,
      month_ai_calls: monthAi?.n ?? 0,
      year_month: ym,
    });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
