#!/usr/bin/env node
// Validates the agent's report against report.schema.json and cross-checks it
// with the change detection result: one decision per changed source file.
//
// Usage: node validate-report.mjs --report .test-agent/report.json [--detect .test-agent/detect.json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs } from '../../../test-agent/lib/args.mjs';
import { validate } from '../../../test-agent/lib/schema.mjs';

const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../report.schema.json'), 'utf8'));

export function validateReport(report, detect) {
  const errors = validate(schema, report);
  if (errors.length || !detect) return errors;
  const decided = new Set(report.decisions.map((d) => d.file));
  const expected = [...(detect.sources ?? []).map((s) => s.path), ...(detect.omitted ?? [])];
  for (const file of expected) if (!decided.has(file)) errors.push(`$.decisions: missing a decision for ${file}`);
  for (const file of decided) if (!expected.includes(file)) errors.push(`$.decisions: ${file} is not a changed source file in detect.json`);
  const seen = new Set();
  for (const d of report.decisions) {
    if (seen.has(d.file)) errors.push(`$.decisions: duplicate decision for ${d.file}`);
    seen.add(d.file);
    if ((d.action === 'added_tests' || d.action === 'updated_tests') && !d.testFiles.length) {
      errors.push(`$.decisions[${d.file}]: ${d.action} requires testFiles`);
    }
  }
  return errors;
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.report) {
    console.error('Usage: validate-report.mjs --report <file> [--detect <file>]');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(args.report, 'utf8'));
  } catch (error) {
    console.log(`INVALID ${args.report}: not readable JSON (${error.message})`);
    process.exit(1);
  }
  const detect = args.detect && existsSync(args.detect) ? JSON.parse(readFileSync(args.detect, 'utf8')) : null;
  const errors = validateReport(report, detect);
  if (errors.length) {
    console.log(`INVALID ${args.report}:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`VALID ${args.report}`);
}
