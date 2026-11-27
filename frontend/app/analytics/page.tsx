import type { ReactNode } from "react";
import ParticipationChart from "@/components/charts/ParticipationChart";
import ProposalOutcomesChart from "@/components/charts/ProposalOutcomesChart";
import { calculateAnalytics, getProposalSupplies } from "@/lib/analytics";
import { getProposals } from "@/lib/proposals";
import { formatNumber } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#1a2535] bg-[#0b1119] p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-[#1a2535] bg-[#0b1119] p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function concentrationLabel(gini: number | null): string {
  if (gini === null) return "No voter-level history available";
  if (gini < 0.3) return "Broadly distributed";
  if (gini < 0.6) return "Moderately concentrated";
  return "Highly concentrated";
}

export default async function AnalyticsPage() {
  const proposals = await getProposals();
  const supplies = await getProposalSupplies(proposals);
  const analytics = calculateAnalytics(proposals, supplies);
  const giniPosition = analytics.giniCoefficient === null
    ? 0
    : Math.max(0, Math.min(100, analytics.giniCoefficient * 100));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-blue-400">Governance health</p>
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Governance analytics</h1>
        <p className="mt-3 max-w-2xl text-slate-400">
          Participation, proposal outcomes, and voting-power distribution across {formatNumber(analytics.proposalCount)} proposals.
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Overall participation"
          value={percent(analytics.overallParticipationRate)}
          detail="Cumulative voting power ÷ cumulative snapshot supply"
        />
        <Metric
          label="Proposal pass rate"
          value={percent(analytics.passRate)}
          detail="Resolved proposals meeting quorum and majority"
        />
        <Metric
          label="Average voting power"
          value={formatNumber(analytics.averageVotingPower, { notation: "compact", maximumFractionDigits: 1 })}
          detail="Recorded voting power per proposal"
        />
        <Metric
          label="Quorum achievement"
          value={percent(analytics.quorumAchievementRate)}
          detail="Proposals with recorded votes reaching quorum"
        />
      </div>

      <div className="space-y-6">
        <Panel title="Participation trends">
          <ParticipationChart
            participation={analytics.participationTrend}
            quorum={analytics.quorumTrend}
          />
        </Panel>

        <Panel title="Proposal outcomes">
          <ProposalOutcomesChart monthly={analytics.monthlyProposals} voteSplit={analytics.voteSplit} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Average vote split by category">
            {analytics.categorySplits.length === 0 ? (
              <p className="text-sm text-slate-500">No categorized voting data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-[#1a2535] text-left text-xs text-slate-500">
                      <th scope="col" className="pb-3 font-medium">Category</th>
                      <th scope="col" className="pb-3 text-right font-medium text-emerald-400">For</th>
                      <th scope="col" className="pb-3 text-right font-medium text-red-400">Against</th>
                      <th scope="col" className="pb-3 text-right font-medium">Abstain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.categorySplits.map(category => (
                      <tr key={category.category} className="border-b border-[#111c29] last:border-0">
                        <th scope="row" className="py-3 text-left font-medium text-slate-200">{category.category}</th>
                        <td className="py-3 text-right text-emerald-400">{category.forPercent.toFixed(1)}%</td>
                        <td className="py-3 text-right text-red-400">{category.againstPercent.toFixed(1)}%</td>
                        <td className="py-3 text-right text-slate-400">{category.abstainPercent.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Most active voters">
            {analytics.activeVoters.length === 0 ? (
              <p className="text-sm text-slate-500">Voter-level history is not available for these proposals.</p>
            ) : (
              <ol className="space-y-3">
                {analytics.activeVoters.map((voter, index) => (
                  <li key={voter.address} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#162032] text-xs font-semibold text-blue-300">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200">{voter.address}</span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm text-white">{formatNumber(voter.participationCount)} proposals</span>
                      <span className="block text-xs text-slate-500">
                        {formatNumber(voter.votingPower, { notation: "compact", maximumFractionDigits: 1 })} voting power
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <Panel title="Voting-power concentration">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="sm:min-w-48">
              <p className="text-3xl font-semibold text-white">
                {analytics.giniCoefficient === null ? "—" : analytics.giniCoefficient.toFixed(3)}
              </p>
              <p className="mt-1 text-sm text-slate-400">Gini coefficient</p>
              <p className="mt-2 text-xs text-slate-500">{concentrationLabel(analytics.giniCoefficient)}</p>
              {analytics.giniCoefficient !== null && (
                <p className="mt-1 text-xs text-slate-500">
                  Calculated from {formatNumber(analytics.voterCount)} recorded voters
                </p>
              )}
            </div>
            <div className="w-full">
              <div
                role="img"
                aria-label={analytics.giniCoefficient === null
                  ? "Voting-power concentration unavailable"
                  : `Voting-power concentration ${analytics.giniCoefficient.toFixed(3)} on a scale from 0 to 1`}
                className="relative pt-3"
              >
                {analytics.giniCoefficient !== null && (
                  <span
                    className="absolute top-0 h-5 w-0.5 bg-white"
                    style={{ left: `${giniPosition}%` }}
                  />
                )}
                <div className="h-3 rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>0 · Equal distribution</span>
                <span>1 · Maximum concentration</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
