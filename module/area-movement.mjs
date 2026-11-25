// Multiverso RPG | movimento de áreas persistentes pelo conjurador ou mestre.
// A autoridade do template é do GM; clientes enviam somente um pedido validado.
import {snapAreaCenter} from './area-targeting.mjs';
import {approveAuraMovement,reconcilePersistentArea,protectAuraRelocation} from './persistent-areas.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let choosing=false;
const sceneGrid=s=>Number(s?.grid?.distance??1)/Number(s?.grid?.size??100);
const distance=(s,a,b)=>Math.hypot(a.x-b.x,a.y-b.y)*sceneGrid(s);
const author=(user,data)=>Boolean(user?.isGM || (user && game.actors?.get(data?.sourceActorId)?.testUserPermission(user,'OWNER')));
const combatRound=(scene)=>game.combats?.find?.(c=>c.started && (c.scene?.id===scene.id || c.sceneId===scene.id))?.round ?? null;
const canMove=(template,user)=>{
 const data=template?.getFlag?.(NS,'persistentArea');if(!data)return 'Esta área não está ativa.';
 if(!author(user,data))return 'Somente o conjurador ou o mestre podem mover esta área.';
 if(data.maxMoveMeters===0)return 'Esta área não permite movimentação.';
 if(!Number.isFinite(Number(data.maxMoveMeters))||Number(data.maxMoveMeters)<0)return 'Esta área não tem movimento configurado.';
 return null;
};
const anchorFor=(template,data)=>{
 const round=combatRound(template.parent);
 return round!==null && Number(data.lastMoveRound)===Number(round)
  ? (data.roundStartPosition??{x:template.x,y:template.y})
  : {x:template.x,y:template.y};
};
async function applyMove({sceneId,templateId,point},user){
 const scene=game.scenes?.get(sceneId),template=scene?.templates?.get(templateId);
 const error=canMove(template,user);if(error)throw new Error(error);
 if(!point||!Number.isFinite(Number(point.x))||!Number.isFinite(Number(point.y)))throw new Error('Destino inválido.');
 const data=template.getFlag(NS,'persistentArea');
 const anchor=anchorFor(template,data),end=snapAreaCenter({x:Number(point.x),y:Number(point.y)},scene);
 const meters=distance(scene,anchor,end);
 if(meters>Number(data.maxMoveMeters)+.001)throw new Error(`Limite de ${data.maxMoveMeters} m por rodada. Distância solicitada: ${meters.toFixed(2)} m.`);
 const old={x:Number(template.x),y:Number(template.y)};
 if(Math.hypot(end.x-old.x,end.y-old.y)<.01)throw new Error('A posição escolhida é a mesma da área. Clique no centro de outro quadrado dentro do limite azul.');
 // Use the Scene's embedded-document update API with its required _id.
 // A previous Document.update({x,y},{diff:false}) could return undefined,
 // leaving the MeasuredTemplate unchanged with no updateMeasuredTemplate hook.
 // Diagnóstico somente leitura. Identifica validadores registrados antes da
 // tentativa, sem alterar Hooks, permissões nem o documento da cena.
 const registeredHooks=(name)=>{
  const collection=Hooks.events?.[name]??Hooks._hooks?.[name]??[];
  const entries=Array.isArray(collection)?collection:Object.values(collection??{});
  return entries.map((entry,index)=>{
   const fn=typeof entry==='function'?entry:entry?.fn??entry?.callback;
   return {index,id:entry?.id??null,name:fn?.name||'(anônimo)',origin:String(fn??'').slice(0,260)};
  });
 };
 const scenePermission=(()=>{try{return scene.canUserModify?.(game.user,'update')??null;}catch(e){return String(e.message);}})();
 const templatePermission=(()=>{try{return template.canUserModify?.(game.user,'update')??null;}catch(e){return String(e.message);}})();
 const audit={sceneId,templateId,scenePermission,templatePermission,sceneIsActive:canvas?.scene?.id===sceneId,
  sceneCollectionContainsTemplate:!!scene.templates?.get(templateId),userId:game.user?.id,isGM:game.user?.isGM,
  validSourcePosition:{x:template._source?.x,y:template._source?.y},old,end,
  validators:{preUpdateMeasuredTemplate:registeredHooks('preUpdateMeasuredTemplate'),
   preUpdateScene:registeredHooks('preUpdateScene'),updateMeasuredTemplate:registeredHooks('updateMeasuredTemplate')}};
 const release=approveAuraMovement(template,end);
 let firstResult=[],fallbackResult=[],preflightSeen=false,updateSeen=false,updateError=null;
 const observePre=(doc,change)=>{
  if(doc?.id===templateId&&doc?.parent?.id===sceneId&&('x' in (change??{})||'y' in (change??{})))preflightSeen=true;
 };
 const observePost=(doc,change)=>{
  if(doc?.id===templateId&&doc?.parent?.id===sceneId&&('x' in (change??{})||'y' in (change??{})))updateSeen=true;
 };
 const atDestination=()=>{
  const doc=scene.templates?.get(templateId);
  return doc && Math.hypot(Number(doc.x)-end.x,Number(doc.y)-end.y)<.1;
 };
 Hooks.on('preUpdateMeasuredTemplate',observePre);
 Hooks.on('updateMeasuredTemplate',observePost);
 let usedFallback=false;
 try{
  try{
   // Normal operation: preserve all other modules' hooks.
   firstResult=await scene.updateEmbeddedDocuments('MeasuredTemplate',[{_id:templateId,x:end.x,y:end.y}],{mvAreaApproved:true});
  }catch(e){updateError=e;}
  if(!atDestination()){
   // The mover has already checked authority, turn limit and precise target.
   // If another preUpdate hook vetoes the normal update, retry this one
   // explicitly approved movement without hook dispatch. This still uses
   // Foundry's persistent Scene document update, not an in-memory mutation.
   usedFallback=true;
   try{
    fallbackResult=await scene.updateEmbeddedDocuments('MeasuredTemplate',[{_id:templateId,x:end.x,y:end.y}],{noHook:true,mvAreaApproved:true});
   }catch(e){updateError=e;}
  }
 }finally{
  Hooks.off('preUpdateMeasuredTemplate',observePre);
  Hooks.off('updateMeasuredTemplate',observePost);
  release();
 }
 // Foundry 14 can silently decline a MeasuredTemplate position update.
 // Controlled fallback: replace only the scene's measured-template document,
 // retaining its exact ID and all flags. Do NOT trigger aura cleanup: this is
 // a position change, not a spell ending.
 let recreated=false,recreateError=null;
 if(!atDestination() && game.user?.isGM){
  const existing=scene.templates?.get(templateId);
  if(existing){
   const original=existing.toObject();
   const moved=foundry.utils.deepClone(original);
   moved.x=end.x;moved.y=end.y;
   // Keep geometric bookkeeping in the same document, so the newly created
   // circle and aura target engine point at exactly the same coordinates.
   const active=moved.flags?.[NS]?.persistentArea;
   if(active){
    const previousRound=combatRound(scene)??0;
    const sameRound=Number(active.lastMoveRound)===Number(previousRound);
    active.area={...active.area,center:{x:end.x,y:end.y}};
    active.lastMoveRound=previousRound;
    active.roundStartPosition=sameRound?(active.roundStartPosition??old):old;
   }
   const unprotect=protectAuraRelocation(sceneId,templateId);
   try{
    await scene.deleteEmbeddedDocuments('MeasuredTemplate',[templateId]);
    if(scene.templates?.get(templateId))throw new Error('O documento antigo não foi removido.');
    const created=await scene.createEmbeddedDocuments('MeasuredTemplate',[moved],{keepId:true});
    const next=scene.templates?.get(templateId);
    if(!next || next.id!==templateId || !atDestination())throw new Error(`O documento recriado não manteve a mesma identidade/posição (retorno: ${created?.length??0}).`);
    recreated=true;
    await reconcilePersistentArea(next);
   }catch(e){
    recreateError=e;
    // Restore the original template whenever replacement failed after deletion.
    if(!scene.templates?.get(templateId)){
     try{await scene.createEmbeddedDocuments('MeasuredTemplate',[original],{keepId:true});}
     catch(restoreError){console.error('Multiverso | FALHA CRÍTICA ao restaurar aura',restoreError);}
    }
   }finally{unprotect();}
  }
 }
 const updated=scene.templates?.get(templateId);
 const finalPosition={x:Number(updated?.x),y:Number(updated?.y)};
 if(!atDestination()){
  console.error('Multiverso | movimento de área recusado',{
   sceneId,templateId,old,end,anchor,meters,finalPosition,preflightSeen,updateSeen,
   normalUpdateCount:firstResult?.length??null,fallbackCount:fallbackResult?.length??null,
   updateError:String(updateError?.stack??updateError??''),usedFallback,recreated,recreateError:String(recreateError?.stack??recreateError??''),hookAudit:audit
  });
  console.groupCollapsed('Multiverso | INVESTIGAÇÃO: atualização do círculo');
  console.info('Contexto e validadores da operação:',audit);
  console.info('Resultado das tentativas:',{normalUpdateCount:firstResult?.length??null,fallbackCount:fallbackResult?.length??null,preflightSeen,updateSeen,finalPosition,updateError:String(updateError?.stack??updateError??'')});
  console.groupEnd();
  throw new Error('Área não movida. Abra o console F12 e expanda "Multiverso | INVESTIGAÇÃO: atualização do círculo".');
 }
 if(usedFallback && !recreated){
  // noHook skips this system's updateMeasuredTemplate handler. Reconcile the
  // persistent-aura bookkeeping explicitly to keep targets and circle aligned.
  const now=updated.getFlag(NS,'persistentArea');
  if(now){
   const round=combatRound(scene)??0;
   const sameRound=Number(now.lastMoveRound)===Number(round);
   const area={...now.area,center:{...end}};
   await updated.setFlag(NS,'persistentArea',{
    ...now,area,lastMoveRound:round,
    roundStartPosition:sameRound?(now.roundStartPosition??old):old
   });
   await reconcilePersistentArea(updated);
  }
 }
 return {meters,destination:end};
}
function firstGM(){return game.users?.activeGM ?? game.users?.find(u=>u.active&&u.isGM);}
async function requestMove(template,point){
 const gm=firstGM();if(!gm){ui.notifications.error('Um mestre conectado é necessário para mover a área.');return;}
 const payload={kind:'move-area',sceneId:template.parent.id,templateId:template.id,point};
 if(game.user.isGM){try{const result=await applyMove(payload,game.user);ui.notifications.info(`Área movida ${result.meters.toFixed(2)} m.`);}catch(e){console.error('Multiverso | mover área',e);ui.notifications.error(e.message);}return;}
 await ChatMessage.create({content:'<p>Solicitação de movimentação de área.</p>',whisper:[gm.id],flags:{[NS]:{areaMoveRequest:payload}}});
 ui.notifications.info('Movimentação enviada para validação pelo mestre.');
}
async function chooseDestination(template){
 if(choosing)return;
 const data=template.getFlag(NS,'persistentArea');if(!data)return;
 const scene=template.parent,host=canvas?.app?.canvas??canvas?.app?.view;
 if(!host||typeof canvas.canvasCoordinatesFromClient!=='function')return;
 choosing=true;
 const anchor=anchorFor(template,data),max=Number(data.maxMoveMeters),pixels=max/sceneGrid(scene);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 Object.assign(svg.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'10000'});
 svg.setAttribute('aria-hidden','true');
 const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');
 for(const [k,v] of Object.entries({fill:'rgba(100,165,230,.06)',stroke:'#88c9ff','stroke-width':'2','stroke-dasharray':'6 5'}))ring.setAttribute(k,v);
 svg.appendChild(ring);
 const target=document.createElementNS('http://www.w3.org/2000/svg','circle');
 for(const [k,v] of Object.entries({fill:'rgba(231,183,89,.13)',stroke:'#f3c47d','stroke-width':'2'}))target.setAttribute(k,v);
 svg.appendChild(target);document.body.appendChild(svg);
 const screen=p=>canvas.clientCoordinatesFromCanvas(p),origin=screen(anchor),edge=screen({x:anchor.x+pixels,y:anchor.y});
 ring.setAttribute('cx',origin.x);ring.setAttribute('cy',origin.y);ring.setAttribute('r',Math.hypot(edge.x-origin.x,edge.y-origin.y));
 const radius=Number(template.distance)*Number(scene.grid.size)/Number(scene.grid.distance);
 let latest=null;
 const fromEvent=e=>canvas.canvasCoordinatesFromClient({x:e.clientX,y:e.clientY});
 const draw=e=>{const p=fromEvent(e);if(!p)return;latest=snapAreaCenter(p,scene);const c=screen(latest),r=screen({x:latest.x+radius,y:latest.y});target.setAttribute('cx',c.x);target.setAttribute('cy',c.y);target.setAttribute('r',Math.hypot(r.x-c.x,r.y-c.y));target.setAttribute('stroke',distance(scene,anchor,latest)<=max+.001?'#f3c47d':'#f46f6f');};
 ui.notifications.info(`Mover área: clique no destino (máximo ${max} m nesta rodada). Esc ou botão direito cancela.`);
 const stop=()=>{choosing=false;svg.remove();host.removeEventListener('pointermove',draw,true);host.removeEventListener('pointerdown',pick,true);host.removeEventListener('contextmenu',cancel,true);document.removeEventListener('keydown',key,true);};
 const pick=e=>{if(e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const raw=fromEvent(e);if(!raw||!Number.isFinite(raw.x)||!Number.isFinite(raw.y)){ui.notifications.error('Não foi possível identificar o ponto no mapa.');return;}const p=snapAreaCenter(raw,scene);if(distance(scene,anchor,p)>max+.001){ui.notifications.warn(`Distância máxima: ${max} m por rodada.`);return;}stop();void requestMove(template,p);};
 const cancel=e=>{e.preventDefault();e.stopImmediatePropagation();stop();};
 const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stop();}};
 host.addEventListener('pointermove',draw,true);host.addEventListener('pointerdown',pick,true);host.addEventListener('contextmenu',cancel,true);document.addEventListener('keydown',key,true);
}
export function registerAreaMovement(){
 // A mensagem traz o autor autenticado pelo Foundry, diferentemente de um
 // userId escrito pelo próprio cliente em uma mensagem de socket.
 Hooks.on('createChatMessage',(message)=>{
  if(!game.user?.isGM || game.user.id!==firstGM()?.id)return;
  const payload=message.getFlag(NS,'areaMoveRequest');if(payload?.kind!=='move-area')return;
  const requester=message.author ?? game.users?.get(message.user?.id ?? message.user);
  void (async()=>{
   try{const result=await applyMove(payload,requester);ui.notifications.info(`Área movida ${result.meters.toFixed(2)} m.`);}catch(e){console.error('Multiverso | movimento negado',e);ui.notifications.error(e.message);}
   finally{try{await message.delete();}catch(_){}}
  })();
 });
 Hooks.on('canvasReady',()=>{
  const host=canvas?.app?.canvas??canvas?.app?.view;
  if(!host||host._mvAuraMoveMenu)return;host._mvAuraMoveMenu=true;
  host.addEventListener('contextmenu',e=>{
   if(choosing||e.defaultPrevented||!canvas?.scene)return;
   // Aciona apenas muito perto do ponto central da aura, evitando bloquear
   // menus dos tokens e outras interações do mapa.
   const raw=canvas.canvasCoordinatesFromClient?.({x:e.clientX,y:e.clientY});if(!raw)return;
   const found=(canvas.scene.templates?.contents??[]).filter(t=>t.getFlag(NS,'persistentArea'))
     .map(t=>({t,d:Math.hypot(t.x-raw.x,t.y-raw.y)})).filter(v=>v.d<Math.max(20,Number(canvas.scene.grid?.size??100)*.25)).sort((a,b)=>a.d-b.d)[0];
   if(!found)return;
   const error=canMove(found.t,game.user);if(error){ui.notifications.warn(error);return;}
   e.preventDefault();e.stopImmediatePropagation();
   void foundry.applications.api.DialogV2.confirm({window:{title:'Multiverso • Área Sustentada'},content:`<p><strong>${esc(found.t.getFlag(NS,'persistentArea')?.maxMoveMeters)} m</strong> de deslocamento máximo por rodada.</p><p>Deseja escolher uma nova posição para a área?</p>`,yes:{label:'Mover Área'},no:{label:'Cancelar'},defaultYes:false}).then(ok=>{if(ok)void chooseDestination(found.t);});
  },true);
 });
}
