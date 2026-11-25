// Dano sempre aparece no chat e só altera PV após clique direito + confirmação.
// `entries` só contém dados vindos do motor; o navegador não decide o valor aplicado.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function countDice(formula){
 return [...String(formula??'').matchAll(/(\d*)d\d+/gi)].reduce((n,m)=>n+Number(m[1]||1),0);
}
export function manualDamageEntry({actor,effect,amount,formula,damageType='',roll=null,source='',index=0}){
 const total=Number(amount);
 if(!actor?.uuid||!Number.isFinite(total)||total<0)throw Error('Dano manual inválido.');
 return {id:foundry.utils.randomID(),actorUuid:actor.uuid,actorName:actor.name,name:effect||source||'Dano',amount:Math.floor(total),formula:String(formula??total),diceCount:countDice(formula),damageType:String(damageType??''),effectIndex:index,roll};
}
export async function renderManualDamageRows(entries){
 const blocks=[];
 for(const e of entries){
  const rolled=e.roll?`<div class="mv-damage-roll-native">${await e.roll.render()}</div>`:'';
  blocks.push(`<div class="mv-manual-damage-entry" data-mv-manual-damage-entry="${esc(e.id)}"><div class="mv-manual-damage-caption"><b>${esc(e.actorName)}</b><small>${esc(e.name)}</small></div><div class="mv-manual-damage-formula">Fórmula: <b>${esc(e.formula)}</b> • ${e.diceCount} dado(s)</div>${rolled}<div class="mv-manual-damage-total"><span>Dano a aplicar</span><strong data-mv-manual-damage="${esc(e.id)}" title="Clique com o botão direito para aplicar na ficha">${e.amount}</strong></div><small>Botão direito sobre o valor para conferir proteções e aplicar manualmente.</small></div>`);
 }
 return blocks.join('');
}
export function damageFlag(entries){return {manualDamage:entries.map(({roll,...rest})=>rest)};}
