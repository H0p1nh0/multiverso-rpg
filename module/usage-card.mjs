// v0.1.85 — informações econômicas privadas, visual escuro e dourado.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const rechargeLabels={cena:'ao iniciar uma nova cena',descanso_curto:'após descanso curto ou longo',descanso_longo:'após descanso longo',novo_dia:'ao iniciar um novo dia',manual:'por recarga manual',turno:'no início do próximo turno do personagem',rodada:'no início da próxima rodada',combate:'ao iniciar um novo combate',nunca:'sem recarga automática'};
const labels={cena:'Nova cena',descanso_curto:'Descanso curto',descanso_longo:'Descanso longo',novo_dia:'Novo dia',manual:'Recarga manual',turno:'Início do turno',rodada:'Nova rodada',combate:'Novo combate'};
export function usageCard({name='',actorName='',kind='uso',remaining=null,limit=null,costs=[],event='',rechargeKind='',restored=[],newDay=false}){
 const recharge=kind==='recarga';
 const title=recharge?'Recarga registrada':'Uso de habilidade confirmado';
 const reason=recharge?(labels[event]??event):'Pagamento e limite de usos';
 const rechargeText=rechargeLabels[rechargeKind]??(rechargeKind||'');
 const line=remaining===null?'':`<div class="mv-auto-note">${Number(remaining)===0?'<strong>Usos esgotados!</strong>':'Usos disponíveis:'} <strong>${esc(remaining)} / ${esc(limit)}</strong>${rechargeText?`<div>Recarga: ${esc(rechargeText)}.</div>`:''}</div>`;
 const cost=costs.length?`<div class="mv-auto-note">Custo pago: ${costs.map(c=>`${esc(c.amount)} ${esc(c.label??c.resource??'')}`).join(' + ')}</div>`:'';
 const rechargeInfo=recharge?(restored.length?`<div class="mv-auto-note"><strong>Usos restaurados:</strong> ${restored.map(r=>`${esc(r.name)} (${esc(r.remaining)}/${esc(r.limit)})`).join(' · ')}</div>`:`<div class="mv-auto-note">Nenhum uso pendente de recarga para este evento.</div>`):'';
 const dayInfo=recharge&&newDay?'<div class="mv-auto-note">Novo dia também registrado.</div>':'';
 return `<section class="mv-chat-effect mv-chat-automatic mv-usage-card"><div class="mv-chat-effect-header"><strong>${esc(title)}</strong><small>Multiverso RPG • ${esc(reason)}</small></div><div class="mv-chat-effect-body"><div class="mv-auto-trigger-reason"><span class="mv-auto-trigger-dot" aria-hidden="true">✦</span>${esc(name||actorName)}<span class="mv-auto-trigger-state">${recharge?(restored.length?'Recarregado':'Registrado'):'Confirmado'}</span></div>${cost||line||rechargeInfo||dayInfo?`<div class="mv-auto-change">${cost}${line}${rechargeInfo}${dayInfo}</div>`:''}</div></section>`;
}
export async function sendPrivateUsageCard(actor,details){
 const ids=[...new Set([game.user.id,...(game.users??[]).filter(u=>u.isGM).map(u=>u.id)])];
 return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),whisper:ids,content:usageCard({...details,actorName:actor.name})});
}
