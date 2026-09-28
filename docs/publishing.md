# Release Process

How to release StellarQuorum: contract WASM artifacts, SDK package, and frontend
all ship together via a single version tag.

## One-time setup

### npm scope

Before the first release, confirm the `@quorum` scope is owned by the project:

```bash
npm whoami
npm org ls quorum        # must list you (or your team) as owner/admin
```

- If the org exists and you are a member: nothing to do.
- If it exists and you are not: ask an owner to run
  `npm org add quorum <npm-user> --role admin`.
- If it does not exist for you at all: create it (npmjs.com → create
  organization, free for public packages).

### GitHub secrets

| Secret | Purpose |
|---|---|
| NPM_TOKEN | npm granular access token with *publish* permission for @quorum/* |

Create the token on npmjs.com → *Access Tokens* → *Generate New Token* →
*Granular Token*, restricted to publish on `@quorum/*`, and add it as a
repository secret.

## Versioning policy

All components share a single version number defined in `sdk/package.json`.
The project is currently in pre-1.0: `0.MINOR.PATCH`.

| Bump   | Use it for                                                                    |
|--------|--------------------------------------------------------------------------------|
| PATCH  | Bug fixes, documentation, performance — no public API change                   |
| MINOR  | New API **and breaking changes**. Breaking changes must be noted in release notes |
| MAJOR  | The stability contract starts: after 1.0, strict SemVer, breaking changes only in MAJOR |

Rules that apply to every release:

1. `sdk/package.json` is the single source of version truth
2. Never republish a published version: bump instead
3. The git tag must be `vX.Y.Z` and equal the version in `sdk/package.json`
4. `npm run check:publish` runs before every publish and fails if the version is already on the registry

## Release checklist

1. Update version in `sdk/package.json`:

```bash
cd sdk
npm version 0.2.0 --no-git-tag-version   # or edit package.json directly
cd ..
git add sdk/package.json sdk/package-lock.json
git commit -m "release: v0.2.0"
git push
```

1. Push the version tag to trigger the release workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The [release workflow](../.github/workflows/release.yml) will:

- Build and test contracts
- Generate contract WASM artifacts and specs
- Build and test SDK
- Build frontend
- Generate release notes from commit history
- Create a GitHub release with all artifacts attached
- Publish `@quorum/sdk` to npm with provenance

## What gets released

| Component | Artifact |
|-----------|----------|
| Contracts | `quorum_token.wasm`, `quorum_governance.wasm` |
| Specs | `quorum-token.spec.json`, `quorum-governance.spec.json` |
| SDK | `@quorum/sdk@X.Y.Z` on npm |
| Frontend | Built as part of CI (not published separately) |

## Verification

After the release completes:

```bash
# Verify npm package
npm view @quorum/sdk version
npm install @quorum/sdk

# Verify GitHub release artifacts
gh release view v0.2.0
```

## Manual trigger

To trigger a release manually without pushing a tag:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Enter the tag (e.g., `v0.2.0`)
4. Click "Run workflow"

This is useful for re-running a failed release or testing the workflow.
