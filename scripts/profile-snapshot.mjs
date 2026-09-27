/* global process, Buffer, console */
import { build } from 'vite';
import { cpus, totalmem, platform, release } from 'node:os';
import { resolve } from 'node:path';

const rooms = Number(process.argv.find((arg) => arg.startsWith('--rooms='))?.split('=')[1] ?? 10_000);
const cycles = Number(process.argv.find((arg) => arg.startsWith('--cycles='))?.split('=')[1] ?? 100);
if (!Number.isSafeInteger(rooms) || rooms < 1 || rooms > 20_000) throw new Error('rooms must be between 1 and 20,000');
if (!Number.isSafeInteger(cycles) || cycles < 0 || cycles > 1_000) throw new Error('cycles must be between 0 and 1,000');

const result = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry: resolve('scripts/fixtures/profileSnapshot.ts'), formats: ['es'], fileName: 'profile-snapshot' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const script = output.filter((file) => file.type === 'chunk').map((file) => file.code).join('\n');
const { profileSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
const metrics = profileSnapshot(rooms, cycles);
console.log(JSON.stringify({
  date: new Date().toISOString(),
  workload: { rooms, cycles, emptySyntheticTimelines: true, changedRoomsPerCycle: 1 },
  host: { platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryGiB: Math.round(totalmem() / 2 ** 30) },
  ...metrics,
}, null, 2));
