import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Skeleton } from './Skeleton';
import { timeHM, startOfDay } from '../lib/format';

const todayFromMs = () => startOfDay(new Date()).getTime();
const TODAY_NEEDS_URL = () => `/api/needs?from=${todayFromMs()}&limit=300`;

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
  menuIds: number[];
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
// 미동반·식사대용을 첫 옵션으로 — 기본값이 모두 맨 왼쪽에 와서 선택 표시가 일자로 정렬됨
const CHILD_OPTS = [
  { v: 'no' as const, l: '미동반' },
  { v: 'yes' as const, l: '자녀 동반' },
];
const PURPOSE_OPTS = [
  { v: 'meal_replacement' as Purpose, l: '식사대용' },
  { v: 'gift' as Purpose, l: '선물용' },
  { v: 'kids_snack' as Purpose, l: '자녀 간식용' },
];
const RESID_OPTS = [
  { v: 'busan' as Resid, l: '부산' },
  { v: 'outside' as Resid, l: '부산 외' },
];

// 자주 오는 손님 기준 기본값 (전부 각 그룹의 첫 옵션 = 왼쪽 정렬)
const DEFAULTS = {
  gender: 'female' as Gender,
  age: '10s_20s' as Age,
  child: 'no' as 'yes' | 'no',
  purpose: 'meal_replacement' as Purpose,
  residence: 'busan' as Resid,
};

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

function chips(n: NeedEntry, menus: MenuLite[]): string[] {
  const out: string[] = [];
  if (n.gender) out.push(LABEL[n.gender]);
  if (n.ageBand) out.push(LABEL[n.ageBand]);
  if (n.withChild != null) out.push(n.withChild ? '자녀 동반' : '미동반');
  if (n.purpose) out.push(LABEL[n.purpose]);
  if (n.residence) out.push(LABEL[n.residence]);
  for (const id of n.menuIds) {
    const m = menus.find((x) => x.id === id);
    if (m) out.push(`${m.emoji || '📦'} ${m.name}`);
  }
  return out;
}

export default function NeedsTab({
  menus,
  menusLoaded = true,
}: {
  menus: MenuLite[];
  menusLoaded?: boolean;
}) {
  const [gender, setGender] = useState<Gender | null>(DEFAULTS.gender);
  const [age, setAge] = useState<Age | null>(DEFAULTS.age);
  const [child, setChild] = useState<'yes' | 'no' | null>(DEFAULTS.child);
  const [purpose, setPurpose] = useState<Purpose | null>(DEFAULTS.purpose);
  const [residence, setResidence] = useState<Resid | null>(DEFAULTS.residence);
  const [menuIds, setMenuIds] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<NeedEntry[] | null>(null); // 오늘 기록만
  const [toast, setToast] = useState<string | null>(null);

  // 오늘 기록만 — 어제까지의 누적은 BI 분포 카드에서
  useEffect(() => {
    let alive = true;
    apiGet<{ needs: NeedEntry[] }>(TODAY_NEEDS_URL())
      .then((d) => alive && setRecent(d.needs))
      .catch(() => alive && setRecent((p) => p ?? []));
    return () => {
      alive = false;
    };
  }, []);
  const reloadRecent = async () => {
    try {
      const d = await apiGet<{ needs: NeedEntry[] }>(`${TODAY_NEEDS_URL()}&_ts=${Date.now()}`);
      setRecent(d.needs);
    } catch {
      /* 무시 */
    }
  };

  // 선택된 메뉴 (등록 순서대로)
  const selectedMenus = useMemo(
    () => menus.filter((m) => menuIds.includes(m.id)),
    [menus, menuIds],
  );
  const toggleMenu = (id: number) =>
    setMenuIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const hasAny = !!(gender || age || child || purpose || residence) || menuIds.length > 0;

  // 자주 오는 손님 기준 프리셋으로 되돌림 (제품 선택은 비움)
  const reset = () => {
    setGender(DEFAULTS.gender);
    setAge(DEFAULTS.age);
    setChild(DEFAULTS.child);
    setPurpose(DEFAULTS.purpose);
    setResidence(DEFAULTS.residence);
    setMenuIds([]);
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
        menuIds,
      });
      await reloadRecent();
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
    <div>
      <p className="text-sub text-sm mb-4 break-keep">
        손님 특성을 가볍게 남겨두면, 어떤 손님이 무엇을 찾는지 감이 잡혀요.
        자주 오는 손님 기준으로 미리 골라뒀어요 — 다르면 바꿔서 기록하세요.
      </p>

      <div className="card p-5 space-y-4">
        <Seg label="성별" options={GENDER_OPTS} value={gender} onChange={setGender} />
        <Seg label="연령대" options={AGE_OPTS} value={age} onChange={setAge} />
        <Seg label="자녀 동반 여부" options={CHILD_OPTS} value={child} onChange={setChild} />
        <Seg label="목적" options={PURPOSE_OPTS} value={purpose} onChange={setPurpose} />
        <Seg label="거주지" options={RESID_OPTS} value={residence} onChange={setResidence} />

        <div>
          <div className="label">판매제품 (여러 개 선택 가능)</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={!menusLoaded || menus.length === 0}
              className={`flex-1 min-w-0 h-10 px-3 rounded-lg border text-sm text-left truncate transition ${
                selectedMenus.length > 0
                  ? 'bg-accent/[0.04] border-accent/40 text-ink'
                  : 'bg-card border-border text-sub hover:border-accent/40'
              } disabled:opacity-50`}
            >
              {!menusLoaded
                ? '메뉴 불러오는 중…'
                : menus.length === 0
                ? '등록된 메뉴가 없어요'
                : selectedMenus.length === 0
                ? '제품 선택하기'
                : selectedMenus.length === 1
                ? `${selectedMenus[0].emoji || '📦'} ${selectedMenus[0].name}`
                : `${selectedMenus[0].emoji || '📦'} ${selectedMenus[0].name} 외 ${selectedMenus.length - 1}개`}
            </button>
            {selectedMenus.length > 0 && (
              <button
                type="button"
                onClick={() => setMenuIds([])}
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

      {/* 오늘 기록 — 당일 것만. 어제까지의 누적 분포는 BI 고객 니즈 카드에서 */}
      <div className="mt-6">
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <h3 className="font-semibold">
            오늘 기록
            {recent && recent.length > 0 && (
              <span className="text-sub font-normal text-sm num"> {recent.length}건</span>
            )}
          </h3>
          <Link to="/bi" className="text-xs text-accent hover:underline shrink-0">
            전체 분포 → BI
          </Link>
        </div>
        {recent === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="card p-8 text-center text-sub text-sm break-keep">
            오늘은 아직 기록이 없어요. 위에서 골라 기록해보세요.
            <br />
            이전 누적 분포는{' '}
            <Link to="/bi" className="text-accent underline">
              BI 대시보드
            </Link>
            에서.
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden max-h-[28rem] overflow-y-auto">
            {recent.map((n) => (
              <li key={n.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    {chips(n, menus).map((c, i) => (
                      <span
                        key={i}
                        className="text-xs bg-bg border border-border rounded-full px-2 py-0.5 text-ink/80"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="text-sub text-[11px] mt-1 num">
                    {timeHM(n.createdAt)}
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
              <h2 className="font-semibold text-sm">
                판매제품 선택
                {menuIds.length > 0 && (
                  <span className="text-sub font-normal num"> · {menuIds.length}개</span>
                )}
              </h2>
              <div className="flex items-center gap-1">
                {menuIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMenuIds([])}
                    className="text-xs text-sub px-2 h-8 rounded hover:bg-black/5"
                  >
                    전체 해제
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="text-sm text-accent font-medium px-3 h-8 rounded hover:bg-accent/10"
                >
                  완료
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {menus.map((m) => {
                const active = menuIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMenu(m.id)}
                    aria-pressed={active}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
                      active ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-black/5'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center text-[11px] shrink-0 ${
                        active
                          ? 'bg-accent border-accent text-white'
                          : 'border-border text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="text-lg">{m.emoji || '📦'}</span>
                    <span className="flex-1 truncate">{m.name}</span>
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
