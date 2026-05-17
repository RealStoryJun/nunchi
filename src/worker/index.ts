import { Env, err, ok, isBusinessType, SECURITY_HEADERS } from './types';
import { handleAuth } from './auth';
import { handleMenus } from './menus';
import { handleSales } from './sales';
import { handleStats } from './stats';
import { handleInferEmoji } from './emoji';
import { handleInsights, handleInsightsGet } from './insights';
import { handleAdmin } from './admin';
import { handleNeeds } from './needs';
import { handleMonthlyCosts } from './monthly-costs';
import { handlePush } from './push-routes';
import { getSessionUser } from './session';

export default {
  // 매시 0분 cleanup - 만료된 세션·1시간+ auth_attempts·만료된 2FA pending·13개월+ AI usage 로그
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const ATTEMPT_WINDOW = 60 * 60 * 1000;
    const AI_LOG_RETENTION = 13 * 31 * 24 * 60 * 60 * 1000; // 13개월
    const LOGIN_EVENT_RETENTION = 90 * 24 * 60 * 60 * 1000; // 90일
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM auth_attempts WHERE attempted_at < ?').bind(
        now - ATTEMPT_WINDOW,
      ),
      env.DB.prepare('DELETE FROM auth_pending WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM ai_usage_log WHERE at < ?').bind(now - AI_LOG_RETENTION),
      env.DB.prepare('DELETE FROM user_login_events WHERE at < ?').bind(now - LOGIN_EVENT_RETENTION),
    ]);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // www.nunchicheck.kr → nunchicheck.kr 301 정규화 (사장님 결정: root 정규화).
    // 옛 워커 도메인 nunchi.realstoryjun.workers.dev는 그대로 둠 (둘 다 작동).
    if (url.hostname === 'www.nunchicheck.kr') {
      url.hostname = 'nunchicheck.kr';
      return Response.redirect(url.toString(), 301);
    }

    if (!path.startsWith('/api/')) {
      // 정적 자산도 보안 헤더 일괄 추가 - HTML/CSS/JS 모두 적용
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    try {
      // /api/auth/* - 인증 불필요
      if (path.startsWith('/api/auth/')) {
        return await handleAuth(request, env, path.replace('/api/auth', ''), ctx);
      }

      // 그 외는 모두 인증 필요
      const session = await getSessionUser(request, env);

      if (path === '/api/me') {
        return await handleAuth(request, env, '/me', ctx);
      }

      if (!session) return err('로그인이 필요합니다.', 401);

      // 사용 기간 만료 시 read-only 모드. master 는 무제한, GET/HEAD 면제, admin endpoint 면제.
      // onboarding 면제는 명시 화이트리스트 (prefix 면제하면 향후 신규 endpoint 자동 우회).
      // push 면제: 만료돼도 디바이스 알림 등록·해제는 정책상 자유.
      if (
        !session.user.is_master &&
        session.user.access_until != null &&
        session.user.access_until < Date.now() &&
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        !path.startsWith('/api/admin/') &&
        path !== '/api/admin' &&
        path !== '/api/me/business-type' &&
        path !== '/api/me/business-name' &&
        !path.startsWith('/api/push')
      ) {
        return err('사용 기간이 만료됐어요. 관리자에게 문의해주세요.', 403);
      }

      if (path === '/api/admin' || path.startsWith('/api/admin/')) {
        return await handleAdmin(
          request,
          env,
          session.user,
          path.replace('/api/admin', ''),
          url,
          session.token,
        );
      }

      if (path === '/api/infer-emoji' && request.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        return await handleInferEmoji(env, session.user.id, name);
      }

      if (path === '/api/insights' && request.method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err('잘못된 요청입니다.');
        }
        return await handleInsights(env, session.user.id, body);
      }

      // 저장된 과거 월 인사이트 조회 - LLM 호출 X, 빠른 readonly. 현재 월은 항상 found:false.
      if (path === '/api/insights' && request.method === 'GET') {
        const ym = url.searchParams.get('ym') ?? '';
        return await handleInsightsGet(env, session.user.id, ym);
      }

      if (path === '/api/push' || path.startsWith('/api/push/')) {
        return await handlePush(
          request,
          env,
          session.user,
          path.replace('/api/push', ''),
        );
      }

      if (path === '/api/needs' || path.startsWith('/api/needs/')) {
        return await handleNeeds(
          request,
          env,
          session.user,
          path.replace('/api/needs', ''),
          url,
        );
      }

      if (path === '/api/monthly-costs' || path.startsWith('/api/monthly-costs/')) {
        return await handleMonthlyCosts(
          request,
          env,
          session.user,
          path.replace('/api/monthly-costs', ''),
          url,
        );
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
        // 업종 톤이 인사이트에 강하게 묶여 있어 과거 저장본 모두 무효화 - 다음 조회 시 재생성
        await env.DB.prepare('DELETE FROM ai_insights WHERE user_id = ?')
          .bind(session.user.id)
          .run();
        return ok({ business_type: bt });
      }

      if (path === '/api/me/business-name' && request.method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return err('잘못된 요청입니다.');
        }
        const raw = (body as { businessName?: unknown })?.businessName;
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (!name) return err('가게 이름을 입력해주세요.');
        if (name.length > 40) return err('가게 이름은 40자 이내로 입력해주세요.');
        await env.DB.prepare('UPDATE users SET business_name = ? WHERE id = ?')
          .bind(name, session.user.id)
          .run();
        return ok({ business_name: name });
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
