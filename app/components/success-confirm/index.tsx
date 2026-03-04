'use client';

import { useEffect } from 'react';
import { clearFlashCookieClient, flashCookieNames } from '@/lib/flash-cookies';

type SuccessConfirmProps = {
  message: string | null;
};

export function SuccessConfirm({ message }: SuccessConfirmProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    window.confirm(message);

    const forms = document.querySelectorAll<HTMLFormElement>('form[data-reset-on-success="true"]');
    for (const form of forms) {
      form.reset();
    }

    clearFlashCookieClient(flashCookieNames.adminSuccess, '/admin');
  }, [message]);

  return null;
}
