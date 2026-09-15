# env-example-audit

A zero-dependency CLI that finds environment variables used in source code but missing from `.env.example`.

```text
src/config.ts:8  DATABASE_URL is missing from .env.example
src/email.py:14  SMTP_TOKEN is missing from .env.example

Checked 24 source file(s); found 2 problem(s).
```

## Why?

Projects often gain a new environment variable while `.env.example` quietly falls out of date. That makes onboarding and deployments fail later. `env-example-audit` catches the mismatch in local development and CI.

It reads variable names from `.env.example`, never real `.env` files, and never stores or prints values.

## Supported code styles

- JavaScript and TypeScript: `process.env.KEY`, `import.meta.env.KEY`, `Deno.env.get("KEY")`, `Bun.env.KEY`
- Python: `os.getenv("KEY")`, `os.environ["KEY"]`
- Go: `os.Getenv("KEY")`, `os.LookupEnv("KEY")`
- Rust: `std::env::var("KEY")`
- Java and Kotlin: `System.getenv("KEY")`
- Ruby: `ENV["KEY"]`
- PHP: `getenv("KEY")`

Dynamic variable names cannot be detected and are intentionally skipped.

## Quick start

```bash
git clone https://github.com/m18023318493-sys/env-example-audit.git
cd env-example-audit
node src/cli.js /path/to/your/project
```

To expose the command locally:

```bash
npm link
env-example-audit /path/to/your/project
```

## Usage

```text
env-example-audit [path] [options]

Options:
  --example <path>  Example file relative to the scan root
  --ignore <name>   Ignore a directory name (repeatable)
  --check-unused    Treat unused example keys as errors
  --json            Print machine-readable JSON
  -h, --help        Show help
  -v, --version     Show the version
```

Examples:

```bash
# Check the current project
env-example-audit .

# Use another template name
env-example-audit . --example .env.template

# Fail when .env.example contains stale keys
env-example-audit . --check-unused

# Skip generated code and print JSON
env-example-audit . --ignore generated --json
```

The process exits with code `0` when the audit passes, `1` when mismatches are found, and `2` for usage or runtime errors.

## GitHub Actions

```yaml
- name: Audit environment variables
  run: node path/to/env-example-audit/src/cli.js .
```

This repository includes a complete [CI workflow](.github/workflows/ci.yml).

## 中文说明

`env-example-audit` 会扫描源码中的环境变量引用，并检查这些变量是否记录在 `.env.example` 中。工具只读取变量名，不读取真实 `.env` 文件，也不会输出任何密钥值。

## License

[MIT](LICENSE)
