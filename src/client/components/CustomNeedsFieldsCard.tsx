import { FormEvent, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../lib/api';

interface NeedsField {
  id: number;
  field_key: string;
  label: string;
  options: { v: string; l: string }[];
  sort_order: number;
}

// 사장님별 커스텀 손님 설문 항목 관리 (2026-05-18 PR 1).
// /account 에서 본인 가게 손님 설문 항목 자유 추가 (max 5필드, 각 6옵션).
export default function CustomNeedsFieldsCard() {
  const [fields, setFields] = useState<NeedsField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const d = await apiGet<{ fields: NeedsField[] }>('/api/me/needs-fields');
      setFields(d.fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    }
  };
  useEffect(() => { void load(); }, []);

  const handleDelete = async (id: number, label: string) => {
    if (!confirm(`"${label}" 항목을 삭제할까요?\n과거 손님 데이터의 이 항목 값은 숨겨집니다 (실제 행은 보존).`)) return;
    try {
      await apiDelete(`/api/me/needs-fields/${id}`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  return (
    <div className="card p-5 mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">손님 설문 항목 (추가)</h2>
        <button type="button" onClick={() => setAddOpen(true)}
          disabled={!fields || fields.length >= 5}
          className="btn-primary px-3 h-8 text-xs shrink-0 disabled:opacity-40">+ 항목 추가</button>
      </div>
      <p className="text-sub text-sm break-keep">
        기본 5항목(성별·연령·자녀·목적·거주) 외에 본인 가게에 맞는 손님 정보를 최대 5개 추가할 수 있어요.
        손님 입력 화면·CSV·AI 분석에 자동 반영됩니다.
      </p>

      {fields === null ? (
        <p className="text-sub text-sm">불러오는 중…</p>
      ) : fields.length === 0 ? (
        <p className="text-sub text-sm">아직 추가한 항목이 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {fields.map((f) => (
            <li key={f.id} className="border border-border rounded-lg p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{f.label}</div>
                <div className="text-xs text-sub mt-1 flex flex-wrap gap-1">
                  {f.options.map((o) => (
                    <span key={o.v} className="bg-bg/60 px-2 py-0.5 rounded border border-border/60">{o.l}</span>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => void handleDelete(f.id, f.label)}
                className="text-warm text-xs hover:underline shrink-0 px-1">삭제</button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-warm text-sm">{error}</p>}
      {addOpen && (
        <AddFieldModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

// label 한국어 → snake_case field_key 자동 생성 (영문 부분만 추출, 실패 시 'custom_' + timestamp).
function autoFieldKey(label: string): string {
  const base = label.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (base.length >= 3 && /^[a-z]/.test(base)) return base;
  // 한국어 only label fallback - timestamp + random suffix (같은 ms 충돌 방어)
  const rand = Math.random().toString(36).slice(2, 5);
  return `custom_${Date.now().toString(36).slice(-6)}${rand}`;
}

function AddFieldModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [options, setOptions] = useState<{ v: string; l: string }[]>([
    { v: '', l: '' },
    { v: '', l: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateOption = (i: number, key: 'v' | 'l', val: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, [key]: val } : o)));
  const addOption = () => setOptions((p) => [...p, { v: '', l: '' }]);
  const removeOption = (i: number) =>
    setOptions((p) => p.filter((_, idx) => idx !== i));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const key = fieldKey.trim() || autoFieldKey(label);
      const cleaned = options
        .map((o) => ({ v: o.v.trim().toLowerCase(), l: o.l.trim() }))
        .filter((o) => o.v && o.l);
      if (cleaned.length < 1) {
        setError('옵션을 1개 이상 입력해주세요.');
        setBusy(false);
        return;
      }
      await apiPost('/api/me/needs-fields', {
        field_key: key,
        label: label.trim(),
        options: cleaned,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '추가 실패');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : onClose}>
      <form className="card max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="font-semibold text-lg">손님 설문 항목 추가</h3>
        <div>
          <label className="label">항목 이름 (1-30자)</label>
          <input required maxLength={30} className="field" value={label}
            onChange={(e) => setLabel(e.target.value)} disabled={busy}
            placeholder="예: 방문 시간대" />
        </div>
        <div>
          <label className="label">키 (영문, 비우면 자동)</label>
          <input className="field num" value={fieldKey} maxLength={31}
            onChange={(e) => setFieldKey(e.target.value.toLowerCase())} disabled={busy}
            placeholder="예: visit_time (영문 소문자/숫자/_ 3-31자)" />
        </div>
        <div className="space-y-2">
          <label className="label">옵션 (1-6개)</label>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input maxLength={31} className="field num flex-1" placeholder="키"
                value={o.v} onChange={(e) => updateOption(i, 'v', e.target.value)} disabled={busy} />
              <input maxLength={20} className="field flex-1" placeholder="라벨"
                value={o.l} onChange={(e) => updateOption(i, 'l', e.target.value)} disabled={busy} />
              {options.length > 1 && (
                <button type="button" onClick={() => removeOption(i)} disabled={busy}
                  className="text-warm text-xs hover:underline shrink-0 px-1">삭제</button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button type="button" onClick={addOption} disabled={busy}
              className="text-accent text-sm hover:underline">+ 옵션 추가</button>
          )}
        </div>
        {error && <p className="text-warm text-sm">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="btn-outline flex-1 h-10">취소</button>
          <button type="submit" disabled={busy || !label.trim()}
            className="btn-primary flex-1 h-10">
            {busy ? '추가 중…' : '추가'}
          </button>
        </div>
      </form>
    </div>
  );
}
