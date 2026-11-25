// v0.1.86 — leitura segura de flags legadas (escopos antigos podem estar inativos).
// Port do contador por Item do motor-efeitos.js V5.8.
// Dados guardados no Actor; uma ativação com cinco efeitos conta uma vez.
const NS='multiverso-rpg', LEGACY_NS='multiverso-automacao', FLAG='usosLimitadosV58', SEQS='recargaSequenciasV58';
// O Foundry v14 rejeita getFlag para escopos que não são módulos/sistemas ativos.
// Consultar flags herdadas diretamente não exige carregar o módulo antigo.
// Somente gravar dados no escopo do sistema atual, que está registrado.
const legacyFlag=(actor,key)=>{
 const current=actor?.getFlag?.(NS,key) ?? actor?.flags?.[NS]?.[key];
 const old=actor?.flags?.[LEGACY_NS]?.[key];
 const value=current ?? old;
 return value && typeof value==='object' && !Array.isArray(value) ? value : {};
};
const previousDaySequence=actor=>Number(actor?.flags?.multiverso?.novoDiaSequencia??0)||0;
const strips=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const SPECIAL_RECHARGES=Object.freeze({ataque_acertado:'ataque_acertado',ataque_critico:'ataque_critico',reacao_usada:'reacao_usada',inimigo_derrotado:'inimigo_derrotado'});
export function specialRechargeKind(raw){
 const value=strips(raw).replace(/[\s-]+/g,'_');
 const aliases={ao_acertar_ataque:'ataque_acertado',acerto:'ataque_acertado',ataque_acertado:'ataque_acertado',ao_confirmar_critico:'ataque_critico',critico:'ataque_critico',ataque_critico:'ataque_critico',reacao_usada:'reacao_usada',ao_usar_reacao:'reacao_usada',inimigo_derrotado:'inimigo_derrotado',derrotar_inimigo:'inimigo_derrotado',ao_derrotar_inimigo:'inimigo_derrotado'};
 return aliases[value]??'';
}
export function rechargeKind(raw){
 const v=strips(raw).replace(/[_-]+/g,' ');
 if(!v)return '';
 if(v.startsWith('evento:'))return 'manual';
 if(v.includes('descanso longo')||v.includes('descanso intensivo')||v==='longo'||v==='intensivo')return 'descanso_longo';
 if(v.includes('descanso curto')||v==='curto')return 'descanso_curto';
 if(v.includes('novo dia')||v.includes('por dia')||v==='dia'||v.includes('diari'))return 'novo_dia';
 for(const [pattern,id] of [['rodada','rodada'],['turno','turno'],['combate','combate'],['cena','cena'],['manual','manual'],['especial','manual'],['condicao','manual'],['ocasional','manual'],['nunca','nunca'],['sem recarga','nunca']])if(v.includes(pattern))return id;
 return '';
}
const field=(item,key,i)=>String(item?.system?.props?.[`efeito${item.type}${key}${i===1?'':i}`]??'').trim();
export function usageConfig(item){
 const active=[];
 for(let i=1;i<=5;i++){
  const usage=field(item,'usos',i),recharge=field(item,'recarga',i),special=field(item,'recargaespecial',i);
  if(usage||recharge||special)active.push({usage,recharge,special});
 }
 const usages=[...new Set(active.map(x=>x.usage).filter(Boolean))];
 const recharges=[...new Set(active.map(x=>x.recharge).filter(Boolean))];
 if(usages.length>1||recharges.length>1)return {error:'Limites ou recargas diferentes na mesma Skill. Configure uma regra por habilidade.'};
 // v0.2.10: the event can be chosen directly inside RECARGA.
 // Legacy manual+recargaespecial remains supported without extra UI.
 // Ignore inactive legacy descriptions when a non-manual mode is selected.
 const specials=[...new Set(active.map(x=>x.recharge.startsWith('evento:')
   ? x.recharge.slice('evento:'.length)
   : (!x.recharge||rechargeKind(x.recharge)==='manual'?x.special:'')).filter(Boolean))];
 if(specials.length>1)return {error:'A mesma Skill possui regras de recarga especial diferentes. Escolha um único evento.'};
 const raw=usages[0]??'';
 if(!raw){if(recharges.length||active.some(x=>x.special))return {error:'Uma recarga foi configurada sem limite de usos.'};return null;}
 if(/ilimit|sem limite/i.test(raw))return null;
 const amount=raw.match(/\d+(?:[.,]\d+)?/);
 if(!amount)return {error:'Limite de usos sem quantidade numérica.'};
 const value=Number(amount[0].replace(',','.'));
 if(!Number.isSafeInteger(value)||value<1||value>1000000)return {error:'O limite de usos deve ser um inteiro de 1 a 1000000.'};
 const recharge=rechargeKind(recharges[0])||rechargeKind(raw)||'manual';
 const special=specials[0]??'';
 if(recharges.some(x=>x.startsWith('evento:'))&&!specialRechargeKind(special))return {error:'Evento especial de recarga desconhecido.'};
 if(specialRechargeKind(special) && recharge!=='manual')return {error:'Recarga por evento especial exige Recarga = Manual / condição especial.'};
 return {limit:value,recharge,special};
}
const sequences=actor=>({...legacyFlag(actor,SEQS)});
function marker(actor,recharge){
 const combat=game.combat,seq=sequences(actor),scene=canvas?.scene?.id??game.scenes?.active?.id??'sem-cena';
 switch(recharge){
  case 'turno':return `turno:${combat?.id??'fora'}:${String(seq.turnoTick??'nao-iniciado')}`;
  case 'rodada':return `rodada:${combat?.id??'fora'}:${Number(combat?.round??0)}`;
  case 'combate':return `combate:${combat?.id??`fora-${scene}`}`;
  case 'cena':return `cena:${scene}:${Number(seq.cena??0)}`;
  case 'descanso_curto':case 'descanso_longo':return `${recharge}:${Number(seq[recharge]??0)}`;
  case 'novo_dia':return `novo_dia:${Math.max(Number(seq.novo_dia??0),previousDaySequence(actor))}`;
  case 'manual':case 'nunca':default:return recharge;
 }
}
export function usageStatus(actor,item){
 const config=usageConfig(item);
 if(config?.error)return {ok:false,error:config.error};
 if(!config)return {ok:true,limited:false};
 const key=`${item.type}:${item.id}`;
 const period=marker(actor,config.recharge);
 const map=legacyFlag(actor,FLAG);
 const stored=map[key]??{};
 const same=Number(stored.limite)===config.limit&&stored.recarga===config.recharge&&stored.marcador===period;
 const used=same?Math.max(0,Math.floor(Number(stored.usados??0))):0;
 return {ok:used<config.limit,limited:true,key,period,used,remaining:Math.max(0,config.limit-used),config};
}
export async function takeUsage(actor,item){
 const state=usageStatus(actor,item);
 if(!state.ok||!state.limited)return state;
 const map={...legacyFlag(actor,FLAG)};
 map[state.key]={...map[state.key],usados:state.used+1,limite:state.config.limit,recarga:state.config.recharge,marcador:state.period,especial:state.config.special,atualizado:Date.now()};
 await actor.setFlag(NS,FLAG,map);
 return {...state,used:state.used+1,remaining:state.remaining-1};
}
export async function restoreUsage(actor,status){
 if(!status?.limited)return;
 const map={...legacyFlag(actor,FLAG)};
 const saved=map[status.key];
 if(saved?.marcador!==status.period)return;
 map[status.key]={...saved,usados:Math.max(0,Number(saved.usados)-1)};
 await actor.setFlag(NS,FLAG,map);
}
export async function registerRecharge(actor,kind){
 if(!actor?.setFlag||!['cena','descanso_curto','descanso_longo','novo_dia','manual'].includes(kind))throw new Error('Evento de recarga inválido.');
 const seq=sequences(actor);
 seq[kind]=(kind==='novo_dia' ? Math.max(Number(seq.novo_dia??0),previousDaySequence(actor)) : Number(seq[kind]??0))+1;
 if(kind==='descanso_longo')seq.descanso_curto=Number(seq.descanso_curto??0)+1;
 await actor.setFlag(NS,SEQS,seq);
}
export async function manualRecharge(actor,item){
 const state=usageStatus(actor,item);
 if(!state.limited||state.error)return state;
 const map={...legacyFlag(actor,FLAG)};
 map[state.key]={usados:0,limite:state.config.limit,recarga:state.config.recharge,marcador:state.period,especial:state.config.special,atualizado:Date.now()};
 await actor.setFlag(NS,FLAG,map);
 return usageStatus(actor,item);
}
// Recarga especial apenas após evento VERIFICÁVEL. Nunca inferir derrota por PV 0.
const verifiedEventLocks=new Set();
export async function rechargeVerifiedEvent(actor,event,{eventId='',target=null}={}){
 if(!game.user?.isGM)throw Error('Eventos especiais só podem ser registrados pelo mestre.');
 if(!Object.values(SPECIAL_RECHARGES).includes(event))throw Error('Evento de recarga especial inválido.');
 if(!actor?.setFlag||!eventId)throw Error('Evento especial precisa de identificador de confirmação.');
 const signature=`${actor.uuid??actor.id}:${eventId}`;
 if(verifiedEventLocks.has(signature))return [];
 verifiedEventLocks.add(signature);
 try{
  const map={...legacyFlag(actor,FLAG)}, restored=[];
  for(const item of actor.items??[]){
   if(!['skill','tecnica'].includes(item.type))continue;
   const state=usageStatus(actor,item);
   if(state.error){console.warn('Multiverso | Recarga especial não configurada:',item.name,state.error);continue;}
   if(!state.limited||state.config.recharge!=='manual'||specialRechargeKind(state.config.special)!==event||state.used<1)continue;
   if(map[state.key]?.lastSpecialEvent===eventId)continue;
   map[state.key]={...map[state.key],usados:0,limite:state.config.limit,recarga:state.config.recharge,especial:state.config.special,marcador:state.period,lastSpecialEvent:eventId,atualizado:Date.now()};
   restored.push({name:item.name,remaining:state.config.limit,limit:state.config.limit});
  }
  if(restored.length){
   await actor.setFlag(NS,FLAG,map);
   actor.sheet?.render?.(false);
  }
  return restored;
 }finally{verifiedEventLocks.delete(signature);}
}
// Cenas/descansos não possuem eventos universais nativos: expor controles explícitos.
let turnQueue=Promise.resolve();
async function recordOwnTurn(combat){
 if(!game.user?.isGM||!combat?.started||!combat.combatant)return;
 const member=combat.combatant;
 const tick=`${combat.id}:${combat.round}:${combat.turn}:${member.id}`;
 const token=member.actor;
 const base=game.actors?.get?.(member.actorId??token?.id);
 for(const actor of new Map([token,base].filter(Boolean).map(a=>[a.uuid,a])).values()){
  const seq=sequences(actor);
  if(seq.turnoTick===tick)continue;
  seq.turnoTick=tick;
  await actor.setFlag(NS,SEQS,seq);
  actor.sheet?.render?.(false);
 }
}
export function registerUsageEvents(){
 Hooks.on('updateActor',(actor,changes)=>{
   const marker=changes?.flags?.[NS]?.reactionSuccessEventV1;
   if(!game.user?.isGM||!marker?.nonce||marker.combatId!==game.combat?.id)return;
   void rechargeVerifiedEvent(actor,'reacao_usada',{eventId:`reacao:${marker.nonce}`}).catch(error=>console.error('Multiverso | Recarga por reação',error));
 });
 Hooks.on('combatStart',combat=>{if(game.user?.isGM)turnQueue=turnQueue.then(()=>recordOwnTurn(combat)).catch(e=>console.error('Multiverso | recarga por turno',e));});
 Hooks.on('updateCombat',(combat,changes)=>{
  if(!game.user?.isGM||(!('turn' in (changes??{}))&&!('round' in (changes??{}))))return;
  turnQueue=turnQueue.then(()=>recordOwnTurn(combat)).catch(e=>console.error('Multiverso | recarga por turno',e));
 });
}

