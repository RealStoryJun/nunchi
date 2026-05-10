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
      className={`card flex flex-col items-center justify-center gap-1 p-4 min-h-[110px]
                  active:scale-[0.97] transition focus:outline-none
                  focus:ring-2 focus:ring-accent/40 ${pop ? 'anim-pop' : ''}`}
    >
      <span className="text-3xl leading-none">{emoji || '📦'}</span>
      <span className="text-sm font-medium text-ink truncate max-w-full">{name}</span>
      <span className="num text-xs text-sub">{price.toLocaleString('ko-KR')}원</span>
    </button>
  );
}
