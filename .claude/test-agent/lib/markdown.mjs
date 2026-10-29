// Agent-authored text is untrusted: it is derived from PR content and may carry
// injected markup. Neutralize HTML, links/images, mentions and table breaks.
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');
const ZERO_WIDTH_SPACE = '​';

export function sanitizeInline(value, max = 300) {
  let text = String(value ?? '').replace(INVISIBLE, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([[\]!|*_~`\\])/g, '\\$1')
    .replace(/@(?=\w)/g, `@${ZERO_WIDTH_SPACE}`)
    .replace(/#(?=\d)/g, `#${ZERO_WIDTH_SPACE}`)
    .replace(/(https?):\/\//gi, '$1&#58;//');
}

export function code(value, max = 120) {
  const text = String(value ?? '').replace(/[`\n\r]/g, '').replace(/\|/g, '\\|').slice(0, max);
  return `\`${text}\``;
}
