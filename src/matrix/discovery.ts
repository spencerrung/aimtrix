export interface HomeserverTarget {
  serverName: string;
  baseUrl: string;
  discovered: boolean;
}

interface DiscoverOptions {
  homeserverInput: string;
  userId: string;
  configuredServerName: string;
  configuredBaseUrl: string;
  fetcher?: typeof fetch;
}

function serverNameFromUserId(userId: string): string | undefined {
  const separator = userId.lastIndexOf(':');
  if (!userId.startsWith('@') || separator < 2 || separator === userId.length - 1) return undefined;
  return userId.slice(separator + 1).trim().toLowerCase();
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    const localHttp =
      parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export async function resolveHomeserver({
  homeserverInput,
  userId,
  configuredServerName,
  configuredBaseUrl,
  fetcher = fetch,
}: DiscoverOptions): Promise<HomeserverTarget> {
  const input = homeserverInput.trim();
  const directUrl = normalizeHttpUrl(input);
  if (directUrl) {
    return { serverName: serverNameFromUserId(userId) ?? input, baseUrl: directUrl, discovered: false };
  }

  const serverName = (input || serverNameFromUserId(userId) || configuredServerName).toLowerCase();
  if (!serverName || /[\s/]/.test(serverName)) {
    throw new Error('Enter a Matrix ID such as @you:example.com or a valid homeserver.');
  }

  if (serverName === configuredServerName.toLowerCase()) {
    return {
      serverName,
      baseUrl: configuredBaseUrl.replace(/\/$/, ''),
      discovered: false,
    };
  }

  try {
    const response = await fetcher(`https://${serverName}/.well-known/matrix/client`, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        'm.homeserver'?: { base_url?: unknown };
      };
      const discoveredUrl = normalizeHttpUrl(
        typeof body['m.homeserver']?.base_url === 'string'
          ? body['m.homeserver'].base_url
          : '',
      );
      if (discoveredUrl) return { serverName, baseUrl: discoveredUrl, discovered: true };
    }
  } catch {
    // Matrix permits the server-name itself as a fallback when discovery is absent.
  }

  return { serverName, baseUrl: `https://${serverName}`, discovered: false };
}
