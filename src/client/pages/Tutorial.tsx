import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

interface Slide {
  emoji: string;
  badge: string;
  title: string;
  body: string;
  preview: () => JSX.Element;
}

const SLIDES: Slide[] = [
  {
    emoji: '🏷️',
    badge: '1단계',
    title: '먼저, 상품을 등록해요',
    body: '팔고 있는 메뉴·상품을 등록하면 한 탭으로 판매를 기록할 수 있어요.',
    preview: () => (
      <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
        {[
          { e: '☕', n: '아메리카노', p: '4,500' },
          { e: '🥛', n: '카페라떼', p: '5,000' },
          { e: '🍰', n: '치즈케이크', p: '7,500' },
        ].map((m, i) => (
          <div
            key={i}
            className="card flex flex-col items-center justify-center
                       gap-1 px-2 py-3 min-h-[88px]"
          >
            <span className="text-2xl leading-none">{m.e}</span>
            <span className="text-xs font-medium truncate max-w-full">
              {m.n}
            </span>
            <span className="num text-[11px] text-sub">{m.p}원</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    emoji: '👆',
    badge: '2단계',
    title: '손님이 사면, 한 탭',
    body: '상품을 한 번 누르면 매출에 즉시 반영돼요. 잘못 눌러도 옆에 있는 취소 버튼으로 되돌릴 수 있어요.',
    preview: () => (
      <div className="card p-3 max-w-[280px] mx-auto">
        <div className="text-sub text-xs">오늘의 매출</div>
        <div className="num text-2xl font-bold text-accent leading-tight mt-0.5">
          14,500원
        </div>
        <ul className="mt-2 divide-y divide-border/60">
          <li className="flex items-center gap-2 py-1.5 text-xs">
            <span className="w-5 text-center">☕</span>
            <span className="flex-1 truncate">아메리카노</span>
            <span className="num font-medium">+4,500원</span>
            <span className="text-warm text-[11px] px-1.5 py-0.5 rounded
                             bg-warm/10">취소</span>
          </li>
          <li className="flex items-center gap-2 py-1.5 text-xs">
            <span className="w-5 text-center">🥛</span>
            <span className="flex-1 truncate">카페라떼</span>
            <span className="num font-medium">+5,000원</span>
            <span className="text-warm text-[11px] px-1.5 py-0.5 rounded
                             bg-warm/10">취소</span>
          </li>
        </ul>
      </div>
    ),
  },
  {
    emoji: '📊',
    badge: '3단계',
    title: '매출·이익 한눈에',
    body: '오늘·이번 주·이번 달 매출과 순이익·마진율, 인기 상품, 분류별 비중을 자동으로 보여드려요.',
    preview: () => (
      <div className="grid grid-cols-2 gap-2 max-w-[280px] mx-auto">
        {[
          { l: '총매출', v: '487,500원', tone: 'accent' },
          { l: '순이익', v: '312,400원', tone: 'accent' },
          { l: '마진율', v: '64.1%', tone: 'ink' },
          { l: '판매', v: '36건', tone: 'ink' },
        ].map((s, i) => (
          <div key={i} className="card p-3">
            <div className="text-sub text-[11px]">{s.l}</div>
            <div
              className={`num text-base font-bold mt-0.5 ${
                s.tone === 'accent' ? 'text-accent' : 'text-ink'
              }`}
            >
              {s.v}
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export default function Tutorial() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.business_type) return <Navigate to="/onboarding" replace />;

  const slide = SLIDES[idx];
  const isLast = idx === SLIDES.length - 1;
  const next = () => {
    if (isLast) navigate('/menus');
    else setIdx((i) => i + 1);
  };
  const skip = () => navigate('/menus');

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="px-5 pt-5 pb-2 flex items-center justify-between max-w-2xl mx-auto w-full anim-fade">
        <Logo size={26} />
        <button
          type="button"
          onClick={skip}
          className="text-sub text-sm hover:text-ink"
        >
          건너뛰기
        </button>
      </header>

      {/* top 정렬 — slide 진행 시 제목/이모지 위치 점프 방지. md에선 위쪽 여백만 늘림. */}
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-5 pt-4 pb-32 md:pt-12 md:pb-24">
        {/* 진행 인디케이터 */}
        <div className="flex items-center gap-1.5 mb-6">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === idx
                  ? 'w-8 bg-accent'
                  : i < idx
                  ? 'w-3 bg-accent/40'
                  : 'w-3 bg-border'
              }`}
            />
          ))}
          <span className="num text-xs text-sub ml-auto">
            {idx + 1} / {SLIDES.length}
          </span>
        </div>

        {/* 슬라이드 본문 (key로 강제 리렌더 → 매번 anim 재생) */}
        <div key={idx} className="flex flex-col items-center text-center">
          <div className="anim-slide-r" style={{ animationDelay: '0ms' }}>
            <span className="text-xs font-semibold text-accent bg-accent/10 px-2 py-1 rounded-full">
              {slide.badge}
            </span>
          </div>
          <div
            className="anim-slide-r mt-5 anim-float"
            style={{ animationDelay: '60ms' }}
          >
            <div className="text-7xl leading-none select-none">
              {slide.emoji}
            </div>
          </div>
          <h1
            className="anim-slide-r font-display text-3xl md:text-4xl leading-tight text-ink break-keep mt-6"
            style={{ animationDelay: '120ms' }}
          >
            {slide.title}
          </h1>
          <p
            className="anim-slide-r text-sub mt-3 leading-relaxed max-w-md"
            style={{ animationDelay: '180ms' }}
          >
            {slide.body}
          </p>
          <div
            className="anim-slide-r mt-8 w-full min-h-[220px] flex items-start justify-center"
            style={{ animationDelay: '240ms' }}
          >
            {slide.preview()}
          </div>
        </div>
      </main>

      <div
        className="fixed inset-x-0 bg-gradient-to-t from-bg via-bg to-transparent
                   pt-6 pb-4 px-5 z-30"
        style={{ bottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-2xl mx-auto flex gap-2">
          {idx > 0 && (
            <button
              type="button"
              onClick={() => setIdx((i) => i - 1)}
              className="btn-outline px-5"
              aria-label="이전"
            >
              ←
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="btn-primary flex-1 text-base font-semibold"
          >
            {isLast ? '시작하기' : '다음'}
          </button>
        </div>
      </div>
    </div>
  );
}
