import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizePath, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';

/** Workspace is deferred by React, but required to render a restored/demo shell. */
function executableShell(bundle: Rolldown.OutputBundle, root: string): string[] {
  const workspace = normalizePath(join(root, 'src/features/workspace/Workspace.tsx'));
  const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
  const workspaceChunks = chunks.filter((chunk) => chunk.moduleIds.includes(workspace));
  const entries = chunks.filter((chunk) => chunk.isEntry);
  if (!entries.length || !workspaceChunks.length) throw new Error('Executable shell entry or Workspace is missing from the build.');
  const assets = new Set<string>();
  const visit = (name: string) => {
    if (assets.has(name)) return;
    const output = bundle[name];
    if (!output) throw new Error(`Executable shell asset is missing from the build: ${name}`);
    assets.add(name);
    if (output.type !== 'chunk') return;
    for (const dependency of output.imports) visit(dependency);
    for (const css of output.viteMetadata?.importedCss ?? []) visit(css);
    for (const asset of output.viteMetadata?.importedAssets ?? []) visit(asset);
    // Only follow static edges; feature catalogs, media and crypto remain lazy.
  };
  for (const chunk of [...entries, ...workspaceChunks]) visit(chunk.fileName);
  return [...assets].sort().map((name) => `/${name}`);
}

/** Stamp actual production output; runtime instance configuration stays independent. */
export function serviceWorkerBuild(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'aimtrix-service-worker-revision',
    apply: 'build',
    configResolved(value) { config = value; },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const shell = executableShell(bundle, config.root);
        const hash = createHash('sha256');
        const add = (name: string, bytes: string | Uint8Array) => {
          hash.update(name); hash.update('\0'); hash.update(bytes); hash.update('\0');
        };
        add('executable-shell', JSON.stringify(shell));
        add('package-version', JSON.parse(readFileSync(join(config.root, 'package.json'), 'utf8')).version);
        for (const name of Object.keys(bundle).sort()) {
          if (name === 'sw.js') continue;
          const output = bundle[name];
          add(name, output.type === 'chunk' ? output.code : output.source);
        }
        const visit = (directory: string) => {
          for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const file = join(directory, entry.name);
            if (entry.isDirectory()) visit(file);
            else {
              const name = relative(config.publicDir, file).replaceAll('\\', '/');
              if (name !== 'config.json') add(`public/${name}`, readFileSync(file));
            }
          }
        };
        visit(config.publicDir);
        const revision = hash.digest('hex');
        const worker = readFileSync(join(config.publicDir, 'sw.js'), 'utf8');
        const marker = "const CACHE = 'aimtrix-shell-v3';";
        if (!worker.includes(marker)) throw new Error('Service worker cache revision marker is missing.');
        const shellMarker = 'const BUILD_SHELL = [];';
        if (!worker.includes(shellMarker)) throw new Error('Service worker executable shell marker is missing.');
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker
          .replace(marker, `const CACHE = 'aimtrix-shell-${revision}';`)
          .replace(shellMarker, `const BUILD_SHELL = ${JSON.stringify(shell)};`) });
      },
    },
  };
}
