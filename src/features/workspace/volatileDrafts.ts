/** Unsent text only: tab memory, never browser storage or Matrix account data. */
export class VolatileDrafts {
  private account?: string;
  private value = { rooms: {} as Record<string, string>, threads: {} as Record<string, string> };
  read(account: string) {
    if (this.account !== account) { this.clear(); this.account = account; }
    return this.value;
  }
  write(account: string, rooms: Record<string, string>, threads: Record<string, string>) {
    if (this.account === account) this.value = { rooms, threads };
  }
  clear() { this.account = undefined; this.value = { rooms: {}, threads: {} }; }
}
