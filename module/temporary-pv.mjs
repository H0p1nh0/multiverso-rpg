import {endTemporaryResourcesForScene} from "./temporary-resource.mjs";
// Multiverso 0.1.56 — PV temporário manual: modelo original de ActiveEffect por concessão.
// PV temporário é parte do PV exibido e absorve dano antes do PV normal.
const NS='multiverso-rpg';
const FLAG='manualTemporaryPv';
const INTERNAL='mvTempInternal';
const current=a=>Number(a.system?.pv_atual);
const maximum=a=>Number(a.system?.pv_max);
const entries=a=>[...(a.effects??[])].filter(e=>!e.disabled&&e.getFlag(NS,FLAG)?.remaining>0).sort((a,b)=>(a.getFlag(NS,FLAG)?.created??0)-(b.getFlag(NS,FLAG)?.created??0));
export const temporaryTotal=a=>entries(a).reduce((n,e)=>n+Math.max(0,Number(e.getFlag(NS,FLAG)?.remaining??0)),0);
export function planPvUpdate(actor,operation,value){
  const amount=Math.max(0,Math.floor(value));const before=current(actor),max=maximum(actor),temp=temporaryTotal(actor);
  if(operation==='temp')return {before,after:before+amount,max,temp,amount};
  if(operation==='damage'||operation==='half')return {before,after:Math.max(0,before-amount),max,temp,amount};
  // Cura não remove o excedente temporário e não cura a camada temporária.
  return {before,after:Math.min(max+temp,before+amount),max,temp,amount};
}
export async function grantTemporaryPv(actor,amount,sceneId){
  const value=Math.floor(Number(amount));if(!Number.isSafeInteger(value)||value<=0)throw Error('Valor de PV temporário inválido.');
  if(!sceneId)throw Error('Uma cena ativa é necessária para PV temporário manual.');
  const before=current(actor);if(!Number.isFinite(before))throw Error('PV atual inválido.');
  const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{
    name:`PV Temporário (${value}/${value})`,img:'icons/svg/shield.svg',disabled:false,changes:[],
    flags:{[NS]:{[FLAG]:{remaining:value,max:value,sceneId,created:Date.now(),origin:'Aplicação manual pelo chat'}}}
  }]);
  if(!effect)throw Error('Não foi possível criar o efeito de PV temporário.');
  try{await actor.update({'system.pv_atual':before+value});}
  catch(err){await effect.delete({[INTERNAL]:true});throw err;}
  return {before,after:before+value,effect};
}
// Executa as atualizações do efeito depois da confirmação; chama-se antes de aplicar dano ao PV.
export async function applyPvDamage(actor,value){
  const amount=Math.floor(Number(value));if(!Number.isSafeInteger(amount)||amount<0)throw Error('Dano inválido.');
  const before=current(actor);if(!Number.isFinite(before))throw Error('PV inválido.');
  let remaining=amount,absorbed=0;
  for(const e of entries(actor)){
    if(remaining===0)break;
    const f=e.getFlag(NS,FLAG);const used=Math.min(remaining,Number(f.remaining));
    remaining-=used;absorbed+=used;const next=f.remaining-used;
    if(next===0)await e.delete({[INTERNAL]:true});
    else await e.update({name:`PV Temporário (${next}/${f.max})`,[`flags.${NS}.${FLAG}.remaining`]:next},{[INTERNAL]:true});
  }
  const after=Math.max(0,before-amount);await actor.update({'system.pv_atual':after});
  return {before,after,absorbed};
}
const processing=new Set();
// A troca de cena pode acontecer sem que a tela do mestre acompanhe o canvas.
// Guardar o ID da cena ativa permite detectar também a ativação de outra cena.
let lastActiveSceneId=null;
const activeSceneId=()=>game.scenes?.active?.id??[...(game.scenes??[])].find(s=>s.active)?.id??null;
async function endScene(sceneId){
  if(!game.user.isGM||!sceneId)return;
  // Tanto atores globais quanto atores sintéticos de tokens precisam ser tratados.
  const scene=game.scenes?.get(sceneId);
  const actors=new Map();
  for(const actor of game.actors??[])actors.set(actor.uuid,actor);
  for(const token of scene?.tokens??[]){if(token.actor)actors.set(token.actor.uuid,token.actor);}
  console.info('Multiverso RPG v0.1.60 | encerramento de PV temporário:',sceneId,'atores:',actors.size);
  for(const actor of actors.values()){
    await endTemporaryResourcesForScene(actor,sceneId);
    const expired=entries(actor).filter(e=>e.getFlag(NS,FLAG)?.sceneId===sceneId);
    if(!expired.length)continue;
    const remaining=expired.reduce((n,e)=>n+Number(e.getFlag(NS,FLAG).remaining),0);
    const before=current(actor);
    if(!Number.isFinite(before))continue;
    // Ao deletar pelo sistema, a dedução é feita uma única vez aqui.
    await actor.deleteEmbeddedDocuments('ActiveEffect',expired.map(e=>e.id),{[INTERNAL]:true});
    await actor.update({'system.pv_atual':Math.max(0,before-remaining)},{multiversoNotDamage:true});
    console.info('Multiverso RPG v0.1.60 | PV temporário encerrado:',actor.name,remaining);
  }
}
function queueScene(sceneId){
  if(!sceneId||processing.has(sceneId)||!game.user.isGM)return;
  processing.add(sceneId);
  void endScene(sceneId).catch(e=>console.error('Multiverso | PV temporário ao fim da cena',e)).finally(()=>processing.delete(sceneId));
}
const combatScene=combat=>{
  const scene=combat?.scene;
  return (typeof scene==='string'?scene:scene?.id)??combat?.sceneId??combat?.parent?.id??combat?.combatants?.contents?.find(c=>c.token?.parent?.id)?.token?.parent?.id??canvas?.scene?.id??activeSceneId();
};
const combatStarted=combat=>Boolean(combat?.started||Number(combat?.round)>0);
const knownCombatStates=new Map();
export function registerTemporaryPv(){
  Hooks.once('ready',()=>{
    lastActiveSceneId=activeSceneId();
    for(const combat of game.combats??[])knownCombatStates.set(combat.id,combatStarted(combat));
  });
  Hooks.on('updateScene',(scene,change)=>{
    if(!game.user.isGM)return;
    if(change.active===false)queueScene(scene.id);
    if(change.active===true){
      if(lastActiveSceneId&&lastActiveSceneId!==scene.id)queueScene(lastActiveSceneId);
      // Inclui efeitos de cenas anteriores, caso o GM tenha mudado a cena
      // ativa sem abrir seu próprio canvas.
      for(const other of game.scenes??[])if(other.id!==scene.id)queueScene(other.id);
      lastActiveSceneId=scene.id;
    }
  });
  Hooks.on('deleteScene',scene=>queueScene(scene.id));
  Hooks.on('combatStart',combat=>queueScene(combatScene(combat)));
  Hooks.on('createCombat',combat=>{
    const started=combatStarted(combat);
    knownCombatStates.set(combat.id,started);
    if(started)queueScene(combatScene(combat));
  });
  Hooks.on('updateCombat',(combat,changes)=>{
    const started=combatStarted(combat);
    const wasStarted=knownCombatStates.get(combat.id)??false;
    knownCombatStates.set(combat.id,started);
    // Limpar apenas na TRANSIÇÃO para combate iniciado, não a cada turno/rodada.
    if(!wasStarted&&started)queueScene(combatScene(combat));
    // Se uma integração marca o combate como encerrado, limpar também.
    if(wasStarted&&!started)queueScene(combatScene(combat));
  });
  Hooks.on('deleteCombat',combat=>{
    knownCombatStates.delete(combat.id);
    queueScene(combatScene(combat));
  });
  let previousSceneId=null;
  Hooks.once('ready',()=>{previousSceneId=canvas?.scene?.id??null;});
  Hooks.on('canvasReady',()=>{
    if(!game.user.isGM)return;
    const next=canvas?.scene?.id??null;
    if(previousSceneId&&previousSceneId!==next)queueScene(previousSceneId);
    previousSceneId=next;
  });
  // Remoção manual: mantém PV normal correto se alguém excluir o efeito na aba Efeitos.
  Hooks.on('deleteActiveEffect',(effect,options,userId)=>{
    if(options?.[INTERNAL]||userId!==game.user.id)return;
    const flag=effect.getFlag(NS,FLAG);const actor=effect.parent;
    if(!flag?.remaining||!actor)return;
    const amount=Number(flag.remaining);
    void actor.update({'system.pv_atual':Math.max(0,current(actor)-amount)},{multiversoNotDamage:true}).catch(e=>console.error('Multiverso | remoção de PV temporário',e));
  });
}
