#!/usr/bin/env node
// Issue #275: a machine-readable description of QuorumClient's public methods
// and the GovernanceError / TokenError codes, for bindings and docs written in
// other languages. It is generated from the TypeScript source, so it cannot
// drift silently:
//
//   node scripts/generate-client-spec.mjs          rewrite spec/quorum-client.spec.json
//   node scripts/generate-client-spec.mjs --check  fail if the committed spec is stale
//
// CI runs --check. It also fails when the README's SDK Reference calls a client
// method that the spec does not list.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import path from 'node:path';
import ts from 'typescript';

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(sdkRoot, 'spec', 'quorum-client.spec.json');
const README_PATH = path.join(sdkRoot, '..', 'README.md');
const SOURCES = { client: 'src/client.ts', errors: 'src/errors.ts' };
const CLIENT_CLASS = 'QuorumClient';
const ERROR_ENUMS = ['GovernanceError', 'TokenError'];

function parse(relativePath) {
  const fullPath = path.join(sdkRoot, relativePath);
  return ts.createSourceFile(fullPath, readFileSync(fullPath, 'utf8'), ts.ScriptTarget.Latest, true);
}

// The type as written in the source, with line breaks folded so a multi-line
// signature gives the same text as a one-line one.
function typeText(node, sourceFile, fallback) {
  return node ? node.getText(sourceFile).replace(/\s+/g, ' ').trim() : fallback;
}

function hasModifier(node, kind) {
  return (node.modifiers ?? []).some(modifier => modifier.kind === kind);
}

function describeMethods(sourceFile) {
  const methods = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== CLIENT_CLASS) continue;
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) continue;
      methods.push({
        name: member.name.getText(sourceFile),
        parameters: member.parameters.map(parameter => ({
          name: parameter.name.getText(sourceFile),
          type: typeText(parameter.type, sourceFile, 'any'),
          optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
          rest: parameter.dotDotDotToken !== undefined,
        })),
        returns: typeText(member.type, sourceFile, 'unknown'),
      });
    }
  }
  return methods;
}

function describeErrors(sourceFile) {
  const enums = {};
  for (const statement of sourceFile.statements) {
    if (!ts.isEnumDeclaration(statement) || !ERROR_ENUMS.includes(statement.name.text)) continue;
    enums[statement.name.text] = Object.fromEntries(statement.members.map(member => [
      member.name.getText(sourceFile),
      Number(member.initializer?.getText(sourceFile)),
    ]));
  }
  return enums;
}

// Client methods the README's SDK Reference shows in use, e.g. `client.getVote(...)`.
function readmeClientCalls() {
  const readme = readFileSync(README_PATH, 'utf8');
  const start = readme.indexOf('## SDK Reference');
  const end = readme.indexOf('## Frontend data source');
  if (start === -1 || end === -1) throw new Error('README.md: SDK Reference section not found');
  const section = readme.slice(start, end);
  return [...new Set([...section.matchAll(/\bclient\.(\w+)\(/g)].map(match => match[1]))];
}

function buildSpec() {
  const methods = describeMethods(parse(SOURCES.client));
  const enums = describeErrors(parse(SOURCES.errors));
  if (methods.length === 0) throw new Error(`${SOURCES.client}: no public methods found on ${CLIENT_CLASS}`);
  for (const name of ERROR_ENUMS) {
    if (!enums[name]) throw new Error(`${SOURCES.errors}: enum ${name} not found`);
  }
  return { generatedFrom: Object.values(SOURCES), client: CLIENT_CLASS, methods, errors: enums };
}

function findProblems(spec) {
  const problems = [];
  let committed;
  try {
    committed = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  } catch (error) {
    problems.push(`spec/quorum-client.spec.json: ${error.message}`);
  }
  if (committed !== undefined) {
    try {
      deepStrictEqual(committed, spec);
    } catch {
      problems.push('spec/quorum-client.spec.json is stale: run `npm run spec` and commit the result');
    }
  }
  const listed = new Set(spec.methods.map(method => method.name));
  for (const name of readmeClientCalls()) {
    if (!listed.has(name)) problems.push(`README.md documents client.${name}() but ${CLIENT_CLASS} has no public method ${name}`);
  }
  return problems;
}

const spec = buildSpec();

if (process.argv.includes('--check')) {
  const problems = findProblems(spec);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`spec/quorum-client.spec.json is current: ${spec.methods.length} methods, ${ERROR_ENUMS.length} error enums`);
} else {
  mkdirSync(path.dirname(SPEC_PATH), { recursive: true });
  writeFileSync(SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote spec/quorum-client.spec.json: ${spec.methods.length} methods, ${ERROR_ENUMS.length} error enums`);
}
