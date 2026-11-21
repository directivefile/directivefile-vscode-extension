// printer.js — the two stages between tokens and a prettier Doc.
//
//   tokens ──buildTree──▶ directive tree ──buildDoc──▶ Doc
//
// Neither stage knows printWidth or tabWidth. Width only enters when
// printDocToString turns a Doc into a string.
//
// The tree records facts about the source (who nests in whom, where a line was
// continued, where a comment sat, how many blank lines) and holds no layout
// decisions. Every node can report a [start, stop] span, either through the
// tokens it holds or, for blank lines, through its own offsets.

import { builders } from "prettier/doc";

const { align, fill, indent, line, hardline, ifBreak, lineSuffix } = builders;

/**
 * @typedef {Object} Token  a value returned by tokenize()
 * @property {string} name    "UNQUOTED_TOKEN" | "DOUBLE_QUOTED_TOKEN" | "NEWLINE" | ...
 * @property {string} text    raw source text: quotes kept, escapes not decoded
 * @property {number} line    1-based
 * @property {number} column  1-based
 * @property {number} start   0-based offset, inclusive
 * @property {number} stop    0-based offset, inclusive
 * @property {boolean} hidden
 */

/**
 * A parameter together with the gap that precedes it.
 *
 * @typedef {Object} Param
 * @property {Token} token
 * @property {boolean} breakBefore  the source had a line continuation before this
 *   parameter. A fact about the original file, not a layout decision — buildDoc
 *   decides whether to honour it.
 */

/**
 * @typedef {Object} BlockNode
 * @property {Token} openBrace
 * @property {boolean} openBraceBreakBefore  `cmd p \` + newline + `{`: the brace
 *   itself started a new physical line
 * @property {Array<DirectiveNode | CommentNode | BlankNode>} body
 * @property {Token | null} closeBrace  null while the block is unclosed
 * @property {Token | null} closeComment  comment on the closing brace line
 */

/**
 * @typedef {Object} DirectiveNode
 * @property {"directive"} type
 * @property {Token} name
 * @property {Param[]} params   order preserved, never reordered
 * @property {BlockNode | null} block
 * @property {Token | null} trailingComment
 */

/**
 * @typedef {Object} CommentNode  a comment occupying its own line
 * @property {"comment"} type
 * @property {Token} token
 */

/**
 * Empty line(s), collapsed but counted. Carries its own span because a blank
 * line is not a token, and every node must be able to report [start, stop] —
 * range formatting and diagnostics both rely on that.
 *
 * @typedef {Object} BlankNode
 * @property {"blank"} type
 * @property {number} count   empty lines in the source, >= 1
 * @property {number} start   0-based offset where the gap begins
 * @property {number} stop    0-based offset where the gap ends, inclusive
 */

/**
 * @typedef {Object} FileNode
 * @property {"file"} type
 * @property {Array<DirectiveNode | CommentNode | BlankNode>} body
 */

/**
 * @typedef {Object} Diagnostic
 * @property {"error"} severity
 * @property {string} code     "lexer" | "unclosed-block" | "unexpected-close-brace"
 *                             | "empty-block" | "brace-inside-directive" | "invalid-name"
 * @property {string} message  human readable, no position inside it
 * @property {number} line
 * @property {number} column
 * @property {number} start
 * @property {number} stop
 */

/**
 * Turn a directive tree into a prettier Doc.
 *
 * This is where layout intent lives: which gaps may break, how deep
 * continuation lines indent, what must always break. The result is not a
 * string — printDocToString decides the actual line breaks from printWidth.
 *
 * @param {FileNode} tree
 * @param {{ maxBlankLines?: number }} [options]  blank lines kept per gap, default 1
 * @returns {import("prettier").Doc}
 */
export function buildDoc(tree, options) {
  const maxBlankLines = options?.maxBlankLines ?? 1;
  const body = printBody(tree.body, maxBlankLines, false);
  // A file that formats to nothing stays nothing; otherwise it ends with exactly
  // one newline, which the last hardline provides.
  return body.length === 0 ? "" : [body, hardline];
}

/**
 * Turn a token array into a directive tree.
 *
 * Structure only: every field is a token or a nesting, no ranges, no depths, no
 * widths — those are computed by whoever needs them. Never throws and never
 * drops the whole tree: an unclosed block keeps `closeBrace: null` so the editor
 * still has something to work with while the user is typing.
 *
 * @param {Token[]} tokens  full stream from tokenize(), hidden tokens included
 * @returns {{ tree: FileNode, errors: Diagnostic[] }}
 */
export function buildTree(tokens) {
  const errors = [];
  const root = { type: "file", body: [] };

  let body = root.body;
  const open = [];

  const fail = (code, token, message) => {
    errors.push({
      severity: "error",
      code,
      message,
      line: token.line,
      column: token.column,
      start: token.start,
      stop: token.stop,
    });
  };

  for (const line of splitLines(tokens)) {
    if (line.kind === "blank") {
      body.push({
        type: "blank",
        count: line.count,
        start: line.start,
        stop: line.stop,
      });
      continue;
    }

    const { words } = line;

    if (words.length === 0) {
      body.push({ type: "comment", token: line.comment });
      continue;
    }

    const nameToken = words[0].token;

    // A closing brace creates no node of its own: it completes the open block.
    if (words.length === 1 && nameToken.text === "}") {
      const frame = open.pop();
      if (frame === undefined) {
        fail(
          "unexpected-close-brace",
          nameToken,
          "closing brace without an open block",
        );
        continue;
      }
      frame.block.closeBrace = nameToken;
      frame.block.closeComment = line.comment;
      body = frame.parentBody;
      if (!frame.block.body.some((item) => item.type === "directive")) {
        fail("empty-block", nameToken, "block must contain at least one directive");
      }
      continue;
    }

    // A block hangs from a directive; a lone "{" has nothing to hang from.
    if (words.length === 1 && nameToken.text === "{") {
      fail("invalid-name", nameToken, 'invalid directive name "{"');
      continue;
    }

    const isBlock = words.length > 1 && words.at(-1).token.text === "{";
    const params = isBlock ? words.slice(1, -1) : words.slice(1);

    if (!isValidName(nameToken.text)) {
      fail(
        "invalid-name",
        nameToken,
        `invalid directive name ${JSON.stringify(nameToken.text)}`,
      );
    }
    for (const { token } of params) {
      if (token.text === "{" || token.text === "}") {
        fail(
          "brace-inside-directive",
          token,
          `"${token.text}" is only allowed on a line of its own`,
        );
      }
    }

    const directive = {
      type: "directive",
      name: nameToken,
      params,
      block: null,
      trailingComment: line.comment,
    };
    body.push(directive);

    if (isBlock) {
      const brace = words.at(-1);
      directive.block = {
        openBrace: brace.token,
        openBraceBreakBefore: brace.breakBefore,
        body: [],
        closeBrace: null,
        closeComment: null,
      };
      open.push({ block: directive.block, parentBody: body });
      body = directive.block.body;
    }
  }

  for (const frame of open) {
    fail("unclosed-block", frame.block.openBrace, "block is never closed");
  }

  errors.sort((a, b) => a.start - b.start || a.stop - b.stop);
  return { tree: root, errors };
}

// ---------- helpers ----------

const SEPARATOR_NAMES = new Set(["SEPARATOR", "MID_SEPARATOR"]);
const COMMENT_NAMES = new Set(["COMMENT", "MID_COMMENT"]);
const FORBIDDEN_IN_NAME = new Set(["{", "}", '"', "`", "#"]);

/**
 * Printable ASCII excluding { } " ` # — the same rule the reference parser
 * applies to a directive name.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isValidName(text) {
  if (text === "") return false;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0x20 || code >= 0x7f) return false;
    if (FORBIDDEN_IN_NAME.has(char)) return false;
  }
  return true;
}

/**
 * Cut the stream into physical lines and merge runs of empty ones.
 *
 * Separators are dropped (regenerated later); a continuation sets `breakBefore`
 * on the next word; a comment joins the line it sits on, or becomes a line of
 * its own when nothing else is on that line.
 *
 * @param {Token[]} tokens
 * @returns {Array<
 *   { kind: "line", words: Array<{ token: Token, breakBefore: boolean }>, comment: Token | null }
 *   | { kind: "blank", count: number, start: number, stop: number }
 * >}
 */
function splitLines(tokens) {
  const lines = [];
  let words = [];
  let comment = null;
  let pendingBreak = false;
  let lineStart = 0;

  const flush = (end) => {
    if (words.length === 0 && comment === null) {
      const previous = lines.at(-1);
      if (previous !== undefined && previous.kind === "blank") {
        previous.count += 1;
        previous.stop = end;
      } else {
        lines.push({ kind: "blank", count: 1, start: lineStart, stop: end });
      }
    } else {
      lines.push({ kind: "line", words, comment });
    }
    words = [];
    comment = null;
    pendingBreak = false;
    lineStart = end + 1;
  };

  for (const token of tokens) {
    if (token.name === "NEWLINE") {
      flush(token.stop);
      continue;
    }
    if (SEPARATOR_NAMES.has(token.name)) continue;
    if (token.name === "MID_CONTINUATION") {
      pendingBreak = true;
      continue;
    }
    if (COMMENT_NAMES.has(token.name)) {
      comment = token;
      continue;
    }
    words.push({ token, breakBefore: pendingBreak });
    pendingBreak = false;
  }

  // A file whose last line has no newline still holds one line.
  if (words.length > 0 || comment !== null) {
    lines.push({ kind: "line", words, comment });
  }

  return lines;
}

// ---------- doc building ----------

/**
 * Columns to align parameters to, per item in a body.
 *
 * A group is a run of adjacent directives that all describe a column. Blank
 * lines, comments, directives with a block and directives whose first parameter
 * starts on a continuation line all stand alone, so they end a run. Inside a
 * run the longest name keeps a single space before its first parameter and
 * every other name is padded to that same column.
 *
 * Directives with no parameters belong to the run but never define the column —
 * they have nothing to align, and letting their names count would push the
 * whole group right for no reason.
 *
 * @param {Array<DirectiveNode | CommentNode | BlankNode>} items
 * @returns {Array<number | null>} width to pad names to, or null outside a group
 */
function alignmentColumns(items) {
  const alignable = (item) =>
    item.type === "directive" &&
    item.block === null &&
    !(item.params.length > 0 && item.params[0].breakBefore);
  const columns = new Array(items.length).fill(null);

  let start = 0;
  while (start < items.length) {
    if (!alignable(items[start])) {
      start += 1;
      continue;
    }
    let end = start;
    let width = 0;
    while (end < items.length && alignable(items[end])) {
      const directive = items[end];
      if (directive.params.length > 0) {
        width = Math.max(width, directive.name.text.length);
      }
      end += 1;
    }
    for (let index = start; index < end; index += 1) columns[index] = width;
    start = end;
  }

  return columns;
}

/**
 * One hardline between items, plus one per kept blank line.
 *
 * Blank lines at the start are dropped for the file but kept (capped) for a
 * block body: L3 covers the gap between "{" and the first directive. Blanks at
 * the end are dropped either way.
 *
 * @param {Array<DirectiveNode | CommentNode | BlankNode>} items
 * @param {number} maxBlankLines
 * @param {boolean} keepLeadingBlank
 */
function printBody(items, maxBlankLines, keepLeadingBlank) {
  const columns = alignmentColumns(items);
  const parts = [];
  let blank = 0;

  for (const [index, item] of items.entries()) {
    if (item.type === "blank") {
      blank = Math.min(blank + item.count, maxBlankLines);
      continue;
    }
    if (parts.length === 0) {
      if (keepLeadingBlank) {
        for (let i = 0; i < blank; i += 1) parts.push(hardline);
      }
    } else {
      parts.push(hardline);
      for (let i = 0; i < blank; i += 1) parts.push(hardline);
    }
    blank = 0;
    parts.push(printItem(item, maxBlankLines, columns[index]));
  }

  return parts;
}

function printItem(node, maxBlankLines, alignTo) {
  return node.type === "comment"
    ? node.token.text
    : printDirective(node, maxBlankLines, alignTo);
}

/**
 * A gap the author broke stays broken; every other gap is left to the printer.
 *
 * The backslash needs the leading space. Without it the output is `word\`, which
 * the lexer reads as a single unquoted token — not a continuation at all.
 */
function gapDoc(forced) {
  return forced ? [" \\", hardline] : [ifBreak(" \\"), line];
}

function printDirective(node, maxBlankLines, alignTo) {
  const parts = [];
  const pad =
    alignTo !== null && alignTo > node.name.text.length ? " ".repeat(alignTo - node.name.text.length) : "";

  if (pad !== "" && node.params.length > 0 && !node.params[0].breakBefore) {
    // Glue the padding and the first parameter to the name: an aligned gap must
    // not offer a line break, or the padding would end up in front of a
    // backslash and L11 would break.
    parts.push(`${node.name.text}${pad} ${node.params[0].token.text}`);
    for (let index = 1; index < node.params.length; index += 1) {
      const param = node.params[index];
      parts.push(gapDoc(param.breakBefore), param.token.text);
    }
  } else {
    parts.push(node.name.text);
    for (const param of node.params) {
      parts.push(gapDoc(param.breakBefore), param.token.text);
    }
  }
  const head = fill(parts);
  // A continued line starts where this directive's first parameter would start.
  // For `cmd \` that is the backslash column, for a padded row it is the
  // group's column — both fall out of the same number.
  const column = Math.max(alignTo ?? 0, node.name.text.length) + 1;

  const doc = [];
  if (node.block !== null && node.block.openBraceBreakBefore) {
    // `cmd p \` newline `{` is the only legal way to keep the brace on its own
    // line, and it is what the source did. The brace sits at the directive's own
    // level so the body below it still reads as one level deeper.
    doc.push(align(column, head), gapDoc(true), "{");
  } else {
    doc.push(align(column, head));
    if (node.block !== null) doc.push(" {");
  }

  if (node.trailingComment !== null) {
    doc.push(lineSuffix([" ", node.trailingComment.text]));
  }

  if (node.block !== null) {
    const body = printBody(node.block.body, maxBlankLines, true);
    if (body.length > 0) {
      doc.push(indent([hardline, body]), hardline, "}");
    } else {
      doc.push(hardline, "}");
    }
    if (node.block.closeComment !== null) {
      doc.push(lineSuffix([" ", node.block.closeComment.text]));
    }
  }

  return doc;
}