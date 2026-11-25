// Geometria de áreas do Multiverso: círculo, cone e linha, em coordenadas da cena.
import {minimizeWindowsForMap} from './window-focus.mjs';
// A visualização é uma prévia HTML/SVG sem gastos ou alterações permanentes.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function parseDistance(input){
 const alias=String(input??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
 // A grade padrão do Multiverso usa quadrados de 1,5m.
 if(['corpo a corpo','corpo-a-corpo','toque','adjacente'].includes(alias))return {value:1.5,unit:'m',close:true};
 const m=String(input??'').trim().toLowerCase().replace(',','.').match(/^(\d+(?:\.\d+)?)\s*(metros?|m|ft|p[eé]s?)$/);
 if(!m)return null;const value=Number(m[1]);return Number.isFinite(value)&&value>0?{value,unit:m[2].startsWith('m')?'m':'ft'}:null;
}
export function parseArea(input){
 const v=String(input??'').trim().toLowerCase().replace(',','.').replace(/\s+/g,' ');
 const m=v.match(/^(c[ií]rculo|esfera|raio|cone|linha|line|ray)\s*(?:de|:)?\s*(\d+(?:\.\d+)?)\s*(metros?|m|ft|p[eé]s?)(.*)$/);
 if(!m)return null;
 const distance=parseDistance(`${m[2]} ${m[3]}`);if(!distance)return null;
 const type=/^(c[ií]rculo|esfera|raio)$/.test(m[1])?'circle':m[1]==='cone'?'cone':'ray';
 const suffix=m[4].trim();let angle=90,width=null;
 if(type==='circle'&&suffix)return null;
 if(type==='cone'&&suffix){const match=suffix.match(/^(?:com\s*)?(\d+(?:\.\d+)?)\s*(?:°|graus?)$/);if(!match)return null;angle=Number(match[1]);if(!(angle>0&&angle<=180))return null;}
 if(type==='ray'&&suffix){const match=suffix.match(/^x\s*(\d+(?:\.\d+)?)\s*(metros?|m|ft|p[eé]s?)$/);if(!match)return null;width=parseDistance(`${match[1]} ${match[2]}`);}
 return {...distance,type,angle,width};
}
export function parseCircle(input){const area=parseArea(input);return area?.type==='circle'?area:null;}
export function sceneDistance(def,scene){
 const units=String(scene?.grid?.units??'m').toLowerCase();const feet=units.includes('ft')||units.includes('pés')||units.includes('pes');
 return def.value*(def.unit==='m'&&feet?3.280839895:def.unit==='ft'&&!feet?1/3.280839895:1);
}
export function worldRadius(def,scene){
 const gridPx=Number(scene?.grid?.size),gridDistance=Number(scene?.grid?.distance);
 if(!Number.isFinite(gridPx)||gridPx<=0||!Number.isFinite(gridDistance)||gridDistance<=0)throw Error('A grade da cena não possui tamanho/distância válidos.');
 return sceneDistance(def,scene)/gridDistance*gridPx;
}
export function areaGeometry(def,scene,center,direction=0){
 return {type:def.type,center,radius:worldRadius(def,scene),direction,width:def.type==='ray'?def.width?worldRadius(def.width,scene):Number(scene.grid.size):null,angle:def.angle??90};
}
// Snap to the center of a grid cell, not its top-left corner/intersection.
// Prefer Foundry's grid geometry for hex/offset grids; fallback supports square.
export function snapAreaCenter(point,scene=canvas?.scene){
 if(!point||!scene)return point;
 const x=Number(point.x),y=Number(point.y);
 const grid=canvas?.grid?.grid??canvas?.grid;
 if(scene?.id===canvas?.scene?.id&&typeof grid?.getCenterPoint==='function'){
  try{const result=grid.getCenterPoint({x,y});if(Number.isFinite(result?.x)&&Number.isFinite(result?.y))return {x:result.x,y:result.y};}catch(_){}
 }
 const size=Number(scene?.grid?.size??100);
 if(!Number.isFinite(size)||size<=0)return {x,y};
 const ox=Number(scene?.dimensions?.sceneX??0),oy=Number(scene?.dimensions?.sceneY??0);
 return {x:ox+(Math.floor((x-ox)/size)+.5)*size,y:oy+(Math.floor((y-oy)/size)+.5)*size};
}
const centerOf=t=>t.center??{x:t.x+(t.w??0)/2,y:t.y+(t.h??0)/2};
const modAngle=a=>((a+180)%360+360)%360-180;
export function pointInsideArea(point,area){
 const dx=point.x-area.center.x,dy=point.y-area.center.y;
 const along=dx*Math.cos(area.direction*Math.PI/180)+dy*Math.sin(area.direction*Math.PI/180);
 const perp=-dx*Math.sin(area.direction*Math.PI/180)+dy*Math.cos(area.direction*Math.PI/180);
 if(area.type==='circle')return Math.hypot(dx,dy)<=area.radius+.001;
 if(area.type==='ray')return along>=-.001&&along<=area.radius+.001&&Math.abs(perp)<=area.width/2+.001;
 if(area.type==='cone')return Math.hypot(dx,dy)<=area.radius+.001&&Math.abs(modAngle(Math.atan2(dy,dx)*180/Math.PI-area.direction))<=area.angle/2+.001;
 return false;
}
export function tokensInsideArea(tokens,area,sourceUuid,gm=false,sourceId=null,includeCaster=false){
 const found=new Map();
 for(const token of tokens??[]){
  if(!token.actor||(!includeCaster&&(token.actor.uuid===sourceUuid||(sourceId&&token.actor.id===sourceId))))continue;
  if(!gm&&(token.document?.hidden||token.visible===false))continue;
  if(pointInsideArea(centerOf(token),area)&&!found.has(token.actor.uuid))found.set(token.actor.uuid,token);
 }
 return [...found.values()];
}
export function actorsInsideCircle(tokens,center,radius,sourceUuid,gm=false,sourceId=null){return tokensInsideArea(tokens,{type:'circle',center,radius},sourceUuid,gm,sourceId);}
function pointsForArea(area){
 const {center:c,radius:r,direction:d}=area;
 if(area.type==='circle')return null;
 const rad=a=>a*Math.PI/180;const pt=(forward,side=0)=>({x:c.x+forward*Math.cos(rad(d))-side*Math.sin(rad(d)),y:c.y+forward*Math.sin(rad(d))+side*Math.cos(rad(d))});
 if(area.type==='ray')return [pt(0,-area.width/2),pt(r,-area.width/2),pt(r,area.width/2),pt(0,area.width/2)];
 const list=[c];for(let i=0;i<=32;i++){const a=rad(d-area.angle/2+area.angle*i/32);list.push({x:c.x+r*Math.cos(a),y:c.y+r*Math.sin(a)});}return list;
}
let placing=false;
export async function placeAreaPreview(def,{source,range=null}={}){
 if(placing){ui.notifications.warn('Já existe uma área sendo posicionada.');return null;}
 const scene=canvas?.scene,host=canvas?.app?.canvas??canvas?.app?.view??document.querySelector('#board canvas');
 if(!scene||!host?.addEventListener||typeof canvas.canvasCoordinatesFromClient!=='function'||typeof canvas.clientCoordinatesFromCanvas!=='function'){
  ui.notifications.error('Abra uma cena ativa antes de posicionar a área.');return null;
 }
 const radius=worldRadius(def,scene),maxRange=range?worldRadius(range,scene):null;
 const origin=(canvas.tokens?.controlled??[]).find(t=>t.actor?.id===source?.id)||(canvas.tokens?.placeables??[]).find(t=>t.actor?.id===source?.id);
 if(!origin){ui.notifications.warn('Coloque um token do conjurador na cena para posicionar a área.');return null;}
 placing=true;
 const restoreWindows=await minimizeWindowsForMap();
 let overlay;
 try{
 overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');
 overlay.setAttribute('aria-hidden','true');Object.assign(overlay.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'10000'});
 const castingRing=document.createElementNS('http://www.w3.org/2000/svg','circle');
 castingRing.setAttribute('fill','rgba(93,162,232,.055)');castingRing.setAttribute('stroke','#8cc8ff');castingRing.setAttribute('stroke-width','2');castingRing.setAttribute('stroke-dasharray','7 5');if(maxRange!==null)overlay.appendChild(castingRing);
 const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('fill','rgba(217,164,67,.20)');shape.setAttribute('stroke','#f5ca78');shape.setAttribute('stroke-width','2');overlay.appendChild(shape);document.body.appendChild(overlay);
 const coordinate=e=>{const p=canvas.canvasCoordinatesFromClient({x:e.clientX,y:e.clientY});return Number.isFinite(p?.x)&&Number.isFinite(p?.y)?{x:p.x,y:p.y}:null;};
 const screen=p=>canvas.clientCoordinatesFromCanvas(p);
 const start=centerOf(origin);
 if(maxRange!==null){const c=canvas.clientCoordinatesFromCanvas(start),edge=canvas.clientCoordinatesFromCanvas({x:start.x+maxRange,y:start.y});castingRing.setAttribute('cx',String(c.x));castingRing.setAttribute('cy',String(c.y));castingRing.setAttribute('r',String(Math.hypot(edge.x-c.x,edge.y-c.y)));}
 let anchor=null,last=null;
 const draw=(point)=>{
  if(!point)return;last=point;
  const center=snapAreaCenter(anchor??point,scene);
  const direction=anchor?Math.atan2(point.y-anchor.y,point.x-anchor.x)*180/Math.PI:0;
  const geometry=areaGeometry(def,scene,center,direction);const points=pointsForArea(geometry);let path;
  if(points){const translated=points.map(screen);path=translated.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')+' Z';}
  else{const c=screen(center),edge=screen({x:center.x+radius,y:center.y});const scale=Math.hypot(edge.x-c.x,edge.y-c.y);path=`M${c.x+scale} ${c.y} A${scale} ${scale} 0 1 0 ${c.x-scale} ${c.y} A${scale} ${scale} 0 1 0 ${c.x+scale} ${c.y}`;}
  shape.setAttribute('d',path);shape.setAttribute('stroke',maxRange!==null&&Math.hypot(center.x-start.x,center.y-start.y)>maxRange?'#ed6969':'#f5ca78');
 };
 ui.notifications.info(def.type==='circle'?'Círculo azul: limite da conjuração. Área dourada: efeito da habilidade. Clique no mapa para confirmar; Esc ou botão direito cancela.':'Clique no centro da área e depois na direção desejada. Esc ou botão direito cancela.');
 return await new Promise(resolve=>{
  let done=false;const finish=result=>{if(done)return;done=true;placing=false;host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerdown',select,true);host.removeEventListener('contextmenu',cancel,true);document.removeEventListener('keydown',key,true);overlay.remove();resolve(result);};
  const move=e=>{try{draw(coordinate(e));}catch(error){console.error('Multiverso | prévia',error);ui.notifications.error(`Área: ${error.message}`);finish(null);}};
  const select=e=>{
   if(e.button!==0)return;let point;try{point=coordinate(e);}catch(error){console.error(error);finish(null);return;}if(!point)return;
   e.preventDefault();e.stopImmediatePropagation();
   if(maxRange!==null&&Math.hypot((anchor??point).x-start.x,(anchor??point).y-start.y)>maxRange+.001){ui.notifications.warn('Centro fora do alcance permitido.');return;}
   if(def.type!=='circle'&&!anchor){anchor=point;draw(point);return;}
   const center=snapAreaCenter(anchor??point,scene);const direction=anchor?Math.atan2(point.y-anchor.y,point.x-anchor.x)*180/Math.PI:0;
   if(anchor&&Math.hypot(point.x-anchor.x,point.y-anchor.y)<2){ui.notifications.warn('Indique a direção com o segundo clique.');return;}
   finish({...areaGeometry(def,scene,center,direction),definition:def,sceneId:scene.id});
  };
  const cancel=e=>{e.preventDefault();e.stopImmediatePropagation();finish(null);};const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(null);}};
  host.addEventListener('pointermove',move,true);host.addEventListener('pointerdown',select,true);host.addEventListener('contextmenu',cancel,true);document.addEventListener('keydown',key,true);
 });
 }finally{overlay?.remove();placing=false;await restoreWindows();}
}
export async function placeCirclePreview(def,opts){return placeAreaPreview({...def,type:'circle'},opts);}
export async function confirmAreaTargets(tokens,area){
 const names=tokens.map(t=>`<li>${esc(t.actor?.name??'Sem ficha')}</li>`).join('');
 return foundry.applications.api.DialogV2.confirm({window:{title:'Multiverso • Confirmar área'},content:`<section class="mv-area-confirm"><h3>Alvos dentro da área</h3><p><strong>${esc(area.label)}</strong> • <strong>${tokens.length}</strong> personagem(ns)</p><ul>${names}</ul><small>A área selecionada foi calculada no mapa. O conjurador pode ser afetado conforme a opção da habilidade. Nenhum recurso foi gasto ainda.</small></section>`,yes:{label:'Continuar com estes alvos'},no:{label:'Cancelar Skill'},defaultYes:false});
}
