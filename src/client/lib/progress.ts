type Listener = (count: number) => void;

let _count = 0;
const _listeners = new Set<Listener>();

const emit = () => {
  for (const fn of _listeners) fn(_count);
};

export const trackStart = (): void => {
  _count++;
  emit();
};

export const trackEnd = (): void => {
  _count = Math.max(0, _count - 1);
  emit();
};

export const subscribe = (fn: Listener): (() => void) => {
  _listeners.add(fn);
  fn(_count);
  return () => {
    _listeners.delete(fn);
  };
};
