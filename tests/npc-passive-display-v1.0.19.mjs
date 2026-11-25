import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {npcFixedTestDisplay,sumVisibleFixedTestBonuses} from '../module/npc-test-display.mjs';
import {npcBuild,npcDefaultAttributes} from '../module/npc-rules.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const makeItem=(type,name,values)=>({
  id:name,type,name,system:{props:{
    ['ativacaotempotipo'+type]:'passiva',
    ['efeito'+type+'tipo']:'teste',
    ['efeito'+type+'alvo']:'Tecnologia',
    ['efeito'+type+'operacao']:'somar',
    ['efeito'+type+'valor']:values.value,
    ['efeito'+type+'definicao']:values.definition??'fixo',
    ['efeito'+type+'escala']:'fixo',
  }},getFlag:()=>undefined
});
const build=npcBuild({...npcDefaultAttributes('comum'),npcTraining:{tecnologianumero:true}});
assert.equal(build.skillValues.tecnologianumero,3,'o bônus base de Tecnologia permanece 3');
const effect=makeItem('tecnica','Maos de Sineira',{value:'2'});
const actor={system:{tecnologianumero:3},items:[effect]};
assert.equal(npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero').bonus,2);
assert.equal(build.skillValues.tecnologianumero+npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero').bonus,5);
assert.equal(npcFixedTestDisplay(actor,'Arcana','arcananumero').bonus,0,'passiva especifica nao afeta outras pericias');
actor.items.push(makeItem('skill','Outro treinamento',{value:'3'}));
assert.equal(npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero').bonus,5,'passivas fixas acumulam');
actor.items[0].system.props['efeito'+'tecnica'+'operacao']='subtrair';
assert.equal(npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero').bonus,1,'penalidade fixa subtrai');
actor.items[0].system.props['efeito'+'tecnica'+'definicao']='escolhido';
assert.equal(npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero').bonus,3,'efeito opcional nao entra no total estatico');
actor.items[1].system.props['efeito'+'skill'+'valor']='1d4';
const variable=npcFixedTestDisplay(actor,'Tecnologia','tecnologianumero');
assert.equal(variable.bonus,0);
assert.equal(variable.variable,true,'dados nao entram em total estatico');
assert.equal(sumVisibleFixedTestBonuses([{tipo:'bonus',formula:'2',definicao:'fixo'},{tipo:'penalidade',formula:'1',definicao:'fixo'}]).bonus,1);
const sheet=read('module/npc-sheet.mjs'),tpl=read('templates/npc.hbs');
assert.ok(sheet.includes('npcFixedTestDisplay(actor,s.label,s.key)'));
assert.ok(tpl.includes('<b>{{finalSigned}}</b>'),'a aba Combate usa total com passivo');
assert.ok(tpl.includes('<strong>{{signed}}</strong>'),'o editor mostra o valor-base');
assert.ok(!read('module/npc-rules.mjs').includes('npcFixedTestDisplay'),'a base nao incorpora o passivo');
assert.ok(!read('module/resistance-test.mjs').includes('npcFixedTestDisplay'),'motor de rolagens inalterado');
assert.ok(['1.0.19','1.0.20'].includes(JSON.parse(read('system.json')).version));
console.log('OK: v1.0.19 — +3 base +2 passivo => +5 exibido, sem alterar a rolagem');
