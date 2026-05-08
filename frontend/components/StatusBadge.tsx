import type { ProposalStatus } from "@/lib/types";

const config: Record<ProposalStatus, { label: string; classes: string; dot?: string }> = {
  active:    { label: "Active",    classes: "bg-blue-900/50 text-blue-300 border border-blue-700", dot: "bg-blue-400 animate-pulse" },
  passed:    { label: "Passed",    classes: "bg-green-900/50 text-green-300 border border-green-700" },
  failed:    { label: "Failed",    classes: "bg-red-900/50 text-red-300 border border-red-700" },
  pending:   { label: "Pending",   classes: "bg-amber-900/50 text-amber-300 border border-amber-700" },
  executed:  { label: "Executed",  classes: "bg-purple-900/50 text-purple-300 border border-purple-700" },
  cancelled: { label: "Cancelled", classes: "bg-slate-800 text-slate-400 border border-slate-600" },
};

export default function StatusBadge({ status }: { status: ProposalStatus }) {
  const { label, classes, dot } = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${classes}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {label}
    </span>
  );
}
