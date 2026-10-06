import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

// Keep the full observation windows. This command is intentionally longer than
// the hosted Actions budget and runs only against disposable local services.
const profiles = [
  '--profile-sustained-sync',
  '--profile-encrypted-sustained-sync',
  '--profile-large-account',
];
if (process.argv.length > 2) throw new Error('This command takes no arguments.');
const env = { ...process.env,
  AIMTRIX_LIVE_OWNER: process.env.AIMTRIX_LIVE_OWNER || `endurance-${process.pid}-${Date.now()}`,
  AIMTRIX_LIVE_ROOM_COUNT: '10000', AIMTRIX_LIVE_SUSTAINED: '1',
};
let active;
let interrupted = false;
const interrupt = (signal) => { interrupted = true; process.exitCode = 1; active?.kill(signal); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
function run(script, args = []) {
  return new Promise((resolve, reject) => {
    active = spawn(process.execPath, [script, ...args], { env, stdio: 'inherit' });
    active.once('error', reject);
    active.once('exit', (code) => {
      active = undefined;
      if (code === 0) resolve();
      else reject(new Error('endurance-command-failed'));
    });
  });
}
try {
  for (const profile of profiles) {
    if (interrupted) throw new Error('endurance-interrupted');
    await run('tests/live-matrix/run.mjs', [profile]);
  }
} catch {
  console.error('Endurance validation failed or was interrupted; inspect the allowlisted Matrix summaries.');
  process.exitCode = 1;
} finally {
  try { await run('tests/live-matrix/cleanup.mjs'); }
  catch { console.error('Endurance cleanup failed; remove only services with this run’s owner label.'); process.exitCode = 1; }
}
