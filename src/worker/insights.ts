import { Env, ok, err } from './types';
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
interface InsightsBody {
  stats?: StatsPayload;
  prevStats?: { revenue: number; profit: number; qty: number } | null;
  rangeLabel?: string;
}

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
  return { stats, prevStats, rangeLabel: str(o.rangeLabel, 30) || undefined };
};

const buildSummary = (b: InsightsBody): string => {
  const s = b.stats!;
  const lines: string[] = [];
  lines.push(`- 기간: ${b.rangeLabel || '선택 기간'}`);
  lines.push(
    `- 총매출 ${won(s.revenue)} / 총원가 ${won(s.cost)} / 순이익 ${won(s.profit)} / 마진율 ${pctStr(s.margin)} / 판매 ${s.qty}건`,
  );
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
  return lines.join('\n');
};

const SYSTEM_PROMPT =
  '당신은 한국 1인 사업자(카페·음식점·소매점 사장님)의 매출 데이터를 분석해 ' +
  '실질적으로 도움 되는 인사이트를 알려주는 분석가입니다.\n' +
  '규칙:\n' +
  '- 인사이트 2~4개. 각 1~2문장. "~예요/~네요/~어요" 같은 친근한 존댓말. ("에요" 아님 "예요")\n' +
  '- 반드시 데이터의 구체적 숫자를 인용하고, 가능하면 실행 가능한 제안 1가지를 포함.\n' +
  '- 한국어만 사용. 한자·영어·일본어 단어를 섞지 말 것(예: "最高" 금지, "최고").\n' +
  '- 데이터에 없는 메뉴명·숫자를 지어내지 말 것.\n' +
  '- 판매가 5건 미만이거나 데이터가 빈약하면 인사이트 1개로 "데이터가 더 쌓이면 더 정확한 분석을 드릴 수 있어요" 정도만.\n' +
  '- 출력은 JSON 배열만: ["인사이트1", "인사이트2", ...]. 다른 텍스트·코드펜스·설명 절대 금지.';

// Groq rate limit은 모델마다 다름 — 추론력 좋은 70b 먼저, 한도 차면(429) 가벼운 8b로 fallback.
// https://console.groq.com/docs/rate-limits
const MODELS: ReadonlyArray<{ model: string; maxTokens: number }> = [
  { model: 'llama-3.3-70b-versatile', maxTokens: 550 },
  { model: 'llama-3.1-8b-instant', maxTokens: 480 },
];

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
            .map((x) => x.trim())
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
      .map((l) => l.replace(/^["\s\-*•\d.)]+/, '').replace(/["\s]+$/, '').trim())
      .filter((l) => l.length > 8)
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
  // 데이터 빈약: AI 호출 안 하고 안내만
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
    if (insights) return ok({ insights, source: 'groq', model });
  }
  return ok({ insights: [], source: 'groq-fail' });
}
