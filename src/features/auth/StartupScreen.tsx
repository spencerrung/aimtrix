import { BrandMark } from '../../components/BrandMark';

export function StartupScreen({ message = 'Starting Aimtrix…' }: { message?: string }) {
  return (
    <main className="startup-screen" aria-live="polite">
      <BrandMark />
      <span className="spinner spinner--large" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}
