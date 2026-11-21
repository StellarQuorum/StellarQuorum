import type { ProposalStatus } from "@/lib/types";
import { t } from "@/lib/i18n";

const config: Record<ProposalStatus, { label: string; classes: string; dot?: string }> = {
  active:    { label: t("common.active"),    classes: "bg-blue-900/50 text-blue-300 border border-blue-700", dot: "bg-blue-400 animate-pulse" },
  passed:    { label: t("common.passed"),    classes: "bg-green-900/50 text-green-300 border border-green-700" },
  failed:    { label: t("common.failed"),    classes: "bg-red-900/50 text-red-300 border border-red-700" },
  pending:   { label: t("common.pending"),   classes: "bg-amber-900/50 text-amber-300 border border-amber-700" },
  executed:  { label: t("common.executed"),  classes: "bg-purple-900/50 text-purple-300 border border-purple-700" },
  cancelled: { label: t("common.cancelled"), classes: "bg-slate-800 text-slate-400 border border-slate-600" },
  vetoed:    { label: t("common.vetoed"),    classes: "bg-rose-950/70 text-rose-300 border border-rose-700" },
  queued:    { label: t("common.queued"),    classes: "bg-cyan-950/70 text-cyan-300 border border-cyan-700" },
  expired:   { label: t("common.expired"),   classes: "bg-orange-950/70 text-orange-300 border border-orange-700" },
};

export default function StatusBadge({ status }: { status: ProposalStatus }) {
  const { label, classes, dot } = config[status];
  return (
    <span role="status" aria-label={label} className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${classes}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {label}
    </span>
  );
}
