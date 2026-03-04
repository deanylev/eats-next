'use client';

import { useEffect } from 'react';
import { clearFlashCookieClient, flashCookieNames } from '@/lib/flash-cookies';

type ErrorConfirmProps = {
  message: string | null;
};

export function ErrorConfirm({ message }: ErrorConfirmProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    window.confirm(message);
    clearFlashCookieClient(flashCookieNames.adminError, '/admin');
  }, [message]);

  return null;
}
