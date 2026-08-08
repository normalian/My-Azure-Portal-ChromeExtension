import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const files = [
  ['background.js', 'background.js'],
  ['content-script.js', 'script.js'],
  ['popup.js', 'popup.js'],
  ['onboarding.js', 'onboarding.js']
];

await Promise.all(files.map(async ([source, destination]) => {
  const target = join(root, destination);
  await mkdir(dirname(target), { recursive: true });
  const contents = await readFile(join(root, 'build', source), 'utf8');
  await writeFile(target, contents.replace(/^export \{\};\r?\n?/gm, ''), 'utf8');
}));
