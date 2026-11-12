// Technical timing only, never retain words, Spotify IDs, tokens or request URLs
const fields=['previousPollStartedAt','pollStartedAt','detectedAt','attemptStartedAt','tokenReadyAt','confirmedAt','finishedAt'];
const results=new Set(['pending','confirmed','rate-limit','auth','access','not-found','invalid-sequence','spotify-error','unknown-write','interrupted','cancelled']);
const timestamp=value=>Number.isSafeInteger(value)&&value>0;
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{8,64}$/.test(value);
export function cleanDeliveryTiming(value) {
  if(!value||!validId(value.id)||!timestamp(value.attemptStartedAt))return null;
  const out={id:value.id,result:results.has(value.result)?value.result:'pending'};
  if(validId(value.runId))out.runId=value.runId;
  for(const field of fields)if(timestamp(value[field]))out[field]=value[field];
  out.requests=(Array.isArray(value.requests)?value.requests:[]).slice(-8).filter(r=>['spotify','spotify-auth'].includes(r?.service)).map(r=>{
    const request={service:r.service};
    for(const field of ['checkpointStartedAt','startedAt','responseAt','failedAt'])if(timestamp(r[field]))request[field]=r[field];
    if(Number.isInteger(r.status)&&r.status>=100&&r.status<=599)request.status=r.status;
    return request;
  });
  return out;
}
export function deliveryTimingSummary(value) {
  const timing=cleanDeliveryTiming(value);
  if(!timing)return 'Medição de velocidade disponível após o próximo envio remoto';
  const lines=['Último envio remoto medido'];
  const time=at=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hour12:false}).format(at);
  for(const [field,label]of [['pollStartedAt','Leitura do Inject iniciada'],['detectedAt','Palavra detectada pela Cloudflare'],['attemptStartedAt','Preparação iniciada'],['tokenReadyAt','Autorização pronta']])if(timing[field])lines.push(label+': '+time(timing[field]));
  const puts=timing.requests.filter(r=>r.service==='spotify');
  puts.forEach((r,i)=>{if(r.startedAt)lines.push('Envio ao Spotify '+(i+1)+': '+time(r.startedAt));if(r.responseAt)lines.push('Resposta do Spotify '+(i+1)+': '+time(r.responseAt));});
  if(timing.confirmedAt)lines.push('Atualização confirmada: '+time(timing.confirmedAt));
  const first=puts[0];
  if(timing.detectedAt&&first?.startedAt>=timing.detectedAt)lines.push('Detecção até início do envio: '+(first.startedAt-timing.detectedAt)+' ms');
  if(timing.detectedAt&&timing.confirmedAt>=timing.detectedAt)lines.push('Detecção até confirmação: '+(timing.confirmedAt-timing.detectedAt)+' ms');
  lines.push('Não mede quando a palavra chegou ao Inject nem quando a tela do aplicativo Spotify mudou');
  return lines.join('\n');
}
