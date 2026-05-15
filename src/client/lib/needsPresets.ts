import type { BusinessCategory } from './businessTypes';

// DB 컬럼은 카페 어휘로 묶여 있지만 (gender·age_band·with_child·purpose·residence),
// 카테고리별로 표시 라벨만 갈아끼워 다른 업종 손님 데이터로 reinterpret.
// DB·시드·schema 변경 없음. 기존 needs 레코드는 그대로 보존.
//
// gender / age_band는 모든 카테고리 공통 (PT 손님도 10-20대가 있고, 카센터 손님도 여성이 있음).
// 차별화되는 슬롯: with_child / purpose / residence.

export interface SlotOption {
  v: string; // DB 저장 값 (모든 카테고리 동일 enum 사용)
  l: string; // 표시 라벨 (카테고리별 다를 수 있음)
}

export interface SlotPreset {
  label: string;
  options: SlotOption[];
}

export interface NeedsPreset {
  gender: SlotPreset;
  ageBand: SlotPreset;
  withChild: SlotPreset;
  purpose: SlotPreset;
  residence: SlotPreset;
}

// 모든 카테고리 공통 슬롯
const GENDER: SlotPreset = {
  label: '성별',
  options: [
    { v: 'female', l: '여성' },
    { v: 'male', l: '남성' },
  ],
};

const AGE_BAND: SlotPreset = {
  label: '연령대',
  options: [
    { v: '10s_20s', l: '10·20대' },
    { v: '30s_40s', l: '30·40대' },
    { v: '50plus', l: '50대 이상' },
  ],
};

// 카테고리별 차별화 슬롯
// retail_food: 자녀 동반 / 식사대용·선물·간식 / 부산·외
// service_personal: 신규·단골 / 정기 관리·이벤트·문제 해결 / 검색·지인 소개
// service_repair: 국산·수입 / 정기 점검·고장 수리·소모품 / 검색·지인 소개
// other: retail_food 기본값과 동일 (다양한 손님 대응)

export const NEEDS_PRESETS: Record<BusinessCategory, NeedsPreset> = {
  retail_food: {
    gender: GENDER,
    ageBand: AGE_BAND,
    withChild: {
      label: '자녀 동반 여부',
      options: [
        { v: 'no', l: '미동반' },
        { v: 'yes', l: '자녀 동반' },
      ],
    },
    purpose: {
      label: '목적',
      options: [
        { v: 'meal_replacement', l: '식사대용' },
        { v: 'gift', l: '선물용' },
        { v: 'kids_snack', l: '자녀 간식용' },
      ],
    },
    residence: {
      label: '거주지',
      options: [
        { v: 'busan', l: '부산' },
        { v: 'outside', l: '부산 외' },
      ],
    },
  },
  service_personal: {
    gender: GENDER,
    ageBand: AGE_BAND,
    withChild: {
      label: '방문 빈도',
      options: [
        { v: 'no', l: '신규' },
        { v: 'yes', l: '단골' },
      ],
    },
    purpose: {
      label: '서비스 사유',
      options: [
        { v: 'meal_replacement', l: '정기 관리' },
        { v: 'gift', l: '이벤트·특별' },
        { v: 'kids_snack', l: '문제 해결' },
      ],
    },
    residence: {
      label: '방문 경로',
      options: [
        { v: 'busan', l: '검색·SNS' },
        { v: 'outside', l: '지인 소개' },
      ],
    },
  },
  service_repair: {
    gender: GENDER,
    ageBand: AGE_BAND,
    withChild: {
      label: '차종·장비',
      options: [
        { v: 'no', l: '국산' },
        { v: 'yes', l: '수입·고급' },
      ],
    },
    purpose: {
      label: '방문 사유',
      options: [
        { v: 'meal_replacement', l: '정기 점검' },
        { v: 'gift', l: '고장 수리' },
        { v: 'kids_snack', l: '소모품 교체' },
      ],
    },
    residence: {
      label: '방문 경로',
      options: [
        { v: 'busan', l: '검색·SNS' },
        { v: 'outside', l: '지인 소개' },
      ],
    },
  },
  sports_class: {
    gender: GENDER,
    ageBand: AGE_BAND,
    withChild: {
      label: '회원 유형',
      options: [
        { v: 'no', l: '신규·체험' },
        { v: 'yes', l: '정기 회원' },
      ],
    },
    purpose: {
      label: '레슨 목적',
      options: [
        { v: 'meal_replacement', l: '실력 향상' },
        { v: 'gift', l: '취미·여가' },
        { v: 'kids_snack', l: '대회 준비' },
      ],
    },
    residence: {
      label: '방문 경로',
      options: [
        { v: 'busan', l: '검색·SNS' },
        { v: 'outside', l: '지인 소개' },
      ],
    },
  },
  other: {
    gender: GENDER,
    ageBand: AGE_BAND,
    withChild: {
      label: '자녀 동반 여부',
      options: [
        { v: 'no', l: '미동반' },
        { v: 'yes', l: '자녀 동반' },
      ],
    },
    purpose: {
      label: '목적',
      options: [
        { v: 'meal_replacement', l: '식사대용' },
        { v: 'gift', l: '선물용' },
        { v: 'kids_snack', l: '자녀 간식용' },
      ],
    },
    residence: {
      label: '거주지',
      options: [
        { v: 'busan', l: '부산' },
        { v: 'outside', l: '부산 외' },
      ],
    },
  },
};

// 표시 라벨 lookup (slot + DB값 → 표시 라벨). chips() / BI 카드에서 사용.
// (AI 프롬프트용 어휘 힌트는 src/worker/types.ts NEEDS_CATEGORY_HINT만 사용 - 단일 source of truth)
// 카테고리 매칭되지 않으면 retail_food fallback.
export const labelFor = (
  category: BusinessCategory,
  slot: keyof NeedsPreset,
  value: string | null,
): string | null => {
  if (value == null) return null;
  const preset = NEEDS_PRESETS[category];
  const opt = preset[slot].options.find((o) => o.v === value);
  return opt?.l ?? value;
};
