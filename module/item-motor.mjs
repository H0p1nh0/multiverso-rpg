// Multiverso v0.2.49 — MOTOR PRÓPRIO DE ITENS (independente do Motor de Efeitos).
// Operações: recuperação, ataque/dano confirmado, conjuração e vínculos de equipamento.
import {applyItemAttackDamage} from './chat-roll-apply.mjs';
import {beginAbilityAction,finishAbilityAction} from './action-economy.mjs';
import {executeNativeEffectTest} from './native-effects.mjs';
import {activateItemEffects,hasActivatedItemEffects} from './item-effect-links.mjs';
import {SKILLS} from './pericia-fields.mjs';
import {conditionDamageBonus} from './condition-mechanics.mjs';

const NS='multiverso-rpg';
const escape=v=>foundry.utils.escapeHTML(String(v??''));
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const own=a=>Boolean(a?.isOwner||game.user?.isGM);
const resourceNames={pv:'Vida',pm:'Mana',sta:'Stamina',san:'Sanidade',fluxoextra:'Fluxo Extra'};
const resourceFields={pv:['pv_atual','pv_max'],pm:['pm_atual','pm_max'],sta:['sta_atual','sta_max'],san:['san_atual','san_max'],fluxoextra:['fluxoextraatual','fluxoextramax']};
export const ITEM_ACTIONS=[['livre','Livre'],['acao','Ação Padrão'],['movimento','Ação de Movimento'],['bonus','Ação Bônus'],['completa','Ação Completa']];
export const ITEM_RESOURCES=[['pv','Vida'],['pm','Mana'],['sta','Stamina'],['san','Sanidade'],['fluxoextra','Fluxo Extra']];
export const ITEM_DAMAGE_TYPES=[['fisico','Físico'],['fogo','Fogo'],['frio','Frio'],['eletrico','Elétrico'],['quimico','Químico'],['psiquico','Psíquico'],['sagrado','Sagrado'],['sombrio','Sombrio'],['verdadeiro','Verdadeiro'],['outro','Outro']];
export const ITEM_KINDS=[['nenhum','Item comum'],['ataque','Arma / ataque'],['recuperacao','Consumível / recuperação'],['conjurar','Item que conjura habilidade'],['utilitario','Uso utilitário']];
const busy=new Set();
export function itemMotorConfig(item){
 const raw=item?.getFlag?.(NS,'itemMotorV1')??{};
 return {
  kind:String(raw.kind||'nenhum'),magical:raw.magical===true,requiresEquip:raw.requiresEquip===true,
  syncRequired:raw.syncRequired===true,synced:raw.synced===true,action:String(raw.action||'acao'),
  attackFormula:String(raw.attackFormula||'d20 + força'),damageFormula:String(raw.damageFormula||'1d6'),
  guaranteedEnabled:raw.guaranteedEnabled===true,guaranteedBase:String(raw.guaranteedBase||'forcanumero'),guaranteedInterval:[1,2,3,4].includes(Number(raw.guaranteedInterval))?Number(raw.guaranteedInterval):4,guaranteedBonus:String(raw.guaranteedBonus??'0'),
  damageType:String(raw.damageType||'fisico'),customDamageType:String(raw.customDamageType||''),critical:String(raw.critical??(raw.criticalMultiplier?`${raw.criticalMultiplier}x`:'20')),criticalMultiplier:Math.max(1,number(raw.criticalMultiplier||2)),
  enableAttack:raw.enableAttack===undefined?raw.kind==='ataque':raw.enableAttack===true,enableRecovery:raw.enableRecovery===undefined?raw.kind==='recuperacao':raw.enableRecovery===true,enableCast:raw.enableCast===undefined?raw.kind==='conjurar':raw.enableCast===true,
  castSources:Array.isArray(raw.castSources)?raw.castSources.filter(x=>typeof x==='string'):raw.castSource?[String(raw.castSource)]:[],
  grantSources:Array.isArray(raw.grantSources)?raw.grantSources.filter(x=>typeof x==='string'):raw.grantSource?[String(raw.grantSource)]:[],
  protections:Array.isArray(raw.protections)?raw.protections.slice(0,12):[],
  rechargeMode:String(raw.rechargeMode||'manual'),rechargeAmount:String(raw.rechargeAmount||'maximo'),rechargeMinutes:Math.max(1,number(raw.rechargeMinutes||60)),rechargeEvent:String(raw.rechargeEvent||''),lastRechargeTime:Math.max(0,number(raw.lastRechargeTime||0)),
  effectTriggers:raw.effectTriggers&&typeof raw.effectTriggers==='object'?raw.effectTriggers:{},
  healFormula:String(raw.healFormula||'2d6'),healResource:String(raw.healResource||'pv'),
  consume:raw.consume===undefined?String(item?.system?.categoria||'')==='consumivel':raw.consume===true,castSource:String(raw.castSource||''),grantSource:String(raw.grantSource||''),effectTrigger:String(raw.effectTrigger||'nenhum'),
  chargesEnabled:raw.chargesEnabled===true,chargesCurrent:Number.isFinite(Number(raw.chargesCurrent))?Math.max(0,Number(raw.chargesCurrent)):0,chargesMax:Number.isFinite(Number(raw.chargesMax))?Math.max(0,Number(raw.chargesMax)):0,chargeCost:Number.isFinite(Number(raw.chargeCost))?Math.max(1,Number(raw.chargeCost)):1,
  note:String(raw.note||'').slice(0,2000)
 };
}
// Aceita nomes do Multiverso (com/sem acento, qualquer caixa) e referências legadas @campo.
const ATTRIBUTES=[['forcanumero','Força'],['agilidadenumero','Agilidade'],['inteligencianumero','Inteligência'],['percepcaonumero','Percepção'],['resistencianumero','Resistência'],['carismanumero','Carisma'],['esquivabonus','Esquiva'],['bloqueiobonus','Bloqueio'],['nivelpersonagem','Nível']];
export const ITEM_FORMULA_FIELDS=[...ATTRIBUTES,...SKILLS.map(([key,label])=>[key,label])];
const formulaAliases=new Map();
for(const [key,label] of ITEM_FORMULA_FIELDS){
 formulaAliases.set(key,key);formulaAliases.set(key.replace(/numero$/,''),key);
 formulaAliases.set(label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll(' ',''),key);
}
for(const [name,key] of [['mana','pm_atual'],['stamina','sta_atual'],['sanidade','san_atual']])formulaAliases.set(name,key);
export function normalizedFormula(value){
 let s=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 if(!s||s.length>180)throw Error('Fórmula vazia ou grande demais.');
 // Permite "estudos ocultos", "Estudos Ocultos" e "Estudos_Ocultos".
 s=s.replace(/\bestudos[ _]+ocultos\b/g,'estudosocultos');
 return s.replace(/@?[a-z_][a-z0-9_]*/gi,(token,offset,whole)=>{
   if(whole[offset-1]==='@')return token;
   const at=token[0]==='@';const key=formulaAliases.get(at?token.slice(1):token);
   if(key)return `@${key}`;
   return token;
 });
}
export function validFormula(value){
 try{
  const s=normalizedFormula(value);
  const refs=[...s.matchAll(/@([a-z_][a-z0-9_]*)/g)].map(x=>x[1]);
  const fields=new Set([...ITEM_FORMULA_FIELDS.map(([key])=>key),'pv_atual','pm_atual','sta_atual','san_atual','fluxoextraatual','fluxoextramax','pv_max','pm_max','sta_max','san_max']);
  if(refs.some(key=>!fields.has(key)))return false;
  const simplified=s.replace(/@[a-z_][a-z0-9_]*/g,'1').replace(/\b\d*d\d+\b/g,'1');
  return /^[0-9+*/().\s-]+$/.test(simplified)&&!s.includes('**')&&!s.includes('//');
 }catch{return false;}
}
export function guaranteedDamageValue(actor,cfg){
 if(!cfg.guaranteedEnabled)return 0;
 const base=String(cfg.guaranteedBase||'forcanumero');
 const keys=new Set(ITEM_FORMULA_FIELDS.map(([k])=>k));
 if(!keys.has(base))throw Error('Atributo ou perícia de dano garantido inválido.');
 // Proporção escolhida pela arma: a cada 4, 3, 2 ou 1 ponto da base.
 const interval=[1,2,3,4].includes(Number(cfg.guaranteedInterval))?Number(cfg.guaranteedInterval):4;
 return Math.max(0,Math.floor(number(actor.system?.[base])/interval));
}
export function parseItemCritical(value){
 const s=String(value??'20').trim().toLowerCase().replace(/\s/g,'');
 // Apenas o valor natural do dado de ataque determina o crítico.
 // "15" = dado adicional com 15+; "1x10" = multiplicador 1 no 10+.
 if(/^\d+$/.test(s)){
  const threshold=Number(s);
  if(threshold>=1&&threshold<=20)return {mode:'extra',multiplier:1,threshold};
 }
 const m=/^(\d+)x(\d+)?$/.exec(s);
 if(m){
  const multiplier=Number(m[1]);
  const threshold=m[2]===undefined?20:Number(m[2]);
  if(Number.isSafeInteger(multiplier)&&multiplier>=1&&multiplier<=99&&threshold>=1&&threshold<=20)
   return {mode:'multiplier',multiplier,threshold};
 }
 throw Error('Crítico inválido. Use 15, 20, 1x10, 2x, 2x17 ou 4x5 (limite natural de 1 a 20, multiplicador de 1 a 99).');
}
export function criticalDamageBonusDie(formula){
 const all=[...normalizedFormula(formula).matchAll(/\b(?:\d*)d(\d+)\b/gi)];
 if(!all.length)return null;
 return `1d${Math.max(...all.map(m=>Number(m[1])))}`;
}
export function validateItemMotor(cfg){
 if(!ITEM_KINDS.some(([x])=>x===cfg.kind))throw Error('Tipo de funcionamento inválido.');
 if(!ITEM_ACTIONS.some(([x])=>x===cfg.action))throw Error('Tipo de ação inválido.');
 if(!['nenhum','uso','acerto'].includes(cfg.effectTrigger))throw Error('Gatilho de efeitos inválido.');
 parseItemCritical(cfg.critical);
 if(!['manual','curto','intensivo','novo_dia','tempo','evento'].includes(cfg.rechargeMode))throw Error('Tipo de recarga inválido.');
 if(cfg.rechargeMode==='tempo'&&(!Number.isFinite(Number(cfg.rechargeMinutes))||Number(cfg.rechargeMinutes)<1))throw Error('Intervalo de recarga inválido.');
 for(const p of cfg.protections||[]){if(!['resistencia','imunidade','vulnerabilidade','bloqueio','esquiva'].includes(p.type))throw Error('Proteção inválida.');if(p.type==='resistencia'&&p.mode==='flat'&&(!Number.isFinite(Number(p.value))||Number(p.value)<0))throw Error('Valor Flat inválido.');if(['resistencia','imunidade','vulnerabilidade'].includes(p.type)&&p.damageType==='outro'&&!String(p.customDamageType||'').trim())throw Error('Informe o tipo de dano personalizado na proteção.');}
 if(cfg.enableAttack&&(!validFormula(cfg.attackFormula)||!validFormula(cfg.damageFormula)))throw Error('Fórmulas de ataque e dano inválidas.');
 if(cfg.enableAttack&&cfg.guaranteedEnabled){if(![1,2,3,4].includes(Number(cfg.guaranteedInterval)))throw Error('Proporção do Dano Garantido inválida.');if(!ITEM_FORMULA_FIELDS.some(([key])=>key===cfg.guaranteedBase))throw Error('Selecione um atributo ou perícia para o Dano Garantido.');if(!validFormula(cfg.guaranteedBonus))throw Error('Quantidade adicional de Dano Garantido inválida.');}
 if(cfg.enableRecovery&&!validFormula(cfg.healFormula))throw Error('Fórmula de recuperação inválida.');
 if(cfg.chargesEnabled&&cfg.rechargeAmount!=='maximo'&&!validFormula(cfg.rechargeAmount))throw Error('Fórmula de recarga inválida.');
 if(cfg.chargesEnabled&&(!Number.isSafeInteger(Number(cfg.chargesMax))||Number(cfg.chargesMax)<1||!Number.isSafeInteger(Number(cfg.chargesCurrent))||Number(cfg.chargesCurrent)<0||Number(cfg.chargesCurrent)>Number(cfg.chargesMax)||!Number.isSafeInteger(Number(cfg.chargeCost))||Number(cfg.chargeCost)<1))throw Error('Configure cargas inteiras válidas: atual, máximo e custo.');
 if(cfg.kind==='ataque'){
  if(!validFormula(cfg.attackFormula)||!validFormula(cfg.damageFormula))throw Error('Fórmula de ataque ou dano inválida.');
  if(!ITEM_DAMAGE_TYPES.some(([x])=>x===cfg.damageType))throw Error('Tipo de dano inválido.');
  if(cfg.damageType==='outro'&&!String(cfg.customDamageType||'').trim())throw Error('Informe o nome do dano personalizado.');
 }
 if(cfg.kind==='recuperacao'){
  if(!validFormula(cfg.healFormula))throw Error('Fórmula de recuperação inválida.');
  if(!ITEM_RESOURCES.some(([x])=>x===cfg.healResource))throw Error('Recurso inválido.');
 }
 return true;
}
export async function saveItemMotor(item,next){
 if(!own(item))throw Error('Sem permissão para configurar este item.');
 const previous=itemMotorConfig(item);
 const cfg={...previous,...next};
 if(cfg.chargesEnabled && (!previous.chargesEnabled||previous.rechargeMode!==cfg.rechargeMode||!previous.lastRechargeTime))cfg.lastRechargeTime=number(game.time?.worldTime);
 validateItemMotor(cfg);
 await item.setFlag(NS,'itemMotorV1',cfg);
 await syncItemGrant(item);
 return cfg;
}
function sourceOptions(actor){
 const candidates=[...(actor?.items??[])].filter(i=>['skill','tecnica'].includes(i.type)&&!
  ['itemEffectSourceV1','manualEffectSourceV1','traitEffectSourceV1','itemCastCloneV1','itemGrantedCloneV1','itemAbilityTemplateV1'].some(k=>i.getFlag?.(NS,k)===true));
 const world=[...(game.items??[])].filter(i=>['skill','tecnica'].includes(i.type));
 const ownTemplates=[...(actor?.items??[])].filter(i=>['skill','tecnica'].includes(i.type)&&i.getFlag?.(NS,'itemAbilityTemplateV1')===true);
 return {candidates,world,ownTemplates};
}
export function availableItemAbilities(actor){
 const {candidates,world,ownTemplates}=sourceOptions(actor);
 return [
  ...candidates.map(i=>({id:`actor:${i.id}`,label:`Personagem • ${i.name} (${i.type==='skill'?'Skill':'Técnica'})`})),
  ...world.map(i=>({id:`world:${i.id}`,label:`Biblioteca • ${i.name} (${i.type==='skill'?'Skill':'Técnica'})`})),
  ...ownTemplates.map(i=>({id:`owned:${i.id}`,label:`Exclusiva do item • ${i.name} (${i.type==='skill'?'Skill':'Técnica'})`}))
 ];
}
function resolveTemplate(actor,ref){
 const [location,id]=String(ref||'').split(':');
 if(!id)return null;
 if(location==='actor'||location==='owned')return actor.items.get(id);
 if(location==='world')return game.items.get(id);
 return null;
}
function grantActive(item,cfg=itemMotorConfig(item)){
 if(!item||item.type!=='equipamento'||number(item.system?.quantidade)<1)return false;
 if(cfg.requiresEquip&&!item.system?.equipado)return false;
 if(cfg.syncRequired&&!cfg.synced)return false;
 return true;
}
const grantLocks=new Set();
const prevCombatants=new Map();
export async function syncItemGrant(item){
 if(item?.type!=='equipamento'||item.parent?.documentName!=='Actor'||!own(item))return;
 const actor=item.parent,key=item.uuid||item.id;
 if(grantLocks.has(key))return;
 grantLocks.add(key);
 try{
  const cfg=itemMotorConfig(item);
  const refs=[...new Set(cfg.grantSources?.length?cfg.grantSources:(cfg.grantSource?[cfg.grantSource]:[]))];
  const should=item.system?.equipado===true&&grantActive(item,cfg);
  const existing=[...actor.items].filter(x=>x.getFlag?.(NS,'itemGrantedCloneV1')===true&&x.getFlag(NS,'originItemId')===item.id);
  const remove=existing.filter(x=>!should||!refs.includes(x.getFlag(NS,'sourceRef'))||existing.some(y=>y!==x&&y.getFlag(NS,'sourceRef')===x.getFlag(NS,'sourceRef')&&y.id<x.id));
  if(remove.length)await actor.deleteEmbeddedDocuments('Item',remove.map(x=>x.id));
  if(should)for(const ref of refs){
   if(existing.some(x=>!remove.includes(x)&&x.getFlag(NS,'sourceRef')===ref))continue;
   const src=resolveTemplate(actor,ref);
   if(!src||!['skill','tecnica'].includes(src.type)){ui.notifications.warn('Habilidade a conceder não encontrada: '+ref);continue;}
   const payload=src.toObject();delete payload._id;
   payload.flags={...foundry.utils.deepClone(src.flags??{}),[NS]:{itemGrantedCloneV1:true,originItemId:item.id,sourceRef:ref}};
   await actor.createEmbeddedDocuments('Item',[payload]);
  }
 }finally{grantLocks.delete(key);}
}
export async function cleanupItemMotor(item){
 const actor=item?.parent;if(actor?.documentName!=='Actor'||!own(actor))return;
 const clones=[...actor.items].filter(x=>['itemGrantedCloneV1','itemCastCloneV1','itemAbilityTemplateV1'].some(k=>x.getFlag(NS,k)===true)&&x.getFlag(NS,'originItemId')===item.id);
 if(clones.length)await actor.deleteEmbeddedDocuments('Item',clones.map(x=>x.id));
}
export function registerItemMotor(){
 Hooks.on('renderChatMessageHTML',bindItemAttackChat);
 Hooks.on('renderChatMessage',bindItemAttackChat);
 Hooks.on('preUpdateCombat',(combat,changes)=>{
   if(changes.turn===undefined&&changes.round===undefined)return;
   prevCombatants.set(combat.id,combat.combatant?.actor?.id??null);
 });
 Hooks.on('updateCombat',(combat,changes)=>{
   if(!game.user?.isGM||(changes.turn===undefined&&changes.round===undefined))return;
   const oldId=prevCombatants.get(combat.id),newId=combat.combatant?.actor?.id;
   prevCombatants.delete(combat.id);
   if(oldId&&oldId!==newId){const old=game.actors?.get(oldId);for(const item of old?.items??[])if(item.type==='equipamento'&&item.system?.equipado)void dispatchItemEvent(item,'fim_turno');}
   if(newId){const current=game.actors?.get(newId);for(const item of current?.items??[])if(item.type==='equipamento'&&item.system?.equipado)void dispatchItemEvent(item,'inicio_turno');}
 });
 Hooks.on('multiversoDescansoCurto',actor=>void rechargeEvent(actor,'curto'));
 Hooks.on('multiversoDescansoLongo',actor=>void rechargeEvent(actor,'intensivo'));
 Hooks.on('multiversoNovoDia',actor=>void rechargeEvent(actor,'novo_dia'));
 Hooks.on('multiversoEventoItem',(actor,evento)=>void rechargeEvent(actor,'evento',String(evento)));
 Hooks.on('updateWorldTime',(_world,dt)=>{
  // Somente mundo de teste / mestre grava as recargas por tempo; evita duplicar entre clientes.
  if(!game.user?.isGM)return;
  for(const actor of game.actors??[])for(const item of actor.items??[]){
   const cfg=itemMotorConfig(item);
   if(!cfg.chargesEnabled||cfg.rechargeMode!=='tempo'||cfg.chargesCurrent>=cfg.chargesMax)continue;
   const now=number(game.time?.worldTime);
   if(now-number(cfg.lastRechargeTime)>=number(cfg.rechargeMinutes)*60)void rechargeEvent(actor,'tempo');
  }
 });
 Hooks.on('multiversoItemGatilho',(item,event)=>void dispatchItemEvent(item,String(event)));
 Hooks.on('updateActor',(actor,changes)=>{
  const current=changes.system?.pv_atual;
  if(current===undefined||!own(actor))return;
  const previous=actor._source?.system?.pv_atual;
  // Foundry updateActor recebe o documento atualizado: não inferir dano de correção manual de PV.
  // Receber dano exige um evento explícito da resolução de dano do motor.
 });
 Hooks.on('updateItem',(item,changes)=>{
  if(item.type!=='equipamento'||item.parent?.documentName!=='Actor'||!own(item))return;
  if('system' in changes||'flags' in changes)void syncItemGrant(item).catch(e=>console.error('Multiverso | Sincronizar habilidade do item',e));
  if(changes.system?.equipado!==undefined){const event=changes.system.equipado?'equipar':'desequipar';void runSpecialEffects(item,itemMotorConfig(item),event);}
 });
 Hooks.on('deleteItem',item=>{
  if(item.type==='equipamento')void cleanupItemMotor(item).catch(e=>console.error('Multiverso | Remover concessão do item',e));
 });
 Hooks.once('ready',()=>{
  for(const actor of game.actors??[])if(own(actor))for(const item of actor.items??[])if(item.type==='equipamento'&&item.getFlag(NS,'itemMotorV1'))void syncItemGrant(item).catch(e=>console.error(e));
 });
}
function checkUse(item,cfg){
 const actor=item?.parent;
 if(item?.type!=='equipamento'||actor?.documentName!=='Actor')throw Error('O item precisa estar na ficha de um personagem.');
 if(!own(actor))throw Error('Você não tem permissão para usar esse item.');
 if(number(item.system?.quantidade)<1)throw Error('Não há unidades deste item.');
 if(!grantActive(item,cfg))throw Error(cfg.syncRequired&&!cfg.synced?'Este item precisa estar sincronizado.':'Este item precisa estar equipado.');
 if(cfg.chargesEnabled&&cfg.chargesCurrent<cfg.chargeCost)throw Error('Cargas insuficientes para usar este item.');
}
async function rollFormula(formula,actor){
 if(!validFormula(formula))throw Error('Fórmula inválida.');
 const data=actor.system?.toObject?.()??{};
 const r=new Roll(normalizedFormula(formula),data);
 await r.evaluate();
 if(!Number.isFinite(Number(r.total)))throw Error('A rolagem não retornou um número válido.');
 return r;
}
const actorOption=(actor,target)=>`<option value="${escape(target.id)}" ${target.id===actor.id?'selected':''}>${escape(target.name)}</option>`;
function allTargets(actor){
 return [...(game.actors?.contents??[])].filter(x=>x.type==='personagem').sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
async function dialog(title,content,callback,buttonLabel){
 return foundry.applications.api.DialogV2.wait({window:{title},content,buttons:[
  {action:'cancel',label:'Cancelar',callback:()=>null},
  {action:'confirm',label:buttonLabel||'Confirmar',default:true,callback:(_e,b,d)=>callback(b?.form??d?.element)}
 ],rejectClose:false});
}
const TRIGGER_TYPES=new Set(['nenhum','uso','acerto','critico','erro','dano','derrota','receber_dano','esquiva','bloqueio','equipar','desequipar','inicio_turno','fim_turno','ultima_carga']);
const itemEventLocks=new Set();
async function runSpecialEffects(item,cfg,event){
 const source=item?.parent?.items?.get(item.getFlag?.(NS,'itemEffectSourceIdV1'))??[...(item.parent?.items??[])].find(i=>i.getFlag?.(NS,'itemEffectSourceV1')&&i.getFlag?.(NS,'originItemId')===item.id)??null;
 const slots=source?.getFlag?.(NS,'itemEffectTriggersV1')??{};
 const indices=Object.entries(slots).filter(([slot,trigger])=>TRIGGER_TYPES.has(trigger)&&trigger===event&&Number.isInteger(Number(slot))&&Number(slot)>=1&&Number(slot)<=5).map(([slot])=>Number(slot));
 // Legacy single-trigger config works until customized per effect, but never in parallel.
 if(!Object.keys(slots).length && cfg.effectTrigger===event && hasActivatedItemEffects(item)){
   try{await activateItemEffects(item,{skipAction:true});}catch(error){console.error('Multiverso | Efeito especial do item',error);ui.notifications.error(error.message);}return;
 }
 if(!indices.length||!source||!hasActivatedItemEffects(item))return;
 const key=`${item.uuid}:${event}`;
 if(itemEventLocks.has(key))return;
 itemEventLocks.add(key);
 try{await activateItemEffects(item,{skipAction:true,onlySlots:indices});}
 catch(error){console.error('Multiverso | Gatilho do item',event,error);ui.notifications.error('Não foi possível executar o efeito do item: '+error.message);}
 finally{itemEventLocks.delete(key);}
}
export async function dispatchItemEvent(item,event){
 if(item?.type!=='equipamento'||item.parent?.documentName!=='Actor'||!own(item))return;
 const cfg=itemMotorConfig(item);
 if(!grantActive(item,cfg))return;
 await runSpecialEffects(item,cfg,event);
}
export function itemDefenseBonus(actor,type){
 return [...(actor?.items??[])].filter(i=>i.type==='equipamento'&&i.system?.equipado&&number(i.system?.quantidade)>0)
 .filter(i=>{const cfg=itemMotorConfig(i);return !cfg.syncRequired||cfg.synced;})
 .flatMap(i=>itemMotorConfig(i).protections||[]).filter(p=>p.type===type).reduce((sum,p)=>sum+number(p.value),0);
}
async function consumeItem(item,cfg){
 if(cfg.chargesEnabled){
  const latest=itemMotorConfig(item);
  if(latest.chargesCurrent<cfg.chargeCost)throw Error('Cargas mudaram durante o uso. Confira o item.');
  const remains=latest.chargesCurrent-cfg.chargeCost;
  await item.setFlag(NS,'itemMotorV1',{...latest,chargesCurrent:remains});
  if(remains===0)await runSpecialEffects(item,cfg,'ultima_carga');
 }
 if(!cfg.consume)return;
 const fresh=item.parent.items.get(item.id);
 if(!fresh||number(fresh.system?.quantidade)<1)throw Error('Quantidade do item foi alterada; confira inventário.');
 await fresh.update({'system.quantidade':number(fresh.system.quantidade)-1});
}
function card(item,action,body){
 return `<section class="mv-item-motor-chat" style="background:linear-gradient(145deg,#211a15,#12131a);border:1px solid #b28b50;border-radius:12px;padding:14px;color:#f2dfbd;">
 <div style="display:flex;gap:11px;align-items:center;border-bottom:1px solid #7a5c38;padding-bottom:10px"><img src="${escape(item.img||'icons/svg/item-bag.svg')}" alt="" style="width:48px;height:48px;border:1px solid #ad8448;border-radius:8px;object-fit:cover"><div><small style="color:#cbb08a">${escape(action)} • ${escape(item.parent.name)}</small><h3 style="color:#f4d493;font:700 20px Georgia,serif;margin:2px 0">${escape(item.name)}</h3></div></div>
 <div style="margin-top:11px;line-height:1.55">${body}</div></section>`;
}
async function say(item,action,body,{rolls=[]}={}){await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:item.parent}),content:card(item,action,body),rolls});}
async function useRecovery(item,cfg){
 const actor=item.parent,targets=allTargets(actor);
 const result=await dialog(`Usar ${item.name}`,`<div class="mv-item-dialog"><h3><i class="fa-solid fa-flask"></i> Recuperar ${escape(resourceNames[cfg.healResource])}</h3><p>Rolagem <strong>${escape(cfg.healFormula)}</strong>. Recuperação limitada ao máximo do recurso.</p><label>Alvo<select name="target">${targets.map(x=>actorOption(actor,x)).join('')}</select></label></div>`,form=>({id:form.querySelector('[name="target"]')?.value}),'Usar item');
 if(!result?.id)return false;
 const target=game.actors.get(result.id);
 if(!target||!own(target))throw Error('Para recuperar recursos automaticamente você precisa controlar o alvo.');
 if(cfg.healResource==='fluxoextra'&&target.system?.fluxoextraativo!==true)throw Error('O alvo não está usando Fluxo Extra.');
 const reservation=beginAbilityAction(actor,cfg.action);
 if(!reservation.ok)throw Error(reservation.reason);
 let roll,done=false,before,after;
 try{
  roll=await rollFormula(cfg.healFormula,actor);
  const amount=Math.max(0,Math.floor(Number(roll.total)));
  const [cur,max]=resourceFields[cfg.healResource];
  before=number(target.system?.[cur]);after=Math.min(number(target.system?.[max]),before+amount);
  await target.update({[`system.${cur}`]:after});done=true;
 }finally{
  const debit=await finishAbilityAction(actor,reservation,{success:done});
  if(done&&!debit.ok)console.error('Multiverso | Falha ao registrar ação da poção',debit);
 }
 const amount=Math.max(0,Math.floor(Number(roll.total)));
 await say(item,'Recuperação',`<p>${escape(item.system?.descricao||'Sem descrição cadastrada.')}</p><div style="border-top:1px solid #6b5436;padding-top:9px"><p><strong>${escape(target.name)}</strong> recuperou <b>${after-before}</b> de ${escape(resourceNames[cfg.healResource])} (${before} → ${after}).</p><p>Fórmula: <b>${escape(cfg.healFormula)}</b> • Total rolado: <b>${amount}</b> • Recuperação aplicada: <b>${after-before}</b>.</p><small>Dados: ${escape(roll.dice?.flatMap(d=>d.results?.filter(r=>r.active!==false).map(r=>r.result)??[]).join(', ')||'sem dados')} • Limite máximo respeitado.</small></div>`,{rolls:[roll]});
 await runSpecialEffects(item,cfg,'uso');
 return true;
}
// Um ataque permanece pendente no próprio cartão do chat até a mesa resolver
// Esquiva/Bloqueio. Somente dono do atacante ou mestre pode avançar o cartão.
const itemAttackLocks=new Set();
function attackCardMarkup(item,state){
 const header=state.status==='pending'?'Ataque declarado':state.status==='miss'?'Ataque defendido':'Ataque confirmado';
 const description=String(item.system?.descricao||'').trim();
 const targetName=state.targetName?`<span>Alvo: <strong>${escape(state.targetName)}</strong></span>`:'<span>Sem alvo selecionado</span>';
 const natural=state.natural!==null&&Number.isFinite(Number(state.natural))?`<span>Dado natural: <b>${number(state.natural)}</b></span>`:'';
 const dice=(values)=>values?.length?`<small style="color:#ddc39a">Dados: ${escape(values.join(' + '))}</small>`:'';
 let action='';
 if(state.status==='pending')action=`<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px"><button type="button" data-mv-item-attack-roll style="flex:1;min-width:115px;background:linear-gradient(#675030,#3a291b);border:1px solid #d4ac6a;border-radius:7px;padding:9px;color:#fff1cf;font-weight:700;cursor:pointer">⚔ Rolar Dano</button><button type="button" data-mv-item-attack-miss style="flex:1;min-width:115px;border:1px solid #977a58;background:#241e20;border-radius:7px;padding:9px;color:#efdbb4;cursor:pointer">Descartar Ataque</button></div><small style="display:block;color:#bda37e;margin-top:8px">Aguarde a confirmação do acerto após Esquiva ou Bloqueio. O dano não será rolado sozinho.</small>`;
 else if(state.status==='miss')action='<p style="color:#d5b58b;margin:12px 0 0"><b>Ataque defendido ou errado.</b> Nenhum dano foi rolado.</p>';
 else if(state.status==='hit'){
   const res=state.damageResult||{};
   const applied=state.damageApplied===true;
   action=`<div style="border-top:1px solid #68503a;margin-top:12px;padding-top:11px"><strong style="display:block;color:#f3cf8d;margin-bottom:8px">DANO ${escape(res.critical?'CRÍTICO':'CONFIRMADO')}</strong>
   <div class="mv-item-roll-result" data-mv-item-apply-damage role="button" tabindex="${applied?'-1':'0'}" aria-label="${applied?'Dano já aplicado':'Aplicar dano na ficha'}" title="${applied?'Dano já aplicado':'Clique ou botão direito para aplicar dano na ficha'}" style="border:1px solid #957345;border-radius:8px;padding:8px 10px;background:#17161b;cursor:${applied?'default':'pointer'}">
     <div style="color:#e6cc9d;font:600 12px sans-serif;margin-bottom:6px">${escape(res.evaluatedFormula||res.damageFormula||'Dano')}</div>
     <div style="color:#fff0cf;background:#28231f;border:1px solid #80603d;border-radius:5px;text-align:center;font:700 23px Georgia,serif;padding:6px">${number(res.total)}</div>
   </div>
   <div style="margin:9px 0;color:#e5d1a9;font:12px/1.5 sans-serif">${res.critical?`<span>${escape(res.criticalDetail||'Crítico')}</span>`:''}${res.guaranteed?`<span> • Dano Garantido +${number(res.guaranteed)}</span>`:''}${res.critical||res.guaranteed?'<br/>':''}Tipo: <b>${escape(res.type||'Físico')}</b>${state.targetName?` • Alvo: <b>${escape(state.targetName)}</b>`:''}</div>
   ${dice(res.dice)}
   ${applied?`<p style="margin:9px 0 0;color:#a9d9a7;font-weight:bold">✓ Dano aplicado na ficha${state.appliedTargets?.length?`: ${escape(state.appliedTargets.join(', '))}`:''}.</p>`:`<button type="button" data-mv-item-attack-apply style="width:100%;margin-top:10px;padding:9px;border:1px solid #c49d67;border-radius:7px;background:linear-gradient(#5a4227,#2d211b);color:#f6deb2;font-weight:bold;cursor:pointer">Aplicar Dano na Ficha</button><small style="display:block;color:#bea681;margin-top:5px">Ou clique com o botão direito no resultado. Resistências e PV temporários são calculados na aplicação.</small>`}</div>`;
 }
 return card(item,header,`<div style="display:grid;gap:6px"><p style="margin:0;color:#ead7b3">${escape(description||'Sem descrição cadastrada.')}</p><div style="border-top:1px solid #6a5134;margin-top:6px;padding-top:9px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Rolagem: <b>${escape(state.attackFormula)}</b></span>${targetName}</div><div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><strong style="color:#f0d09c">Ataque</strong><strong style="font:700 26px Georgia,serif;color:#f6d495">${number(state.attackTotal)}</strong></div>${natural}${dice(state.attackDice)}</div>${action}`)
 .replace('<section class="mv-item-motor-chat"','<section data-mv-item-attack-card class="mv-item-motor-chat"');
}
async function resolveAttackCard(message,operation){
 const key=message?.id;
 if(!key||itemAttackLocks.has(key))return;
 const data=message.getFlag(NS,'itemAttackCardV1');
 if(!data||data.status!=='pending')return;
 if(!game.user?.isGM&&message.author?.id!==game.user?.id){ui.notifications.warn('Somente quem fez o ataque ou o mestre pode resolver esta rolagem.');return;}
 const item=await fromUuid(data.itemUuid);
 const actor=item?.parent;
 if(!item||!actor||!own(actor)){ui.notifications.warn('A origem deste ataque não está mais disponível para você.');return;}
 itemAttackLocks.add(key);
 try{
  const current=message.getFlag(NS,'itemAttackCardV1');
  if(current?.status!=='pending')return;
  const cfg=current.attackConfig;
  if(!cfg)throw Error('Configuração deste ataque não encontrada.');
  if(operation==='miss'){
   const next={...current,status:'miss'};
   await message.update({content:attackCardMarkup(item,next),[`flags.${NS}.itemAttackCardV1`]:next});
   await runSpecialEffects(item,itemMotorConfig(item),'erro');
   return;
  }
  if(operation!=='damage')return;
  const criticalRule=parseItemCritical(cfg.critical);
  const natural=current.natural;
  const critical=Number.isInteger(natural)&&natural>=criticalRule.threshold;
  const damage=await rollFormula(cfg.damageFormula,actor);
  const base=Math.max(0,Math.floor(Number(damage.total)));
  let extraRoll=null;
  if(critical&&criticalRule.mode==='extra'){
   const die=criticalDamageBonusDie(cfg.damageFormula);
   if(die)extraRoll=await rollFormula(die,actor);
  }
  const computed=critical&&criticalRule.mode==='multiplier'?Math.floor(base*criticalRule.multiplier):base+Math.max(0,number(extraRoll?.total));
  const bonusRoll=cfg.guaranteedEnabled?await rollFormula(cfg.guaranteedBonus,actor):null;
  const guaranteed=cfg.guaranteedEnabled?Math.max(0,Math.floor(guaranteedDamageValue(actor,cfg)+number(bonusRoll?.total))):0;
  const conditionBonus=conditionDamageBonus(actor,{direction:'caused'});
  const total=Math.max(0,computed+guaranteed+conditionBonus);
  // O cartão só mostra o valor rolado. A aplicação de dano acontece depois, ao clicar
  // sobre o resultado, usando a rotina comum de dano no chat (inclui PV temporário).
  const damageType=cfg.damageType==='outro'?cfg.customDamageType:cfg.damageType;
  const criticalDetail=critical?(criticalRule.mode==='multiplier'?`Crítico ×${criticalRule.multiplier} (${criticalRule.threshold}+)`:`Crítico: +${number(extraRoll?.total)} no dado adicional`):'';
  const next={...current,status:'hit',damageApplied:false,damageResult:{damageFormula:cfg.damageFormula,evaluatedFormula:damage.formula||cfg.damageFormula,base,total,guaranteed,conditionBonus,critical,criticalDetail,type:damageType,dice:damage.dice?.flatMap(d=>d.results?.filter(r=>r.active!==false).map(r=>r.result)??[])??[]}};
  const rolls=[...(message.rolls??[]),damage,...[extraRoll,bonusRoll].filter(Boolean)];
  await message.update({content:attackCardMarkup(item,next),rolls, [`flags.${NS}.itemAttackCardV1`]:next});
  await runSpecialEffects(item,itemMotorConfig(item),'acerto');
  if(critical)await runSpecialEffects(item,itemMotorConfig(item),'critico');
 }catch(error){console.error('Multiverso | Resolver ataque no chat',error);ui.notifications.error(error?.message??'Não foi possível resolver o ataque.');}
 finally{itemAttackLocks.delete(key);}
}
// Resultado de ataque usa a MESMA aplicação de dano por chat. Nunca aplica automaticamente;
// confirmação e proteção permanecem na rotina já aprovada do Multiverso.
async function applyAttackCardDamage(message){
 const key=message?.id;
 if(!key||itemAttackLocks.has(key))return;
 const data=message.getFlag(NS,'itemAttackCardV1');
 if(data?.status!=='hit'||data.damageApplied===true)return;
 const value=Number(data.damageResult?.total);
 if(!Number.isSafeInteger(value)||value<0)throw Error('Dano do cartão inválido.');
 itemAttackLocks.add(key);
 try{
  const current=message.getFlag(NS,'itemAttackCardV1');
  if(current?.status!=='hit'||current.damageApplied===true)return;
  const target=current.targetUuid?await fromUuid(current.targetUuid):null;
  if(current.targetUuid&&!target){ui.notifications.warn('Alvo do ataque não encontrado. Nenhum dano aplicado.');return;}
  const result=await applyItemAttackDamage(value,{target,damageType:current.damageResult.type});
  if(!result||!['damage','half'].includes(result.operation)||result.resource!=='pv')return;
  // Persistir bloqueio de uso ANTES de processar eventos para evitar reaplicações.
  const item=await fromUuid(current.itemUuid);
  const names=result.changed.map(x=>x.actor.name);
  const next={...current,damageApplied:true,appliedTargets:names};
  await message.update({
   content:item?attackCardMarkup(item,next):message.content,
   [`flags.${NS}.itemAttackCardV1`]:next
  });
  for(const change of result.changed){
   const actor=change.actor;
   if(change.appliedValue>0){
    for(const defense of actor.items??[]){
     if(defense.type==='equipamento'&&defense.system?.equipado){
      try{await dispatchItemEvent(defense,'receber_dano');}catch(err){console.error('Multiverso | gatilho ao receber dano',err);}
     }
    }
   }
  }
  if(item){
   const cfg=itemMotorConfig(item);
   if(result.changed.some(x=>x.appliedValue>0))await runSpecialEffects(item,cfg,'dano');
   if(result.changed.some(x=>number(x.actor.system?.pv_atual)<=0&&x.appliedValue>0))await runSpecialEffects(item,cfg,'derrota');
  }
 }catch(error){console.error('Multiverso | Aplicação de dano do item',error);ui.notifications.error(error?.message??'Falha ao aplicar dano. Confira a ficha antes de tentar novamente.');}
 finally{itemAttackLocks.delete(key);}
}
function bindItemAttackChat(message,html){
 const root=html instanceof HTMLElement?html:(html?.[0]??html);
 if(!root?.querySelectorAll)return;
 addNativeItemActions(message,root);
 if(!message.getFlag?.(NS,'itemAttackCardV1'))return;
 for(const cardElement of root.querySelectorAll('[data-mv-item-attack-card]')){
  for(const [attr,op] of [['data-mv-item-attack-roll','damage'],['data-mv-item-attack-miss','miss']]){
   const button=cardElement.querySelector(`[${attr}]`);
   if(!button||button.dataset.mvItemReady==='1')continue;
   button.dataset.mvItemReady='1';
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await resolveAttackCard(message,op);}finally{if(button.isConnected)button.disabled=false;}
   });
  }
  for(const el of cardElement.querySelectorAll('[data-mv-item-attack-apply],[data-mv-item-apply-damage]')){
   if(message.getFlag(NS,'itemAttackCardV1')?.damageApplied===true)continue;
   if(el.dataset.mvItemApplyReady==='1')continue;
   el.dataset.mvItemApplyReady='1';
   el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();void applyAttackCardDamage(message);});
   el.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();void applyAttackCardDamage(message);});
   el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void applyAttackCardDamage(message);}});
  }
 }
}
// Novo fluxo do chat (v0.2.48): declaração -> rolagem nativa de ATAQUE ->
// botão ROLAR DANO -> rolagem nativa de DANO. Nunca combinar as duas rolagens.
// As mensagens antigas (itemAttackCardV1) continuam legíveis e aplicáveis.
function attackIntroHtml(item){
 const description=String(item.system?.descricao||'').trim();
 return card(item,'Ataque',`<p style="margin:0 0 8px">${escape(description||'Sem descrição cadastrada.')}</p><p style="color:#d8bd91;margin:0 0 12px">Clique para fazer a rolagem de ataque. O dano ficará disponível depois do resultado.</p><button type="button" data-mv-item-attack-start style="width:100%;background:linear-gradient(#62482b,#372719);color:#f7d9a2;border:1px solid #cba364;border-radius:7px;padding:10px;font-weight:700;cursor:pointer">⚔ Rolar Ataque</button>`).replace('<section class="mv-item-motor-chat"','<section data-mv-item-attack-intro class="mv-item-motor-chat"');
}
async function beginNativeItemAttack(message){
 const id=message?.id;
 if(!id||itemAttackLocks.has(id))return;
 const state=message.getFlag(NS,'itemAttackPromptV2');
 if(state?.status!=='ready')return;
 if(!game.user?.isGM&&message.author?.id!==game.user?.id)throw Error('Somente o atacante ou o mestre pode rolar o ataque.');
 const item=await fromUuid(state.itemUuid);
 const actor=item?.parent;
 if(!item||!actor||!own(actor))throw Error('O item de origem não está disponível.');
 const cfg=itemMotorConfig(item);
 checkUse(item,cfg);
 itemAttackLocks.add(id);
 try{
  const current=message.getFlag(NS,'itemAttackPromptV2');
  if(current?.status!=='ready')return;
  const reservation=beginAbilityAction(actor,cfg.action);
  if(!reservation.ok)throw Error(reservation.reason);
  let attack,rolled=false;
  try{attack=await rollFormula(cfg.attackFormula,actor);rolled=true;}
  finally{
   const receipt=await finishAbilityAction(actor,reservation,{success:rolled});
   if(rolled&&!receipt.ok)console.error('Multiverso | Falha ao contabilizar ação de ataque',receipt);
  }
  const naturalResult=attack.dice?.find(d=>number(d.faces)===20)?.results?.find(r=>r.active!==false)?.result;
  const natural=naturalResult===undefined?null:Number(naturalResult);
  const attackState={status:'pending',itemUuid:item.uuid,targetUuid:current.targetUuid||'',targetName:current.targetName||'',attackFormula:cfg.attackFormula,attackTotal:number(attack.total),natural:Number.isInteger(natural)?natural:null,attackConfig:{critical:cfg.critical,damageFormula:cfg.damageFormula,damageType:cfg.damageType,customDamageType:cfg.customDamageType,guaranteedEnabled:cfg.guaranteedEnabled,guaranteedBase:cfg.guaranteedBase,guaranteedInterval:cfg.guaranteedInterval,guaranteedBonus:cfg.guaranteedBonus}};
  // Um cartão por item/ataque: a rolagem é renderizada pelo próprio Roll do
  // Foundry DENTRO do cartão de apresentação que já existe no chat.
  // A segunda mensagem, separada, será reservada somente ao dano.
  const desc=String(item.system?.descricao||'').trim();
  const renderedAttack=await attack.render();
  const nextPrompt={...current,status:'rolled',attackMessageId:message.id};
  const attackBody=`<p class="mv-item-attack-desc">${escape(desc||'Sem descrição cadastrada.')}</p>${current.targetName?`<p class="mv-item-attack-target">Alvo: <b>${escape(current.targetName)}</b></p>`:''}<div class="mv-item-attack-native-roll"><span class="mv-item-attack-roll-label">ROLAGEM DE ATAQUE</span>${renderedAttack}</div>`;
  await message.update({
    content:card(item,'Ataque',attackBody),
    rolls:[attack],
    [`flags.${NS}.itemAttackPromptV2`]:nextPrompt,
    [`flags.${NS}.itemAttackRollV2`]:attackState
  });
  // Unidades e cargas somente são consumidas quando o ataque é rolado.
  try{await consumeItem(item,cfg);}catch(error){console.error('Multiverso | Consumo após ataque',error);ui.notifications.error('Ataque rolado, mas não foi possível registrar o consumo. Confira o item antes de usar novamente.');}
  await runSpecialEffects(item,cfg,'uso');
 }finally{itemAttackLocks.delete(id);}
}
function damageExpression(cfg,actor,natural){
 const rule=parseItemCritical(cfg.critical);
 const critical=Number.isInteger(natural)&&natural>=rule.threshold;
 // A rolagem inteira é nativa: valores dos dados, bônus, críticos e dano
 // garantido entram em UMA fórmula da mensagem de dano, distinta do ataque.
 let formula=`max(0, floor((${normalizedFormula(cfg.damageFormula)})))`;
 if(critical&&rule.mode==='multiplier')formula=`(${formula}) * ${rule.multiplier}`;
 if(critical&&rule.mode==='extra'){
  const extra=criticalDamageBonusDie(cfg.damageFormula);
  if(extra)formula+=` + (${extra})`;
 }
 let guaranteed=0;
 if(cfg.guaranteedEnabled){
  guaranteed=guaranteedDamageValue(actor,cfg);
  formula+=` + max(0, floor(${guaranteed} + (${normalizedFormula(cfg.guaranteedBonus)})))`;
 }
 return {formula,critical,rule,guaranteed};
}
async function resolveNativeItemAttack(message,operation){
 const id=message?.id;
 if(!id||itemAttackLocks.has(id))return;
 const state=message.getFlag(NS,'itemAttackRollV2');
 if(state?.status!=='pending')return;
 if(!game.user?.isGM&&message.author?.id!==game.user?.id)throw Error('Somente o atacante ou o mestre pode decidir o resultado.');
 const item=await fromUuid(state.itemUuid),actor=item?.parent;
 if(!item||!actor||!own(actor))throw Error('A origem deste ataque não está disponível.');
 itemAttackLocks.add(id);
 try{
  const current=message.getFlag(NS,'itemAttackRollV2');
  if(current?.status!=='pending')return;
  if(operation==='miss'){
   await message.setFlag(NS,'itemAttackRollV2',{...current,status:'miss'});
   await runSpecialEffects(item,itemMotorConfig(item),'erro');
   return;
  }
  if(operation!=='damage')return;
  const cfg=current.attackConfig;
  if(!cfg)throw Error('Configuração do ataque não encontrada.');
  const info=damageExpression(cfg,actor,current.natural);
  const damage=new Roll(info.formula,actor.system?.toObject?.()??{});
  await damage.evaluate();
  const total=Math.max(0,Math.floor(Number(damage.total)));
  if(!Number.isFinite(total))throw Error('A rolagem de dano retornou um valor inválido.');
  const damageType=cfg.damageType==='outro'?cfg.customDamageType:cfg.damageType;
  const flavor=`<section class="mv-item-damage-flavor"><strong>Dano — ${escape(item.name)}</strong><small>Fórmula: ${escape(cfg.damageFormula)} • Tipo: ${escape(damageType||'Físico')}</small>${info.critical?`<small>Crítico ${info.rule.mode==='multiplier'?`×${info.rule.multiplier} (natural ${info.rule.threshold}+)`:'(dado adicional)'}</small>`:''}${cfg.guaranteedEnabled?`<small>Dano Garantido: +${info.guaranteed} na base (${[1,2,3,4].includes(Number(cfg.guaranteedInterval))?cfg.guaranteedInterval:4} ponto(s) por +1), mais ${escape(cfg.guaranteedBonus)}</small>`:''}</section>`;
  const native=await damage.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor,flags:{[NS]:{itemDamageRollV2:{status:'ready',attackMessageId:message.id,itemUuid:item.uuid,targetUuid:current.targetUuid||'',damageType,total,critical:info.critical,formulaLabel:`${cfg.damageFormula}${cfg.guaranteedEnabled?' + Dano Garantido':''}`}}}});
  if(!native)throw Error('Não foi possível publicar a rolagem de dano.');
  await message.setFlag(NS,'itemAttackRollV2',{...current,status:'damage',damageMessageId:native.id});
  await runSpecialEffects(item,itemMotorConfig(item),'acerto');
  if(info.critical)await runSpecialEffects(item,itemMotorConfig(item),'critico');
 }finally{itemAttackLocks.delete(id);}
}
async function applyNativeItemDamage(message){
 const id=message?.id;
 if(!id||itemAttackLocks.has(id))return;
 const data=message.getFlag(NS,'itemDamageRollV2');
 if(data?.status!=='ready')return;
 if(!game.user?.isGM&&message.author?.id!==game.user?.id)throw Error('Somente o atacante ou o mestre pode aplicar este dano.');
 const item=await fromUuid(data.itemUuid);
 if(!item||!own(item.parent))throw Error('A origem do dano não está acessível.');
 itemAttackLocks.add(id);
 try{
  const current=message.getFlag(NS,'itemDamageRollV2');
  if(current?.status!=='ready')return;
  const target=current.targetUuid?await fromUuid(current.targetUuid):null;
  if(current.targetUuid&&!target)throw Error('O alvo original não foi encontrado.');
  const result=await applyItemAttackDamage(current.total,{target,damageType:current.damageType});
  if(!result||!['damage','half'].includes(result.operation)||result.resource!=='pv')return;
  const changed=result.changed??[];
  await message.setFlag(NS,'itemDamageRollV2',{...current,status:'applied',appliedTargets:changed.map(x=>x.actor.name)});
  for(const change of changed){
   if(change.appliedValue>0)for(const defense of change.actor.items??[]){
    if(defense.type==='equipamento'&&defense.system?.equipado){
     try{await dispatchItemEvent(defense,'receber_dano');}catch(err){console.error('Multiverso | Gatilho receber dano',err);}
    }
   }
  }
  const cfg=itemMotorConfig(item);
  if(changed.some(x=>x.appliedValue>0))await runSpecialEffects(item,cfg,'dano');
  if(changed.some(x=>number(x.actor.system?.pv_atual)<=0&&x.appliedValue>0))await runSpecialEffects(item,cfg,'derrota');
 }finally{itemAttackLocks.delete(id);}
}
function addNativeItemActions(message,root){
 const attack=message.getFlag?.(NS,'itemAttackRollV2');
 const damage=message.getFlag?.(NS,'itemDamageRollV2');
 const prompt=message.getFlag?.(NS,'itemAttackPromptV2');
 if(!prompt&&!attack&&!damage)return;
 const host=root.querySelector('.message-content')??root.querySelector('.message-body')??root;
 if(prompt?.status==='ready'){
  const button=root.querySelector('[data-mv-item-attack-start]');
  if(button&&!button.dataset.mvBound){
   button.dataset.mvBound='1';
   button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await beginNativeItemAttack(message);}catch(err){console.error('Multiverso | Rolar ataque',err);ui.notifications.error(err.message);}finally{if(button.isConnected)button.disabled=false;}
   });
  }
  return;
 }
 if(attack){
  if(root.querySelector('.mv-item-native-actions'))return;
  const panel=document.createElement('div');
  panel.className='mv-item-native-actions';
  if(attack.status==='pending')panel.innerHTML=`<button type="button" data-mv-native-damage>⚔ Rolar Dano</button><button type="button" class="mv-native-discard" data-mv-native-discard>Descartar Ataque</button><small>Depois da Esquiva/Bloqueio, role o dano somente se acertou.</small>`;
  else if(attack.status==='miss')panel.innerHTML='<small>Ataque errado ou defendido — sem dano.</small>';
  else if(attack.status==='damage')return; // Não repetir aviso desnecessário sob o cartão de ataque.
  else panel.innerHTML='';
  host.append(panel);
  for(const [selector,op] of [['[data-mv-native-damage]','damage'],['[data-mv-native-discard]','miss']]){
   const button=panel.querySelector(selector);
   button?.addEventListener('click',async()=>{
    button.disabled=true;
    try{await resolveNativeItemAttack(message,op);}catch(err){console.error('Multiverso | Resolver ataque',err);ui.notifications.error(err.message);}finally{if(button.isConnected)button.disabled=false;}
   });
  }
  root.addEventListener('contextmenu',event=>{
   if(!event.target?.closest?.('.dice-roll'))return;
   event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
   ui.notifications.info('Essa é a rolagem de ATAQUE, não de dano.');
  },true);
  return;
 }
 if(damage){
  // Apenas a apresentação usa a fórmula amigável. O Roll nativo mantém a
  // fórmula real, dados e resultado para conferência e aplicação de dano.
  const visibleFormula=root.querySelector('.dice-roll .dice-formula');
  if(visibleFormula && damage.formulaLabel){
    if(!visibleFormula.dataset.mvTechnicalFormula)visibleFormula.dataset.mvTechnicalFormula=visibleFormula.textContent;
    visibleFormula.title='Fórmula interna: '+visibleFormula.dataset.mvTechnicalFormula;
    visibleFormula.textContent=damage.formulaLabel;
  }
  if(root.querySelector('.mv-item-native-actions'))return;
  const panel=document.createElement('div');
  panel.className='mv-item-native-actions';
  if(damage.status==='ready')panel.innerHTML='<button type="button" data-mv-native-apply>Aplicar Dano na Ficha</button><small>Também pode clicar com o botão direito no resultado do dano.</small>';
  else panel.innerHTML='<small>✓ Dano já aplicado na ficha.</small>';
  host.append(panel);
  const act=async()=>{
   const button=panel.querySelector('[data-mv-native-apply]');
   if(button)button.disabled=true;
   try{await applyNativeItemDamage(message);}catch(err){console.error('Multiverso | Aplicar dano',err);ui.notifications.error(err.message);}finally{if(button?.isConnected)button.disabled=false;}
  };
  panel.querySelector('[data-mv-native-apply]')?.addEventListener('click',act);
  root.addEventListener('contextmenu',event=>{
   if(!event.target?.closest?.('.dice-roll'))return;
   event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
   if(damage.status==='ready')void act();
  },true);
 }
}
async function useAttack(item,cfg){
 // Declarar o ataque NÃO rola dados e NÃO gasta ação. Primeiro o jogador
 // recebe o botão Rolar Ataque. Depois vêm dois cards de rolagem nativos.
 const actor=item.parent;
 const targets=[...(game.user?.targets??[])];
 const selected=targets.length===1?targets[0]?.actor:null;
 const state={status:'ready',itemUuid:item.uuid,targetUuid:selected?.uuid||'',targetName:selected?.name||''};
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:attackIntroHtml(item),flags:{[NS]:{itemAttackPromptV2:state}}});
 return true;
}
async function castSource(item,cfg,refOverride=null){
 const actor=item.parent;
 const ref=refOverride||cfg.castSource;
 const base=resolveTemplate(actor,ref);
 if(!base||!['skill','tecnica'].includes(base.type))throw Error('Nenhuma Skill/Técnica válida vinculada a Conjurar.');
 if(base.parent?.id===actor.id)return base;
 // Origem técnica oculta no personagem, preservada enquanto o item existir.
 let clone=[...actor.items].find(x=>x.getFlag(NS,'itemCastCloneV1')===true&&x.getFlag(NS,'originItemId')===item.id&&x.getFlag(NS,'sourceRef')===ref);
 if(!clone){
  const payload=base.toObject();delete payload._id;
  payload.flags={...foundry.utils.deepClone(base.flags??{}),[NS]:{itemCastCloneV1:true,originItemId:item.id,sourceRef:ref}};
  [clone]=await actor.createEmbeddedDocuments('Item',[payload]);
 }
 return clone;
}
export async function rechargeItemAmount(item,{manual=false}={}){
 const cfg=itemMotorConfig(item);
 if(!cfg.chargesEnabled||cfg.chargesCurrent>=cfg.chargesMax)return false;
 if(!own(item))return false;
 const die=cfg.rechargeAmount==='maximo'?null:await rollFormula(cfg.rechargeAmount,item.parent);
 const amount=die===null?cfg.chargesMax:Math.max(0,Math.floor(Number(die.total)));
 const latest=itemMotorConfig(item);
 await item.setFlag(NS,'itemMotorV1',{...latest,chargesCurrent:Math.min(latest.chargesMax,latest.chargesCurrent+amount),lastRechargeTime:number(game.time?.worldTime)});
 if(die)await die.toMessage({speaker:ChatMessage.getSpeaker({actor:item.parent}),flavor:`Recarga ${item.name}`});
 return true;
}
const itemRechargeLocks=new Set();
async function rechargeEvent(actor,mode,eventName=''){
 if(!actor?.items||!own(actor))return;
 for(const item of actor.items){
  if(item.type!=='equipamento')continue;
  const cfg=itemMotorConfig(item);
  if(!cfg.chargesEnabled||cfg.rechargeMode!==mode||(mode==='evento'&&cfg.rechargeEvent!==eventName))continue;
  const key=item.uuid;
  if(itemRechargeLocks.has(key))continue;
  itemRechargeLocks.add(key);
  try{await rechargeItemAmount(item);}catch(e){console.error('Multiverso | Recarga de item',e);}finally{itemRechargeLocks.delete(key);}
 }
}
export async function rechargeItemMotor(item){
 if(!own(item))throw Error('Sem permissão para recarregar o item.');
 const cfg=itemMotorConfig(item);
 if(!cfg.chargesEnabled)throw Error('Este item não usa cargas.');
 const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Recarregar item'},content:`<div class="mv-item-dialog"><h3>${escape(item.name)}</h3><p>Recarregar as cargas de <b>${escape(item.name)}</b> agora? Atual: ${cfg.chargesCurrent}/${cfg.chargesMax}. Recuperação: ${escape(cfg.rechargeAmount)}.</p></div>`,rejectClose:false});
 if(!yes)return false;
 await rechargeItemAmount(item,{manual:true});
 return true;
}
export async function useItemMotor(item,{operationOverride=null,operationMode='use'}={}){
 const actor=item?.parent,key=item?.uuid??item?.id;
 if(!key||busy.has(key))throw Error('Este item já está sendo utilizado.');
 busy.add(key);
 try{
  const cfg=itemMotorConfig(item);
  checkUse(item,cfg);validateItemMotor(cfg);
  let ok=false;
  const actions=[];
  if(operationMode==='cast'){
   for(const ref of cfg.castSources||[])if(resolveTemplate(actor,ref))actions.push([`cast:${ref}`,`Conjurar: ${resolveTemplate(actor,ref).name}`]);
   if(!actions.length)throw Error('Este item não possui habilidades disponíveis para conjurar.');
  }else{
   if(cfg.enableAttack)actions.push(['ataque','Atacar com o item']);
   if(cfg.enableRecovery)actions.push(['recuperacao','Recuperar recurso']);
   if(!actions.length)actions.push([cfg.kind==='utilitario'?'utilitario':'nenhum','Utilizar item']);
  }
  let operation=actions[0][0];
  if(operationOverride){
    if(!actions.some(x=>x[0]===operationOverride))throw Error('Esta ação não está cadastrada no item.');
    operation=operationOverride;
  }else if(actions.length>1||operationMode==='cast'){
    const selected=await dialog(operationMode==='cast'?`Conjurar habilidade • ${item.name}`:`Ações de ${item.name}`,`<div class="mv-item-dialog"><h3>${operationMode==='cast'?'Escolha qual habilidade conjurar':'O que deseja fazer?'}</h3><label>Ação<select name="action">${actions.map(([id,label])=>`<option value="${escape(id)}">${escape(label)}</option>`).join('')}</select></label></div>`,form=>form.querySelector('[name="action"]')?.value,'Continuar');
    if(!selected)return false;
    operation=selected;
  }
  if(operation==='ataque')ok=await useAttack(item,cfg);
  else if(operation==='recuperacao')ok=await useRecovery(item,cfg);
  else if(operation.startsWith('cast:')){
   const skill=await castSource(item,cfg,operation.slice(5));
   ok=Boolean(await executeNativeEffectTest(skill));
   if(ok)await runSpecialEffects(item,cfg,'uso');
  }else if(operation==='utilitario'||operation==='nenhum'){
   ok=Boolean(await foundry.applications.api.DialogV2.confirm({window:{title:`Usar ${item.name}`},content:`<div class="mv-item-dialog"><h3>${escape(item.name)}</h3><p>${escape(item.system?.descricao||cfg.note||'Utilização narrativa do item.')}</p></div>`,rejectClose:false}));
   if(ok){
    // Um uso = um cartão visível quando o motor original publicar o efeito.
    // Não recriar os efeitos; os planos privados e botões continuam intactos.
    const priorIds=new Set((game.messages?.contents??[]).map(message=>message.id));
    await runSpecialEffects(item,cfg,'uso');
    const freshEffects=(game.messages?.contents??[]).filter(message=>!priorIds.has(message.id) &&
      message.getFlag?.(NS,'publicEffect') && message.speaker?.actor===actor.id);
    if(freshEffects.length){
      for(const message of freshEffects){
        try{
          const original=message.content;
          const info=escape(item.system?.descricao||cfg.note||'Item utilizado.');
          await message.update({content:card(item,'Utilização',`<p class="mv-im-chat-use-note">${info}</p><div class="mv-im-chat-embedded-effect">${original}</div>`)});
        }catch(error){console.error('Multiverso | Card único de utilização',error);}
      }
    }else await say(item,'Utilização',`<p>${escape(item.system?.descricao||cfg.note||'Item utilizado.')}</p>`);
   }
  }
  if(ok && operation!=='ataque')await consumeItem(item,cfg);
  return ok;
 }finally{busy.delete(key);}
}

export async function createItemAbility(item,type='skill'){
 if(!own(item)||item?.parent?.documentName!=='Actor')throw Error('Sem permissão para cadastrar habilidade neste item.');
 if(!['skill','tecnica'].includes(type))throw Error('Tipo de habilidade inválido.');
 const actor=item.parent;
 const [created]=await actor.createEmbeddedDocuments('Item',[{name:type==='skill'?'Nova Skill do Item':'Nova Técnica do Item',type,img:item.img,flags:{[NS]:{itemAbilityTemplateV1:true,originItemId:item.id}},system:{descricao:'',props:{mvEffectCount:0}}}]);
 if(!created)throw Error('Não foi possível criar a habilidade do item.');
 created.sheet?.render(true);
 return created;
}
