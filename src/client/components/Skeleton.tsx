interface Props {
  className?: string;
}

export const Skeleton = ({ className = '' }: Props) => (
  <div className={`bg-border/60 rounded-md animate-pulse ${className}`} />
);
