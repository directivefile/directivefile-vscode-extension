// Tokenize a .df source with the ANTLR lexer generated from dflexer.g4.
//
// `dflexer.js` is the compiled lexer. Importing the generated .ts directly
// fails, because it imports `DecisionState`, which the antlr4 ESM build does
// not export at runtime — the compiler drops it when it emits JS.

import { CharStream, CommonTokenStream, Token } from "antlr4";
import dflexer from "./dflexer.js";

/**
 * Split the source into tokens.
 *
 * Hidden tokens (separators, comments, line continuations) are kept: a
 * formatter needs them. `start` and `stop` are character offsets into the
 * source, inclusive on both ends.
 *
 * @param {string} source
 * @returns {{ tokens: Array<{
 *   type: number, name: string, text: string,
 *   line: number, column: number, hidden: boolean,
 *   start: number, stop: number
 * }>, errors: Array<{ line: number, column: number, message: string }> }}
 */
export function tokenize(source) {
  const lexer = new dflexer(new CharStream(source));
  const errors = [];
  lexer.removeErrorListeners();
  lexer.addErrorListener({
    syntaxError: (_recognizer, _symbol, line, column, message) => {
      errors.push({ line, column: column + 1, message });
    },
    reportAmbiguity: () => {},
    reportAttemptingFullContext: () => {},
    reportContextSensitivity: () => {},
  });

  const stream = new CommonTokenStream(lexer);
  stream.fill();

  const tokens = [];
  for (const token of stream.tokens) {
    if (token.type === Token.EOF) break;
    tokens.push({
      type: token.type,
      name: dflexer.symbolicNames[token.type] ?? `type(${token.type})`,
      text: token.text,
      line: token.line,
      column: token.column + 1,
      hidden: token.channel === Token.HIDDEN_CHANNEL,
      start: token.start,
      stop: token.stop,
    });
  }
  return { tokens, errors };
}
