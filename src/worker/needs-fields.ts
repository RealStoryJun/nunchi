import type { Env, SessionUser } from './types';
import { ok, err } from './types';

// 사장님 커스텀 니즈 필드 CRUD (2026-05-18 PR 1).
// 기존 5 hardcoded 필드와 공존. 사장님별 최대 5필드, 필드별 최대 6옵션.

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{2,30}$/;
const OPTION_V_RE = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_FIELDS = 5;
// 6 → 4 로 축소 (2026-05-18 design-reviewer 🔴 #1): /needs 의 Seg chip wrap 차단.
// 사장님 chip wrap 룰: 한 줄 유지 = 정보 손실 회피 우선. 4 옵션이면 px-3.5 h-10 chip 모바일 375px 한 줄 fit.
const MAX_OPTIONS = 4;
const LABEL_MAX = 30;
const OPT_LABEL_MAX = 20;

interface OptionDef { v: string; l: string; }

// control char strip (XSS·prompt injection 방어 - PR 3 AI 인사이트에 그대로 주입되므로)
function sanitizeLabel(s: string, max: number): string {
  return s.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function validateOptions(input: unknown): OptionDef[] | string {
  if (!Array.isArray(input)) return '옵션은 배열이어야 합니다.';
  if (input.length === 0) return '옵션을 1개 이상 추가해주세요.';
  if (input.length > MAX_OPTIONS) return `옵션은 ${MAX_OPTIONS}개 이하로 입력해주세요.`;
  const seen = new Set<string>();
  const out: OptionDef[] = [];
  for (const it of input) {
    if (!it || typeof it !== 'object') return '옵션 형식이 잘못됐어요.';
    const rec = it as { v?: unknown; l?: unknown };
    const v = typeof rec.v === 'string' ? rec.v.trim().toLowerCase() : '';
    const lRaw = typeof rec.l === 'string' ? rec.l : '';
    const l = sanitizeLabel(lRaw, OPT_LABEL_MAX);
    if (!OPTION_V_RE.test(v)) return '옵션 키(v)는 영문 소문자·숫자·언더스코어 1-31자, 영문으로 시작.';
    if (l.length < 1) return '옵션 라벨을 입력해주세요.';
    if (seen.has(v)) return `옵션 키 중복: ${v}`;
    seen.add(v);
    out.push({ v, l });
  }
  return out;
}

// 사장님 자신의 ai_insights 무효화 (라벨·옵션 변경 시 분석 어휘가 바뀌므로).
async function invalidateInsights(env: Env, userId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM ai_insights WHERE user_id = ?').bind(userId).run();
}

export async function handleNeedsFields(
  request: Request,
  env: Env,
  user: SessionUser,
  rest: string,
): Promise<Response> {
  // GET /api/me/needs-fields - 본인 활성 필드 목록
  if (rest === '' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, field_key, label, options_json, sort_order
       FROM user_needs_fields
       WHERE user_id = ? AND archived = 0
       ORDER BY sort_order ASC, id ASC`,
    ).bind(user.id).all<{
      id: number; field_key: string; label: string; options_json: string; sort_order: number;
    }>();
    return ok({
      fields: results.map((r) => {
        let options: OptionDef[] = [];
        try {
          const parsed = JSON.parse(r.options_json) as unknown;
          if (Array.isArray(parsed)) options = parsed as OptionDef[];
        } catch { /* corrupt - 빈 배열 fallback */ }
        return {
          id: r.id,
          field_key: r.field_key,
          label: r.label,
          options,
          sort_order: r.sort_order,
        };
      }),
    });
  }

  // POST /api/me/needs-fields - 새 필드 추가
  if (rest === '' && request.method === 'POST') {
    const cnt = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM user_needs_fields WHERE user_id = ? AND archived = 0',
    ).bind(user.id).first<{ n: number }>();
    if (cnt && cnt.n >= MAX_FIELDS) {
      return err(`필드는 최대 ${MAX_FIELDS}개까지 추가 가능해요.`);
    }

    let body: { field_key?: unknown; label?: unknown; options?: unknown };
    try { body = await request.json() as typeof body; } catch { return err('잘못된 요청입니다.'); }
    const field_key = typeof body.field_key === 'string' ? body.field_key.trim().toLowerCase() : '';
    const label = typeof body.label === 'string' ? sanitizeLabel(body.label, LABEL_MAX) : '';
    if (!FIELD_KEY_RE.test(field_key)) {
      return err('필드 키는 영문 소문자·숫자·언더스코어 3-31자, 영문으로 시작해야 해요.');
    }
    if (label.length < 1) return err('라벨을 입력해주세요.');
    const opts = validateOptions(body.options);
    if (typeof opts === 'string') return err(opts);

    const maxOrder = await env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_needs_fields WHERE user_id = ? AND archived = 0',
    ).bind(user.id).first<{ m: number }>();
    const nextOrder = Math.min((maxOrder?.m ?? -1) + 1, 1000);

    try {
      const result = await env.DB.prepare(
        `INSERT INTO user_needs_fields (user_id, field_key, label, options_json, sort_order, archived, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).bind(user.id, field_key, label, JSON.stringify(opts), nextOrder, Date.now()).run();
      await invalidateInsights(env, user.id);
      return ok({
        id: Number(result.meta.last_row_id),
        field_key, label, options: opts, sort_order: nextOrder,
      });
    } catch (e) {
      if (String(e).includes('UNIQUE')) return err('이미 같은 키의 필드가 있어요.');
      throw e;
    }
  }

  // PATCH /api/me/needs-fields/{id} - 라벨·옵션·sort_order 수정
  const idMatch = rest.match(/^\/(\d+)$/);
  if (idMatch && request.method === 'PATCH') {
    const id = Number(idMatch[1]);
    const existing = await env.DB.prepare(
      'SELECT id FROM user_needs_fields WHERE id = ? AND user_id = ? AND archived = 0',
    ).bind(id, user.id).first();
    if (!existing) return err('필드를 찾을 수 없어요.', 404);

    let body: { label?: unknown; options?: unknown; sort_order?: unknown };
    try { body = await request.json() as typeof body; } catch { return err('잘못된 요청입니다.'); }
    const updates: string[] = [];
    const args: (string | number)[] = [];
    if (body.label !== undefined) {
      const label = typeof body.label === 'string' ? sanitizeLabel(body.label, LABEL_MAX) : '';
      if (label.length < 1) return err('라벨을 입력해주세요.');
      updates.push('label = ?'); args.push(label);
    }
    if (body.options !== undefined) {
      const opts = validateOptions(body.options);
      if (typeof opts === 'string') return err(opts);
      updates.push('options_json = ?'); args.push(JSON.stringify(opts));
    }
    if (body.sort_order !== undefined) {
      const so = Number(body.sort_order);
      if (!Number.isInteger(so) || so < 0 || so > 1000) return err('sort_order 는 0-1000.');
      updates.push('sort_order = ?'); args.push(so);
    }
    if (updates.length === 0) return err('변경할 항목이 없어요.');
    args.push(id, user.id);
    await env.DB.prepare(
      `UPDATE user_needs_fields SET ${updates.join(', ')} WHERE id = ? AND user_id = ? AND archived = 0`,
    ).bind(...args).run();
    await invalidateInsights(env, user.id);
    return ok({});
  }

  // DELETE /api/me/needs-fields/{id} - soft delete (archived=1, 과거 row 의 값은 hide)
  if (idMatch && request.method === 'DELETE') {
    const id = Number(idMatch[1]);
    const r = await env.DB.prepare(
      'UPDATE user_needs_fields SET archived = 1 WHERE id = ? AND user_id = ? AND archived = 0',
    ).bind(id, user.id).run();
    if (r.meta.changes === 0) return err('필드를 찾을 수 없어요.', 404);
    await invalidateInsights(env, user.id);
    return ok({});
  }

  return err('찾을 수 없는 경로입니다.', 404);
}
