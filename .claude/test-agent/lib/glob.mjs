// Minimal, dependency-free glob matcher for repo-relative POSIX paths.
// Supports `**`, `*`, `?` and `{a,b}` alternation — enough for path policies.

const cache = new Map();

export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let source = '';
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        // `**/` matches zero or more directories; a trailing `**` matches anything.
        source += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') source += '[^/]';
    else if (char === '{') { source += '(?:'; inGroup = true; }
    else if (char === '}' && inGroup) { source += ')'; inGroup = false; }
    else if (char === ',' && inGroup) source += '|';
    else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`^${source}$`);
  cache.set(glob, regex);
  return regex;
}

export function matchesAny(path, globs = []) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
