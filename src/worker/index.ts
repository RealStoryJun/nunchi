import { Env, err } from './types';
import { handleAuth } from './auth';
import { handleMenus } from './menus';
import { handleSales } from './sales';
import { handleStats } from './stats';
import { getSessionUser } from './session';

export default {
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
