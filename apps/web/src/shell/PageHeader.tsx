import type { ReactNode } from "react";

export function PageHeader({
  variant,
  title,
  children,
}: {
  variant: "plan" | "reflect" | "accounts";
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className={`page-header ${variant}`}>
      <h1>{title}</h1>
      {children}
    </header>
  );
}
