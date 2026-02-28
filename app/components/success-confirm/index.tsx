'use client';

import { useEffect } from 'react';

type SuccessConfirmProps = {
  message: string | null;
};

export function SuccessConfirm({ message }: SuccessConfirmProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    window.confirm(message);

    const createRestaurantForm = document.getElementById('create-restaurant-form');
    if (createRestaurantForm instanceof HTMLFormElement) {
      createRestaurantForm.reset();
    }

    document.cookie = 'admin_success_message=; Max-Age=0; path=/admin; SameSite=Lax';
  }, [message]);

  return null;
}
