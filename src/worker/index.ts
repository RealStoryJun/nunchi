import { Env, err, ok, isBusinessType } from './types';
import { handleAuth } from './auth';
import { handleMenus } from './menus';
import { handleSales } from './sales';
import { handleStats } from './stats';
import { handleInferEmoji } from './emoji';
import { getSessionUser } from './session';

export default {
  // 일 1회(03:00 UTC) 만료된 세션·오래된 auth_attempts 정리
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const ATTEMPT_WINDOW = 60 * 60 * 1000; // 1시간 이상 지난 시도 행은 정리
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM auth_attempts WHERE attempted_at < ?').bind(
        now - ATTEMPT_WINDOW,
      ),
    ]);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      // /api/auth/* — 인증 불필요
      if (path.startsWith('/api/auth/')) {
        return await handleAuth(request, env, path.replace('/api/auth', ''));
      }

      // 그 외는 모두 인증 필요
      const session = await getSessionUser(request, env);

      if (path === '/api/me') {
        return await handleAuth(request, env, '/me');
      }

      if (!session) return err('로그인이 필요합니다.', 401);

      if (path === '/api/infer-emoji' && request.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        return await handleInferEmoji(env, session.user.id, name);
      }

      if (path === '/api/me/business-type' && request.method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err('잘못된 요청입니다.');
        }
        const bt = (body as { businessType?: unknown })?.businessType;
        if (!isBusinessType(bt)) return err('지원하지 않는 업태입니다.');
        await env.DB.prepare('UPDATE users SET business_type = ? WHERE id = ?')
          .bind(bt, session.user.id)
          .run();
        return ok({ business_type: bt });
      }

      if (path === '/api/menus' || path.startsWith('/api/menus/')) {
        return await handleMenus(
          request,
          env,
          session.user,
          path.replace('/api/menus', ''),
        );
      }
      if (path === '/api/sales' || path.startsWith('/api/sales/')) {
        return await handleSales(
          request,
          env,
          session.user,
          path.replace('/api/sales', ''),
          url,
        );
      }
      if (path === '/api/stats') {
        return await handleStats(request, env, session.user, url);
      }

      return err('찾을 수 없는 경로입니다.', 404);
    } catch (e) {
      console.error('worker error', e);
      return err('서버 오류가 발생했습니다.', 500);
    }
  },
} satisfies ExportedHandler<Env>;
