// Run: node tests/auto-diaries-v1.0.8.mjs
import assert from 'node:assert/strict';
import {automaticDiaryName, isDiaryFolder, diaryOwnershipForActor, ensureActorDiary, registerAutoDiaries} from '../module/auto-diaries.mjs';

const actors = [];
const journals = [];
const folders = [];
const updates = [];
const hooks = {};
const users = [
  {id:'gm1', isGM:true, active:true},
  {id:'p1', isGM:false, active:true},
  {id:'p2', isGM:false, active:true}
];
let nextId = 0;
let createCount = 0;
const fakeJ = data => {
  const doc = {
    ...data, id:`j${++nextId}`,
    getFlag(scope,key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      updates.push(changes);
      Object.assign(this, structuredClone(changes));
    }
  };
  journals.push(doc);
  return doc;
};
const actor = (name, ownership = {default:0, p1:3}) => {
  const flags = {};
  const obj = {
    id: `a${++nextId}`, name, type:'personagem', pack:null, ownership, flags,
    testUserPermission(user,role) { return role === 'OWNER' && (this.ownership[user.id] ?? this.ownership.default ?? 0) >= 3; },
    getFlag(scope,key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope,key,val) { this.flags[scope] ??= {}; this.flags[scope][key]=val; }
  };
  actors.push(obj);
  return obj;
};
globalThis.game = {
  user:users[0], users:{contents:users},
  actors:{contents:actors}, journal:{contents:journals, get:id=>journals.find(j=>j.id===id)},
  folders:{contents:folders}
};
globalThis.Folder = {async create(data) {const f={id:`f${++nextId}`, ...data}; folders.push(f); return f;}};
globalThis.JournalEntry = {async create(data) {createCount++; return fakeJ(structuredClone(data));}};
globalThis.ui = {notifications:{warn: msg=>{throw new Error(msg);}}};
globalThis.Hooks = {on:(name,cb)=>{hooks[name]=cb;}, once:(name,cb)=>{hooks[name]=cb;}};

assert(isDiaryFolder({name:'DIARIOS',type:'JournalEntry'}));
assert(isDiaryFolder({name:'Diários',type:'JournalEntry'}));
assert(!isDiaryFolder({name:'Diários',type:'Actor'}));
const manualFolder = {id:'manual-folder',type:'JournalEntry',name:'Diarios'};
folders.push(manualFolder);
const manuallyMade = fakeJ({name:'Uri',folder:manualFolder.id,ownership:{default:0,p2:3},flags:{},pages:[{name:'Meu segredo',content:'texto já escrito'}]});
const uri = actor('Uri');
const a = actor('Takeshi');
registerAutoDiaries();
assert.equal(typeof hooks.createActor,'function');
assert.equal(typeof hooks.updateActor,'function');
assert.equal(typeof hooks.ready,'function');

// Existing actors & journals are NOT adopted or modified on world startup.
hooks.ready();
await Promise.resolve();
assert.equal(createCount,0);
assert.equal(manuallyMade.name,'Uri');
assert.equal(manuallyMade.pages[0].content,'texto já escrito');
assert.equal(uri.getFlag('multiverso-rpg','autoDiaryJournalId'),undefined);

// A freshly created actor gets exactly one Journal and a blank starter page.
const [newJournal, sameJournal] = await Promise.all([
  ensureActorDiary(a,{create:true}), ensureActorDiary(a,{create:true})
]);
assert.equal(newJournal.id,sameJournal.id);
assert.equal(createCount,1);
assert.equal(newJournal.folder,manualFolder.id); // Reuse Diarios without accent
assert.equal(folders.length,1);
assert.equal(newJournal.name, 'Diário — Takeshi');
assert.equal(automaticDiaryName(a),newJournal.name);
assert.equal(newJournal.flags['multiverso-rpg'].autoDiaryActorId,a.id);
assert.equal(newJournal.pages.length,1);
assert.equal(newJournal.pages[0].type,'text');
assert.equal(newJournal.ownership.p1,3);
assert.equal(newJournal.ownership.p2,0);
assert.equal(newJournal.ownership.default,0);
assert.equal(a.getFlag('multiverso-rpg','autoDiaryJournalId'),newJournal.id);

// Sync links after a name change without generating a second Journal.
a.name='Takeshi II';
await ensureActorDiary(a,{create:false});
assert.equal(newJournal.name,'Diário — Takeshi II');
assert.equal(createCount,1);

// Changing owner revokes the former owner, including with Foundry's merged updates.
a.ownership={default:0,p1:0,p2:3};
await ensureActorDiary(a,{create:false});
assert.equal(newJournal.ownership.p1,0);
assert.equal(newJournal.ownership.p2,3);
assert.equal(diaryOwnershipForActor(a,users).p2,3);
assert.equal(newJournal.ownership.default,0);

// Actor clones may inherit the old link; the Journal belonging to another
// actor is never reused or stolen.
const clone=actor('Cópia de Takeshi',{default:0,p2:3});
clone.flags['multiverso-rpg']={autoDiaryJournalId:newJournal.id};
const cloneDiary=await ensureActorDiary(clone,{create:true});
assert.notEqual(cloneDiary.id,newJournal.id);
assert.equal(cloneDiary.flags['multiverso-rpg'].autoDiaryActorId,clone.id);
assert.equal(createCount,2);

// A non-GM cannot create/modify Journals through these hooks.
game.user=users[1];
const otherActor=actor('Outro');
assert.equal(await ensureActorDiary(otherActor,{create:true}),null);
assert.equal(createCount,2);

// Only the first connected GM acts, preventing duplicates with two GMs.
const secondGM={id:'gm2',isGM:true,active:true};
users.push(secondGM); game.user=secondGM;
assert.equal(await ensureActorDiary(otherActor,{create:true}),null);
users.pop(); game.user=users[0];
assert.equal((await ensureActorDiary(otherActor,{create:true})).name,'Diário — Outro');
assert.equal(createCount,3);

// A skill/item creation does not create diaries; only type personagem.
const otherType={...actor('Criatura'), type:'npc'};
assert.equal(await ensureActorDiary(otherType,{create:true}),null);
assert.equal(createCount,3);
assert.equal(manuallyMade.ownership.p2,3);

// Foundry event callbacks trigger the same behavior automatically.
const triggered = actor('Personagem por Hook');
hooks.createActor(triggered, {}, 'p1');
await new Promise(resolve => setImmediate(resolve));
const triggeredJournal = journals.find(j => j.getFlag('multiverso-rpg','autoDiaryActorId') === triggered.id);
assert(triggeredJournal, 'createActor hook should create the Journal');
triggered.name = 'Personagem renomeado';
hooks.updateActor(triggered, {name: 'Personagem renomeado'});
await new Promise(resolve => setImmediate(resolve));
assert.equal(triggeredJournal.name,'Diário — Personagem renomeado');
triggered.ownership={default:0,p1:0,p2:3};
hooks.updateActor(triggered, {ownership:{p1:0,p2:3}});
await new Promise(resolve => setImmediate(resolve));
assert.equal(triggeredJournal.ownership.p1,0);
assert.equal(triggeredJournal.ownership.p2,3);
assert.equal(createCount,4);

console.log('OK: Diário automático, pasta existente, unicidade, donos, troca de dono, clones, GM e Journals legados preservados.');
