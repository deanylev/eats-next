import { ResetColorButton } from '@/app/components/reset-color-button';

type ColorFieldProps = {
  label: string;
  inputId: string;
  name: string;
  defaultValue: string;
  resetColor: string;
  rowClassName: string;
};

export function ColorField({
  label,
  inputId,
  name,
  defaultValue,
  resetColor,
  rowClassName
}: ColorFieldProps) {
  return (
    <label>
      {label}
      <div className={rowClassName}>
        <input id={inputId} name={name} type="color" required defaultValue={defaultValue} />
        <ResetColorButton inputId={inputId} color={resetColor} />
      </div>
    </label>
  );
}
