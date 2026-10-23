# Validação bidirecional real — continuação de f87fa41

Preview: http://localhost:4757 — `/home/joo_vitor/habblaud-preview`.
O original em 4747 não foi modificado; seu repositório continuou limpo. Nenhum processo original foi reiniciado.
Gemini, Marcelo e Henrique foram conferidos antes e depois. Não houve agentes paralelos ou delegação.

## Escopo e autorização

Uma única sessão de teste, com três prompts curtos: resposta textual, aprovação de printf e recusa de printf.
Nenhum modelo adicional, operação destrutiva, acesso a produção, Jira, GitLab ou configuração global alterada.
Cliques Aprovar/Recusar foram específicos do teste; nenhuma política de aprovação automática foi habilitada.
Os três turn_context reais confirmam `approval_policy: on-request`, `sandbox_policy: read-only`,
`approvals_reviewer: user`.

Sessão: `01a16661-8b1b-71f1-a081-34736f100bc6`.
Workspace isolado: `/home/joo_vitor/projetos/qa-agents/.habblaud-validation-f87fa41`.
A sessão foi deixada ociosa para inspeção, sem aprovações pendentes ou novos prompts automáticos.

## Defeitos encontrados e correções

1. `create()` fixava o cwd na raiz do projeto, impedindo o isolamento solicitado.
   A API aceita `cwd` opcional; o backend resolve o caminho real e recusa caminhos fora da raiz permitida,
   inclusive escapes por symlink. A política de somente leitura permanece.
2. A primeira tentativa real retornou 409 antes da criação: o override
   `mcp_servers.codex_tui.enabled=false` inventava uma entrada MCP sem transporte, rejeitada pelo Codex.
   O override foi removido de criação e retomada. `features.multi_agent=false` permanece.
   A reconciliação confirmou zero sessões gerenciadas antes da única criação bem-sucedida (HTTP 201).

As falhas foram reproduzidas em testes antes das correções. Não foram alterados streaming, aprovações,
histórico ou integração Gemini, pois os respectivos caminhos funcionaram no teste real.

## Evidência real

Os três prompts foram enviados uma única vez pelo formulário do painel Habblaud, em navegador real.
A criação usou a API local do próprio Habblaud; não foi criada uma segunda sessão de IA.

| Etapa | Evidência observada |
| --- | --- |
| Mensagem | HTTP 202; resposta exata `HAB_BIDI_OK`; `turn/completed`; texto recuperado após recarga |
| Aprovar | Solicitação nativa `item/commandExecution/requestApproval` vinculada à sessão/turno/item; clique em Aprovar uma vez; HTTP 200; `/bin/bash -c 'printf HAB_APPROVE_OK'` produziu `HAB_APPROVE_OK`, exit code 0 |
| Recusar | Solicitação nativa do segundo printf; clique em Recusar; HTTP 200; resultado nativo `rejected by user`; nenhum CommandExecution executado para o marcador recusado; Codex informou a recusa sem alternativa |
| Streaming | 20 eventos `item/agentMessage/delta` no turno de aprovação e 30 no turno de recusa; ambos com conclusão real |
| Histórico | Três respostas reais conferidas no DOM contra a API; recarga preservou seleção e resposta final; zero erros JavaScript |
| Preservação | Gemini real continua no canvas, modelo `gemini-4-argon-medium`, mesma sala de Marcelo/Henrique; regressão visual aprovada |

O Codex 0.163 registra a recusa de exec_command em code mode como `custom_tool_call_output` no rollout,
sem criar um item CommandExecution com status declined. A primeira asserção do teste esperava esse item;
foi corrigida para verificar o registro nativo de rejeição e a ausência de execução, sem reenviar o prompt.
A resposta de recusa do assistente permanece disponível no histórico nativo após recarga.

Evidência local não versionada: `.preview-data/bidirectional-real.json`, com decisões, IDs de correlação,
eventos reais e resultados; o rollout oficial do Codex conserva stdout e rejeição. Não contém credenciais.

## Verificações

- 17 testes direcionados aprovados: protocolo/identidade de aprovações, sessão gerenciada,
  reconciliação de histórico e fonte Antigravity.
- Typecheck e build aprovados após as mudanças. Build mantém o aviso de tamanho do bundle.
- `node scripts/validate-bidirectional-real.mjs verify`: verificação somente leitura da evidência real,
  três turnos, uma sessão, streaming, histórico/recarga, rejeição nativa e zero pedidos pendentes.
- `node scripts/verify-gemini-office.mjs`: personagem real preservado no canvas/SSE e após recarga.
- `git diff --check`: sem problemas.

O script de teste exige uma sessão já registrada na evidência e impede reenviar fases já tentadas.
`verify` não envia mensagens, não cria sessões e não responde solicitações.

## Limites

Esta validação cobre a sessão nova gerenciada pelo App Server. Não prova controle externo de aprovações
nas sessões antigas de Marcelo/Henrique; elas continuam no cliente original. Não foram testadas retomada
após reinício do backend, formulários MCP, mudanças de arquivos ou comandos com efeitos reais.
Nenhum aceite se baseia apenas nos testes unitários: mensagem, streaming, término, histórico e decisões
acima foram observados em execução real.

Arquivos desta etapa: `server/codex/managed.ts`, `server/codex/managed.test.ts`,
`server/codex/native-http.ts`, `scripts/validate-bidirectional-real.mjs`, `CHANGELOG.md`,
`docs/native-codex-preview.md` e este relatório.