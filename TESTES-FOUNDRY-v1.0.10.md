# Testes no Foundry — Multiverso RPG v1.0.10

**Base:** v1.0.9 aprovada por Hope. Antes de instalar, guarde backup da v1.0.9 e do mundo.

## Teste 1 — Botão Afinidades no diário
1. Abra um Journal que foi criado automaticamente ou vinculado pelo Gerenciador de Diários (ex.: Uri).
2. No painel esquerdo, confirme o botão **Afinidades** imediatamente acima de **Add Page**.
3. O botão deve ocupar a largura disponível do painel, sem distorcer os controles de navegação.
4. Confira que Journals sem ficha vinculada NÃO apresentam o botão.

## Teste 2 — Equipe
1. Como Mestre, confira se o personagem pertence à Party em **Gerenciar Equipe**.
2. Abra o Journal vinculado e clique **Afinidades**.
3. Em **Membros da equipe**, todos os outros integrantes devem aparecer; o próprio personagem não.
4. Modifique Afeição e Admiração para um deles, feche e reabra o Journal: os valores devem persistir.
5. Altere a equipe no Gerenciador; confira atualização dos membros da equipe. Uma relação com valores guardados não deve desaparecer ao sair da Party: passa para Outros Relacionamentos.

## Teste 3 — NPCs
1. Clique **Adicionar relacionamento**, cadastre um NPC apenas por nome, mesmo sem ficha.
2. Modifique Afeição e Admiração e feche/reabra: devem persistir.
3. Selecione uma ficha existente no menu opcional, adicione outro relacionamento e confirme a exibição.
4. Remova um relacionamento extra; o diálogo deve pedir confirmação.

## Teste 4 — Permissões
1. Como dono da ficha, edite apenas as afinidades do seu diário.
2. Como outro jogador, o botão não deve estar disponível e não deve ser possível editar relações alheias.
3. Como Mestre, o botão deve estar visível e a edição permitida.
4. As páginas antigas do Journal devem permanecer exatamente como estavam.

## Teste 5 — Interface
1. Reduza a altura da janela de Afinidades e verifique que o conteúdo rola e **Fechar** permanece acessível.
2. Verifique nomes longos de personagens e NPCs; não devem deformar a janela.

**Não faz parte desta versão:** gasto automático de Afeição, bônus em testes, histórico e efeitos sobre Sanidade. Esses elementos serão discutidos em outra etapa.
