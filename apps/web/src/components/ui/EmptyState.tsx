import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = "" }: EmptyStateProps) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-3 px-6 py-16 text-center ${className}`}>
      {icon && <div className="text-zinc-400 dark:text-zinc-500">{icon}</div>}
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {description && <div className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
