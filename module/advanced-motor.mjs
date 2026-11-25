import {isItemEffectSource,itemSourceActive} from './item-effect-links.mjs';
// Motor avançado v0.1.78: núcleos explícitos. Não interpreta linguagem livre
// dos campos legados, nem supõe um acerto quando o card não o determina.
const NS='multiverso-rpg';
const FLUXOS={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const MAXIMOS={pv:'pv_max',pm:'pm_max',sta:'sta_max',san:'san_max'};
import {parseFluxExpression,fluxById,normalizeFluxName} from './extra-flux.mjs';
export const keyAdvanced=(name,index)=>`${name}${index}`;
const number=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const isBelow=(stats,resource,percent)=>number(stats[FLUXOS[resource]])<number(stats[MAXIMOS[resource]])*percent&&number(stats[MAXIMOS[resource]])>0;
export function predicateValue(code,stats){
 switch(String(code??'')){
  case '':return true;
  case 'pv_lt_50':return isBelow(stats,'pv',.5);
  case 'pm_lt_50':return isBelow(stats,'pm',.5);
  case 'sta_lt_50':return isBelow(stats,'sta',.5);
  case 'san_lt_50':return isBelow(stats,'san',.5);
  case 'pv_lt_25':return isBelow(stats,'pv',.25);
  case 'pv_gt_0':return number(stats.pv_atual)>0;
  default:throw new Error(`Condição avançada desconhecida: ${code}`);
 }
}
export function predicateCheck(props,index,stats){
 const mode=String(props?.[keyAdvanced('mvPredicateMode',index)]??'');
 const a=String(props?.[keyAdvanced('mvPredicateA',index)]??'');
 const b=String(props?.[keyAdvanced('mvPredicateB',index)]??'');
 if(!mode&&!a&&!b)return true;
 if(!mode&&a&&!b)return predicateValue(a,stats);
 if(!['and','or'].includes(mode))throw new Error('Selecione E ou OU para combinar duas condições avançadas.');
 if(!a||!b)throw new Error('Preencha as duas condições para usar E ou OU.');
 const aa=predicateValue(a,stats),bb=predicateValue(b,stats);
 return mode==='and'?aa&&bb:aa||bb;
}
export function validateAdvanced(props,index,{activity='',effectType='',affected='',receiver='',cadence='once',durationKind='unspecified',external=false,actor=null}={}){
 const argumentsActor=actor;
 const errors=[],at=k=>String(props?.[keyAdvanced(k,index)]??'');
 const mode=at('mvPredicateMode'),a=at('mvPredicateA'),b=at('mvPredicateB');
 if(mode||a||b){try{predicateCheck(props,index,{pv_atual:1,pv_max:2,pm_atual:1,pm_max:2,sta_atual:1,sta_max:2,san_atual:1,san_max:2});}catch(e){errors.push(e.message);}}
 const trigger=at('mvTrigger');
 if(trigger){
  if(!['damage_received','heal_received','damage_dealt','turn_start','turn_end','threshold_cross','attack_hit','attack_miss','attack_critical','critical_received','reaction_used'].includes(trigger))errors.push(`O gatilho ${trigger} não pode ser usado nesta configuração.`);
  if(activity!=='passiva'||effectType!=='recurso'||receiver!=='proprio'||!['pv','pm','sta','san'].includes(affected))errors.push('Gatilho automático exige Passiva, tipo Alteração de fluxo, receptor Próprio e recurso PV/PM/STA/SAN.');
  if(trigger==='threshold_cross'&&!a)errors.push('Gatilho de limiar requer a Condição 1 preenchida.');
 }
 const chain=at('mvChain');
 if(chain){
  if(!['previous_effective','previous_failed'].includes(chain))errors.push('Encadeamento desconhecido.');
  if(index===1)errors.push('O primeiro efeito não pode depender de um efeito anterior.');
  if(external)errors.push('Este encadeamento de efeitos externos não é compatível com a configuração selecionada.');
  // Na execução composta externa, uma penalidade/condição mantida pode
  // aguardar a CONFIRMAÇÃO MANUAL de dano do efeito anterior. A rota externa
  // verifica o tipo do anterior antes de permitir esse encadeamento.
  // O encadeamento próprio e os periódicos permanecem sem suporte aqui.
  const deferredMaintained=external&&chain==='previous_effective'&&cadence==='maintained'&&['atributo','bonus','penalidade','deslocamento','defesa','teste','condicao'].includes(effectType);
  if(cadence!=='once'&&!deferredMaintained)errors.push('Encadeamento aceita apenas efeitos de aplicação única nesta etapa.');
 }
 const sustain=at('mvSustainCost');
 if(sustain){
  if(!parseSustain(sustain,argumentsActor))errors.push('Custo de sustentação inválido ou Fluxo Extra inexistente/inativo.');
  if(!external && (cadence!=='maintained'||!['turns','rounds'].includes(durationKind)))errors.push('Custo de sustentação próprio exige efeito mantido com duração em turnos ou rodadas.');
  if(external && !['turns','rounds','sustained'].includes(durationKind))errors.push('Custo de sustentação externo exige duração em turnos, rodadas ou sustentação.');
 }
 return errors;
}
export function chainAllows(mode,previousEffective){
 if(!mode)return true;
 if(mode==='previous_effective')return Boolean(previousEffective);
 if(mode==='previous_failed')return !previousEffective;
 throw new Error(`Encadeamento desconhecido: ${mode}`);
}
// Custo explícito por recurso, sem eval, rolagens ou percentuais.
// Ex.: "1 PM + 1 SAN". Mantém compatibilidade com "2 STA" de versões antigas.
export function parseSustain(raw,actor=null){
 const parsed=parseFluxExpression(raw,actor);
 if(!parsed)return null;
 return {costs:parsed};
}
export function sustainCosts(stored,actor){
 const costs=Array.isArray(stored?.costs)?stored.costs:(stored?.resource?[stored]:[]);
 return costs.map(c=>{const def=fluxById(actor,c.resource);return {resource:c.resource,amount:Number(c.amount),key:(def?.key===c.key||!c.key)&&(!c.label||normalizeFluxName(def?.label)===normalizeFluxName(c.label))?def?.key:null,label:c.label??def?.label};});
}

export const advancedMode=(item,index,name)=>String(item.system?.props?.[keyAdvanced(name,index)]??'').trim();
export function automaticEffects(actor,trigger){
 const result=[];
 for(const item of actor?.items??[]){
  if(!['skill','tecnica'].includes(item.type))continue;
  if(isItemEffectSource(item)&&!itemSourceActive(item))continue;
  const props=item.system.props??{};
  for(let i=1;i<=5;i++){
   if(advancedMode(item,i,'mvTrigger')!==trigger)continue;
   const suffix=i===1?'':i;
   const field=k=>String(props[`efeito${item.type}${k}${suffix}`]??'');
   const activity=String(props[`ativacaotempotipo${item.type}${suffix}`]??'');
   const errors=validateAdvanced(props,i,{activity,effectType:field('tipo'),affected:field('afetado'),receiver:field('receptor')||'proprio'});
   // Campos de custo, resistência e regras especiais não podem ser ignorados
   // silenciosamente pelo executor automático de alteração de fluxo.
   const unsupported=['custo','custoopcional','sustentacao','condicao','especial','formarea','resistenciaespecial','escolhaopcoes','ataquerolagem','recargaespecial','usos']
     .filter(k=>field(k).trim());
   if(field('resistenciaativa')==='sim'||(field('duracao')&&!/^(instantane[ao]|imediat[ao])$/i.test(field('duracao')))||unsupported.length)errors.push(`Campos incompatíveis com gatilho automático simples: ${unsupported.join(', ')||'resistência/duração'}.`);
   if(activity!=='passiva'||field('tipo')!=='recurso'||field('definicao')==='escolhido'||!['','fixo'].includes(field('escala'))||!['somar','subtrair',''].includes(field('operacao'))||!/^\d+(?:[.,]\d+)?$/.test(field('valor'))||errors.length){
    console.warn(`Multiverso RPG | gatilho ignorado por configuração não suportada: ${item.name} (efeito ${i})`,errors);
    continue;
   }
   const resource=field('afetado'),key=FLUXOS[resource],max=MAXIMOS[resource];
   result.push({item,index:i,props,key,max,delta:Number(field('valor').replace(',','.'))*(field('operacao')==='subtrair'?-1:1)});
  }
 }
 return result;
}
const queued=new Set(),internalUpdates=new WeakSet();
async function performAutomatic(actor,trigger,oldStats=null){
 if(!game.user.isGM||!actor||actor.type!=='personagem')return;
 const candidates=automaticEffects(actor,trigger);
 for(const entry of candidates){
  const token=`${actor.uuid}:${entry.item.id}:${entry.index}:${trigger}`;
  if(queued.has(token))continue;
  const current=actor.system??{};
  let accepts=false;
  try{
   accepts=predicateCheck(entry.props,entry.index,current);
   if(trigger==='threshold_cross'){
    const selected=advancedMode(entry.item,entry.index,'mvPredicateA');
    accepts=accepts&&!!oldStats&&!predicateValue(selected,oldStats)&&predicateValue(selected,current);
   }
  }catch(err){console.warn('Multiverso RPG | condição avançada bloqueada',err);continue;}
  if(!accepts)continue;
  queued.add(token);
  try{
   // Ler novamente no momento da atualização para evitar sobrescrever valores
   // alterados desde o início do hook. O updateActor posterior não reativa
   // damage_received (PV só aumenta quando uma cura é acionada).
   const actual=Number(actor.system[entry.key]);const maximum=Number(actor.system[entry.max]);
   if(!Number.isFinite(actual)||!Number.isFinite(maximum))continue;
   const next=Math.min(maximum,Math.max(0,actual+entry.delta));
   if(next===actual)continue;
   internalUpdates.add(actor);
   try{await actor.update({[`system.${entry.key}`]:next});}finally{internalUpdates.delete(actor);}
   const reason={damage_received:'PV reduzido',heal_received:'PV recuperado',damage_dealt:'Dano confirmado em alvo',turn_start:'Início do turno',turn_end:'Fim do turno',threshold_cross:'Limite atingido',attack_hit:'Ataque confirmado: acerto',attack_miss:'Ataque confirmado: erro',attack_critical:'Ataque confirmado: crítico',critical_received:'Crítico recebido',reaction_used:'Reação utilizada com sucesso'}[trigger]??'Evento automático';
   const label={pv_atual:'PV',pm_atual:'PM',sta_atual:'STA',san_atual:'SAN'}[entry.key]??entry.key;
   const delta=next-actual;
   const escape=foundry.utils.escapeHTML;
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-chat-effect mv-chat-automatic" data-mv-auto-trigger>
     <div class="mv-chat-effect-header"><strong>${escape(entry.item.name)}</strong><small>Multiverso RPG • Habilidade passiva</small></div>
     <div class="mv-chat-effect-body"><div class="mv-auto-trigger-reason"><span class="mv-auto-trigger-dot" aria-hidden="true">✦</span><span>${escape(reason)}</span><span class="mv-auto-trigger-state">Ativado</span></div>
      <div class="mv-auto-change"><div class="mv-auto-change-name">${escape(label)} <small>• ${escape(actor.name)}</small></div><div class="mv-auto-values"><span>${actual}</span><span class="mv-auto-arrow" aria-hidden="true">→</span><strong>${next}</strong></div><div class="mv-auto-delta">${delta>=0?'+':''}${delta} ${escape(label)}</div></div>
      <p class="mv-auto-status">Efeito aplicado automaticamente</p></div></section>`});
  }catch(err){console.error('Multiverso RPG | gatilho automático',err);ui.notifications.error(`Não foi possível aplicar ${entry.item.name} automaticamente.`);}
  finally{queued.delete(token);}
 }
}
export function registerAdvancedMotor(){
 // Quando PV cai. O evento não representa um acerto de ataque; somente dano
 // que realmente reduziu o recurso, inclusive por aplicação manual.
 const before=new WeakMap();
 const seenReactions=new Set();
 Hooks.on('updateActor',(actor,changes)=>{
  if(!game.user?.isGM||actor.type!=='personagem')return;
  const marker=changes?.flags?.[NS]?.reactionSuccessEventV1;
  if(!marker?.nonce)return;
  const stamp=`${actor.uuid}:${marker.nonce}`;
  if(seenReactions.has(stamp))return;
  seenReactions.add(stamp);
  if(seenReactions.size>500)seenReactions.clear();
  if(game.combat?.started&&marker.combatId===game.combat.id)void triggerCombatEvent(actor,'reaction_used').catch(e=>console.error('Multiverso | gatilho reação',e));
 });
 Hooks.on('preUpdateActor',(actor,changes)=>{
  if(!game.user.isGM||actor.type!=='personagem'||!('system' in (changes??{})))return;
  before.set(actor,{...actor.system});
 });
 Hooks.on('updateActor',(actor,changes)=>{
  if(!game.user.isGM||actor.type!=='personagem'||internalUpdates.has(actor)||!('system' in (changes??{})))return;
  const old=before.get(actor);before.delete(actor);
  if(!old)return;
  const after=actor.system;
  if(number(after.pv_atual)<number(old.pv_atual))void performAutomatic(actor,'damage_received',old);
  if(number(after.pv_atual)>number(old.pv_atual))void performAutomatic(actor,'heal_received',old);
  if(['pv_atual','pm_atual','sta_atual','san_atual'].some(k=>number(after[k])!==number(old[k])))void performAutomatic(actor,'threshold_cross',old);
 });
 // O evento de dano causado exige confirmação REAL no card manual.
 // Não inferir acerto de ataque de uma simples rolagem de dados.
 const applied=new Set();
 Hooks.on('updateChatMessage',(message)=>{
  if(!game.user?.isGM)return;
  const entries=message.getFlag?.(NS,'manualDamage')??[];
  for(const entry of entries){
   if(!entry.appliedDamage||!entry.itemUuid)continue;
   const key=`${message.id}:${entry.id}`;
   if(applied.has(key))continue;applied.add(key);
   void (async()=>{try{const item=await fromUuid(entry.itemUuid);if(item?.parent?.documentName==='Actor')await performAutomatic(item.parent,'damage_dealt');}catch(error){console.error('Multiverso | gatilho de dano causado',error);}})();
  }
 });
 const previous=new WeakMap(),turnSeen=new Map();
 Hooks.on('preUpdateCombat',(combat,changes)=>{
  if(!game.user?.isGM||(!('turn' in (changes??{}))&&!('round' in (changes??{}))))return;
  previous.set(combat,{member:combat.combatant,round:combat.round,turn:combat.turn});
 });
 Hooks.on('updateCombat',(combat,changes)=>{
  if(!game.user?.isGM||(!('turn' in (changes??{}))&&!('round' in (changes??{}))))return;
  const old=previous.get(combat);previous.delete(combat);
  if(!old?.member?.actor||!combat.started)return;
  const before=`${combat.id}:${old.round}:${old.turn}:${old.member.id}`;
  const after=`${combat.id}:${combat.round}:${combat.turn}:${combat.combatant?.id}`;
  if(before===after||turnSeen.get(combat.id)===before)return;
  turnSeen.set(combat.id,before);
  void performAutomatic(old.member.actor,'turn_end').catch(error=>console.error('Multiverso | fim de turno',error));
 });

}

// Executado em fila única após a transição de turno, junto com a sustentação.
// Eventos de combate cuja origem é comprovada: confirmação explícita do mestre
// ou ativação concluída de uma Reação. Nunca inferir acerto a partir de dano.
export async function triggerCombatEvent(actor,trigger){
 if(!['attack_hit','attack_miss','attack_critical','critical_received','reaction_used'].includes(trigger))throw Error('Evento de combate não reconhecido.');
 return performAutomatic(actor,trigger);
}
export async function performTurnStartAutomatic(actor){
 return performAutomatic(actor,'turn_start');
}
