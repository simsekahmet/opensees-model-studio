/**
 * codegen/notebook.js — wraps the generated script as a Jupyter notebook.
 *
 * The script already carries banner comments marking its sections, so the
 * split is exact: every banner becomes a markdown heading and the code that
 * follows it becomes one code cell. Nothing is rewritten — the notebook and
 * the `.py` contain the same statements in the same order, which is what lets
 * the `.py` stay the artefact the verification suite runs.
 */

/** A banner block is three lines: a rule, the title, another rule. */
const RULE = /^#\s*[═]{10,}\s*$/;

export function toNotebook(script, { title = 'Frame Model' } = {}) {
  const lines = script.split('\n');
  const cells = [];

  const { docstring, rest } = takeDocstring(lines);
  if (docstring.length) cells.push(markdown(docstringToMarkdown(docstring, title)));

  let heading = null;
  let body = [];

  const flush = () => {
    const code = trimBlank(body);
    if (heading) cells.push(markdown([`## ${heading}`]));
    if (code.length) cells.push(codeCell(code));
    heading = null;
    body = [];
  };

  for (let i = 0; i < rest.length; i++) {
    // A banner is a rule, a "#  Title" line, then another rule.
    if (RULE.test(rest[i]) && RULE.test(rest[i + 2] ?? '')) {
      flush();
      heading = (rest[i + 1] || '').replace(/^#\s*/, '').trim();
      i += 2;
      continue;
    }
    body.push(rest[i]);
  }
  flush();

  // ops.wipe() at the very end would throw the model away the moment it is
  // built, so it gets its own cell rather than closing the analysis one.
  splitTrailingWipe(cells);

  return JSON.stringify({
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', file_extension: '.py', mimetype: 'text/x-python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 1);
}

/* ─────────────────────────────── helpers ────────────────────────────── */

/** Pulls the leading triple-quoted docstring off the script. */
function takeDocstring(lines) {
  if (lines[0]?.trim() !== '"""') return { docstring: [], rest: lines };
  const end = lines.indexOf('"""', 1);
  if (end < 0) return { docstring: [], rest: lines };
  return { docstring: lines.slice(1, end), rest: lines.slice(end + 1) };
}

/** First line becomes the notebook title; the rest is kept verbatim. */
function docstringToMarkdown(doc, fallback) {
  const body = trimBlank(doc);
  const first = body.shift() || fallback;
  // Two trailing spaces keep the summary's line breaks in markdown.
  return [`# ${first}`, '', ...trimBlank(body).map((l) => (l.trim() ? `${l}  ` : ''))];
}

function splitTrailingWipe(cells) {
  const last = cells[cells.length - 1];
  if (!last || last.cell_type !== 'code') return;

  const code = last.source.map((l) => l.replace(/\n$/, ''));
  const at = code.lastIndexOf('ops.wipe()');
  if (at < 0 || at !== code.length - 1) return;

  code.pop();
  last.source = toSource(trimBlank(code));
  cells.push(markdown(['## Cleanup']), codeCell(['ops.wipe()']));
}

const markdown = (source) => ({ cell_type: 'markdown', metadata: {}, source: toSource(source) });

const codeCell = (source) => ({
  cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: toSource(source),
});

/** Notebook cells store one string per line, each keeping its newline. */
function toSource(lines) {
  return lines.map((l, i) => (i === lines.length - 1 ? l : `${l}\n`));
}

function trimBlank(lines) {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}
