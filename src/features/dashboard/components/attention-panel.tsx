import * as React from "react";
import { Sparkles } from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { IconOrb } from "@/components/common/icon-orb";
import { severityIcon } from "@/components/common/status-badge";
import type { AttentionItem } from "@/mocks/types";

/**
 * AttentionPanel — surfaced findings that need the doctor's eyes.
 *
 * Phase 1 renders static mock findings. When the real thing lands (Phase 12)
 * these must be produced by deterministic rules over our own data, not by a
 * language model — AI may *explain* a flag, it must never *raise* one.
 *
 * Items are sorted by severity so the worst thing is never below the fold.
 */
const ORDER = { critical: 0, serious: 1, caution: 2, none: 3 } as const;

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const sorted = [...items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return (
    <GlassCard className="overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-glass-border px-4 py-3">
        <IconOrb accent="violet" size="sm">
          <Sparkles className="size-4" />
        </IconOrb>
        <h2 className="text-[15px] font-semibold text-ink">Needs attention</h2>
        <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">
          Mock data
        </span>
      </div>

      <ul className="divide-y divide-glass-border">
        {sorted.map((item) => (
          <li key={item.id} className="flex gap-3 px-4 py-3">
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {severityIcon(item.severity, "size-4")}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">{item.title}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-secondary">
                {item.detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
