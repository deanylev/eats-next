'use client';

import { useEffect } from 'react';
import { clearAdminSubdomainDraftClient } from '@/lib/admin-form-state';
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
    clearAdminSubdomainDraftClient();
    clearFlashCookieClient(flashCookieNames.adminError, '/admin');
  }, [message]);

  return null;
}
