'use client';

import type { ReactNode } from 'react';

type ConfirmingActionFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  confirmText: string;
  children: ReactNode;
};

export function ConfirmingActionForm({
  action,
  confirmText,
  children
}: ConfirmingActionFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
