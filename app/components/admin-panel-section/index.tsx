import type { ReactNode } from 'react';

type AdminPanelSectionProps = {
  title: string;
  className: string;
  children: ReactNode;
};

export function AdminPanelSection({
  title,
  className,
  children
}: AdminPanelSectionProps) {
  return (
    <section className={className}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
