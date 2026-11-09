# Monitor remoto do Predify

Worker pessoal publicado em https://predify-inject-lab.omentalistademian.workers.dev

O navegador envia uma fotografia do catálogo, abertura e playlist ao iniciar uma apresentação, o Durable Object consulta o Inject e monta as playlists com o mesmo `buildSequence` do aplicativo

## Operação

- `POST /api/start`: modo `test` (somente Inject) ou `live` (Spotify), duração entre 1 e 240 minutos
- `POST /api/stop`: encerra consultas e impede novos envios, uma alteração já aceita pelo Spotify não pode ser desfeita
- `GET /api/status`: estado e confirmação do último PUT, sem credenciais
- `POST /api/sync`: devolve os tokens atualizados somente ao aparelho autenticado
- `GET /health`: disponibilidade da configuração
- `GET /lab`: métricas anônimas do primeiro teste, sem palavras ou credenciais

As rotas `/api/` exigem `Authorization: Bearer <REMOTE_KEY>`, CORS permite apenas `https://100ratings.github.io`

## Segredos

Configure `REMOTE_KEY` (32 bytes aleatórios em base64url) e `TOKEN_ENCRYPTION_KEY` (32 bytes aleatórios em base64) como secrets da Cloudflare, nunca como variáveis públicas ou arquivos versionados

Os tokens Spotify ficam cifrados com AES-256-GCM no armazenamento do Durable Object e só são decifrados em memória durante a apresentação, o encerramento cancela operações pendentes e mantém uma cópia cifrada para sincronização com o aparelho por no máximo uma hora, apagada após a retirada

PKCE permite renovar o token sem Client Secret, nenhuma credencial Spotify é necessária no modo de teste

Quando o Spotify rotaciona o refresh token, a versão nova fica cifrada e é sincronizada com o aparelho autenticado ao retornar ou encerrar a apresentação, após uma hora sem recuperar os tokens de uma apresentação encerrada, pode ser necessário conectar o Spotify novamente

O link privado de conexão usa um fragmento `#remote-key=...`, o navegador salva a chave neste aparelho e remove o fragmento do endereço, nunca publique esse link em issues, commits ou logs

## Continuidade e duplicações

Um único objeto controla a apresentação, inícios concorrentes são recusados

O primeiro count é referência, mudanças posteriores são persistidas e somente o evento mais recente aguarda envio enquanto um PUT estiver em andamento

Um envio só gera confirmação com HTTP de sucesso e `snapshot_id` do Spotify, o caminho automático não faz GET de playlist nem buscas de músicas

Quando um PUT perde a conexão ou é interrompido por substituição do processo, seu resultado pode ser incerto, esse envio não é repetido automaticamente, HTTP 429 respeita o prazo de Retry-After

Enquanto a chave remota está conectada, o monitor local permanece suspenso inclusive após Encerrar apresentação, desconectar o monitor adota uma referência nova antes de restaurar o receptor local original

## Plano gratuito e intervalos

Durable Objects SQLite estão disponíveis no Free, a documentação consultada em 9 de novembro de 2026 informa 100 mil chamadas de objeto, 13 mil GB-s e 100 mil linhas escritas por dia, além de 5 milhões de linhas lidas e 5 GB de armazenamento

Quatro horas de um objeto ativo a 128 MB representam aproximadamente 1.843 GB-s (usando 0,128 GB), dentro da cota diária sem outros consumidores, as consultas externas ao Inject não são chamadas HTTP de entrada ao Worker

O monitor usa alarmes duráveis em blocos de oito segundos e temporizadores de 500 ms entre os inícios das consultas dentro de cada bloco, um alarme de recuperação é persistido antes do trabalho, somente checkpoints e mudanças de count são gravados

Alarmes e temporizadores não oferecem precisão exata, latência externa, falhas de rede ou recuperação do processo podem causar pausas, erros do Inject usam recuo exponencial e Retry-After

Limites próprios: quatro horas por apresentação, 50 mil tentativas de consulta por dia (cerca de 6h56 a 2/s) e 12 horas de atividade por dia, cotas são compartilhadas com os outros serviços da conta

O teste inicial real, anterior a qualquer mudança no aplicativo, durou três minutos e concluiu 359 leituras, zero erros, intervalo p50/p95 de 500 ms e máximo de 560 ms, resposta do Inject p50 de 58 ms e máximo de 335 ms, parada automática confirmada

Não houve mudança de count nesse teste, latência de detecção ponta a ponta e operação durante horas ainda precisam de validação em apresentação, os testes automatizados simulam mudanças, reinícios, PUTs, autenticação, cifragem, expiração e backoff

## Publicação

Use Wrangler oficial, autenticado com token restrito a este Worker

```sh
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Referências oficiais: https://developers.cloudflare.com/durable-objects/platform/pricing/ e https://developers.cloudflare.com/durable-objects/platform/limits/
