# Contributing to Quorum

Thank you for your interest in contributing to Quorum!

## Ways to Contribute

### Add a Contract Feature
Open issues tagged `contract` are the best starting point. To add a feature:
1. Modify `contracts/governance/src/lib.rs` or `contracts/token/src/lib.rs`
2. Write tests using soroban-sdk testutils
3. Update the contract README

### Improve the Frontend
Issues tagged `frontend` cover UI improvements, new pages, and accessibility work:
1. Work in `frontend/app/` and `frontend/components/`
2. Run `npm run dev` to preview changes
3. Run `npm run build` before opening a PR to verify no build errors

### Extend the SDK
Issues tagged `sdk` cover new methods and improved typing:
1. Work in `sdk/src/`
2. Wire methods to real Soroban RPC calls
3. Export new types from `sdk/src/index.ts`

## Drips Wave

Quorum participates in the Stellar Wave on Drips Network. Tagged issues earn Points redeemable for XLM rewards during each monthly sprint cycle.

## Code Style
- TypeScript: strict mode, no `any`
- Rust: follow Soroban SDK patterns, use `Result<T, Error>` over `panic!()`
- Commits: conventional commits format (`feat:`, `fix:`, `docs:`, `style:`, `test:`, `chore:`)
