// The last user-visible attempt is separate from anonymous technical diagnostics
export const UPDATE_ATTEMPT_KEY = 'predify.last-update-attempt.v1';
export const ATTEMPT_RESULTS = {
  pending:'Aguardando confirmação, se a tentativa foi interrompida, confira a playlist antes de repetir',
  confirmed:'Atualização confirmada pelo Spotify',
  'rate-limit':'Falhou: limite de chamadas do Spotify atingido',
  auth:'Falhou: a conexão com o Spotify expirou ou foi revogada, conecte novamente',
  access:'Falhou: o Spotify recusou o acesso, confira a conta e as permissões da playlist',
  'not-found':'Falhou: música ou playlist não encontrada no Spotify',
  'invalid-sequence':'Falhou: não foi possível montar a sequência, confira o catálogo e a abertura',
  'backup-failed':'Falhou antes do envio: não foi possível preparar o backup da playlist',
  'spotify-error':'Falhou: o Spotify recusou a atualização',
  'unknown-write':'Não foi possível confirmar: houve uma falha durante o envio, confira a playlist antes de repetir',
  interrupted:'Não foi possível confirmar: a tentativa foi interrompida, confira a playlist antes de repetir',
  cancelled:'Tentativa cancelada antes do envio ao Spotify'
};
export const ATTEMPT_ORIGINS = {manual:'Manual',remote:'Apresentação remota',inject:'Inject neste aparelho'};
export function cleanUpdateAttempt(value) {
  if (!value || typeof value.id!=='string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || !Object.hasOwn(ATTEMPT_ORIGINS,value.origin) || !Object.hasOwn(ATTEMPT_RESULTS,value.result) || !Number.isFinite(value.at) || value.at<=0 || typeof value.word!=='string' || !value.word.trim()) return null;
  return {id:value.id,word:value.word.trim().slice(0,100),origin:value.origin,at:value.at,updatedAt:Math.max(value.at,Number(value.updatedAt)||value.at),result:value.result,
    ...(Number.isInteger(value.status)&&value.status>=100&&value.status<=599?{status:value.status}:{})};
}
export function createUpdateAttempt(word,origin,at=Date.now()) {
  return cleanUpdateAttempt({id:crypto.randomUUID(),word,origin,at,updatedAt:at,result:'pending'});
}
export function finishUpdateAttempt(attempt,result,status) {
  return cleanUpdateAttempt({...attempt,result,status,updatedAt:Date.now()});
}
export function updateAttemptError(error,stage='write') {
  if(error?.status===429)return 'rate-limit';
  if(error?.code==='spotify-auth'||error?.status===401)return 'auth';
  if(error?.status===403)return 'access';
  if(error?.status===404)return 'not-found';
  if(stage==='backup')return 'backup-failed';
  if(error?.status>=400&&error.status<500)return 'spotify-error';
  return 'unknown-write';
}
export function newestUpdateAttempt(...values) {
  return values.map(cleanUpdateAttempt).filter(Boolean).reverse().sort((a,b)=>b.at-a.at || b.updatedAt-a.updatedAt)[0] || null;
}
export function createUpdateAttemptStore(storage=globalThis.localStorage) {
  let current=null,storageLimited=false;
  function read() {try{return cleanUpdateAttempt(JSON.parse(storage.getItem(UPDATE_ATTEMPT_KEY)));}catch{return null;}}
  current=read();
  return {
    get(){current=newestUpdateAttempt(current,read());return current;},
    save(value){const next=newestUpdateAttempt(current,read(),value);if(!next)return current;if(JSON.stringify(next)!==JSON.stringify(current)){current=next;try{storage.setItem(UPDATE_ATTEMPT_KEY,JSON.stringify(current));}catch{storageLimited=true;}}return current;},
    get storageLimited(){return storageLimited;}
  };
}
