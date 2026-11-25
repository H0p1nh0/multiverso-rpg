import assert from 'node:assert/strict';
import {NPC_CATEGORIES,NPC_ATTRIBUTES,NPC_SKILLS,npcBuild,npcDefaultAttributes} from '../module/npc-rules.mjs';
assert.equal(NPC_SKILLS.length,22);
assert.equal(Object.keys(NPC_CATEGORIES).length,5);
assert.equal(NPC_ATTRIBUTES.length,6);
for(const [id,cat] of Object.entries(NPC_CATEGORIES)){
  const build=npcBuild({...npcDefaultAttributes(id),npcCategoria:id});
  assert.equal(build.attributeTotal,cat.attributes,`${id}: distribuição sugerida completa`);
  assert.ok(build.valid,`${id}: atributos sugeridos dentro dos limites`);
  assert.equal(build.skills.length,22);
  for(const k of ['pv','sta','pm','san']) assert.ok(build.max[k]>0,`${id}: ${k} >0`);
}
const skills=Object.fromEntries(NPC_SKILLS.map(x=>[x.label,x]));
assert.equal(skills.Arcana.attribute,'inteligencianumero');
assert.equal(skills.Encantamento.attribute,'inteligencianumero');
assert.equal(skills.Intuição.attribute,'percepcaonumero');
const common={...npcDefaultAttributes('comum'),npcCategoria:'comum',npcTraining:{atletismonumero:true,pontarianumero:true},npcSpecialization:{atletismonumero:1}};
assert.deepEqual(npcBuild(common).max,{pv:14,sta:18,pm:10,san:12});
const specialist={...npcDefaultAttributes('especialista'),npcCategoria:'especialista',npcTraining:{arcananumero:true,medicinanumero:true,vontadenumero:true,atletismonumero:true},npcSpecialization:{arcananumero:3,medicinanumero:1,vontadenumero:1}};
assert.deepEqual(npcBuild(specialist).max,{pv:58,sta:38,pm:62,san:44});
const legendary={...npcDefaultAttributes('lendario'),npcCategoria:'lendario',npcTraining:Object.fromEntries(['arcananumero','atletismonumero','vontadenumero','cutnumero','pontarianumero','investigacaonumero','podernumero'].map(x=>[x,true])),npcSpecialization:{arcananumero:5,atletismonumero:3,vontadenumero:2,cutnumero:2}};
assert.deepEqual(npcBuild(legendary).max,{pv:178,sta:132,pm:167,san:122});
assert.equal(npcBuild(legendary).valid,true);
const alternative=npcBuild({...legendary,npcCortantesAttr:'agilidadenumero'});
assert.equal(alternative.skillValues.cutnumero,9); // piso(AGI 10/2)+2 treino+2 esp=9.
assert.equal(npcBuild(legendary).skillValues.cutnumero,10); // piso(FOR 13/2)+2+2.
const customized=npcBuild({...common,npcFluxOverrides:{pv:200,sta:0,pm:null,san:''}});
assert.equal(customized.max.pv,200);assert.equal(customized.max.sta,0);
assert.equal(customized.max.pm,10);assert.equal(customized.max.san,12);
assert.equal(npcBuild({...common,forcanumero:100}).valid,false);
assert.equal(npcBuild({...common,npcTraining:{...common.npcTraining,medicinanumero:true}}).valid,false);
assert.equal(npcBuild({...common,npcSpecialization:{atletismonumero:2}}).valid,false);
assert.equal(npcBuild({...common,npcSpecialization:{atletismonumero:1,arcananumero:100}}).specializationUsed,1,'não treinadas não contam');
console.log('OK: NPC v1.0.13, 5 categorias, 22 perícias, fórmula, exemplos, limites e sobrescritas.');
