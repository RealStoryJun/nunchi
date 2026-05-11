import { Env, ok, err, SessionUser } from './types';

// 어드민 전용 — 계정 관리. 모든 핸들러는 is_admin 검증을 통과한 뒤에만 실행된다.

interface AdminUserRow {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin: number;
  created_at: number;
  sales_count: number;
  menu_count: number;
}

export async function handleAdmin(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string, // '/api/admin' 이후 경로 (예: '/users')
  url: URL,
): Promise<Response> {
  if (!user.is_admin) return err('관리자 권한이 필요합니다.', 403);

  // GET /api/admin/users?q=검색어 — 이메일/가게이름 부분 일치
  if (rest === '/users' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.business_name, u.business_type, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM sales WHERE user_id = u.id) AS sales_count,
              (SELECT COUNT(*) FROM menus WHERE user_id = u.id AND archived = 0) AS menu_count
       FROM users u
       WHERE ? = '' OR u.email LIKE ? ESCAPE '\\' OR u.business_name LIKE ? ESCAPE '\\'
       ORDER BY u.created_at DESC
       LIMIT 500`,
    )
      .bind(q, like, like)
      .all<AdminUserRow>();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    return ok({
      users: results.map((r) => ({ ...r, is_admin: !!r.is_admin })),
      total: total?.n ?? results.length,
    });
  }

  // POST /api/admin/users/delete  { ids: number[] } — 일괄 삭제 (본인 계정은 제외)
  if (rest === '/users/delete' && request.method === 'POST') {
    let body: { ids?: unknown } | null = null;
    try {
      body = (await request.json()) as { ids?: unknown };
    } catch {
      return err('잘못된 요청입니다.');
    }
    const raw = Array.isArray(body?.ids) ? body!.ids : [];
    const requested = [
      ...new Set(
        raw
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, 500);
    const ids = requested.filter((n) => n !== user.id);
    const skippedSelf = ids.length !== requested.length;
    if (ids.length === 0) return ok({ deleted: 0, skippedSelf });

    const ph = ids.map(() => '?').join(',');
    // 자식 행 → 사용자 순으로 삭제 (FK CASCADE가 있어도 명시적으로)
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sales WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM menus WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM users WHERE id IN (${ph})`).bind(...ids),
    ]);
    return ok({ deleted: ids.length, skippedSelf });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
