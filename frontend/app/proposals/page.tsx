import { getProposals } from "@/lib/proposals";
import ProposalList from "@/components/ProposalList";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  return <ProposalList proposals={await getProposals()} />;
}
