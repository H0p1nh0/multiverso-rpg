// Multiverso RPG — economia de ações compartilhada por Combate e Skills/Técnicas.
// v0.2.08: persistência de flags com todos os slots explícitos; evita merge reter ações gastas.
const NS='multiverso-rpg', FLAG='combatActionsV200';
export const ACTION_LABELS={acao:'Ação Padrão',movimento:'Ação de Movimento',bonus:'Ação Bônus',completa:'Ação Completa',reacao:'Reação',livre:'Livre',passiva:'Passiva'};
const ACTION_TYPES=new Set(Object.keys(ACTION_LABELS));
const locks=new Set(), pending=new Map();
let serial=0;
const actorKey=actor=>actor?.uuid||actor?.id||'';
const newClaim=()=>`mv-${Date.now().toString(36)}-${++serial}`;
// Foundry document.setFlag faz atualização parcial/merge em dados aninhados.
// Excluir `used.acao` de um objeto JS NÃO remove `used.acao: true` já salvo.
// Ao salvar, sempre escrever TODOS os slots, inclusive `false` e metadados vazios.
const SLOTS=['acao','movimento','bonus'];
function canonicalActionRecord(record){
 const used=Object.fromEntries(SLOTS.map(slot=>[slot,Boolean(record?.used?.[slot])]));
 const claims=Object.fromEntries(SLOTS.map(slot=>[slot,used[slot]?String(record?.claims?.[slot]??''):'']));
 const sources=Object.fromEntries(SLOTS.map(slot=>[slot,used[slot]?String(record?.sources?.[slot]??''):'']));
 return {tick:String(record?.tick??''),used,claims,sources,
  convertedMovement:Boolean(record?.convertedMovement&&used.acao)};
}
async function saveActionRecord(actor,record){
 const payload=canonicalActionRecord(record);
 await actor.setFlag(NS,FLAG,payload);
 // Depois do await, conferir o estado gravado; não exibir sucesso enganoso.
 const saved=actor.getFlag(NS,FLAG);
 if(saved?.tick!==payload.tick||SLOTS.some(slot=>Boolean(saved?.used?.[slot])!==payload.used[slot]))
  throw Error('A economia de ações não foi persistida corretamente. Veja F12.');
 return payload;
}
const ownTurn=(actor,combat)=>Boolean(combat?.started&&combat.combatant&&(combat.combatant.actor?.uuid===actor?.uuid||combat.combatant.actor?.id===actor?.id||combat.combatant.actorId===actor?.id));
const belongs=(actor,combat)=>Boolean(Array.from(combat?.combatants??[]).some(c=>c.actor?.uuid===actor?.uuid||c.actor?.id===actor?.id||c.actorId===actor?.id));
export function activityOf(item){
 if(!item||!['skill','tecnica'].includes(item.type))return '';
 const p=item.system?.props??{};
 const set=new Set(Array.from({length:5},(_,i)=>String(p[`ativacaotempotipo${item.type}${i?i+1:''}`]??'').trim()).filter(Boolean));
 if(set.size>1)return 'incompativel';
 return [...set][0]??'';
}
export function combatTick(combat=game.combat){return combat?.started&&combat.combatant?`${combat.id}:${combat.round}:${combat.turn}:${combat.combatant.id}`:'';}
export function blockedActionKinds(actor){
 const result=new Set();
 for(const effect of actor?.effects??[]){
  if(effect.disabled||effect.isSuppressed||!effect.getFlag?.(NS,'blocksAction'))continue;
  const choices=effect.getFlag(NS,'blockedActionTypes');
  for(const type of Array.isArray(choices)&&choices.length?choices:['todas'])result.add(String(type));
 }
 return result;
}
export function isActionBlocked(actor,activity){
 if(!activity||activity==='passiva')return false;
 const blocked=blockedActionKinds(actor);
 return blocked.has('todas')||blocked.has(activity)||(activity==='completa'&&(blocked.has('acao')||blocked.has('movimento')));
}
export function combatActionState(actor,combat=game.combat){
 const tick=combatTick(combat),old=actor?.getFlag?.(NS,FLAG);
 const oldInCombat=Boolean(tick&&old?.tick?.startsWith?.(`${combat.id}:`));
 // Recarga acontece APENAS quando entra no turno do próprio personagem.
 const fresh=ownTurn(actor,combat)&&old?.tick!==tick;
 const used=oldInCombat&&!fresh?{...old.used}:{};
 const claims=oldInCombat&&!fresh?{...old.claims}:{};
 const sources=oldInCombat&&!fresh?{...old.sources}:{};
 const convertedMovement=Boolean(oldInCombat&&!fresh&&old.convertedMovement);
 return {tick:!ownTurn(actor,combat)&&oldInCombat?old.tick:tick,used,claims,sources,convertedMovement,
  acao:used.acao?0:1,movimento:used.movimento?0:1,bonus:used.bonus?0:1};
}
export function actionStatus(actor,activity,combat=game.combat,{ignorePending=false}={}){
 if(!ACTION_TYPES.has(activity))return {ok:false,reason:'Tipo de ação inválido.'};
 if(isActionBlocked(actor,activity))return {ok:false,reason:`Uma condição ativa impede ${ACTION_LABELS[activity]}.`};
 if(!combat?.started)return {ok:true,consumed:false,needs:[],outside:true};
 if(!belongs(actor,combat))return {ok:false,reason:'Esse personagem não participa do combate.'};
 if(activity==='livre'||activity==='passiva'||activity==='reacao')return {ok:true,consumed:false,needs:[]};
 if(!ownTurn(actor,combat))return {ok:false,reason:'Esta ação só pode ser usada no próprio turno.'};
 if(!ignorePending&&pending.has(actorKey(actor)))return {ok:false,reason:'A ativação de uma Skill/Técnica está em andamento. Conclua ou cancele antes de outra ação.'};
 const state=combatActionState(actor,combat);
 let needs=[];
 if(activity==='completa')needs=['acao','movimento'];
 else if(activity==='movimento'){
  // Segundo Movimento pode converter a Padrão (não consome a primeira de novo).
  if(!state.used.movimento)needs=['movimento'];
  else if(!state.used.acao&&!state.convertedMovement)needs=['acao'];
  else return {ok:false,reason:'Ação de Movimento e Ação Padrão já utilizadas neste turno.',needs:[],tick:state.tick};
 }else needs=[activity];
 const missing=needs.filter(x=>state.used[x]);
 if(missing.length)return {ok:false,reason:`${missing.map(x=>ACTION_LABELS[x]).join(' e ')} já utilizada neste turno.`,needs,tick:state.tick};
 return {ok:true,needs,tick:state.tick,used:state.used,claims:state.claims,sources:state.sources,convertedMovement:state.convertedMovement,activity};
}
async function writeConsumption(actor,activity,combat,status){
 const claim=newClaim(),next={tick:status.tick,used:{...status.used},claims:{...status.claims},sources:{...status.sources},convertedMovement:status.convertedMovement};
 for(const x of status.needs){next.used[x]=true;next.claims[x]=claim;next.sources[x]=activity;}
 if(activity==='movimento'&&status.needs.includes('acao'))next.convertedMovement=true;
 await saveActionRecord(actor,next);
 // Rastreio exato: mostra se Bônus já estava gasto antes do clique de Movimento.
 console.info('Multiverso | Economia de ações — gasto',{
  personagem:actor?.name??actor?.id,tipo:activity,turno:status.tick,
  antes:{acao:Boolean(status.used.acao),movimento:Boolean(status.used.movimento),bonus:Boolean(status.used.bonus)},
  debitados:[...status.needs],
  depois:{acao:Boolean(next.used.acao),movimento:Boolean(next.used.movimento),bonus:Boolean(next.used.bonus)}
 });
 Hooks.callAll?.('multiversoAcaoConsumida',actor,{tipo:activity,estado:next,combatId:combat.id});
 return {...status,ok:true,consumed:true,activity,claim,after:next,combatId:combat.id};
}
// Consumo manual imediato, usado exclusivamente nos controles de Combate.
export async function reserveAction(actor,activity,combat=game.combat){
 const key=actorKey(actor);
 if(!key||locks.has(key))return {ok:false,reason:'Já existe uma atualização de ação em andamento.',consumed:false};
 const status=actionStatus(actor,activity,combat);
 if(!status.ok||!status.needs?.length||!combat?.started)return {...status,consumed:false};
 locks.add(key);
 try{
  const again=actionStatus(actor,activity,combat);
  if(!again.ok)return {...again,consumed:false};
  return await writeConsumption(actor,activity,combat,again);
 }finally{locks.delete(key);}
}
// Executar a Skill pode abrir vários diálogos. NÃO persistir gasto antes do resultado.
// A reserva em memória bloqueia uma segunda execução simultânea do mesmo personagem.
export function beginAbilityAction(actor,activity,combat=game.combat){
 const key=actorKey(actor),status=actionStatus(actor,activity,combat);
 if(!status.ok||!status.needs?.length||!combat?.started)return {...status,prepared:false};
 if(!key||locks.has(key)||pending.has(key))return {ok:false,reason:'Já existe uma ação em processamento neste personagem.',prepared:false};
 const token=newClaim();
 pending.set(key,{token,activity,tick:status.tick,combatId:combat.id});
 return {...status,ok:true,prepared:true,token,activity,combatId:combat.id};
}
export async function finishAbilityAction(actor,prepared,{success,combat=game.combat}={}){
 if(!prepared?.prepared)return {ok:true,consumed:false};
 const key=actorKey(actor),current=pending.get(key);
 if(!current||current.token!==prepared.token)return {ok:false,consumed:false,reason:'A reserva de ação não está mais ativa.'};
 if(!success){pending.delete(key);return {ok:true,consumed:false,cancelled:true};}
 if(locks.has(key))return {ok:false,consumed:false,reason:'Uma atualização de ação já está em andamento.'};
 locks.add(key);
 try{
  // Não permitir que um diálogo antigo consuma uma ação no turno seguinte.
  if(!combat?.started||combat.id!==current.combatId||combatTick(combat)!==current.tick)
   return {ok:false,consumed:false,reason:'O turno mudou durante a ativação. Ação não debitada; confira o card publicado.'};
  const latest=actionStatus(actor,current.activity,combat,{ignorePending:true});
  if(!latest.ok)return {...latest,consumed:false};
  return await writeConsumption(actor,current.activity,combat,latest);
 }finally{pending.delete(key);locks.delete(key);}
}
export async function refundAction(actor,receipt,combat=game.combat){
 if(!receipt?.consumed||!combat?.started||combat.id!==receipt.combatId)return false;
 const key=actorKey(actor);
 if(locks.has(key))return false;
 locks.add(key);
 try{
  const old=actor.getFlag(NS,FLAG);
  if(old?.tick!==receipt.tick)return false;
  // Não apagar um novo gasto do mesmo slot, feito após o cancelamento.
  const used={...old.used},claims={...old.claims},sources={...old.sources};
  let changed=false;
  for(const slot of receipt.needs){
   if(claims[slot]!==receipt.claim)continue;
   delete used[slot];delete claims[slot];delete sources[slot];changed=true;
  }
  if(!changed)return false;
  const convertedMovement=Boolean(used.acao&&old.convertedMovement);
  await saveActionRecord(actor,{tick:old.tick,used,claims,sources,convertedMovement});
  Hooks.callAll?.('multiversoAcaoRecuperada',actor,{tipo:receipt.activity,motivo:'Ativação cancelada',combatId:combat.id});
  return true;
 }finally{locks.delete(key);}
}
// Botão direito devolve APENAS o slot realmente consumido por esse tipo.
export async function manuallyRefundAction(actor,activity,combat=game.combat){
 if(!combat?.started||!belongs(actor,combat))return false;
 const key=actorKey(actor);
 if(!key||locks.has(key)||pending.has(key))return false;
 locks.add(key);
 try{
  const state=combatActionState(actor,combat),old=actor.getFlag(NS,FLAG);
  if(!state.tick||old?.tick!==state.tick)return false;
  const used={...state.used},claims={...state.claims},sources={...state.sources};
  let slots=[];
  if(activity==='completa'){
   // Completa estar INDISPONÍVEL não significa que foi usada.
   // Sem marcador de origem (versões antigas), recupere as ações uma a uma.
   if(used.acao&&used.movimento&&sources.acao==='completa'&&sources.movimento==='completa'&&claims.acao===claims.movimento)
    slots=['acao','movimento'];
  }else if(activity==='movimento'){
   // O botão Movimento devolve PRIMEIRO seu próprio 0/1.
   // A Padrão convertida para o segundo Movimento pode ser devolvida
   // com outro clique direito em Movimento ou diretamente na Padrão.
   if(used.movimento)slots=['movimento'];
   else if(used.acao&&state.convertedMovement)slots=['acao'];
  }else if(['acao','bonus'].includes(activity)&&used[activity])slots=[activity];
  if(!slots.length)return false;
  for(const slot of slots){delete used[slot];delete claims[slot];delete sources[slot];}
  const convertedMovement=Boolean(used.acao&&state.convertedMovement);
  await saveActionRecord(actor,{tick:state.tick,used,claims,sources,convertedMovement});
  console.info('Multiverso | Economia de ações — recuperação',{
   personagem:actor?.name??actor?.id,tipo:activity,turno:state.tick,recuperados:slots,
   depois:{acao:Boolean(used.acao),movimento:Boolean(used.movimento),bonus:Boolean(used.bonus)}
  });
  Hooks.callAll?.('multiversoAcaoRecuperada',actor,{tipo:activity,motivo:'Recuperação manual',combatId:combat.id});
  return true;
 }finally{locks.delete(key);}
}
