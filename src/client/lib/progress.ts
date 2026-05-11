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

// 풀스크린 LoadingScreen splash가 떠 있는 동안은 중앙 TopProgress 카드를 숨김
// (둘 다 화면 중앙이라 겹침 방지). ref-count — 동시 마운트되어도 모두 unmount 시까지 active.
type BoolListener = (v: boolean) => void;
let _splashCount = 0;
const _splashListeners = new Set<BoolListener>();

export const setSplashActive = (active: boolean): void => {
  _splashCount = Math.max(0, _splashCount + (active ? 1 : -1));
  const v = _splashCount > 0;
  for (const fn of _splashListeners) fn(v);
};

export const subscribeSplash = (fn: BoolListener): (() => void) => {
  _splashListeners.add(fn);
  fn(_splashCount > 0);
  return () => {
    _splashListeners.delete(fn);
  };
};
