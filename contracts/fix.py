import re

with open("governance/src/test.rs", "r", encoding="utf-8") as f:
    content = f.read()

# Fix ProposalCreated initialization: missing metadata_uri
content = re.sub(
    r'(quorum_required:\s*proposal\.quorum_required,?)',
    r'\1\n                metadata_uri: String::from_str(&env, ""),',
    content
)

# For create_proposal missing metadata_uri
# It might look like: governance.create_proposal(&admin, &title, &description);
# Or spread across multiple lines.
content = re.sub(
    r'(governance\.try_create_proposal\(\s*[^,]+,\s*[^,]+,\s*[^,]+)(\s*\))',
    r'\1, &String::from_str(&env, "")\2',
    content
)

content = re.sub(
    r'(governance\.create_proposal\(\s*[^,]+,\s*[^,]+,\s*[^,]+)(\s*\))',
    r'\1, &String::from_str(&env, "")\2',
    content
)

# Fix tests missing ProposalExecuted { id, executor } because the powershell one didn't match all of them
content = re.sub(
    r'ProposalExecuted\s*\{\s*id\s*\}',
    r'ProposalExecuted { id, executor: Address::generate(&env) }',
    content
)
content = re.sub(
    r'ProposalExecuted\s*\{\s*id:\s*proposal_id\s*\}',
    r'ProposalExecuted { id: proposal_id, executor: Address::generate(&env) }',
    content
)

with open("governance/src/test.rs", "w", encoding="utf-8") as f:
    f.write(content)
