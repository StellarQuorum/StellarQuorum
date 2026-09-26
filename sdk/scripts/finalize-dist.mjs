// Marks each build output with the module format Node should read it as.
//
// The package root has no `"type"` field, so Node would treat every `.js` file
// as CommonJS — including dist/esm, which would then fail to load with
// ERR_REQUIRE_ESM. The marker packages fix that without forcing a format on
// the whole package.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [dir, type] of Object.entries({ 'dist/cjs': 'commonjs', 'dist/esm': 'module' })) {
  const target = join(root, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
