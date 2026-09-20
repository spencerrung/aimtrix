export async function copyMessageText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy clipboard path.
  }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    const restore = document.activeElement === input;
    input.remove();
    if (restore && previous?.isConnected) previous.focus({ preventScroll: true });
  }
}
