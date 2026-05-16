import { useEffect, useRef, useState } from 'react';
import { trackStart, trackEnd } from '../lib/progress';
import { apiPost } from '../lib/api';

// admin·master 가 사용자 데이터(판매·니즈) CSV 내보내기 (PR 7, 2026-05-16).
// 대상: 전체 / 특정 사용자. 기간: 이번 달 / 지난 달 / 직접 입력.
// fetch 후 blob 다운로드 (CSV 본문이 worker memory 안에 다 생성됨).

type Dataset = 'sales' | 'needs';
type Range = 'this' | 'prev' | 'custom' | 'all';

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdminCsvExportModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [dataset, setDataset] = useState<Dataset>('sales');
  const [range, setRange] = useState<Range>('this');
  const [userIdStr, setUserIdStr] = useState('');
  const [fromYmd, setFromYmd] = useState('');
  const [toYmd, setToYmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // step-up auth: 서버가 403 + "관리자 인증이 만료" 응답 시 inline 비밀번호 노출
  const [needAuth, setNeedAuth] = useState(false);
  const [pw, setPw] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // unmount 시 진행 중 fetch 취소 + progress counter cleanup
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const safeClose = () => {
    if (busy) return; // busy 중에는 backdrop·취소 무시
    onClose();
  };

  const authThenDownload = async () => {
    if (busy || !pw) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/admin/step-up', { password: pw });
      setNeedAuth(false);
      setPw('');
      // step-up 통과 후 자동 재시도
      setBusy(false);
      await download();
    } catch (e) {
      setError(e instanceof Error ? e.message : '인증 실패');
      setBusy(false);
    }
  };

  const buildUrl = (): string | null => {
    const params = new URLSearchParams();
    if (userIdStr.trim()) {
      const uid = parseInt(userIdStr.trim(), 10);
      if (!Number.isInteger(uid) || uid <= 0) {
        setError('사용자 ID 가 잘못됐어요.');
        return null;
      }
      params.set('userId', String(uid));
    }
    if (range === 'this') {
      params.set('ym', ym(new Date()));
    } else if (range === 'prev') {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      params.set('ym', ym(d));
    } else if (range === 'custom') {
      if (!fromYmd || !toYmd) {
        setError('시작·끝 날짜를 모두 입력해주세요.');
        return null;
      }
      const fromMs = new Date(fromYmd + 'T00:00:00+09:00').getTime();
      const toMs = new Date(toYmd + 'T23:59:59.999+09:00').getTime();
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
        setError('기간이 잘못됐어요.');
        return null;
      }
      params.set('from', String(fromMs));
      params.set('to', String(toMs));
    }
    return `/api/admin/export/${dataset}?${params.toString()}`;
  };

  const download = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    const url = buildUrl();
    if (!url) return;
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    trackStart();
    try {
      const res = await fetch(url, { credentials: 'include', signal: ac.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // envelope JSON 이면 error 메시지만 추출
        let msg = body || `다운로드 실패 (${res.status})`;
        try {
          const j = JSON.parse(body);
          if (j && typeof j.error === 'string') msg = j.error;
        } catch { /* raw body */ }
        // step-up 필요 → 비밀번호 input 노출
        if (res.status === 403 && msg.includes('관리자 인증')) {
          setNeedAuth(true);
          return;
        }
        throw new Error(msg);
      }
      // Content-Disposition 에서 filename 추출, 없으면 fallback
      const cd = res.headers.get('content-disposition') ?? '';
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] ?? `nunchi-${dataset}-${ym(new Date())}.csv`;
      const truncated = res.headers.get('x-truncated') === '1';
      const rowCountStr = res.headers.get('x-row-count') ?? '';
      const rowCount = Number(rowCountStr);
      // 빈 결과면 다운로드 대신 안내 (에러 아닌 정상 빈 상태)
      if (Number.isFinite(rowCount) && rowCount === 0) {
        setInfo('이 조건에 해당하는 데이터가 없어요.');
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      if (truncated) {
        const fmt = Number.isFinite(rowCount) ? rowCount.toLocaleString('ko-KR') : rowCountStr;
        alert(`결과가 5만 행을 초과해서 잘렸어요 (받은 행: ${fmt}). 기간을 좁혀서 다시 받아주세요.`);
      }
      onClose();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // unmount 로 인한 abort 는 무시
      setError(e instanceof Error ? e.message : '다운로드 실패');
    } finally {
      trackEnd();
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 anim-fade"
      onClick={(e) => { if (e.target === e.currentTarget) safeClose(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); safeClose(); }
        else if (e.key === 'Enter' && !busy) { e.stopPropagation(); void download(); }
      }}
      tabIndex={-1}
    >
      <div className="card max-w-md w-full p-5 anim-pop">
        <h2 className="font-semibold text-lg mb-3">CSV 내보내기</h2>

        <div className="mb-4">
          <label className="label">데이터 종류</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDataset('sales')}
              className={`flex-1 h-9 rounded-lg text-sm border transition ${
                dataset === 'sales'
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-card text-ink border-border hover:border-accent/40'
              }`}
            >판매 내역</button>
            <button
              type="button"
              onClick={() => setDataset('needs')}
              className={`flex-1 h-9 rounded-lg text-sm border transition ${
                dataset === 'needs'
                  ? 'bg-accent text-white border-accent font-medium'
                  : 'bg-card text-ink border-border hover:border-accent/40'
              }`}
            >고객 니즈</button>
          </div>
        </div>

        <div className="mb-4">
          <label className="label">대상 사용자</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d*"
            className="field"
            placeholder="비우면 전체. 특정 사용자만 받으려면 ID 입력"
            value={userIdStr}
            onChange={(e) => setUserIdStr(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="label">기간</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['this', '이번 달'],
              ['prev', '지난 달'],
              ['all', '전체'],
              ['custom', '직접 입력'],
            ] as [Range, string][]).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className={`h-9 rounded-lg text-sm border transition ${
                  range === k
                    ? 'bg-accent text-white border-accent font-medium'
                    : 'bg-card text-ink border-border hover:border-accent/40'
                }`}
              >{l}</button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input
                type="date"
                value={fromYmd}
                onChange={(e) => setFromYmd(e.target.value)}
                className="field"
              />
              <input
                type="date"
                value={toYmd}
                onChange={(e) => setToYmd(e.target.value)}
                className="field"
              />
            </div>
          )}
        </div>

        {needAuth && (
          <div className="mb-3 p-3 rounded-lg bg-warm/10 border border-warm/30">
            <p className="text-sm mb-2 break-keep">
              민감 정보를 일괄 내려받습니다. 비밀번호를 다시 입력해주세요.
            </p>
            <input
              type="password" autoFocus className="field"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pw && !busy) void authThenDownload(); }}
              placeholder="비밀번호"
            />
          </div>
        )}

        {error && <p className="text-warm text-sm mb-3 break-keep">{error}</p>}
        {info && <p className="text-sub text-sm mb-3 break-keep">{info}</p>}

        <p className="text-sub text-xs mb-3 break-keep">
          최대 5만 행. 그 이상이면 기간을 좁혀주세요.
        </p>

        <div className="flex gap-2">
          <button onClick={safeClose} disabled={busy} className="btn-outline flex-1 disabled:opacity-50">취소</button>
          {needAuth ? (
            <button onClick={authThenDownload} disabled={busy || !pw} className="btn-primary flex-1 disabled:opacity-50">
              {busy ? '확인 중…' : '인증 후 다운로드'}
            </button>
          ) : (
            <button onClick={download} disabled={busy} className="btn-primary flex-1 disabled:opacity-50">
              {busy ? '다운로드 중…' : '다운로드'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
