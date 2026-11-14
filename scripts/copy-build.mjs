import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  ['background.js', 'background.js'],
  ['content-script.js', 'script.js'],
  ['popup.js', 'popup.js'],
  ['onboarding.js', 'onboarding.js'],
  ['shared.js', 'shared.js'],
  ['options.js', 'options.js']
];

await Promise.all(files.map(async ([source, destination]) => {
  const target = join(root, 'extension', destination);
  await mkdir(dirname(target), { recursive: true });
  const contents = await readFile(join(root, 'build', source), 'utf8');
  const script = contents.replace(/^export \{\};\r?\n?/gm, '');
  // Classic scripts must not leak module-local bindings into their shared global scope.
  const output = destination === 'background.js' ? script : `(() => {\n${script}\n})();\n`;
  await writeFile(target, output, 'utf8');
}));
