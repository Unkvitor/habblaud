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
