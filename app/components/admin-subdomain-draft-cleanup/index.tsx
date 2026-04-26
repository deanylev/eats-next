'use client';

import { useEffect } from 'react';
import { clearAdminSubdomainDraftClient } from '@/lib/admin-form-state';

type AdminSubdomainDraftCleanupProps = {
  enabled: boolean;
};

export function AdminSubdomainDraftCleanup({ enabled }: AdminSubdomainDraftCleanupProps) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    clearAdminSubdomainDraftClient();
  }, [enabled]);

  return null;
}
