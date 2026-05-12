import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Skeleton } from './Skeleton';
import { dayLabel, timeHM } from '../lib/format';

interface MenuLite {
  id: number;
  name: string;
  emoji: string | null;
}
interface NeedEntry {
  id: number;
  gender: 'female' | 'male' | null;
  ageBand: '10s_20s' | '30s_40s' | '50plus' | null;
  withChild: boolean | null;
  purpose: 'gift' | 'kids_snack' | 'meal_replacement' | null;
  residence: 'busan' | 'outside' | null;
  menuId: number | null;
  menuName: string | null;
  menuEmoji: string | null;
  createdAt: number;
}

type Gender = 'female' | 'male';
type Age = '10s_20s' | '30s_40s' | '50plus';
type Purpose = 'gift' | 'kids_snack' | 'meal_replacement';
type Resid = 'busan' | 'outside';

const GENDER_OPTS = [
  { v: 'female' as Gender, l: '여성' },
  { v: 'male' as Gender, l: '남성' },
];
const AGE_OPTS = [
  { v: '10s_20s' as Age, l: '10–20대' },
  { v: '30s_40s' as Age, l: '30–40대' },
  { v: '50plus' as Age, l: '50대+' },
];
const CHILD_OPTS = [
  { v: 'yes' as const, l: '자녀 동반' },
  { v: 'no' as const, l: '미동반' },
];
const PURPOSE_OPTS = [
  { v: 'gift' as Purpose, l: '선물용' },
  { v: 'kids_snack' as Purpose, l: '자녀 간식용' },
  { v: 'meal_replacement' as Purpose, l: '식사대용' },
];
const RESID_OPTS = [
  { v: 'busan' as Resid, l: '부산' },
  { v: 'outside' as Resid, l: '부산 외' },
];

const LABEL: Record<string, string> = {
  female: '여성',
  male: '남성',
  '10s_20s': '10–20대',
  '30s_40s': '30–40대',
  '50plus': '50대+',
  gift: '선물용',
  kids_snack: '자녀 간식용',
  meal_replacement: '식사대용',
  busan: '부산',
  outside: '부산 외',
};

function Seg<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { v: V; l: string }[];
  value: V | null;
  onChange: (v: V | null) => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : o.v)}
              className={`px-3.5 h-10 rounded-lg text-sm border transition active:scale-[0.97] ${
                active
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-card text-ink border-border hover:border-accent/40'
              }`}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function chips(n: NeedEntry): string[] {
  const out: string[] = [];
  if (n.gender) out.push(LABEL[n.gender]);
  if (n.ageBand) out.push(LABEL[n.ageBand]);
  if (n.withChild != null) out.push(n.withChild ? '자녀 동반' : '미동반');
  if (n.purpose) out.push(LABEL[n.purpose]);
  if (n.residence) out.push(LABEL[n.residence]);
  if (n.menuName) out.push(`${n.menuEmoji || '📦'} ${n.menuName}`);
  return out;
}

export default function NeedsTab({ menus }: { menus: MenuLite[] }) {
  const [gender, setGender] = useState<Gender | null>(null);
  const [age, setAge] = useState<Age | null>(null);
  const [child, setChild] = useState<'yes' | 'no' | null>(null);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [residence, setResidence] = useState<Resid | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<NeedEntry[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<{ needs: NeedEntry[] }>('/api/needs?limit=20')
      .then((d) => alive && setRecent(d.needs))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, []);

  const selectedMenu = useMemo(
    () => menus.find((m) => m.id === menuId) ?? null,
    [menus, menuId],
  );
  const hasAny = !!(gender || age || child || purpose || residence || menuId);

  const reset = () => {
    setGender(null);
    setAge(null);
    setChild(null);
    setPurpose(null);
    setResidence(null);
    setMenuId(null);
  };

  const submit = async () => {
    if (submitting || !hasAny) return;
    setSubmitting(true);
    try {
      await apiPost('/api/needs', {
        gender,
        ageBand: age,
        withChild: child === 'yes' ? true : child === 'no' ? false : undefined,
        purpose,
        residence,
        menuId: menuId ?? undefined,
      });
      const d = await apiGet<{ needs: NeedEntry[] }>('/api/needs?limit=20');
      setRecent(d.needs);
      reset();
      setToast('고객 니즈 기록됐어요');
      window.setTimeout(() => setToast(null), 2200);
    } catch (e) {
      alert(e instanceof Error ? e.message : '기록에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  };

  const removeEntry = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await apiDelete(`/api/needs/${id}`);
      setRecent((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했어요.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <p className="text-sub text-sm mb-4 break-keep">
        손님 특성을 가볍게 남겨두면, 어떤 손님이 무엇을 찾는지 감을 잡는 데 도움이 돼요.
        한 가지만 골라도 괜찮아요.
      </p>

      <div className="card p-5 space-y-4">
        <Seg label="성별" options={GENDER_OPTS} value={gender} onChange={setGender} />
        <Seg label="연령대" options={AGE_OPTS} value={age} onChange={setAge} />
        <Seg label="자녀 동반 여부" options={CHILD_OPTS} value={child} onChange={setChild} />
        <Seg label="목적" options={PURPOSE_OPTS} value={purpose} onChange={setPurpose} />
        <Seg label="거주지" options={RESID_OPTS} value={residence} onChange={setResidence} />

        <div>
          <div className="label">판매제품</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={menus.length === 0}
              className={`flex-1 min-w-0 h-10 px-3 rounded-lg border text-sm text-left truncate transition ${
                selectedMenu
                  ? 'bg-accent/[0.04] border-accent/40 text-ink'
                  : 'bg-card border-border text-sub hover:border-accent/40'
              } disabled:opacity-50`}
            >
              {selectedMenu
                ? `${selectedMenu.emoji || '📦'} ${selectedMenu.name}`
                : menus.length === 0
                ? '등록된 메뉴가 없어요'
                : '제품 선택하기'}
            </button>
            {selectedMenu && (
              <button
                type="button"
                onClick={() => setMenuId(null)}
                className="text-xs text-sub hover:text-ink px-2 h-9 shrink-0"
              >
                지우기
              </button>
            )}
          </div>
        </div>

        <div className="pt-1 flex items-center gap-2">
          {hasAny && (
            <button
              type="button"
              onClick={reset}
              disabled={submitting}
              className="text-xs text-sub hover:text-ink px-1.5 h-10 shrink-0 disabled:opacity-40"
            >
              초기화
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!hasAny || submitting}
            className="btn-primary flex-1 h-10 text-sm disabled:opacity-40"
          >
            {submitting ? '기록 중…' : '고객 니즈 기록하기'}
          </button>
        </div>
      </div>

      {/* 최근 기록 */}
      <div className="mt-6">
        <h3 className="font-semibold mb-2">최근 기록</h3>
        {recent === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="card p-8 text-center text-sub text-sm">
            아직 기록이 없어요. 위에서 손님 특성을 골라 기록해보세요.
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {recent.map((n) => (
              <li key={n.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    {chips(n).map((c, i) => (
                      <span
                        key={i}
                        className="text-xs bg-bg border border-border rounded-full px-2 py-0.5 text-ink/80"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="text-sub text-[11px] mt-1 num">
                    {dayLabel(n.createdAt)} {timeHM(n.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(n.id)}
                  className="text-warm w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-warm/10 shrink-0"
                  aria-label="삭제"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 제품 선택 팝업 */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-card w-full md:max-w-md max-h-[75vh] rounded-t-2xl md:rounded-2xl border border-border shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 h-12 flex items-center justify-between border-b border-border shrink-0">
              <h2 className="font-semibold text-sm">판매제품 선택</h2>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-sm text-sub px-2 h-8 rounded hover:bg-black/5"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => {
                  setMenuId(null);
                  setPickerOpen(false);
                }}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-sub hover:bg-black/5"
              >
                선택 안 함
              </button>
              {menus.map((m) => {
                const active = m.id === menuId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMenuId(m.id);
                      setPickerOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
                      active ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5'
                    }`}
                  >
                    <span className="text-lg">{m.emoji || '📦'}</span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {active && <span className="text-accent">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-40 pointer-events-none bottom-24 md:bottom-auto md:top-20">
          <div className="anim-toast bg-accent text-white rounded-full px-4 py-2 text-sm font-medium shadow-soft flex items-center gap-2 whitespace-nowrap">
            <span className="text-base leading-none">✓</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
