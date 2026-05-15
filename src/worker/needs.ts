import { Env, ok, err, SessionUser } from './types';

// 고객 니즈 간이 조사 - 모든 항목 선택사항. 사용자 격리: user_id로만 조회/저장.

const GENDERS = ['female', 'male'] as const;
const AGE_BANDS = ['10s_20s', '30s_40s', '50plus'] as const;
const PURPOSES = ['gift', 'kids_snack', 'meal_replacement'] as const;
const RESIDENCES = ['busan', 'outside'] as const;
const MAX_MENU_IDS = 30;

const pick = <T extends readonly string[]>(
  v: unknown,
  allowed: T,
): T[number] | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : null;

interface NeedRow {
  id: number;
  gender: string | null;
  age_band: string | null;
  with_child: number | null;
  purpose: string | null;
  residence: string | null;
  menu_ids: string | null;
  created_at: number;
}

const parseMenuIds = (s: string | null): number[] => {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr)
      ? arr.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
      : [];
  } catch {
    return [];
  }
};

export async function handleNeeds(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
): Promise<Response> {
  // GET /api/needs?from=&to=&limit=N - 기록 목록 (from/to로 기간 필터, limit+1로 hasMore 판단)
  if (rest === '' && request.method === 'GET') {
    const limitN = Number(url.searchParams.get('limit') ?? 20);
    const limit = Math.min(Math.max(Number.isFinite(limitN) ? limitN : 20, 1), 500);
    const conds = ['user_id = ?'];
    const args: (string | number)[] = [user.id];
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    if (fromQ) {
      conds.push('created_at >= ?');
      args.push(Number(fromQ));
    }
    if (toQ) {
      conds.push('created_at <= ?');
      args.push(Number(toQ));
    }
    const { results } = await env.DB.prepare(
      `SELECT id, gender, age_band, with_child, purpose, residence, menu_ids, created_at
       FROM customer_needs
       WHERE ${conds.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
      .bind(...args, limit + 1)
      .all<NeedRow>();
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return ok({
      needs: page.map((r) => ({
        id: r.id,
        gender: r.gender,
        ageBand: r.age_band,
        withChild: r.with_child == null ? null : !!r.with_child,
        purpose: r.purpose,
        residence: r.residence,
        menuIds: parseMenuIds(r.menu_ids),
        createdAt: r.created_at,
      })),
      hasMore,
    });
  }

  // POST /api/needs - 새 기록
  if (rest === '' && request.method === 'POST') {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return err('잘못된 요청입니다.');
    }
    const gender = pick(body?.gender, GENDERS);
    const ageBand = pick(body?.ageBand, AGE_BANDS);
    const purpose = pick(body?.purpose, PURPOSES);
    const residence = pick(body?.residence, RESIDENCES);
    const withChild =
      body?.withChild === true ? 1 : body?.withChild === false ? 0 : null;

    // menuIds: 본인 메뉴인 것만, 중복 제거, 최대 MAX_MENU_IDS
    let menuIds: number[] = [];
    const rawIds = Array.isArray(body?.menuIds) ? body!.menuIds : [];
    const candidate = [
      ...new Set(
        rawIds
          .map((x) => (typeof x === 'number' ? x : Number(x)))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ].slice(0, MAX_MENU_IDS);
    if (candidate.length > 0) {
      const ph = candidate.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT id FROM menus WHERE user_id = ? AND id IN (${ph})`,
      )
        .bind(user.id, ...candidate)
        .all<{ id: number }>();
      const owned = new Set(results.map((m) => m.id));
      menuIds = candidate.filter((id) => owned.has(id));
    }

    if (
      gender === null &&
      ageBand === null &&
      withChild === null &&
      purpose === null &&
      residence === null &&
      menuIds.length === 0
    ) {
      return err('한 가지 이상 선택해주세요.');
    }

    const createdAt =
      typeof body?.createdAt === 'number' && Number.isFinite(body.createdAt)
        ? body.createdAt
        : Date.now();
    const r = await env.DB.prepare(
      `INSERT INTO customer_needs (user_id, gender, age_band, with_child, purpose, residence, menu_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        gender,
        ageBand,
        withChild,
        purpose,
        residence,
        menuIds.length ? JSON.stringify(menuIds) : null,
        createdAt,
      )
      .run();
    return ok({ id: Number(r.meta.last_row_id) });
  }

  // GET /api/needs/stats?from=&to= - 기간별 집계 (BI용)
  if (rest === '/stats' && request.method === 'GET') {
    const fromQ = url.searchParams.get('from');
    const toQ = url.searchParams.get('to');
    const conds = ['user_id = ?'];
    const args: (string | number)[] = [user.id];
    if (fromQ) {
      conds.push('created_at >= ?');
      args.push(Number(fromQ));
    }
    if (toQ) {
      conds.push('created_at <= ?');
      args.push(Number(toQ));
    }
    const { results } = await env.DB.prepare(
      `SELECT gender, age_band, with_child, purpose, residence, menu_ids
       FROM customer_needs WHERE ${conds.join(' AND ')}`,
    )
      .bind(...args)
      .all<Pick<NeedRow, 'gender' | 'age_band' | 'with_child' | 'purpose' | 'residence' | 'menu_ids'>>();

    const tally = () => {
      const m: Record<string, number> = {};
      return {
        add: (v: string | null) => {
          if (v != null) m[v] = (m[v] ?? 0) + 1;
        },
        out: m,
      };
    };
    const gender = tally();
    const ageBand = tally();
    const withChild: Record<string, number> = {};
    const purpose = tally();
    const residence = tally();
    const menuCounts: Record<number, number> = {};
    for (const r of results) {
      gender.add(r.gender);
      ageBand.add(r.age_band);
      if (r.with_child != null) {
        const k = r.with_child ? 'yes' : 'no';
        withChild[k] = (withChild[k] ?? 0) + 1;
      }
      purpose.add(r.purpose);
      residence.add(r.residence);
      for (const id of parseMenuIds(r.menu_ids)) menuCounts[id] = (menuCounts[id] ?? 0) + 1;
    }
    const ranked = Object.entries(menuCounts)
      .map(([id, count]) => ({ menuId: Number(id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    let topMenus: { menuId: number; name: string | null; emoji: string | null; count: number }[] =
      ranked.map((r) => ({ ...r, name: null, emoji: null }));
    if (ranked.length > 0) {
      const ph = ranked.map(() => '?').join(',');
      const { results: ms } = await env.DB.prepare(
        `SELECT id, name, emoji FROM menus WHERE user_id = ? AND id IN (${ph})`,
      )
        .bind(user.id, ...ranked.map((r) => r.menuId))
        .all<{ id: number; name: string; emoji: string | null }>();
      const byId = new Map(ms.map((m) => [m.id, m]));
      topMenus = ranked.map((r) => {
        const m = byId.get(r.menuId);
        return { menuId: r.menuId, name: m?.name ?? null, emoji: m?.emoji ?? null, count: r.count };
      });
    }

    return ok({
      total: results.length,
      gender: gender.out,
      ageBand: ageBand.out,
      withChild,
      purpose: purpose.out,
      residence: residence.out,
      topMenus,
    });
  }

  // DELETE /api/needs/:id - 기록 삭제
  const mDel = rest.match(/^\/(\d+)$/);
  if (mDel && request.method === 'DELETE') {
    const id = Number(mDel[1]);
    const r = await env.DB.prepare(
      'DELETE FROM customer_needs WHERE id = ? AND user_id = ?',
    )
      .bind(id, user.id)
      .run();
    if (!r.meta.changes) return err('기록을 찾을 수 없습니다.', 404);
    return ok({});
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
