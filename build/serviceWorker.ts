import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

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
        const hash = createHash('sha256');
        const add = (name: string, bytes: string | Uint8Array) => {
          hash.update(name); hash.update('\0'); hash.update(bytes); hash.update('\0');
        };
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
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replace(marker, `const CACHE = 'aimtrix-shell-${revision}';`) });
      },
    },
  };
}
