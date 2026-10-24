# Preparação definitiva da integração Antigravity

Data do ensaio: 2026-10-24 UTC. Decisão: **GO condicionado**. Este documento prepara a implantação; não a autoriza.

## Inventário confirmado

| Item | Estado |
|---|---|
| Original | `/home/joo_vitor/habblaud`, `main`, `faa1a012b5fbf632c66dc6801c5383e53a542406`, limpo |
| Integração | `/home/joo_vitor/habblaud-preview`, `fix/native-codex-preview`, base original + sequência registrada pelo HEAD |
| Preview validado | `http://127.0.0.1:4757`, dados em `.preview-data`, Gemini real opt-in |
| Original ativo | Docker `habblaud:local`, porta 4747, volume `habblaud_habblaud-data` |
| QA Agent Hub | porta 4748, somente leitura |
| Ferramentas | Node 24.22.0, npm 11.19.1, Codex CLI 0.163.0, agy 1.4.6, Docker 29.8.1 |

O original é ancestral direto do preview. `package.json` e `package-lock.json` são idênticos entre os dois repositórios; não há submódulos nem dependências novas.

## Pacote de backup

Diretório protegido: `/home/joo_vitor/habblaud-deployment-backups/20261024T004452Z` (modo 700; arquivos modo 600).

- `original-faa1a012.bundle`: histórico Git completo do original.
- `integration-4d0c929.bundle`: branch auditada até o checkpoint anterior.
- `integration-latest.bundle`: pacote final atualizado após o checkpoint documental.
- `host-habblaud-state.tar.gz`: estado de `~/.habblaud`.
- `docker-data.tar.gz`: snapshot de `/data` do container original.
- `docker-inspect.json`: configuração restaurável do container; tratar como sensível.
- `SHA256SUMS`: integridade dos artefatos.
- `docker-data-before.sha256` e `docker-data-after.sha256`: manifestos idênticos antes/depois da cópia.

Verificação segura:

```bash
cd /home/joo_vitor/habblaud-deployment-backups/20261024T004452Z
sha256sum -c SHA256SUMS
cmp docker-data-before.sha256 docker-data-after.sha256
git -C /home/joo_vitor/habblaud bundle verify "$PWD/original-faa1a012.bundle"
git -C /home/joo_vitor/habblaud-preview bundle verify "$PWD/integration-4d0c929.bundle"
```

## Ensaio executado

Ambiente descartável: `/home/joo_vitor/habblaud-deployment-rehearsals/20261024T004515Z`.

1. Clone sem hardlinks criado a partir do original.
2. Branch do preview buscada por transporte Git local.
3. `merge-base --is-ancestor` e `merge --ff-only` confirmaram avanço limpo de `faa1a012` a `4d0c929`.
4. `npm ci --ignore-scripts` instalou o lockfile sem vulnerabilidades.
5. Typecheck, suíte completa, build, i18n e diff check passaram.
6. O build integrado iniciou na porta isolada 4767, com dados descartáveis, Codex nativo desligado e Gemini em modo demo.
7. `/api/native-gemini/mode` confirmou `simulated=true` e `consumesTokens=false`; criar, enviar, persistir e recarregar uma conversa local funcionou. O arquivo ficou modo 600.
8. A rota Codex nativa retornou 404 com o opt-in desligado. A cobertura automatizada validou seus transportes, histórico e decisões de aprovação.
9. Nenhum processo Gemini real foi iniciado e nenhuma sessão nativa real foi reutilizada.

Resultado automatizado integrado: 173 arquivos; 1.957 testes aprovados e dois ignorados por serem exclusivos de Windows. O build alertou sobre chunk cliente maior que 500 KB; é risco de desempenho P2 já existente, sem falha funcional.

## Rollback ensaiado

O processo 4767 foi identificado por porta, PID, cwd e cmdline antes de ser encerrado. Em seguida:

1. Os dois arquivos tar foram extraídos em `restore/`, sem usar o ambiente original.
2. Todos os arquivos restaurados do volume passaram pelos checksums do manifesto anterior à cópia.
3. A permissão 700 de `.habblaud` foi preservada.
4. O clone voltou a `faa1a012` por `git switch --detach`, sem reset destrutivo.
5. Typecheck e build do código original passaram.
6. O original restaurado iniciou na porta 4767 usando os dados restaurados; HTTP e snapshot responderam e a rota Gemini retornou 404.
7. O processo descartável foi encerrado pelo PID validado e a porta ficou livre.

## Segurança e resiliência

| Risco | Gravidade | Mitigação/estado |
|---|---|---|
| Shell injection | P0 se presente | Launcher usa `spawn` sem shell e argumentos fixos; mitigado. |
| Path traversal/symlink | P0 se presente | `realpath` + contenção no workspace e testes; mitigado. |
| API local/CSRF | P1 | Bind loopback, Host/Origin e cabeçalho dos POSTs; mitigado. |
| Segredos em saída/SSE | P1 | Mascaramento, stderr não publicado e teste de regressão; risco residual em padrões ainda desconhecidos. |
| Aprovação automática | P0 | Bloqueada; Antigravity headless não oferece UI de aprovação. |
| Reenvio e gasto duplicado | P0 | Sem retry automático; falha exige recuperação manual. |
| Processo órfão | P1 | Timeout/cancelamento envia TERM e depois KILL somente ao filho criado; testado. |
| Concorrência por sessão | P1 | Um turno por sessão; renomear/excluir bloqueados enquanto trabalha. |
| Reinício durante turno | P1 | Estado `working` volta como erro e exige revisão manual. |
| Histórico confundido com processo | P1 | `working` expira após 60 s; histórico permanece no Hub. |
| Estado persistido corrompido | P1 | Inicialização falha de forma conservadora; restauração manual pelo backup. |
| Exaustão de armazenamento | P2 | Limites de 20 sessões, 200 mensagens, 32 KB de entrada e 64 KB de resposta. |
| Escrita síncrona no streaming | P2 | Limites contêm o custo; medir antes de ampliá-los. |
| Métrica de tokens | P2 | UI identifica o total como valor reportado pelo CLI, sem inferir cota. |
| Traduções incompletas | P2 | `tr()` usado; cobertura atual 2.982/3.079 em en/es/fr. |

## Implantação futura

### Pré-implantação

1. Confirmar 4747, 4748 e o `agy`; registrar PID/cwd/cmdline sem alterar processos.
2. Exigir árvores limpas e os hashes esperados. Se `main` não estiver em `faa1a012`, refazer o ensaio contra o novo HEAD.
3. Criar novo backup datado e repetir SHA-256 e estabilidade antes/depois do volume.
4. Confirmar Node, npm, Codex e agy nas versões homologadas e espaço livre suficiente.
5. GO somente com fast-forward limpo, testes verdes, backup verificável e janela de rollback aprovada.

### Integração Git

Execute apenas após autorização específica para modificar o original:

```bash
cd /home/joo_vitor/habblaud
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = faa1a012b5fbf632c66dc6801c5383e53a542406
git fetch /home/joo_vitor/habblaud-preview fix/native-codex-preview
git merge-base --is-ancestor HEAD FETCH_HEAD
git merge --ff-only FETCH_HEAD
npm ci --ignore-scripts
npm run typecheck
npm test
npm run i18n:check
npm run build
git diff --check
```

Não copiar `.preview-data`. Preservar o volume e `~/.habblaud`. Antes de reiniciar, identificar o processo/container exato da porta 4747 e registrar a forma atual de inicialização. Iniciar primeiro com `HABBLAUD_NATIVE_GEMINI_REAL=0` e `HABBLAUD_NATIVE_GEMINI_DEMO=0`. Manter `HABBLAUD_NATIVE_CODEX` conforme a decisão operacional vigente.

Após o comportamento original estar estável, habilitar Gemini somente com bind local, caminho absoluto do `agy`, arquivo de dados dedicado e autorização específica:

```text
HABBLAUD_NATIVE_GEMINI_REAL=1
HABBLAUD_NATIVE_GEMINI_DEMO=0
HABBLAUD_AGY_BIN=/home/joo_vitor/.local/bin/agy
```

O container atual não recebe essa integração nativa: o gerenciador Gemini é deliberadamente desabilitado em Docker. A implantação definitiva precisa decidir entre manter o Habblaud principal em Docker somente para visualização/Hub, ou executar o servidor nativo no host com bind local. Não habilitar acesso ao `agy` dentro do container por montagem improvisada.

### Verificação pós-implantação

- HTTP 200, logs sem erro e um único processo/listener esperado.
- Marcelo e Henrique preservados, sem duplicação de sessões Codex.
- Histórico e aprovações Codex vinculados à sessão correta.
- Gemini opt-in indica `real`, não `demo`; não enviar mensagem real sem autorização de consumo.
- Hub mostra modelo, workspace e último evento; o escritório mostra somente um ocioso por workspace e atividades recentes.
- SSE conecta, recarrega histórico e não reenvia turnos.
- Conferir permissões 600 dos arquivos de estado, uso de CPU/memória e crescimento do diretório de dados.

## Rollback futuro

1. Bloquear novos envios e registrar o PID/container exato; não usar `killall`, `pkill`, `reset --hard` ou `clean`.
2. Parar somente a instância recém-implantada após validar porta, cwd e cmdline/container.
3. Criar uma cópia de diagnóstico dos dados novos; não sobrescrever o backup aprovado.
4. Recuperar o código a partir de `original-faa1a012.bundle` em checkout/worktree limpo ou fazer `git switch --detach faa1a012...` somente na árvore de implantação validada.
5. Restaurar `docker-data.tar.gz` no volume vazio/preparado e `host-habblaud-state.tar.gz` no destino correto, preservando proprietário e permissões. Validar `SHA256SUMS` antes.
6. Construir, iniciar com Gemini desligado e verificar HTTP/snapshot antes de reabrir envios.
7. Não encerrar o `agy` interativo nem App Servers/sessões Codex externas.

## Critérios finais

GO se os hashes e o fast-forward permanecerem válidos, o backup novo for estável e verificável, os testes passarem e a topologia host/Docker for decidida explicitamente. NO-GO se houver árvore suja, divergência do original, backup inconsistente, conflito, falha de teste/build, rota nativa exposta remotamente ou necessidade de permissão automática.

Estado desta rodada: pacote reproduzível e rollback testado; nenhum P0 conhecido. A ativação no Habblaud original continua pendente de autorização específica e da decisão operacional sobre execução nativa no host.
