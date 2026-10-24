# Auditoria de integração nativa Codex e Gemini

Data: 2026-10-23. Branch auditada: `fix/native-codex-preview`. Base do original: `faa1a012b5fbf632c66dc6801c5383e53a542406`.

## Decisão

**GO condicionado** para integrar os 15 commits de `2408e58` a `4b3052d` e o commit corretivo desta auditoria, desde que o repositório original continue no hash-base acima e o procedimento de implantação abaixo seja seguido. Não foram encontrados bloqueadores P0 após a correção da presença histórica. A integração ainda deve permanecer opt-in: Codex por `HABBLAUD_NATIVE_CODEX=1`; Gemini real por `HABBLAUD_NATIVE_GEMINI_REAL=1` e demonstração desligada.

## Evidências e revisão

- O launcher Gemini usa `spawn` sem shell, argumentos fixos, `plan` + `sandbox`, ID nativo explícito, timeout, limite de saída e encerramento somente do processo filho criado para o turno. Não há retry nem aprovação automática.
- Cancelar usa o `AbortController` da sessão gerenciada e não consulta nem encerra processos `agy` externos. Excluir e renomear alteram somente o arquivo local do preview.
- Sessões, histórico, ID nativo, estado e uso reportado pelo CLI são persistidos por substituição atômica em arquivo modo 600. Uma sessão interrompida por reinício volta em erro e exige recuperação manual.
- A API Gemini exige loopback, Host local, mesma origem ou cabeçalho explícito nos POSTs, JSON limitado e rotas sob prefixo próprio. O SSE remove listeners ao fechar, envia heartbeat e o cliente reidrata o histórico sem reenviar mensagens.
- A telemetria do QA Hub é somente leitura. Todas as observações continuam disponíveis no painel, enquanto o escritório exibe uma observação ociosa por workspace e apenas atividade `trabalhando` recente. A auditoria acrescentou cobertura para impedir que atividade histórica seja mostrada como processo vivo.
- A integração Gemini não altera `server/codex/*` depois do checkpoint Codex `e65c85a`. No servidor, o handler Gemini é local, opt-in, fora de Docker e fora do listener remoto. Na interface, Codex apenas ganhou abas e continua com seu EventSource, histórico, envio e aprovações próprios.
- Não houve alteração em `package.json` ou `package-lock.json`; nenhuma dependência nova precisa ser migrada.

## Testes ignorados

Os dois testes ignorados da suíte completa pertencem ao teste existente de statusline, sem relação com Codex ou Gemini:

1. `server/test/statusline.test.ts`: `originalShell no Windows...` usa `it.runIf(process.platform === 'win32')` e é ignorado no WSL/Linux.
2. `server/messages/codex.test.ts`: `findCodexBin no Windows...` também usa `it.runIf(process.platform === 'win32')` e é ignorado no WSL/Linux.

Eles devem continuar condicionais porque exercitam descoberta de executáveis e shell dependente do sistema operacional. Habilitá-los artificialmente no Linux produziria uma validação inválida.

## Migração

O original é ancestral direto do preview no momento da auditoria. Se ainda estiver em `faa1a012`, a integração pode ser feita por avanço rápido da sequência completa. O delta contém 56 arquivos: 15 commits, sem mudanças de dependências. Os pontos com maior chance de conflito se o original avançar são `server/index.ts`, `client/src/ui/native-codex.ts`, `client/src/ui/styles.css`, `shared/types.ts`, `server/model/office.ts`, `shared/world/office-from-world.ts`, `server/accounts/detect.ts`, `CHANGELOG.md` e `.gitignore`. Os módulos novos em `server/antigravity/`, `server/codex/`, os scripts e os documentos tendem a não conflitar.

Procedimento seguro:

1. Registrar os hashes e verificar árvores limpas no original e no preview. Criar tag ou branch local de rollback no hash original.
2. Parar somente o processo cuja porta, PID, cwd e cmdline comprovem ser o Habblaud original. Não tocar na porta 4748, no `agy` interativo nem em processos Codex.
3. Integrar a sequência em uma branch de implantação; revisar o delta contra o hash registrado. Não copiar `.preview-data` nem arquivos sentinela.
4. Rodar `npm test`, `npm run typecheck`, `npm run i18n:check` e `npm run build` antes de iniciar.
5. Iniciar primeiro sem as flags nativas e validar o comportamento original. Depois habilitar Codex e Gemini de forma explícita, com diretório de dados próprio e bind local.
6. Verificar saúde HTTP, snapshot do escritório, sessões Codex existentes, histórico, aprovações e telemetria Gemini. Uma mensagem real de fumaça só deve ser enviada com autorização de consumo.
7. Em falha, parar somente o novo PID validado, retornar ao hash/tag de rollback, restaurar o diretório de dados do backup e iniciar a versão anterior. Não encerrar `agy`, App Server compartilhado ou sessões externas.

## Riscos e limitações remanescentes

- O protocolo headless do Antigravity não oferece decisões interativas de permissão; a interface informa essa limitação e não concede permissões automaticamente.
- `total_tokens` é o valor cumulativo reportado pelo CLI e não mede diretamente cota diária.
- Estado persistido inválido interrompe a inicialização do modo Gemini em vez de ser reparado automaticamente. É comportamento conservador, mas requer restauração manual do backup em caso de corrupção.
- A persistência é síncrona a cada atualização de streaming. Os limites atuais (64 KB por resposta, 200 mensagens e 20 sessões) contêm o custo, mas vale medir antes de ampliar esses limites.
- O atalho visual do personagem localiza o perfil pelo texto do DOM; mudanças futuras na estrutura ou tradução podem exigir ajuste, sem afetar a API nem as sessões.
