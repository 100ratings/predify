export const CUSTOM_ALEATORIEDADES_ART = './icons/aleatoriedades-demian.webp';

export function playlistCoverAssets(playlist) {
  if (!playlist) return { primary: '', fallback: '' };
  // The Spotify playlist image is not the same as the first track's album art
  const spotifyCover = playlist.coverUrl || playlist.images?.[0]?.url || '';
  const firstAlbum = playlist.firstAlbumUrl || '';
  const normalized = String(playlist.name || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'aleatoriedades - demian' || normalized === 'aleatoriedades – demian') {
    return { primary: CUSTOM_ALEATORIEDADES_ART, fallback: spotifyCover || firstAlbum };
  }
  return {
    primary: spotifyCover || firstAlbum,
    fallback: spotifyCover && firstAlbum && spotifyCover !== firstAlbum ? firstAlbum : ''
  };
}
