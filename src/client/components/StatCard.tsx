interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'warm';
}

export default function StatCard({ label, value, hint, tone = 'default' }: Props) {
  const valueClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'warm'
      ? 'text-warm'
      : 'text-ink';
  return (
    <div className="card p-4 md:p-5">
      <div className="text-sub text-sm">{label}</div>
      <div className={`num text-xl md:text-3xl font-bold mt-1 whitespace-nowrap ${valueClass}`}>
        {value}
      </div>
      {hint && <div className="text-sub text-xs mt-1 num break-keep">{hint}</div>}
    </div>
  );
}
