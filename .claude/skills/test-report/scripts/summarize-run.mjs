#!/usr/bin/env node
// Extracts audit metadata from a Claude Code execution log (JSON array of SDK
// messages): turns, duration, cost, tool usage and — from actual tool calls,
// not the agent's self-report — which skills were invoked.
//
// Usage: node summarize-run.mjs --execution-file file.json [--json-out file]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isMain, parseArgs } from '../../../test-agent/lib/args.mjs';

export function summarizeRun(messages) {
  const tools = {};
  const skills = new Set();
  const bash = [];
  let denied = 0;
  let model = null;
  let result = null;
  for (const message of messages) {
    if (message.type === 'system' && message.subtype === 'init') model = message.model ?? model;
    if (message.type === 'result') result = message;
    if (message.type === 'user') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'tool_result' && block.is_error && /permission|denied|not allowed|blocked/i.test(JSON.stringify(block.content ?? ''))) denied++;
      }
    }
    if (message.type !== 'assistant') continue;
    for (const block of message.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      tools[block.name] = (tools[block.name] ?? 0) + 1;
      if (block.name === 'Skill' && block.input?.skill) skills.add(String(block.input.skill));
      if (block.name === 'Bash' && block.input?.command) bash.push(String(block.input.command).slice(0, 200));
    }
  }
  return {
    model,
    turns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? null,
    costUsd: result?.total_cost_usd ?? null,
    isError: result?.is_error ?? null,
    stopReason: result?.subtype ?? null,
    skillsInvoked: [...skills],
    toolCalls: tools,
    deniedToolCalls: denied,
    commands: bash.slice(0, 50),
  };
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args['execution-file']) {
    console.error('Usage: summarize-run.mjs --execution-file file.json [--json-out file]');
    process.exit(2);
  }
  const summary = summarizeRun(JSON.parse(readFileSync(args['execution-file'], 'utf8')));
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(summary, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
}
