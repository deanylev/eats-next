export type StatusFilter = 'untriedLiked' | 'liked' | 'untried' | 'disliked';
export type CategoryFilter = 'area' | 'type' | 'recentlyAdded';
export type UrlState = {
  city: string;
  hasCityQuery: boolean;
  mealType: string;
  category: CategoryFilter;
  status: StatusFilter;
  excluded: string[];
};

export const statusFilterSet = new Set<StatusFilter>(['untriedLiked', 'liked', 'untried', 'disliked']);
export const categoryFilterSet = new Set<CategoryFilter>(['area', 'type', 'recentlyAdded']);
export const confettiPieceIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export const mealLabel = (meal: string): string => {
  if (meal === 'snack') {
    return 'Snack';
  }

  if (meal === 'breakfast') {
    return 'Breakfast';
  }

  if (meal === 'lunch') {
    return 'Lunch';
  }

  if (meal === 'dinner') {
    return 'Dinner';
  }

  return meal;
};

export const byAlpha = (a: string, b: string): number => a.localeCompare(b);

const monthHeadingFormatter = new Intl.DateTimeFormat('en-AU', {
  month: 'long',
  year: 'numeric'
});

export const getMonthHeadingKey = (dateValue: string | Date): string => {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
};

export const getMonthHeadingLabel = (headingKey: string): string => {
  const [yearString, monthString] = headingKey.split('-');
  const year = Number(yearString);
  const month = Number(monthString);
  if (Number.isNaN(year) || Number.isNaN(month)) {
    return headingKey;
  }

  return monthHeadingFormatter.format(new Date(year, month - 1, 1));
};

export const readUrlState = (): UrlState => {
  if (typeof window === 'undefined') {
    return {
      city: '',
      hasCityQuery: false,
      mealType: 'Any',
      category: 'area',
      status: 'untriedLiked',
      excluded: []
    };
  }

  const params = new URLSearchParams(window.location.search);
  const statusFromUrl = params.get('status');
  const categoryFromUrl = params.get('category');
  const mealTypeFromUrl = params.get('mealType');
  const cityFromUrl = params.get('city');
  const hasCityQuery = params.has('city');
  const excludedFromUrl = params.getAll('exclude');

  return {
    city: cityFromUrl?.trim() ?? '',
    hasCityQuery,
    mealType: mealTypeFromUrl?.trim() || 'Any',
    category: categoryFromUrl && categoryFilterSet.has(categoryFromUrl as CategoryFilter)
      ? (categoryFromUrl as CategoryFilter)
      : 'area',
    status: statusFromUrl && statusFilterSet.has(statusFromUrl as StatusFilter)
      ? (statusFromUrl as StatusFilter)
      : 'untriedLiked',
    excluded: excludedFromUrl.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  };
};

export const isUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};
