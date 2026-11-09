# Predify

PWA para montar uma playlist do Spotify em que as iniciais das músicas formam uma abertura fixa seguida de um nome

## Usar

1. Abra o site, entre em Ajustes e conecte o Spotify
2. Em Catálogo, escolha uma letra, busque no Spotify e toque em + para salvar até cinco músicas, links completos continuam disponíveis como alternativa
3. Opcionalmente, em Ajustes configure a abertura fixa buscando músicas exclusivas no Spotify, sem usar as cinco escolhas do catálogo
4. Em Atualizar, escolha uma playlist sua, digite um nome e confira a prévia
5. Toque em Atualizar playlist para substituir o conteúdo da playlist selecionada

A busca no Spotify é usada apenas ao configurar o catálogo, durante a montagem dos nomes o app usa exclusivamente suas escolhas salvas
Os resultados são sugestões paginadas filtradas pela inicial, não uma listagem completa de todas as músicas do Spotify
Em cada espaço, Trocar no Spotify permite substituir uma escolha existente
A abertura preserva as faixas salvas, o nome usa as músicas em ordem de prioridade, sem sorteio e sem repetir uma música já presente na sequência
Em Catálogo, toque em Reorganizar e arraste pela alça ou use as setas para alterar a prioridade, a ordem é salva neste aparelho
A busca mostra no máximo cinco sugestões por vez, use Próximas 5 músicas para ver as seguintes
Se uma letra do nome precisar de mais faixas diferentes do que as disponíveis, o envio fica bloqueado com um aviso
Não é preciso completar as 130 posições para começar, basta cadastrar as letras do nome, e as da abertura se quiser usá-la
Acentos e espaços são ignorados na formação das iniciais

A abertura possui sua própria busca no Spotify, um rascunho salvo no aparelho e proteção contra músicas presentes no catálogo ou repetidas em outra posição
Músicas antigas em conflito não são apagadas automaticamente, a interface mostra um aviso para a pessoa substituir as escolhas conflitantes
A capa é consultada diretamente no endpoint específico do Spotify, recorrendo à capa do álbum quando a playlist não disponibiliza uma imagem
Faixas duplicadas na playlist não podem ser removidas individualmente pelo Predify porque a remoção por URI do Spotify poderia remover todas as ocorrências

## GitHub Pages

Publique a branch `main`, pasta `/ (root)`, em Settings → Pages
URL esperada: https://100ratings.github.io/predify/

No Spotify Developer Dashboard, registre exatamente esta Redirect URI, incluindo a barra final:

```
https://100ratings.github.io/predify/
```

O Client ID público está em `spotify.js`, o projeto usa OAuth Authorization Code com PKCE e não precisa de Client Secret
Permissões: `playlist-modify-public`, `playlist-modify-private`, `playlist-read-private`
São usados os endpoints atuais de playlist `/items`
A conta proprietária do aplicativo Spotify precisa cumprir as exigências do modo de desenvolvimento, incluindo Premium

## iPhone

No Safari, Compartilhar → Adicionar à Tela de Início → Abrir como App da Web
Abra pelo ícone Predify e conecte o Spotify a partir desse modo
O CSS cobre a tela e respeita as áreas seguras, o ajuste de altura para iOS evita faixas vazias
O sistema controla a barra de status e o indicador de gestos

## Dados e sessão

Catálogo, abertura e seleção ficam em localStorage neste navegador/aparelho, sem sincronização automática entre aparelhos ou modos de abertura
A conexão é armazenada no mesmo aparelho com refresh token e renovada automaticamente enquanto o Spotify permitir
Desconectar remove as credenciais locais e mantém o catálogo
Para revogar acesso ao aplicativo no Spotify, use a área de aplicativos autorizados da sua conta
Exportar catálogo gera JSON sem credenciais, importar substitui catálogo e abertura após confirmação
O último conteúdo da playlist antes da substituição fica em `predify.last-backup` neste aparelho, não é um histórico nem uma restauração automática
As chamadas de autenticação e API vão diretamente ao Spotify, o service worker guarda apenas os arquivos da interface
Não coloque tokens, Client Secret, catálogos pessoais ou arquivos `.env` neste repositório

## Desenvolvimento

HTML, CSS e JavaScript nativos, sem dependências de execução ou build
Sirva a pasta com um servidor HTTP local, não abra via `file://`
Para login local é necessário cadastrar um retorno HTTP de loopback permitido pelo Spotify

```
npm test
npm run check
```

Os testes validam montagem das iniciais, preservação da abertura, importação do catálogo e leitura dos links
Uma gravação real só acontece quando você toca no botão Atualizar playlist

## Atualizações do app

Ajustes mostra a versão instalada e o botão Atualizar o app
O app consulta version.json a cada segundo enquanto está visível e online, sem sobrepor consultas
Ao detectar uma nova compilação ele avisa, o usuário toca no botão para atualizar
A atualização preserva localStorage, catálogo e conexão Spotify
A verificação ocorre imediatamente ao abrir ou voltar ao app e depois a cada 60 segundos enquanto o app está visível e online, sem consultas em segundo plano

Antes de cada publicação, rode `npm run release` para incrementar a versão e renovar as referências dos arquivos
Envie todos os arquivos modificados juntos, incluindo version.json, version.js, package.json e sw.js

Sem abertura configurada, é possível testar e enviar somente o nome, por exemplo Ca com músicas cadastradas em C e A
O botão Atualizar o app só é habilitado quando o descritor remoto indica uma compilação diferente da instalada
Gestos de zoom, incluindo pinça e duplo toque, estão bloqueados na interface

## Seleção A a Z e resolução verificada no Spotify

O catálogo tem cinco posições por letra, em ordem de prioridade e sem repetição de faixas

A importação tradicional (JSON version 1) continua válida, inclusive arquivos antigos com cinco posições, que são expandidos sem alterar as escolhas

O JSON de seleção (version 2) guarda nomes e artistas, podendo trazer IDs já verificados, e deve ser importado com o Spotify conectado
O Predify consulta a API do Spotify, seleciona apenas correspondências de título e artista e obtém IDs, URIs e capas oficiais, antes de substituir os dados locais
Gravações ao vivo, karaokê, tributos e remixes são descartados pelo resolvedor automático
A importação informa o progresso e pode ser cancelada sem modificar o catálogo anterior, falhas de autenticação ou limites persistentes também preservam os dados anteriores
Músicas não identificadas são listadas como pendentes e não recebem links fictícios, ajuste-as manualmente no catálogo se necessário
Após importar, use Exportar catálogo para salvar o JSON version 1 final com os dados reais do Spotify

A lista de cinco sugestões por letra fica no arquivo local `suggestions.js` do aplicativo, sem Spotify IDs, e é exibida sem chamadas à API


## Cinco sugestões locais por letra
O aplicativo apresenta cinco sugestões da seleção A a Z em \`suggestions.js\` antes de qualquer busca online
A letra X começa com "X", do System of a Down, seguida das quatro músicas enviadas posteriormente
Essas sugestões não são músicas cadastradas e não ocupam vagas, apenas tocar em Adicionar dispara até duas buscas pontuais no Spotify para validar título, artista, ID, URI e capa
A busca por outras músicas e a inclusão por link permanecem disponíveis, mas não são executadas automaticamente ao entrar no Catálogo ou selecionar uma letra
O limite permanente do catálogo é de cinco músicas por letra, até 130 no total
Catálogos antigos com dez músicas por letra são reduzidos às cinco primeiras posições preenchidas, com uma cópia de segurança local no item \`predify.backup.before-five.v1\`
A abertura fixa permanece intacta, e faixas repetidas são rejeitadas e sinalizadas

## Reconexão ao Spotify

A partir da versão 1.2.17, uma tentativa de autorização interrompida no iPhone não deixa o botão Conectar Spotify permanentemente desativado ao retornar ao aplicativo
Falhas de retorno do Spotify e carregamento das playlists aparecem de forma persistente no cartão Conta Spotify em Ajustes, sem eliminar catálogo ou abertura fixa
Um código de autorização expirado durante uma nova conexão não apaga uma sessão anteriormente válida, a revogação de um refresh token ainda desconecta a sessão expirada

## Inicialização e verificação de atualizações

A partir da versão 1.2.18, a verificação de versão inicia antes de qualquer autorização Spotify ou processamento do catálogo, evitando que a tela fique indefinidamente em 'Conferindo versão' caso uma etapa posterior trave
O HTML apresenta a versão de publicação mesmo antes do JavaScript executar, e o script de release atualiza esse texto automaticamente em futuras versões
Não é necessário reinstalar o app para atualizar, não limpe o armazenamento local, pois ele contém catálogo, abertura e configurações

## Atualização da playlist

O botão Atualizar playlist continua usando uma única requisição PUT para substituir o conteúdo da playlist pela abertura fixa seguida das músicas do nome
A restauração da abertura fixa, automática e manual, foi retirada da interface na versão 1.2.20 a pedido do usuário, o código não faz exclusões na inicialização
O catálogo e a configuração da abertura fixa permanecem preservados no armazenamento local

## Capa e teclado no iPhone

A versão 1.2.21 prioriza a capa da própria playlist retornada pelo Spotify, usando a capa da primeira faixa apenas se a imagem da playlist estiver indisponível
A playlist Aleatoriedades - Demian utiliza a imagem de colagem fornecida pelo usuário, armazenada localmente no pacote, sem alterar a capa do Spotify
Na aba Atualizar, a tecla Ir/Enter do teclado dispara o mesmo botão Atualizar playlist, mantendo a verificação de disponibilidade e o PUT existente
O campo usa semântica de pesquisa para reduzir sugestões de preenchimento de contatos, mas a barra nativa de AutoFill do iOS é gerenciada pelo sistema e não pode ser eliminada com garantia por uma PWA

## Linguagem e ícones da versão 1.2.22

Tela principal: SUA PRÓXIMA EXPERIÊNCIA; Uma coincidência musical,; Uma playlist, mais do que parece
Campo de entrada: Qual é a palavra?; Ex: Paralelepípedo; Vamos ver onde isso vai dar
A caixa verde da prévia exibe a frase completa em maiúsculas sem modificar o valor de entrada ou a pesquisa por iniciais
A prévia vazia orienta a digitar uma palavra, e o painel de instalação do iPhone foi retirado de Ajustes
Ícones da distribuição `favicon_io.zip` atualizados para iOS, Android e abas do navegador, com atualização do cache de aplicativo

## Correção de ícone, versão 1.2.23

O ícone Android de 512×512 foi reconstruído a partir do arquivo original enviado pelo usuário para assegurar integridade PNG e permitir instalação em todos os dispositivos

## Confirmação antes de desconectar o Spotify, 1.2.24

A opção Desconectar deste aparelho exige confirmação nativa explícita antes de remover a autorização local
Cancelar o diálogo não modifica a sessão, as playlists nem o catálogo, e não interfere na renovação automática do acesso
O Spotify definiu uma vida útil de seis meses para refresh tokens a partir de 2026, e após expiração a nova autorização é inevitável, embora o token de acesso continue sendo renovado automaticamente durante esse período

## Última palavra enviada com sucesso, 1.2.25

Ao lado das iniciais, o Predify mostra um check verde e a última palavra enviada com sucesso para a playlist selecionada
A informação muda apenas quando o Spotify confirma a substituição via PUT, sem chamadas extras à API, e fica salva no aparelho para quando o usuário reabrir o aplicativo
Digitar outra palavra não remove a informação da última enviada, e a indicação desaparece ao selecionar outra playlist para evitar enganos
Falhas no envio não substituem a última palavra confirmada

## Redução de consultas de atualização, 1.2.26

As verificações de `version.json` passam de 1 segundo para 60 segundos, com consulta imediata na inicialização ou quando o aplicativo volta a ficar visível ou online, sem sobreposição e sem alterar o envio das músicas ao Spotify

## Integração automática com Inject, comportamento atual 1.2.30

Em Ajustes, Inject API recebe o Seu ID oculto de quatro dígitos e possui o botão Verificar
A consulta GET ao Inject ocorre a cada 500 ms enquanto o app estiver visível, online, com Spotify conectado e playlist selecionada
A primeira consulta estabelece a referência do count, sem reenviar a última palavra; o count é salvo por ID
Ao mudar o count, o Predify usa o value para montar a sequência diretamente em memória, sem alterar o campo Qual é a palavra?, sem clicar no botão manual e sem renderizar a prévia
O envio automático ao Spotify é feito diretamente por PUT, sem consultas GET adicionais antes ou depois
Somente após a confirmação do Spotify o indicador verde Última é atualizado, sempre associado à playlist escolhida
O app preserva o último sucesso em caso de falha, evita requisições de leitura simultâneas e adia o envio quando outra operação está em curso
O botão Verificar não envia músicas nem muda o count salvo; ao voltar ao primeiro plano ou recuperar a internet, o monitor faz uma nova consulta imediatamente

## Manter a tela ligada durante uma apresentação

Na tela Performar, ao lado da descrição principal, o botão Ativar tela solicita a Screen Wake Lock API nativa do Safari, sem vídeos ou bibliotecas adicionais
Somente exibe confirmação quando o iPhone aceita a proteção, toque novamente para desativar
A proteção libera a tela quando o Predify sai de primeiro plano e tenta reativar ao retornar, enquanto o usuário não a tiver desligado
Essa função não autoriza o Inject a continuar rodando em segundo plano, não impede bloqueio manual e pode ser recusada pelo sistema em algumas condições
A preferência é salva no aparelho, ao reabrir ou atualizar o aplicativo, o Predify tenta restaurar a proteção automaticamente, se o iOS recusar a solicitação, o status informa a falha e permite tentar novamente com um toque

## Preferência da tela ligada no Safari do iPhone

O Predify memoriza a opção de manter a tela ligada, mesmo ao fechar o aplicativo
Se o iOS recusar a solicitação automática durante a inicialização, o app mantém a preferência e tenta novamente assim que houver uma interação normal na interface, como tocar em Performar
A proteção é indicada como ativa somente após o sistema conceder o Wake Lock, pode ser revogada pelo iOS e nunca funciona enquanto o aplicativo está em segundo plano
O botão discreto da tela Performar indica ✓ Tela ativa quando a proteção está ligada, tocá-lo neste estado desativa a preferência

## Controle compacto na tela Performar

O botão Ativar tela aparece ao lado de Uma playlist, mais do que parece
Depois de receber a proteção, muda para ✓ Tela ativa, e só neste estado tocar desliga a preferência
Caso o Safari tenha recusado a tentativa automática mas a preferência continue salva, tocar Ativar tela tenta reativar a proteção sem desligar a escolha anterior
O controle não aparece mais em Ajustes e não altera o funcionamento do Inject ou Spotify

## Campo manual com teclado aberto no iPhone

Ao tocar em Qual é a palavra?, a interface adapta a altura à área realmente visível do iPhone e desloca a rolagem interna apenas o necessário para mostrar o cartão completo com o botão Atualizar playlist acima do teclado
Ao fechar o teclado ou editar outros campos, o reposicionamento não é aplicado
O envio automático do Inject permanece independente do campo manual
Ajuste visual final de +10 px para baixo ao abrir o teclado no campo manual, calibrado diretamente no iPhone, sem painel temporário
