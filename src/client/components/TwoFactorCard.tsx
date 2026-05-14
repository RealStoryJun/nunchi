import { useState } from 'react';
import { apiPost } from '../lib/api';
import { refreshAuth, useAuth } from '../hooks/useAuth';

type Mode = 'idle' | 'setupPw' | 'setupConfirm' | 'setupDone' | 'disablePw';

export default function TwoFactorCard() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setMode('idle'); setPassword(''); setCode('');
    setSecret(''); setOtpauthUrl(''); setBackupCodes(null); setErr(null);
  };

  const startSetup = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await apiPost<{ secret: string; otpauth_url: string }>(
        '/api/auth/2fa/setup/start',
        { password },
      );
      setSecret(d.secret);
      setOtpauthUrl(d.otpauth_url);
      setMode('setupConfirm');
      setPassword('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '시작에 실패했어요.');
    } finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await apiPost<{ backup_codes: string[] }>(
        '/api/auth/2fa/setup/confirm',
        { code },
      );
      setBackupCodes(d.backup_codes);
      setMode('setupDone');
      setCode('');
      await refreshAuth();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '확인에 실패했어요.');
    } finally { setBusy(false); }
  };

  const disable2fa = async () => {
    setBusy(true); setErr(null);
    try {
      await apiPost('/api/auth/2fa/disable', { password, code });
      await refreshAuth();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '비활성화에 실패했어요.');
    } finally { setBusy(false); }
  };

  if (!user) return null;
  const enabled = !!user.mfa_enabled;

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h2 className="font-semibold">2단계 인증</h2>
          <p className="text-sub text-xs mt-0.5 break-keep">
            로그인할 때 인증 앱 6자리 코드를 한 번 더 입력하도록 합니다.
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${enabled ? 'bg-accent/10 text-accent' : 'bg-border/40 text-sub'}`}>
          {enabled ? '켜짐' : '꺼짐'}
        </span>
      </div>

      {mode === 'idle' && (
        <div className="mt-3">
          {enabled ? (
            <button onClick={() => setMode('disablePw')} className="btn-outline w-full">
              2단계 인증 끄기
            </button>
          ) : (
            <button onClick={() => setMode('setupPw')} className="btn-primary w-full">
              2단계 인증 켜기
            </button>
          )}
        </div>
      )}

      {mode === 'setupPw' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-sub break-keep">현재 비밀번호를 입력해주세요.</p>
          <input
            type="password" autoFocus className="field md:max-w-sm md:mx-auto md:block" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
          />
          {err && <p className="text-warm text-sm break-keep">{err}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-outline flex-1">취소</button>
            <button onClick={startSetup} disabled={busy || !password} className="btn-primary flex-1">
              {busy ? '확인 중…' : '다음'}
            </button>
          </div>
        </div>
      )}

      {mode === 'setupConfirm' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm break-keep">
            인증 앱(Google Authenticator·Authy·1Password 등)에서 아래 QR을 스캔하거나 비밀키를 직접 입력해주세요.
          </p>
          <div className="flex justify-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`}
              alt="QR" width={200} height={200} className="rounded-lg border border-border"
            />
          </div>
          <div className="text-center">
            <p className="text-xs text-sub mb-1">비밀키 (수동 입력용)</p>
            <div className="flex flex-wrap justify-center gap-1.5 px-3 py-2 bg-bg rounded-lg">
              {/* 4자 그룹 inline-block — wrap 시에도 그룹 단위 유지 (break-all 시 그룹 중간 자름 회피) */}
              {(secret.match(/.{1,4}/g) ?? []).map((g, i) => (
                <code key={i} className="num text-sm font-mono">{g}</code>
              ))}
            </div>
          </div>
          <p className="text-sm text-sub break-keep">앱에 등록한 뒤 6자리 코드를 입력하세요.</p>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code"
            className="field num text-2xl tracking-widest text-center md:max-w-[220px] md:mx-auto md:block"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            placeholder="123456" maxLength={6}
          />
          {err && <p className="text-warm text-sm break-keep">{err}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-outline flex-1">취소</button>
            <button onClick={confirmSetup} disabled={busy || code.length !== 6} className="btn-primary flex-1">
              {busy ? '확인 중…' : '확인'}
            </button>
          </div>
        </div>
      )}

      {mode === 'setupDone' && backupCodes && (
        <div className="mt-3 space-y-3">
          <div className="p-3 bg-accent/[0.05] border border-accent/25 rounded-lg">
            <p className="text-sm font-medium text-accent mb-2 break-keep">
              ✅ 2단계 인증이 켜졌어요. 아래 백업코드를 안전한 곳에 보관해주세요.
            </p>
            <p className="text-xs text-sub break-keep">
              각 코드는 한 번만 사용 가능합니다. 인증 앱을 잃어버렸을 때 사용하세요.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono num text-sm">
            {backupCodes.map((c, i) => (
              <div key={i} className="px-3 py-2 bg-bg rounded-lg text-center">
                {c.match(/.{1,4}/g)?.join('-')}
              </div>
            ))}
          </div>
          <button onClick={reset} className="btn-primary w-full">
            저장했어요, 닫기
          </button>
        </div>
      )}

      {mode === 'disablePw' && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-sub break-keep">
            비활성화하려면 비밀번호와 현재 6자리 인증 코드를 입력해주세요.
          </p>
          <p className="text-xs text-sub break-keep">
            코드를 받을 수 없으면 <a href="/recover" className="text-accent hover:underline">비밀번호 재설정</a>으로도 자동 해제됩니다.
          </p>
          <input
            type="password" className="field md:max-w-sm md:mx-auto md:block" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
          />
          <input
            type="text" inputMode="numeric"
            className="field num text-xl tracking-widest text-center md:max-w-[220px] md:mx-auto md:block"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
            placeholder="123456" maxLength={6}
          />
          {err && <p className="text-warm text-sm break-keep">{err}</p>}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-outline flex-1">취소</button>
            <button onClick={disable2fa} disabled={busy || !password || code.length !== 6} className="btn-warm flex-1">
              {busy ? '처리 중…' : '비활성화'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
