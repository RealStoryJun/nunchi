export type BusinessCategory =
  | 'retail_food'       // 외식·소매 (카페·식당·옷가게·꽃집 등)
  | 'service_personal'  // 인적 서비스 (미용·PT·학원 등 1:1 또는 소수)
  | 'service_repair'    // 정비·수선 (카센터·세탁·공방 등 물건을 다루는 서비스)
  | 'sports_class'      // 스포츠·레슨 (농구·골프·축구 등, 2026-05 신규)
  | 'other';

export type BusinessGroup = '외식' | '소매' | '인적 서비스' | '스포츠·레슨' | '정비·수선' | '기타';

export interface BusinessTypeOption {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  group: BusinessGroup;
  category: BusinessCategory;
}

// 그룹 순서: 외식 → 소매 → 인적 서비스 → 정비·수선 → 기타
export const BUSINESS_TYPES: BusinessTypeOption[] = [
  // 외식
  { id: 'cafe', label: '카페', emoji: '☕', desc: '커피·음료·디저트', group: '외식', category: 'retail_food' },
  { id: 'restaurant', label: '음식점', emoji: '🍽️', desc: '식사·요리', group: '외식', category: 'retail_food' },
  { id: 'bakery', label: '베이커리', emoji: '🥐', desc: '빵·디저트', group: '외식', category: 'retail_food' },
  { id: 'bar', label: '주점·바', emoji: '🍻', desc: '술·안주', group: '외식', category: 'retail_food' },
  // 소매
  { id: 'clothing', label: '의류 매장', emoji: '👕', desc: '옷·패션', group: '소매', category: 'retail_food' },
  { id: 'bag', label: '가방·잡화', emoji: '👜', desc: '가방·액세서리', group: '소매', category: 'retail_food' },
  { id: 'cosmetics', label: '화장품', emoji: '💄', desc: '뷰티·코스메틱', group: '소매', category: 'retail_food' },
  { id: 'flower', label: '꽃집', emoji: '💐', desc: '꽃·식물', group: '소매', category: 'retail_food' },
  { id: 'bookstore', label: '서점·문구', emoji: '📚', desc: '책·문구', group: '소매', category: 'retail_food' },
  { id: 'pet', label: '펫샵', emoji: '🐾', desc: '반려동물 용품', group: '소매', category: 'retail_food' },
  { id: 'sidedish', label: '반찬가게', emoji: '🍱', desc: '반찬·도시락', group: '소매', category: 'retail_food' },
  // 인적 서비스 (2026-05 신규 8개 추가)
  { id: 'beauty', label: '미용·헤어', emoji: '💇', desc: '헤어·네일', group: '인적 서비스', category: 'service_personal' },
  { id: 'pt', label: 'PT', emoji: '🏋️', desc: '개인 트레이닝(1:1)', group: '인적 서비스', category: 'service_personal' },
  { id: 'gym', label: '헬스장', emoji: '💪', desc: '회원제 시설', group: '인적 서비스', category: 'service_personal' },
  { id: 'pilates', label: '필라테스', emoji: '🤸', desc: '그룹·1:1', group: '인적 서비스', category: 'service_personal' },
  { id: 'yoga', label: '요가', emoji: '🧘', desc: '그룹·1:1', group: '인적 서비스', category: 'service_personal' },
  { id: 'nail', label: '네일', emoji: '💅', desc: '네일·페디', group: '인적 서비스', category: 'service_personal' },
  { id: 'massage', label: '마사지·스파', emoji: '💆', desc: '바디·스파', group: '인적 서비스', category: 'service_personal' },
  { id: 'academy', label: '학원', emoji: '📖', desc: '교습·강의', group: '인적 서비스', category: 'service_personal' },
  { id: 'tutoring', label: '과외', emoji: '✏️', desc: '1:1 교습', group: '인적 서비스', category: 'service_personal' },
  // 스포츠·레슨 (2026-05 신규 8종)
  { id: 'basketball', label: '농구 클래스', emoji: '🏀', desc: '1:1·그룹 레슨', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'golf', label: '골프 레슨', emoji: '⛳', desc: '인도어·필드', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'soccer', label: '축구 클래스', emoji: '⚽', desc: '풋살·축구 스쿨', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'baseball', label: '야구 클래스', emoji: '⚾', desc: '타격·캐치볼', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'swimming', label: '수영 강습', emoji: '🏊', desc: '강습·자유 수영', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'tennis', label: '테니스 레슨', emoji: '🎾', desc: '1:1·그룹', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'climbing', label: '클라이밍', emoji: '🧗', desc: '실내 클라이밍', group: '스포츠·레슨', category: 'sports_class' },
  { id: 'dance', label: '댄스 학원', emoji: '💃', desc: 'K-pop·재즈·발레', group: '스포츠·레슨', category: 'sports_class' },
  // 정비·수선
  { id: 'auto_repair', label: '카센터', emoji: '🔧', desc: '정비·오일·타이어', group: '정비·수선', category: 'service_repair' },
  { id: 'motorcycle', label: '오토바이센터', emoji: '🏍️', desc: '오일·체인·정비', group: '정비·수선', category: 'service_repair' },
  { id: 'wrap_tuning', label: '랩핑·튜닝', emoji: '🚙', desc: 'PPF·카본·튜닝', group: '정비·수선', category: 'service_repair' },
  { id: 'craft', label: '공방·수공예', emoji: '🧶', desc: '가죽·캔들·도예', group: '정비·수선', category: 'service_repair' },
  { id: 'laundry', label: '세탁소', emoji: '🧺', desc: '세탁·드라이', group: '정비·수선', category: 'service_repair' },
  // 기타
  { id: 'other', label: '기타', emoji: '📦', desc: '직접 입력 가능', group: '기타', category: 'other' },
];

export const businessTypeLabel = (id: string | null | undefined): string => {
  if (!id) return '미설정';
  return BUSINESS_TYPES.find((t) => t.id === id)?.label ?? id;
};

// 업종 id로 카테고리 조회. 미설정 또는 알 수 없는 id면 'other'로 fallback.
// Needs 폼·BI 분포 카드·AI 프롬프트가 이 함수로 카테고리별 라벨 swap.
export const businessCategoryOf = (id: string | null | undefined): BusinessCategory => {
  if (!id) return 'other';
  return BUSINESS_TYPES.find((t) => t.id === id)?.category ?? 'other';
};

// 그룹별 묶음 (Onboarding/Account에서 grouped select 렌더용)
export const BUSINESS_GROUPS: { group: BusinessGroup; items: BusinessTypeOption[] }[] = (() => {
  const order: BusinessGroup[] = ['외식', '소매', '인적 서비스', '스포츠·레슨', '정비·수선', '기타'];
  return order.map((g) => ({ group: g, items: BUSINESS_TYPES.filter((t) => t.group === g) }));
})();
