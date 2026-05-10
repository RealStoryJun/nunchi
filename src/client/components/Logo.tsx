interface Props {
  size?: number;
  withText?: boolean;
  tone?: 'dark' | 'light';
}

export default function Logo({ size = 28, withText = true, tone = 'dark' }: Props) {
  const fg = tone === 'dark' ? '#1B4332' : '#F5F2EA';
  return (
    <div className="inline-flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="16" cy="16" r="15" stroke={fg} strokeWidth="1.5" fill="none" />
        <circle cx="11.5" cy="14" r="1.6" fill={fg} />
        <circle cx="20.5" cy="14" r="1.6" fill={fg} />
        <path
          d="M10 21 Q 16 25 22 21"
          stroke={fg}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {withText && (
        <span
          className="font-display text-2xl leading-none"
          style={{ color: fg, letterSpacing: '0.02em' }}
        >
          눈치
        </span>
      )}
    </div>
  );
}
