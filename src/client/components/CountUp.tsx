import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  duration?: number;
  className?: string;
  suffix?: string;
}

export default function CountUp({
  value,
  duration = 350,
  className,
  suffix = '원',
}: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startedAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (display === value) return;
    fromRef.current = display;
    startedAt.current = performance.now();
    const tick = (t: number) => {
      const elapsed = t - (startedAt.current ?? t);
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(fromRef.current + (value - fromRef.current) * eased);
      setDisplay(next);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={className}>
      {display.toLocaleString('ko-KR')}
      {suffix}
    </span>
  );
}
