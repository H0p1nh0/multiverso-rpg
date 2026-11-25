// Multiverso RPG — temporarily clear Foundry's floating windows while a Skill
// requires interaction with the canvas. Restore only windows changed by us.
// Foundry v14 stores modern ApplicationV2 windows in foundry.applications.instances
// (Map or object); ui.windows alone is primarily the legacy Application registry.

function valuesOf(collection){
 if(!collection)return [];
 if(collection instanceof Map || collection instanceof Set)return [...collection.values()];
 if(Array.isArray(collection))return collection;
 if(typeof collection==='object')return Object.values(collection);
 return [];
}
function rootOf(app){
 try{const el=app.element;return el?.jquery?el[0]:el?.[0]?.nodeType===1?el[0]:el;}
 catch(_){return null;}
}
function minimized(app){
 try{
  const root=rootOf(app);
  return app.minimized===true||app._minimized===true||root?.classList?.contains?.('minimized')===true;
 }catch(_){return false;}
}
function eligible(app){
 if(!app || typeof app.minimize!=='function'||typeof app.maximize!=='function')return false;
 try{
  if(app.rendered===false || app._state===-1 || minimized(app))return false;
  // Ignore permanently embedded controls (sidebar, navigation, token HUDs).
  if(app.hasFrame===false || app.options?.window?.frame===false || app.options?.window?.minimizable===false || app.options?.popOut===false)return false;
  const el=rootOf(app);
  if(el?.isConnected===false)return false;
  return true;
 }catch(_){return false;}
}
export function visibleFloatingApplications({
 legacy=globalThis.ui?.windows,
 modern=globalThis.foundry?.applications?.instances
}={}){
 const result=new Set();
 for(const app of [...valuesOf(modern),...valuesOf(legacy)])if(eligible(app))result.add(app);
 return [...result];
}
export async function minimizeWindowsForMap(){
 const changed=[];
 for(const app of visibleFloatingApplications()){
  try{
   await app.minimize();
   // Do not maximize applications which declined or failed to minimize.
   if(minimized(app))changed.push(app);
  }catch(error){console.warn('Multiverso | Não foi possível minimizar uma janela:',error);}
 }
 let restored=false;
 return async()=>{
  if(restored)return;
  restored=true;
  for(const app of changed){
   try{
    if(app.rendered===false||!minimized(app))continue;
    await app.maximize();
   }catch(error){console.warn('Multiverso | Não foi possível restaurar uma janela:',error);}
  }
 };
}
