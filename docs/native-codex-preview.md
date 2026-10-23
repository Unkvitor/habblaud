# Preview isolado: Codex / Gemini

## Objetivo e escopo

Gerenciar mensagens, histórico e solicitações suportadas sem alterar o Habblaud original.
Cópia: `/home/joo_vitor/habblaud-preview`, branch `fix/native-codex-preview`.
Preview: http://localhost:4757. Original permanece em 4747; Hub permanece em 4748.
Sem dependências novas, chamadas de inferência na validação, agentes adicionais, Jira, GitLab ou CI.
Estado próprio em `.preview-data/`; nomes e salas foram copiados, sem compartilhar arquivos graváveis.

## Arquitetura e diagnóstico

- CLI e daemon instalados: **0.163.0**, confirmados localmente. O schema foi gerado com
  `codex app-server generate-ts --out /tmp/habblaud-codex-protocol`.
- `codex:bridge` atual usa `codex queue`: seu ACK confirma enfileiramento, não resposta nem término.
  Ele não fornece um canal bidirecional de eventos/aprovações.
- O terminal atual lê rollouts e limita cada mensagem a 20.000 caracteres. O painel novo lê
  `thread/items/list` pelo protocolo oficial e conserva o texto completo retornado, paginando os itens.
  Isso comprova uma limitação de exibição; não atribui todas as respostas ausentes a essa única causa.
- Não foi encontrado `hooks.json`/`settings.json` nem configuração de hooks no CODEX_HOME padrão.
  O mecanismo existente de permissões depende desses hooks; o preview não instala nem redireciona hooks.
- O daemon está ativo. Dois probes de inicialização via `app-server proxy` expiraram sem resposta.
  Nenhum daemon foi reiniciado. O transporte oficial `app-server --stdio` inicializou normalmente.
- Adaptador Node -> JSON-RPC nativo por stdio -> SSE local -> painel do Habblaud.
  A API HTTP apenas adapta o transporte; não substitui o protocolo de execução do Codex.
- A conexão só inicializa o transporte, sem `thread/start`, `thread/resume` ou `turn/start` automáticos.
  A consulta ao histórico existente usa métodos de leitura, sem retomar nem assumir sua execução.
- Referência oficial consultada: https://learn.chatgpt.com/docs/app-server.
  Para o contrato exato, o schema da versão instalada prevalece.

## Funcionalidades

Abra **Agentes · Codex / Gemini**, selecione Marcelo ou Henrique.
Mensagens existentes usam o registro original `/api/messages`, com o mesmo runner/fila e ACK.
O polling do bridge retorna vazio quando existe runner local, conforme a regra original: não há fanout.
Respostas e execução de sessões existentes são atualizadas a cada quatro segundos enquanto o painel está aberto.
O histórico anterior pode ser carregado por páginas; recarga recupera a seleção e o histórico do Codex.

**Nova sessão · somente leitura** é uma ação explícita para uso posterior, não executada na validação.
O código solicita `sandbox: read-only`, `approvalPolicy: on-request`, `approvalsReviewer: user`,
`features.multi_agent: false` e `mcp_servers.codex_tui.enabled: false` apenas nessas sessões.
Não modifica configurações globais. O envio usa `turn/start` uma vez, sem repetição após timeout.
A retomada é permitida somente para IDs criados pelo preview e não carregados em outro cliente.
Nenhuma política automática ou permissão irrestrita foi habilitada.

Para sessões gerenciadas, há streaming cumulativo e deduplicação por item. Aprovações de comandos e
alterações de arquivo podem ser aceitas uma vez ou recusadas. São vinculadas ao ID JSON-RPC tipado,
thread, turno, item, método e token efêmero da conexão. Concessões com `grantRoot` não podem ser aceitas
pelo painel. Pedidos resolvidos, turnos concluídos e desconexões invalidam os tokens.

O painel Gemini/Antigravity consulta exclusivamente `http://127.0.0.1:4748/api/status` e exibe os eventos,
modelo informado, status e última observação reais do Hub. Nenhum personagem ou atividade é inventado.

## Validação real

- Testes foram escritos antes das implementações; a duplicação de solicitação e o streaming cumulativo
  tiveram falhas de asserção reproduzidas antes das correções.
- `npm test`: 161 arquivos, **1.894 testes aprovados, 2 ignorados** na suíte completa final.
- Após ajustes de polling/streaming e sessões vazias: testes direcionados, suíte completa final e `npm run typecheck` aprovados.
- `npm run build`: cliente e servidor compilados; aviso de tamanho de bundle do projeto.
- `npm run i18n:check`: termina com sucesso; textos novos sem tradução usam português, conforme CONTRIBUTING.
- `node scripts/verify-native-preview.mjs`: navegador real, histórico completo comparado com API,
  paginação, recarga, Marcelo/Henrique, evento real do Hub, bloqueio de CSRF, tomada de sessão legada e
  aprovação expirada, layout móvel e ausência de erros JavaScript. Não envia prompts nem aceita pedidos.
- A leitura nativa real recuperou as duas sessões do workspace e mensagens de assistente.

## Limitações

- O aceite de envio + resposta nova + aprovação real de ponta a ponta **não foi exercitado**:
  isso dispararia trabalho de IA ou exigiria uma sessão gerenciada adicional, vedados nesta execução.
  Streaming e decisões estão cobertos por testes de protocolo; não se apresentam como prova de inferência real.
- Aprovações já abertas no terminal, incluindo `codex_tui.send_message_to_thread`, continuam no cliente de origem.
  Não há interceptação do terminal nem chamada MCP entre agentes.
- Formulários/URLs MCP podem ser recusados; aceitar exige UI específica do schema e fica indisponível.
  `item/tool/requestUserInput`, permissões adicionais e outras solicitações não implementadas não são aprovadas.
- Reabrir o navegador conserva pedidos enquanto o mesmo backend permanece conectado. Reinício do backend
  não restaura IDs efêmeros de aprovação; apenas histórico/IDs gerenciados persistem. Pedidos antigos não são repetidos.
- Gemini é telemetria visual; o Hub não oferece aqui controle de conversas/aprovações do modelo.
- O recurso nativo requer Node no WSL, acesso local e `HABBLAUD_NATIVE_CODEX=1`. Docker mantém o bridge legado.

## Uso mínimo

```bash
cd ~/habblaud-preview
bash scripts/preview-native.sh
```

Abra http://localhost:4757 e **Agentes · Codex / Gemini**.
Se a porta já estiver ocupada pelo preview, utilize a instância existente.
Não execute o script no diretório original nem altere os hooks para testar.
## Arquivos alterados em relação à instalação original

```text
.gitignore
CHANGELOG.md
client/src/app.ts
client/src/ui/native-codex.ts
client/src/ui/native-codex.test.ts
client/src/ui/styles.css
docs/native-codex-preview.md
scripts/preview-native.sh
scripts/verify-native-preview.mjs
server/index.ts
server/codex/app-server.ts
server/codex/app-server.test.ts
server/codex/managed.ts
server/codex/managed.test.ts
server/codex/native-http.ts
```

O repositório original foi consultado novamente ao final e permaneceu sem alterações.
As portas 4747, 4748 e 4757 estavam disponíveis em suas respectivas instâncias.
O preview final foi deixado ativo por um processo WSL separado, sem janela visível.
## Correção complementar: personagem Gemini real no escritório

Causa raiz: `/api/native-codex/hub` abastecia somente o painel textual. Não havia `AgentSource`
Antigravity, conta/provedor correspondente ou inserção em `Office`; portanto o SSE do escritório
não tinha sessão Gemini para o canvas renderizar. A conexão real do backend WSL com 4748 estava funcionando.

Foi adicionada `server/sources/antigravity.ts`, que consulta somente `/api/status`, valida e deduplica
sessões reais, normaliza o workspace e as publica pelo fluxo existente `Office -> snapshot/SSE -> Sim`.
Identidade usa sessão real e workspace. `Stop` mantém o personagem ocioso; `sem_sinal` e a última observação
ficam explícitos. Falhas de rede mantêm a última observação marcada como desconectada, sem inventar eventos.
O mesmo cache atende o painel textual, evitando duas consultas independentes ao Hub.

O preview Node utiliza `http://127.0.0.1:4748`. Em Docker, o adaptador escolhe
`http://host.docker.internal:4748`; `HABBLAUD_QA_HUB_URL` aceita somente origens locais na porta 4748.
Esse endereço precisa ser alcançável pelo container. Como o Hub atual escuta em loopback,
uma instalação Docker pode exigir conectividade de host já configurada. Não foram alterados bind,
firewall, Docker ou segurança do Hub; a validação real foi feita no preview Node/WSL.

Nome, provedor, modelo e último estado observado ficam visíveis no personagem/lista e na gaveta.
Terminal e envio de mensagens são ocultados para Antigravity, pois essa integração é somente telemetria.
O protocolo do Habblaud World não foi ampliado; seu adaptador de visitas recebeu apenas ajuste de tipos
para conservar os dois provedores que aquele protocolo já reconhece.

Validação: 4 testes novos da fonte; conjuntos direcionados aprovados (incluindo 118 testes de fonte,
contas, provedor e simulação); regressões de App Server/aprovações/histórico aprovadas; typecheck e build
aprovados. `scripts/verify-gemini-office.mjs` confirmou a sessão real
`7efde01b-aab3-439d-a059-ef5a74951f41`, modelo `gemini-4-argon-medium`, estado `idle`, evento `Stop`,
observação `sem_sinal`, mesma sala de Marcelo/Henrique, recebimento no store SSE, desenho efetivo do
rótulo Gemini no canvas, persistência após recarga e ausência de erros JavaScript.
A captura real está em `.preview-data/gemini-office-real.png` (não versionada).
O teste funcional Codex anterior também passou novamente. O original permanece sem alterações.

Arquivos desta correção:

```text
CHANGELOG.md
client/src/ui/drawer.ts
client/src/ui/provider.ts
client/src/ui/provider.test.ts
client/src/ui/widgets.ts
client/src/world/sim/sim.ts
docs/native-codex-preview.md
scripts/verify-gemini-office.mjs
server/accounts/detect.ts
server/codex/native-http.ts
server/index.ts
server/model/office.ts
server/sources/antigravity.ts
server/sources/antigravity.test.ts
shared/types.ts
shared/world/office-from-world.ts
```