import type { ExtensionContext } from "vscode";
import { registerDiagnostics } from "./diagnostics.js";
import { registerFormatting } from "./formatting.js";

export function activate(context: ExtensionContext): void {
  registerDiagnostics(context);
  registerFormatting(context);
}

export function deactivate(): void {}
