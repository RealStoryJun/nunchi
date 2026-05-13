import { useEffect, useState } from 'react';

interface Props {
  emoji: string | null;
  name: string;
  price: number;
  onTap: () => void;
  disabled?: boolean;
}

export default function MenuTile({ emoji, name, price, onTap, disabled }: Props) {
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(false), 200);
    return () => clearTimeout(t);
  }, [pop]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        setPop(true);
        onTap();
      }}
      className={`card w-full min-w-0 flex flex-col items-center justify-center gap-1
                  px-2 py-3 min-h-[112px] active:scale-[0.97] transition
                  hover:border-accent/40 hover:shadow-soft
                  focus:outline-none focus:ring-2 focus:ring-accent/40
                  disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                  disabled:hover:border-border disabled:hover:shadow-none
                  ${pop ? 'anim-pop' : ''}`}
    >
      <span className="text-3xl leading-none">{emoji || '📦'}</span>
      <span className="block w-full text-sm leading-snug font-medium text-ink clamp-2 text-center">
        {name}
      </span>
      <span className="num text-xs text-sub mt-auto">
        {price.toLocaleString('ko-KR')}원
      </span>
    </button>
  );
}
