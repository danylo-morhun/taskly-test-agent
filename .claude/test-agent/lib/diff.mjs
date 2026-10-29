// Parsers for `git diff` output.

/** Parses `git diff --name-status -M` output into [{ status, path, previousPath? }]. */
export function parseNameStatus(output) {
  return output.split('\n').filter(Boolean).map((line) => {
    const [code, first, second] = line.split('\t');
    const status = code[0];
    if (status === 'R' || status === 'C') return { status, path: second, previousPath: first };
    return { status, path: first };
  });
}

/** Parses `git diff -U0` output into Map<path, number[]> of added/changed line numbers in the new file. */
export function parseAddedLines(output) {
  const result = new Map();
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      current = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (current && !result.has(current)) result.set(current, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) result.get(current).push(n);
    }
  }
  return result;
}

/** Collapses sorted line numbers into inclusive [start, end] ranges. */
export function toRanges(lines) {
  const ranges = [];
  for (const line of [...lines].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line <= last[1] + 1) last[1] = Math.max(last[1], line);
    else ranges.push([line, line]);
  }
  return ranges;
}
