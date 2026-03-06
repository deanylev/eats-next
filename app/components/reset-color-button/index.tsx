'use client';

import { DEFAULT_PRIMARY_COLOR } from '@/lib/theme';

type ResetColorButtonProps = {
  inputId: string;
  color?: string;
  className?: string;
  label?: string;
};

const dispatchInputEvents = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

export function ResetColorButton({
  inputId,
  color = DEFAULT_PRIMARY_COLOR,
  className,
  label = 'Reset'
}: ResetColorButtonProps) {
  const handleClick = (): void => {
    const input = document.getElementById(inputId);

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    dispatchInputEvents(input, color);
  };

  return (
    <button type="button" className={className} onClick={handleClick}>
      {label}
    </button>
  );
}
