import type { ReactNode } from "react";

/** Consistent hierarchy for product and settings screens. */
export default function PageHeader({
  title,
  context,
  children,
  className = ""
}: {
  title: string;
  context: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={"page-header " + className}>
      <div className="page-header-title">
        <span className="eyebrow">{context}</span>
        <h1>{title}</h1>
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}
