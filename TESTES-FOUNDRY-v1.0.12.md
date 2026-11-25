# Testes no Foundry — Multiverso RPG v1.0.12

1. Abra um diário vinculado à ficha de um personagem e clique em **Afinidades**.
2. Confira que cada membro da Party tem **três bolinhas de Afeição (vermelho)** e **três de Admiração (dourado)**.
3. Clique na segunda bolinha de Afeição: as duas primeiras devem brilhar. Clique novamente na segunda: as três devem apagar. Faça o mesmo com Admiração.
4. Feche e reabra as Afinidades: os níveis escolhidos devem persistir no Journal. Confira também a visualização com outro usuário que possua a ficha.
5. Em **Adicionar relacionamento**, deve aparecer **somente o campo de nome**, sem menu de fichas ou lista de NPCs. Digite um nome manualmente e adicione.
6. Confira que o NPC criado aparece em Outros relacionamentos, com três bolinhas de cada cor e persistência após reabrir.
7. Com um jogador comum, confirme que NPCs ocultos/não descobertos **não aparecem como opção**. A lista de NPCs não deve existir na interface.
8. Confirme que textos das páginas do diário, Party e permissões continuam intactos.
9. Se existiam valores antigos inferiores a 0 ou superiores a 3, deve aparecer uma pequena nota pedindo atualização; a versão não deve sobrescrevê-los silenciosamente.

Testar no mundo de Foundry com backup da v1.0.11. O diagnóstico da UI local não substitui o teste prático na aplicação.
