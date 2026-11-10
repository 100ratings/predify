import { createPlaylistCache, PLAYLIST_CACHE_KEY } from './playlist-cache.js?v=1.3.14';
import { recordDiagnostic, diagnosticReport, diagnosticFetch, diagnosticSummary, beginDiagnosticTest, endDiagnosticTest, currentDiagnosticTest } from './diagnostics.js?v=1.3.14';
import { ALPHABET, MAX_TRACKS_PER_LETTER, MIN_TRACKS_PER_LETTER, catalogHealth, DEFAULT_PHRASE, letters, emptyCatalog, spotifyId, cleanTrack, validateCatalog, validateOpening, validateOpeningDraft, openingConflicts, checkOpeningCandidate, buildSequence, moveCatalogTrack } from './engine.js?v=1.3.14';
import { SEARCH_PAGE_SIZE, searchPage } from './catalog-search.js?v=1.3.14';
import { SUGGESTIONS } from './suggestions.js?v=1.3.14';
import { auth, connect, disconnect, finishLogin, myPlaylists, trackFromLink, playlistTracks, playlistCoverImages, replacePlaylist, searchTracks, resolveCatalogCandidate } from './spotify.js?v=1.3.14';
import { validateCandidateCatalog } from './catalog-import.js?v=1.3.14';
import { playlistCoverAssets } from './playlist-cover.js?v=1.3.14';
import { sameSong, removeCatalogSlot, applySuggestedTrack } from './catalog-actions.js?v=1.3.14';
import { preventZoom } from './zoom.js?v=1.3.14';
import { watchAppUpdates } from './updates.js?v=1.3.14';
import { viewportLayout, keyboardComposerScrollDelta, MANUAL_KEYBOARD_OFFSET_PX } from './viewport.js?v=1.3.14';
import { validInjectId, INJECT_ID_KEY, fetchInjectSelection, createInjectMonitor } from './inject.js?v=1.3.14';
import { remoteKey, saveRemoteKey, consumeRemoteLink, remoteRequest, REMOTE_KEY_STORAGE, isNewRemoteConfirmation, remoteStatusInterval } from './remote.js?v=1.3.14';
try { consumeRemoteLink(); } catch { /* A malformed pairing link must not break the app */ }
let remoteState = { active: false };
let remoteBusy = false, remoteReading = false, remoteUnknown = !!remoteKey();
let remoteMessage = '';
let remoteConfigOpen = false;
let lastRemoteStatusAt = 0, remoteStatusFailed = false;
let remoteRevision = 0;
let lastRemoteAuthSync = 0;
const remoteOwnsPlaylist = () => remoteBusy || remoteUnknown || remoteState.active;
const $ = id => document.getElementById(id);
const DATA_KEY = 'predify.data.v1';
const LAST_SUCCESS_KEY = 'predify.last-success.v1';
// Screen wake-lock implementation is retained in keep-awake.js for future use
// No wake lock is requested while its control is removed from the interface

function loadLastSuccess() {
  try {
    const item = JSON.parse(localStorage.getItem(LAST_SUCCESS_KEY));
    return item && spotifyId(item.playlist, 'playlist') && typeof item.word === 'string' && item.word.trim()
      ? { playlist: item.playlist, word: item.word.trim().slice(0, 100), at: Number.isFinite(item.at) ? item.at : 0 }
      : null;
  } catch { return null; }
}
function loadData() {
  try {
    const data = JSON.parse(localStorage.getItem(DATA_KEY));
    if (!data) return { catalog: emptyCatalog(), opening: null, openingDraft: null, catalogWarnings: {}, playlist: '' };
    const legacy = ALPHABET.some(letter => Array.isArray(data.catalog?.[letter]) && data.catalog[letter].length > MAX_TRACKS_PER_LETTER);
    if (legacy && !localStorage.getItem('predify.backup.before-five.v1')) {
      try { localStorage.setItem('predify.backup.before-five.v1', JSON.stringify({saved_at:new Date().toISOString(),catalog:data.catalog,opening:data.opening,openingDraft:data.openingDraft})); }
      catch { /* The original remains in predify.data.v1 until the next save */ }
    }
    const compact = Object.fromEntries(ALPHABET.map(letter => [letter, (data.catalog?.[letter] || []).filter(Boolean).slice(0, MAX_TRACKS_PER_LETTER)]));
    const catalog = validateCatalog(compact);
    const opening = data.opening ? { phrase: data.opening.phrase, tracks: validateOpening(data.opening.phrase, data.opening.tracks) } : null;
    let openingDraft = null;
    try { if (data.openingDraft) openingDraft = validateOpeningDraft(data.openingDraft.phrase, data.openingDraft.tracks); } catch { /* Keep saved catalog and opening even if a draft is invalid */ }
    return { catalog, opening, openingDraft, catalogWarnings: data.catalogWarnings && typeof data.catalogWarnings === 'object' && !Array.isArray(data.catalogWarnings) ? data.catalogWarnings : {}, playlist: spotifyId(data.playlist, 'playlist') || '' };
  } catch { return { catalog: emptyCatalog(), opening: null, openingDraft: null, catalogWarnings: {}, playlist: '' }; }
}
let data = loadData();
let lastSuccessfulSend = loadLastSuccess();
let selectedLetter = 'A';
const playlistCache = createPlaylistCache();
let playlists = [];
let sequence = { tracks: [], missing: [], error: '' };
let sending = false;
let loadingLists = false;
let toastTimer;
let searchTimer;
let replacingSlot = null;
let reorderMode = false;
let openingPosition = null;
let openingSearchToken = 0;
let openingSearch = { tracks: [], offset: 0, more: false, page: 0, loading: false };
let playlistItems = [];
let playlistLoadedFor = '';
let playlistLoading = false;
let playlistBusy = false;
let playlistRequest = 0;
let importingCatalog = false;
let cancelCatalogImport = false;
let suggestionBusy = false;
let catalogSpotifySearchActive = false;
let replacementSuggestion = null;
let spotifyConnectionError = '';
const searchCache = new Map();
function currentSearchKey() { return selectedLetter + ':' + $('catalog-search').value.trim(); }
function selectLetter(letter) {
  selectedLetter = letter; replacingSlot = null; replacementSuggestion = null; reorderMode = false;
  clearTimeout(searchTimer); $('catalog-search').value = '';
  catalogSpotifySearchActive = false;
  paintCatalog();
}
function persist() { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
function paintLastSuccessfulWord() {
  const indicator = $('last-success-word');
  const show = !!lastSuccessfulSend && lastSuccessfulSend.playlist === data.playlist;
  indicator.hidden = !show;
  indicator.textContent = show ? '✓ Última: ' + lastSuccessfulSend.word.toLocaleUpperCase('pt-BR') : '';
  indicator.title = show ? 'Última palavra enviada com sucesso: ' + lastSuccessfulSend.word : '';
}
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 10000 : 5000);
}
function setView(view) {
  if (!['perform', 'catalog', 'settings'].includes(view)) view = 'perform';
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === view + '-view'));
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('scroll-area').scrollTop = 0;
  history.replaceState(null, '', '#' + view);
  if (view === 'catalog') paintCatalog();
  if (view === 'settings') paintDiagnostics();
}
function paintAccount(me) {
  const connected = !!auth();
  $('connection-dot').classList.toggle('online', connected);
  $('connection-label').textContent = connected ? 'Conectado' : 'Conectar';
  $('account-state').textContent = connected ? 'Conectada' : 'Desconectada';
  $('account-name').textContent = me ? me.display_name || 'Conta conectada ao Spotify' : connected ? 'Sessão salva neste aparelho' : 'Conecte a conta que possui suas playlists';
  $('connect').hidden = connected; $('disconnect').hidden = !connected;
  $('connect').disabled = connected;
  const error = $('spotify-connection-error');
  error.hidden = !spotifyConnectionError;
  error.textContent = spotifyConnectionError;
  updateButton();
}
function updateButton() {
  $('update').disabled = remoteOwnsPlaylist() || sending || playlistBusy || playlistLoading || importingCatalog || !auth() || !data.playlist || !playlists.some(p => p.id === data.playlist) || !!sequence.error || !sequence.tracks.length;
  $('update').querySelector('span').textContent = sending ? 'Atualizando…' : 'Atualizar playlist';
  $('playlist').disabled = remoteOwnsPlaylist() || sending || playlistBusy || loadingLists || !auth();
  $('person-name').disabled = sending;
  $('reload-playlists').disabled = loadingLists || sending || !auth();
  paintRemote();
}
function cover(track, className = 'cover') {
  const element = node('div', className, '♫');
  if (track?.image) { const image = node('img'); image.src = track.image; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.onerror = () => element.replaceChildren(document.createTextNode('♫')); element.replaceChildren(image); }
  return element;
}
function paintPlaylist() {
  paintLastSuccessfulWord();
  const selected = playlists.find(playlist => playlist.id === data.playlist);
  $('playlist-art').replaceChildren(document.createTextNode('♫'));
  const art = playlistCoverAssets(selected);
  if (art.primary) {
    const image = node('img');
    image.src = art.primary;
    image.alt = '';
    image.loading = 'eager';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => {
      if (art.fallback && !image.dataset.fallbackUsed) {
        image.dataset.fallbackUsed = 'yes';
        image.src = art.fallback;
      } else {
        image.remove();
      }
    };
    $('playlist-art').replaceChildren(image);
  }
  $('playlist-meta').textContent = selected ? `${selected.items?.total ?? selected.tracks?.total ?? 0} ${(selected.items?.total ?? selected.tracks?.total ?? 0) === 1 ? 'música' : 'músicas'} · ${selected.public === true ? 'Pública' : selected.public === false ? 'Privada' : 'Sua playlist'}` : auth() ? 'Escolha uma playlist criada por você' : 'Conecte sua conta em Ajustes';
  updateButton();
}
function restoreSavedPlaylists() {
  recordDiagnostic('cache-hit',{operation:'startup',apiCalls:0});
  playlistCache.reload();
  playlistRequest++;
  playlists = auth() ? playlistCache.list() : [];
  if (auth() && data.playlist && !playlists.some(p=>p.id === data.playlist)) {
    playlists.push({id:data.playlist,name:'Playlist salva'});
  }
  $('playlist').replaceChildren(new Option(auth() ? 'Selecione uma playlist, use ↻ para buscar novas' : 'Conecte o Spotify',''));
  playlists.forEach(p=>$('playlist').append(new Option(p.name,p.id)));
  $('playlist').value = data.playlist;
  const saved = auth() ? playlistCache.details(data.playlist) : null;
  playlistItems = saved?.items || []; playlistLoadedFor = saved ? data.playlist : '';
  playlistLoading = false;
  $('playlist-cache-status').textContent = auth() ? 'Dados salvos no aparelho, use ↻ para buscar mudanças no Spotify' : '';
  paintAccount(auth() ? playlistCache.profile() : null); paintPlaylist();
}
function saveCurrentPlaylistCache(selected,items) {
  if (!playlistCache.saveDetails(selected,items)) {
    $('playlist-cache-status').textContent = 'Playlist carregada, não foi possível guardar todas as músicas no aparelho';
  }
}
async function loadPlaylists() {
  if (loadingLists || !auth()) return;
  recordDiagnostic('playlist-reload',{operation:'playlist-reload'});
  loadingLists = true; updateButton();
  try {
    const result = await myPlaylists(); playlists = result.items;
    spotifyConnectionError = ''; paintAccount(result.me); playlistCache.saveList(playlists,result.me);
    $('playlist').replaceChildren(new Option('Selecione uma playlist', ''));
    playlists.forEach(playlist => $('playlist').append(new Option(playlist.name, playlist.id)));
    if (!playlists.some(playlist => playlist.id === data.playlist)) data.playlist = '';
    $('playlist').value = data.playlist;
    persist(); paintPlaylist(); await refreshPlaylistItems({ force:true });
    if (!playlists.length) toast('Crie uma playlist na sua conta do Spotify e toque em recarregar');
  } catch (error) {
    spotifyConnectionError = 'Não foi possível carregar suas playlists: ' + error.message;
    toast(spotifyConnectionError, true);
    if (!playlists.length && data.playlist) {
      $('playlist').replaceChildren(new Option('Playlist salva, consulta ao Spotify indisponível', data.playlist));
    } else if (!playlists.length) {
      $('playlist').replaceChildren(new Option('Playlists indisponíveis, confira o aviso', ''));
    }
    paintAccount();
  }
  finally { loadingLists = false; updateButton(); }
}
function renderPreview(regenerate = true) {
  if (regenerate) {
    const conflicts = openingConflicts(data.opening, data.catalog);
    sequence = conflicts.length
      ? { tracks: [], missing: [], error: 'A abertura fixa tem músicas repetidas ou também usadas no catálogo, corrija em Ajustes antes de enviar' }
      : buildSequence({ name: $('person-name').value, catalog: data.catalog, opening: data.opening });
  }
  const normalized = letters($('person-name').value);
  $('name-letters').textContent = normalized ? normalized.split('').join(' · ') : 'Vamos ver onde isso vai dar';
  paintLastSuccessfulWord();
  $('preview-count').textContent = `${sequence.tracks.length} faixas`;
  $('preview').replaceChildren();
  $('readiness').classList.toggle('ready', !sequence.error);
  $('readiness').textContent = sequence.error || (data.opening?.tracks?.length ? `${data.opening.phrase} ${$('person-name').value.trim()}` : `Somente a palavra · ${$('person-name').value.trim()}`).toLocaleUpperCase('pt-BR');
  if (!sequence.tracks.length) {
    const empty = node('div', 'empty-preview');
    empty.append(node('div', 'empty-icon', '♫'), node('p', '', normalized ? 'Seu repertório prepara a revelação' : 'Digite uma palavra para montar a playlist'));
    $('preview').append(empty);
  } else {
    let previousSection;
    sequence.tracks.forEach((track, index) => {
      if (track.section !== previousSection) {
        $('preview').append(node('div', 'track-section ' + (track.section === 'name' ? 'name-section' : ''), track.section === 'name' ? 'A PALAVRA' : 'ABERTURA FIXA'));
        previousSection = track.section;
      }
      const row = node('div', 'track-row'); const text = node('div', 'track-text'); const title = node('span', 'track-name');
      title.append(node('b', '', track.name.slice(0, 1)), document.createTextNode(track.name.slice(1)));
      text.append(title, node('span', 'track-artist', track.artist));
      row.append(node('span', 'track-number', String(index + 1).padStart(2, '0')), cover(track), text, node('span', 'track-letter', track.letter));
      $('preview').append(row);
    });
  }
  updateButton();
}
function clearCatalogWarning(letter, track) {
  if (!data.catalogWarnings?.[letter]) return;
  data.catalogWarnings[letter] = data.catalogWarnings[letter].filter(entry => letters(entry.name) !== letters(track.name));
}
function paintCatalog() {
  const health = catalogHealth(data.catalog, data.opening, data.openingDraft, data.catalogWarnings);
  $('catalog-total').textContent = health.total;
  $('catalog-completeness').textContent = health.percentage + '%';
  $('catalog-progress').style.width = health.percentage + '%';
  $('catalog-progress-bar').setAttribute('aria-valuenow', String(health.percentage));
  $('catalog-ready-count').textContent = health.ready + ' de 26 letras completas, mínimo ' + MIN_TRACKS_PER_LETTER + ' músicas por letra';
  const problemLetters = ALPHABET.filter(letter => health.byLetter[letter].problems.length);
  const alerts = $('catalog-alerts');
  alerts.hidden = !problemLetters.length; alerts.replaceChildren();
  if (problemLetters.length) {
    alerts.append(node('strong','', 'Conflitos encontrados nas letras: ' + problemLetters.join(', ')));
    for (const letter of problemLetters) {
      const jump = node('button','catalog-issue-jump',letter + ' · ' + health.byLetter[letter].problems[0]);
      jump.type = 'button';
      jump.onclick = () => { if (selectedLetter !== letter) selectLetter(letter); $('letter-problems').scrollIntoView({block:'nearest',behavior:'smooth'}); };
      alerts.append(jump);
    }
  }
  $('alphabet').replaceChildren();
  ALPHABET.forEach(letter => {
    const h = health.byLetter[letter];
    const button = node('button', letter === selectedLetter ? 'active' : h.complete ? 'filled' : h.count ? 'has-tracks' : '', letter);
    button.classList.toggle('catalog-error', h.problems.length > 0);
    button.classList.toggle('catalog-incomplete', !h.complete && !h.problems.length);
    button.setAttribute('aria-label', 'Letra ' + letter + ', ' + h.percentage + '%' + (h.problems.length ? ', com conflito' : ''));
    button.setAttribute('aria-pressed', String(letter === selectedLetter));
    button.onclick = () => selectLetter(letter);
    $('alphabet').append(button);
  });
  const h = health.byLetter[selectedLetter];
  $('current-letter').textContent = selectedLetter;
  $('letter-count').textContent = h.count + ' de ' + MAX_TRACKS_PER_LETTER + ' músicas, ' + h.percentage + '%';
  const detail = $('letter-problems');
  detail.replaceChildren();
  if (h.count < MIN_TRACKS_PER_LETTER) detail.append(node('p', '', 'Faltam ' + (MIN_TRACKS_PER_LETTER-h.count) + ' músicas para completar esta letra'));
  for (const issue of h.problems) detail.append(node('p', '', issue));
  detail.hidden = !detail.childNodes.length;
  const savedCount = data.catalog[selectedLetter].filter(Boolean).length;
  $('reorder').disabled = savedCount < 2;
  $('reorder').textContent = reorderMode ? 'Concluir' : 'Reorganizar';
  $('reorder').setAttribute('aria-pressed', String(reorderMode));
  $('reorder-hint').hidden = !reorderMode;
  $('catalog-slots').replaceChildren();
  data.catalog[selectedLetter].forEach((track, index) => {
    if (reorderMode && !track) return;
    const letter = selectedLetter;
    const slot = node('section', 'slot'); const header = node('div', 'slot-header'); const info = node('div', 'track-text');
    info.append(node('span', 'track-name', track ? track.name : `Música ${index + 1}`), node('span', 'track-artist', track ? track.artist : `Escolha uma música que comece com ${letter}`));
    header.append(node('span', 'slot-number', String(index + 1).padStart(2, '0')), cover(track), info);
    if (track && !reorderMode) {
      const remove = node('button', 'remove-slot', '×'); remove.setAttribute('aria-label', `Remover ${track.name}`);
      remove.onclick = () => {
        if (suggestionBusy) { toast('Conclua a adição em andamento antes de remover músicas', true); return; }
        replacingSlot = null; replacementSuggestion = null;
        data.catalog[letter] = removeCatalogSlot(data.catalog[letter], index);
        persist(); paintCatalog(); renderPreview();
      };
      header.append(remove);
    }
    if (reorderMode) {
      slot.classList.add('reordering');
      const handle = node('button', 'reorder-handle', '⠿');
      handle.type = 'button';
      handle.setAttribute('aria-label', 'Arrastar ' + track.name + ' para mudar a prioridade');
      handle.addEventListener('pointerdown', event => startReorderDrag(event, letter, index, slot, handle));
      header.prepend(handle);
      const actions = node('div', 'reorder-actions');
      const up = node('button', 'reorder-step', '↑');
      up.type = 'button'; up.disabled = index === 0; up.setAttribute('aria-label', 'Subir ' + track.name + ' na prioridade');
      up.onclick = () => changePriority(letter, index, index - 1);
      const down = node('button', 'reorder-step', '↓');
      down.type = 'button'; down.disabled = index === savedCount - 1; down.setAttribute('aria-label', 'Descer ' + track.name + ' na prioridade');
      down.onclick = () => changePriority(letter, index, index + 1);
      actions.append(up, down);
      slot.append(header, actions); $('catalog-slots').append(slot);
      return;
    }
    const choose = node('button', 'choose-track', track ? 'Trocar no Spotify' : 'Escolher no Spotify');
    choose.setAttribute('aria-label', `${track ? 'Trocar' : 'Escolher'} música ${index + 1} da letra ${letter} no Spotify`);
    choose.onclick = () => {
      replacingSlot = index; replacementSuggestion = null; paintCatalog();
      $('search-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    const fallback = node('details', 'link-fallback'); fallback.append(node('summary', '', 'Ou colar um link'));
    const actions = node('form', 'slot-actions'); const input = node('input');
    input.type = 'text'; input.inputMode = 'url'; input.placeholder = 'Cole o link da música'; input.setAttribute('aria-label', `Link da música ${index + 1} da letra ${letter}`); input.autocomplete = 'off'; input.spellcheck = false;
    const save = node('button', 'slot-save', track ? 'Trocar' : 'Salvar'); save.type = 'submit';
    actions.append(input, save);
    actions.onsubmit = async event => {
      event.preventDefault();
      if (!auth()) { toast('Conecte o Spotify em Ajustes antes de cadastrar músicas', true); return; }
      save.disabled = true; input.disabled = true; save.textContent = '…';
      try {
        const found = cleanTrack(await trackFromLink(input.value));
        if (letters(found.name)[0] !== letter) throw new Error(`“${found.name}” não começa com ${letter}`);
        if (data.catalog[letter].some((other, otherIndex) => otherIndex !== index && other?.id === found.id)) throw new Error('Essa música já está cadastrada nesta letra');
        if (reservedForOpening(found)) throw new Error('Esta música já pertence à abertura fixa, escolha outra para o catálogo');
        data.catalog[letter][index] = found; clearCatalogWarning(letter, found); persist(); paintCatalog(); renderPreview(); toast(`Música salva na letra ${letter}`);
      } catch (error) { toast(error.message, true); save.disabled = false; input.disabled = false; save.textContent = track ? 'Trocar' : 'Salvar'; }
    };
    fallback.append(actions); slot.append(header, choose, fallback); $('catalog-slots').append(slot);
  });
  paintSuggestedResults();
  paintSearchResults();
}
function changePriority(letter, from, to) {
  if (!reorderMode || letter !== selectedLetter) return;
  data.catalog[letter] = moveCatalogTrack(data.catalog, letter, from, to);
  persist(); paintCatalog(); renderPreview();
}
function startReorderDrag(event, letter, index, slot, handle) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const rows = [...$('catalog-slots').querySelectorAll('.slot.reordering')];
  if (rows.length < 2) return;
  event.preventDefault();
  const original = slot.getBoundingClientRect();
  const startY = event.clientY;
  let destination = index;
  slot.classList.add('dragging');
  handle.setPointerCapture?.(event.pointerId);
  const onMove = move => {
    if (move.pointerId !== event.pointerId) return;
    slot.style.transform = 'translateY(' + (move.clientY - startY) + 'px)';
    let closest = Infinity;
    rows.forEach((row, position) => {
      const rect = row === slot ? original : row.getBoundingClientRect();
      const distance = Math.abs(move.clientY - (rect.top + rect.height / 2));
      if (distance < closest) { closest = distance; destination = position; }
    });
    rows.forEach((row, position) => row.classList.toggle('drop-target', position === destination && position !== index));
  };
  const finish = end => {
    if (end.pointerId !== event.pointerId) return;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    slot.style.transform = '';
    slot.classList.remove('dragging');
    rows.forEach(row => row.classList.remove('drop-target'));
    if (end.type === 'pointerup' && destination !== index) changePriority(letter, index, destination);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}
function openingSongIds() {
  return new Set([...(data.opening?.tracks || []), ...(data.openingDraft?.tracks || [])].filter(Boolean).map(track => track.id));
}
function beginOpeningDraft() {
  const phrase = $('opening-phrase').value.trim();
  const normalized = letters(phrase);
  if (!normalized || normalized.length > 70) { toast('Use uma frase entre 1 e 70 letras', true); return false; }
  if (data.openingDraft && data.openingDraft.phrase === phrase) return true;
  const base = data.opening && letters(data.opening.phrase) === normalized ? data.opening.tracks : [];
  data.openingDraft = validateOpeningDraft(phrase, Array.from({ length: normalized.length }, (_, i) => base[i] || null));
  openingPosition = null;
  persist();
  renderOpeningEditor();
  return true;
}
function paintOpeningSummary() {
  $('opening-phrase').value = data.openingDraft?.phrase || data.opening?.phrase || DEFAULT_PHRASE;
  renderOpeningEditor();
}
function renderOpeningEditor() {
  const current = data.openingDraft || data.opening;
  $('opening-editor').replaceChildren();
  const conflicts = openingConflicts(current, data.catalog);
  const chosen = current?.tracks.filter(Boolean).length || 0;
  $('opening-progress').textContent = current ? chosen + ' de ' + current.tracks.length : 'Não configurada';
  $('opening-summary').textContent = conflicts.length
    ? 'Atenção: ' + conflicts.length + ' música(s) também estão no catálogo ou se repetem, faça a troca antes de salvar'
    : data.openingDraft ? 'Rascunho salvo neste aparelho, a abertura publicada só muda ao tocar em Salvar'
    : data.opening ? 'Abertura salva e fixa, independente do catálogo' : 'Opcional, sem abertura salva o app envia somente o nome';
  $('opening-summary').classList.toggle('opening-warning', conflicts.length > 0);
  $('prepare-opening').textContent = data.openingDraft ? 'Recomeçar seleção' : data.opening ? 'Editar abertura fixa' : 'Escolher músicas da abertura';
  $('save-opening').hidden = !data.openingDraft;
  $('save-opening').disabled = !data.openingDraft || chosen !== current?.tracks.length || conflicts.length > 0;
  if (!current) { $('opening-search-panel').hidden = true; return; }
  const active = letters(current.phrase);
  current.tracks.forEach((track, index) => {
    const row = node('div', 'opening-track-card');
    if (conflicts.some(conflict => conflict.index === index)) row.classList.add('opening-conflict');
    const letter = node('span', 'opening-letter', active[index]);
    const info = node('div', 'track-text');
    info.append(node('span', 'track-name', track?.name || 'Nenhuma música selecionada'),
      node('span', 'track-artist', track?.artist || 'Escolha uma faixa exclusiva para esta posição'));
    const main = node('div', 'opening-track-main');
    main.append(node('span', 'opening-index', String(index + 1).padStart(2, '0')), letter, cover(track), info);
    const actions = node('div', 'opening-track-actions');
    const choose = node('button', 'choose-track', track ? 'Trocar' : 'Escolher');
    choose.type = 'button'; choose.setAttribute('aria-label', 'Escolher música para ' + active[index] + ', posição ' + (index + 1));
    choose.onclick = () => {
      if (!beginOpeningDraft()) return;
      openingPosition = index;
      $('opening-search').value = '';
      openingSearch = { tracks: [], offset: 0, more: false, page: 0, loading: false };
      $('opening-search-panel').hidden = false;
      paintOpeningSearch();
      loadOpeningSearch();
      $('opening-search-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    actions.append(choose);
    if (track && data.openingDraft) {
      const remove = node('button', 'opening-clear', 'Remover');
      remove.type = 'button'; remove.setAttribute('aria-label', 'Retirar ' + track.name + ' da configuração da abertura');
      remove.onclick = () => { data.openingDraft.tracks[index] = null; persist(); renderOpeningEditor(); renderPreview(); };
      actions.append(remove);
    }
    row.append(main, actions); $('opening-editor').append(row);
  });
  if (openingPosition !== null) $('opening-search-panel').hidden = !data.openingDraft;
}
function paintOpeningSearch() {
  const panel = $('opening-search-panel');
  if (!data.openingDraft || openingPosition === null) { panel.hidden = true; return; }
  panel.hidden = false;
  const letter = letters(data.openingDraft.phrase)[openingPosition];
  $('opening-search-title').textContent = 'Música para ' + letter + ' · posição ' + (openingPosition + 1);
  $('opening-search-status').textContent = openingSearch.loading ? 'Buscando no Spotify…' :
    openingSearch.error || 'Escolha uma faixa que não esteja no catálogo nem em outra posição da abertura';
  $('opening-search-results').replaceChildren();
  const options = openingSearch.tracks.filter(track => !checkOpeningCandidate(track, data.catalog, data.openingDraft, openingPosition));
  for (const track of searchPage(options, openingSearch.page)) {
    const row = node('div', 'search-result');
    const select = node('button', 'search-result-select');
    select.type = 'button'; select.setAttribute('aria-label', 'Selecionar ' + track.name);
    const info = node('span', 'track-text');
    info.append(node('span', 'track-name', track.name), node('span', 'track-artist', track.artist));
    select.append(cover(track), info, node('span', 'result-add', '+'));
    select.onclick = () => {
      const problem = checkOpeningCandidate(track, data.catalog, data.openingDraft, openingPosition);
      if (problem) { toast(problem, true); return; }
      data.openingDraft.tracks[openingPosition] = cleanTrack(track);
      openingPosition = null;
      persist(); $('opening-search-panel').hidden = true; renderOpeningEditor(); renderPreview();
      toast('Música exclusiva salva no rascunho da abertura');
    };
    const link = node('a', 'result-open', '↗');
    link.href = 'https://open.spotify.com/track/' + track.id;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Abrir ' + track.name + ' no Spotify');
    row.append(select, link); $('opening-search-results').append(row);
  }
  $('opening-search-more').hidden = !openingSearch.more && options.length <= (openingSearch.page + 1) * SEARCH_PAGE_SIZE;
  $('opening-search-more').disabled = openingSearch.loading;
  $('opening-search-submit').disabled = openingSearch.loading || !auth();
}
async function loadOpeningSearch(more = false) {
  if (openingPosition === null || !auth()) { paintOpeningSearch(); return; }
  const position = openingPosition;
  const letter = letters(data.openingDraft.phrase)[position];
  const term = $('opening-search').value.trim();
  const token = ++openingSearchToken;
  openingSearch.loading = true; openingSearch.error = ''; paintOpeningSearch();
  try {
    const result = await searchTracks(letter, term, more ? openingSearch.offset : 0);
    if (token !== openingSearchToken || openingPosition !== position) return;
    openingSearch.tracks = [...new Map([...(more ? openingSearch.tracks : []), ...result.tracks].map(t => [t.id, t])).values()];
    openingSearch.offset = result.offset;
    openingSearch.more = result.more;
    if (!more) openingSearch.page = 0;
  } catch (error) { if (token === openingSearchToken) openingSearch.error = error.message; }
  finally { if (token === openingSearchToken) { openingSearch.loading = false; paintOpeningSearch(); } }
}
$('prepare-opening').onclick = () => {
  const phrase = $('opening-phrase').value.trim();
  if (data.openingDraft && data.openingDraft.phrase === phrase &&
    !confirm('Recomeçar a seleção? As escolhas do rascunho serão restauradas a partir da última abertura salva, se existir')) return;
  if (data.openingDraft) data.openingDraft = null;
  if (beginOpeningDraft()) renderOpeningEditor();
};
$('opening-phrase').oninput = () => { $('opening-summary').textContent = 'Toque em Escolher músicas da abertura para preparar a nova frase, sua abertura salva continua preservada'; };
$('opening-search-form').onsubmit = event => { event.preventDefault(); document.activeElement?.blur(); openingSearch = { tracks: [], offset: 0, more: false, page: 0 }; loadOpeningSearch(); };
$('opening-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { openingSearch = { tracks: [], offset: 0, more: false, page: 0 }; loadOpeningSearch(); }, 550); };
$('opening-search-more').onclick = async () => {
  const allowed = () => openingSearch.tracks.filter(track => !checkOpeningCandidate(track, data.catalog, data.openingDraft, openingPosition));
  const next = openingSearch.page + 1;
  for (let i = 0; i < 3 && openingSearch.more && allowed().length < (next + 1) * SEARCH_PAGE_SIZE; i++) await loadOpeningSearch(true);
  if (allowed().length > next * SEARCH_PAGE_SIZE) openingSearch.page = next;
  paintOpeningSearch();
};
$('opening-link-form').onsubmit = async event => {
  event.preventDefault();
  if (openingPosition === null) return;
  const button = $('opening-link-submit'); button.disabled = true;
  try {
    const track = cleanTrack(await trackFromLink($('opening-link').value));
    const expected = letters(data.openingDraft.phrase)[openingPosition];
    if (letters(track.name)[0] !== expected) throw new Error('A música deve começar com ' + expected);
    const problem = checkOpeningCandidate(track, data.catalog, data.openingDraft, openingPosition);
    if (problem) throw new Error(problem);
    data.openingDraft.tracks[openingPosition] = track;
    openingPosition = null; persist();
    $('opening-link').value = ''; $('opening-search-panel').hidden = true;
    renderOpeningEditor(); renderPreview(); toast('Música adicionada à abertura');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
};
$('save-opening').onclick = () => {
  try {
    if (!data.openingDraft || $('opening-phrase').value.trim() !== data.openingDraft.phrase) throw new Error('Confira a frase e prepare a seleção antes de salvar');
    const { phrase, tracks } = data.openingDraft;
    if (tracks.some(track => !track)) throw new Error('Escolha todas as músicas da abertura');
    if (openingConflicts(data.openingDraft, data.catalog).length) throw new Error('Troque as músicas repetidas ou presentes no catálogo antes de salvar');
    const unique = new Set(tracks.map(track => track.id));
    if (unique.size !== tracks.length) throw new Error('Não repita músicas na abertura');
    data.opening = { phrase, tracks: validateOpening(phrase, tracks) };
    data.openingDraft = null; openingPosition = null;
    persist(); paintOpeningSummary(); renderPreview();
    toast('Abertura fixa salva, sem músicas compartilhadas com o catálogo');
  } catch (error) { toast(error.message, true); }
};
async function sendSequenceToSpotify(submittedWord, tracks, { inject = false } = {}) {
  if (remoteOwnsPlaylist()) return false;
  if (sending || playlistBusy || playlistLoading || importingCatalog || !auth() || !data.playlist) return false;
  const selected = playlists.find(playlist => playlist.id === data.playlist);
  if (!selected || !tracks.length) return false;
  if(!inject)recordDiagnostic('manual-send',{operation:'manual-send',items:tracks.length});
  const sent = tracks.map(track => ({ ...track }));
  const target = selected.id;
  sending = true;
  updateButton();
  try {
    if (inject) {
      // Use the already loaded playlist snapshot, never a network GET before the Inject PUT
      if (playlistLoadedFor === target) {
        try {
          localStorage.setItem('predify.last-backup', JSON.stringify({
            playlist: target, name: selected.name, time: new Date().toISOString(),
            uris: playlistItems.map(track => track.uri)
          }));
        } catch { /* Fast Inject delivery must not depend on storage */ }
      }
    } else {
      // Manual mode keeps the original fresh backup behavior
      const previous = await playlistTracks(target);
      localStorage.setItem('predify.last-backup', JSON.stringify({
        playlist: target, name: selected.name, time: new Date().toISOString(),
        uris: previous.map(track => track.uri)
      }));
    }
    await replacePlaylist(target, sent);
    // Never show success until Spotify acknowledges the PUT
    lastSuccessfulSend = { playlist: target, word: submittedWord, at: Date.now() };
    try { localStorage.setItem(LAST_SUCCESS_KEY, JSON.stringify(lastSuccessfulSend)); }
    catch { /* Keep the confirmation visible even if storage is full */ }
    paintLastSuccessfulWord();
    $('last-send').hidden = false;
    $('last-send').textContent = (
      inject ? 'Atualizada pelo Inject' : 'Atualização aceita pelo Spotify'
    ) + ' · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + selected.name;
    const link = node('a', '', 'Abrir no Spotify ↗');
    link.href = 'https://open.spotify.com/playlist/' + target;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    $('last-send').append(node('br'), link);
    toast(inject ? 'Playlist atualizada pelo Inject' : 'Spotify confirmou a atualização da playlist');
    selected.items = { total: sent.length };
    // The acknowledged PUT already gives us the new contents, retain the cover
    // Manual mode keeps the fresh backup, without a post-write verification GET
    playlistItems = sent;
    playlistLoadedFor = target;
    saveCurrentPlaylistCache(selected,sent);
    paintPlaylist();
    return true;
  } catch (error) {
    toast(error.message + ' · Confira a playlist antes de repetir', true);
    if (inject) throw error;
    return false;
  } finally {
    sending = false;
    updateButton();
  }
}
$('update').onclick = async () => {
  if (sending || playlistBusy || playlistLoading || $('update').disabled) return;
  const submittedWord = $('person-name').value.trim();
  return sendSequenceToSpotify(submittedWord, sequence.tracks);
};
$('connect').onclick = async () => {
  if ($('connect').disabled) return;
  spotifyConnectionError = '';
  $('connect').disabled = true;
  try { await connect(); }
  catch (error) {
    spotifyConnectionError = 'Não foi possível iniciar a conexão: ' + error.message;
    toast(spotifyConnectionError, true);
    paintAccount();
  }
  finally { if (!auth()) $('connect').disabled = false; }
};
$('disconnect').onclick = async () => {
  if (!confirm('Tem certeza de que deseja desconectar o Spotify deste aparelho?\n\nVocê precisará conectar novamente para atualizar suas playlists\n\nSeu catálogo e sua abertura fixa serão preservados')) return;
  if (remoteKey()) {
    remoteRevision++; remoteBusy = true; updateButton();
    try { await remoteRequest('stop', {}); await synchronizeRemoteAuth(remoteRevision); remoteState.active = false; remoteUnknown = false; }
    catch (error) { toast('Encerre o monitor remoto antes de desconectar: '+error.message,true); return; }
    finally { remoteBusy = false; updateButton(); }
  }
  disconnect();
  playlistCache.clear();
  playlists = []; playlistItems = []; playlistLoadedFor = '';
  $('playlist').replaceChildren(new Option('Conecte o Spotify', ''));
  paintAccount(); paintPlaylist();
  toast('Spotify desconectado deste aparelho, seu catálogo foi mantido');
};
$('account-shortcut').onclick = () => setView('settings');
$('reload-playlists').onclick = () => loadPlaylists();
$('playlist').onchange = () => { recordDiagnostic('playlist-switch',{operation:'playlist-switch'}); data.playlist = $('playlist').value; persist(); paintPlaylist(); refreshPlaylistItems(); injectMonitor.resume(); };
$('person-name').oninput = () => renderPreview();
$('person-name').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
  event.preventDefault();
  if (!$('update').disabled) $('update').click();
  $('person-name').blur();
});
const injectIdInput = $('inject-id');
const remoteDurationInput = $('remote-duration');
const REMOTE_DURATION_KEY = 'predify.remote.duration.v1';
try {
  const savedDuration = localStorage.getItem(REMOTE_DURATION_KEY);
  if (['30','60','120','180','240'].includes(savedDuration)) remoteDurationInput.value = savedDuration;
} catch { /* Keep the default if this browser cannot read preferences */ }
remoteDurationInput.addEventListener('change', () => {
  try { localStorage.setItem(REMOTE_DURATION_KEY, remoteDurationInput.value); }
  catch { toast('Não foi possível salvar a duração neste aparelho', true); }
});
try { injectIdInput.value = localStorage.getItem(INJECT_ID_KEY) || ''; } catch { injectIdInput.value = ''; }
const injectStatus = (message, error = false) => {
  $('inject-status').textContent = message;
  $('inject-status').classList.toggle('inject-error', error);
};
const injectMonitor = createInjectMonitor({
  read: id => fetchInjectSelection(id,{fetcher:(url,opts)=>diagnosticFetch('inject','selection',url,opts)}),
  active: () => !remoteKey() && !remoteBusy && !document.hidden && navigator.onLine && !!auth() && !!data.playlist && playlists.some(p => p.id === data.playlist),
  onSelection: async event => {
  if (sending || playlistBusy || playlistLoading || importingCatalog || !auth() ||
      !data.playlist || !playlists.some(p => p.id === data.playlist)) return 'defer';
  // Inject is fully independent of the manual text field, button and preview
  if (openingConflicts(data.opening, data.catalog).length) {
    throw new Error('A abertura fixa tem músicas repetidas ou também usadas no catálogo, corrija em Ajustes');
  }
  const directSequence = buildSequence({ name: event.value, catalog: data.catalog, opening: data.opening });
  if (directSequence.error) throw new Error(directSequence.error);
  return sendSequenceToSpotify(event.value, directSequence.tracks, { inject: true });
},
  onStatus: event => {
    if (event.kind === 'inactive') injectStatus('Informe seu ID oculto para ativar o Inject');
    else if (event.kind === 'started') injectStatus('Inject configurado. Conecte o Spotify e selecione uma playlist, se necessário');
    else if (event.kind === 'baseline') injectStatus('Conectado. Aguardando uma nova palavra');
    else if (event.kind === 'detected') { $('inject-test-result').hidden = true; injectStatus('Palavra recebida: “' + event.value + '”. Enviando ao Spotify…'); }
    else if (event.kind === 'waiting') injectStatus('Aguardando o término do envio anterior');
    else if (event.kind === 'sent') injectStatus('✓ Palavra “' + event.value + '” enviada com sucesso');
    else if (event.kind === 'send-failed') injectStatus('Não foi possível enviar “' + event.value + '”: ' + (event.message || 'confira a playlist'), true);
    else if (event.kind === 'empty') injectStatus('O Inject recebeu uma seleção sem palavra', true);
    else if (event.kind === 'error') injectStatus('Não foi possível consultar o Inject: ' + event.message + '. Nova tentativa automática', true);
  }
});
function paintRemote() {
  const paired = !!remoteKey();
  $('remote-start').disabled = !paired || remoteOwnsPlaylist() || sending || playlistBusy || playlistLoading || importingCatalog || !auth() || !data.playlist || !validInjectId(injectIdInput.value);
  $('remote-stop').disabled = !paired || remoteBusy || (!remoteState.active && !remoteUnknown);
  $('remote-test').disabled = !paired || remoteOwnsPlaylist() || sending || !validInjectId(injectIdInput.value);
  $('remote-duration').disabled = remoteOwnsPlaylist();
  $('remote-pair').disabled = remoteBusy;
  $('remote-unpair').disabled = !paired || remoteBusy;
  $('remote-pairing').hidden = paired && !remoteConfigOpen;
  $('remote-configure').hidden = !paired;
  $('remote-configure').disabled = remoteBusy || remoteState.active;
  $('remote-configure').textContent = remoteConfigOpen ? 'Cancelar alteração' : 'Alterar conexão';
  $('remote-key').placeholder = 'Cole a chave privada do monitor';
  $('remote-connection-status').textContent = paired ? 'Monitor conectado, use Iniciar apresentação na aba Performar' : 'Conecte o monitor para usar o Predify com o iPhone bloqueado';
  $('remote-badge').textContent = remoteState.active ? remoteState.mode === 'test' ? 'Teste ativo' : 'Ativa' : paired ? 'Conectado' : 'Cloudflare';
  let message = paired ? 'Pronto para iniciar, funciona com o iPhone bloqueado' : 'Conecte o monitor remoto em Ajustes para usar com a tela bloqueada';
  if (remoteUnknown) message = 'Confirmando o estado do monitor remoto';
  if (remoteState.active) {
    const until = new Date(remoteState.endsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    message = (remoteState.mode === 'test' ? 'Teste sem Spotify' : 'Apresentação ativa')+' até '+until+' · '+remoteState.polls+' leituras';
  } else if (remoteState.phase === 'expired') message = 'Apresentação encerrada automaticamente';
  else if (remoteState.phase === 'stopped') message = 'Apresentação encerrada';
  else if (remoteState.phase === 'daily-limit') message = 'Monitor encerrado pelo limite diário de segurança';
  if (remoteState.lastValue) message += ' · Última recebida: '+remoteState.lastValue;
  else if (remoteState.mode === 'test' && !remoteState.active && ['expired','stopped'].includes(remoteState.phase)) message += ' · Nenhuma palavra nova recebida neste teste';
  if (remoteState.lastError) message += ' · '+remoteState.lastError;
  $('remote-status').textContent = remoteMessage || message;
}
function applyRemoteStatus(state) {
  lastRemoteStatusAt = Date.now(); remoteStatusFailed = false;
  remoteState = state;
  remoteUnknown = false;
  const sent = state.lastSuccess;
  if (sent?.snapshotId && sent.playlist && sent.word && isNewRemoteConfirmation(sent, lastSuccessfulSend)) {
    lastSuccessfulSend = {playlist:sent.playlist,word:sent.word,at:sent.at};
    try { localStorage.setItem(LAST_SUCCESS_KEY,JSON.stringify(lastSuccessfulSend)); } catch { /* UI confirmation remains available */ }
    paintLastSuccessfulWord();
  }
  if (remoteKey()) injectStatus(state.active ? 'Monitoramento na Cloudflare, independente desta tela' : 'Monitor remoto conectado, use Iniciar apresentação');
  updateButton();
}
async function readRemoteStatus({ scheduled = false } = {}) {
  if (scheduled && Date.now() - lastRemoteStatusAt < remoteStatusInterval({active:remoteState.active,unknown:remoteUnknown,error:remoteStatusFailed})) return;
  if (remoteReading || remoteBusy || !remoteKey() || document.hidden || !navigator.onLine) return;
  remoteReading = true; lastRemoteStatusAt = Date.now();
  const revision = remoteRevision;
  try {
    const state = await remoteRequest('status');
    if (revision !== remoteRevision || remoteBusy) return;
    if (state.syncAvailable || state.authUpdatedAt > lastRemoteAuthSync) {
      await synchronizeRemoteAuth(revision);
      lastRemoteAuthSync = state.authUpdatedAt || 0;
    }
    if (revision !== remoteRevision || remoteBusy) return;
    remoteMessage = ''; applyRemoteStatus(state);
  }
  catch (error) { remoteStatusFailed = true; remoteMessage = 'Não foi possível confirmar o monitor: '+error.message+' · A apresentação pode continuar ativa'; paintRemote(); }
  finally { remoteReading = false; }
}
async function synchronizeRemoteAuth(revision) {
  const result = await remoteRequest('sync',{});
  if (revision !== remoteRevision) return;
  const next = result.auth;
  const previous = auth() || {};
  if (next?.access_token && next?.refresh_token && Number.isFinite(next.expires_at) && next.expires_at >= (previous.expires_at || 0)) {
    localStorage.setItem('predify.auth.v1',JSON.stringify({...previous,...next,scope:previous.scope || 'playlist-modify-public playlist-modify-private playlist-read-private'}));
  }
}
async function startRemote(mode) {
  if (remoteBusy || sending || playlistBusy || playlistLoading || importingCatalog) return;
  remoteRevision++;
  remoteBusy = true; remoteMessage = 'Iniciando monitor remoto'; updateButton();
  try {
    if (mode === 'live') await synchronizeRemoteAuth(remoteRevision);
    const request = {diagnosticTestId:currentDiagnosticTest()?.id || null,mode,injectId:injectIdInput.value,minutes:mode === 'test' ? 1 : Number($('remote-duration').value)};
    if (mode === 'live') Object.assign(request,{playlist:data.playlist,catalog:data.catalog,opening:data.opening,auth:auth()});
    // A test never transmits Spotify credentials or requests playlist changes
    const state = await remoteRequest('start',request);
    remoteMessage = ''; applyRemoteStatus(state);
    toast(mode === 'test' ? 'Teste iniciado por 1 minuto, sem Spotify' : 'Apresentação ativa, você pode bloquear o iPhone');
  } catch(error) { remoteUnknown = true; remoteMessage = error.message+' · Confira o estado do monitor antes de tentar novamente'; }
  finally { remoteBusy = false; updateButton(); void readRemoteStatus(); }
}
$('remote-start').onclick = () => startRemote('live');
$('remote-test').onclick = () => startRemote('test');
$('remote-stop').onclick = async () => {
  if (remoteBusy) return;
  remoteRevision++;
  remoteBusy = true; remoteMessage = 'Encerrando apresentação'; updateButton();
  try { const state = await remoteRequest('stop',{}); await synchronizeRemoteAuth(remoteRevision); remoteMessage = ''; applyRemoteStatus(state); toast('Monitoramento encerrado'); }
  catch(error) { remoteMessage = 'Encerramento não confirmado: '+error.message+' · Tente novamente'; }
  finally { remoteBusy = false; updateButton(); }
};
$('remote-configure').onclick = () => {remoteConfigOpen = !remoteConfigOpen; paintRemote(); if(remoteConfigOpen)$('remote-key').focus();};
$('remote-pair').onclick = async () => {
  if (remoteBusy) return;
  remoteRevision++;
  const previous = remoteKey();
  remoteBusy = true;
  try {
    saveRemoteKey($('remote-key').value);
    remoteUnknown = true; updateButton();
    const state = await remoteRequest('status');
    $('remote-key').value = ''; remoteConfigOpen = false; remoteMessage = ''; applyRemoteStatus(state); toast('Monitor remoto conectado');
  } catch(error) {
    if (previous) localStorage.setItem(REMOTE_KEY_STORAGE,previous); else localStorage.removeItem(REMOTE_KEY_STORAGE);
    remoteUnknown = !!previous; remoteMessage = error.message;
  } finally { remoteBusy = false; updateButton(); }
};
$('remote-unpair').onclick = async () => {
  if (remoteBusy) return;
  remoteRevision++;
  remoteBusy = true; updateButton();
  try {
    await remoteRequest('stop',{});
    await synchronizeRemoteAuth(remoteRevision);
    // Adopt a fresh baseline before returning ownership to the existing local receiver
    const selection = validInjectId(injectIdInput.value) ? await fetchInjectSelection(injectIdInput.value,{fetcher:(url,opts)=>diagnosticFetch('inject','selection',url,opts)}) : null;
    if (selection) localStorage.setItem('predify.inject.count.v1.'+injectIdInput.value,selection.count);
    localStorage.removeItem(REMOTE_KEY_STORAGE); remoteState = {active:false}; remoteUnknown = false; remoteMessage = '';
    injectMonitor.stop(); injectMonitor.setId(''); injectMonitor.setId(injectIdInput.value);
    toast('Monitor remoto desconectado');
  } catch(error) { remoteMessage = error.message+' · A conexão remota foi mantida'; }
  finally { remoteBusy = false; updateButton(); }
};
document.addEventListener('visibilitychange',()=>{if (!document.hidden) void readRemoteStatus();});
window.addEventListener('online',()=>void readRemoteStatus());
window.addEventListener('storage',event=>{if (event.key === REMOTE_KEY_STORAGE) { remoteRevision++; remoteUnknown = !!remoteKey(); updateButton(); void readRemoteStatus(); }});
setInterval(()=>void readRemoteStatus({scheduled:true}),2500);
void readRemoteStatus();
injectIdInput.addEventListener('input', () => {
  const cleaned = injectIdInput.value.replace(/\D/g, '').slice(0, 4);
  injectIdInput.value = cleaned;
  const valid = validInjectId(cleaned);
  try {
    if (valid) localStorage.setItem(INJECT_ID_KEY, cleaned);
    else localStorage.removeItem(INJECT_ID_KEY);
  } catch { /* The monitor can still work in this session */ }
  $('inject-test-result').hidden = true;
  injectMonitor.setId(valid ? cleaned : '');
});
$('inject-test').onclick = async () => {
  const id = injectIdInput.value;
  if (!validInjectId(id)) {
    injectStatus('Informe os 4 dígitos do seu ID oculto', true);
    return;
  }
  const button = $('inject-test');
  button.disabled = true;
  $('inject-test-result').hidden = false;
  $('inject-test-result').textContent = 'Consultando Inject…';
  try {
    const selection = await fetchInjectSelection(id,{fetcher:(url,opts)=>diagnosticFetch('inject','selection',url,opts)});
    $('inject-test-result').textContent = 'Conexão OK. Última palavra: “' + (selection.value || '(vazia)') + '”';
  } catch (error) {
    $('inject-test-result').textContent = 'Não foi possível testar: ' + error.message;
  } finally { button.disabled = false; }
};
$('reorder').onclick = () => { reorderMode = !reorderMode; replacingSlot = null; replacementSuggestion = null; paintCatalog(); };
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, catalog: data.catalog, opening: data.opening, openingDraft: data.openingDraft, catalogWarnings: data.catalogWarnings }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = 'predify-catalogo.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onclick = () => { if (!importingCatalog) $('import-file').click(); };
$('cancel-import').onclick = () => { cancelCatalogImport = true; $('import-status').textContent = 'Cancelando após a consulta em andamento…'; };
function importBusy(active) {
  importingCatalog = active;
  $('import').disabled = active; $('export').disabled = active;
  $('cancel-import').hidden = !active; $('cancel-import').disabled = !active;
  updateButton();
}
async function resolveWithRetry(candidate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (cancelCatalogImport) throw new Error('Importação cancelada, seu catálogo anterior foi mantido');
    try { return await resolveCatalogCandidate(candidate); }
    catch (error) {
      if (!Number.isFinite(error.retryAfter) || attempt === 3) throw error;
      const wait = Math.max(1, Math.min(120, error.retryAfter));
      $('import-status').textContent = 'Limite temporário do Spotify, aguardando ' + wait + ' s para continuar';
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
    }
  }
}
async function importCandidateSelection(imported) {
  const candidates = validateCandidateCatalog(imported.catalog);
  if (!auth()) throw new Error('Conecte sua conta do Spotify em Ajustes antes de importar a seleção');
  const total = Object.values(candidates).reduce((sum, items) => sum + items.length, 0);
  if (!confirm('Buscar ' + total + ' músicas no Spotify e SUBSTITUIR seu catálogo atual? Sua abertura fixa será preservada, conflitos serão avisados no Catálogo')) return;
  importBusy(true); cancelCatalogImport = false;
  const next = emptyCatalog(), missing = [], unresolved = Object.fromEntries(ALPHABET.map(letter => [letter, []]));
  let checked = 0, saved = 0;
  try {
    for (const letter of ALPHABET) {
      const ordered = [];
      for (const candidate of candidates[letter]) {
        if (cancelCatalogImport) throw new Error('Importação cancelada, seu catálogo anterior foi mantido');
        $('import-status').textContent = 'Conferindo ' + (checked + 1) + '/' + total + ': ' + candidate.name + ' (' + letter + ')';
        const found = await resolveWithRetry(candidate);
        checked++;
        if (found && letters(found.name)[0] === letter && !ordered.some(item => item.id === found.id)) {
          ordered.push(found); saved++;
        } else {
          const reason = !found ? 'sem correspondência confiável' : letters(found.name)[0] !== letter ? 'inicial incompatível' : 'repetida';
          unresolved[letter].push({name:candidate.name,artist:candidate.artist,reason});
          missing.push(letter + ': ' + candidate.name + ', ' + reason);
        }
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      next[letter] = [...ordered, ...Array(MAX_TRACKS_PER_LETTER - ordered.length).fill(null)];
    }
    const catalog = validateCatalog(next);
    if (cancelCatalogImport) throw new Error('Importação cancelada, o catálogo anterior continua salvo');
    const diagnostics = catalogHealth(catalog, data.opening, data.openingDraft, unresolved);
    try { localStorage.setItem('predify.catalog.before-import', JSON.stringify({
      date:new Date().toISOString(), catalog:data.catalog, catalogWarnings:data.catalogWarnings || {}
    })); } catch { /* Backup is best effort */ }
    data = { ...data, catalog, catalogWarnings:unresolved };
    persist(); openingPosition = null; reorderMode = false; replacingSlot = null;
    paintCatalog(); paintOpeningSummary(); renderPreview();
    $('import-status').textContent = saved + '/' + total + ' músicas identificadas no Spotify, ' + diagnostics.percentage + '% das letras completas' + (missing.length ? ', ' + missing.length + ' pendências detalhadas no Catálogo' : '') + (diagnostics.problemLetters ? ', ' + diagnostics.problemLetters + ' letras com avisos' : '');
    toast('Importação concluída, ' + saved + ' músicas salvas' + (missing.length ? ', ' + missing.length + ' pendentes para conferir' : ''));
  } finally { importBusy(false); }
}
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try {
    if (importingCatalog) return;
    if (file.size > 1024 * 1024) throw new Error('Use um catálogo de até 1 MB');
    const imported = JSON.parse(await file.text());
    if (imported.version === 2) { await importCandidateSelection(imported); return; }
    if (imported.version !== 1) throw new Error('Formato de catálogo não reconhecido');
    const catalog = validateCatalog(imported.catalog);
    const opening = imported.opening ? { phrase: imported.opening.phrase, tracks: validateOpening(imported.opening.phrase, imported.opening.tracks) } : null;
    const openingDraft = imported.openingDraft ? validateOpeningDraft(imported.openingDraft.phrase, imported.openingDraft.tracks) : null;
    const catalogWarnings = imported.catalogWarnings && typeof imported.catalogWarnings === 'object' ? imported.catalogWarnings : {};
    if (!confirm('Substituir o catálogo e a abertura deste aparelho pelo arquivo selecionado?')) return;
    data = { ...data, catalog, opening, openingDraft, catalogWarnings }; persist(); openingPosition = null; paintCatalog(); paintOpeningSummary(); renderPreview(); toast('Catálogo importado, confira avisos de músicas compartilhadas');
  } catch (error) { toast('Não foi possível importar: ' + error.message, true); }
  finally { $('import-file').value = ''; }
};
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view));
document.querySelector('.brand').onclick = event => { event.preventDefault(); setView('perform'); };

// The +10 px offset was calibrated on the iPhone with the manual keyboard open
// It has no effect while the keyboard is closed or another field is in focus
$('perform-view').style.setProperty('--manual-keyboard-offset', MANUAL_KEYBOARD_OFFSET_PX + 'px');

// Only reveal the complete manual action when its text field is being edited
// Let the iOS keyboard settle first; keep the main view unchanged otherwise
let keyboardRevealFrame = 0;
function revealManualActionAboveKeyboard() {
  if (document.activeElement !== $('person-name') || !document.documentElement.classList.contains('keyboard-open')) return;
  const area = $('scroll-area');
  const composer = $('person-name').closest('.composer');
  if (!area || !composer) return;
  // Measure the unshifted position so scrolling does not cancel the +10 px
  // adjustment, unlike continuously trying to push a visible element upward
  const visualOffset = $('perform-view').classList.contains('keyboard-manual-offset')
    ? MANUAL_KEYBOARD_OFFSET_PX : 0;
  const delta = keyboardComposerScrollDelta({
    composerBottom: composer.getBoundingClientRect().bottom - visualOffset,
    viewportBottom: area.getBoundingClientRect().bottom
  });
  if (delta > 0) area.scrollTop += delta;
}
function scheduleManualActionReveal() {
  if (keyboardRevealFrame) return;
  keyboardRevealFrame = requestAnimationFrame(() => {
    keyboardRevealFrame = 0;
    revealManualActionAboveKeyboard();
  });
}
function applyViewport() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const visual = window.visualViewport;
  const layout = viewportLayout({ ios, standalone, screenHeight: screen.height, screenWidth: screen.width, innerHeight: window.innerHeight, innerWidth: window.innerWidth, visualHeight: visual?.height, visualTop: visual?.offsetTop, scale: visual?.scale, editing: document.activeElement?.matches('input,textarea,[contenteditable=true]') });
  document.documentElement.style.setProperty('--app-h', layout.height + 'px');
  document.documentElement.style.setProperty('--app-top', layout.top + 'px');
  document.documentElement.classList.toggle('keyboard-open', layout.keyboard);
  const manualKeyboard = ios && layout.keyboard && document.activeElement === $('person-name');
  $('perform-view').classList.toggle('keyboard-manual-offset', manualKeyboard);
  if (manualKeyboard) scheduleManualActionReveal();
}
preventZoom();
applyViewport();
window.addEventListener('resize', applyViewport);
window.visualViewport?.addEventListener('resize', applyViewport);
window.visualViewport?.addEventListener('scroll', applyViewport);
document.addEventListener('focusin', applyViewport);
document.addEventListener('focusout', () => setTimeout(applyViewport, 80));
window.addEventListener('orientationchange', () => setTimeout(applyViewport, 300));
window.addEventListener('pageshow', () => {
  // iOS can restore an interrupted OAuth attempt with a disabled connect button
  if (!auth()) { $('connect').disabled = false; paintAccount(); }
});
document.addEventListener('visibilitychange', () => { applyViewport(); if (!document.hidden) { paintAccount(); injectMonitor.resume(); } });
window.addEventListener('online', () => injectMonitor.resume());
window.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); }, { passive: true });
window.addEventListener('storage', event => { if (event.key === DATA_KEY) { data = loadData(); openingPosition = null; paintCatalog(); paintOpeningSummary(); renderPreview(); } if (event.key === LAST_SUCCESS_KEY) { lastSuccessfulSend = loadLastSuccess(); paintLastSuccessfulWord(); } if (event.key === 'predify.auth.v1' || event.key === PLAYLIST_CACHE_KEY) restoreSavedPlaylists(); });
async function refreshPlaylistItems({ force = false } = {}) {
  const selectedId = data.playlist, request = ++playlistRequest;
  playlistItems = []; playlistLoadedFor = '';
  if (!selectedId || !auth()) { playlistLoading = false; updateButton(); return; }
  const saved = !force && playlistCache.details(selectedId);
  if (saved) {
    recordDiagnostic('cache-hit',{operation:'playlist-switch',apiCalls:0});
    playlistItems = saved.items; playlistLoadedFor = selectedId; playlistLoading = false;
    $('playlist-cache-status').textContent = 'Dados salvos no aparelho, use ↻ para buscar mudanças no Spotify';
    paintPlaylist(); return;
  }
  recordDiagnostic('cache-miss',{operation:force?'playlist-reload':'playlist-switch'});
  playlistLoading = true; updateButton();
  try {
    const [items, images] = await Promise.all([
      playlistTracks(selectedId),
      playlistCoverImages(selectedId).catch(() => [])
    ]);
    if (request !== playlistRequest || data.playlist !== selectedId) return;
    playlistItems = items; playlistLoadedFor = selectedId;
    const selected = playlists.find(p => p.id === selectedId);
    if (selected) {
      selected.items = { total: items.length };
      selected.coverUrl = images[0]?.url || '';
      selected.firstAlbumUrl = items.find(item => item.album?.images?.length)?.album?.images?.at(-1)?.url || '';
      $('playlist-cache-status').textContent = 'Dados consultados no Spotify e salvos neste aparelho';
      saveCurrentPlaylistCache(selected,items);
      paintPlaylist();
    }
  } catch (error) {
    if (request === playlistRequest) toast('Não foi possível consultar a playlist: ' + error.message, true);
  } finally {
    if (request === playlistRequest) { playlistLoading = false; updateButton(); injectMonitor.resume(); }
  }
}
function suggestionKey(track) {
  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normal(track.name) + ':' + normal(track.artist);
}
function reservedForOpening(track) {
  const fixed = [...(data.opening?.tracks || []), ...(data.openingDraft?.tracks || [])].filter(Boolean);
  return fixed.some(item => sameSong(item, track));
}
async function addSuggestedSong(song, letter, forcedIndex = null) {
  if (suggestionBusy || letter !== selectedLetter) return;
  if (!auth()) { toast('Conecte o Spotify em Ajustes para adicionar esta música', true); return; }
  const index = forcedIndex ?? replacingSlot ?? data.catalog[letter].findIndex(item => !item);
  if (index < 0) { toast('Esta letra já possui cinco músicas, toque em Trocar para substituir uma delas', true); return; }
  if (reservedForOpening(song)) { toast('Esta música já está na abertura fixa, escolha outra', true); return; }
  if (data.catalog[letter].some((item, position) => position !== index && sameSong(item, song))) {
    toast('Esta música já está cadastrada nesta letra', true); return;
  }
  suggestionBusy = true; paintSuggestedResults();
  try {
    const found = await resolveCatalogCandidate(song);
    if (letter !== selectedLetter) return;
    if (!found) throw new Error('Não encontrei uma correspondência segura para “' + song.name + '”, você pode buscá-la manualmente no Spotify');
    if (letters(found.name)[0] !== letter) throw new Error('O Spotify retornou uma música com a letra errada');
    if (reservedForOpening(found)) throw new Error('Esta música já pertence à abertura fixa, escolha outra');
    const chosen = applySuggestedTrack(data.catalog[letter], letter, song, found, {forcedIndex, replacingSlot});
    data.catalog[letter] = chosen.slots;
    clearCatalogWarning(letter, found);
    replacingSlot = null; replacementSuggestion = null;
    persist(); paintCatalog(); renderPreview();
    toast('“' + found.name + '” adicionada ao catálogo');
  } catch (error) { toast(error.message, true); }
  finally { suggestionBusy = false; paintSuggestedResults(); }
}
function paintSuggestedResults() {
  const letter = selectedLetter, slots = data.catalog[letter];
  const headingLetter = $('suggestions-letter');
  if (!headingLetter) throw new Error('Título das sugestões não encontrado na interface');
  headingLetter.textContent = letter;
  const list = $('suggestion-results');
  list.replaceChildren();
  for (const song of SUGGESTIONS[letter] || []) {
    const existing = slots.some(item => sameSong(item, song));
    const reserved = reservedForOpening(song);
    const needsReplacement = slots.every(Boolean) && replacingSlot === null;
    const row = node('div', 'suggestion-row');
    const info = node('div', 'track-text');
    info.append(node('span', 'track-name', song.name), node('span', 'track-artist', song.artist));
    const button = node('button', 'suggestion-add', existing ? 'Adicionada ✓' : reserved ? 'Na abertura' : needsReplacement ? 'Trocar música' : replacingSlot !== null ? 'Substituir +' : 'Adicionar +');
    button.type = 'button';
    button.disabled = existing || reserved || suggestionBusy;
    button.setAttribute('aria-label', (needsReplacement ? 'Escolher música para substituir por ' : 'Adicionar sugestão ') + song.name);
    button.onclick = () => {
      if (letter !== selectedLetter || suggestionBusy) return;
      if (needsReplacement) {
        replacementSuggestion = replacementSuggestion && sameSong(replacementSuggestion, song) ? null : song;
        paintSuggestedResults();
        return;
      }
      replacementSuggestion = null;
      addSuggestedSong(song, letter);
    };
    row.append(info, button);
    list.append(row);
    if (needsReplacement && !existing && !reserved && replacementSuggestion && sameSong(replacementSuggestion, song)) {
      const chooser = node('div', 'suggestion-replacement');
      chooser.append(node('p', '', 'Qual das cinco músicas deseja substituir?'));
      slots.forEach((track, index) => {
        const option = node('button', 'suggestion-replace-option', (index + 1) + '. ' + track.name);
        option.type = 'button';
        option.disabled = suggestionBusy;
        option.setAttribute('aria-label', 'Substituir ' + track.name + ' por ' + song.name);
        option.onclick = () => {
          if (selectedLetter !== letter || suggestionBusy) return;
          replacementSuggestion = null;
          addSuggestedSong(song, letter, index);
        };
        chooser.append(option);
      });
      list.append(chooser);
    }
  }
  $('suggestion-note').textContent = 'Estas cinco sugestões são locais, não fazem consultas ao Spotify até você tocar em Adicionar ou escolher uma substituição';
}
function paintSearchResults() {
  const entry = searchCache.get(currentSearchKey());
  const letter = selectedLetter;
  $('spotify-search-results-panel').hidden = !catalogSpotifySearchActive;
  if (!catalogSpotifySearchActive) { $('search-status').textContent = 'Digite uma música ou toque em Buscar para consultar outras opções no Spotify'; return; }
  const slots = data.catalog[letter];
  const full = slots.every(Boolean);
  const page = entry?.page || 0;
  const eligibleTracks = (entry?.tracks || []).filter(track => !openingSongIds().has(track.id));
  const visibleTracks = searchPage(eligibleTracks, page);
  $('search-results').replaceChildren();
  $('search-submit').disabled = !auth() || !!entry?.loading;
  $('search-more').hidden = !entry?.loaded || !((eligibleTracks.length > (page + 1) * SEARCH_PAGE_SIZE) || entry.more);
  $('search-more').disabled = !!entry?.loading;
  $('spotify-search-title').textContent = replacingSlot === null ? `Músicas com ${letter}` : `Escolher música ${replacingSlot + 1} · ${letter}`;
  if (!auth()) { $('search-status').textContent = 'Conecte o Spotify em Ajustes para buscar músicas'; return; }
  $('search-status').textContent = entry?.loading ? 'Buscando no Spotify…' : entry?.error ? entry.error : !entry?.loaded ? `Sugestões com ${letter}, ou busque uma música pelo nome` : !entry.tracks.length ? `Nenhum resultado com ${letter} nesta busca, tente o nome de uma música ou veja mais resultados` : full && replacingSlot === null ? 'Cinco músicas salvas, toque em Trocar para substituir uma delas' : 'Toque em + para escolher, a música fica salva no seu catálogo';
  for (const track of visibleTracks) {
    const row = node('div', 'search-result');
    const saved = slots.some((slot, index) => slot?.id === track.id && index !== replacingSlot);
    const button = node('button', 'search-result-select');
    button.disabled = saved || (full && replacingSlot === null);
    button.setAttribute('aria-label', `${saved ? 'Já cadastrada' : 'Escolher'}: ${track.name}, ${track.artist}`);
    const info = node('span', 'track-text');
    info.append(node('span', 'track-name', track.name), node('span', 'track-artist', track.artist));
    button.append(cover(track), info, node('span', 'result-add', saved ? '✓' : '+'));
    button.onclick = () => {
      if (selectedLetter !== letter) return;
      const index = replacingSlot ?? slots.findIndex(slot => !slot);
      if (index < 0) { toast('Escolha qual das cinco músicas deseja trocar', true); return; }
      if (slots.some((slot, other) => other !== index && slot && (slot.id === track.id || suggestionKey(slot) === suggestionKey(track)))) return;
      if (reservedForOpening(track)) { toast('Esta música pertence à abertura fixa', true); return; }
      data.catalog[letter][index] = cleanTrack(track); clearCatalogWarning(letter, track); replacingSlot = null;
      persist(); paintCatalog(); renderPreview(); toast(`“${track.name}” salva na letra ${letter}`);
    };
    const link = node('a', 'result-open', '↗');
    link.href = `https://open.spotify.com/track/${track.id}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `Abrir ${track.name} no Spotify`);
    row.append(button, link); $('search-results').append(row);
  }
}
async function loadCatalogSearch(more = false) {
  catalogSpotifySearchActive = true;
  if (!auth()) { paintSearchResults(); return; }
  const key = currentSearchKey();
  let entry = searchCache.get(key);
  if (entry?.loading || (!more && entry?.loaded && !entry.error)) { paintSearchResults(); return; }
  if (!entry) { entry = { tracks: [], offset: 0, more: false, page: 0 }; searchCache.set(key, entry); }
  const letter = selectedLetter; const query = $('catalog-search').value.trim();
  entry.loading = true; entry.error = ''; paintSearchResults();
  try {
    const result = await searchTracks(letter, query, more ? entry.offset : 0);
    entry.tracks = [...new Map([...(more ? entry.tracks : []), ...result.tracks].map(track => [track.id, track])).values()];
    entry.offset = result.offset; entry.more = result.more; entry.loaded = true;
  } catch (error) { entry.error = error.message; }
  finally { entry.loading = false; if (key === currentSearchKey()) paintSearchResults(); }
}
$('catalog-search-form').onsubmit = event => { event.preventDefault(); clearTimeout(searchTimer); document.activeElement?.blur(); loadCatalogSearch(); };
$('catalog-search').oninput = () => {
  clearTimeout(searchTimer);
  const typing = !!$('catalog-search').value.trim();
  catalogSpotifySearchActive = typing;
  paintSearchResults();
  if (typing) searchTimer = setTimeout(() => loadCatalogSearch(), 600);
};
$('search-more').onclick = async () => {
  const key = currentSearchKey();
  let entry = searchCache.get(key);
  if (!entry || entry.loading) return;
  const nextPage = (entry.page || 0) + 1;
  for (let attempt = 0; attempt < 3 && entry.more && entry.tracks.filter(track => !openingSongIds().has(track.id)).length < (nextPage + 1) * SEARCH_PAGE_SIZE; attempt++) {
    await loadCatalogSearch(true);
    if (key !== currentSearchKey()) return;
    entry = searchCache.get(key);
  }
  if (entry.tracks.filter(track => !openingSongIds().has(track.id)).length > nextPage * SEARCH_PAGE_SIZE) entry.page = nextPage;
  paintSearchResults();
};

function paintDiagnostics() {
  const summary=diagnosticSummary();
  $('diagnostics-summary').textContent=summary.text;
  $('diagnostic-record-status').textContent = summary.active ? 'Registro em andamento, faça seu teste e finalize quando terminar' : summary.report.tests.length ? 'Registro salvo, você já pode exportar o diagnóstico' : 'Os registros ficam salvos neste aparelho';
  $('diagnostic-begin').disabled=summary.active || remoteState.active || remoteUnknown;
  $('diagnostic-end').disabled=!summary.active || remoteState.active;
  $('diagnostic-integrity').textContent=(summary.report.coverage.storageLimited?'Armazenamento limitado, exporte o diagnóstico antes de fechar o app. ':'')+
    (summary.report.coverage.remotePossibleGap?'Houve reinício remoto com operação em andamento, pode haver lacuna na medição. ':'')+
    (remoteState.active?'Encerre a apresentação antes de iniciar ou finalizar um registro. ':'')+
    (summary.report.cloudflare?'Contadores remotos recebidos em '+new Date(summary.report.cloudflare.observedAt).toLocaleTimeString('pt-BR'):'Aguardando contadores da Cloudflare');
}
$('diagnostic-begin').onclick=()=>{if(remoteState.active || remoteUnknown)return;beginDiagnosticTest();paintDiagnostics();};
$('diagnostic-end').onclick=async()=>{
  if(remoteState.active)return;
  if(remoteKey())try{await remoteRequest('status');}catch{/* Export keeps the last available server snapshot */}
  endDiagnosticTest();paintDiagnostics();
};
$('export-diagnostics').onclick = async () => {
  const button=$('export-diagnostics');button.disabled=true;
  try {
    if(remoteKey())try{await remoteRequest('status');}catch{/* Export remains available offline */}
    const blob = new Blob([JSON.stringify(diagnosticReport(),null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'predify-diagnostico-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  } finally{button.disabled=false;paintDiagnostics();}
};
setInterval(()=>{if(!document.hidden && $('settings-view').classList.contains('active'))paintDiagnostics();},1000);
async function start() {
  recordDiagnostic('app-start');
  // Start update checks before any Spotify requests or complex UI initialization
  // A stalled OAuth callback must never leave the version label stuck
  watchAppUpdates({
    versionLabel: $('app-version'), button: $('update-app'), status: $('update-status'),
    canReload: () => !sending && !playlistBusy && !importingCatalog,
    notify: message => toast(message, true)
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  paintCatalog(); paintOpeningSummary(); renderPreview(); paintAccount();
  const initialView = location.hash.slice(1);
  let connected = false;
  try {
    connected = await finishLogin();
    if (connected) { playlistCache.clear(); spotifyConnectionError = ''; toast('Spotify conectado, sua sessão será mantida neste aparelho'); }
  } catch (error) {
    spotifyConnectionError = error.message;
    toast(spotifyConnectionError, true);
  }
  paintAccount(); setView(initialView || 'perform');
  restoreSavedPlaylists();
  if (connected && auth()) await loadPlaylists();
  injectMonitor.setId(validInjectId(injectIdInput.value) ? injectIdInput.value : '');
  const url = new URL(location.href);
  if (url.searchParams.has('app-update')) { url.searchParams.delete('app-update'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
}
start().catch(error => {
  console.error('Predify startup failed', error);
  try { toast('Falha na inicialização: ' + error.message, true); } catch { /* UI may be incomplete */ }
});
