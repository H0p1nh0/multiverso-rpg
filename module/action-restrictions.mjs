// Aviso não coercitivo para condições explicitamente marcadas como impedimento.
const NS='multiverso-rpg';
const notified=new Set();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function promptBlockedTurn(combat){
  if(!game.user?.isGM||!combat?.started||!combat.combatant)return;
  const member=combat.combatant,actor=member.actor;
  if(!actor)return;
  const key=`${combat.id}:${combat.round}:${combat.turn}:${member.id}`;
  if(notified.has(key))return;
  const effects=[...actor.effects].filter(e=>!e.disabled && !e.isSuppressed && e.getFlag(NS,'blocksAction')===true);
  // Um bloqueio parcial (ex.: só Movimento) não obriga pular o turno inteiro.
  const complete=effects.filter(e=>{const scope=e.getFlag(NS,'blockedActionTypes');return !Array.isArray(scope)||scope.includes('todas');});
  const names=[...new Set(complete.map(e=>String(e.name||'Condição').trim()))];
  if(!names.length)return;
  notified.add(key);
  try{
    const response=await foundry.applications.api.DialogV2.wait({
      window:{title:'Personagem impedido de agir',resizable:true},
      content:`<div class="mv-action-warning"><p>Você está sob:</p><ul>${names.map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p><strong>Deseja pular seu turno?</strong></p></div>`,
      buttons:[{action:'skip',label:'Pular turno',default:false,callback:()=>true},{action:'continue',label:'Continuar jogando',default:true,callback:()=>false}],rejectClose:false
    });
    // Revalidar: combate pode ter mudado enquanto o diálogo estava aberto.
    if(response===true && game.user.isGM && combat.started && combat.id===game.combat?.id && combat.round===Number(key.split(':')[1]) && combat.turn===Number(key.split(':')[2]) && combat.combatant?.id===member.id){
      await combat.nextTurn();
    }
  }catch(error){console.error('Multiverso RPG | aviso de impedimento',error);}
}
export function registerActionRestrictionWarnings(){
  Hooks.on('updateCombat',(combat,changes)=>{
    if(!game.user?.isGM||!('turn' in (changes??{})||'round' in (changes??{})))return;
    void promptBlockedTurn(combat);
  });
  Hooks.on('combatStart',combat=>{void promptBlockedTurn(combat);});
}
