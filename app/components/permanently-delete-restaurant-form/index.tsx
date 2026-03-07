'use client';

import { permanentlyDeleteRestaurant } from '@/app/actions';
import { ConfirmingActionForm } from '@/app/components/confirming-action-form';

type PermanentlyDeleteRestaurantFormProps = {
  restaurantId: string;
  restaurantName: string;
};

export function PermanentlyDeleteRestaurantForm({
  restaurantId,
  restaurantName
}: PermanentlyDeleteRestaurantFormProps) {
  return (
    <ConfirmingActionForm
      action={permanentlyDeleteRestaurant}
      confirmText={`Permanently delete "${restaurantName}"? This cannot be undone.`}
    >
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <button type="submit" data-delete-button="true">
        Delete Permanently
      </button>
    </ConfirmingActionForm>
  );
}
