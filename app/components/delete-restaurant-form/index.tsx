'use client';

import { deleteRestaurant } from '@/app/actions';

type DeleteRestaurantFormProps = {
  restaurantId: string;
  restaurantName: string;
  className?: string;
  buttonClassName?: string;
};

export function DeleteRestaurantForm({
  restaurantId,
  restaurantName,
  className,
  buttonClassName
}: DeleteRestaurantFormProps) {
  return (
    <form
      className={className}
      action={deleteRestaurant}
      onSubmit={(event) => {
        const confirmed = window.confirm(`Delete "${restaurantName}"? It will be moved to deleted restaurants.`);
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <button className={buttonClassName} data-delete-button="true" type="submit">
        Delete
      </button>
    </form>
  );
}
