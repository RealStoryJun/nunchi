import { Link, Navigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

export default function Landing() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/sales" replace />;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Logo />
        <Link
          to="/login"
          className="text-sub hover:text-ink text-sm px-3 py-2.5 rounded-md"
        >
          로그인
        </Link>
      </header>
      <main className="flex-1 flex items-center">
        <div className="max-w-5xl mx-auto w-full px-6 py-12 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-sub mb-3">1인 사업자를 위한</p>
            <h1 className="font-display text-4xl md:text-6xl leading-tight text-accent break-keep">
              사장님의 매출 감각,<br />
              <span className="text-ink">눈치</span>
            </h1>
            <p className="mt-6 text-lg text-ink/80 leading-relaxed">
              메뉴 등록하고, 한 탭으로 판매 입력하고,<br />
              매출·원가·이익을 한눈에. 그게 전부입니다.
            </p>
            <div className="mt-8 flex gap-3">
              <Link to="/signup" className="btn-primary px-6">
                무료로 시작하기
              </Link>
              <Link to="/login" className="btn-outline px-6">
                로그인
              </Link>
            </div>
            {/* 사용법 + 새 소식 두 CTA — text 링크가 작아서 못 알아보던 문제(2026-05) + changelog 분리 */}
            <Link
              to="/guide"
              className="mt-6 block rounded-2xl border border-border bg-card p-4 hover:border-accent/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>📖</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink">30초만에 사용법 보기</div>
                  <div className="text-sm text-sub mt-0.5">메뉴 → 한 탭 판매 → AI 분석</div>
                </div>
                <span className="text-sub" aria-hidden>→</span>
              </div>
            </Link>
            <Link
              to="/whats-new"
              className="mt-3 block rounded-2xl border border-border bg-card p-4 hover:border-accent/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>⚡</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink">5월 새로워진 점 보기</div>
                  <div className="text-sm text-sub mt-0.5">봇 차단 · 2단계 인증 · 암호화 강화</div>
                </div>
                <span className="text-sub" aria-hidden>→</span>
              </div>
            </Link>
          </div>
          <div className="card p-6 md:p-8">
            <div className="text-sub text-sm mb-2">오늘의 매출</div>
            <div className="num text-3xl md:text-5xl font-bold text-accent">
              487,500원
            </div>
            <div className="num text-sub mt-1">순이익 312,400원 · 마진 64.1%</div>
            <div className="mt-6 grid grid-cols-3 gap-2">
              {[
                { e: '☕', n: '아메리카노', q: 24 },
                { e: '🍰', n: '치즈케이크', q: 7 },
                { e: '🥪', n: '샌드위치', q: 5 },
              ].map((m) => (
                <div
                  key={m.n}
                  className="card p-3 flex flex-col items-center text-center"
                >
                  <span className="text-2xl">{m.e}</span>
                  <span className="text-xs mt-1 text-sub">{m.n}</span>
                  <span className="num text-sm font-semibold">{m.q}개</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <footer className="px-6 py-6 text-center text-sub text-sm">
        © 눈치 데모 · Cloudflare Workers + D1
      </footer>
    </div>
  );
}
