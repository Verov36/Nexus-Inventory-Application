import { ReactNode } from "react";

type Accent = "none" | "ok" | "warn" | "danger" | "navy";

const accentBorder: Record<Accent, string> = {
  none: "border-l-transparent",
  ok: "border-l-nexus-ok",
  warn: "border-l-nexus-warn",
  danger: "border-l-nexus-danger",
  navy: "border-l-nexus-navy",
};

export function Card({
  children,
  accent = "none",
  className = "",
  as: Component = "div",
  onClick,
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
  as?: "div" | "li";
  onClick?: () => void;
}) {
  return (
    <Component
      onClick={onClick}
      className={`rounded-xl border-l-4 bg-white shadow-card ${accentBorder[accent]} ${
        onClick ? "cursor-pointer transition-shadow hover:shadow-cardHover" : ""
      } ${className}`}
    >
      {children}
    </Component>
  );
}
