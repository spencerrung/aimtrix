import process from 'node:process';
import console from 'node:console';
import { command, invariant } from './stack.mjs';
// CI fallback after a killed runner. Scope is the exact job owner, never a prune.
const owner = process.env.AIMTRIX_LIVE_OWNER;
invariant(owner && /^[a-zA-Z0-9-]{1,100}$/.test(owner), 'test-owner-required');
try {
  const filter = `label=dev.aimtrix.test-owner=${owner}`;
  const containers = (await command('docker', ['ps', '-aq', '--filter', filter])).split('\n').filter(Boolean);
  if (containers.length) await command('docker', ['rm', '--force', '--volumes', ...containers]);
  const networks = (await command('docker', ['network', 'ls', '-q', '--filter', filter])).split('\n').filter(Boolean);
  if (networks.length) await command('docker', ['network', 'rm', ...networks]);
  console.log('Matrix live: job-owned container/network cleanup complete');
} catch { console.log('Matrix live: job-owned cleanup failed'); process.exitCode = 1; }
