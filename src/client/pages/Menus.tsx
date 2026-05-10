import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { won } from '../lib/format';

interface Menu {
  id: number;
  name: string;
  category: string | null;
  cost: number;
  price: number;
  emoji: string | null;
  display_order: number;
}

const EMOJI_PRESETS = [
  '☕', '🍵', '🥤', '🧃', '🍰', '🥐', '🍞', '🥪', '🍔', '🍟',
  '🍕', '🍝', '🍜', '🍱', '🍣', '🍙', '🍦', '🍩', '🍪', '📦',
];

const empty = {
  name: '',
  category: '',
  cost: '',
  price: '',
  emoji: '☕',
};

export default function Menus() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ menus: Menu[] }>('/api/menus');
      setMenus(data.menus);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
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

  const startNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setError(null);
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
      await load();
      startNew();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (id: number) => {
    if (!confirm('이 메뉴를 보관(숨김)할까요? 과거 매출 기록은 유지됩니다.')) return;
    await apiDelete(`/api/menus/${id}`);
    await load();
    if (editing?.id === id) startNew();
  };

  const move = async (id: number, dir: 'up' | 'down') => {
    await apiPost(`/api/menus/${id}/${dir}`);
    await load();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-0 py-4 md:py-0">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="font-display text-2xl text-ink">메뉴 관리</h1>
        <span className="text-sub text-sm">{menus.length}개 활성</span>
      </div>

      <form onSubmit={submit} className="card p-5 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {editing ? `'${editing.name}' 수정` : '새 메뉴 추가'}
          </h2>
          {editing && (
            <button type="button" onClick={startNew} className="text-sm text-sub">
              취소
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">이름</label>
            <input
              required
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="예: 아메리카노"
            />
          </div>
          <div>
            <label className="label">분류 (선택)</label>
            <input
              className="field"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="예: 음료"
            />
          </div>
          <div>
            <label className="label">이모지</label>
            <div className="flex flex-wrap gap-1">
              {EMOJI_PRESETS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setForm({ ...form, emoji: e })}
                  className={`w-10 h-10 rounded-lg text-xl border ${
                    form.emoji === e
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-card'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
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
        {error && <p className="text-warm text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? '저장 중…' : editing ? '수정 저장' : '메뉴 추가'}
        </button>
      </form>

      {loading ? (
        <p className="text-sub">불러오는 중…</p>
      ) : menus.length === 0 ? (
        <div className="card p-10 text-center text-sub">
          아직 메뉴가 없어요. 위에서 첫 메뉴를 추가해보세요.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <h3 className="text-sm text-sub mb-2 px-1">{cat}</h3>
              <ul className="card divide-y divide-border overflow-hidden">
                {items.map((m, idx) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <span className="text-2xl w-10 text-center">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{m.name}</div>
                      <div className="text-sub text-sm num">
                        {won(m.price)} <span className="text-xs">/ 원가 {won(m.cost)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(m.id, 'up')}
                        disabled={idx === 0 && grouped[0]?.[0] === cat}
                        className="w-9 h-9 rounded-lg border border-border text-sub disabled:opacity-30"
                        aria-label="위로"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => move(m.id, 'down')}
                        className="w-9 h-9 rounded-lg border border-border text-sub"
                        aria-label="아래로"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="w-9 h-9 rounded-lg border border-border text-sm"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => archive(m.id)}
                        className="w-9 h-9 rounded-lg border border-border text-sm"
                        title="보관(숨김)"
                      >
                        🗄
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
