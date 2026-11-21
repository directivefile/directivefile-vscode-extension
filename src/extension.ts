import type * as vscode from "vscode";

// This extension currently contributes the language definition and its grammar
// only, so there is nothing to do at activation time.
//
// Formatting is not implemented here on purpose: the working formatter lives in
// ../../prettier-formatter and has not been ported yet. When it is, this is the
// place to register a DocumentFormattingEditProvider for "directivefile".

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
