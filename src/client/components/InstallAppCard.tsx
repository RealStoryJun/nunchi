import { useEffect, useState } from 'react';

// PWA beforeinstallprompt event 타입 (Chrome/Edge 전용, Safari 미지원)
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

// iOS Safari 감지 (beforeinstallprompt 안 옴, 공유 → 홈 화면 추가 안내)
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return isIos && isSafari;
}

// 이미 PWA로 실행 중인지 (홈 화면 아이콘으로 진입 → display-mode: standalone)
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari가 PWA로 실행될 때만 true (legacy)
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function InstallAppCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(detectStandalone());
  const [iosSafari] = useState(isIosSafari());
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState<'installed' | 'dismissed' | null>(null);

  useEffect(() => {
    // 이미 설치된 상태면 더 처리 X
    if (isStandalone) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
      setDone('installed');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [isStandalone]);

  const install = async () => {
    if (!deferred || installing) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') {
        setDeferred(null);
        setDone('installed');
      } else {
        setDone('dismissed');
      }
    } catch {
      setDone('dismissed');
    } finally {
      setInstalling(false);
    }
  };

  // 이미 PWA로 실행 중 - 설치됨 안내만
  if (isStandalone) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>✓</span>
          <h2 className="font-semibold">앱으로 설치됨</h2>
        </div>
        <p className="text-sub text-sm mt-1">홈 화면 아이콘으로 빠르게 들어올 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden>📱</span>
        <h2 className="font-semibold">앱으로 설치하기</h2>
      </div>
      <p className="text-sub text-sm mb-3 break-keep">
        홈 화면에 추가하면 더 빨리 열고, 오프라인에서도 마지막 화면을 볼 수 있어요.
      </p>

      {deferred && !done && (
        <button
          type="button"
          onClick={install}
          disabled={installing}
          className="btn-primary w-full disabled:opacity-50"
        >
          {installing ? '설치 중…' : '앱으로 설치하기'}
        </button>
      )}

      {done === 'installed' && (
        <p className="text-accent text-sm font-medium">✓ 홈 화면에 추가됐어요. 잠시 후 새 창에서 열어보세요.</p>
      )}

      {done === 'dismissed' && (
        <p className="text-sub text-sm">설치를 건너뛰셨어요. 다시 시도하려면 페이지를 새로고침해주세요.</p>
      )}

      {/* iOS Safari fallback - beforeinstallprompt 안 옴 */}
      {iosSafari && !deferred && !done && (
        <div className="text-sub text-sm leading-relaxed break-keep">
          <p className="mb-1">Safari 사용 중이세요. 직접 추가 가능해요:</p>
          <ol className="list-decimal pl-5 space-y-0.5">
            <li>주소창 옆 <strong className="text-ink">공유</strong> 버튼 누름</li>
            <li><strong className="text-ink">홈 화면에 추가</strong> 선택</li>
            <li><strong className="text-ink">추가</strong> 누르면 끝</li>
          </ol>
        </div>
      )}

      {/* Chrome/Edge 등이지만 아직 install 조건 못 채운 경우 */}
      {!iosSafari && !deferred && !done && (
        <p className="text-sub text-sm leading-relaxed break-keep">
          잠시 후 설치 버튼이 나타나요. 안 나타나면 브라우저 메뉴에서{' '}
          <strong className="text-ink">홈 화면에 추가</strong> 또는{' '}
          <strong className="text-ink">앱 설치</strong>를 눌러주세요.
        </p>
      )}
    </div>
  );
}
