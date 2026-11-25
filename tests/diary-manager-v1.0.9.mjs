// Run: node tests/diary-manager-v1.0.9.mjs
import assert from 'node:assert/strict';
import { ensureActorDiary, linkExistingDiary, unlinkDiary, findManagedJournal, registerAutoDiaries } from '../module/auto-diaries.mjs';
import { registerDiaryManager } from '../module/diary-manager.mjs';

let idCounter=0;
const actors=[]; const journals=[]; const folders=[]; const callbacks={};
const users=[{id:'gm1',isGM:true,active:true},{id:'p1',isGM:false,active:true},{id:'p2',isGM:false,active:true}];
function makeActor(name,owner='p1') {
  const obj={id:`a${++idCounter}`,name,type:'personagem',pack:null,img:'',ownership:{default:0,[owner]:3},flags:{},
    testUserPermission(user,role){return role==='OWNER' && (this.ownership[user.id] ?? this.ownership.default ?? 0)>=3;},
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    async setFlag(scope,key,val){this.flags[scope]??={};this.flags[scope][key]=val;},
    async unsetFlag(scope,key){delete this.flags[scope]?.[key];}
  }; actors.push(obj); return obj;
}
function makeJournal(name,owner='p2',folder='manual') {
  const j={id:`j${++idCounter}`,name,folder,flags:{},pack:null,ownership:{default:0,[owner]:3},pages:[{name:'Capítulo 1',text:{content:'Texto original que NÃO pode sumir'}}],
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    async update(changes){Object.assign(this,structuredClone(changes));}
  }; journals.push(j);return j;
}
globalThis.game={user:users[0],users:{contents:users},actors:{contents:actors,get:id=>actors.find(a=>a.id===id)},journal:{contents:journals,get:id=>journals.find(j=>j.id===id)},folders:{contents:folders}};
globalThis.Folder={async create(data){const f={id:`f${++idCounter}`,...data};folders.push(f);return f;}};
globalThis.JournalEntry={async create(data){const j=makeJournal(data.name);Object.assign(j,structuredClone(data));return j;}};
globalThis.Hooks={on(name,cb){(callbacks[name]??=[]).push(cb);},once(name,cb){(callbacks[name]??=[]).push(cb);}};
globalThis.ui={notifications:{info(){},warn(){},error(){}}};
globalThis.document=undefined; // Verifica que o registro de hooks não exige DOM.
registerAutoDiaries(); registerDiaryManager();
assert.equal(callbacks.renderJournalDirectory.length,1);
assert.equal(callbacks.renderApplicationV2.length,1);

const uri=makeActor('Uri');
const mason=makeActor('Mason','p2');
const t=makeActor('Takeshi');
const oldUri=makeJournal('Uri','p2');
const oldMason=makeJournal('Mason','p2');
folders.push({id:'diarios-folder',name:'Diarios',type:'JournalEntry'});
assert.equal(findManagedJournal(uri),null);
await linkExistingDiary(uri,oldUri);
assert.equal(findManagedJournal(uri)?.id,oldUri.id);
assert.equal(oldUri.name,'Uri','não renomeia Journal manual');
assert.equal(oldUri.pages[0].text.content,'Texto original que NÃO pode sumir');
assert.equal(oldUri.folder,'diarios-folder');
assert.equal(oldUri.ownership.p1,3);
assert.equal(oldUri.ownership.p2,0,'antigo proprietário sem acesso à ficha deve perder permissão');
assert.equal(oldUri.ownership.default,0);
assert.equal(uri.getFlag('multiverso-rpg','autoDiaryJournalId'),oldUri.id);
assert.equal(oldUri.getFlag('multiverso-rpg','autoDiaryKeepName'),true);

uri.name='Uri — Retornado';
await ensureActorDiary(uri,{create:false});
assert.equal(oldUri.name,'Uri','nome original permanece ao renomear ficha');
uri.ownership={default:0,p1:0,p2:3};
await ensureActorDiary(uri,{create:false});
assert.equal(oldUri.ownership.p1,0);
assert.equal(oldUri.ownership.p2,3);

await assert.rejects(linkExistingDiary(mason,oldUri), /já está vinculado/);
await assert.rejects(linkExistingDiary(uri,oldMason), /já possui/);
const newJ=await ensureActorDiary(t,{create:true});
assert.equal(findManagedJournal(t).id,newJ.id);
assert.equal(newJ.name,'Diário — Takeshi');
assert.equal(newJ.pages.length,1);
await assert.rejects(linkExistingDiary(mason,newJ),/já está vinculado/);

const beforePages=oldUri.pages;
await unlinkDiary(uri);
assert.equal(findManagedJournal(uri),null);
assert.equal(oldUri.pages,beforePages);
assert.equal(oldUri.name,'Uri');
assert.equal(oldUri.folder,'diarios-folder');
assert.equal(uri.getFlag('multiverso-rpg','autoDiaryJournalId'),undefined);
await linkExistingDiary(mason,oldUri);
assert.equal(findManagedJournal(mason)?.id,oldUri.id);
assert.equal(oldUri.pages,beforePages);
await assert.rejects(linkExistingDiary(mason,oldMason),/já possui/);

// Depois de desvincular, o mestre pode associar outro Journal.
await unlinkDiary(mason);
await linkExistingDiary(mason,oldMason);
assert.equal(findManagedJournal(mason)?.id,oldMason.id);
assert.equal(oldMason.pages[0].text.content,'Texto original que NÃO pode sumir');

// O jogador não pode administrar, mesmo dono da ficha.
game.user=users[1];
await assert.rejects(linkExistingDiary(uri,oldUri),/Somente o mestre/);
await assert.rejects(unlinkDiary(mason),/Somente o mestre/);
assert.equal(await ensureActorDiary(uri,{create:true}),null);

console.log('OK: vinculação de Journals antigos, conteúdo, nomes, pasta, propriedade, exclusividade, criação retroativa, desvincular e restrição ao GM.');
