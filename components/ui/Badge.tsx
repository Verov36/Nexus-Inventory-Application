import { ReactNode } from "react";

type Tone = "neutral" | "ok" | "warn" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-nexus-steel/10 text-nexus-steel",
  ok: "bg-nexus-ok/10 text-nexus-ok",
  warn: "bg-nexus-warn/10 text-nexus-warn",
  danger: "bg-nexus-danger/10 text-nexus-danger",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
