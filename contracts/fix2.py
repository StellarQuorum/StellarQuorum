import re

with open("token/src/test.rs", "r", encoding="utf-8") as f:
    content = f.read()

if "use soroban_sdk::testutils::storage::Persistent" not in content:
    content = content.replace("use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};", 
                              "use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};\nuse soroban_sdk::testutils::storage::Persistent as _;")

test_transfer_admin = """#[test]
fn transfer_admin_hands_minting_rights_to_the_new_admin() {
    let env = Env::default();
    let (admin, token) = deploy(&env);
    let new_admin = Address::generate(&env);

    token.transfer_admin(&new_admin);
    // Note: mock auth might be needed again for accept
    env.mock_all_auths();
    token.accept_admin();

    // The rights moved: the new admin can mint.
    token.mint(&new_admin, &1_000);
    assert_eq!(token.balance(&new_admin), 1_000);
}"""

content = re.sub(
    r'#\[test\]\nfn transfer_admin_hands_minting_rights_to_the_new_admin\(\) \{.*?\n\}',
    test_transfer_admin,
    content,
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

content = re.sub(
    r'#\[test\]\nfn transfer_admin_emits_both_sides_of_the_handover\(\) \{.*?\n\}',
    test_transfer_event,
    content,
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

if "cancel_admin_transfer_stops_handover" not in content:
    content += "\n" + test_cancel + "\n"

with open("token/src/test.rs", "w", encoding="utf-8") as f:
    f.write(content)
