#!/usr/bin/env node
// Prints a Markdown table row from a Vitest json-summary coverage report.
// Usage: node coverage-summary.mjs <label> <coverage-summary.json>
import { readFileSync } from 'node:fs';

const [label, file] = process.argv.slice(2);
const { total } = JSON.parse(readFileSync(file, 'utf8'));
const pct = (metric) => `${total[metric].pct}%`;
console.log(`| ${label} | ${pct('lines')} lines | ${pct('branches')} branches | ${pct('functions')} functions | ${pct('statements')} statements |`);
