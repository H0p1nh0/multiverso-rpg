# Multiverso RPG v1.0.9 — Testes no Foundry 14

Base: v1.0.8 (aprovada por Hope para criar diários de personagens novos).

## Como abrir

1. Entre no mundo como Mestre e abra a aba Journals.
2. Clique em **Gerenciar Diários**, logo abaixo de **Gerenciar Equipe**.
3. Confira a lista das fichas do tipo Personagem e seus vínculos.

## Teste 1 — Vincular Journal antigo, sem perder texto

- Escolha uma ficha antiga sem diário automático, como Uri.
- Selecione o Journal antigo (Uri) na caixa de escolha e clique **Vincular**.
- Confirme a ação e abra o Journal.
- Esperado: páginas e texto original permanecem intactos, mesmo nome antigo, agora na pasta Diários.
- Na ficha, altere o proprietário ou o nome; confira que as permissões acompanham a ficha e o nome do Journal antigo não é reescrito.

## Teste 2 — Criar diário para personagem antigo

- Para uma ficha sem Journal, clique em **Criar diário**.
- Esperado: um único Journal chamado `Diário — Nome`, com página inicial em branco e dentro da pasta Diários.
- A mesma ficha passa a aparecer como **Vinculado**.

## Teste 3 — Todos os diários pendentes

- Use **Criar os que faltam** somente depois de vincular Journals manuais que já tenham texto.
- O sistema cria diários apenas para fichas ainda sem vínculo.
- Diários vinculados não devem ser alterados ou duplicados.

## Teste 4 — Desvincular sem exclusão

- Clique **Desvincular** numa ficha e confirme.
- Esperado: a ficha fica sem vínculo; o Journal e suas páginas permanecem.
- O conteúdo e nome continuam iguais. As permissões atuais não são revertidas automaticamente após desvincular.

## Teste 5 — Permissões

- Entre com conta de jogador que é dono da ficha: pode editar o Journal correspondente.
- Entre com conta de outro jogador: não deve editar o diário de terceiros.
- Apenas Mestres veem o botão Gerenciar Diários.

## Observações

- Journals existentes sem vínculo não são adotados automaticamente; o Mestre escolhe explicitamente.
- Vincular muda as permissões para refletir as da ficha e move para a pasta Diários, mas não modifica páginas.
- **Ainda NÃO incluído:** botão Afinidades no Journal; será uma etapa separada.
