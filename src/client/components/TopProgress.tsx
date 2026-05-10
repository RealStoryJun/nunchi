import { useEffect, useRef, useState } from 'react';
import { subscribe } from '../lib/progress';

export default function TopProgress() {
  const [count, setCount] = useState(0);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => subscribe(setCount), []);

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    if (count > 0) {
      setVisible(true);
      // 시작 시 즉시 18%로 점프 → 90%까지 점진 증가 (체감 빠름)
      setWidth((w) => (w < 18 ? 18 : w));
      const tick = () => {
        setWidth((w) => (w >= 90 ? w : w + (90 - w) * 0.045));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return cancel;
    }
    cancel();
    setWidth(100);
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 280);
    return () => clearTimeout(t);
  }, [count]);

  return (
    <>
      <div
        aria-hidden
        className={`fixed top-0 inset-x-0 h-[3px] z-50 pointer-events-none transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          className="h-full bg-accent transition-[width] duration-150 ease-out shadow-[0_0_8px_rgba(27,67,50,0.35)]"
          style={{ width: `${width}%` }}
        />
      </div>
      <div
        aria-hidden
        className={`fixed top-1.5 right-3 z-50 num text-[11px] font-semibold text-accent leading-none pointer-events-none
                    transition-opacity duration-200 tabular-nums ${
                      visible && width < 100 ? 'opacity-90' : 'opacity-0'
                    }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {Math.round(width)}%
      </div>
    </>
  );
}
