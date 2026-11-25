// v0.1.61 — recursos temporários manuais adicionais ao PV.
// Extensão nova: no módulo original só existia PV temporário.
// Cada concessão cria um efeito e soma ao fluxo exibido.
const NS='multiverso-rpg';
const FLAG='manualTemporaryResource';
const INTERNAL='mvTempInternal';
const RES={pm:['pm_atual','pm_max','PM'],sta:['sta_atual','sta_max','STA'],san:['san_atual','san_max','SAN']};
import {fluxById} from './extra-flux.mjs';
const resourceKeys=(actor,resource)=>resource==='extra'?(['fluxoextraatual','fluxoextramax',actor.system.fluxoextranome||'Fluxo Extra']):RES[resource];
const matching=(actor,resource)=>[...(actor.effects??[])].filter(e=>!e.disabled&&e.getFlag(NS,FLAG)?.resource===resource&&Number(e.getFlag(NS,FLAG)?.remaining)>0).sort((a,b)=>(a.getFlag(NS,FLAG)?.created??0)-(b.getFlag(NS,FLAG)?.created??0));
export function totalTemporaryResource(actor,resource){return matching(actor,resource).reduce((n,e)=>n+Number(e.getFlag(NS,FLAG).remaining),0);}
const n=(actor,key)=>Number(actor.system?.[key]);
export async function grantTemporaryResource(actor,resource,amount,sceneId){
  const keys=resourceKeys(actor,resource);const value=Math.floor(Number(amount));
  if(!keys||(resource==='extra'&&!fluxById(actor,'extra'))||!Number.isSafeInteger(value)||value<=0)throw Error('Recurso temporário inválido.');
  if(!sceneId)throw Error('Uma cena ativa é necessária para conceder recurso temporário.');
  const before=n(actor,keys[0]);if(!Number.isFinite(before))throw Error('Recurso atual inválido.');
  const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{
    name:`${keys[2]} Temporário (${value}/${value})`,img:'icons/svg/shield.svg',disabled:false,changes:[],
    flags:{[NS]:{[FLAG]:{resource,remaining:value,max:value,sceneId,created:Date.now(),origin:'Aplicação manual pelo chat'}}}
  }]);
  if(!effect)throw Error('Não foi possível criar o efeito temporário.');
  try{await actor.update({[`system.${keys[0]}`]:before+value});}
  catch(error){await effect.delete({[INTERNAL]:true});throw error;}
  return {before,after:before+value,effect};
}
export async function spendWithTemporaryResource(actor,resource,amount){
  const keys=resourceKeys(actor,resource),value=Math.floor(Number(amount));
  if(!keys||(resource==='extra'&&!fluxById(actor,'extra'))||!Number.isSafeInteger(value)||value<0)throw Error('Redução de recurso inválida.');
  const before=n(actor,keys[0]);if(!Number.isFinite(before))throw Error('Recurso atual inválido.');
  let remaining=value,absorbed=0;
  for(const effect of matching(actor,resource)){
    if(!remaining)break;
    const meta=effect.getFlag(NS,FLAG),used=Math.min(remaining,Number(meta.remaining));
    remaining-=used;absorbed+=used;
    const rest=Number(meta.remaining)-used;
    if(!rest)await effect.delete({[INTERNAL]:true});
    else await effect.update({name:`${keys[2]} Temporário (${rest}/${meta.max})`,[`flags.${NS}.${FLAG}.remaining`]:rest},{[INTERNAL]:true});
  }
  const after=Math.max(0,before-value);await actor.update({[`system.${keys[0]}`]:after});
  return {before,after,absorbed};
}
export async function endTemporaryResourcesForScene(actor,sceneId){
  for(const resource of [...Object.keys(RES),'extra']){
    const expired=matching(actor,resource).filter(e=>e.getFlag(NS,FLAG)?.sceneId===sceneId);
    if(!expired.length)continue;
    const remaining=expired.reduce((n,e)=>n+Number(e.getFlag(NS,FLAG).remaining),0);
    const key=resourceKeys(actor,resource)?.[0],before=n(actor,key);
    if(!Number.isFinite(before))continue;
    await actor.deleteEmbeddedDocuments('ActiveEffect',expired.map(e=>e.id),{[INTERNAL]:true});
    await actor.update({[`system.${key}`]:Math.max(0,before-remaining)});
    console.info('Multiverso RPG v0.1.61 | recurso temporário encerrado',actor.name,resource,remaining);
  }
}
export function registerTemporaryResource(){
  Hooks.on('deleteActiveEffect',(effect,options,userId)=>{
    if(options?.[INTERNAL]||userId!==game.user.id)return;
    const meta=effect.getFlag(NS,FLAG),actor=effect.parent;
    const key=resourceKeys(actor,meta?.resource)?.[0];
    if(!actor||!key||!meta?.remaining)return;
    void actor.update({[`system.${key}`]:Math.max(0,n(actor,key)-Number(meta.remaining))}).catch(err=>console.error('Multiverso | remover recurso temporário',err));
  });
}
