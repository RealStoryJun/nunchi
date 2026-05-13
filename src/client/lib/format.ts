export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const wonShort = (n: number) => n.toLocaleString('ko-KR');
export const pct = (ratio: number, digits = 1) =>
  `${(ratio * 100).toFixed(digits)}%`;

// BI 카드 요약용 — 자릿수 무관 항상 5~7자 이내. 한국 어법(이번 달 천구백만 / 1.5억) 맞춤.
// 1만 미만: "9,999원" 그대로 / 1만~1억 미만: "194만원" 정수 만원 / 1억+: "1.5억원" 정수 또는 소수1자리
// 정확값(원 단위)이 필요한 곳은 won()을 그대로 쓸 것. dashboard 요약 카드에만 사용.
export const wonCompact = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return '0원';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 100_000_000) {
    const v = abs / 100_000_000;
    // 100억 이상은 소수점 없이 정수 (10,000억 = 1조 같은 큰 값은 자릿수 폭 줄이려고)
    if (v >= 100) return `${sign}${Math.round(v).toLocaleString('en-US')}억원`;
    // 1억~99.9억: 소수1자리 (정수면 생략)
    const r = Math.round(v * 10) / 10;
    return `${sign}${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}억원`;
  }
  if (abs >= 10_000) {
    const v = Math.round(abs / 10_000);
    return `${sign}${v.toLocaleString('en-US')}만원`;
  }
  return `${sign}${abs.toLocaleString('en-US')}원`;
};

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
