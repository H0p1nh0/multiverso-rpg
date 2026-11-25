// Multiverso RPG v1.0.16 • Relações DIRECIONAIS sentidas pelo NPC.
// Regra pura e testável; acesso ao documento Foundry fica na ficha de NPC.
export const NPC_RELATIONS_FLAG='npcRelationsV1';
const MAX_RELATIONS=120;
const clean=v=>String(v??'').trim().replace(/\s+/g,' ').slice(0,90);
const clamp=v=>Math.max(0,Math.min(3,Number.isFinite(Number(v))?Math.trunc(Number(v)):0));
const compare=(a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'})===0;
export function normalizeNPCRelations(value){
  const entries=[];const keys=new Set();
  for(const entry of (Array.isArray(value?.entries)?value.entries:[])){
    if(!entry||typeof entry!=='object')continue;
    const key=String(entry.key??'').trim();const name=clean(entry.name);
    if(!/^(actor|extra):[a-zA-Z0-9_-]+$/.test(key)||!name||keys.has(key))continue;
    keys.add(key);entries.push({key,name,afeicao:clamp(entry.afeicao),admiracao:clamp(entry.admiracao)});
    if(entries.length===MAX_RELATIONS)break;
  }
  return {schema:1,entries};
}
// Party e personagens são dados já autorizados do gerenciamento de equipes.
// Não inclui fichas ocultas/não pertencentes à Party na lista de seleção.
export function npcPartyRelationships(registry, actors){
  const result=[];const ids=new Set();
  for(const party of (Array.isArray(registry?.parties)?registry.parties:[])){
    for(const id of (Array.isArray(party?.memberIds)?party.memberIds:[])){
      if(ids.has(id))continue;
      const actor=actors?.get?.(id);
      if(!actor||actor.type!=='personagem')continue;
      ids.add(id);
      result.push({key:`actor:${id}`,name:actor.name,image:actor.img,party:clean(party.name)||'Equipe'});
    }
  }
  return result;
}
export function npcRelationGroups(raw,registry,actors){
  const data=normalizeNPCRelations(raw);
  const stored=new Map(data.entries.map(entry=>[entry.key,entry]));
  const party=npcPartyRelationships(registry,actors).map(member=>({...stored.get(member.key),...member,
    afeicao:stored.get(member.key)?.afeicao??0,admiracao:stored.get(member.key)?.admiracao??0}));
  const partyKeys=new Set(party.map(member=>member.key));
  const others=data.entries.filter(entry=>!partyKeys.has(entry.key)).map(entry=>({
    ...entry,name:entry.key.startsWith('actor:')?(actors?.get?.(entry.key.slice(6))?.name??entry.name):entry.name,
    image:entry.key.startsWith('actor:')?(actors?.get?.(entry.key.slice(6))?.img??null):null
  }));
  return {party,others};
}
export function setNPCRelationLevel(raw,key,field,level,registry,actors){
  if(!['afeicao','admiracao'].includes(field))throw Error('Tipo de vínculo inválido.');
  if(!Number.isInteger(level)||level<0||level>3)throw Error('O nível deve ficar entre 0 e 3.');
  const data=normalizeNPCRelations(raw);
  const existing=data.entries.find(entry=>entry.key===key);
  const party=npcPartyRelationships(registry,actors).find(member=>member.key===key);
  if(!existing&&!party)throw Error('Relacionamento não encontrado.');
  const entry=existing??{key,name:party.name,afeicao:0,admiracao:0};
  const next={...entry,[field]:level};
  return normalizeNPCRelations({entries:existing?data.entries.map(e=>e.key===key?next:e):[...data.entries,next]});
}
export function addNPCNamedRelation(raw,name,id,registry,actors){
  const text=clean(name);if(!text)throw Error('Digite o nome do relacionamento.');
  const data=normalizeNPCRelations(raw);
  const groups=npcRelationGroups(data,registry,actors);
  if([...groups.party,...groups.others].some(e=>compare(e.name,text)))throw Error('Esse relacionamento já está cadastrado.');
  if(data.entries.length>=MAX_RELATIONS)throw Error('Limite de relacionamentos atingido.');
  if(!/^[a-zA-Z0-9_-]+$/.test(String(id??'')))throw Error('Identificador inválido.');
  return normalizeNPCRelations({entries:[...data.entries,{key:`extra:${id}`,name:text,afeicao:0,admiracao:0}]});
}
export function removeNPCNamedRelation(raw,key){
  if(!key?.startsWith('extra:'))throw Error('Membros da Party são gerenciados no Gerenciador de Equipes.');
  const data=normalizeNPCRelations(raw);
  return normalizeNPCRelations({entries:data.entries.filter(e=>e.key!==key)});
}
// Nunca usa vínculos de um JOGADOR com NPC: a direção é NPC -> jogador.
// O mestre verifica presença real antes de aplicar este nível em combate.
export function npcMaxAdmirationForPresent(raw,registry,actors,presentActorIds){
  const present=new Set(presentActorIds);
  return npcRelationGroups(raw,registry,actors).party
    .filter(entry=>present.has(entry.key.slice(6)))
    .reduce((max,entry)=>Math.max(max,entry.admiracao),0);
}
