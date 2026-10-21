#!/usr/bin/env node
/**
 * Adds release artifacts to a CycloneDX SBOM (issue #302).
 *
 * Syft builds the dependency tree — the crates in `contracts/Cargo.lock` and
 * the npm packages in `sdk/package-lock.json` — but it does not catalog the
 * compiled `.wasm` artifacts: a Soroban contract carries no package metadata
 * inside it. This script adds every artifact it is given as a CycloneDX
 * `file` component with its SHA-256, so the SBOM names the exact bytes the
 * dependency list was generated for and an integrator can check that the
 * `.wasm` they downloaded is the one this document describes.
 *
 * Usage:
 *   node scripts/sbom-add-artifacts.mjs <sbom.json> <artifact> [artifact...]
 *
 * The SBOM is rewritten in place. The script fails (non-zero exit) if the
 * document is not a CycloneDX SBOM, so a malformed file cannot be attached to
 * a release as if it were valid.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * SHA-256 of a file, hex encoded.
 *
 * @param {string} file Path to the file to hash.
 * @returns {string} Hex digest.
 */
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function main() {
  const [sbomPath, ...artifacts] = process.argv.slice(2);

  if (!sbomPath || artifacts.length === 0) {
    console.error("usage: sbom-add-artifacts.mjs <sbom.json> <artifact> [artifact...]");
    process.exit(2);
  }

  let sbom;
  try {
    sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  } catch (error) {
    console.error(`sbom-add-artifacts: cannot read ${sbomPath}: ${error.message}`);
    process.exit(2);
  }

  if (sbom.bomFormat !== "CycloneDX") {
    console.error(`sbom-add-artifacts: ${sbomPath} is not a CycloneDX document (bomFormat: ${String(sbom.bomFormat)})`);
    process.exit(1);
  }
  if (!Array.isArray(sbom.components)) {
    console.error(`sbom-add-artifacts: ${sbomPath} has no components array`);
    process.exit(1);
  }

  const existing = new Set(sbom.components.map(component => component["bom-ref"]));

  for (const artifact of artifacts) {
    let size;
    try {
      size = statSync(artifact).size;
    } catch (error) {
      console.error(`sbom-add-artifacts: cannot stat ${artifact}: ${error.message}`);
      process.exit(2);
    }

    const name = path.basename(artifact);
    const digest = sha256(artifact);
    const bomRef = `file:${name}`;
    if (existing.has(bomRef)) {
      console.log(`sbom-add-artifacts: ${name} is already in the SBOM, skipping`);
      continue;
    }
    existing.add(bomRef);

    sbom.components.push({
      type: "file",
      "bom-ref": bomRef,
      name,
      // The digest doubles as the version: two artifacts with the same name
      // but different bytes are different versions of the same file.
      version: digest.slice(0, 12),
      hashes: [{ alg: "SHA-256", content: digest }],
      properties: [
        { name: "quorum:artifact:path", value: artifact },
        { name: "quorum:artifact:size", value: String(size) },
      ],
    });

    console.log(`sbom-add-artifacts: added ${name} (${size} bytes, sha256 ${digest})`);
  }

  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);
}

main();
