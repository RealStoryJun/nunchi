import { Env, ok, err, isBusinessType, BUSINESS_TYPE_LABELS, BusinessType } from './types';
import { checkRateLimit, recordAttempt, tooMany } from './ratelimit';

// 매출 데이터 → AI 인사이트. GROQ_API_KEY 없으면 빈 배열(클라가 카드 숨김).

interface ByMenu {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  category: string | null;
}
interface ByDay {
  day: string;
  revenue: number;
}
interface ByCat {
  category: string;
  revenue: number;
}
interface StatsPayload {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  qty: number;
  byMenu?: ByMenu[];
  byDay?: ByDay[];
  byCategory?: ByCat[];
  peakHour?: number | null;
}
interface NeedsAgg {
  total: number;
  gender: Record<string, number>;
  ageBand: Record<string, number>;
  withChild: Record<string, number>;
  purpose: Record<string, number>;
  residence: Record<string, number>;
  topMenus: { name: string; count: number }[];
}
interface InsightsBody {
  stats?: StatsPayload;
  prevStats?: { revenue: number; profit: number; qty: number } | null;
  rangeLabel?: string;
  needs?: NeedsAgg | null;
  businessType?: BusinessType | null;
  monthlyFixedCost?: number;
  ym?: string; // 'YYYY-MM' — 과거 월이면 결과를 ai_insights에 영구 저장
  // 기간 길이 메타 — "5월 1주차는 2일밖에 안 됨" 같은 컨텍스트를 LLM이 자연히 풀게 함
  periodDays?: number;       // (toMs-fromMs+1)/24h 절상, 기간 전체 일수
  periodActiveDays?: number; // 매출 발생 일수 (byDay 중 revenue>0)
  periodStart?: string;      // 'YYYY-MM-DD' 사용자 timezone
  periodEnd?: string;        // 'YYYY-MM-DD'
}

// 'YYYY-MM' 형식 검증
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// KST(UTC+9) 기준 현재 'YYYY-MM' — 사장님 표시 시간대와 일치
export const currentYmKst = (now = Date.now()): string => {
  const d = new Date(now + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
// ms epoch → KST 'YYYY-MM' (sales.sold_at → 그 판매가 속한 월)
export const msToYmKst = (ms: number): string => {
  const d = new Date(ms + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// 니즈 항목 코드 → 한글 라벨 (프롬프트용)
const NEEDS_LABEL: Record<string, string> = {
  female: '여성',
  male: '남성',
  '10s_20s': '10·20대',
  '30s_40s': '30·40대',
  '50plus': '50대 이상',
  yes: '자녀 동반',
  no: '미동반',
  gift: '선물용',
  kids_snack: '자녀 간식용',
  meal_replacement: '식사대용',
  busan: '부산',
  outside: '부산 외',
};

const won = (n: number) => `${Math.round(n).toLocaleString('en-US')}원`;
const pctStr = (r: number) => `${(r * 100).toFixed(1)}%`;

// 클라가 보낸 body는 신뢰 불가 — Groq 프롬프트(공유 API 키)로 들어가므로 길이·타입·개수를 강제로 제한.
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown, max = 40): string =>
  typeof v === 'string' ? v.slice(0, max) : '';
const mapArr = <T>(
  v: unknown,
  max: number,
  fn: (o: Record<string, unknown>) => T,
): T[] =>
  Array.isArray(v)
    ? v
        .slice(0, max)
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(fn)
    : [];

const sanitizeStats = (s: unknown): StatsPayload | null => {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  if (typeof o.revenue !== 'number') return null;
  return {
    revenue: num(o.revenue),
    cost: num(o.cost),
    profit: num(o.profit),
    margin: num(o.margin),
    qty: num(o.qty),
    byMenu: mapArr(o.byMenu, 50, (m) => ({
      name: str(m.name) || '메뉴',
      qty: num(m.qty),
      revenue: num(m.revenue),
      cost: num(m.cost),
      profit: num(m.profit),
      category: typeof m.category === 'string' ? m.category.slice(0, 40) : null,
    })),
    byDay: mapArr(o.byDay, 400, (d) => ({ day: str(d.day), revenue: num(d.revenue) })),
    byCategory: mapArr(o.byCategory, 30, (c) => ({
      category: str(c.category) || '미분류',
      revenue: num(c.revenue),
    })),
    peakHour: Number.isFinite(o.peakHour as number) ? Math.round(o.peakHour as number) : null,
  };
};

// Record<string,number> — 키 ≤30자, 최대 12개, 값은 음수 아닌 정수
const sanitizeCounts = (v: unknown): Record<string, number> => {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n++ >= 12) break;
    const c = num(val);
    if (c > 0) out[k.slice(0, 30)] = Math.round(c);
  }
  return out;
};
const sanitizeNeeds = (v: unknown): NeedsAgg | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    total: Math.round(num(o.total)),
    gender: sanitizeCounts(o.gender),
    ageBand: sanitizeCounts(o.ageBand),
    withChild: sanitizeCounts(o.withChild),
    purpose: sanitizeCounts(o.purpose),
    residence: sanitizeCounts(o.residence),
    topMenus: mapArr(o.topMenus, 10, (m) => ({
      name: str(m.name) || '메뉴',
      count: Math.round(num(m.count)),
    })),
  };
};

const sanitizeBody = (raw: unknown): InsightsBody | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const stats = sanitizeStats(o.stats);
  if (!stats) return null;
  let prevStats: InsightsBody['prevStats'] = null;
  if (o.prevStats && typeof o.prevStats === 'object') {
    const p = o.prevStats as Record<string, unknown>;
    prevStats = { revenue: num(p.revenue), profit: num(p.profit), qty: num(p.qty) };
  }
  const fc = num(o.monthlyFixedCost);
  // 사이트 어느 항목도 100억 넘는 게 비현실 — 그 이상은 0으로 떨궈 LLM이 헛소리 하지 않게.
  const MAX_FC = 10_000_000_000;
  const ymRaw = typeof o.ym === 'string' ? o.ym : '';
  // 기간 메타 — 'YYYY-MM-DD' 강한 검증, 일수는 0~366
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const psRaw = typeof o.periodStart === 'string' ? o.periodStart : '';
  const peRaw = typeof o.periodEnd === 'string' ? o.periodEnd : '';
  const pd = num(o.periodDays);
  const pad = num(o.periodActiveDays);
  return {
    stats,
    prevStats,
    rangeLabel: str(o.rangeLabel, 30) || undefined,
    needs: sanitizeNeeds(o.needs),
    businessType: isBusinessType(o.businessType) ? o.businessType : null,
    monthlyFixedCost: fc > 0 && Number.isFinite(fc) && fc <= MAX_FC ? Math.round(fc) : 0,
    ym: YM_RE.test(ymRaw) ? ymRaw : undefined,
    periodDays: pd > 0 && pd <= 366 ? Math.round(pd) : undefined,
    periodActiveDays: pad >= 0 && pad <= 366 ? Math.round(pad) : undefined,
    periodStart: DATE_RE.test(psRaw) ? psRaw : undefined,
    periodEnd: DATE_RE.test(peRaw) ? peRaw : undefined,
  };
};

const buildSummary = (b: InsightsBody): string => {
  const s = b.stats!;
  const lines: string[] = [];
  if (b.businessType) lines.push(`- 업종: ${BUSINESS_TYPE_LABELS[b.businessType]}`);
  // 기간 한 줄 — 시작/끝/총 일수/매출 발생 일수 (LLM이 짧은 기간을 인지하고 부연하도록)
  if (b.periodStart && b.periodEnd && b.periodDays) {
    const active = b.periodActiveDays != null ? `, 매출 발생 ${b.periodActiveDays}일` : '';
    lines.push(
      `- 기간: ${b.rangeLabel || '선택 기간'} (${b.periodStart} ~ ${b.periodEnd}, ${b.periodDays}일치${active})`,
    );
  } else {
    lines.push(`- 기간: ${b.rangeLabel || '선택 기간'}`);
  }
  lines.push(
    `- 총매출 ${won(s.revenue)} / 총원가 ${won(s.cost)} / 순이익 ${won(s.profit)} / 마진율 ${pctStr(s.margin)} / 판매 ${s.qty}건`,
  );
  const fc = b.monthlyFixedCost ?? 0;
  if (fc > 0) {
    const realProfit = s.profit - fc;
    lines.push(
      `- 이번 달 고정비 ${won(fc)} (임대료·공과금·인건비 등 매월 고정 지출) → 실제 순이익 ${won(realProfit)}`,
    );
  }
  if (b.prevStats) {
    const rd =
      b.prevStats.revenue > 0
        ? (((s.revenue - b.prevStats.revenue) / b.prevStats.revenue) * 100).toFixed(0)
        : null;
    const pd =
      b.prevStats.profit !== 0
        ? (((s.profit - b.prevStats.profit) / Math.abs(b.prevStats.profit)) * 100).toFixed(0)
        : null;
    lines.push(
      `- 직전 동일 기간 대비: 매출 ${rd !== null ? (Number(rd) >= 0 ? '+' : '') + rd + '%' : 'N/A'}, 순이익 ${pd !== null ? (Number(pd) >= 0 ? '+' : '') + pd + '%' : 'N/A'}, 판매건수 ${b.prevStats.qty}건 → ${s.qty}건`,
    );
  }
  if (s.byMenu && s.byMenu.length) {
    const top = s.byMenu
      .slice()
      .sort((a, c) => c.revenue - a.revenue)
      .slice(0, 4)
      .map(
        (m) =>
          `${m.name}(${won(m.revenue)}, ${m.qty}개, 마진 ${m.revenue > 0 ? Math.round((m.profit / m.revenue) * 100) : 0}%)`,
      );
    lines.push(`- 인기 메뉴: ${top.join(' / ')}`);
    const lowMargin = s.byMenu
      .filter((m) => m.revenue > 0)
      .slice()
      .sort((a, c) => a.profit / a.revenue - c.profit / c.revenue)
      .slice(0, 2)
      .map((m) => `${m.name}(마진 ${Math.round((m.profit / m.revenue) * 100)}%)`);
    if (lowMargin.length) lines.push(`- 마진 낮은 메뉴: ${lowMargin.join(' / ')}`);
  }
  if (s.byDay && s.byDay.length) {
    const revs = s.byDay.map((d) => d.revenue);
    const max = Math.max(...revs);
    const min = Math.min(...revs);
    const avg = revs.reduce((x, y) => x + y, 0) / revs.length;
    const maxDay = s.byDay.find((d) => d.revenue === max);
    lines.push(
      `- 일별: ${s.byDay.length}일, 평균 ${won(avg)}, 최고 ${won(max)}(${maxDay?.day ?? ''}), 최저 ${won(min)}`,
    );
  }
  if (s.peakHour != null) lines.push(`- 피크 시간대: ${s.peakHour}시`);
  if (s.byCategory && s.byCategory.length) {
    lines.push(
      `- 분류별: ${s.byCategory.slice(0, 3).map((c) => `${c.category} ${won(c.revenue)}`).join(', ')}`,
    );
  }
  // 고객 니즈 (충분히 쌓였을 때만)
  const n = b.needs;
  if (n && n.total >= 5) {
    const fmtDim = (rec: Record<string, number>) => {
      const sum = Object.values(rec).reduce((x, y) => x + y, 0);
      if (sum === 0) return '';
      return Object.entries(rec)
        .sort((a, c) => c[1] - a[1])
        .map(([k, v]) => `${NEEDS_LABEL[k] ?? k} ${Math.round((v / sum) * 100)}%`)
        .join(' / ');
    };
    const parts: string[] = [];
    const g = fmtDim(n.gender);
    if (g) parts.push(`성별 [${g}]`);
    const a = fmtDim(n.ageBand);
    if (a) parts.push(`연령대 [${a}]`);
    const c = fmtDim(n.withChild);
    if (c) parts.push(`자녀 [${c}]`);
    const p = fmtDim(n.purpose);
    if (p) parts.push(`목적 [${p}]`);
    const r = fmtDim(n.residence);
    if (r) parts.push(`거주지 [${r}]`);
    lines.push(`- 고객 니즈 조사 ${n.total}건: ${parts.join(', ')}`);
    if (n.topMenus.length)
      lines.push(
        `- 니즈 조사에서 손님이 자주 찾은 (모두 이미 등록된) 메뉴: ${n.topMenus.slice(0, 5).map((m) => `${m.name}(${m.count}회)`).join(', ')}`,
      );
  }
  return lines.join('\n');
};

const SYSTEM_PROMPT =
  '당신은 한국 1인 사업자(카페·음식점·소매점·서비스업·카센터·공방 등) 사장님의 매출 데이터를 분석해 ' +
  '실질적으로 도움 되는 인사이트를 알려주는 분석가입니다.\n' +
  '규칙:\n' +
  '- 인사이트 2~4개. 각 1~2문장. "~예요/~네요/~어요" 같은 친근한 존댓말. ("에요" 아님 "예요")\n' +
  '- 기간이 7일 미만이거나 매출 발생 일수가 평소보다 적으면, 매출 절댓값보다 일평균/영업일 한계를 우선 짚어주세요. 예: "5월 1주차는 2일치라 매출이 적게 보일 수 있어요. 일평균은 X원이에요."\n' +
  '- 인사이트 중 적어도 1개는 매출 데이터(피크 시간대·인기 메뉴·마진) + 고객 니즈 데이터(연령·자녀 동반·거주지·구매 목적)를 묶어 다음 달 실행 가능한 전략을 제시하세요. 예: "30대 자녀 동반 손님이 70%인데 피크가 11시예요. 다음 달엔 11~13시 키즈 세트 메뉴를 시도해보세요."\n' +
  '- "업종"이 주어지면 그 업종 맥락에 맞는 표현·제안을 쓰세요(예: 카센터면 "오일 교환 회전율", 미용실이면 "시술 단가", 카페면 "피크 시간대 동선"). 식당 어휘를 옷가게에 쓰지 말 것.\n' +
  '- 반드시 데이터의 구체적 숫자를 인용하고, 가능하면 실행 가능한 제안 1가지를 포함.\n' +
  '- 반드시 한국어로만 작성. 한자(漢字)·일본어 가나·러시아어 키릴 문자 등 다른 문자를 절대 섞지 말 것 — 한자어가 떠오르면 한국어 표기로(예: "重点"→"핵심", "最高"→"최고", "戦略"→"전략").\n' +
  '- 데이터에 없는 메뉴명·숫자를 지어내지 말 것.\n' +
  '- "고객 니즈 조사" 항목이 데이터에 있으면, 인사이트 중 적어도 1개는 그걸 활용하세요 — 어떤 손님(연령대·자녀 동반 여부·거주지)이 무엇을 왜 사는지, 그에 맞춘 실행 제안. 니즈 데이터가 없으면 매출만 분석.\n' +
  '- 판매가 5건 미만이거나 데이터가 빈약하면 인사이트 1개로 "데이터가 더 쌓이면 더 정확한 분석을 드릴 수 있어요" 정도만.\n' +
  '- 출력은 JSON 배열만: ["인사이트1", "인사이트2", ...]. 다른 텍스트·코드펜스·설명 절대 금지.';

// Groq rate limit은 모델마다 다름 — 추론력 좋은 70b 먼저, 한도 차면(429) 가벼운 8b로 fallback.
// https://console.groq.com/docs/rate-limits
const MODELS: ReadonlyArray<{ model: string; maxTokens: number }> = [
  { model: 'llama-3.3-70b-versatile', maxTokens: 550 },
  { model: 'llama-3.1-8b-instant', maxTokens: 480 },
];

// LLM이 가끔 한자·일본어 가나·키릴 문자를 섞음 — 프롬프트로 줄지만 100%는 아니라서 출력 단계에서 처리.
// (1) 흔한 한자어는 한국어로 치환해 살리고, (2) 그래도 비한국어 문자가 남은 인사이트는 통째로 버린다(사용자에게 절대 안 보이게).
const SALVAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/重[点點]/g, '핵심'],
  [/最高/g, '최고'],
  [/[戦戰战]略/g, '전략'],
  [/客[層层]/g, '고객층'],
  [/重要/g, '중요'],
  [/効果|效果/g, '효과'],
];
// CJK 기호·한자·가나·전각 영숫자·키릴 — 하나라도 들어있으면 비한국어 혼입으로 간주.
// (한국어 가운뎃점 '·'(U+00B7)·물결표 '~'·화살표 '→'·말줄임표 '…'는 이 범위 밖이라 안 걸림.)
const NON_KOREAN =
  /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯Ѐ-ӿ]/;
const cleanLine = (s: string): string => {
  let t = s.trim();
  for (const [re, rep] of SALVAGE) t = t.replace(re, rep);
  return t;
};

const callGroqWith = async (
  apiKey: string,
  summary: string,
  model: string,
  maxTokens: number,
): Promise<string[] | null> => {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `[가게 매출 데이터]\n${summary}` },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    });
    // 429(rate limit) / 5xx → null 반환해서 다음 모델로 fallback
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
    if (!raw) return null;
    // JSON 배열 추출
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as unknown;
        if (Array.isArray(parsed)) {
          const arr = parsed
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 4)
            .map(cleanLine)
            .filter((x) => x.length > 4 && !NON_KOREAN.test(x))
            .slice(0, 5);
          if (arr.length) return arr;
        }
      } catch {
        /* fall through */
      }
    }
    // 줄바꿈 fallback
    const lines = raw
      .split('\n')
      .map((l) => cleanLine(l.replace(/^["\s\-*•\d.)]+/, '').replace(/["\s]+$/, '')))
      .filter((l) => l.length > 8 && !NON_KOREAN.test(l))
      .slice(0, 4);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
};

export async function handleInsights(
  env: Env,
  userId: number,
  raw: unknown,
): Promise<Response> {
  const body = sanitizeBody(raw);
  if (!body) return err('잘못된 요청입니다.');
  // 미래 월은 호출 자체가 무의미 — 거절 (클라 버그 방어)
  if (body.ym && body.ym > currentYmKst()) return err('미래 월은 분석할 수 없어요.');
  // 데이터 빈약: AI 호출 안 하고 안내만 (저장도 안 함)
  if (body.stats!.qty < 5) {
    return ok({
      insights: ['데이터가 더 쌓이면 더 정확한 분석을 드릴 수 있어요.'],
      source: 'rule',
    });
  }
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return ok({ insights: [], source: 'no-key' });

  const rl = await checkRateLimit(env, `insights:${userId}`, 10, 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfterMs);
  await recordAttempt(env, `insights:${userId}`);

  const summary = buildSummary(body);
  for (const { model, maxTokens } of MODELS) {
    const insights = await callGroqWith(apiKey, summary, model, maxTokens);
    if (insights) {
      // 과거 월(완료 월)만 영구 저장 — 이번 달은 데이터 계속 변하므로 저장 X
      if (body.ym && body.ym < currentYmKst()) {
        await env.DB.prepare(
          `INSERT INTO ai_insights (user_id, year_month, business_type, monthly_fixed_cost, insights_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, year_month) DO UPDATE SET
             business_type = excluded.business_type,
             monthly_fixed_cost = excluded.monthly_fixed_cost,
             insights_json = excluded.insights_json,
             created_at = excluded.created_at`,
        )
          .bind(
            userId,
            body.ym,
            body.businessType ?? null,
            body.monthlyFixedCost ?? 0,
            JSON.stringify(insights),
            Date.now(),
          )
          .run();
      }
      return ok({ insights, source: 'groq', model });
    }
  }
  return ok({ insights: [], source: 'groq-fail' });
}

// GET /api/insights?ym=YYYY-MM — 저장된 과거 월 결과 조회. 현재/미래 월은 항상 found:false.
export async function handleInsightsGet(
  env: Env,
  userId: number,
  ym: string,
): Promise<Response> {
  if (!YM_RE.test(ym)) return err('잘못된 월 형식이에요.');
  if (ym >= currentYmKst()) return ok({ found: false });
  const row = await env.DB.prepare(
    `SELECT insights_json, created_at FROM ai_insights
     WHERE user_id = ? AND year_month = ?`,
  )
    .bind(userId, ym)
    .first<{ insights_json: string; created_at: number }>();
  if (!row) return ok({ found: false });
  let insights: string[] = [];
  try {
    const parsed = JSON.parse(row.insights_json) as unknown;
    if (Array.isArray(parsed)) {
      insights = parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // 파싱 실패면 stale data — 모르게 처리하고 새로 생성하도록 안내
    return ok({ found: false });
  }
  return ok({ found: true, insights, created_at: row.created_at });
}
