import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-nexus-navy text-white hover:bg-nexus-navydark disabled:opacity-40",
  secondary: "border-2 border-nexus-navy text-nexus-navy hover:bg-nexus-navy/5 disabled:opacity-40",
  danger: "border-2 border-nexus-danger/50 text-nexus-danger hover:bg-nexus-danger/5 disabled:opacity-40",
  ghost: "text-nexus-steel hover:text-nexus-navy disabled:opacity-40",
};

export function Button({
  children,
  variant = "primary",
  icon,
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: Variant;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${variants[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
