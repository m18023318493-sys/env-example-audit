import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { audit, extractReferences, parseExample } from '../src/audit.js';

async function fixture(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'env-example-audit-'));
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(directory, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf8');
  }
  return directory;
}

test('parses keys without retaining secret values', () => {
  const result = parseExample('# config\nAPI_URL=https://example.com\nexport TOKEN=do-not-print');

  assert.deepEqual([...result.keys], ['API_URL', 'TOKEN']);
  assert.equal(JSON.stringify(result).includes('do-not-print'), false);
  assert.deepEqual(result.duplicates, []);
  assert.deepEqual(result.invalidLines, []);
});

test('finds references across supported language styles', () => {
  const source = [
    'const url = process.env.API_URL;',
    'const token = Deno.env.get("TOKEN");',
    'value = os.environ["DATABASE_URL"]',
    'region := os.Getenv("REGION")',
    'let port = std::env::var("PORT");',
  ].join('\n');

  assert.deepEqual(
    extractReferences(source, 'config.txt').map(({ key, line }) => ({ key, line })),
    [
      { key: 'API_URL', line: 1 },
      { key: 'TOKEN', line: 2 },
      { key: 'DATABASE_URL', line: 3 },
      { key: 'REGION', line: 4 },
      { key: 'PORT', line: 5 },
    ],
  );
});

test('reports undocumented and unused keys', async (context) => {
  const directory = await fixture({
    '.env.example': 'API_URL=\nOLD_SETTING=\n',
    'src/config.js': 'export const api = process.env.API_URL;\nexport const token = process.env.API_TOKEN;',
  });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const result = await audit(directory);

  assert.deepEqual(result.missing.map((item) => item.key), ['API_TOKEN']);
  assert.deepEqual(result.unused, ['OLD_SETTING']);
  assert.equal(result.missing[0].references[0].file, 'src/config.js');
  assert.equal(result.missing[0].references[0].line, 2);
});

test('ignores dependency and user-selected directories', async (context) => {
  const directory = await fixture({
    '.env.example': '# intentionally empty\n',
    'node_modules/pkg/index.js': 'process.env.DEPENDENCY_SECRET',
    'generated/config.py': 'os.getenv("GENERATED_SECRET")',
  });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const result = await audit(directory, { ignore: ['generated'] });

  assert.equal(result.filesChecked, 0);
  assert.deepEqual(result.missing, []);
});

test('reports duplicate keys and invalid lines without exposing values', () => {
  const result = parseExample('TOKEN=first-secret\nTOKEN=second-secret\nnot a declaration');

  assert.deepEqual(result.duplicates, [{ key: 'TOKEN', line: 2, firstLine: 1 }]);
  assert.deepEqual(result.invalidLines, [3]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
