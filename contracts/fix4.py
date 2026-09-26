def fix_args(content, method_name, append_arg):
    idx = 0
    while True:
        idx = content.find(method_name + "(", idx)
        if idx == -1:
            break
        # find matching parenthesis
        paren_count = 0
        end_idx = idx + len(method_name)
        while end_idx < len(content):
            if content[end_idx] == '(':
                paren_count += 1
            elif content[end_idx] == ')':
                paren_count -= 1
                if paren_count == 0:
                    break
            end_idx += 1
        
        # insert string
        content = content[:end_idx] + append_arg + content[end_idx:]
        idx = end_idx + len(append_arg)
    return content

with open("governance/src/test.rs", "r", encoding="utf-8") as f:
    content = f.read()

import re

# 1. ProposalCreated
content = re.sub(
    r'(quorum_required:\s*proposal\.quorum_required,?)',
    r'\1\n                metadata_uri: String::from_str(&env, ""),',
    content
)

# 2. create_proposal
content = fix_args(content, "governance.create_proposal", ', &String::from_str(&env, "")')
content = fix_args(content, "governance.try_create_proposal", ', &String::from_str(&env, "")')
content = fix_args(content, ".create_proposal", ', &String::from_str(&env, "")') # catches GovernanceContractClient::new(&env, &governance_id).create_proposal(

# 3. execute (need to prepend &Address::generate(&env))
def fix_execute(c, method):
    idx = 0
    while True:
        idx = c.find(method + "(", idx)
        if idx == -1:
            break
        start_arg_idx = idx + len(method) + 1
        # skip whitespace
        while c[start_arg_idx].isspace():
            start_arg_idx += 1
        
        c = c[:start_arg_idx] + "&Address::generate(&env), " + c[start_arg_idx:]
        idx = start_arg_idx + 26
    return c

content = fix_execute(content, "governance.execute")
content = fix_execute(content, "governance.try_execute")

# 4. ProposalExecuted
content = re.sub(
    r'ProposalExecuted\s*\{\s*id\s*\}',
    r'ProposalExecuted { id, executor: Address::generate(&env) }',
    content
)
content = re.sub(
    r'ProposalExecuted\s*\{\s*id:\s*([^,]+)\s*\}',
    r'ProposalExecuted { id: \1, executor: Address::generate(&env) }',
    content
)

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
content += "\n" + g_tests + "\n"

with open("governance/src/test.rs", "w", encoding="utf-8") as f:
    f.write(content)
