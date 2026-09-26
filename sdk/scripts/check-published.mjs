// Preflight for `npm publish`.
//
// npm will not let one account overwrite another's package, so the failure
// this script exists to catch is *ours*: re-releasing a version that is
// already on the registry (npm refuses it), or shipping under a name someone
// else owns. It prints the scope status either way, so a rename happens
// before a release is tagged rather than after it fails in CI.
//
// Run with `npm run check:publish`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;
const registry = process.env.npm_config_registry || 'https://registry.npmjs.org';

const encoded = name.replace('/', '%2f');
const response = await fetch(`${registry}/${encoded}`, {
  headers: { accept: 'application/json' },
});

if (response.status === 404) {
  console.log(`check:publish ${name}@${version} — name is unpublished, free to take.`);
  process.exit(0);
}

if (!response.ok) {
  console.error(`check:publish registry responded ${response.status} for ${name}`);
  process.exit(1);
}

const packument = await response.json();
const maintainers = (packument.maintainers ?? []).map(entry => entry.name).join(', ') || 'unknown';

if (packument.versions?.[version]) {
  console.error(
    `check:publish ${name}@${version} is already published (maintainers: ${maintainers}).\n` +
      'Bump sdk/package.json before releasing — npm does not allow republishing a version.',
  );
  process.exit(1);
}

console.log(
  `check:publish ${name}@${version} — name is in use by an earlier release ` +
    `(maintainers: ${maintainers}); this version is new. Double-check those maintainers are you.`,
);

// Report whether the scope itself has been claimed, so an unowned scope is
// caught here instead of as a 403 halfway through the first release.
const scope = name.startsWith('@') ? name.slice(1).split('/')[0] : null;
if (scope) {
  const scopeResponse = await fetch(`${registry}/-/org/${scope}/user`);
  if (scopeResponse.status === 404) {
    console.warn(
      `check:publish the "@${scope}" scope is not claimed yet — create it (npmjs.com/org/create) ` +
        'before the first release, or rename the package.',
    );
  } else {
    console.log(`check:publish scope "@${scope}" exists on the registry (HTTP ${scopeResponse.status}).`);
  }
}
