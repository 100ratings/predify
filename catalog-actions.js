import { MAX_TRACKS_PER_LETTER, letters, cleanTrack } from './engine.js?v=1.3.4';
import { candidateScore } from './catalog-import.js?v=1.3.4';

export function sameSong(first, second) {
  if (!first || !second) return false;
  if (first.id && second.id && first.id === second.id) return true;
  return candidateScore(first, second) >= 145 || candidateScore(second, first) >= 145;
}
export function removeCatalogSlot(slots, index) {
  if (!Array.isArray(slots) || slots.length !== MAX_TRACKS_PER_LETTER || !Number.isInteger(index) || index < 0 || index >= slots.length) throw new Error('Posição inválida');
  const ordered = slots.filter((track, position) => position !== index && track);
  return [...ordered, ...Array(MAX_TRACKS_PER_LETTER - ordered.length).fill(null)];
}
export function applySuggestedTrack(slots, letter, suggestion, resolved, options = {}) {
  if (!Array.isArray(slots) || slots.length !== MAX_TRACKS_PER_LETTER) throw new Error('Catálogo inválido');
  const track = cleanTrack(resolved);
  if (letters(track.name)[0] !== letter || !sameSong(track, suggestion)) throw new Error('A música encontrada não corresponde à sugestão da letra ' + letter);
  const forcedIndex = options.forcedIndex ?? null;
  const replacingSlot = options.replacingSlot ?? null;
  const freeIndex = slots.findIndex(item => !item);
  const index = forcedIndex ?? replacingSlot ?? freeIndex;
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TRACKS_PER_LETTER) throw new Error('Esta letra já possui cinco músicas, escolha qual deseja substituir');
  if (slots.some((item, position) => position !== index && sameSong(item, track))) throw new Error('Esta música já está cadastrada nesta letra');
  const result = slots.slice();
  result[index] = track;
  return { slots: result, index };
}
