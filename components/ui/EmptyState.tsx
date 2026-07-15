import { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-nexus-steel/25 bg-white/50 px-6 py-12 text-center">
      {icon && <div className="text-nexus-steel/50">{icon}</div>}
      <p className="font-medium text-nexus-navy">{title}</p>
      {description && <p className="max-w-sm text-sm text-nexus-steel">{description}</p>}
      {action}
    </div>
  );
}
