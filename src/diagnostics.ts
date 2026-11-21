import * as vscode from "vscode";
import { buildTree } from "./formatter/printer.js";
import { tokenize } from "./formatter/tokenize.js";
import { DIAGNOSTIC_SOURCE, LANGUAGE_ID } from "./language.js";

const DEBOUNCE_MS = 150;

interface ParseDiagnostic {
  code: string;
  message: string;
  start: number;
  stop: number;
}

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE_ID) {
      collection.delete(document.uri);
      return;
    }
    collection.set(document.uri, diagnosticsFor(document));
  };

  const schedule = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const pending = timers.get(key);
    if (pending !== undefined) clearTimeout(pending);

    if (document.languageId !== LANGUAGE_ID) {
      timers.delete(key);
      collection.delete(document.uri);
      return;
    }

    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document);
      }, DEBOUNCE_MS),
    );
  };

  for (const document of vscode.workspace.textDocuments) refresh(document);

  context.subscriptions.push(
    collection,
    vscode.Disposable.from(
      vscode.workspace.onDidOpenTextDocument(refresh),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        schedule(document),
      ),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        const pending = timers.get(key);
        if (pending !== undefined) clearTimeout(pending);
        timers.delete(key);
        collection.delete(document.uri);
      }),
      new vscode.Disposable(() => {
        for (const pending of timers.values()) clearTimeout(pending);
        timers.clear();
      }),
    ),
  );
}

function diagnosticsFor(document: vscode.TextDocument): vscode.Diagnostic[] {
  const source = document.getText();
  const bomOffset = source.startsWith("\uFEFF") ? 1 : 0;
  const text = bomOffset === 0 ? source : source.slice(1);

  const { tokens, errors: lexerErrors } = tokenize(text);
  const { errors: treeErrors } = buildTree(tokens);

  const errors: ParseDiagnostic[] = [
    ...lexerErrors.map((error) => {
      const offset =
        offsetAtLineColumn(text, error.line, error.column) + bomOffset;
      return {
        code: "lexer",
        message: error.message,
        start: offset,
        stop: offset,
      };
    }),
    ...treeErrors.map((error) => ({
      code: error.code,
      message: error.message,
      start: error.start + bomOffset,
      stop: error.stop + bomOffset,
    })),
  ];

  return errors
    .toSorted((a, b) => a.start - b.start || a.stop - b.stop)
    .map((error) => {
      const start = Math.min(error.start, source.length);
      const end = Math.min(error.stop + 1, source.length);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(start), document.positionAt(end)),
        error.message,
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.code = error.code;
      diagnostic.source = DIAGNOSTIC_SOURCE;
      return diagnostic;
    });
}

function offsetAtLineColumn(
  text: string,
  line: number,
  column: number,
): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = text.indexOf("\n", offset);
    if (newline === -1) return text.length;
    offset = newline + 1;
  }
  return Math.min(offset + Math.max(column - 1, 0), text.length);
}
