import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import { subscribe, setSplashActive } from '../lib/progress';

interface Props {
  label?: string;
}

// 실제 /api/me fetch(~400~500ms)에 맞춰 빠르게 채움 - fetch가 끝나는 시점에
// progress가 거의 다 차 있어서 100% 점프 거리가 작도록.
const FILL_MS = 420;

export default function LoadingScreen({ label = '잠시만요' }: Props) {
  const [count, setCount] = useState(0);
  const [width, setWidth] = useState(12); // 즉시 12% 점프 - 시작이 늦어 보이지 않게
  const startRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => subscribe(setCount), []);
  // 이 splash가 떠 있는 동안 TopProgress 중앙 카드 숨김
  useEffect(() => {
    setSplashActive(true);
    return () => setSplashActive(false);
  }, []);

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const t = Math.min(1, elapsed / FILL_MS);
      const eased = 1 - Math.pow(1 - t, 2); // easeOutQuad
      const cap = count > 0 ? 90 : 100;
      const target = Math.min(cap, eased * 100);
      setWidth((w) => Math.max(w, target));
      if (target < cap) rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return cancel;
  }, [count]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-screen flex flex-col items-center justify-center bg-bg px-8"
    >
      <div className="mb-10">
        <Logo size={40} />
      </div>
      <div className="w-full max-w-[280px] flex flex-col items-center">
        <div className="num text-4xl font-bold text-accent tabular-nums leading-none">
          {Math.round(width)}
          <span className="text-2xl text-accent/70 ml-0.5">%</span>
        </div>
        <div className="w-full h-2 bg-border/70 rounded-full overflow-hidden mt-5">
          <div
            className="h-full bg-accent rounded-full shadow-[0_0_8px_rgba(27,67,50,0.35)]"
            style={{
              width: `${width}%`,
              transition: 'width 100ms linear',
            }}
          />
        </div>
        <p className="text-sub text-sm mt-4">{label}</p>
      </div>
    </div>
  );
}
