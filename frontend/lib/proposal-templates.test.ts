import { getProposalTemplates } from "./proposal-templates";

// Issue #281: at least three templates, and Blank is the one that leaves the form as it is.

describe("getProposalTemplates", () => {
  const templates = getProposalTemplates();

  it("offers Blank plus the Parameter Change, Treasury Spend and Signaling templates", () => {
    expect(templates.map(template => template.id)).toEqual([
      "blank",
      "parameter-change",
      "treasury-spend",
      "signaling",
    ]);
  });

  it("leaves both category and description alone for Blank", () => {
    const blank = templates.find(template => template.id === "blank");
    expect(blank).toMatchObject({ category: null, description: null });
  });

  it("gives every other template a category and a Markdown body with headings", () => {
    for (const template of templates.filter(candidate => candidate.id !== "blank")) {
      expect(template.category).toEqual(expect.any(String));
      expect(template.description).toMatch(/^## /);
    }
  });
});
