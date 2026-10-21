# Dependency Updates

How this repository keeps its dependencies up to date, and why the answer is
Renovate rather than Dependabot.

Issue #301 asked for an evaluation of Renovate as an alternative or a
complement to the Dependabot configuration that was added in #172.

**Decision: adopt Renovate and remove the Dependabot configuration.**

The change replaces [`.github/dependabot.yml`](../.github/dependabot.yml) with
[`renovate.json`](../renovate.json) and
[`.github/workflows/renovate.yml`](../.github/workflows/renovate.yml).

---

## What we compare

| | Dependabot | Renovate |
|---|---|---|
| Configuration | `.github/dependabot.yml` | `renovate.json` (+ a workflow that runs it) |
| Runs on | GitHub's own infrastructure | A GitHub Actions workflow in this repository |
| Grouping | `groups.<id>.patterns` / `exclude-patterns` / `update-types` | `packageRules` with `groupName`, matched on manager, package name, file path and update type |
| Cross-directory grouping | `group-by: dependency-name` (same ecosystem only) | One rule set across every ecosystem and directory |
| Cross-ecosystem grouping | `multi-ecosystem-groups` | One `packageRules` entry, no ecosystem restriction |
| Scheduling | `schedule.interval` + `schedule.day` / `schedule.time` | `schedule` per rule, in natural language, with a `timezone` |
| Release-age guard | `cooldown` (3 days by default) | `minimumReleaseAge` (set to 3 days here) |
| Changelog | Release notes link per PR | Release notes link per PR, plus `mergeConfidence` badges and `replacements` |
| Dependency dashboard | No | Yes (`dependencyDashboard`) |
| Cost | Free | Free (self-hosted via the official action) |

### The issue's premise is partly out of date

#301 was written when Dependabot's grouping support was young. Dependabot v2
today does support grouped updates — `groups.<id>.patterns`,
`groups.<id>.exclude-patterns`, `groups.<id>.update-types`,
`groups.<id>.group-by` and `multi-ecosystem-groups` are all documented — and
it also covers the `pip`, `devcontainers` and `docker-compose` ecosystems that
the old configuration did not. The old `dependabot.yml` therefore was not as
limited as the issue assumed.

What Dependabot still does not do is what made us switch:

1. **One rule set for the whole repository.** Dependabot groups are declared
   *inside* a `package-ecosystem` entry, so a rule that says "batch every
   `@stellar/*` package" has to be repeated for `npm` in `/sdk` and again for
   `npm` in `/frontend`, and it still cannot reach across ecosystems. In
   Renovate a `packageRules` entry is global: the same rule matches
   `@stellar/*` wherever it is declared.
2. **Matching on the file path.** Dependabot groups by dependency name only.
   Renovate matches on `matchFileNames`, which is how `sdk/package.json` and
   `frontend/package.json` get separate groups while still sharing the
   `@stellar/*` group.
3. **Per-rule schedules.** Dependabot schedules per ecosystem entry, so
   "GitHub Actions monthly, code weekly" means two separate entries.
   Renovate schedules per rule, so the cadence can differ per group inside
   one ecosystem.
4. **A dependency dashboard.** Renovate opens one issue listing every pending
   update, so a reviewer can see the whole backlog instead of a queue of
   half-open pull requests.
5. **Changelog quality.** Both tools link the upstream release notes, but
   Renovate additionally surfaces a merge-confidence badge on each PR and
   flags dependency *replacements* (a package that has been renamed or moved),
   which Dependabot does not report.

### Where Dependabot is genuinely better

Dependabot runs on GitHub's infrastructure, so it needs no token, no
maintenance and no CI minutes, and its pull requests are pre-authorised to
run CI. Renovate needs a workflow and a token (see
[Running Renovate](#running-renovate) below), and that is the main cost of
the switch.

We still keep the schedule tight — one weekly run — so the operational burden
is a single workflow that mostly sleeps.

---

## The configuration

[`renovate.json`](../renovate.json) is the whole configuration. The parts
worth knowing about:

### Grouping

| Group | Matches | Update types | PR title |
|---|---|---|---|
| `stellar packages` | `@stellar/*` in any npm manifest | minor, patch, pin | `chore(deps): …` |
| `sdk dependencies` | `sdk/package.json` | minor, patch, pin | `chore(sdk): …` |
| `frontend dependencies` | `frontend/package.json` | minor, patch, pin | `chore(frontend): …` |
| `cargo dependencies` | `contracts/Cargo.toml` | minor, patch, pin | `chore(contracts): …` |
| `python dependencies` | `sdk/python/pyproject.toml` | minor, patch, pin | `chore(sdk): …` |
| `github actions` | every `uses:` in `.github/workflows/` | all | `chore(ci): …` |
| `container images` | devcontainer, Dockerfile and Compose images | all | `chore(ci): …` |

The `@stellar/*` rule is deliberately listed *after* the `sdk` and `frontend`
rules: Renovate applies `packageRules` in order and the last matching rule
wins, so the Stellar packages leave their per-project groups and land in
their own batch. That is the grouping #301 asked for — the Stellar SDK and
the Freighter API are released by the same team and should be reviewed
together, not in two unrelated pull requests.

**Major updates are never grouped.** Every group rule lists its update types
explicitly and omits `major`. A major bump of `@stellar/stellar-sdk` changes
the wire format the SDK builds against, and a major bump of `next` changes
the build; both deserve a pull request of their own with a migration note,
not a line in a batch. This keeps the policy the old Dependabot configuration
had ("Minor and patch bumps are grouped per ecosystem … major bumps stay
individual").

The one exception is GitHub Actions, where all update types are grouped. That
mirrors the old Dependabot configuration, which grouped every action into a
single pull request, and it is the right trade-off there: action releases
break CI in ways that are much easier to diagnose with the whole set visible
at once.

### Scheduling

| What | When |
|---|---|
| Everything else | Weekly, Monday 04:00 UTC |
| GitHub Actions | Monthly, 1st of the month 04:00 UTC |
| Container images | Monthly, 1st of the month 04:00 UTC |
| Lock file maintenance | Weekly, Monday 04:00 UTC |
| Security advisories | Immediately, any time |

The schedule lives in `renovate.json`; the workflow cron in
`.github/workflows/renovate.yml` only decides when Renovate *runs* and has to
stay in step with it.

`minimumReleaseAge` is set to three days. A version published less than three
days ago is left alone until it has been out long enough to be picked up by
the ecosystem's own release monitoring. Security advisories opt out of that
wait — they are created immediately.

### Things Renovate is told to leave alone

- The root `package.json` is disabled. It declares no dependencies and has no
  lockfile; leaving it enabled would make Renovate create a
  `package-lock.json` for it on the first run.
- `frontend/package.json`'s `"@quorum/sdk": "file:../sdk"` is a local path
  dependency. Renovate ignores `file:` specs, so the SDK is always built from
  the working tree.
- The `soroban-sdk` version in `contracts/Cargo.toml` is not rewritten. Cargo
  uses `update-lockfile` as its default range strategy, so a crate bump
  changes `contracts/Cargo.lock` and leaves the manifest requirement alone.

### Commit and PR titles

Renovate writes Conventional Commits, and the scope matches the repository
layout that `CONTRIBUTING.md` and the commit-lint workflow expect:

```
chore(sdk): update SDK dependencies
chore(frontend): update frontend dependencies
chore(contracts): update cargo dependencies
chore(ci): update github actions
chore(deps): update stellar packages
```

Anything that does not fall into a group falls back to the `deps` scope.

---

## Running Renovate

### The workflow

[`.github/workflows/renovate.yml`](../.github/workflows/renovate.yml) runs
Renovate every Monday at 04:00 UTC and on demand via *Actions → Renovate →
Run workflow*.

### The token

The workflow uses `secrets.RENOVATE_TOKEN` and falls back to the built-in
`GITHUB_TOKEN` when the secret is absent. The fallback works, but it has two
limitations that a repository secret avoids:

1. **`GITHUB_TOKEN` cannot update workflow files.** GitHub forbids it from
   pushing changes to `.github/workflows/`, so the `github actions` group
   stays empty unless a personal access token is configured.
2. **Pull requests opened with `GITHUB_TOKEN` do not trigger CI on their own.**
   Workflows triggered by `GITHUB_TOKEN` are deliberately suppressed to avoid
   recursive runs, so a Renovate pull request would sit without a CI run until
   someone approves it manually.

To enable both, add a repository secret named `RENOVATE_TOKEN` holding a
classic personal access token with the `repo` and `workflow` scopes. The
`workflow` scope is what allows Renovate to bump the `uses:` pins in the
workflow files.

Renovate does not need write access to anything except this repository.

### The dependency dashboard

Renovate opens (or updates) a **Dependency Dashboard** issue listing every
pending update, grouped by what it is waiting for. It is the place to look
before deciding to merge a batch, and the place to find updates that have
been sitting unmerged for too long.

### Running Renovate locally

Renovate can check the configuration without touching the repository:

```bash
npx --yes --package renovate@44 renovate-config-validator renovate.json
```

To see what it *would* do — every dependency it found, every branch it would
create and every pull request title it would use:

```bash
npx --yes --package renovate@44 renovate --dry-run=full
```

Renovate 44 needs Node 24.11 or newer. Point it at the repository with
`--repository` if it is not run from the repository root.

---

## Adding a new ecosystem

1. Add the manager to `packageRules` in [`renovate.json`](../renovate.json),
   with a `matchManagers` entry and a `groupName`.
2. Check the manager name against the
   [Renovate configuration options](https://docs.renovatebot.com/configuration-options/#enabledmanagers)
   — the list is the `enabledManagers` enum, and the names are not always
   obvious (`poetry` covers PEP 621 `pyproject.toml` files because it
   supersedes the `pep621` manager, `github-actions` covers `uses:` pins,
   `dockerfile` covers `Dockerfile` and `Containerfile`).
3. Run the config validator and a local dry run before opening a pull request.

## Reverting to Dependabot

If Renovate turns out to be the wrong call, delete `renovate.json` and
`.github/workflows/renovate.yml` and restore `.github/dependabot.yml` from
git history. Nothing else in the repository depends on either file. Keep only
one of the two configurations in place: running both produces duplicate
pull requests for the same dependency.
