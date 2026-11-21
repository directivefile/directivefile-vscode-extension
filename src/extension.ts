import * as vscode from "vscode";
import { format } from "./formatter/formatter.js";

const LANGUAGE_ID = "directivefile";
const DEFAULT_PRINT_WIDTH = 100;
const DEFAULT_MAX_BLANK_LINES = 1;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
      provideDocumentFormattingEdits(document, options) {
        const source = document.getText();
        const config = vscode.workspace.getConfiguration("directivefile", document);

        let formatted: string;
        try {
          formatted = format(source, {
            printWidth: positiveInteger(
              config.get<number>("format.printWidth"),
              DEFAULT_PRINT_WIDTH,
            ),
            tabWidth: options.tabSize,
            useTabs: !options.insertSpaces,
            endOfLine: document.eol === vscode.EndOfLine.CRLF ? "crlf" : "lf",
            maxBlankLines: nonNegativeInteger(
              config.get<number>("format.maxBlankLines"),
              DEFAULT_MAX_BLANK_LINES,
            ),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(
            `Directivefile formatting failed: ${message}`,
          );
          return [];
        }

        if (formatted === source) return [];

        return [
          vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
            formatted,
          ),
        ];
      },
    }),
  );
}

export function deactivate(): void {}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}
