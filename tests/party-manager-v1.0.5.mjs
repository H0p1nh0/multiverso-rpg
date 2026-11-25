// Run: node tests/party-manager-v1.0.5.mjs
// Sem acesso a mundo real: testa somente operações de cadastro e garantias de integridade.
import assert from 'node:assert/strict';
import {
  normalizePartyRegistry, createParty, renameParty, deleteParty, addPartyMember,
  removePartyMember, getPartyForActor, registerPartyManager
} from '../module/party-manager.mjs';

let state = normalizePartyRegistry({});
assert.deepEqual(state, {schema:1, parties:[]});
state = createParty(state, '  Party   Principal ', () => 'party-1');
assert.equal(state.parties[0].name, 'Party Principal');
assert.throws(() => createParty(state, 'party principal', () => 'party-2'), /Já existe/);
assert.throws(() => createParty(state, '  ', () => 'party-2'), /Informe/);
state = createParty(state, 'Grupo B', () => 'party-2');
assert.throws(() => createParty(state, 'Grupo C', () => 'party-2'), /duplicado/);
state = addPartyMember(state, 'party-1', 'actor-a', id => id === 'actor-a');
assert.deepEqual(state.parties[0].memberIds, ['actor-a']);
assert.equal(getPartyForActor('actor-a', state)?.id, 'party-1');
assert.throws(() => addPartyMember(state, 'party-2', 'actor-a'), /pertence/);
assert.throws(() => addPartyMember(state, 'party-1', 'actor-a'), /já está/);
assert.throws(() => addPartyMember(state, 'party-1', 'invalid', () => false), /válido/);
state = renameParty(state, 'party-1', 'Grupo Novo');
assert.equal(state.parties[0].name, 'Grupo Novo');
assert.throws(() => renameParty(state, 'party-1', 'Grupo B'), /Já existe/);
state = removePartyMember(state, 'party-1', 'actor-a');
assert.equal(getPartyForActor('actor-a', state), null);
state = addPartyMember(state, 'party-2', 'actor-a');
assert.equal(getPartyForActor('actor-a', state)?.id, 'party-2');
state = deleteParty(state, 'party-1');
assert.equal(state.parties.length, 1);
assert.equal(state.parties[0].id, 'party-2');
// Recuperação de armazenamento antigo ou dados duplicados.
const normalized = normalizePartyRegistry({parties:[
 {id:'a',name:'Primária',memberIds:['p1','p1','p2']},
 {id:'b',name:'Secundária',memberIds:['p2','p3']},
 {id:'a',name:'Duplicada',memberIds:['p4']}
]});
assert.deepEqual(normalized.parties[0].memberIds, ['p1','p2']);
assert.deepEqual(normalized.parties[1].memberIds, ['p3']);
assert.equal(normalized.parties.length, 2);

// Registro de permissão e hooks, sem carregar o Foundry.
const hooks = {};
globalThis.game = {user:{isGM: true}, settings:{register:(namespace,key,settings)=>{
  assert.equal(namespace,'multiverso-rpg');
  assert.equal(key,'partyRegistryV1');
  assert.equal(settings.scope,'world');
  assert.equal(settings.config,false);
}}};
globalThis.Hooks = {on:(name,cb)=>{hooks[name]=cb;},once:(name,cb)=>{hooks[name]=cb;}};
registerPartyManager();
assert.equal(typeof hooks.renderJournalDirectory, 'function');
assert.equal(typeof hooks.renderApplicationV2, 'function');
assert.equal(typeof hooks.ready, 'function');
console.log('OK: party CRUD, permissões, duplicidades, integridade e hooks.');
