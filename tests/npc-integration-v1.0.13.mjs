import assert from 'node:assert/strict';
import {npcDefaultAttributes} from '../module/npc-rules.mjs';
class Field{constructor(config){this.config=config;}}
class TypeDataModel{prepareDerivedData(){}}
class Sheet{static DEFAULT_OPTIONS={};_onRender(){} async _prepareContext(){return {}}}
const DataFields=Object.fromEntries(['NumberField','BooleanField','StringField','ObjectField'].map(key=>[key,Field]));
globalThis.foundry={
  data:{fields:DataFields},abstract:{TypeDataModel},
  applications:{api:{HandlebarsApplicationMixin:klass=>klass},sheets:{ActorSheetV2:Sheet}}
};
const {NPCData}=await import('../module/npc-data.mjs');
const {MultiversoNPCSheet,registerNPCInitialization,initializeNPC}=await import('../module/npc-sheet.mjs');
const schema=NPCData.defineSchema();
assert.ok(schema.npcCategoria&&schema.npcFluxOverrides&&schema.npcTraining);
assert.ok(schema.forcanumero&&schema.pv_atual&&schema.atletismonumero,'compatibilidade com motor legado');
const model=Object.assign(Object.create(NPCData.prototype),{...npcDefaultAttributes('comum'),npcCategoria:'comum',npcTraining:{atletismonumero:true},npcSpecialization:{atletismonumero:1},npcFluxOverrides:{},parent:{items:[]},_source:{}});
model.prepareDerivedData();
assert.equal(model.atletismonumero,5);
assert.equal(model.pv_max,14);
assert.equal(model.sta_max,18);
assert.equal(model.pm_max,10);
assert.equal(model.san_max,12);
assert.equal(MultiversoNPCSheet.PARTS.form.template,'systems/multiverso-rpg/templates/npc.hbs');
let createHandler;
globalThis.Hooks={on(name,fn){if(name==='createActor')createHandler=fn;}};
registerNPCInitialization();
assert.equal(typeof createHandler,'function');
globalThis.game={user:{isGM:true}};
let changed;
const actor={type:'npc',pack:null,system:{npcCategoria:'comum',forcanumero:4,agilidadenumero:3,inteligencianumero:2,carismanumero:1,percepcaonumero:3,resistencianumero:2,npcInitResources:false},async update(data){changed=data;}};
assert.equal(await initializeNPC(actor),true);
assert.deepEqual(changed,{'system.npcInitResources':true,'system.pv_atual':14,'system.sta_atual':12,'system.pm_atual':10,'system.san_atual':12});
actor.system.npcInitResources=true;
assert.equal(await initializeNPC(actor),false);
assert.equal(await initializeNPC({...actor,type:'personagem'}),false);
console.log('OK: schema NPC isolado, ficha V2, hook de criação e inicialização de Fluxos.');
