import { Env, ok, err, SessionUser } from './types';

// 고객 니즈 간이 조사 — 모든 항목 선택사항. 사용자 격리: user_id로만 조회/저장.

const GENDERS = ['female', 'male'] as const;
const AGE_BANDS = ['10s_20s', '30s_40s', '50plus'] as const;
const PURPOSES = ['gift', 'kids_snack', 'meal_replacement'] as const;
const RESIDENCES = ['busan', 'outside'] as const;

const pick = <T extends readonly string[]>(
  v: unknown,
  allowed: T,
): T[number] | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : null);

interface NeedRow {
  id: number;
  gender: string | null;
  age_band: string | null;
  with_child: number | null;
  purpose: string | null;
  residence: string | null;
  menu_id: number | null;
  created_at: number;
  menu_name: string | null;
  menu_emoji: string | null;
}

export async function handleNeeds(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
  url: URL,
): Promise<Response> {
  // GET /api/needs?limit=N — 최근 기록
  if (rest === '' && request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100);
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.gender, n.age_band, n.with_child, n.purpose, n.residence,
              n.menu_id, n.created_at, m.name AS menu_name, m.emoji AS menu_emoji
       FROM customer_needs n LEFT JOIN menus m ON m.id = n.menu_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ?`,
    )
      .bind(user.id, limit)
      .all<NeedRow>();
    return ok({
      needs: results.map((r) => ({
        id: r.id,
        gender: r.gender,
        ageBand: r.age_band,
        withChild: r.with_child == null ? null : !!r.with_child,
        purpose: r.purpose,
        residence: r.residence,
        menuId: r.menu_id,
        menuName: r.menu_name,
        menuEmoji: r.menu_emoji,
        createdAt: r.created_at,
      })),
    });
  }

  // POST /api/needs — 새 기록
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

    let menuId: number | null = null;
    if (typeof body?.menuId === 'number' && Number.isInteger(body.menuId) && body.menuId > 0) {
      const m = await env.DB.prepare('SELECT id FROM menus WHERE id = ? AND user_id = ?')
        .bind(body.menuId, user.id)
        .first<{ id: number }>();
      if (m) menuId = m.id;
    }

    // 전부 비어있으면 의미 없음
    if (
      gender === null &&
      ageBand === null &&
      withChild === null &&
      purpose === null &&
      residence === null &&
      menuId === null
    ) {
      return err('한 가지 이상 선택해주세요.');
    }

    const r = await env.DB.prepare(
      `INSERT INTO customer_needs (user_id, gender, age_band, with_child, purpose, residence, menu_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(user.id, gender, ageBand, withChild, purpose, residence, menuId, Date.now())
      .run();
    return ok({ id: Number(r.meta.last_row_id) });
  }

  // DELETE /api/needs/:id — 기록 삭제
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
