'use client';

import { restoreRestaurant } from '@/app/actions';

type RestoreRestaurantFormProps = {
  restaurantId: string;
  restaurantName: string;
};

export function RestoreRestaurantForm({ restaurantId, restaurantName }: RestoreRestaurantFormProps) {
  return (
    <form
      action={restoreRestaurant}
      onSubmit={(event) => {
        const confirmed = window.confirm(`Restore "${restaurantName}"?`);
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <button type="submit">Restore</button>
    </form>
  );
}
