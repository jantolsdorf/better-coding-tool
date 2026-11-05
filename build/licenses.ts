// The licenses of the third-party packages bundled into the app (the dependencies in
// package.json, and theirs): put at the top of the built index.html, as their licenses ask, and
// given to the app as `virtual:third-party-licenses` for its Licenses dialog.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

export interface PackageLicense {
  name: string;
  version: string;
  /** The license's name (SPDX), from package.json or the license text. */
  license: string;
  homepage?: string;
  /** The license text as the package ships it (or its source's license header). */
  text: string;
}

const VIRTUAL_ID = 'virtual:third-party-licenses';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** The directory of an installed package (looked up from `from`, as Node resolves packages). */
function packageDir(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/** The package's license file, else the license header of its main file. */
function licenseText(dir: string, pkg: { main?: string }): string {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (file) return readFileSync(join(dir, file), 'utf8').trim();
  const main = pkg.main && join(dir, pkg.main);
  const header = main && existsSync(main) ? /\/\*\*?[\s\S]*?\*\//.exec(readFileSync(main, 'utf8'))?.[0] : undefined;
  return header && /licen[cs]e/i.test(header) ? header : 'No license text in the package; see its homepage.';
}

/** The bundled packages: the dependencies in package.json and theirs, by name. */
export function collectLicenses(root: string): PackageLicense[] {
  const found = new Map<string, PackageLicense>();
  const visit = (name: string, from: string) => {
    if (found.has(name)) return;
    const dir = packageDir(name, from);
    if (!dir) return;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const text = licenseText(dir, pkg);
    const named = typeof pkg.license === 'string' ? pkg.license : /^\s*MIT License/.test(text) || /license:.*\bMIT\b/i.test(text) ? 'MIT' : 'see text';
    found.set(name, { name, version: pkg.version, license: named, homepage: pkg.homepage, text });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  };
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys(own.dependencies ?? {})) visit(dep, root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A license's name in parentheses (SPDX expressions with several have their own). */
const licenseLabel = (l: PackageLicense) => (l.license.startsWith('(') ? l.license : `(${l.license})`);

/** The notices as an HTML comment ("--" cannot appear inside one: runs of hyphens become "="). */
function htmlComment(licenses: PackageLicense[]): string {
  const blocks = licenses.map((l) => [`${l.name} ${l.version} ${licenseLabel(l)}${l.homepage ? ` ${l.homepage}` : ''}`, '', l.text].join('\n'));
  const body = ['Third-party software bundled into this file, and its licenses:', ...blocks].join('\n\n' + '='.repeat(72) + '\n\n');
  return `<!--\n${body.replace(/-{2,}/g, (dashes) => '='.repeat(dashes.length))}\n-->`;
}

export function thirdPartyLicenses(): Plugin {
  let root = process.cwd();
  return {
    name: 'third-party-licenses',
    configResolved(config) {
      root = config.root;
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) => (id === RESOLVED_ID ? `export default ${JSON.stringify(collectLicenses(root))};` : null),
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<head>/i, (head) => `${head}\n${htmlComment(collectLicenses(root))}`),
    },
  };
}
