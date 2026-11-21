import { defineConfig } from "vite";

// The extension host loads `main` from package.json, so the build has to emit a
// single ES module at a predictable path. `vscode` is provided by the host at
// runtime and must never be bundled.
export default defineConfig({
  build: {
    target: "es2023",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/extension.ts",
      formats: ["es"],
      fileName: "extension",
    },
    rollupOptions: {
      external: ["vscode"],
    },
  },
});
