import { useEffect, useState } from 'react';

interface Props {
  emoji: string | null;
  name: string;
  price: number;
  onTap: () => void;
}

export default function MenuTile({ emoji, name, price, onTap }: Props) {
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(false), 200);
    return () => clearTimeout(t);
  }, [pop]);
  return (
    <button
      type="button"
      onClick={() => {
        setPop(true);
        onTap();
      }}
      className={`card w-full min-w-0 flex flex-col items-center justify-center gap-1
                  px-2 py-3 min-h-[112px] active:scale-[0.97] transition
                  focus:outline-none focus:ring-2 focus:ring-accent/40
                  ${pop ? 'anim-pop' : ''}`}
    >
      <span className="text-3xl leading-none">{emoji || '📦'}</span>
      <span className="block w-full text-[13px] leading-snug font-medium text-ink clamp-2 text-center">
        {name}
      </span>
      <span className="num text-xs text-sub mt-auto">
        {price.toLocaleString('ko-KR')}원
      </span>
    </button>
  );
}
