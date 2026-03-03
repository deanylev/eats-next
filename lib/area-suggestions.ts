type RestaurantAreaSource = {
  cityId: string;
  areas: string[];
};

export const buildAreaSuggestionsByCity = (
  restaurants: RestaurantAreaSource[]
): Record<string, string[]> => {
  const grouped = new Map<string, Set<string>>();

  for (const restaurant of restaurants) {
    const existing = grouped.get(restaurant.cityId) ?? new Set<string>();
    for (const area of restaurant.areas) {
      const trimmed = area.trim();
      if (trimmed.length > 0) {
        existing.add(trimmed);
      }
    }
    grouped.set(restaurant.cityId, existing);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([cityId, areas]) => [cityId, [...areas].sort((a, b) => a.localeCompare(b))])
  );
};
