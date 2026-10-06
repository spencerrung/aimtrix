import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export function validateVersion(version) {
  // Build metadata uses '+', which Docker image tags cannot represent.
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version ?? '');
  if (!match || version.length > 128 || match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('A valid explicit vMAJOR.MINOR.PATCH or prerelease image version is required.');
  }
  return { version, publishLatest: !match[4] };
}

export function validatePublication({ version, packageVersion, ref, headSha, expectedSha, tagSha }) {
  const result = validateVersion(version);
  if (ref !== 'refs/heads/main') throw new Error('Image publication must be dispatched from main.');
  if (packageVersion !== version.slice(1)) throw new Error('Package version does not match the publication version.');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedSha ?? '') || headSha !== expectedSha || tagSha !== expectedSha) {
    throw new Error('Release tag, checked-out commit, and dispatched commit must match.');
  }
  return result;
}

export function resolveReleaseTag(version, cwd) {
  validateVersion(version);
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `refs/tags/${version}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('The release tag must already exist and resolve to a commit.');
  }
}

/** Public anonymous pull token only; no publisher credentials or response bodies are logged. */
export async function assertImageVersionAbsent(repository, version, fetcher = globalThis.fetch) {
  validateVersion(version);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(repository ?? '')) throw new Error('Invalid image repository.');
  let response;
  try {
    const tokenResponse = await fetcher(`https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`, { signal: globalThis.AbortSignal.timeout(30000) });
    if (!tokenResponse.ok) throw new Error();
    const { token } = await tokenResponse.json();
    if (typeof token !== 'string' || !token) throw new Error();
    response = await fetcher(`https://registry-1.docker.io/v2/${repository}/manifests/${version}`, {
      method: 'HEAD', signal: globalThis.AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' },
    });
  } catch {
    throw new Error('Could not verify remote version availability; publication is blocked.');
  }
  if (response.ok) throw new Error('This immutable image version already exists; choose a new version.');
  if (response.status !== 404) throw new Error('Registry did not confirm version absence; publication is blocked.');
}

async function main() {
  const version = process.env.RELEASE_VERSION;
  if (process.argv[2] === 'check-image') {
    await assertImageVersionAbsent(process.env.IMAGE_REPOSITORY, version);
    return;
  }
  if (process.argv[2] !== 'validate') throw new Error('Expected validate or check-image.');
  const result = validatePublication({ version, ref: process.env.GITHUB_REF, expectedSha: process.env.GITHUB_SHA,
    packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    headSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    tagSha: resolveReleaseTag(version),
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\npublish_latest=${result.publishLatest}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
