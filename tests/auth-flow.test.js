import test from 'node:test';
import assert from 'node:assert/strict';
const storage = new Map();
global.localStorage = {getItem:key=>storage.get(key) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
global.location={href:'https://100ratings.github.io/predify/',pathname:'/predify/',search:''};
global.history={replaceState:()=>{}};
const {finishLogin,auth} = await import('../spotify.js');

test('Spotify callback in a different browser reports a specific missing request', async () => {
  storage.delete('predify.oauth');
  location.search='?code=testcode&state=expected';
  await assert.rejects(finishLogin(),/outro navegador|outra janela/);
});
test('invalid_grant during new login does not erase an existing valid session', async () => {
  const previous={access_token:'existing',refresh_token:'prior',expires_at:Date.now()+3600000};
  storage.set('predify.auth.v1',JSON.stringify(previous));
  storage.set('predify.oauth',JSON.stringify({state:'expected',verifier:'verifier',time:Date.now(),redirect:'https://100ratings.github.io/predify/'}));
  location.search='?code=expired&state=expected';
  global.fetch=async()=>({ok:false,status:400,json:async()=>({error:'invalid_grant'})});
  await assert.rejects(finishLogin(),/código de autorização do Spotify expirou/);
  assert.equal(auth().access_token,'existing');
});
