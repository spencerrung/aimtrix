/**
 * Keep the SDK's first /sync filter stable until it receives a sync token.
 * SDK 42 sends an inline initial filter, then switches to an uploaded filter ID
 * on retry. Some homeservers key in-flight sync work by that raw parameter.
 * Use the public fetchFn hook: no extra request, timeout or body interception.
 */
export function initialSyncFetch(baseUrl: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  const base = new URL(baseUrl);
  const prefix = `${base.pathname.replace(/\/$/, '')}/_matrix/client/`;
  let initialFilter: string | undefined;
  let incremental = false;
  return (input, init) => {
    // The SDK's HTTP adapter passes URL|string, never a Request. Leave other
    // fetch inputs intact, including their body, credentials and abort signal.
    if (incremental || !(typeof input === 'string' || input instanceof URL) || (init?.method ?? 'GET') !== 'GET') return fetcher(input, init);
    let url: URL;
    try { url = new URL(input); } catch { return fetcher(input, init); }
    if (url.origin !== base.origin || !['v3/sync', 'r0/sync'].some((path) => url.pathname === `${prefix}${path}`)) return fetcher(input, init);
    if (url.searchParams.has('since')) {
      incremental = true;
      initialFilter = undefined;
      return fetcher(input, init);
    }
    const filter = url.searchParams.get('filter');
    if (filter?.startsWith('{')) {
      initialFilter = filter;
    } else if (initialFilter && filter) {
      url.searchParams.set('filter', initialFilter);
      return fetcher(url, init);
    }
    return fetcher(input, init);
  };
}
