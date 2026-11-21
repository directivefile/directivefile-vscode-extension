# Directivefile for VS Code

Language support for [Directivefile](https://github.com/directivefile) configuration files.

## Requirements

- Visual Studio Code 1.146.0 or newer

## Features

- **Syntax highlighting** for directives, parameters, comments, blocks, continuations, and environment placeholders.
- **Syntax error diagnostics** in the Problems panel.
- **Formatting** for directives, parameter alignment, nested blocks, continuation lines, comments, and blank lines.
- **`.df` files are recognized automatically**; extra file associations are optional.

## Settings

### Other file suffixes

- `.df` files are associated automatically. 
- For files with another suffix, map them to the `directivefile` language with a glob pattern:

```json
"files.associations": {
  "*.your_suffix": "directivefile"
}
```

- For files without a suffix, use a glob pattern that matches the file name:

```json
"files.associations": {
  "your_glob_pattern": "directivefile"
}
```

## Formatter Settings

```json
"[directivefile]": {
  "editor.defaultFormatter": "directivefile.df",
  "editor.formatOnSave": true
}
```
