export const ratingToStorageValue = (rating: number | null): number | null =>
  rating === null ? null : Math.round(rating * 2);

export const ratingFromStorageValue = (rating: number | null): number | null =>
  rating === null ? null : rating / 2;
