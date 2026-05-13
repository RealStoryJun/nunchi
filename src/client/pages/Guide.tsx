import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../hooks/useAuth';

// 모바일/데스크탑 자동 스왑 — 같은 화면을 사용자 폼팩터에 맞춰 보여줌
function Shot({ name, alt }: { name: string; alt: string }) {
  return (
    <>
      <img
        src={`/guide/${name}-375.png`}
        alt={alt}
        loading="lazy"
        className="md:hidden w-full rounded-2xl border border-border"
      />
      <img
        src={`/guide/${name}-1440.png`}
        alt={alt}
        loading="lazy"
        className="hidden md:block w-full rounded-2xl border border-border"
      />
    </>
  );
}

export default function Guide() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Link to="/" aria-label="처음으로">
          <Logo />
        </Link>
        <Link
          to={user ? '/sales' : '/login'}
          className="text-sub hover:text-ink text-sm px-3 py-2.5 rounded-md"
        >
          {user ? '내 가게로' : '로그인'}
        </Link>
      </header>

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="font-display text-3xl md:text-4xl leading-tight">
            눈치는 이렇게 써요
          </h1>
          <p className="mt-4 text-ink/80 leading-relaxed">
            메뉴 등록하고, 한 탭으로 판매를 기록하고, 매출·원가·이익을 한눈에.
            매달 AI가 데이터를 살펴 다음 한 수를 짚어드려요. 어떻게 동작하는지
            차근차근 보여드릴게요.
          </p>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">① 가입과 업종 선택</h2>
            <p className="text-ink/80 leading-relaxed">
              이메일과 비밀번호로 가입하고, 카페·식당·베이커리·옷가게·미용실 중
              본인 가게의 업종을 한 번 골라요. 업종에 따라 분석의 톤이 살짝 달라집니다.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">② 메뉴 등록</h2>
            <p className="text-ink/80 leading-relaxed mb-4">
              파는 물건을 미리 등록해두세요 — 이모지·이름·원가·판매가·분류. 한 번만 만들어두면 끝이에요.
              나중에 가격이 바뀌어도 과거 판매 기록은 그때 가격 그대로 남아요.
            </p>
            <Shot name="menus" alt="메뉴 관리 화면" />
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">③ 한 탭 판매 기록</h2>
            <p className="text-ink/80 leading-relaxed mb-4">
              손님이 시키면 메뉴 타일을 탭. "확인"으로 한 번에 기록돼요. 같은 메뉴를
              여러 번 탭하면 수량이 쌓여요. 실수했어도 BI에서 바로 수량을 바꾸거나 취소할 수 있어요.
            </p>
            <Shot name="sales" alt="판매 입력 화면" />
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">④ 고객 니즈 (선택)</h2>
            <p className="text-ink/80 leading-relaxed mb-4">
              가벼운 손님 특성 메모예요 — 성별·연령대·자녀 동반·방문 목적·거주지·찾는 메뉴.
              자주 오는 손님 기준으로 미리 골라뒀으니, 다른 손님일 때만 한두 번 바꿔서 기록하면 돼요.
              꼭 안 써도 되지만, 쌓일수록 AI 인사이트가 깊어져요.
            </p>
            <Shot name="needs" alt="고객 니즈 입력 폼" />
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">⑤ BI 대시보드</h2>
            <p className="text-ink/80 leading-relaxed mb-3">
              오늘·이번 주·이번 달·사용자 지정 기간으로 매출, 원가, 순이익, 마진율,
              인기 메뉴, 시간대별 매출, 고객 니즈 분포까지. 매일 영업 끝나고 한 번씩
              들여다보면 감이 잡혀요.
            </p>
            <p className="text-ink/80 leading-relaxed mb-4">
              위쪽 요약 카드는 한눈에 보이게 <strong className="text-ink">만/억 단위</strong>로
              줄여 보여드려요 (예: 1,942,500원 → 194만원, 1.5억원). 원 단위 정확값은
              아래 "판매 내역"에서 줄별로 그대로 확인할 수 있어요.
            </p>
            <Shot name="bi" alt="BI 대시보드" />
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">
              ⑥ 고정비도 한 번 적어두면, 실제 순이익이 보여요
            </h2>
            <p className="text-ink/80 leading-relaxed mb-3">
              매출에서 원가만 빼면 "총이익"이고, 거기서 임대료·공과금·인건비 같은
              매월 고정 지출까지 빼야 진짜 손에 쥐는 돈이에요. BI 대시보드 안에서 한 번
              적어두면 그 달의 "실제 순이익"을 같이 보여드립니다.
            </p>
            <p className="text-ink/80 leading-relaxed">
              항목명은 자유롭게 — 임대료·공과금·통신비·보험·구독·마케팅·알바비 같은 추천을
              깔아두고, 해당하는 칸만 채우면 돼요. 다음 달엔 "지난 달과 같이 채우기 →"
              버튼 한 번이면 끝.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">⑦ AI는 뭘 보나요</h2>
            <p className="text-ink/80 leading-relaxed mb-4">
              "이번 달 AI 분석" 카드를 만들 때, 서버가 아래 묶음 데이터만 모아 외부 AI
              서비스(Groq)에 보내요:
            </p>
            <ul className="space-y-2 text-ink/80 leading-relaxed list-disc pl-5">
              <li>이번 달 본인 가게의 매출 합계 — 총매출, 원가, 순이익, 마진율, 판매 건수</li>
              <li>직전 동일 기간 대비 변동 (매출·순이익·판매 건수)</li>
              <li>본인이 등록한 메뉴 중 인기 상위 4개 + 마진 낮은 2개</li>
              <li>일별 매출 평균·최고·최저, 피크 시간대, 분류별 매출 상위 3개</li>
              <li>
                고객 니즈가 5건 이상 쌓였을 때만, 응답 비율 요약(성별/연령대/자녀 동반/방문 목적/거주지)과
                자주 언급된 메뉴
              </li>
              <li>이번 달 고정비 합계 (등록했을 때만) — 실제 순이익까지 같이 봐요</li>
              <li>가게 업종 (카페·카센터·미용실 등) — 업종 맥락에 맞는 표현을 쓰도록</li>
            </ul>
            <div className="mt-5 p-4 rounded-xl bg-card border border-border">
              <p className="text-sm text-ink/80 leading-relaxed">
                <strong className="text-ink">그 외에는 일절 보지 않습니다.</strong> 다른
                사장님의 데이터, 외부 사이트, 이름·전화·주소 같은 개인 식별 정보 — 안 봐요.
                AI 키는 서버에만 있고 브라우저 코드에는 노출되지 않습니다. 분석 요청은
                계정당 1분에 10회로 제한되어 있어요.
              </p>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-display text-2xl md:text-3xl mb-3">⑧ 내 데이터는 안전한가요</h2>
            <p className="text-ink/80 leading-relaxed">
              모든 데이터는 사장님 본인의 계정에 묶여 저장돼요. 로그인한 본인만
              조회·수정·삭제할 수 있고, 다른 사장님은 접근할 수 없습니다(서버에서 강제).
              위 ⑦의 묶음 데이터만 분석을 위해 잠깐 외부로 나가고, 그 외에는 외부로 나가지 않아요.
            </p>
          </section>

          <div className="mt-16 mb-4 text-center">
            {user ? (
              <Link to="/sales" className="btn-primary px-8">
                내 가게로 →
              </Link>
            ) : (
              <>
                <Link to="/signup" className="btn-primary px-8">
                  무료로 시작하기
                </Link>
                <div className="mt-4 text-sm">
                  <Link to="/login" className="text-sub hover:text-ink">
                    이미 계정이 있어요
                  </Link>
                </div>
              </>
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
