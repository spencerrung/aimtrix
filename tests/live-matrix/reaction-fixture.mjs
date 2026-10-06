import { Buffer } from 'node:buffer';

// Original, synthetic one-pixel PNG. No provider or account artwork is copied.
export const reactionArtwork = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
export const reactionManifest = { entries: [{ id: 'synthetic-wave', name: 'Synthetic wave', aliases: ['synthetic cheer'], src: '/live-reaction.png' }] };
