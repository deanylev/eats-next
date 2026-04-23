export type RestaurantStatusFilter = 'liked' | 'untried' | 'disliked';
export type CategoryFilter = 'area' | 'type' | 'recentlyAdded';
export type UrlState = {
  city: string;
  hasCityQuery: boolean;
  mealType: string;
  category: CategoryFilter;
  statuses: RestaurantStatusFilter[];
  search: string;
  excluded: string[];
};

export const restaurantStatusFilterSet = new Set<RestaurantStatusFilter>(['liked', 'untried', 'disliked']);
export const categoryFilterSet = new Set<CategoryFilter>(['area', 'type', 'recentlyAdded']);
export const confettiPieceIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const defaultRestaurantStatuses: RestaurantStatusFilter[] = ['untried', 'liked'];
export const showFeelingLuckyForStatuses = (statuses: RestaurantStatusFilter[]): boolean =>
  !(statuses.length === 1 && statuses[0] === 'disliked');

export const getFeelingLuckyCandidateIds = (
  restaurantIds: string[],
  restaurantsById: Map<string, { status: RestaurantStatusFilter }>,
  statuses: RestaurantStatusFilter[]
): string[] => {
  if (!statuses.includes('liked') && !statuses.includes('untried')) {
    return restaurantIds;
  }

  return restaurantIds.filter((id) => {
    const restaurant = restaurantsById.get(id);
    return restaurant ? restaurant.status !== 'disliked' : false;
  });
};

export const getPreservedIncludedHeadings = (
  headings: string[],
  excluded: string[]
): string[] | null => {
  if (excluded.length === 0) {
    return null;
  }

  const excludedSet = new Set(excluded);
  return headings.filter((heading) => !excludedSet.has(heading));
};

export const reconcileExcludedAfterStatusChange = (
  preservedIncludedHeadings: string[] | null,
  nextHeadings: string[]
): string[] => {
  if (preservedIncludedHeadings === null) {
    return [];
  }

  const preservedIncludedSet = new Set(preservedIncludedHeadings);
  return nextHeadings.filter((heading) => !preservedIncludedSet.has(heading));
};

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
      statuses: defaultRestaurantStatuses,
      search: '',
      excluded: []
    };
  }

  const params = new URLSearchParams(window.location.search);
  const categoryFromUrl = params.get('category');
  const mealTypeFromUrl = params.get('mealType');
  const cityFromUrl = params.get('city');
  const searchFromUrl = params.get('q');
  const hasCityQuery = params.has('city');
  const excludedFromUrl = params.getAll('exclude');
  const parsedStatuses = params
    .getAll('status')
    .flatMap((entry) =>
      entry
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    );
  const statusesFromUrl =
    parsedStatuses.length > 0
      ? parsedStatuses.flatMap((value) => {
          if (value === 'untriedLiked') {
            return ['untried', 'liked'] as RestaurantStatusFilter[];
          }

          return restaurantStatusFilterSet.has(value as RestaurantStatusFilter)
            ? [value as RestaurantStatusFilter]
            : [];
        })
      : [];
  const uniqueStatuses = [...new Set(statusesFromUrl)];

  return {
    city: cityFromUrl?.trim() ?? '',
    hasCityQuery,
    mealType: mealTypeFromUrl?.trim() || 'Any',
    category: categoryFromUrl && categoryFilterSet.has(categoryFromUrl as CategoryFilter)
      ? (categoryFromUrl as CategoryFilter)
      : 'area',
    statuses: uniqueStatuses.length > 0 ? uniqueStatuses : defaultRestaurantStatuses,
    search: searchFromUrl?.trim() ?? '',
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
