'use client';

import { restoreRestaurant } from '@/app/actions';
import { ConfirmingActionForm } from '@/app/components/confirming-action-form';

type RestoreRestaurantFormProps = {
  restaurantId: string;
  restaurantName: string;
};

export function RestoreRestaurantForm({ restaurantId, restaurantName }: RestoreRestaurantFormProps) {
  return (
    <ConfirmingActionForm action={restoreRestaurant} confirmText={`Restore "${restaurantName}"?`}>
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <button type="submit">Restore</button>
    </ConfirmingActionForm>
  );
}
