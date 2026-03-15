'use client';

import type { ReactNode } from 'react';

type ConfirmingActionFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  confirmText: string;
  children: ReactNode;
  promptValue?: string;
  promptLabel?: string;
};

export function ConfirmingActionForm({
  action,
  confirmText,
  children,
  promptValue,
  promptLabel
}: ConfirmingActionFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmText)) {
          event.preventDefault();
          return;
        }

        if (promptValue) {
          const typedValue = window.prompt(promptLabel ?? `Type "${promptValue}" to confirm`, '');
          if (typedValue !== promptValue) {
            event.preventDefault();
          }
        }
      }}
    >
      {children}
    </form>
  );
}
