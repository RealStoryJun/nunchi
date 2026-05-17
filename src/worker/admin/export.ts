import type { Env, SessionUser } from '../types';
import { err } from '../types';
import { checkRateLimit, recordAttempt, tooMany } from '../ratelimit';
import { audit, isAdminVerified } from './helpers';

// 어드민 CSV 내보내기 (판매·니즈). step-up 통과 필수, 최대 50,000 row cap, UTF-8 BOM,
// OWASP CSV formula injection 가드. 파일명 ASCII-only sanitize (헤더 인젝션 차단).

export async function handleAdminExport(
  rest: string,
  request: Request,
  env: Env,
  url: URL,
  user: SessionUser,
  sessionToken: string,
): Promise<Response> {
  // GET /api/admin/export/sales?userId=&from=&to=&ym=YYYY-MM
  // GET /api/admin/export/needs?userId=&from=&to=&ym=YYYY-MM
  // admin·master 둘 다, CSV 다운로드. 최대 50,000 row cap (worker memory 보호).
  // userId 없으면 전체, ym 있으면 그 월(KST), from/to 우선.
  // step-up 필수: 일괄 PII export 는 push 발송보다 데이터 유출 폭이 크므로 비번 재확인 요구.
  if ((rest === '/export/sales' || rest === '/export/needs') && request.method === 'GET') {
    // rate-limit: admin 토큰 탈취 시 50k row × N회 폭주 방어. 분당 5건 (push 와 동일 정책).
    const rlKey = `admin-csv-export:${user.id}`;
    const rl = await checkRateLimit(env, rlKey, 5, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterMs);
    if (!(await isAdminVerified(env, sessionToken))) {
      return err('관리자 인증이 만료되었어요. 다시 인증해주세요.', 403);
    }
    const userIdQ = url.searchParams.get('userId');
    const periodQ = url.searchParams.get('period');
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const ymQ = url.searchParams.get('ym');

    // userId 필수화 (per-account CSV 정책, 2026-05-17 사장님 결정).
    // 전체 사용자 일괄 export 는 의도 X. 어드민이 사용자 row 클릭 시 그 계정 CSV 만.
    // 검증 실패는 rate-limit budget 안 차감 (input-shape error 라 의도된 시도 아님).
    const targetUserId = userIdQ && /^\d+$/.test(userIdQ) ? Number(userIdQ) : null;
    if (!targetUserId) return err('userId 가 필요해요.');
    await recordAttempt(env, rlKey);

    // 기간 결정: period > ym > (from + to) > 무제한
    // period: current_month|prev_month|this_year|all (KST 기준)
    // Date max = ±8.64e15 ms. SQLite INTEGER 안에 들어가야 함.
    const MAX_DATE_MS = 8.64e15;
    let fromMs: number | null = null;
    let toMs: number | null = null;
    let periodLabel = '';
    if (periodQ) {
      const now = Date.now();
      const kstNow = new Date(now + 9 * 3600 * 1000);
      const thisY = kstNow.getUTCFullYear();
      const thisM = kstNow.getUTCMonth() + 1; // 1-12
      if (periodQ === 'current_month') {
        fromMs = Date.UTC(thisY, thisM - 1, 1, -9, 0, 0);
        toMs = now;
        periodLabel = `${thisY}${String(thisM).padStart(2, '0')}-current`;
      } else if (periodQ === 'prev_month') {
        const prevY = thisM === 1 ? thisY - 1 : thisY;
        const prevM = thisM === 1 ? 12 : thisM - 1;
        fromMs = Date.UTC(prevY, prevM - 1, 1, -9, 0, 0);
        toMs = Date.UTC(thisY, thisM - 1, 1, -9, 0, 0) - 1;
        periodLabel = `${prevY}${String(prevM).padStart(2, '0')}`;
      } else if (periodQ === 'this_year') {
        fromMs = Date.UTC(thisY, 0, 1, -9, 0, 0);
        toMs = now;
        periodLabel = `${thisY}-ytd`;
      } else if (periodQ === 'all') {
        fromMs = null;
        toMs = null;
        periodLabel = 'all';
      } else {
        return err('period 값이 잘못됐어요. (current_month/prev_month/this_year/all)');
      }
    } else if (ymQ && /^\d{4}-(0[1-9]|1[0-2])$/.test(ymQ)) {
      // YYYY-MM (KST 기준, backward compat). sales.ts/stats.ts 의 <= 와 일관.
      const [y, m] = ymQ.split('-').map(Number);
      const startKst = Date.UTC(y, m - 1, 1, -9, 0, 0);
      const endKst = Date.UTC(y, m, 1, -9, 0, 0);
      fromMs = startKst;
      toMs = endKst - 1;
    } else {
      if (fromQ && /^\d+$/.test(fromQ)) {
        const n = Number(fromQ);
        if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_DATE_MS) fromMs = n;
      }
      if (toQ && /^\d+$/.test(toQ)) {
        const n = Number(toQ);
        if (Number.isSafeInteger(n) && n >= 0 && n <= MAX_DATE_MS) toMs = n;
      }
    }

    const conds: string[] = [];
    const args: (string | number)[] = [];
    conds.push('s.user_id = ?');
    args.push(targetUserId);
    const CAP = 50000;

    // 파일명 suffix: period > ym > from/to > all
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const fnameSuffix = periodLabel
      ? periodLabel
      : ymQ
      ? ymQ
      : (fromMs != null && toMs != null)
        ? `${new Date(fromMs + 9 * 3600 * 1000).toISOString().slice(0, 10)}_${new Date(toMs + 9 * 3600 * 1000).toISOString().slice(0, 10)}`
        : `all-${todayKst}`;

    let csv = '';
    let filename = '';
    let rowCount = 0;
    if (rest === '/export/sales') {
      if (fromMs != null) { conds.push('s.sold_at >= ?'); args.push(fromMs); }
      if (toMs != null) { conds.push('s.sold_at <= ?'); args.push(toMs); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.user_id, u.email, u.business_name, s.menu_id,
                m.name AS menu_name, m.emoji AS menu_emoji,
                s.quantity, s.cost_at_sale, s.price_at_sale, s.sold_at
         FROM sales s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN menus m ON m.id = s.menu_id
         ${where}
         ORDER BY s.sold_at DESC
         LIMIT ?`,
      )
        .bind(...args, CAP)
        .all<{
          id: number; user_id: number; email: string; business_name: string;
          menu_id: number; menu_name: string | null; menu_emoji: string | null;
          quantity: number; cost_at_sale: number; price_at_sale: number; sold_at: number;
        }>();
      const headers = ['id', 'user_id', 'email', 'business_name', 'menu_id', 'menu_name', 'emoji', 'quantity', 'cost_at_sale', 'price_at_sale', 'total_cost', 'total_price', 'profit', 'sold_at_iso'];
      const rows = results.map((r) => [
        r.id, r.user_id, r.email, r.business_name, r.menu_id, r.menu_name ?? '', r.menu_emoji ?? '',
        r.quantity, r.cost_at_sale, r.price_at_sale,
        r.quantity * r.cost_at_sale, r.quantity * r.price_at_sale,
        r.quantity * (r.price_at_sale - r.cost_at_sale),
        new Date(r.sold_at).toISOString(),
      ]);
      csv = toCsv(headers, rows);
      rowCount = rows.length;
      filename = `nunchi-sales-${fnameSuffix}.csv`;
    } else {
      // needs - 컬럼이 다르므로 별도 conds 재구성 (sales 의 s.* alias 와 충돌 회피)
      const condsN: string[] = [];
      const argsN: (string | number)[] = [];
      condsN.push('n.user_id = ?'); argsN.push(targetUserId);
      if (fromMs != null) { condsN.push('n.created_at >= ?'); argsN.push(fromMs); }
      if (toMs != null) { condsN.push('n.created_at <= ?'); argsN.push(toMs); }
      const whereN = condsN.length ? `WHERE ${condsN.join(' AND ')}` : '';
      const { results } = await env.DB.prepare(
        `SELECT n.id, n.user_id, u.email, u.business_name,
                n.gender, n.age_band, n.with_child, n.purpose, n.residence,
                n.menu_ids, n.created_at
         FROM customer_needs n
         JOIN users u ON u.id = n.user_id
         ${whereN}
         ORDER BY n.created_at DESC
         LIMIT ?`,
      )
        .bind(...argsN, CAP)
        .all<{
          id: number; user_id: number; email: string; business_name: string;
          gender: string | null; age_band: string | null; with_child: number | null;
          purpose: string | null; residence: string | null;
          menu_ids: string | null; created_at: number;
        }>();
      const headers = ['id', 'user_id', 'email', 'business_name', 'gender', 'age_band', 'with_child', 'purpose', 'residence', 'menu_ids', 'created_at_iso'];
      const rows = results.map((r) => [
        r.id, r.user_id, r.email, r.business_name,
        r.gender ?? '', r.age_band ?? '',
        r.with_child == null ? '' : r.with_child ? 'yes' : 'no',
        r.purpose ?? '', r.residence ?? '',
        r.menu_ids ?? '',
        new Date(r.created_at).toISOString(),
      ]);
      csv = toCsv(headers, rows);
      rowCount = rows.length;
      filename = `nunchi-needs-${fnameSuffix}.csv`;
    }

    await audit(
      env, user.id,
      `export.${rest === '/export/sales' ? 'sales' : 'needs'}`,
      { userId: targetUserId, ym: ymQ, from: fromMs, to: toMs, by_role: user.is_master ? 'master' : 'admin' },
      request,
    );

    // UTF-8 BOM (Excel 한글 자동 인식). cap 도달 시 truncation 신호 헤더.
    const bom = '﻿';
    const truncated = rowCount >= CAP;
    // filename 헤더 인젝션 방어: 큰따옴표/CR/LF/non-printable 제거.
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(bom + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-store',
        'X-Truncated': truncated ? '1' : '0',
        'X-Row-Count': String(rowCount),
      },
    });
  }

  return err('찾을 수 없는 경로입니다.', 404);
}

// CSV 인코딩. 콤마·따옴표·줄바꿈 escape + Excel formula injection 방어.
// 문자열 값만 `=+-@` 시작 시 single quote prefix (OWASP CSV Injection).
// 숫자는 prefix 하지 않음 (음수 `-1000` 등 정상 데이터 보존).
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null): string => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    // 문자열만 OWASP 가드. 제어문자(NUL, \v, \f 등) 제거 후 prefix 검사.
    let s = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    if (s.length > 0 && /^[=+\-@\t]/.test(s)) s = "'" + s;
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return lines.join('\r\n');
}
