#!/usr/bin/env node

import { audit } from './audit.js';

const VERSION = '0.1.0';

function help() {
  return `env-example-audit v${VERSION}

Find environment variables used in source code but missing from .env.example.

Usage:
  env-example-audit [path] [options]

Options:
  --example <path>  Example file relative to the scan root (default: .env.example)
  --ignore <name>   Ignore a directory name (repeatable)
  --check-unused    Treat unused example keys as errors
  --json            Print machine-readable JSON
  -h, --help        Show this help
  -v, --version     Show the version
`;
}

function parseArguments(argumentsList) {
  const result = {
    input: '.',
    example: '.env.example',
    ignore: [],
    checkUnused: false,
    json: false,
  };
  let inputWasSet = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') {
      result.json = true;
    } else if (argument === '--check-unused') {
      result.checkUnused = true;
    } else if (argument === '--example' || argument === '--ignore') {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === '--example') result.example = value;
      else result.ignore.push(value);
      index += 1;
    } else if (argument.startsWith('--example=')) {
      result.example = argument.slice('--example='.length);
    } else if (argument.startsWith('--ignore=')) {
      result.ignore.push(argument.slice('--ignore='.length));
    } else if (argument === '-h' || argument === '--help') {
      result.help = true;
    } else if (argument === '-v' || argument === '--version') {
      result.version = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`);
    } else if (!inputWasSet) {
      result.input = argument;
      inputWasSet = true;
    } else {
      throw new Error('only one input path can be checked at a time');
    }
  }

  return result;
}

function countErrors(result, checkUnused) {
  return (
    result.missing.length +
    result.duplicates.length +
    result.invalidLines.length +
    (checkUnused ? result.unused.length : 0)
  );
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${help()}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(help());
    return;
  }
  if (options.version) {
    console.log(VERSION);
    return;
  }

  try {
    const result = await audit(options.input, {
      example: options.example,
      ignore: options.ignore,
    });
    const errorCount = countErrors(result, options.checkUnused);

    if (options.json) {
      console.log(JSON.stringify({ ...result, ok: errorCount === 0 }, null, 2));
    } else {
      for (const item of result.missing) {
        const first = item.references[0];
        const suffix = item.references.length > 1 ? ` (and ${item.references.length - 1} more)` : '';
        console.error(`${first.file}:${first.line}  ${item.key} is missing from ${result.example}${suffix}`);
      }
      for (const item of result.duplicates) {
        console.error(`${result.example}:${item.line}  duplicate key ${item.key} (first declared on line ${item.firstLine})`);
      }
      for (const line of result.invalidLines) {
        console.error(`${result.example}:${line}  invalid environment variable declaration`);
      }
      if (options.checkUnused) {
        for (const key of result.unused) {
          console.error(`${result.example}  ${key} is not referenced by scanned source files`);
        }
      }

      if (errorCount === 0) {
        console.log(`OK: checked ${result.filesChecked} source file(s) and ${result.referencesFound} reference(s).`);
      } else {
        console.error(`\nChecked ${result.filesChecked} source file(s); found ${errorCount} problem(s).`);
      }
    }

    process.exitCode = errorCount === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 2;
  }
}

await main();
