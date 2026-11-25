// node tests/affinity-journals-v1.0.10.mjs
import assert from 'node:assert/strict';
import { normalizeAffinityData, updateAffinityValue, addNamedRelationship, addActorRelationship, removeAffinityRelationship,
  describeAffinityGroups, affinityJournalActor, canEditJournalAffinity, setJournalAffinity, createJournalAffinity,
  deleteJournalAffinity, registerAffinityJournals } from '../module/affinity-journals.mjs';
import { registerPartyManager } from '../module/party-manager.mjs';

const gm={id:'gm',isGM:true,active:true};
const owner={id:'owner',isGM:false,active:true};
const other={id:'other',isGM:false,active:true};
const actors=[]; const journals=[];
const flagScope='multiverso-rpg';
function actor(id,name,owners=['owner']) {
  const a={id,name,type:'personagem',img:'',pack:null,flags:{},
    testUserPermission(u,level){return Boolean(owners.includes(u.id) && (level==='LIMITED'||level==='OWNER'));},
    getFlag(scope,key){return this.flags[scope]?.[key];}
  }; actors.push(a); return a;
}
const takeshi=actor('a1','Takeshi'); const akira=actor('a2','Akira'); const uri=actor('a3','Uri'); const npc=actor('npc1','Ferreiro', ['owner']); const secret=actor('secret','NPC secreto', []);
const j={id:'journal1',name:'Diário — Takeshi',pack:null,flags:{ [flagScope]:{autoDiaryActorId:takeshi.id}}, ownership:{default:0,owner:3},
  pages:[{id:'p1',name:'Dia 01',text:{content:'Texto que não pode mudar'}}],
  testUserPermission(u,level){return level==='OWNER' && u.id==='owner';},
  getFlag(scope,key){return this.flags[scope]?.[key];},
  async setFlag(scope,key,value){this.flags[scope]??={};this.flags[scope][key]=structuredClone(value);}
}; journals.push(j); takeshi.flags[flagScope]={autoDiaryJournalId:j.id};
const setting={schema:1, parties:[{id:'party1',name:'Escolhidos',memberIds:[takeshi.id,akira.id,uri.id]}]};
globalThis.game={user:owner,actors:{get:id=>actors.find(a=>a.id===id),contents:actors},
 journal:{get:id=>journals.find(j=>j.id===id),contents:journals},
 settings:{get:()=>setting,register(){}},users:{contents:[gm,owner,other]}};
globalThis.document=undefined;
const hooks={};
globalThis.Hooks={on(k,fn){(hooks[k]??=[]).push(fn);},once(k,fn){(hooks[k]??=[]).push(fn);}};

assert.deepEqual(normalizeAffinityData(null),{schema:1,entries:[]});
assert.deepEqual(normalizeAffinityData({entries:[{key:'actor:a2',afeicao:-3,admiracao:4},{key:'actor:a2',afeicao:999},{key:'nonsense'}]}).entries,
 [{key:'actor:a2',name:'',afeicao:-3,admiracao:4}]);
assert.equal(updateAffinityValue(null,'actor:a2','afeicao','2').entries[0].afeicao,2);
assert.throws(()=>updateAffinityValue(null,'actor:a2','afeicao','-2'),/0 a 3/);
assert.throws(()=>updateAffinityValue(null,'actor:a2','afeicao','4'),/0 a 3/);
assert.throws(()=>updateAffinityValue(null,'actor:a2','afeicao','2.2'),/0 a 3/);
assert.throws(()=>updateAffinityValue(null,'actor:a2','poder',5),/inválido/);
let data=addNamedRelationship(null,'Ferreiro da Vila','id1');
assert.equal(data.entries[0].name,'Ferreiro da Vila');
assert.throws(()=>addNamedRelationship(data,'ferreiro da vila','id2'),/existe/);
data=addActorRelationship(data, 'npc1');
assert.throws(()=>addActorRelationship(data, 'npc1'),/já está/);
assert.equal(removeAffinityRelationship(data,'npc:id1').entries.length,1);
assert.equal(affinityJournalActor(j),takeshi);
assert.equal(canEditJournalAffinity(j,takeshi,owner),true);
assert.equal(canEditJournalAffinity(j,takeshi,other),false);
assert.equal(canEditJournalAffinity(j,takeshi,gm),true);
registerPartyManager(); registerAffinityJournals();
assert.equal(hooks.renderApplicationV2.length,2);
assert.equal(hooks.renderJournalEntrySheet.length,1);
await setJournalAffinity(j,'actor:a2','afeicao',3);
await setJournalAffinity(j,'actor:a2','admiracao',2);
assert.equal(j.getFlag(flagScope,'affinitiesV1').entries[0].admiracao,2);
let groups=describeAffinityGroups(takeshi,j.getFlag(flagScope,'affinitiesV1'),['a2','a3']);
assert.equal(groups.party[0].name,'Akira','deve preservar nome do ator após salvar os valores');
assert.equal(groups.party[0].afeicao,3);
assert.equal(groups.party[1].name,'Uri');
assert.equal(groups.party[1].afeicao,undefined);
await createJournalAffinity(j,{name:'Comerciante',makeId:()=>'uid100'});
await createJournalAffinity(j,{name:'Outro contato',makeId:()=>'uid101'});
assert.equal(j.getFlag(flagScope,'affinitiesV1').entries.length,3);
assert.equal(j.pages[0].text.content,'Texto que não pode mudar', 'não altera páginas do diário');
groups=describeAffinityGroups(takeshi,j.getFlag(flagScope,'affinitiesV1'),['a2','a3']);
assert.equal(groups.others.length,2);
await assert.rejects(createJournalAffinity(j,{name:'Akira',makeId:()=>'uid103'}),/já aparece na equipe/);
await assert.rejects(createJournalAffinity(j,{name:'',actorId:'secret'}),/Digite o nome/);
await assert.rejects(deleteJournalAffinity(j,'actor:a2'),/Gerenciar Equipe/);
await deleteJournalAffinity(j,'npc:uid100');
assert.equal(j.getFlag(flagScope,'affinitiesV1').entries.length,2);
await assert.rejects(setJournalAffinity(j,'actor:secret','afeicao',2),/não cadastrado/);
// Dados ficam no Journal e não são gravados nas fichas.
assert.equal(takeshi.getFlag(flagScope,'affinitiesV1'),undefined);
// Alterar a equipe mantém valores anteriores em "Outros relacionamentos".
setting.parties[0].memberIds=[takeshi.id,uri.id];
groups=describeAffinityGroups(takeshi,j.getFlag(flagScope,'affinitiesV1'),['a3']);
assert.equal(groups.party.length,1);
assert.equal(groups.others.find(r=>r.key==='actor:a2')?.afeicao,3);
// Permissão do usuário; não pode modificar outros diários.
game.user=other;
await assert.rejects(setJournalAffinity(j,'actor:a2','afeicao',1),/permissão/);
await assert.rejects(createJournalAffinity(j,{name:'Nome',makeId:()=>'x'}),/permissão/);
// Estado do diário vinculado é exigido.
game.user=owner;
await assert.rejects(setJournalAffinity({...j, getFlag(){return null;}},'actor:a2','afeicao',1),/vinculado/);
console.log('OK: Party automática, NPCs por nome, bolinhas 0-3, dados legados preservados, permissões, persistência no Journal, preservação de páginas e desvinculação.');
