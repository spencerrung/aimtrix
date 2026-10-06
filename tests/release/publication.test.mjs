import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { validatePublication, validateVersion, resolveReleaseTag, assertImageVersionAbsent } from '../../scripts/validate-image-publication.mjs';

const sha = 'a'.repeat(40);
const candidate = { version: 'v0.3.0-rc.6', packageVersion: '0.3.0-rc.6', ref: 'refs/heads/main', headSha: sha, expectedSha: sha, tagSha: sha };

test('only validated stable releases update latest', () => {
  assert.deepEqual(validatePublication(candidate), { version: 'v0.3.0-rc.6', publishLatest: false });
  assert.equal(validatePublication({ ...candidate, version: 'v0.3.0', packageVersion: '0.3.0' }).publishLatest, true);
  assert.equal(validateVersion('v1.2.3-beta.0').publishLatest, false);
});

test('blank, malformed, Docker-incompatible, and injected version inputs fail closed', () => {
  for (const version of [undefined, '', 'latest', '0.3.0', 'v01.2.3', 'v1.2.3-01', 'v1.2.3-rc..1', 'v1.2.3+build', 'v1.2.3\nlatest', 'v1.2.3;echo unsafe', 'v1.2.3-$(echo unsafe)', `v1.2.3-${'a'.repeat(130)}`]) {
    assert.throws(() => validateVersion(version));
  }
});

test('wrong branch, package version, missing tag, and commit mismatches cannot publish', () => {
  for (const patch of [{ ref: 'refs/heads/feature' }, { ref: 'refs/tags/v0.3.0-rc.6' }, { packageVersion: '0.3.0-rc.5' }, { tagSha: undefined }, { tagSha: 'b'.repeat(40) }, { headSha: 'b'.repeat(40) }, { expectedSha: '' }, { expectedSha: 'a'.repeat(41), headSha: 'a'.repeat(41), tagSha: 'a'.repeat(41) }]) {
    assert.throws(() => validatePublication({ ...candidate, ...patch }));
  }
});

test('existing annotated and lightweight git tags resolve to their exact commit', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aimtrix-release-tags-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    git('init');
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Synthetic release');
    const first = git('rev-parse', 'HEAD');
    git('tag', 'v1.0.0');
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'tag', '-a', 'v1.0.1', '-m', 'Annotated');
    assert.equal(resolveReleaseTag('v1.0.0', cwd), first);
    assert.equal(resolveReleaseTag('v1.0.1', cwd), first);
    git('branch', 'v1.0.2');
    assert.throws(() => resolveReleaseTag('v1.0.2', cwd), /must already exist/);
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Later commit');
    assert.throws(() => validatePublication({ ...candidate, version: 'v1.0.1', packageVersion: '1.0.1', tagSha: resolveReleaseTag('v1.0.1', cwd), expectedSha: git('rev-parse', 'HEAD'), headSha: git('rev-parse', 'HEAD') }), /must match/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('workflow CLI validates the checkout before emitting publication outputs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aimtrix-publication-cli-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const script = fileURLToPath(new URL('../../scripts/validate-image-publication.mjs', import.meta.url));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '1.0.0-rc.1' }));
    git('init'); git('add', 'package.json');
    git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Synthetic package');
    git('tag', 'v1.0.0-rc.1');
    const output = join(cwd, 'output');
    const env = { ...process.env, RELEASE_VERSION: 'v1.0.0-rc.1', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output };
    const run = (patch) => spawnSync(process.execPath, [script, 'validate'], { cwd, env: { ...env, ...patch }, encoding: 'utf8' });
    const valid = run({});
    assert.ifError(valid.error);
    assert.equal(valid.status, 0, valid.stderr + valid.stdout);
    assert.equal(readFileSync(output, 'utf8'), 'version=v1.0.0-rc.1\npublish_latest=false\n');
    writeFileSync(output, '');
    assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.equal(run({ RELEASE_VERSION: '' }).status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function registry(status) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? { ok: true, json: async () => ({ token: 'synthetic-public-pull-token' }) }
      : { ok: status >= 200 && status < 300, status };
  };
  return { calls, fetcher };
}

test('only registry 404 permits a new immutable version, using anonymous pull credentials', async () => {
  const { fetcher, calls } = registry(404);
  await assertImageVersionAbsent('spencerrung/aimtrix', candidate.version, fetcher);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'HEAD');
  assert.match(calls[0].url, /repository%3Aspencerrung%2Faimtrix%3Apull$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-public-pull-token');
  for (const status of [200, 401, 403, 429, 500, 503]) {
    await assert.rejects(assertImageVersionAbsent('spencerrung/aimtrix', candidate.version, registry(status).fetcher));
  }
});

test('network/auth uncertainty blocks publication and never forwards response secrets', async () => {
  for (const fetcher of [async () => { throw new Error('synthetic-sensitive-upstream-text'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({}) })]) {
    await assert.rejects(assertImageVersionAbsent('spencerrung/aimtrix', candidate.version, fetcher), (error) => error.message === 'Could not verify remote version availability; publication is blocked.');
  }
  await assert.rejects(assertImageVersionAbsent('https://untrusted.invalid', candidate.version, registry(404).fetcher), /Invalid image repository/);
});
