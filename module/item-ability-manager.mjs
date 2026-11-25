// Multiverso RPG v0.2.42 — gerenciamento de habilidades exclusivas de cada item.
// Não oferece Skills do personagem ou da biblioteca como novas opções de vínculo.
import {itemMotorConfig,saveItemMotor,createItemAbility} from './item-motor.mjs';
import {openAbilityDiagnostic} from './ability-diagnostics.mjs';

const NS='multiverso-rpg';
const esc=v=>foundry.utils.escapeHTML(String(v??''));
const owned=item=>!!(item?.isOwner||item?.parent?.isOwner||game.user?.isGM);
const isTemplate=(ability,item)=>Boolean(ability&&['skill','tecnica'].includes(ability.type)&&ability.getFlag?.(NS,'itemAbilityTemplateV1')===true&&ability.getFlag?.(NS,'originItemId')===item.id);
const sourceRef=ability=>`owned:${ability.id}`;

export function itemAbilityEntries(item){
 const actor=item?.parent?.documentName==='Actor'?item.parent:null;
 if(!actor)return [];
 const cfg=itemMotorConfig(item);
 const cast=new Set(cfg.castSources||[]),grant=new Set(cfg.grantSources||[]);
 const own=[...(actor.items??[])].filter(ability=>isTemplate(ability,item)).map(ability=>({
   ref:sourceRef(ability),document:ability,legacy:false,
   cast:cast.has(sourceRef(ability)),grant:grant.has(sourceRef(ability))
 }));
 // Um vínculo antigo explicitamente salvo não é perdido, mas nenhuma Skill solta é oferecida.
 const known=new Set(own.map(x=>x.ref));
 for(const ref of new Set([...cast,...grant])){
  if(known.has(ref))continue;
  const [scope,id]=String(ref).split(':');
  const ability=scope==='world'?game.items?.get(id):['actor','owned'].includes(scope)?actor.items?.get(id):null;
  if(ability&&['skill','tecnica'].includes(ability.type)){
   own.push({ref,document:ability,legacy:true,cast:cast.has(ref),grant:grant.has(ref)});
  }
 }
 return own.sort((a,b)=>a.legacy-b.legacy || a.document.name.localeCompare(b.document.name,'pt-BR'));
}

export function itemAbilitySummary(item){
 const entries=itemAbilityEntries(item);
 if(!entries.length)return '<div class="mv-im-ability-empty"><i class="fa-solid fa-book-open"></i><span>Nenhuma habilidade criada para este item.</span></div>';
 const renderTags=(cast,grant)=>`${cast?'<span>Conjurar</span>':''}${grant?'<span>Conceder</span>':''}${!cast&&!grant?'<span class="is-neutral">Sem função definida</span>':''}`;
 const details=({document:skill,cast,grant})=>`<div class="mv-im-ability-detail-identity"><img src="${esc(skill.img||'icons/svg/book.svg')}" alt=""/><div><strong>${esc(skill.name)}</strong><div class="mv-im-ability-summary-tags">${renderTags(cast,grant)}</div><small>${esc(skill.type==='tecnica'?'Técnica':'Skill')}</small></div></div><div class="mv-im-ability-detail-properties"><div><b>Função</b><span>${cast&&grant?'Conjurar e Conceder':cast?'Conjurar pelo item':grant?'Conceder ao equipar':'Não definida'}</span></div><div><b>Descrição</b><span>${esc(skill.system?.descricao||skill.system?.props?.descricaoskill||skill.system?.props?.descricaotecnica||'Sem descrição cadastrada.')}</span></div></div>`;
 return `<div class="mv-im-abilities-layout"><section class="mv-im-ability-list-pane"><h5><i class="fa-solid fa-book-open"></i> Habilidades cadastradas <small>${entries.length}</small></h5><div class="mv-im-ability-summary-list">${entries.map(({ref,document:skill,cast,grant,legacy},i)=>`<button type="button" class="mv-im-ability-summary-card ${i===0?'is-selected':''}" data-mv-im-summary-select="${esc(ref)}" aria-label="Ver detalhes de ${esc(skill.name)}">
   <img src="${esc(skill.img||'icons/svg/book.svg')}" alt=""/>
   <div><strong>${esc(skill.name)}</strong><small>${esc(skill.type==='tecnica'?'Técnica':'Skill')}${legacy?' • Vínculo anterior':''}</small><div class="mv-im-ability-summary-tags">${renderTags(cast,grant)}</div></div>
   <i class="fa-solid fa-angle-right" aria-hidden="true"></i>
  </button>`).join('')}</div></section><section class="mv-im-ability-detail-pane"><h5><i class="fa-solid fa-sparkles"></i> Detalhes da habilidade</h5><div data-mv-im-ability-detail>${details(entries[0])}</div></section></div>`;
}

export function itemAbilityDetails(item,ref){
 const entry=itemAbilityEntries(item).find(e=>e.ref===ref);
 if(!entry)return '<p>Habilidade indisponível.</p>';
 const s=entry.document;
 const tags=[entry.cast?'Conjurar':'',entry.grant?'Conceder':''].filter(Boolean).join(' • ')||'Sem função definida';
 return `<div class="mv-im-ability-detail-identity"><img src="${esc(s.img||'icons/svg/book.svg')}" alt=""/><div><strong>${esc(s.name)}</strong><small>${esc(s.type==='tecnica'?'Técnica':'Skill')} • ${tags}</small></div></div><div class="mv-im-ability-detail-properties"><div><b>Função</b><span>${esc(tags)}</span></div><div><b>Descrição</b><span>${esc(s.system?.descricao||s.system?.props?.descricaoskill||s.system?.props?.descricaotecnica||'Sem descrição cadastrada.')}</span></div></div>`;
}

function managerHtml(item,entries){
 return `<div class="mv-im-manager">
  <header class="mv-im-manager-head"><span class="mv-im-manager-eyebrow">MULTIVERSO RPG • MOTOR DE ITENS</span><h2>Habilidades do item</h2><p>${esc(item.name)} — crie habilidades exclusivas do objeto e escolha como cada uma funciona.</p></header>
  <div class="mv-im-manager-guide"><div><i class="fa-solid fa-wand-magic-sparkles"></i><b>Conjurar</b><span>O item executa a habilidade sem ensiná-la ao personagem.</span></div><div><i class="fa-solid fa-book-open-reader"></i><b>Conceder</b><span>O personagem recebe a habilidade enquanto equipado, respeitando o vínculo exigido.</span></div></div>
  <section class="mv-im-manager-section"><div class="mv-im-manager-section-title"><h3>Habilidades cadastradas</h3><small>${entries.length} ${entries.length===1?'registro':'registros'}</small></div>
  ${entries.length?`<div class="mv-im-manager-list">${entries.map(({ref,document:skill,cast,grant,legacy},index)=>`<div class="mv-im-manager-row">
   <label class="mv-im-manager-identity"><input type="radio" name="mv-im-picked" value="${esc(ref)}" ${index===0?'checked':''}/><img src="${esc(skill.img||'icons/svg/book.svg')}" alt=""/><span><strong>${esc(skill.name)}</strong><small>${esc(skill.type==='tecnica'?'Técnica':'Skill')}${legacy?' • Vínculo anterior':''}</small></span></label>
   <div class="mv-im-manager-modes"><label><input type="checkbox" data-mv-im-cast="${esc(ref)}" ${cast?'checked':''}/> Conjurar</label><label><input type="checkbox" data-mv-im-grant="${esc(ref)}" ${grant?'checked':''}/> Conceder</label></div>
   </div>`).join('')}</div>`:'<div class="mv-im-manager-empty"><i class="fa-solid fa-scroll"></i><strong>Nenhuma habilidade própria ainda</strong><p>Crie uma Skill ou Técnica abaixo. O editor já aprovado será usado para configurar suas regras.</p></div>'}
  </section><p class="mv-im-manager-footnote">Marque Conjurar, Conceder ou ambos. Selecione uma habilidade para abrir ou excluir. Habilidades aprendidas pelo personagem não entram automaticamente nesta lista.</p>
 </div>`;
}

function readDialogState(dialog,entries){
 const root=dialog.element;
 const cast=[],grant=[];
 for(const entry of entries){
  const checkCast=[...root.querySelectorAll('[data-mv-im-cast]')].find(el=>el.dataset.mvImCast===entry.ref);
  const checkGrant=[...root.querySelectorAll('[data-mv-im-grant]')].find(el=>el.dataset.mvImGrant===entry.ref);
  if(checkCast?.checked)cast.push(entry.ref);
  if(checkGrant?.checked)grant.push(entry.ref);
 }
 return {castSources:cast,grantSources:grant,selected:root.querySelector('[name="mv-im-picked"]:checked')?.value??null};
}
async function saveLinks(item,state){
 const cfg=itemMotorConfig(item);
 const castSources=state.castSources||[],grantSources=state.grantSources||[];
 const kind=castSources.length&&cfg.kind==='nenhum'?'conjurar':!castSources.length&&cfg.kind==='conjurar'?'nenhum':cfg.kind;
 await saveItemMotor(item,{castSources,grantSources,castSource:'',grantSource:'',enableCast:castSources.length>0,kind});
}

export async function openItemAbilityManager(item){
 if(!owned(item)||item?.parent?.documentName!=='Actor')throw Error('É necessário ter permissão para editar este item na ficha do personagem.');
 const entries=itemAbilityEntries(item);
 const choice=await foundry.applications.api.DialogV2.wait({
  classes:['mv-im-manager-dialog'],
  window:{title:`Habilidades do item • ${item.name}`,resizable:true,width:790},
  content:managerHtml(item,entries),
  buttons:[
   {action:'cancel',label:'Cancelar',callback:()=>null},
   {action:'skill',label:'Criar Skill',callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'skill'})},
   {action:'tecnica',label:'Criar Técnica',callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'tecnica'})},
   ...(entries.length?[{action:'test',label:'Testar selecionada',callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'test'})},
    {action:'open',label:'Abrir selecionada',callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'open'})},
    {action:'remove',label:'Remover selecionada',callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'remove'})}]:[]),
   {action:'save',label:'Salvar vínculos',default:true,callback:(_event,_button,dialog)=>({...readDialogState(dialog,entries),action:'save'})}
  ],rejectClose:false
 });
 if(!choice)return false;
 if(!owned(item))throw Error('Você não tem permissão para alterar este item.');
 const picked=entries.find(e=>e.ref===choice.selected);
 if(choice.action==='test'){
  if(!picked){ui.notifications.warn('Selecione uma habilidade para testar.');return false;}
  await openAbilityDiagnostic(picked.document,{originItem:item});
  return false; // Testar não salva nem altera vínculos do item.
 }
 if(choice.action==='remove'){
  if(!picked){ui.notifications.warn('Selecione uma habilidade para remover.');return false;}
  const ownTemplate=isTemplate(picked.document,item);
  const yes=await foundry.applications.api.DialogV2.confirm({window:{title:ownTemplate?'Excluir habilidade do item':'Desvincular habilidade antiga'},content:`<div class="mv-im-confirm"><p>${ownTemplate?'Excluir a habilidade exclusiva':'Desvincular a habilidade anterior'} <strong>${esc(picked.document.name)}</strong> de <strong>${esc(item.name)}</strong>?</p><p>${ownTemplate?'A configuração será apagada. Habilidades concedidas por este item serão retiradas.':'A habilidade original do personagem ou da biblioteca será preservada.'}</p></div>`,rejectClose:false});
  if(!yes)return false;
  choice.castSources=choice.castSources.filter(ref=>ref!==picked.ref);
  choice.grantSources=choice.grantSources.filter(ref=>ref!==picked.ref);
 }
 await saveLinks(item,choice);
 if(choice.action==='skill'||choice.action==='tecnica'){
  const created=await createItemAbility(item,choice.action);
  // Uma habilidade recém-criada já pertence ao objeto; o usuário define sua função ao voltar ao gerenciador.
  ui.notifications.info(`${created.name} criada para ${item.name}. Configure no editor e depois escolha Conjurar ou Conceder.`);
 }else if(choice.action==='open'){
  if(!picked){ui.notifications.warn('Selecione uma habilidade para abrir.');return false;}
  picked.document.sheet?.render(true);
 }else if(choice.action==='remove'){
  if(isTemplate(picked.document,item))await item.parent.deleteEmbeddedDocuments('Item',[picked.document.id]);
  ui.notifications.info('Registro do item atualizado.');
 }else{
  ui.notifications.info('Habilidades do item atualizadas.');
 }
 return true;
}
