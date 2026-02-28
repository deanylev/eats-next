'use client';

import { useEffect } from 'react';

type ErrorConfirmProps = {
  message: string | null;
};

export function ErrorConfirm({ message }: ErrorConfirmProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    window.confirm(message);
    document.cookie = 'admin_error_message=; Max-Age=0; path=/admin; SameSite=Lax';
  }, [message]);

  return null;
}
