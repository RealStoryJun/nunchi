import { useEffect, useRef, useState } from 'react';
import { subscribe, subscribeSplash } from '../lib/progress';

// "중앙 로딩바" — 화면 정중앙 작은 로딩 카드(% + accent 바).
// 규칙: "풀스크린 눈치 로딩바"(LoadingScreen)가 떠 있으면(splashActive) 절대 안 뜸.
//   splash 사라진 후 페이지 내 데이터 갱신 시에만 표시. 짧은 fetch(200ms 미만)도 안 뜸.

export default function TopProgress() {
  const [count, setCount] = useState(0);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [splashActive, setSplashActive] = useState(false);
  const rafRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => subscribe(setCount), []);
  useEffect(() => subscribeSplash(setSplashActive), []);

  useEffect(() => {
    const clearRaf = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // 풀스크린 눈치 로딩바가 떠 있으면 중앙 로딩바는 아예 동작 안 함 (한 프레임 겹침도 방지)
    if (splashActive) {
      clearRaf();
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setVisible(false);
      setWidth(0);
      return clearRaf;
    }
    if (count > 0) {
      // 표시 예약 (200ms 후에도 진행 중이면)
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (!visible && showTimerRef.current === null) {
        showTimerRef.current = window.setTimeout(() => {
          setVisible(true);
          showTimerRef.current = null;
        }, 200);
      }
      // 새 cycle(직전에 100% 채워둔 상태)이면 18로 리셋, 진행 중이면 유지
      setWidth((w) => (w >= 95 ? 18 : Math.max(w, 18)));
      const tick = () => {
        setWidth((w) => (w >= 90 ? w : w + (90 - w) * 0.06));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return clearRaf;
    }
    // 완료
    clearRaf();
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (visible) {
      setWidth(100);
      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        setWidth(0);
        hideTimerRef.current = null;
      }, 320);
    } else {
      setWidth(0);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, splashActive]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  if (!visible || splashActive) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none anim-fade"
    >
      <div className="card px-7 py-5 flex flex-col items-center gap-3 min-w-[176px]">
        <div className="num text-2xl font-bold text-accent tabular-nums leading-none">
          {Math.round(width)}
          <span className="text-base text-accent/70 ml-0.5">%</span>
        </div>
        <div className="w-40 h-1.5 bg-border/70 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full shadow-[0_0_6px_rgba(27,67,50,0.3)]"
            style={{ width: `${width}%`, transition: 'width 130ms ease-out' }}
          />
        </div>
      </div>
    </div>
  );
}
