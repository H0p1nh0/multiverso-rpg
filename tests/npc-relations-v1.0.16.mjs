import assert from 'node:assert/strict';
import {normalizeNPCRelations,npcPartyRelationships,npcRelationGroups,setNPCRelationLevel,addNPCNamedRelation,removeNPCNamedRelation,npcMaxAdmirationForPresent} from '../module/npc-relations.mjs';
const actors=new Map([
  ['uri',{id:'uri',name:'Uri',type:'personagem',img:'/uri.png'}],
  ['mason',{id:'mason',name:'Mason',type:'personagem',img:'/mason.png'}],
  ['npc1',{id:'npc1',name:'Boss secreto',type:'npc',img:'/secret.png'}],
  ['marie',{id:'marie',name:'Marie',type:'personagem',img:'/marie.png'}]
]);
const registry={parties:[{id:'a',name:'Escolhidos',memberIds:['uri','mason','npc1']},{id:'b',name:'Outros',memberIds:['marie','uri']}]};
assert.deepEqual(npcPartyRelationships(registry,actors).map(x=>x.key),['actor:uri','actor:mason','actor:marie']);
let saved=normalizeNPCRelations(null);
let groups=npcRelationGroups(saved,registry,actors);
assert.equal(groups.party.length,3);assert.equal(groups.party[0].admiracao,0);
saved=setNPCRelationLevel(saved,'actor:uri','admiracao',3,registry,actors);
saved=setNPCRelationLevel(saved,'actor:mason','admiracao',1,registry,actors);
saved=setNPCRelationLevel(saved,'actor:uri','afeicao',2,registry,actors);
groups=npcRelationGroups(saved,registry,actors);
assert.equal(groups.party.find(x=>x.name==='Uri').admiracao,3);
assert.equal(groups.party.find(x=>x.name==='Mason').admiracao,1);
assert.equal(groups.party.find(x=>x.name==='Uri').afeicao,2);
assert.equal(npcMaxAdmirationForPresent(saved,registry,actors,['uri','mason']),3);
assert.equal(npcMaxAdmirationForPresent(saved,registry,actors,['mason']),1);
assert.equal(npcMaxAdmirationForPresent(saved,registry,actors,[]),0);
saved=addNPCNamedRelation(saved,'Ferreiro da Vila','jkl987',registry,actors);
assert.equal(npcRelationGroups(saved,registry,actors).others[0].name,'Ferreiro da Vila');
assert.throws(()=>addNPCNamedRelation(saved,'uri','XX222',registry,actors),/já está cadastrado/);
assert.throws(()=>setNPCRelationLevel(saved,'actor:npc1','admiracao',3,registry,actors),/não encontrado/);
assert.throws(()=>setNPCRelationLevel(saved,'actor:uri','admiracao',4,registry,actors),/entre 0 e 3/);
assert.throws(()=>removeNPCNamedRelation(saved,'actor:uri'),/Gerenciador/);
saved=removeNPCNamedRelation(saved,'extra:jkl987');
assert.equal(npcRelationGroups(saved,registry,actors).others.length,0);
// Alterações em relações não dependem nem alteram os Journals dos jogadores.
assert.deepEqual(Object.keys(saved),['schema','entries']);
// Desfazer o vínculo não apaga sua outra estatística.
saved=setNPCRelationLevel(saved,'actor:uri','admiracao',0,registry,actors);
assert.equal(npcRelationGroups(saved,registry,actors).party[0].afeicao,2);
console.log('OK: v1.0.16 — direção NPC→Party, GM/flag, 3 bolinhas, maior ADM entre presentes, sem spoilers.');
