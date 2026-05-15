# Java LLM Extractor

A pragmatic utility designed to crawl through a JSF/Java legacy application and consolidate its menu architecture into a structured, LLM-ready Markdown document.

This tool was built to solve the "context window" problem for AI agents (Copilot, Cursor, Claude, etc.) working on large-scale legacy systems — especially those built with **JSF + PrimeFaces + Java EE**. Instead of feeding thousands of raw source files into an LLM, you feed it the relevant slice of this document.

## Core Principles

* **Performance over contraptions:** Scans thousands of Java files in seconds, resolving labels, URLs and business methods in a single pass.
* **Operational efficiency:** Single-binary execution. No Node.js runtime required on the target machine.
* **KISS:** No complex UI. Just a CLI that does one thing: turns a JSF sidebar + Java source tree into a clean, semantic Markdown map.

## What it extracts

For each item in the application menu (`sidebar.xhtml`), the tool produces:

* **Menu hierarchy** — module > submodule > function (up to 3 levels)
* **Screen URL** — the JSF page path
* **Permission key** — the access control identifier (`trinityUtils.userHasPermission`)
* **Java classes** — the backing beans and controllers mapped to that screen
* **Business operations** — public non-getter/setter methods found in each class
* **Permission index** — a full table of all permissions cross-referenced to their function and module

## Usage

### Development (requires Node.js 18+)

```bash
npm install
npx tsx index.ts "<project-root>" "<output-file>" [--utf8]
```

**Arguments:**

| Argument | Description | Default |
|---|---|---|
| `<project-root>` | Root path of the Java project | current directory |
| `<output-file>` | Output Markdown file name | `menu-architecture.md` |
| `--utf8` | Write output in UTF-8 instead of ISO-8859-1 | Latin-1 (default) |

**Example:**

```bash
# Latin-1 output (standard)
npx tsx index.ts "C:\Projetos\Company\Company-1.0-master" "menu-architecture.md"

# UTF-8 output (for LLM APIs or web tools)
npx tsx index.ts "C:\Projetos\Company\Company-1.0-master" "menu-architecture.md" --utf8

```



### Binary (no Node.js required)

Download the binary for your OS from the **GitHub Actions** tab (under Artifacts) or build it locally:

```bash
npm run build
```

Then run:

```bash
# Windows
.\bin\java-llm-extractor-win.exe "C:\Projetos\Company\Company-1.0-master" menu-architecture.md

# Linux
./bin/java-llm-extractor-linux "C:/Projetos/Company/Company-1.0-master" menu-architecture.md
```

## Expected project structure

The tool expects a standard Maven multi-module layout:

```
<project-root>/
  web/src/main/
    webapp/layout/sidebar.xhtml     ← menu tree
    properties/messages.properties  ← PT-BR labels
    java/...                        ← backing beans
  core/src/main/java/...            ← core services
  common/src/main/java/...          ← shared utilities
```

## Output sample

```markdown
##### Pesagem de Entrada

- **URL:** `/com/arcadian/product/web/pesagemEntradaModalRodoviario/pesar-modal-rodoviario-na-entrada.jsf`
- **Permission:** `pesar-modal-rodoviario-na-entrada`
- **Java Classes:**
  - `web\src\main\java\...\PesagemEntradaModalRodoviarioController.java`
    - Operations: iniciar, confirmar, cancelar, pesarVeiculo, gerarTicket
```

## Encoding

Source files are read in **ISO-8859-1** (Latin-1), which is the encoding standard. The output file is written in the same encoding by default. Use `--utf8` to produce a UTF-8 output when sending the document to external LLM APIs or web-based tools.

## Author

Andre Mesquita
