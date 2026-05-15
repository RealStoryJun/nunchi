export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const wonShort = (n: number) => n.toLocaleString('ko-KR');
export const pct = (ratio: number, digits = 1) =>
  `${(ratio * 100).toFixed(digits)}%`;

// BI 카드 요약용 - 카드 폭(text-xl/text-2xl, 좁은 컬럼 158-183px) 안에 안전하게 들어가는 raw 한계는
// 음수 부호 포함 ~9자 (e.g. "-999,999원"). 1백만 이상은 만원 단위, 1억 이상은 억원 단위로 압축.
// "999,999원" raw / "1,235만원" / "1.5억원" / "123억원". 음수 동일. 사장님 기조 #4 "되는데까지 raw" 안전 한계.
// 정확값이 필요한 다른 곳(판매 내역·차트 tooltip·AI prompt)엔 won() 그대로 사용.
export const wonCompact = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return '0원';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // 1백만 미만: raw - 좁은 카드(158px) 부호 포함 max 9자까지 안전
  if (abs < 1_000_000) {
    return `${sign}${abs.toLocaleString('en-US')}원`;
  }
  // 1억 이상: 억원 단위 압축
  if (abs >= 100_000_000) {
    const v = abs / 100_000_000;
    if (v >= 100) return `${sign}${Math.round(v).toLocaleString('en-US')}억원`;
    const r = Math.round(v * 10) / 10;
    return `${sign}${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}억원`;
  }
  // 1백만 ~ 1억 미만: 정수 만원 단위 (e.g. "1,235만원" - 12,345,678원이 1,235만원으로 표시)
  const v = Math.round(abs / 10_000);
  // round 결과가 10,000(1억) 도달하면 만원 표기 자릿수 폭주 - "1억원"으로 fallback
  if (v >= 10_000) return `${sign}1억원`;
  return `${sign}${v.toLocaleString('en-US')}만원`;
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
