// Static checks without dependencies: manifest is valid JSON, every file it (and
// the HTML pages) reference exists, and every JavaScript file parses.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function requireFile(rel, from) {
  if (!existsSync(join(root, rel))) errors.push(`${from}: missing file ${rel}`);
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
Object.values(manifest.icons || {}).forEach((f) => requireFile(f, 'manifest icons'));
Object.values(manifest.action?.default_icon || {}).forEach((f) => requireFile(f, 'manifest action'));
requireFile(manifest.background.service_worker, 'manifest background');
requireFile(manifest.side_panel.default_path, 'manifest side_panel');
requireFile(manifest.options_page, 'manifest options_page');
for (const cs of manifest.content_scripts || []) cs.js.forEach((f) => requireFile(f, 'manifest content_scripts'));

const files = walk(root);
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    requireFile(relative(root, join(dirname(file), ref)), relative(root, file));
  }
}

for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`${relative(root, file)}: ${err.stderr.toString().trim()}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: manifest v${manifest.version}, ${files.length} files checked.`);
