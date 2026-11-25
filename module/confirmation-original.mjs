import {applyPassiveCost} from './passive-bonuses.mjs';
import {availableFluxes,fluxById,signedResourceBalance} from './extra-flux.mjs';
import {usageStatus} from './skill-uses.mjs';
// Migração da estrutura htmlPrincipal/htmlAjusteNarrativo/htmlFluxos/abrirConfirmacao
// do motor-efeitos.js original. Mantém a semântica do custo FIXO migrado;
// custos variáveis e modificadores não migrados continuam bloqueados pelo parser.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FLUXO={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const rotulo=r=>String(r??'').toUpperCase();
const labelOf=(actor,c)=>fluxById(actor,c.resource)?.label??rotulo(c.resource);
function htmlAjusteNarrativo(actor){return `<div class="mv-conf-section"><b>Ajuste manual / narrativo (opcional)</b><p>Aceita número ou fórmula de dados. Exemplos: 2, 1d4, 1d6+2. O resultado é somado ao custo normal.</p><div class="mv-conf-adjust">${availableFluxes(actor).map(f=>`<label>+ ${esc(f.label)}<input class="mv-ajuste-${f.id}" type="text" value="0" placeholder="0 ou 1d4"></label>`).join('')}</div><label>Motivo / efeito narrativo<input class="mv-ajuste-motivo" type="text" placeholder="Ex.: conjuração instável, ferimento, ambiente hostil..."></label></div>`;}
function htmlFluxos(actor){return availableFluxes(actor).map(f=>`<div class="mv-conf-flow"><span>${esc(f.label)}</span><b>${Number(actor.system[f.key]??0)} / ${Number(actor.system[f.max]??0)}</b></div>`).join('');}
async function resolveAdjust(actor,chosen){const costs=[];for(const [r,raw] of Object.entries(chosen.formulas)){
 const f=fluxById(actor,r);if(!f)return null;
 const text=String(raw??'').trim().replace(/(\d),(\d)/g,'$1.$2').replace(/^\+/,'');if(!text||text==='0')continue;
 let value;if(/^\d+(?:\.\d+)?$/.test(text))value=Number(text);else{try{const roll=new Roll(text,actor.getRollData?.()??{});await roll.evaluate();value=Number(roll.total);}catch(error){console.error('Multiverso | ajuste narrativo',error);ui.notifications.warn(`Ajuste narrativo inválido: ${text}`);return null;}}
 if(!Number.isFinite(value)||value<0){ui.notifications.warn(`Ajuste de ${f.label} inválido.`);return null;}if(value>0)costs.push({resource:r,amount:value});}
 return costs;}
export async function confirmOriginalUse(item,actor,options,extraCosts=[]){
 const baseOptions=Array.isArray(options)&&options.length?options:[{label:'Sem custo',costs:[]}];
 const adjusted=baseOptions.map(o=>applyPassiveCost(o,actor,item));
 if(adjusted.some(a=>a.error)){ui.notifications.error(adjusted.find(a=>a.error).error);return null;}
 const available=adjusted.map(a=>a.option);
 const costInfo=adjusted[0]?.details;
 const costDetails=costInfo?`<div class="mv-conf-section"><b>Modificadores automáticos do custo</b>${costInfo.mods.flatMap(m=>m.deltas.map(d=>`<div class="mv-conf-flow"><span>${esc(m.source)}</span><b>${d.amount>=0?'+':''}${d.amount} ${esc(rotulo(d.resource))}</b></div>`)).join('')}${costInfo.changes.map(c=>`<div class="mv-conf-flow"><span>Custo base → efetivo</span><b>${c.base} → ${c.final} ${esc(rotulo(c.resource))}</b></div><div class="mv-conf-flow"><span>Custo mínimo</span><b>${c.minimum} ${esc(rotulo(c.resource))}</b></div>`).join('')}</div>`:'';
 const result=await foundry.applications.api.DialogV2.wait({window:{title:`Usar ${item.name} · Multiverso v0.1.49`,resizable:true},
 content:`<div class="mv-conf-original"><div class="mv-conf-top"><h2>${esc(item.name)}</h2><small>Multiverso RPG • confirmação original adaptada • v0.1.49</small></div><div class="mv-conf-inner">${available.length===1?`<div class="mv-conf-section"><b>Custo:</b> ${esc(available[0].label&&/[%@]/.test(available[0].label)?available[0].label+' → ':'')}${esc(available[0].costs.map(c=>`${c.amount} ${labelOf(actor,c)}`).join(' + ')||'Sem custo principal cadastrado.')}</div>`:`<div class="mv-conf-section"><b>Escolha o custo usado:</b><div class="mv-conf-options">${available.map((o,i)=>`<label><input type="radio" name="mv-custo-principal" value="${i}" ${i===0?'checked':''}><span>${esc(o.label)}</span></label>`).join('')}</div></div>`}${extraCosts.length?`<div class="mv-conf-section"><b>Custos extras:</b> ${esc(extraCosts.map(c=>`${c.amount} ${labelOf(actor,c)}`).join(' + '))}</div>`:''}${costDetails}${htmlAjusteNarrativo(actor)}<div class="mv-conf-section"><b>Fluxos atuais</b>${htmlFluxos(actor)}</div><p class="mv-conf-private">Somente você vê esta confirmação. A habilidade será publicada no chat sem revelar seus custos.</p></div></div>`,
 buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'confirm',label:'Confirmar uso',default:true,callback:(_ev,_button,dialog)=>{const root=dialog?.element;return {index:Number(root?.querySelector('input[name="mv-custo-principal"]:checked')?.value??0),formulas:Object.fromEntries(availableFluxes(actor).map(f=>[f.id,root?.querySelector(`.mv-ajuste-${f.id}`)?.value??'0'])),reason:root?.querySelector('.mv-ajuste-motivo')?.value??''};}}],rejectClose:false});
 if(!result)return null;
 const selected=available[result.index];if(!selected)return null;
 const narrative=await resolveAdjust(actor,result);if(narrative===null)return null;
 const map=new Map();for(const c of [...selected.costs,...extraCosts,...narrative]){
 const f=fluxById(actor,c.resource);if(!f){ui.notifications.warn('O Fluxo Extra não está ativo ou o nome foi alterado.');return null;}
 const old=map.get(f.key);map.set(f.key,{resource:f.id,key:f.key,label:f.label,amount:(old?.amount??0)+Number(c.amount)});
 }
 const costs=[...map.values()];
 if(!signedResourceBalance(actor,costs).ok){ui.notifications.warn('Recursos insuficientes ou Fluxo Extra inativo para o custo completo.');return null;}
 return {selected,costs,reason:result.reason};
}
