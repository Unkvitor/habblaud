# Funções de QA no Habblaud

As funções da equipe QA são **informativas e persistidas por ID do agente**, não por nome exibido.
Elas não alteram `AgentInfo.role`, não recriam personagens, não retomam threads e não autorizam
nenhuma execução real ou simulada.

## Configuração pela interface

1. Acesse o Habblaud local e abra **Tarefas QA**.
2. Na seção **Funções da equipe QA**, selecione um agente presente e uma função.
3. Confirme **Salvar função**. Escolha **Sem função definida** para retirar um vínculo.
4. Para a organização combinada: Marcelo → Coordenador de QA; Henrique → Engenheiro de automação;
   Gemini → Investigador e revisor. Essas atribuições são manuais, nunca inferidas pelo nome.

## API local

- `GET /api/qa-roles` → `{ "roles": [{ "agentId": "...", "role": "coordinator", "updatedAt": 123 }] }`.
- `PUT /api/qa-roles/<agentId-url-encoded>` com JSON `{ "role": "coordinator" }`.
- `DELETE /api/qa-roles/<agentId-url-encoded>` (enviar `Content-Type: application/json`).

Identificadores aceitos: `coordinator`, `automation_engineer`, `investigator_reviewer`.
O backend exige que o ID corresponda a um agente principal Codex ou Antigravity presente no Office.
A rota usa o controle local de Host/Origin existente. **Localhost não autentica uma pessoa.**

O armazenamento separado fica em `~/.local/share/habblaud-native/qa-agent-roles.json`
(com o diretório real definido por `config.dataDir`). Inclua-o nos backups com as tarefas.
Gravações substituem o arquivo por `rename` atômico. Se o arquivo estiver malformado ou
em versão desconhecida, o sistema **bloqueia novas gravações**, preservando os bytes originais.

## Restrições deliberadas

- Não há autopreenchimento de Marcelo, Henrique ou Gemini por nome.
- O perfil ainda não é adicionado automaticamente ao prompt de um agente.
- Uma função não é uma permissão de sistema nem uma autorização de execução.
- Alterações em perfis não modificam o histórico existente ou o QA Agent Hub.

## Entregas e revisão (P2.6)

Subtarefas de QA aceitam **entregas**: resumo (até 2.000 caracteres) e até 20 referências de evidência
(caminhos, URLs, IDs; até 500 caracteres cada). O autor é sempre o responsável da subtarefa; o corpo da
requisição não o define. A fila de tarefas é a mesma de sempre: as entregas ficam dentro de cada tarefa em
`qa-tasks.json` (campo opcional `deliveries`, formato ainda na versão 1; arquivos sem entregas não mudam).

Fluxo: `draft` → `in_review` → `approved` | `returned`. Uma entrega devolvida é definitiva no histórico;
os ajustes entram em uma nova entrega. Só pode haver uma entrega em andamento por subtarefa.

- `POST /api/qa-tasks/<id>/deliveries` `{ summary, evidence? }` → 201.
- `POST /api/qa-tasks/<id>/deliveries/<deliveryId>/review-request` `{ reviewerId }` — o revisor precisa ser
  um agente Codex/Antigravity presente com o papel `investigator_reviewer` e diferente do responsável
  (403 caso contrário). A tarefa passa a `awaiting_approval`. Nenhuma mensagem é enviada ao revisor.
- `POST /api/qa-tasks/<id>/deliveries/<deliveryId>/decision` `{ action: "approve"|"return", justification }` —
  a justificativa é obrigatória; devolver reabre a tarefa (`assigned`). A decisão é registrada como
  `human:local-ui`, definido pelo servidor, e exige que o revisor ainda tenha o papel.

Regras de conclusão (`PATCH` para `completed`): dependências concluídas; nenhuma subtarefa aberta; e, para
subtarefas, a **última** entrega aprovada. Subtarefas abertas criadas antes do P2.6 precisam de uma entrega
aprovada para concluir; as já concluídas não mudam.

Limitações: todas as rotas usam o controle local de Host/Origin e exigem `Content-Type: application/json`,
mas **localhost não autentica uma pessoa**. O revisor é um vínculo informativo: ele não é acionado pelo
Habblaud, e a decisão é registrada pela interface local em nome dele. Voltar a uma versão anterior do
Habblaud com um arquivo que já tem entregas faz o arquivo ser tratado como inválido (gravações bloqueadas,
bytes preservados).
