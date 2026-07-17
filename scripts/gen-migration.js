#!/usr/bin/env node
// Wrapper around `typeorm-ts-node-commonjs migration:generate`, which takes a
// positional <path> and has no --name flag. This lets `pnpm m:gen --name=X`
// (the workflow documented in Sprint 1) actually work.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const nameArg = args.find((a) => a.startsWith('--name='));
const name = nameArg ? nameArg.split('=')[1] : args[0];

if (!name) {
  console.error('Usage: pnpm m:gen --name=<MigrationName>');
  process.exit(1);
}

const migrationPath = `src/database/migrations/${name}`;
const result = spawnSync(
  'npx',
  [
    'typeorm-ts-node-commonjs',
    'migration:generate',
    '-d',
    'src/database/data-source.ts',
    migrationPath,
  ],
  { stdio: 'inherit', shell: true },
);
process.exit(result.status ?? 1);
