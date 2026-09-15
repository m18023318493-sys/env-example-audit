import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.go', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs',
  '.php', '.py', '.rb', '.rs', '.ts', '.tsx',
]);

const REFERENCE_PATTERNS = [
  /\b(?:process|Bun)\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /\b(?:process|Bun)\.env\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /\b(?:Deno\.env\.get|os\.getenv|os\.Getenv|os\.LookupEnv|System\.getenv|(?:std::)?env::var|getenv)\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g,
  /\bos\.environ\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /\bENV\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function lineAtOffset(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function parseExample(source) {
  const keys = new Set();
  const firstLineByKey = new Map();
  const duplicates = [];
  const invalidLines = [];
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = rawLine.match(/^\s*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/);
    if (!match) {
      invalidLines.push(index + 1);
      continue;
    }

    const key = match[1];
    if (keys.has(key)) {
      duplicates.push({
        key,
        line: index + 1,
        firstLine: firstLineByKey.get(key),
      });
    } else {
      keys.add(key);
      firstLineByKey.set(key, index + 1);
    }
  }

  return { keys, duplicates, invalidLines };
}

export function extractReferences(source, file = '') {
  const references = [];
  const seen = new Set();

  for (const pattern of REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = lineAtOffset(source, match.index);
      const signature = `${match[1]}\0${line}\0${match.index}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      references.push({ key: match[1], file, line });
    }
  }

  return references.sort((left, right) => left.line - right.line || left.key.localeCompare(right.key));
}

async function collectSourceFiles(root, ignoredDirectories) {
  const rootStats = await stat(root);
  if (rootStats.isFile()) {
    return SOURCE_EXTENSIONS.has(path.extname(root).toLowerCase()) ? [root] : [];
  }

  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(entryPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

export async function audit(input = '.', options = {}) {
  const absoluteInput = path.resolve(input);
  const inputStats = await stat(absoluteInput);
  const rootDirectory = inputStats.isDirectory() ? absoluteInput : path.dirname(absoluteInput);
  const examplePath = path.resolve(rootDirectory, options.example ?? '.env.example');
  const ignoredDirectories = new Set([
    ...DEFAULT_IGNORED_DIRECTORIES,
    ...(options.ignore ?? []),
  ]);
  const exampleSource = await readFile(examplePath, 'utf8');
  const parsedExample = parseExample(exampleSource);
  const sourceFiles = await collectSourceFiles(absoluteInput, ignoredDirectories);
  const references = [];

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    const displayFile = toPosix(path.relative(rootDirectory, sourceFile)) || path.basename(sourceFile);
    references.push(...extractReferences(source, displayFile));
  }

  const referencesByKey = new Map();
  for (const reference of references) {
    if (!referencesByKey.has(reference.key)) referencesByKey.set(reference.key, []);
    referencesByKey.get(reference.key).push({ file: reference.file, line: reference.line });
  }

  const missing = [...referencesByKey.entries()]
    .filter(([key]) => !parsedExample.keys.has(key))
    .map(([key, keyReferences]) => ({ key, references: keyReferences }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const unused = [...parsedExample.keys]
    .filter((key) => !referencesByKey.has(key))
    .sort((left, right) => left.localeCompare(right));

  return {
    root: rootDirectory,
    example: toPosix(path.relative(rootDirectory, examplePath)) || path.basename(examplePath),
    filesChecked: sourceFiles.length,
    referencesFound: references.length,
    missing,
    unused,
    duplicates: parsedExample.duplicates,
    invalidLines: parsedExample.invalidLines,
  };
}
