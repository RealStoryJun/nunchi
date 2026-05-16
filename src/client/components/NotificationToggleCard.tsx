import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';

// base64url → Uint8Array (PushManager.subscribe applicationServerKey 용)
const b64uToUint8 = (s: string): Uint8Array => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// PushSubscription → 서버 body 형식
const subToBody = (s: PushSubscription): Record<string, unknown> => {
  const json = s.toJSON();
  return { endpoint: json.endpoint, keys: json.keys };
};

type Mode =
  | 'unknown'      // 초기 (브라우저 capability 확인 중)
  | 'unsupported'  // PushManager / Notification 미지원 (iOS Safari < 16.4 등)
  | 'disabled'     // VAPID 키 서버 미설정 (graceful)
  | 'denied'       // 사용자가 브라우저 권한 거부
  | 'subscribed'   // 구독 중
  | 'unsubscribed' // 구독 가능 상태 (권한 default 또는 granted but not subscribed)
  | 'error';       // 등록/해제 중 에러

export default function NotificationToggleCard() {
  const [mode, setMode] = useState<Mode>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vapidPub, setVapidPub] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 브라우저 미지원
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (alive) setMode('unsupported');
        return;
      }
      // 권한 상태
      if (Notification.permission === 'denied') {
        if (alive) setMode('denied');
        return;
      }
      // 서버 config (VAPID 공개 키)
      try {
        const cfg = await apiGet<{ vapid_public_key: string | null }>('/api/push/config');
        if (!alive) return;
        if (!cfg.vapid_public_key) {
          setMode('disabled');
          return;
        }
        setVapidPub(cfg.vapid_public_key);
      } catch {
        if (alive) setMode('error');
        return;
      }
      // 현재 구독 상태
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setMode(sub ? 'subscribed' : 'unsubscribed');
      } catch {
        if (alive) setMode('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = async () => {
    if (busy || !vapidPub) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setMode(perm === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      // TS quirk: Uint8Array → ArrayBuffer cast (SharedArrayBuffer 호환성 회피)
      const keyBuf = b64uToUint8(vapidPub).buffer as ArrayBuffer;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuf,
      });
      await apiPost('/api/push/subscribe', subToBody(sub));
      setMode('subscribed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알림 켜기 실패';
      setError(msg);
      setMode('error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiDelete('/api/push/subscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setMode('unsubscribed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알림 끄기 실패';
      setError(msg);
      setMode('error');
    } finally {
      setBusy(false);
    }
  };

  // 미지원 / 비활성 상태는 카드 자체를 안 그림 (사용자 혼란 회피)
  if (mode === 'unknown' || mode === 'unsupported' || mode === 'disabled') return null;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden>🔔</span>
        <h2 className="font-semibold">알림 받기</h2>
      </div>
      <p className="text-sub text-sm mb-3 break-keep">
        새 소식이나 중요한 안내를 모바일 알림으로 받아볼 수 있어요. 언제든 꺼도 돼요.
      </p>

      {mode === 'subscribed' && (
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="btn-outline w-full disabled:opacity-50"
        >
          {busy ? '끄는 중…' : '알림 끄기'}
        </button>
      )}

      {mode === 'unsubscribed' && (
        <button
          type="button"
          onClick={enable}
          disabled={busy || !vapidPub}
          className="btn-primary w-full disabled:opacity-50"
        >
          {busy ? '알림 켜는 중…' : '알림 켜기'}
        </button>
      )}

      {mode === 'denied' && (
        <p className="text-sub text-sm break-keep">
          알림 권한이 차단됐어요. 브라우저 설정에서 이 사이트의 알림 권한을{' '}
          <strong className="text-ink">허용</strong>으로 바꾼 뒤 다시 시도해주세요.
        </p>
      )}

      {error && <p className="text-warm text-sm mt-2">{error}</p>}
    </div>
  );
}
