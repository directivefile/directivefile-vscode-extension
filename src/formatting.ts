import * as vscode from "vscode";
import { format } from "./formatter/formatter.js";
import { CONFIGURATION_SECTION, LANGUAGE_ID } from "./language.js";

const DEFAULT_PRINT_WIDTH = 120;
const DEFAULT_MAX_BLANK_LINES = 1;
const FORMAT_SELECTOR = {
  language: LANGUAGE_ID,
} satisfies vscode.DocumentSelector;

const formattingProvider = {
  provideDocumentFormattingEdits(document, options, token) {
    if (token.isCancellationRequested) return [];

    const source = document.getText();
    const config = vscode.workspace.getConfiguration(
      CONFIGURATION_SECTION,
      document,
    );
    const printWidth = integerAtLeast(
      config.get<number>("format.printWidth", DEFAULT_PRINT_WIDTH),
      1,
      DEFAULT_PRINT_WIDTH,
    );
    const maxBlankLines = integerAtLeast(
      config.get<number>("format.maxBlankLines", DEFAULT_MAX_BLANK_LINES),
      0,
      DEFAULT_MAX_BLANK_LINES,
    );

    let formatted: string;
    try {
      formatted = format(source, {
        printWidth,
        tabWidth: options.tabSize,
        useTabs: !options.insertSpaces,
        endOfLine: document.eol === vscode.EndOfLine.CRLF ? "crlf" : "lf",
        maxBlankLines,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Directivefile formatting failed: ${message}`,
      );
      return [];
    }

    if (token.isCancellationRequested || formatted === source) return [];

    return [
      vscode.TextEdit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(source.length),
        ),
        formatted,
      ),
    ];
  },
} satisfies vscode.DocumentFormattingEditProvider;

export function registerFormatting(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      FORMAT_SELECTOR,
      formattingProvider,
    ),
  );
}

function integerAtLeast(
  value: number,
  minimum: number,
  fallback: number,
): number {
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}
