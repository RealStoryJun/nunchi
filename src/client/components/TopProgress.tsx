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
      // 시작 시 빠르게 30%, 그 다음 80%까지 점진 증가
      setWidth((w) => (w < 30 ? 30 : w));
      const tick = () => {
        setWidth((w) => (w >= 80 ? w : w + (80 - w) * 0.06));
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
    }, 220);
    return () => clearTimeout(t);
  }, [count]);

  return (
    <div
      aria-hidden
      className={`fixed top-0 inset-x-0 h-[2px] z-50 pointer-events-none transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="h-full bg-accent transition-[width] duration-150 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
