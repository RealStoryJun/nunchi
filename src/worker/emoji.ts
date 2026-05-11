import { Env, ok } from './types';
import { checkRateLimit, recordAttempt, tooMany } from './ratelimit';

// 메뉴/상품 이름 → 이모지 추론.
// 경로: D1 emoji_cache (영구 누적) → Groq (미스 시 실시간) → D1 저장.
// GROQ_API_KEY 미설정 시 graceful: 캐시 미스는 📦.

const SYSTEM_PROMPT =
  '너는 한국 자영업의 메뉴·상품·서비스 이름을 받아 가장 어울리는 유니코드 이모지를 정확히 1개만 출력한다. ' +
  '이모지 1개만 출력하고 설명·따옴표·공백 등 다른 문자는 절대 출력하지 마라. ' +
  '카페·음식점·옷가게·가방가게·화장품·꽃집·서점·문구점·펫샵·미용실·전자제품 등 어떤 업종이든 대응해라. ' +
  '적합한 이모지가 없으면 📦 를 출력해라.';

const normalize = (s: string): string =>
  s.replace(/[\s().,\-_/]/g, '').toLowerCase();

// Extended_Pictographic 한 덩어리 + (옵션) ZWJ/variation selector. 4 codepoint까지 허용.
const EMOJI_RE = /^\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|[︀-️\u{1F3FB}-\u{1F3FF}])*$/u;
const isEmoji = (s: string): boolean => {
  const t = s.trim();
  if (!t || [...t].length > 4) return false;
  return EMOJI_RE.test(t);
};

interface GroqResp {
  choices?: Array<{ message?: { content?: string } }>;
}

const askGroq = async (apiKey: string, name: string): Promise<string | null> => {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: name.slice(0, 80) },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GroqResp;
    const raw = (data?.choices?.[0]?.message?.content ?? '').trim();
    if (isEmoji(raw)) return raw;
    // 모델이 여분 텍스트를 붙인 경우 첫 픽토그래픽 1글자만 추출
    const m = raw.match(/\p{Extended_Pictographic}(?:️)?/u);
    if (m && isEmoji(m[0])) return m[0];
    return null;
  } catch {
    return null;
  }
};

export async function handleInferEmoji(
  env: Env,
  userId: number,
  name: string,
): Promise<Response> {
  const key = normalize(name);
  if (!key) return ok({ emoji: '📦', source: 'fallback' });

  // 1) D1 캐시 (글로벌 — 이모지는 공개 데이터). 캐시 히트는 rate limit 비용 없음.
  const cached = await env.DB.prepare(
    'SELECT emoji FROM emoji_cache WHERE key = ?',
  )
    .bind(key)
    .first<{ emoji: string }>();
  if (cached) return ok({ emoji: cached.emoji, source: 'cache' });

  // 2) Groq (키 없으면 fallback — 캐시는 안 함, 키 등록 후 다시 시도되게)
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return ok({ emoji: '📦', source: 'fallback' });

  // 캐시 미스 + Groq 호출 직전에만 rate limit (사용자당 30/분 → Groq 호출 상한)
  const rl = await checkRateLimit(env, `infer:${userId}`, 30, 60 * 1000);
  if (!rl.ok) return tooMany(rl.retryAfterMs);

  await recordAttempt(env, `infer:${userId}`);
  const inferred = await askGroq(apiKey, name);
  const emoji = inferred ?? '📦';

  // 3) D1 저장 (📦도 저장 — 같은 입력 반복 시 Groq 재호출 방지.
  //    추후 사전 보강하려면 source='groq' AND emoji='📦' 행을 재추론)
  await env.DB.prepare(
    `INSERT INTO emoji_cache (key, emoji, source, updated_at)
     VALUES (?, ?, 'groq', ?)
     ON CONFLICT(key) DO UPDATE SET emoji = excluded.emoji, source = 'groq', updated_at = excluded.updated_at`,
  )
    .bind(key, emoji, Date.now())
    .run();

  return ok({ emoji, source: 'groq' });
}
