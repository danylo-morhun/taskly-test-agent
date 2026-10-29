// Tiny `--key value` / `--flag` argument parser.
export function parseArgs(argv = process.argv.slice(2), { booleans = [] } = {}) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const [key, inline] = token.slice(2).split(/=(.*)/s);
    if (inline !== undefined) args[key] = inline;
    else if (booleans.includes(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

export function list(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module at `url` is the script Node was invoked with. */
export function isMain(url) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === url;
  } catch {
    return false;
  }
}
