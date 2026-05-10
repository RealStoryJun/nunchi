export interface BusinessTypeOption {
  id: string;
  label: string;
  emoji: string;
  desc: string;
}

export const BUSINESS_TYPES: BusinessTypeOption[] = [
  { id: 'cafe', label: '카페', emoji: '☕', desc: '커피·음료·디저트' },
  { id: 'restaurant', label: '음식점', emoji: '🍽️', desc: '식사·요리' },
  { id: 'bakery', label: '베이커리', emoji: '🥐', desc: '빵·디저트' },
  { id: 'bar', label: '주점·바', emoji: '🍻', desc: '술·안주' },
  { id: 'clothing', label: '의류 매장', emoji: '👕', desc: '옷·패션' },
  { id: 'bag', label: '가방·잡화', emoji: '👜', desc: '가방·액세서리' },
  { id: 'cosmetics', label: '화장품', emoji: '💄', desc: '뷰티·코스메틱' },
  { id: 'flower', label: '꽃집', emoji: '💐', desc: '꽃·식물' },
  { id: 'bookstore', label: '서점·문구', emoji: '📚', desc: '책·문구' },
  { id: 'pet', label: '펫샵', emoji: '🐾', desc: '반려동물 용품' },
  { id: 'beauty', label: '미용·헤어', emoji: '💇', desc: '헤어·네일' },
  { id: 'other', label: '기타', emoji: '📦', desc: '직접 입력 가능' },
];

export const businessTypeLabel = (id: string | null | undefined): string => {
  if (!id) return '미설정';
  return BUSINESS_TYPES.find((t) => t.id === id)?.label ?? id;
};
