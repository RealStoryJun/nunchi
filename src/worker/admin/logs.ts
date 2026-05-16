import type { Env } from '../types';
import { ok, err } from '../types';
import { isAdminVerified } from './helpers';

// 어드민 통합 로그: admin_audit_log + user_login_events + admin_push_log 한 endpoint 에서 kind 분기.
// AI 호출 집계도 같은 파일 (둘 다 read-only 모니터링 영역).

export async function handleAdminLogs(
  rest: string,
  request: Request,
  env: Env,
  url: URL,
  sessionToken: string,
): Promise<Response> {
  // GET /api/admin/audit?kind=audit|login|push&q=&from=&to=&cursor=&limit=
  // 통합 로그 탭 (2026-05-16). kind 별로 다른 테이블 조회, 응답 envelope 동일.
  // - audit: admin_audit_log (어드민 행위 11종)
  // - login: user_login_events (사용자 로그인, 새 디바이스 표시)
  // - push:  admin_push_log (어드민 푸시 발송 + sent/failed 카운트)
  // 필터: q (이메일·action 부분일치), from/to (ms epoch), cursor (id DESC)
  if (rest === '/audit' && request.method === 'GET') {
    const kindQ = url.searchParams.get('kind') ?? 'audit';
    const kind = kindQ === 'login' || kindQ === 'push' ? kindQ : 'audit';
    const limN = Number(url.searchParams.get('limit') ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(limN) ? limN : 50, 1), 200);
    const cursorQ = url.searchParams.get('cursor');
    const cursorN = cursorQ && /^\d+$/.test(cursorQ) ? Number(cursorQ) : 0;
    const cursor = Number.isSafeInteger(cursorN) && cursorN >= 0 ? cursorN : 0;
    const qRaw = url.searchParams.get('q') ?? '';
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    // LIKE escape: %, _, \\ — `\\` 로 escape, ESCAPE '\\' 절 사용
    const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => '\\' + m);
    const q = qRaw.trim().slice(0, 60); // 입력 길이 제한 (방어)
    const MAX_DATE_MS = 8.64e15;
    const fromMs = fromQ && /^\d+$/.test(fromQ) && Number.isSafeInteger(Number(fromQ)) && Number(fromQ) >= 0 && Number(fromQ) <= MAX_DATE_MS ? Number(fromQ) : null;
    const toMs = toQ && /^\d+$/.test(toQ) && Number.isSafeInteger(Number(toQ)) && Number(toQ) >= 0 && Number(toQ) <= MAX_DATE_MS ? Number(toQ) : null;

    interface BaseRow { id: number; at: number; }

    if (kind === 'audit') {
      const conds: string[] = [];
      const args: (string | number)[] = [];
      if (cursor > 0) { conds.push('a.id < ?'); args.push(cursor); }
      if (q) {
        conds.push('(u.email LIKE ? ESCAPE \'\\\\\' OR a.action LIKE ? ESCAPE \'\\\\\')');
        const pat = `%${escapeLike(q)}%`;
        args.push(pat, pat);
      }
      if (fromMs != null) { conds.push('a.at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('a.at < ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.admin_user_id, u.email AS admin_email, a.action, a.target_json,
                a.ip, a.ua, a.at, a.ok, a.error_msg
         FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
         ${where}
         ORDER BY a.id DESC LIMIT ?`,
      ).bind(...args, limit + 1).all<{
        id: number; admin_user_id: number; admin_email: string | null;
        action: string; target_json: string | null;
        ip: string | null; ua: string | null;
        at: number; ok: number; error_msg: string | null;
      }>();
      const hasMore = results.length > limit;
      const rows = hasMore ? results.slice(0, limit) : results;
      return ok({
        entries: rows.map((r) => ({ ...r, ok: !!r.ok })),
        next_cursor: hasMore ? rows[rows.length - 1].id : null,
      });
    }

    if (kind === 'login') {
      // 사용자 IP/UA 노출은 스토킹 단서가 될 수 있어 step-up 요구 (사장님 정책 "보안은 과해야").
      if (!(await isAdminVerified(env, sessionToken))) {
        return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
      }
      const conds: string[] = [];
      const args: (string | number)[] = [];
      if (cursor > 0) { conds.push('e.id < ?'); args.push(cursor); }
      if (q) {
        conds.push('u.email LIKE ? ESCAPE \'\\\\\'');
        args.push(`%${escapeLike(q)}%`);
      }
      if (fromMs != null) { conds.push('e.at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('e.at < ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT e.id, e.user_id, u.email AS user_email, e.ip, e.ua, e.is_new_device, e.at
         FROM user_login_events e LEFT JOIN users u ON u.id = e.user_id
         ${where}
         ORDER BY e.id DESC LIMIT ?`,
      ).bind(...args, limit + 1).all<{
        id: number; user_id: number; user_email: string | null;
        ip: string | null; ua: string | null; is_new_device: number; at: number;
      }>();
      const hasMore = results.length > limit;
      const rows = hasMore ? results.slice(0, limit) : results;
      return ok({
        entries: rows.map((r) => ({ ...r, is_new_device: !!r.is_new_device })),
        next_cursor: hasMore ? rows[rows.length - 1].id : null,
      });
    }

    // kind === 'push'
    const conds: string[] = [];
    const args: (string | number)[] = [];
    if (cursor > 0) { conds.push('p.id < ?'); args.push(cursor); }
    if (q) {
      conds.push('(u.email LIKE ? ESCAPE \'\\\\\' OR p.title LIKE ? ESCAPE \'\\\\\')');
      const pat = `%${escapeLike(q)}%`;
      args.push(pat, pat);
    }
    if (fromMs != null) { conds.push('p.created_at >= ?'); args.push(fromMs); }
    if (toMs != null) { conds.push('p.created_at < ?'); args.push(toMs); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.admin_user_id, u.email AS admin_email,
              p.target_kind, p.target_user_id, p.title, p.body, p.url,
              p.subscribers_sent, p.subscribers_failed,
              p.created_at AS at
       FROM admin_push_log p LEFT JOIN users u ON u.id = p.admin_user_id
       ${where}
       ORDER BY p.id DESC LIMIT ?`,
    ).bind(...args, limit + 1).all<BaseRow & {
      admin_user_id: number; admin_email: string | null;
      target_kind: string; target_user_id: number | null;
      title: string; body: string; url: string | null;
      subscribers_sent: number; subscribers_failed: number;
    }>();
    const hasMore = results.length > limit;
    const rows = hasMore ? results.slice(0, limit) : results;
    return ok({
      entries: rows,
      next_cursor: hasMore ? rows[rows.length - 1].id : null,
    });
  }

  // GET /api/admin/ai-usage?ym=YYYY-MM - 월별 AI 호출 집계 (모델·실패율·총 토큰)
  if (rest === '/ai-usage' && request.method === 'GET') {
    const ym = url.searchParams.get('ym') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return err('잘못된 월 형식이에요.');
    const { results } = await env.DB.prepare(
      `SELECT model,
              COUNT(*) AS calls,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success,
              SUM(in_tokens) AS in_tokens,
              SUM(out_tokens) AS out_tokens,
              AVG(latency_ms) AS avg_latency_ms
       FROM ai_usage_log WHERE year_month = ?
       GROUP BY model ORDER BY calls DESC`,
    )
      .bind(ym)
      .all<{
        model: string;
        calls: number;
        success: number;
        in_tokens: number | null;
        out_tokens: number | null;
        avg_latency_ms: number | null;
      }>();
    return ok({ ym, by_model: results });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
