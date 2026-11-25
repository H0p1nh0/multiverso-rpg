import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {reactionStatus,spendReaction,refundReaction,manuallyRefundReaction} from '../module/reaction-combat.mjs';

const d=path.resolve(import.meta.dirname,'..'),read=p=>fs.readFileSync(path.join(d,p),'utf8');
const combat={id:'cmb-test',started:true,round:1,turn:0,combatants:[],combatant:null};
globalThis.game={combat,user:{isGM:true}};
globalThis.Hooks={callAll(){}};
const flags={};
const actor={id:'npc1',uuid:'Actor.npc1',type:'npc',isOwner:true,name:'NPC sem iniciativa',flags:{'multiverso-rpg':flags},
 getFlag(ns,key){return flags[key];},async setFlag(ns,key,value){flags[key]=structuredClone(value);},sheet:{render(){}}};
assert.deepEqual([reactionStatus(actor).current,reactionStatus(actor).max],[2,2],'sem iniciativa começa com 2 reações');
assert.equal(reactionStatus(actor).indirectNPC,true);
const r1=await spendReaction(actor);
assert.equal(r1.consumed,true);
assert.equal(reactionStatus(actor).current,1);
const r2=await spendReaction(actor);
assert.equal(r2.consumed,true);
assert.equal(reactionStatus(actor).current,0);
assert.equal(reactionStatus(actor).ok,false,'não é possível defender 3 vezes na mesma rodada');
assert.equal((await spendReaction(actor)).consumed,false);
assert.equal(await manuallyRefundReaction(actor),true,'botão direito devolve uma reação');
assert.equal(reactionStatus(actor).current,1);
assert.equal(await refundReaction(actor,r2),true,'reembolso com recibo válido');
assert.equal(reactionStatus(actor).current,2);
await spendReaction(actor);await spendReaction(actor);
combat.round=2;
assert.equal(reactionStatus(actor).current,2,'NPC sem iniciativa recupera no começo da nova rodada');
assert.equal(await refundReaction(actor,r1),false,'não devolve reação de rodada antiga');
assert.equal((await spendReaction(actor)).current,1,'primeiro gasto da nova rodada funciona');
const player={...actor,type:'personagem',uuid:'Actor.player',id:'player'};
assert.equal(reactionStatus(player).reason,'not-combatant','regra antiga dos jogadores preservada');
const enrolled={...actor,id:'npc2',uuid:'Actor.npc2',getFlag:()=>undefined};
combat.combatants=[{actorId:'npc2',id:'combatant-npc2',actor:enrolled}];
combat.combatant=combat.combatants[0];
assert.equal(reactionStatus(enrolled).indirectNPC,undefined,'NPC com iniciativa usa regra antiga');
assert.equal(reactionStatus(enrolled).current,2);

// Rodar o cálculo de defesa isoladamente com dependências simuladas, para testar
// armadura e habilidade passiva sem precisar inicializar o cliente do Foundry.
const combatUi=read('module/combat-native-ui.mjs');
const start=combatUi.indexOf('export function npcDefenseSummary(actor)');
const end=combatUi.indexOf('export async function rollDefense(',start);
assert.ok(start>=0&&end>start,'helper de defesa exportado');
const fragment=combatUi.slice(start,end).replace('export function npcDefenseSummary','function npcDefenseSummary');
const sandbox={passiveAttributeBonuses:()=>({resistencianumero:1,bloqueiobonus:2,agilidadenumero:0,esquivabonus:3}),
 itemDefenseBonus:(_actor,type)=>type==='bloqueio'?4:1};
vm.runInNewContext(fragment+'\nthis.calculate=npcDefenseSummary;',sandbox);
const values=sandbox.calculate({system:{resistencianumero:5,bloqueiobonus:1,agilidadenumero:4,esquivabonus:0}});
assert.equal(values.bloqueio.total,13,'5 resistência +1 passivo RES +1 campo +2 passivo defesa +4 armadura');
assert.equal(values.esquiva.total,8,'4 agilidade +3 passivo +1 equipamento');
assert.ok(combatUi.includes("actor.type==='npc'?npcDefenseSummary(actor)[type]:null"),'rolagem usa o mesmo cálculo que a ficha');
assert.ok(combatUi.includes("actor?.type!=='npc'"),'defesa permitida para NPC sem iniciativa');
const npc=read('module/npc-sheet.mjs'),tpl=read('templates/npc.hbs'),styles=read('styles/npc-defenses-v1.0.20.css');
assert.ok(npc.includes('bindCombatUi(this,root)'), 'controles vinculados ao motor original');
assert.ok(npc.includes('context.npcDefenses=npcDefenseSummary(actor)'));
assert.ok(npc.includes('context.npcReactions=reactionStatus(actor)'));
for(const type of ['bloqueio','esquiva','reacao'])assert.ok(tpl.includes(`data-mv-combate-acao="${type}"`),`controle ${type}`);
assert.ok(styles.includes('.mv-npc-defenses-grid'));
assert.ok(JSON.parse(read('system.json')).styles.includes('styles/npc-defenses-v1.0.20.css'));
assert.equal(JSON.parse(read('system.json')).version,'1.0.20');
console.log('OK: v1.0.20 — reações sem iniciativa, reset por rodada, armaduras, passivas e rolagem nativa');
