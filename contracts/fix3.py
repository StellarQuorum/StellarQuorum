import re

with open("governance/src/test.rs", "r", encoding="utf-8") as f:
    g_content = f.read()

# Governance updates
# 1. ProposalCreated
g_content = re.sub(
    r'(quorum_required:\s*proposal\.quorum_required,?)',
    r'\1\n                metadata_uri: String::from_str(&env, ""),',
    g_content
)

# 2. create_proposal
# Look for: governance.create_proposal( &proposer, &title, &desc );
# Replace: governance.create_proposal( &proposer, &title, &desc, &String::from_str(&env, "") );
g_content = re.sub(
    r'(governance\.create_proposal\(\s*[^,]+,\s*[^,]+,\s*[^,)]+)\s*\)',
    r'\1, &String::from_str(&env, ""))',
    g_content
)
g_content = re.sub(
    r'(governance\.try_create_proposal\(\s*[^,]+,\s*[^,]+,\s*[^,)]+)\s*\)',
    r'\1, &String::from_str(&env, ""))',
    g_content
)

# 3. execute
g_content = re.sub(
    r'governance\.execute\(([^,)]+)\)',
    r'governance.execute(&Address::generate(&env), \1)',
    g_content
)
g_content = re.sub(
    r'governance\.try_execute\(([^,)]+)\)',
    r'governance.try_execute(&Address::generate(&env), \1)',
    g_content
)

# 4. ProposalExecuted
g_content = re.sub(
    r'ProposalExecuted\s*\{\s*id\s*\}',
    r'ProposalExecuted { id, executor: Address::generate(&env) }',
    g_content
)
g_content = re.sub(
    r'ProposalExecuted\s*\{\s*id:\s*([^,]+)\s*\}',
    r'ProposalExecuted { id: \1, executor: Address::generate(&env) }',
    g_content
)

# Add admin transfer tests to Governance
g_tests = """
#[test]
fn two_step_admin_transfer_works() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, 500);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let new_admin = Address::generate(&env);
    
    governance.transfer_admin(&new_admin);
    env.mock_all_auths();
    governance.accept_admin();
    
    let config = governance.get_config();
    assert_eq!(config.admin, new_admin);
}

#[test]
fn cancel_admin_transfer_works() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, 500);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let new_admin = Address::generate(&env);
    
    governance.transfer_admin(&new_admin);
    governance.cancel_admin_transfer();
    assert!(governance.try_accept_admin().is_err());
}
"""
g_content += "\n" + g_tests + "\n"

with open("governance/src/test.rs", "w", encoding="utf-8") as f:
    f.write(g_content)

# Token updates
with open("token/src/test.rs", "r", encoding="utf-8") as f:
    t_content = f.read()

if "use soroban_sdk::testutils::storage::Persistent" not in t_content:
    t_content = t_content.replace("use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};", 
                              "use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};\nuse soroban_sdk::testutils::storage::Persistent as _;")

test_transfer_admin = """#[test]
fn transfer_admin_hands_minting_rights_to_the_new_admin() {
    let env = Env::default();
    let (admin, token) = deploy(&env);
    let new_admin = Address::generate(&env);

    token.transfer_admin(&new_admin);
    env.mock_all_auths();
    token.accept_admin();

    token.mint(&new_admin, &1_000);
    assert_eq!(token.balance(&new_admin), 1_000);
}"""

t_content = re.sub(
    r'#\[test\]\nfn transfer_admin_hands_minting_rights_to_the_new_admin\(\) \{.*?\n\}',
    test_transfer_admin,
    t_content,
    flags=re.DOTALL
)

test_transfer_event = """#[test]
fn transfer_admin_emits_both_sides_of_the_handover() {
    let env = Env::default();
    let (admin, token) = deploy(&env);
    let new_admin = Address::generate(&env);

    token.transfer_admin(&new_admin);
    env.mock_all_auths();
    token.accept_admin();

    let (topics, data) = last_event(&env);
    assert_eq!(
        topics,
        (Symbol::new(&env, "admin_transferred"), admin.clone()).into_val(&env)
    );
    assert_eq!(
        AdminTransferred::try_from_val(&env, &data).unwrap(),
        AdminTransferred { previous_admin: admin, new_admin }
    );
}"""

t_content = re.sub(
    r'#\[test\]\nfn transfer_admin_emits_both_sides_of_the_handover\(\) \{.*?\n\}',
    test_transfer_event,
    t_content,
    flags=re.DOTALL
)

test_cancel = """#[test]
fn cancel_admin_transfer_stops_handover() {
    let env = Env::default();
    let (admin, token) = deploy(&env);
    let new_admin = Address::generate(&env);

    token.transfer_admin(&new_admin);
    token.cancel_admin_transfer();
    assert!(token.try_accept_admin().is_err());
}"""

if "cancel_admin_transfer_stops_handover" not in t_content:
    t_content += "\n" + test_cancel + "\n"

with open("token/src/test.rs", "w", encoding="utf-8") as f:
    f.write(t_content)
