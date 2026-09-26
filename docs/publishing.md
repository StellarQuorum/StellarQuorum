# Publishing `@quorum/sdk`

How the SDK gets from `sdk/package.json` to `npm install @quorum/sdk`, what has
to be configured once, and the versioning rules that apply before 1.0.

## Name and scope status

Checked against the public registry on 2026-09-26:

| Query | Result |
|---|---|
| `GET registry.npmjs.org/@quorum%2fsdk` | `404` — the name has never been published |
| `search?text=scope:quorum` | `0` packages under the `@quorum` scope |
| `GET registry.npmjs.org/-/org/quorum/user` | `200` — the `quorum` scope exists on npm (a non-existent name returns `404 Scope not found`) |

So `@quorum/sdk` is free and no rename is needed — but the scope existing is
not the same as *this project* owning it. Before the first release, a
maintainer logged into npm must confirm access:

```bash
npm whoami
npm org ls quorum        # must list you (or your team) as owner/admin
```

- If the org exists and you are a member: nothing to do.
- If it exists and you are not: ask an owner to run
  `npm org add quorum <npm-user> --role admin`.
- If it does not exist for you at all: create it (npmjs.com → create
  organization, free for public packages), or rename the package.

**Renaming**, if the scope cannot be claimed: change `name` in
`sdk/package.json` (the `exports` map is name-independent), then update the
install commands in the root `README.md` and `sdk/README.md`. Re-run
`npm run check:publish` — it prints the same scope report on every release.

## Credentials

| What | Where |
|---|---|
| npm granular access token with *publish* permission for the scope | GitHub repo secret `NPM_TOKEN` |
| Provenance (signed by GitHub OIDC) | already handled — `publish.yml` sets `permissions: id-token: write` and passes `--provenance` |

Create the token on npmjs.com → *Access Tokens* → *Generate New Token* →
*Granular Token*, restricted to publish on `@quorum/*`, and add it as a
repository secret. Rotate it if it leaks or the team changes.

`npm publish` runs `prepublishOnly` (`build` + the ESM/CJS smoke test), so a
manual publish from a laptop is guarded the same way CI is.

## Versioning policy (pre-1.0)

The package is `0.MINOR.PATCH` until 1.0.

| Bump | Use it for |
|---|---|
| **PATCH** `0.1.0 → 0.1.1` | Bug fixes, documentation, performance — no public API change |
| **MINOR** `0.1.0 → 0.2.0` | New API **and breaking changes**. While the major version is `0`, anything may break in a MINOR; every breaking change must be called out in the release notes |
| **MAJOR** `0.x → 1.0.0` | The stability contract starts: after 1.0, strict SemVer, breaking changes only in MAJOR |

Rules that apply to every release:

1. `sdk/package.json` is the single source of version truth — the repository
   root has its own independent version.
2. Never republish a published version: npm rejects it, and consumers cache
   by version. Bump instead.
3. The git tag must be `sdk-vX.Y.Z` and equal the version in
   `sdk/package.json`; `publish.yml` fails the run otherwise.
4. `npm run check:publish` runs before every publish and fails if the version
   is already on the registry.

## Release checklist

```bash
cd sdk
npm run verify            # lint + build + test + ESM/CJS smoke test
npm version 0.2.0 --no-git-tag-version   # or edit package.json
git add package.json package-lock.json
git commit -m "sdk: release v0.2.0"
git push
```

Then, once that is on `main`:

```bash
git tag sdk-v0.2.0
git push origin sdk-v0.2.0
```

The [publish workflow](../.github/workflows/publish.yml) lints, builds both
formats, tests, smoke-tests, checks the tag/version, and runs
`npm publish --access public --provenance` with `NPM_TOKEN`.

Verify the result:

```bash
npm view @quorum/sdk version
npm install @quorum/sdk
```

## Dry run

```bash
cd sdk
npm run build
npm pack --dry-run     # exactly which files ship (dist/, package.json, README)
npm publish --dry-run  # full publish flow without touching the registry
```
