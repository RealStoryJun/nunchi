import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

// 업데이트 내역 전용 페이지. 매뉴얼(/guide)과 별도 라우트로 분리 —
// 매뉴얼은 "어떻게 쓰는지", 여기는 "최근 뭐가 좋아졌는지" 두 의미를 시각적으로도 분리.
export default function WhatsNew() {
  const { user, loading } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Link to="/" aria-label="처음으로">
          <Logo />
        </Link>
        {/* loading 동안 placeholder로 공간 유지 — 하드 새로고침 시 '로그인'→'내 가게로' flicker 회피.
            min-w로 둘 중 긴 폭 고정해 로그인 사용자 reflow도 차단. */}
        {loading ? (
          <span className="invisible text-sm px-3 py-2.5 min-w-[80px] inline-block">로그인</span>
        ) : (
          <Link
            to={user ? '/sales' : '/login'}
            className="text-sub hover:text-ink text-sm px-3 py-2.5 rounded-md min-w-[80px] inline-block text-center"
          >
            {user ? '내 가게로' : '로그인'}
          </Link>
        )}
      </header>

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="font-display text-3xl md:text-4xl leading-tight">
            ⚡ 눈치 업데이트 내역
          </h1>
          <p className="mt-4 text-ink/80 leading-relaxed">
            최근 추가되거나 좋아진 점을 모아둔 곳이에요. 새 기능을 어떻게 쓰는지는 <Link to="/guide" className="text-accent font-semibold">사용법</Link>에서 볼 수 있어요.
          </p>

          <section className="mt-10">
            <div className="text-sm font-semibold text-accent mb-3">2026년 5월 · 보안 강화</div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <ul className="space-y-2 text-ink/80 leading-relaxed list-disc pl-5">
                <li>가입 시 봇 자동 차단 (Turnstile)</li>
                <li>2단계 인증(2FA) 옵션 — Google Authenticator 등</li>
                <li>비밀번호 암호화 강화 (PBKDF2 + AES-GCM)</li>
                <li>새 IP/기기 로그인 추적</li>
              </ul>
            </div>
          </section>

          <section className="mt-8">
            <div className="text-sm font-semibold text-accent mb-3">2026년 4월 · 분석 강화</div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <ul className="space-y-2 text-ink/80 leading-relaxed list-disc pl-5">
                <li>AI 인사이트가 매월 영구 저장 — 지난 달도 다시 볼 수 있어요</li>
                <li>부가세 차감 후 실제 순이익을 같이 보여드려요</li>
                <li>BI 빈 상태 분기 — "메뉴 없음"과 "이 기간 판매 없음"을 구분</li>
                <li>사용자 지정 기간 입력칸 모바일 폭 정리</li>
              </ul>
            </div>
          </section>

          <div className="mt-12 flex flex-col items-center gap-3">
            <Link to="/guide" className="btn-outline px-6">
              📖 사용법 보러 가기
            </Link>
            {!user && (
              <Link to="/signup" className="text-sub hover:text-ink text-sm">
                아직 계정이 없나요? 무료로 시작하기 →
              </Link>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-sub text-sm">
        © 눈치 데모 · Cloudflare Workers + D1
      </footer>
    </div>
  );
}
