import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { won } from '../lib/format';
import { getCache, setCache, isFresh, invalidate } from '../lib/cache';
import { inferEmoji } from '../lib/emojiLookup';
import { Skeleton } from '../components/Skeleton';
import NavIcon from '../components/NavIcon';
import { useAuth } from '../hooks/useAuth';

interface Menu {
  id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
  display_order: number;
}

const empty = {
  name: '',
  category: '',
  cost: '',
  price: '',
  emoji: '📦',
};

export default function Menus() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const cacheKey = `menus:${userId}`;
  const TTL_MENUS = 5 * 60 * 1000;

  const [menus, setMenus] = useState<Menu[]>(
    () => getCache<Menu[]>(cacheKey) ?? [],
  );
  const [loaded, setLoaded] = useState<boolean>(
    () => (getCache<Menu[]>(cacheKey)?.length ?? 0) > 0,
  );
  const [editing, setEditing] = useState<Menu | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  // ref-guard: 같은 tick burst click도 동기 차단 (state는 disabled 스타일링용)
  const reorderingRef = useRef(false);
  // 이름→이모지 AI 폴백 (클라 사전 미스 시 debounce 후 /api/infer-emoji)
  const emojiTimerRef = useRef<number | null>(null);
  const emojiAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (emojiTimerRef.current) window.clearTimeout(emojiTimerRef.current);
      emojiAbortRef.current?.abort();
    },
    [],
  );

  const load = async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && isFresh(cacheKey, TTL_MENUS)) {
      setLoaded(true);
      return;
    }
    try {
      const data = await apiGet<{ menus: Menu[] }>('/api/menus');
      setMenus(data.menus);
      setCache(cacheKey, data.menus);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Menu[]>();
    for (const m of menus) {
      const key = m.category?.trim() || '미분류';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries());
  }, [menus]);

  const closeForm = () => {
    setEditing(null);
    setForm({ ...empty });
    setError(null);
    setFormOpen(false);
  };
  const openNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setError(null);
    setFormOpen(true);
  };
  const startEdit = (m: Menu) => {
    setEditing(m);
    setForm({
      name: m.name,
      category: m.category ?? '',
      cost: String(m.cost),
      price: String(m.price),
      emoji: m.emoji || '📦',
    });
    setError(null);
    setFormOpen(true);
  };

  // 이름 변경 시: 즉시 클라 사전 추론 → 미스(📦)면 debounce 후 AI 폴백
  const onNameChange = (name: string) => {
    const local = inferEmoji(name);
    setForm((prev) => ({ ...prev, name, emoji: local }));
    if (emojiTimerRef.current) window.clearTimeout(emojiTimerRef.current);
    emojiAbortRef.current?.abort();
    emojiAbortRef.current = null;
    if (local === '📦' && name.trim().length >= 2) {
      emojiTimerRef.current = window.setTimeout(() => {
        const ctrl = new AbortController();
        emojiAbortRef.current = ctrl;
        api<{ emoji: string; source: string }>(
          `/api/infer-emoji?name=${encodeURIComponent(name)}`,
          { signal: ctrl.signal },
        )
          .then((data) => {
            setForm((prev) =>
              prev.name === name ? { ...prev, emoji: data.emoji } : prev,
            );
          })
          .catch(() => {
            /* abort 또는 실패 — 📦 유지 */
          });
      }, 600);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cost = Number(form.cost);
    const price = Number(form.price);
    if (!form.name.trim()) return setError('메뉴 이름을 입력해주세요.');
    if (!Number.isInteger(cost) || cost < 0) return setError('원가는 0 이상의 정수.');
    if (!Number.isInteger(price) || price < 0) return setError('판매가는 0 이상의 정수.');
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        cost,
        price,
        emoji: form.emoji,
      };
      if (editing) {
        await apiPut(`/api/menus/${editing.id}`, payload);
      } else {
        await apiPost('/api/menus', payload);
      }
      invalidate(cacheKey);
      await load({ force: true });
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (id: number) => {
    if (!confirm('이 메뉴를 보관(숨김)할까요? 과거 매출 기록은 유지됩니다.')) return;
    await apiDelete(`/api/menus/${id}`);
    invalidate(cacheKey);
    await load({ force: true });
    if (editing?.id === id) closeForm();
  };

  const move = async (id: number, dir: 'up' | 'down') => {
    if (reorderingRef.current) return;
    reorderingRef.current = true;
    setReordering(true);
    try {
      await apiPost(`/api/menus/${id}/${dir}`);
      invalidate(cacheKey);
      await load({ force: true });
    } finally {
      reorderingRef.current = false;
      setReordering(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl text-ink">메뉴 관리</h1>
          <span className="text-sub text-sm">{menus.length}개 활성</span>
        </div>
        {!formOpen && menus.length > 0 && (
          <button
            type="button"
            onClick={openNew}
            className="btn-primary px-4 h-10 text-sm"
          >
            + 추가
          </button>
        )}
      </div>

      {formOpen && (
      <form onSubmit={submit} className="card p-5 mb-6 space-y-4 anim-fade">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {editing ? `'${editing.name}' 수정` : '새 메뉴 추가'}
          </h2>
          <button
            type="button"
            onClick={closeForm}
            className="text-sm text-sub px-2 py-1 rounded hover:bg-black/5"
            aria-label="폼 닫기"
          >
            닫기
          </button>
        </div>
        <div className="grid grid-cols-[64px_1fr] gap-3 items-end">
          <div className="row-span-1">
            <label className="label">아이콘</label>
            <div
              className="h-12 rounded-xl border border-border bg-bg
                         flex items-center justify-center text-3xl leading-none
                         transition"
              aria-label="자동 추론 이모지"
            >
              {form.emoji}
            </div>
          </div>
          <div>
            <label className="label">이름</label>
            <input
              required
              className="field"
              value={form.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="예: 아메리카노, 트레이닝복, 장미꽃다발…"
            />
          </div>
          <div className="col-span-2">
            <label className="label">분류 (선택)</label>
            <input
              className="field"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="예: 음료 / 의류 / 디저트"
            />
          </div>
          <div>
            <label className="label">원가 (원)</label>
            <input
              required
              type="number"
              inputMode="numeric"
              className="field num"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </div>
          <div>
            <label className="label">판매가 (원)</label>
            <input
              required
              type="number"
              inputMode="numeric"
              className="field num"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-sub -mt-2">
          아이콘은 이름에 따라 자동으로 선택돼요. (처음 보는 이름은 잠깐 분석해요)
        </p>
        {error && <p className="text-warm text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '저장 중…' : editing ? '수정 저장' : '메뉴 추가'}
        </button>
      </form>
      )}

      {!loaded ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : menus.length === 0 && !formOpen ? (
        <div className="card p-10 text-center">
          <p className="text-sub mb-4">아직 메뉴가 없어요.</p>
          <button
            type="button"
            onClick={openNew}
            className="btn-primary inline-flex px-5"
          >
            + 첫 메뉴 추가하기
          </button>
        </div>
      ) : menus.length === 0 ? null : (
        <div className="space-y-6">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <h3 className="text-sm text-sub mb-2 px-1">{cat}</h3>
              <ul className="card divide-y divide-border overflow-hidden">
                {items.map((m, idx) => (
                  <li
                    key={m.id}
                    className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-2xl w-10 shrink-0 text-center">
                        {m.emoji}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{m.name}</div>
                        <div className="text-sub text-sm num">
                          {won(m.price)}{' '}
                          <span className="text-xs">/ 원가 {won(m.cost)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 self-end md:self-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => move(m.id, 'up')}
                        disabled={idx === 0 || reordering}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-lg border border-border text-sub disabled:opacity-30"
                        aria-label="위로"
                      >
                        <NavIcon name="chevron-up" size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(m.id, 'down')}
                        disabled={idx === items.length - 1 || reordering}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-lg border border-border text-sub disabled:opacity-30"
                        aria-label="아래로"
                      >
                        <NavIcon name="chevron-down" size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-lg border border-border text-sub"
                        aria-label="수정"
                      >
                        <NavIcon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => archive(m.id)}
                        className="w-11 h-11 inline-flex items-center justify-center rounded-lg border border-border text-sub"
                        aria-label="보관"
                      >
                        <NavIcon name="archive" size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
