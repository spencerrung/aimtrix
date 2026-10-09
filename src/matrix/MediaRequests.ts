import type { MediaRequest } from './mediaContext';

type Entry = {
  abort: AbortController;
  request: Promise<string | undefined>;
  consumers: number;
  url?: string;
  disposed: boolean;
};

/** Only active consumers retain media; the unused byte/entry budget is zero. */
export class MediaRequests {
  private readonly entries = new Map<string, Entry>();

  public acquire(key: string, load: (signal: AbortSignal) => Promise<Blob | undefined>): MediaRequest & { release: () => void } {
    let entry = this.entries.get(key);
    if (!entry) {
      const created: Entry = { abort: new AbortController(), request: Promise.resolve(undefined), consumers: 0, disposed: false };
      created.request = Promise.resolve()
        .then(() => created.disposed ? undefined : load(created.abort.signal))
        .then((blob) => {
          if (!blob || created.disposed) return undefined;
          created.url = URL.createObjectURL(blob);
          return created.url;
        })
        .catch(() => undefined)
        .then((url) => {
          if (!url) {
            if (this.entries.get(key) === created) this.entries.delete(key);
            this.dispose(created);
          }
          return url;
        });
      this.entries.set(key, created);
      entry = created;
    }
    const owned = entry;
    owned.consumers++;
    let released = false;
    return Object.assign(owned.request.then((url) => released || owned.disposed ? undefined : url), {
      release: () => {
        if (released) return;
        released = true;
        owned.consumers--;
        if (owned.consumers === 0) {
          if (this.entries.get(key) === owned) this.entries.delete(key);
          this.dispose(owned);
        }
      },
    });
  }

  public clear(): void {
    for (const entry of this.entries.values()) this.dispose(entry);
    this.entries.clear();
  }

  private dispose(entry: Entry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    entry.abort.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = undefined;
  }
}
