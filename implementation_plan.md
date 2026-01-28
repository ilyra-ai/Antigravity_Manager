# Plano de Implementação - Finalização do Antigravity Manager

Este plano visa concluir as pendências identificadas no projeto, focando no suporte ao ambiente WSL (Windows Subsystem for Linux) e na garantia de que o aplicativo utilize o idioma Português do Brasil (PT-BR) conforme exigido.

## Mudanças Propostas

### Backend (Electron / IPC)

#### [MODIFY] [handler.ts](file:///d:/01-PROJETOS/05-AntigravityManager/src/ipc/process/handler.ts)
*   Atualizar a função interna `getProcesses` para detectar se o ambiente é WSL.
*   Em ambiente WSL, utilizar o comando `/mnt/c/Windows/System32/tasklist.exe /FO CSV /NH /FI "IMAGENAME eq Antigravity.exe"` para listar processos do Windows.
*   Atualizar a lógica de `closeAntigravity` para usar `/mnt/c/Windows/System32/taskkill.exe /F /IM "Antigravity.exe" /T` quando rodando em WSL.
*   Garantir que `isProcessRunning` identifique corretamente o executável Windows a partir do WSL.

#### [MODIFY] [paths.ts](file:///d:/01-PROJETOS/05-AntigravityManager/src/utils/paths.ts)
*   Validar se as funções de resolução de caminhos estão tratando corretamente a conversão de `/mnt/c/` para caminhos Windows quando necessário para comandos externos.

### Internacionalização (i18n)

#### [VERIFY] [i18n.ts](file:///d:/01-PROJETOS/05-AntigravityManager/src/localization/i18n.ts)
*   Confirmar que `pt-BR` é o idioma padrão (já verificado, mas manteremos a vigilância).
*   Verificar se existem componentes com textos em Chinês ou Inglês "hardcoded" que não estão usando o sistema de tradução.

---

## Plano de Verificação

### Testes Automatizados
*   **Testes Unitários:**
    *   Atualizar `src/tests/unit/process.test.ts` para incluir cenários de WSL (mockando `isWsl` como `true`).
    *   Executar: `npm run test:unit src/tests/unit/process.test.ts`
    *   Executar: `npm run test:unit src/tests/unit/paths.test.ts`

### Verificação Manual
*   Pedir ao usuário para validar a execução do app em ambiente WSL (se disponível) para confirmar se o processo do Antigravity é detectado e encerrado corretamente.
*   Verificar visualmente se todas as telas estão em PT-BR.
