import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('three application views keep valid IDs after editing layout', () => {
  for (const name of ['perform', 'catalog', 'settings']) {
    assert.match(html, new RegExp('<section id="' + name + '-view" class="view'));
  }
  for (const id of ['opening-editor','opening-search-panel','opening-progress','catalog-slots','import-status','cancel-import','catalog-completeness','catalog-alerts','letter-problems','catalog-progress-bar','suggestion-results','suggestions-letter','spotify-search-results-panel','spotify-search-title','spotify-connection-error']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, 'ID ' + id);
  }
  assert.doesNotMatch(html, /id="playlist-editor"|id="opening-playlist-library"/);
  assert.doesNotMatch(html, /id="[^"]*' class=/);
});

test('local suggestions appear before optional live Spotify search', () => {
  assert.ok(html.indexOf('id="suggestion-results"') < html.indexOf('id="catalog-search-form"'));
  assert.doesNotMatch(html,/id="import-repertorio"/);
});

test('Spotify search heading never replaces or detaches the offline suggestion letter', () => {
  const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /id="search-title"[^>]*>Sugestões para <span id="suggestions-letter">/);
  assert.match(html, /id="spotify-search-title"/);
  assert.doesNotMatch(js, /\$\('search-title'\)\.(?:textContent|innerHTML|replaceChildren)\s*=/);
  assert.match(js, /\$\('spotify-search-title'\)\.textContent =/);
  assert.match(js, /replacementSuggestion = null;/);
  assert.match(js, /addSuggestedSong\(song, letter, index\)/);
});

test('saved-suggestion display and confirmation use the same match logic, deleting resets replacement state', () => {
  const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(js,/slots\.some\(item => sameSong\(item, song\)\)/);
  assert.match(js,/data\.catalog\[letter\] = chosen\.slots/);
  assert.match(js,/replacingSlot = null; replacementSuggestion = null;\s*data\.catalog\[letter\] = removeCatalogSlot/);
});

test('interrupted OAuth is actionable and the iOS back-forward restore unlocks reconnect', () => {
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.match(app,/window\.addEventListener\('pageshow'/);
  assert.match(app,/if \(!auth\(\)\) \{ \$\('connect'\)\.disabled = false; paintAccount\(\); \}/);
  assert.match(app,/spotifyConnectionError = error\.message/);
  assert.match(html,/id="spotify-connection-error"/);
});

test('version checks start before Spotify authorization and before any potentially failing render', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.slice(app.indexOf('async function start() {'));
  assert.ok(start.indexOf('watchAppUpdates({') < start.indexOf('await finishLogin()'));
  assert.ok(start.indexOf('watchAppUpdates({') < start.indexOf('paintCatalog()'));
  assert.match(html, /id="app-version" class="version">Versão \d+\.\d+\.\d+<\/span>/);
  assert.doesNotMatch(html, /Conferindo versão/);
});
test('release script advances the static version label for safe startup fallback', () => {
  const release = readFileSync(new URL('../scripts/release.mjs', import.meta.url),'utf8');
  assert.match(release, /file === 'index.html'/);
  assert.match(release, /Versão ' \+ next/);
});

test('restoration feature removed from interface and app, Spotify PUT stays unchanged', () => {
  const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /auto-restore|Restaurar abertura fixa|Restaurar playlist agora/);
  assert.doesNotMatch(js, /autoRestore|paintAutoRestore|executeStartupRestore|manual-restore-backup|restoreMessage/);
  assert.match(js, /await replacePlaylist\(target, sent\)/);
  const spotify = readFileSync(new URL('../spotify.js', import.meta.url), 'utf8');
  assert.match(spotify, /export async function replacePlaylist\(id, tracks\)/);
  assert.match(spotify, /method: 'PUT'/);
});

test('iPhone keyboard Go key triggers the existing update action, never a separate Spotify API path', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(html, /id="person-name"[^>]*type="search"[^>]*enterkeyhint="go"/);
  assert.match(html, /name="predify-revelation-query"/);
  assert.match(app, /\$\('person-name'\)\.addEventListener\('keydown', event => \{/);
  assert.match(app, /event\.key !== 'Enter' \|\| event\.isComposing \|\| event\.repeat/);
  assert.match(app, /if \(!\$\('update'\)\.disabled\) \$\('update'\)\.click\(\)/);
  assert.match(app, /await replacePlaylist\(target, sent\)/);
});
test('playlist card uses playlist-specific image helper, preserving Spotify metadata and fallback', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /const art = playlistCoverAssets\(selected\)/);
  assert.match(app, /selected\.coverUrl = images\[0\]\?\.url/);
  assert.match(app, /playlistCoverImages\(selectedId\)/);
});

test('chosen universal wording, uppercase revelation and minimal settings are preserved', () => {
  const js = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
  assert.match(html, /SUA PRÓXIMA EXPERIÊNCIA/);
  assert.match(html, /Uma coincidência musical<span class="green">,/);
  assert.match(html, /Uma playlist, mais do que parece/);
  assert.match(html, /Qual é a palavra\?/);
  assert.match(html, /Ex: Paralelepípedo/);
  assert.match(html, /Vamos ver onde isso vai dar/);
  assert.doesNotMatch(html, /No seu iPhone/);
  assert.match(js, /toLocaleUpperCase\('pt-BR'\)/);
  assert.match(engine, /Digite uma palavra para montar a playlist/);
  assert.match(html, /id="person-name"[^>]+enterkeyhint="go"/);
  assert.match(js, /if \(!\$\('update'\)\.disabled\) \$\('update'\)\.click\(\)/);
  assert.match(js, /await replacePlaylist\(target, sent\)/);
});
test('all favicon links and install icons reference user-supplied assets', () => {
  const sw=readFileSync(new URL('../sw.js', import.meta.url),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url),'utf8'));
  for (const path of ['icon-180.png','icon-192.png','icon-512.png','favicon-16x16.png','favicon-32x32.png']) {
    const file=readFileSync(new URL('../icons/'+path, import.meta.url));
    assert.equal(file.subarray(0,8).toString('hex'), '89504e470d0a1a0a',path);
  }
  assert.match(html,/rel="apple-touch-icon"/);
  assert.match(html,/favicon-32x32.png/);
  assert.match(sw,/favicon-32x32.png/);
  assert.equal(manifest.icons.length,2);
});

test('PNG installation icons have valid chunks and CRC32', () => {
  for (const name of ['icon-180.png','icon-192.png','icon-512.png','favicon-16x16.png','favicon-32x32.png']) {
    const bytes = readFileSync(new URL('../icons/'+name,import.meta.url));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    let pos=8, ended=false;
    while(pos+12<=bytes.length){
      const length=bytes.readUInt32BE(pos);
      assert.ok(pos+12+length<=bytes.length,name+' chunk truncated');
      let crc=0xffffffff;
      for(let i=pos+4;i<pos+8+length;i++){
        crc^=bytes[i];
        for(let j=0;j<8;j++) crc=crc&1 ? 0xedb88320^(crc>>>1):crc>>>1;
      }
      assert.equal((crc^0xffffffff)>>>0,bytes.readUInt32BE(pos+8+length),name+' invalid CRC');
      const type=bytes.toString('ascii',pos+4,pos+8);
      pos+=12+length;
      if(type==='IEND'){ended=true;break}
    }
    assert.equal(ended,true,name+' no IEND');
    assert.equal(pos,bytes.length,name+' trailing bytes');
  }
});

test('disconnect requires explicit confirmation and cancellation preserves the Spotify session',()=>{
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const handler=app.slice(app.indexOf("$('disconnect').onclick ="),app.indexOf("$('account-shortcut').onclick ="));
  assert.match(handler,/if \(!confirm\('Tem certeza de que deseja desconectar o Spotify deste aparelho\?/);
  assert.match(handler,/Você precisará conectar novamente/);
  assert.match(handler,/Seu catálogo e sua abertura fixa serão preservados/);
  assert.ok(handler.indexOf('if (!confirm(')<handler.indexOf('disconnect();'));
  assert.match(handler,/\)\) return;/);
  assert.match(html,/id="disconnect"[^>]+>Desconectar deste aparelho/);
});

test('overall Spotify confirmation is above remote presentation and the manual confirmation stays next to initials', () => {
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.match(html, /id="last-success-word"[^>]*aria-live="polite" hidden/);
  assert.ok(html.indexOf('id="last-success-word"') < html.indexOf('class="remote-card"'));
  assert.ok(html.indexOf('class="composer-footer"') < html.indexOf('id="last-manual-success-word"'));
  assert.match(app, /const LAST_SUCCESS_KEY = 'predify\.last-success\.v1'/);
  assert.match(app, /lastSuccessfulSend\.playlist === data\.playlist/);
  assert.match(app, /lastSuccessfulSend\.word\.toLocaleUpperCase\('pt-BR'\)/);
  assert.match(app, /localStorage\.setItem\(LAST_SUCCESS_KEY, JSON\.stringify\(lastSuccessfulSend\)\)/);
  assert.match(app, /event\.key === LAST_SUCCESS_KEY/);
  const success=app.slice(app.indexOf("async function sendSequenceToSpotify("),app.indexOf("$('connect').onclick ="));
  const confirmation = success.search(/lastSuccessfulSend\s*=\s*\{/);
  assert.ok(success.indexOf('await replacePlaylist(target, sent)') < confirmation);
  assert.doesNotMatch(success, /let verified|const current = await playlistTracks/);
  assert.equal((success.match(/await playlistTracks\(target\)/g)||[]).length,1);
  assert.match(success, /const submittedWord = \$\('person-name'\)\.value\.trim\(\)/);
  assert.match(success, /toast\(error\.message/);
  assert.match(app, /if \(!\$\('update'\)\.disabled\) \$\('update'\)\.click\(\)/);
});

test('Inject keeps its four-digit ID and read-only test in the requested settings order', () => {
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const order=['id="diagnostic-title"','<h2>Seu catálogo</h2>','id="opening-settings"','id="inject-title"','id="account-state"','id="app-update-title"'];
  for(let i=1;i<order.length;i++)assert.ok(html.indexOf(order[i-1]) < html.indexOf(order[i]));
  assert.match(html,/id="inject-id"[^>]*inputmode="numeric"[^>]*maxlength="4"/);
  assert.match(html,/id="inject-test"[^>]*>Verificar/);
  assert.match(html,/id="inject-title">Inject API/);
  assert.match(html,/for="inject-id">Seu ID oculto/);
  assert.match(html,/class="count-badge">500 ms/);
  assert.match(html,/id="inject-test-result"/);
  assert.match(app,/createInjectMonitor\(\{/);
  assert.match(app,/await fetchInjectSelection\(id,\{fetcher:/);
  const direct = app.slice(app.indexOf('  onSelection: async event => {'), app.indexOf('  onStatus: event => {'));
  assert.match(direct, /buildSequence\(\{ name: event\.value, catalog: data\.catalog, opening: data\.opening \}\)/);
  assert.match(direct, /sendSequenceToSpotify\(event\.value, directSequence\.tracks, \{ inject: true \}\)/);
  assert.doesNotMatch(direct, /\$\('person-name'\)/);
  assert.doesNotMatch(direct, /\$\('update'\)/);
  assert.doesNotMatch(direct, /renderPreview/);
  assert.match(app,/injectMonitor\.setId\(validInjectId\(injectIdInput\.value\)/);
  const update=app.slice(app.indexOf('async function sendSequenceToSpotify('),app.indexOf("$('connect').onclick ="));
  assert.ok(update.indexOf('await replacePlaylist(target, sent)') < update.indexOf('return true;'));
  assert.match(update,/await replacePlaylist\(target, sent\)/);
  assert.match(update,/if \(inject\) throw error/);
  assert.match(update,/const previous = await playlistTracks\(target\)/);
  assert.match(update,/playlistItems = sent/);
});

test('Inject checks immediately after returning to foreground or reconnecting', () => {
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.match(app,/if \(!document\.hidden\) \{ paintAccount\(\); injectMonitor\.resume\(\); \}/);
  assert.match(app,/window\.addEventListener\('online', \(\) => injectMonitor\.resume\(\)\)/);
});

test('wake-lock control is absent and its implementation remains dormant', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const wake = readFileSync(new URL('../keep-awake.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="keep-awake(?:-status)?"/);
  assert.doesNotMatch(app, /import .*createKeepAwake|keepAwake\.(restore|enable|retryOnInteraction|onVisibilityChange)\(/);
  assert.ok(wake.includes("KEEP_AWAKE_KEY = 'predify.keep-awake.v1'"));
  assert.match(wake, /const retryOnInteraction = \(\) =>/);
});

test('bottom navigation labels are Performar, Catálogo and Ajustes without changing actions', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /data-view="perform"[^>]*[\s\S]*?<span>Performar<\/span><\/button>/);
  assert.match(page, /data-view="catalog"[^>]*[\s\S]*?<span>Catálogo<\/span><\/button>/);
  assert.match(page, /data-view="settings"[^>]*[\s\S]*?<span>Ajustes<\/span><\/button>/);
});


test('manual word keyboard reveals the full composer without moving other editors', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const viewport = readFileSync(new URL('../viewport.js', import.meta.url), 'utf8');
  assert.match(app, /document\.activeElement === \$\('person-name'\)/);
  assert.match(app, /composerBottom: composer\.getBoundingClientRect\(\)\.bottom/);
  assert.match(app, /viewportBottom: area\.getBoundingClientRect\(\)\.bottom/);
  assert.match(app, /if \(delta > 0\) area\.scrollTop \+= delta/);
  assert.match(viewport, /export function keyboardComposerScrollDelta/);
  assert.ok(app.includes('if (manualKeyboard) scheduleManualActionReveal();'));
  assert.match(html, /id="update" class="primary"/);
});

test('calibrated +10 px manual keyboard position stays after temporary panel removal', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const viewport = readFileSync(new URL('../viewport.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /keyboard-calibrator|data-keyboard-shift/);
  assert.doesNotMatch(css, /keyboard-calibrator|keyboard-tune-|keyboard-test-active/);
  assert.doesNotMatch(app, /KEYBOARD_TEST_KEY|keyboardTuner|keyboardTestOffset|showKeyboardTuner/);
  assert.doesNotMatch(viewport, /clampKeyboardTestOffset|formatKeyboardTestOffset/);
  assert.ok(viewport.includes('export const MANUAL_KEYBOARD_OFFSET_PX = 10'));
  assert.ok(app.includes("style.setProperty('--manual-keyboard-offset', MANUAL_KEYBOARD_OFFSET_PX + 'px')"));
  assert.ok(app.includes("const manualKeyboard = ios && layout.keyboard && document.activeElement === $('person-name')"));
  assert.ok(app.includes("classList.toggle('keyboard-manual-offset', manualKeyboard)"));
  assert.ok(app.includes("composer.getBoundingClientRect().bottom - visualOffset"));
  assert.ok(css.includes('.keyboard-open #perform-view.keyboard-manual-offset{transform:translateY(var(--manual-keyboard-offset,0px))}'));
});

test('diagnostic tools are collapsed, record/export remain visible and obsolete probe controls are removed',()=>{
 const advanced=html.slice(html.indexOf('<details id="diagnostic-advanced"'),html.indexOf('</details>',html.indexOf('<details id="diagnostic-advanced"')));
 assert.match(advanced,/<summary>Diagnóstico avançado<\/summary>/);
 assert.doesNotMatch(advanced,/<details[^>]*\bopen\b/);
 assert.match(advanced,/id="diagnostics-summary"/);
 assert.match(advanced,/id="remote-test"/);
 for(const id of ['diagnostic-begin','diagnostic-end','export-diagnostics']){assert.ok(html.includes('id="'+id+'"'));assert.ok(!advanced.includes('id="'+id+'"'));}
 assert.doesNotMatch(html,/id="(?:diagnostic-refresh|diagnostic-playlist|test-playlist-access|playlist-access-status)"/);
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/\$\('remote-pairing'\)\.hidden = paired && !remoteConfigOpen/);
 assert.match(app,/\$\('remote-configure'\)\.hidden = !paired/);
});

test('last update attempt is a separate collapsed section below daily history with no new request action',()=>{
 const history=html.indexOf('<details id="spotify-daily-history"');
 const attempt=html.indexOf('<details id="update-attempt"');
 assert.ok(history>=0&&attempt>history);
 assert.ok(html.indexOf('</details>',history)<attempt);
 assert.doesNotMatch(html.slice(attempt,html.indexOf('>',attempt)),/\bopen\b/);
 assert.ok(html.includes('id="update-attempt-list"'));
 assert.ok(html.includes('Últimas 5 tentativas de atualização'));
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/\$\('update-attempt'\)\.(onclick|addEventListener)/);
});
