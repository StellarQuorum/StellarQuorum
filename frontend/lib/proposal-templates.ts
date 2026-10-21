import { t } from "@/lib/i18n";

// Issue #281: starting points for the Create Proposal form. A template only
// pre-fills the category and description. The title and the on-chain action
// stay the proposer's to fill in.

export interface ProposalTemplate {
  id: "blank" | "parameter-change" | "treasury-spend" | "signaling";
  label: string;
  /** Category the form switches to, or null to leave the category alone. */
  category: string | null;
  /** Markdown the description is pre-filled with, or null for a blank form. */
  description: string | null;
}

/** Every template the picker offers, in the order it shows them. */
export function getProposalTemplates(): ProposalTemplate[] {
  return [
    { id: "blank", label: t("templates.blank"), category: null, description: null },
    { id: "parameter-change", label: t("templates.parameterChange"), category: t("create.categories.protocol"), description: t("templates.parameterChangeBody") },
    { id: "treasury-spend", label: t("templates.treasurySpend"), category: t("create.categories.treasury"), description: t("templates.treasurySpendBody") },
    { id: "signaling", label: t("templates.signaling"), category: t("create.categories.governance"), description: t("templates.signalingBody") },
  ];
}
