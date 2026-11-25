# Testes no Foundry VTT 14 — Multiverso RPG v1.0.16

## Pré-requisitos
- Faça backup do sistema instalado e substitua a pasta `multiverso-rpg` pelo conteúdo deste ZIP.
- Reinicie o Foundry e recarregue a página (Ctrl+F5).
- Entre com usuário GM.

## 1. Ações de Apoio — interface
1. Abra a ficha de um NPC existente e clique em **Ações de Apoio**.
2. Use **Adicionar Ação de Apoio**.
3. A janela deve mostrar uma faixa de título, Nome da ação e Ativação, seguidos por **quatro cartões (Admiração 0, 1, 2 e 3)**.
4. Informe nome, gatilho e quatro descrições; clique em Salvar.
5. Reabra a ação; os dados devem persistir. Teste também **Motor de Efeitos** em um dos níveis já existentes.

## 2. Aba Relacionamentos
1. Em Diários > **Gerenciar Equipe**, confirme que há personagens na Party.
2. Abra a ficha do NPC e clique na nova aba **Relacionamentos**, ao lado de **Combate**.
3. Os personagens cadastrados em equipes devem aparecer automaticamente, sem exibir a lista de NPCs do mundo.
4. Clique na segunda bolinha dourada de Admiração de um integrante. As duas primeiras devem acender.
5. Clique novamente na segunda bolinha; elas devem apagar.
6. Repita com as bolinhas vermelhas de Afeição; feche/reabra a ficha para conferir persistência.
7. Adicione relacionamento extra usando apenas um nome; altere valores e depois remova.
8. Confira que o **Diário do jogador não sofreu alteração**: esses valores são do NPC em direção ao jogador.
9. Se possível, abra a ficha sem privilégios de mestre: a aba Relacionamentos não deve ser renderizada.

## Observações
- A maior Admiração exibida na ficha inclui os integrantes cadastrados nas equipes; na mesa, o mestre considera apenas os presentes no combate.
- O limite coletivo de Ações de Apoio **não** é automatizado nesta versão.
- A interface de Vida, STA, Mana, SAN, os cálculos e a Criação em janela própria não foram modificados.
