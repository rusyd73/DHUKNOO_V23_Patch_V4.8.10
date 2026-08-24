import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const frontend = path.join(root, 'frontend');
const pkg = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'));
const css = fs.readFileSync(path.join(frontend, 'src/styles/index.css'), 'utf8');

const checks = [
  ['tailwindcss dependency', Boolean(pkg.devDependencies?.tailwindcss)],
  ['postcss dependency', Boolean(pkg.devDependencies?.postcss)],
  ['autoprefixer dependency', Boolean(pkg.devDependencies?.autoprefixer)],
  ['tailwind config', fs.existsSync(path.join(frontend, 'tailwind.config.cjs'))],
  ['postcss config', fs.existsSync(path.join(frontend, 'postcss.config.cjs'))],
  ['Vite entry', fs.existsSync(path.join(frontend, 'index.html'))],
  ['Tailwind directives', css.includes('@tailwind base;') && css.includes('@tailwind components;') && css.includes('@tailwind utilities;')],
  ['glass-card component', css.includes('.glass-card')],
  ['font-heading component', css.includes('.font-heading')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
