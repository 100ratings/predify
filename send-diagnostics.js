// Fixed reason codes only, never words, playlist IDs, errors containing user data or tokens
export const SEND_REASON_LABELS = {
 'remote-busy':'O monitor remoto está iniciando ou encerrando',
 'remote-unknown':'O estado do monitor remoto ainda não foi confirmado',
 'remote-active':'A apresentação remota está controlando a playlist',
 'send-busy':'Outro envio ainda está em andamento',
 'playlist-busy':'Outra operação na playlist está em andamento',
 'playlist-loading':'As músicas da playlist estão sendo carregadas',
 'catalog-importing':'O catálogo está sendo importado',
 'spotify-disconnected':'O Spotify não está conectado',
 'playlist-missing':'Nenhuma playlist foi selecionada',
 'playlist-unavailable':'A playlist selecionada não está disponível na lista carregada',
 'sequence-invalid':'A sequência contém um problema de configuração',
 'sequence-empty':'A sequência não contém músicas para enviar',
 'monitor-disconnected':'O monitor remoto não está conectado',
 'inject-id-invalid':'O ID do Inject não tem quatro dígitos válidos',
 'empty-input':'O Inject recebeu um valor vazio',
 'no-new-input':'Nenhuma nova mudança do Inject foi observada',
 'opening-conflict':'Há músicas repetidas entre a abertura e o catálogo',
 'request-failed':'Uma operação do envio falhou',
 'missing-confirmation':'O Spotify não devolveu uma confirmação válida'
};
export function sendBlockReasons(state) {
 const reasons=[];
 for(const [field,reason]of Object.entries({remoteBusy:'remote-busy',remoteUnknown:'remote-unknown',remoteActive:'remote-active',sending:'send-busy',playlistBusy:'playlist-busy',playlistLoading:'playlist-loading',importingCatalog:'catalog-importing',invalidSequence:'sequence-invalid'}))if(state[field])reasons.push(reason);
 for(const [field,reason]of Object.entries({connected:'spotify-disconnected',hasPlaylist:'playlist-missing',playlistAvailable:'playlist-unavailable',hasTracks:'sequence-empty',paired:'monitor-disconnected',injectIdValid:'inject-id-invalid'}))if(state[field]===false)reasons.push(reason);
 return reasons;
}
