// formatter.js — source string in, formatted source string out.
//
// No I/O and no async: reading and writing the file belongs to the caller. In
// the editor that is `document.getText()` / a TextEdit; in a CLI it is
// readFileSync / writeFileSync.

import { printer as docPrinter } from "prettier/doc";
import { tokenize } from "./tokenize.js";
import { buildTree, buildDoc } from "./printer.js";

/**
 * Format a directivefile.
 *
 * Returns the source unchanged whenever it cannot be understood: a formatter
 * must not "fix" a file it failed to parse. Validation is a separate concern.
 *
 * @param {string} source
 * @param {{
 *   printWidth?: number,
 *   tabWidth?: number,
 *   useTabs?: boolean,
 *   endOfLine?: "lf" | "crlf" | "cr" | "auto" | string,
 *   maxBlankLines?: number,
 * }} [options]
 * @returns {string}
 */
export function format(source, options = {}) {
  const {
    printWidth = 100,
    tabWidth = 4,
    useTabs = false,
    endOfLine = "lf",
    maxBlankLines = 1,
  } = options;

  // A byte order mark is not part of the language, but it is part of the file.
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = bom === "" ? source : source.slice(1);

  const { tokens, errors: lexerErrors } = tokenize(text);
  if (lexerErrors.length > 0) return source;

  const { tree, errors } = buildTree(tokens);
  if (errors.length > 0) return source;

  const formatted = docPrinter.printDocToString(buildDoc(tree, { maxBlankLines }), {
    printWidth,
    tabWidth,
    useTabs,
    endOfLine: resolveEndOfLine(endOfLine, text),
  }).formatted;

  return bom + formatted;
}

/**
 * printDocToString takes the option *name*, not the separator itself
 * (`convertEndOfLineOptionToCharacter` maps "crlf" to "\r\n" and everything
 * else to "\n"). So only "auto" needs resolving here.
 *
 * @param {string} option
 * @param {string} source
 * @returns {string} "lf" | "crlf" | "cr"
 */
function resolveEndOfLine(option, source) {
  if (option !== "auto") return option;
  const index = source.indexOf("\r");
  if (index === -1) return "lf";
  return source.charAt(index + 1) === "\n" ? "crlf" : "cr";
}
