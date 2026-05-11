export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const wonShort = (n: number) => n.toLocaleString('ko-KR');
export const pct = (ratio: number, digits = 1) =>
  `${(ratio * 100).toFixed(digits)}%`;

export const formatDate = (ms: number) => {
  const d = new Date(ms);
  const M = (d.getMonth() + 1).toString().padStart(2, '0');
  const D = d.getDate().toString().padStart(2, '0');
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${M}.${D} ${h}:${m}`;
};

export const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
export const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // 월요일 시작
  x.setDate(x.getDate() - diff);
  return x;
};
export const startOfMonth = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
};

// 날짜 그룹 헤더: "오늘" / "어제" / "5월 9일" / 연도 다르면 "2025년 1월 3일"
export const dayLabel = (ms: number): string => {
  const d = new Date(ms);
  const today = new Date();
  if (ymd(d) === ymd(today)) return '오늘';
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (ymd(d) === ymd(yest)) return '어제';
  const sameYear = d.getFullYear() === today.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export const timeHM = (ms: number): string => {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};
