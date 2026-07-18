import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface GifChoice {
  id: string;
  title: string;
  previewUrl: string;
  mediaUrl: string;
}

function validChoice(value: unknown): value is GifChoice {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Record<string, unknown>;
  return ['id', 'title', 'previewUrl', 'mediaUrl'].every((key) => typeof choice[key] === 'string');
}

export function GifPicker({
  endpoint,
  onSelect,
}: {
  endpoint: string;
  onSelect: (gif: GifChoice) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifChoice[]>([]);
  const [status, setStatus] = useState('Type to search your configured GIF provider.');

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const url = new URL(endpoint);
      url.searchParams.set('q', query.trim());
      url.searchParams.set('limit', '18');
      setStatus('Searching GIFs…');
      void fetch(url, { signal: controller.signal, credentials: 'omit' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const value: unknown = await response.json();
          const candidates = Array.isArray(value)
            ? value
            : value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results)
              ? (value as { results: unknown[] }).results
              : [];
          const valid = candidates.filter(validChoice).slice(0, 18);
          setResults(valid);
          setStatus(valid.length ? '' : 'No GIFs found.');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
          setStatus('The GIF provider could not be reached.');
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, query]);

  return (
    <div className="gif-picker" aria-label="GIF search">
      <label><Search size={14} /><span className="sr-only">Search GIFs</span><input autoFocus value={query} onChange={(event) => {
        const nextQuery = event.target.value;
        setQuery(nextQuery);
        if (!nextQuery.trim()) {
          setResults([]);
          setStatus('Type to search your configured GIF provider.');
        }
      }} placeholder="Search GIFs" /></label>
      {status ? <p role="status">{status}</p> : null}
      <div className="gif-grid">
        {results.map((gif) => (
          <button type="button" key={gif.id} aria-label={`Send GIF: ${gif.title}`} onClick={() => onSelect(gif)}>
            <img src={gif.previewUrl} alt={gif.title} loading="lazy" referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>
      <small>GIFs are fetched through the provider configured by this Aimtrix host, then uploaded to Matrix.</small>
    </div>
  );
}
