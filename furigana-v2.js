const KANJI = /[\u3400-\u9fff々〆ヶ﨑髙𠮷]/u;
const HIRAGANA = /^[\u3040-\u309fー]+$/u;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function validParts(text, parts) {
  if (!Array.isArray(parts) || parts.map(part => part[0]).join('') !== text) return false;
  return parts.every(part => Array.isArray(part) && part.length === 2
    && typeof part[0] === 'string'
    && (part[1] === null || (typeof part[1] === 'string' && HIRAGANA.test(part[1])))
    && (!KANJI.test(part[0]) || part[1] !== null));
}

export function validateFurigana(questions, data) {
  if (!data || typeof data.texts !== 'object' || typeof data.terms !== 'object') throw new Error('Furigana data missing');
  const sourceStrings = new Set();
  for (const q of questions) {
    for (const key of ['section', 'category', 'question', 'source', 'explanation']) sourceStrings.add(q[key]);
    for (const choice of q.choices) sourceStrings.add(choice);
  }
  for (const text of sourceStrings) {
    if (!validParts(text, data.texts[text])) throw new Error('Invalid furigana for question text: ' + text.slice(0, 30));
  }
  for (const [text, parts] of Object.entries(data.texts)) {
    if (!validParts(text, parts)) throw new Error('Invalid furigana text: ' + text.slice(0, 30));
  }
  for (const [term, parts] of Object.entries(data.terms)) {
    if (!validParts(term, parts)) throw new Error('Invalid furigana term: ' + term);
  }
  return { strings: sourceStrings.size, readings: Object.values(data.texts).reduce((n, parts) => n + parts.filter(part => part[1]).length, 0) };
}

export function createFuriganaRenderer(data) {
  const terms = Object.entries(data.terms).sort((a, b) => b[0].length - a[0].length);
  const termsByFirst = new Map();
  for (const entry of terms) {
    const first = entry[0][0];
    if (!termsByFirst.has(first)) termsByFirst.set(first, []);
    termsByFirst.get(first).push(entry);
  }
  const unknown = new Set();

  function partsFor(text) {
    if (data.texts[text]) return data.texts[text];
    const parts = [];
    let pos = 0;
    while (pos < text.length) {
      const match = termsByFirst.get(text[pos])?.find(([term]) => text.startsWith(term, pos));
      if (match) {
        parts.push(...match[1]);
        pos += match[0].length;
      } else {
        if (KANJI.test(text[pos])) unknown.add(text[pos]);
        parts.push([text[pos++], null]);
      }
    }
    return parts;
  }

  function markup(text) {
    return partsFor(String(text)).map(([base, reading]) => reading === null
      ? escapeHtml(base)
      : `<ruby>${escapeHtml(base)}<rt>${escapeHtml(reading)}</rt></ruby>`).join('');
  }

  function decorate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node; node = walker.nextNode();) {
      if (!KANJI.test(node.nodeValue)) continue;
      if (node.parentElement?.closest('ruby,rt,rp,script,style,template,option,textarea')) continue;
      nodes.push(node);
    }
    for (const node of nodes) {
      const parts = partsFor(node.nodeValue);
      if (!parts.some(part => part[1] !== null)) continue;
      const frag = document.createDocumentFragment();
      for (const [base, reading] of parts) {
        if (reading === null) frag.append(document.createTextNode(base));
        else {
          const ruby = document.createElement('ruby');
          ruby.append(document.createTextNode(base));
          const rt = document.createElement('rt');
          rt.textContent = reading;
          ruby.append(rt);
          frag.append(ruby);
        }
      }
      node.replaceWith(frag);
    }
  }

  return { markup, decorate, unknown };
}
