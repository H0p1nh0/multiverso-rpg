// Executar: node tests/ability-routes-v1.0.3.mjs
// Testes sem Foundry: não carregam mundos, não rolam dados e não editam fichas.
import assert from 'node:assert/strict';
globalThis.game={combat:null,user:{targets:new Set()}};
const {chooseExternalExecutionRoute}=await import('../module/ability-execution-route.mjs');
const {buildAbilityReport}=await import('../module/ability-diagnostics.mjs');
const own={index:1,type:'recurso',affected:'pv',receiver:'proprio',cadence:'once',duration:{kind:'instant'},op:'subtrair'};
const target={index:1,type:'dano',affected:'pv',receiver:'alvo',cadence:'once',duration:{kind:'instant'},op:'somar'};
const next={...target,index:2};
const route=(effects,opts={})=>chooseExternalExecutionRoute(effects,{selectedCount:1,...opts});
assert.equal(route([own]),'native');
assert.equal(route([target]),'external-target');
assert.equal(route([target,next]),'multi-target');
assert.equal(route([target,{...own,index:2}]),'external-advanced');
assert.equal(route([{...target,receiver:'area'}]),'external-advanced');
assert.equal(route([{...target,cadence:'periodic',duration:{kind:'turns'}}]),'external-advanced');
assert.equal(route([{...target,type:'condicao',cadence:'maintained',duration:{kind:'turns'}}]),'external-maintained');
assert.equal(route([target],{cardEligible:true}),'external-card');
assert.equal(route([target],{selectedCount:0}),'open-effect');
assert.equal(route([{...target,receiver:'area'}],{selectedCount:0}),'external-advanced');
assert.equal(route([target,{...own,index:2}],{selectedCount:0}),'external-advanced');
assert.equal(route([target],{hasVariants:true}),'external-advanced');
assert.equal(route([{...target,op:'limitar_minimo'}],{specialOperation:op=>op==='limitar_minimo'}),'external-advanced');
const actor={id:'a',uuid:'Actor.a',name:'Personagem',documentName:'Actor',items:[],isOwner:true,
 system:{pv_atual:20,pv_max:20,pm_atual:10,pm_max:10,sta_atual:20,sta_max:20,san_atual:10,san_max:10}};
function makeItem({mixed=true,invalid=false,otherAction=false}={}){
 const props={mvEffectCount:mixed?2:1,['ativacaotempotipo'+'tecnica']:''};
 const put=(n,field,value)=>{props[`efeitotecnica${field}${n===1?'':n}`]=value;};
 put(1,'tipo',invalid?'condicao':'dano');put(1,'receptor','alvo');put(1,'afetado','pv');
 put(1,'escala','dado');put(1,'valor','1d6');put(1,'duracao','Instantânea');put(1,'custo','8 STA');
 props['ativacaotempotipo'+'tecnica']='completa';
 if(mixed){put(2,'tipo','recurso');put(2,'receptor','proprio');put(2,'afetado','pv');put(2,'operacao','subtrair');put(2,'escala','dado');put(2,'valor','1d3');put(2,'duracao','Instantânea');
  props['ativacaotempotipo'+'tecnica'+'2']=otherAction?'reacao':'completa';}
 return {type:'tecnica',id:'t',name:'Técnica de teste',system:{props},parent:actor};
}
const mixed=buildAbilityReport(makeItem());
assert(mixed.checks.some(s=>s.includes('Execução composta')));
assert(!mixed.issues.some(s=>s.includes('O receptor selecionado não é compatível')));
assert.equal(mixed.rolls.length,2);
const invalid=buildAbilityReport(makeItem({invalid:true}));
assert(invalid.issues.some(s=>s.includes('só aceita Dano, Cura ou Alteração de fluxo')));
const actionMix=buildAbilityReport(makeItem({otherAction:true}));
assert(actionMix.issues.some(s=>s.includes('tipos de ação diferentes')));
const noTarget=buildAbilityReport(makeItem({mixed:false}));
assert(noTarget.checks.some(s=>s.includes('aplicação posterior')));
assert(!noTarget.issues.some(s=>s.includes('O receptor selecionado não é compatível')));
console.log('OK: 17 testes de rotas/diagnósticos, sem efeitos em fichas.');
