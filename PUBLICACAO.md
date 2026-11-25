# Publicação para Foundry VTT

O endereço para instalar o sistema e consultar atualizações é
[system.json da última Release](https://github.com/H0p1nh0/multiverso-rpg/releases/latest/download/system.json).
Ele passa a funcionar após a publicação da primeira Release com esse arquivo.

## Montar localmente

Na raiz do repositório, com Node.js 24, Git e PowerShell 7:

```powershell
node --test --test-concurrency=1 tests/*.mjs
pwsh -NoProfile -File scripts/package.ps1
```

O script gera `dist/system.json` e `dist/multiverso-rpg.zip`. O ZIP contém
`system.json` na raiz e inclui os arquivos rastreados de `main.mjs`, `lang/`,
`module/`, `styles/` e `templates/`. Adicione ao Git novos arquivos necessários
ao sistema. Se acrescentar outra pasta usada pelo Foundry, inclua-a na lista
do script de empacotamento.

## Publicar uma atualização

1. Aumente `version` no `system.json` e ajuste a tag no campo `download` para
   `v<version>`. Mantenha o URL estável em `manifest`.
2. Após aprovação, publique as alterações na `main`.
3. Após aprovação para publicar a Release, vá a **Actions → Publicar sistema
   Foundry → Run workflow**, selecionando `main`. O fluxo roda os testes, gera
   os dois arquivos e publica a Release `v<version>` com os dois anexos.
4. No Setup do Foundry, abra **Game Systems → Install System** e cole o endereço
   do manifesto em **Manifest URL**.
