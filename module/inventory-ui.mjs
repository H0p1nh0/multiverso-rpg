import {capacityFactor} from "./condition-mechanics.mjs";
import {itemMotorConfig,useItemMotor,cleanupItemMotor} from './item-motor.mjs';
import {sourceForItem,deleteItemSource,activateItemEffects,hasActivatedItemEffects,hasItemEffects} from './item-effect-links.mjs';
// Inventário visual: organiza os dados reais do Actor sem automatizar efeitos de itens.
const NS = 'multiverso-rpg';
const GROUPS = [
  ['arma','Armas','fa-solid fa-sword'],
  ['protecao','Armaduras e proteções','fa-solid fa-shield-halved'],
  ['consumivel','Consumíveis','fa-solid fa-flask'],
  ['geral','Itens gerais','fa-solid fa-box-open'],
  ['armazenamento','Armazenamento','fa-solid fa-box-archive']
];

export const inventoryCategory = item => {
  const c = String(item.system?.categoria ?? '').trim().toLowerCase();
  if (c === 'kit') return 'consumivel';
  if (c === '' || c === 'outros') return 'geral';
  return GROUPS.some(g => g[0] === c) ? c : 'geral';
};

const esc = x => foundry.utils.escapeHTML(String(x ?? ''));
const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const qty = item => Math.max(0, Math.floor(n(item.system?.quantidade ?? 1)));
const unitWeight = item => n(item.system?.peso);
const mass = item => unitWeight(item) * qty(item);
const fmt = x => n(x).toLocaleString('pt-BR',{maximumFractionDigits:2});
const owned = actor => Boolean(actor.isOwner || game.user?.isGM);
const safeArray = x => Array.isArray(x) ? x : [];
const equipment = actor => Array.from(actor.items ?? []).filter(i => i.type === 'equipamento');
const currencyList = actor => safeArray(actor.getFlag(NS,'inventoryCurrenciesV1')).filter(x=>x && typeof x==='object').map(x=>({id:String(x.id??''),name:String(x.name??'Moeda').slice(0,42),amount:Math.max(0,Math.floor(n(x.amount)))})).filter(x=>x.id);
const rarity = item => String(item.system?.raridade || 'Comum').trim().slice(0,36);
const visibleName = actor => String(actor.name || 'Personagem');
const storageBonus = item => inventoryCategory(item) === 'armazenamento' && item.system?.equipado ? Math.max(0, n(item.system?.props?.capacidadeExtra ?? item.system?.capacidadeExtra ?? 0)) * qty(item) : 0;
const extraStorageBonus = actor => Math.max(0, n(actor.getFlag(NS,'inventoryStorageBonusV1') ?? 0));

async function choose(dialogOptions){
  return foundry.applications.api.DialogV2.wait(dialogOptions);
}
async function askCreate(actor){
  if(!owned(actor)) return ui.notifications.warn('Você não pode criar itens nesta ficha.');
  const choices = GROUPS.map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('');
  // O Enter disparava a ação padrão do DialogV2 antes de ler o campo atualizado.
  // Capturamos o nome na digitação e convertemos Enter em UM clique no botão Criar.
  let draftName='Novo item',draftCategory='arma';
  const captureInput=event=>{
    if(event.target?.matches?.('[data-mv-new-name]'))draftName=event.target.value;
    if(event.target?.matches?.('[data-mv-new-category]'))draftCategory=event.target.value;
  };
  const submitEnter=event=>{
    if(event.key!=='Enter'||!event.target?.matches?.('[data-mv-new-name]'))return;
    const dialog=event.target.closest('.application, .window-app');
    const button=dialog?.querySelector('button[data-action="create"]');
    if(!button||button.disabled)return;
    draftName=event.target.value;
    draftCategory=dialog.querySelector('[data-mv-new-category]')?.value||draftCategory;
    event.preventDefault();event.stopImmediatePropagation();
    button.click();
  };
  document.addEventListener('input',captureInput,true);
  document.addEventListener('change',captureInput,true);
  document.addEventListener('keydown',submitEnter,true);
  let result;
  try{
    result=await choose({
      window:{title:'Criar item'},
      content:`<div class="mv-inventory-prompt"><label>Nome do item<input data-mv-new-name type="text" maxlength="100" value="Novo item" /></label><label>Categoria<select data-mv-new-category>${choices}</select></label></div>`,
      buttons:[
        {action:'cancel',label:'Cancelar',callback:()=>null},
        {action:'create',label:'Criar item',default:true,callback:(_ev,btn,d)=>{
          const form=btn?.form??d?.element;
          return {name:(form?.querySelector('[data-mv-new-name]')?.value??draftName).trim(),category:form?.querySelector('[data-mv-new-category]')?.value??draftCategory};
        }}
      ],rejectClose:false
    });
  }finally{
    document.removeEventListener('input',captureInput,true);
    document.removeEventListener('change',captureInput,true);
    document.removeEventListener('keydown',submitEnter,true);
  }
  if(!result) return;
  if(!result.name) return ui.notifications.warn('Informe um nome para criar o item.');
  const [item] = await actor.createEmbeddedDocuments('Item',[{name:result.name,type:'equipamento',system:{categoria:result.category,quantidade:1,peso:0,props:{capacidadeExtra:0}}}]);
  return item;
}
async function askCurrency(actor, existing){
  if(!owned(actor)) return;
  const result=await choose({window:{title:existing?'Editar moeda':'Adicionar moeda'},content:`<div class="mv-inventory-prompt"><label>Nome da moeda<input data-mv-currency-name type="text" maxlength="42" value="${esc(existing?.name??'')}" placeholder="Ex.: Dracmas, Cristais, Créditos" /></label><label>Quantidade<input data-mv-currency-amount type="number" min="0" step="1" value="${existing?.amount??0}" /></label></div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'save',label:'Salvar',default:true,callback:(_e,b,d)=>({name:d.element.querySelector('[data-mv-currency-name]')?.value?.trim(),amount:Number(d.element.querySelector('[data-mv-currency-amount]')?.value)})}],rejectClose:false});
  if(!result) return;
  if(!result.name || !Number.isSafeInteger(result.amount) || result.amount<0) return ui.notifications.warn('Informe um nome e uma quantidade inteira válida.');
  const list=currencyList(actor);
  const next=existing ? list.map(x=>x.id===existing.id?{...x,name:result.name,amount:result.amount}:x) : [...list,{id:foundry.utils.randomID(),name:result.name,amount:result.amount}];
  await actor.setFlag(NS,'inventoryCurrenciesV1',next);
}
async function removeCurrency(actor,id){
  if(!owned(actor)) return;
  const list=currencyList(actor), found=list.find(x=>x.id===id); if(!found) return;
  const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Remover tipo de moeda'},content:`Remover o registro <strong>${esc(found.name)}</strong> (${found.amount})?`});
  if(yes) await actor.setFlag(NS,'inventoryCurrenciesV1',list.filter(x=>x.id!==id));
}
async function askStorageBonus(actor){
  if(!owned(actor)) return;
  const current = extraStorageBonus(actor);
  const result = await choose({
    window:{title:'Ajustar bônus extra de carga'},
    content:`<div class="mv-inventory-prompt"><label>Bônus extra de capacidade<input data-mv-storage-bonus type="number" min="0" step="any" value="${current}" /></label><small>Use para magias, efeitos ou regras temporárias que aumentem a carga máxima.</small></div>`,
    buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'save',label:'Salvar',default:true,callback:(_e,_b,d)=>Number(d.element.querySelector('[data-mv-storage-bonus]')?.value ?? 0)}],
    rejectClose:false
  });
  if(result===null || result===undefined) return;
  await actor.setFlag(NS,'inventoryStorageBonusV1', Math.max(0, n(result)));
}
export async function useInventoryItem(actor,item){
  if(!item || item.type!=='equipamento' || item.parent?.id!==actor.id) throw Error('Item não encontrado nesta ficha.');
  if(!owned(actor)) throw Error('Você não tem permissão para usar esse item.');
  if(qty(item)<1) throw Error('O item está sem unidades disponíveis.');
  if(item.getFlag(NS,'itemMotorV1'))return useItemMotor(item);
  const category=GROUPS.find(x=>x[0]===inventoryCategory(item))?.[1]??'Item';
  const consumeSetting=item.getFlag(NS,'itemConsumeOnUseV1');
  const consume=consumeSetting===undefined?inventoryCategory(item)==='consumivel':Boolean(consumeSetting);
  const source=sourceForItem(item);
  const configured=hasItemEffects(item);
  const active=hasActivatedItemEffects(item);
  if(consume){
    const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Utilizar item'},content:`Utilizar <strong>${esc(item.name)}</strong> e gastar <strong>1 unidade</strong>?<p>Restam ${qty(item)} unidade(s). O consumo ocorre somente após uma utilização bem-sucedida.</p>`,rejectClose:false});
    if(!yes)return false;
  }
  if(configured&&active){
    // Mesmo executor nativo das Skills. Cancelações NÃO consomem o objeto.
    const result=await activateItemEffects(item);
    if(!result)return false;
  }else{
    // Sem efeitos ativáveis: anúncio narrativo, sem fabricar efeitos ou custos.
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-inventory-use-chat" style="background:#151219;border:1px solid #9b7748;border-radius:12px;padding:14px;color:#ecd6aa"><div style="display:flex;align-items:center;gap:12px"><img src="${esc(item.img||'icons/svg/item-bag.svg')}" alt="" style="width:50px;height:50px;border:1px solid #8b6d44;border-radius:8px;object-fit:cover"/><div><strong style="font:700 22px Georgia,serif;color:#f4d68f">${esc(item.name)}</strong><div>${esc(actor.name)} utilizou este item.</div><small>${esc(category)} • ${configured?'Efeitos passivos disponíveis ao equipar':'Sem efeitos automáticos de uso cadastrados'}</small></div></div>${item.system?.descricao?`<p style="border-top:1px solid #6b5436;margin-top:12px;padding-top:10px">${esc(item.system.descricao)}</p>`:''}</section>`});
  }
  if(consume){
    // Atualizar apenas depois da execução/chat para não gastar em cancelamentos.
    const fresh=actor.items.get(item.id);
    if(!fresh)return ui.notifications.warn('O item foi removido antes do consumo. Confira o inventário.');
    if(qty(fresh)<1)return ui.notifications.warn('O item foi usado, mas sua quantidade mudou. Confira o inventário.');
    // Manter o registro com quantidade 0: durações criadas pelo motor podem
    // precisar da origem do item para continuar sendo acompanhadas.
    await fresh.update({'system.quantidade':qty(fresh)-1});
  }
  return true;
}
async function transferItems(actor,selected){
  if(!owned(actor)) return ui.notifications.warn('Sem permissão para transferir itens.');
  const targets=(game.actors?.contents??[]).filter(x=>x.id!==actor.id && (game.user?.isGM || x.isOwner));
  if(!targets.length) return ui.notifications.warn('Nenhum outro personagem disponível para receber itens.');
  const options=targets.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const multi=selected.length>1;
  const result=await choose({window:{title:'Transferir itens'},content:`<div class="mv-inventory-prompt"><p>${multi?`${selected.length} itens selecionados`:`Transferir ${esc(selected[0].name)}`}</p><label>Personagem de destino<select data-mv-target-actor>${options}</select></label>${multi?'':'<label>Quantidade para transferir<input data-mv-transfer-quantity type="number" min="1" step="1" value="1" /></label>'}</div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'transfer',label:'Transferir',default:true,callback:(_e,b,d)=>({id:d.element.querySelector('[data-mv-target-actor]')?.value,quantity:Number(d.element.querySelector('[data-mv-transfer-quantity]')?.value ?? 1)})}],rejectClose:false});
  if(!result) return;
  const target=game.actors?.get(result.id);
  if(!target || (!game.user?.isGM && !target.isOwner)) throw Error('Destino inválido ou sem permissão de edição.');
  if(!multi && (!Number.isSafeInteger(result.quantity) || result.quantity<1 || result.quantity>qty(selected[0]))) return ui.notifications.warn('Quantidade de transferência inválida.');
  for(const item of selected){
    const count = multi ? qty(item) : result.quantity;
    if(!count) continue;
    const system=item.system.toObject(); system.quantidade=count; system.equipado=false;
    const [copy] = await target.createEmbeddedDocuments('Item',[{name:item.name,type:'equipamento',img:item.img,system,flags:{[NS]:{itemConsumeOnUseV1:item.getFlag(NS,'itemConsumeOnUseV1')??(inventoryCategory(item)==='consumivel'),...item.getFlag(NS,'itemMotorV1')?{itemMotorV1:{...itemMotorConfig(item),synced:false,grantSource:itemMotorConfig(item).grantSource.startsWith('actor:')?'':itemMotorConfig(item).grantSource,castSource:itemMotorConfig(item).castSource.startsWith('actor:')?'':itemMotorConfig(item).castSource}}:{}}}}]);
    if(!copy)throw Error('Não foi possível transferir o item.');
    let copiedSource=null;
    try {
      const original=sourceForItem(item);
      if(original){
        const [created]=await target.createEmbeddedDocuments('Item',[{
          name:original.name,img:original.img,type:'skill',
          system:original.system.toObject(),
          flags:{...foundry.utils.deepClone(original.flags??{}),[NS]:{...(original.flags?.[NS]??{}),itemEffectSourceV1:true,originItemId:copy.id}}
        }]);
        if(!created)throw Error('Não foi possível transferir a configuração dos efeitos.');
        copiedSource=created;
        await copy.setFlag(NS,'itemEffectSourceIdV1',created.id);
      }
      if(count===qty(item)){
        await cleanupItemMotor(item);
        await deleteItemSource(item);
        await item.delete();
      }else await item.update({'system.quantidade':qty(item)-count});
    }catch(error){ await copiedSource?.delete(); await copy.delete(); throw error; }
  }
}
async function discard(actor,items){
  if(!owned(actor)) return;
  const yes = await foundry.applications.api.DialogV2.confirm({window:{title:'Descartar itens'},content:`Descartar ${items.length===1?`<strong>${esc(items[0].name)}</strong>`:`<strong>${items.length} itens</strong>`} da ficha? Esta operação não pode ser desfeita.`});
  if(!yes) return;
  for(const item of items){await cleanupItemMotor(item);await deleteItemSource(item);}
  await actor.deleteEmbeddedDocuments('Item',items.map(x=>x.id));
}
async function setEquipped(actor,items,value){
  if(!owned(actor)) return ui.notifications.warn('Sem permissão para equipar itens.');
  await actor.updateEmbeddedDocuments('Item',items.map(x=>({_id:x.id,'system.equipado':value})));
}
async function setFavorite(item,value){
  if(!item?.isOwner && !game.user?.isGM) throw Error('Você não pode editar os favoritos desse item.');
  await item.setFlag(NS,'inventoryFavoriteV1',Boolean(value));
}
function snapshot(actor){
  const items=equipment(actor);
  const weight=items.reduce((sum,item)=>sum+mass(item),0);
  const strength=Math.max(0,n(actor.system?.forcanumero));
  const itemCapacityBonus=items.reduce((sum,item)=>sum+storageBonus(item),0);
  const extraCapacityBonus=extraStorageBonus(actor);
  const capacityBonus=itemCapacityBonus+extraCapacityBonus;
  const capacityMultiplier=capacityFactor(actor);
  const max=Math.max(0,(5+strength+capacityBonus)*capacityMultiplier);
  return {items,weight,strength,itemCapacityBonus,extraCapacityBonus,capacityBonus,capacityMultiplier,max,percent:max>0?Math.round((weight/max)*100):0,currencies:currencyList(actor)};
}
function normalizeRarityLabel(label){
  return ['comum','incomum','raro','epico','lendario'].includes(String(label).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')) ? String(label).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') : 'custom';
}
function groupMarkup(group,items,selectedIds){
  const [id,name]=group;
  return `<section class="mv-inventory-category" data-mv-inv-group="${id}"><header><h4>${esc(name)}</h4><span>${items.length} ${items.length===1?'item':'itens'}</span></header><div class="mv-inventory-tablehead"><span>Item</span><span>Equip.</span><span>Qtd.</span><span>Peso</span><span>Raridade</span></div><div class="mv-inventory-category-rows">${items.length ? items.map(item=>`<div class="mv-inventory-entry ${selectedIds.has(item.id)?'is-selected':''}" data-mv-inventory-select="${esc(item.id)}" role="button" tabindex="0"><span class="mv-inventory-entry-name"><img src="${esc(item.img||'icons/svg/item-bag.svg')}" alt=""/><span>${item.getFlag(NS,'inventoryFavoriteV1')===true?'<i class="fa-solid fa-star" title="Favorito"></i> ':''}${esc(item.name)}</span></span><label class="mv-inventory-equip" title="Equipar ou guardar item"><input type="checkbox" data-mv-inv-equip="${esc(item.id)}" ${item.system?.equipado?'checked':''} ${!owned(item.parent)?'disabled':''}/><span class="mv-inventory-switch"></span></label><span>${qty(item)}</span><span>${fmt(unitWeight(item))}</span><span class="mv-rarity mv-rarity-${normalizeRarityLabel(rarity(item))}">${esc(rarity(item))}</span></div>`).join('') : '<div class="mv-inventory-empty-group">Nenhum item nesta categoria.</div>'}</div></section>`;
}
function actorNameOfItemSource(item,ref,i){
 const [location,id]=String(ref||'').split(':');
 const src=location==='world'?game.items?.get(id):item.parent?.items?.get(id);
 return src?.name??`Habilidade ${i+1}`;
}
function detailsMarkup(item){
  if(!item) return '';
  const favorite=item.getFlag(NS,'inventoryFavoriteV1')===true;
  const category=GROUPS.find(x=>x[0]===inventoryCategory(item))?.[1] ?? 'Itens';
  const isEquipped=Boolean(item.system?.equipado);
  return `<div class="mv-inventory-detail-inner"><div class="mv-inventory-detail-heading"><h3>${esc(item.name)}</h3><button data-mv-inv-favorite="${esc(item.id)}" title="${favorite?'Remover dos favoritos':'Favoritar item'}" aria-label="${favorite?'Desfavoritar':'Favoritar'} ${esc(item.name)}"><i class="fa-${favorite?'solid':'regular'} fa-star"></i></button></div><div class="mv-inventory-detail-art"><img src="${esc(item.img||'icons/svg/item-bag.svg')}" alt="Imagem de ${esc(item.name)}"/></div><div class="mv-inventory-detail-description">${item.system?.descricao?esc(item.system.descricao):'Nenhuma descrição cadastrada.'}</div><div class="mv-inventory-detail-stats"><span>Categoria <b>${esc(category)}</b></span><span>Equipado <b>${isEquipped?'Sim':'Não'}</b></span><span>Quantidade <b>${qty(item)}</b></span><span>Peso/un. <b>${fmt(unitWeight(item))}</b></span><span>Raridade <b>${esc(rarity(item))}</b></span>${inventoryCategory(item)==='consumivel'&&itemMotorConfig(item).chargesEnabled?`<span>Cargas <b>${itemMotorConfig(item).chargesCurrent} / ${itemMotorConfig(item).chargesMax}</b></span>`:''}${inventoryCategory(item)==='armazenamento'?`<span>Capacidade extra <b>+${fmt(storageBonus(item)/Math.max(1,qty(item)))}</b></span>`:''}</div><div class="mv-inventory-effect-status">${hasItemEffects(item)?'<i class="fa-solid fa-wand-magic-sparkles"></i> Efeitos configurados no motor original':'Nenhum efeito mecânico configurado'}</div><div class="mv-inventory-detail-actions">${(itemMotorConfig(item).castSources||[]).some(Boolean)?`<button class="primary" data-mv-inv-cast="${esc(item.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> Conjurar Habilidade</button>`:''}${(itemMotorConfig(item).enableAttack||itemMotorConfig(item).enableRecovery||itemMotorConfig(item).kind==='utilitario'||!(itemMotorConfig(item).castSources||[]).some(Boolean))?`<button class="primary" data-mv-inv-use="${esc(item.id)}"><i class="fa-solid fa-flask"></i> Usar Item</button>`:''}<button data-mv-inv-favorite="${esc(item.id)}"><i class="fa-${favorite?'solid':'regular'} fa-star"></i> ${favorite?'Desfavoritar':'Favoritar'}</button><button data-mv-inv-toggle-equip="${esc(item.id)}"><i class="fa-solid fa-${isEquipped?'box-archive':'sword'}"></i> ${isEquipped?'Guardar':'Equipar'}</button><button data-mv-inv-transfer="${esc(item.id)}"><i class="fa-solid fa-right-left"></i> Transferir</button><button data-mv-inv-edit="${esc(item.id)}"><i class="fa-solid fa-pen"></i> Editar</button><button class="danger" data-mv-inv-discard="${esc(item.id)}"><i class="fa-solid fa-trash"></i> Descartar</button></div></div>`;
}

export function bindInventoryUI(sheet,root){
  const mount=root.querySelector('[data-mv-inventory-mount]'); if(!mount) return;
  const actor=sheet.actor;
  const isNPC=actor.type==='npc';
  // Identidade: reaproveita os dados oficiais da ficha, sem criar campos paralelos.
  const identityItem = type => Array.from(actor.items ?? []).find(item => item.type===type)?.name ?? '';
  const baseClass=String(actor.system?.classepersonagem || identityItem('classe') || 'A definir').trim();
  const subclass=String(actor.system?.subclassepersonagem || identityItem('subclasse') || '').trim();
  const className=subclass && subclass.toLocaleLowerCase('pt-BR')!==baseClass.toLocaleLowerCase('pt-BR') ? `${baseClass} — ${subclass}` : baseClass;
  const species=String(actor.system?.especiepersonagem || identityItem('especie') || 'A definir').trim();
  const level=Math.max(1,Math.floor(n(actor.system?.nivelpersonagem) || 1));
  const player=String(actor.system?.jogadorpersonagem || '').trim() || '—';
  // NPCs não têm classe, espécie ou nível de personagem. O inventário usa
  // o mesmo Item real, mas o cabeçalho mostra as informações relevantes ao mestre.
  const npcCategory=({comum:'Comum',experiente:'Experiente',especialista:'Especialista',elite:'Elite',lendario:'Lendário'})[actor.system?.npcCategoria]||'Comum';
  const npcRole=String(actor.system?.npcRole||'NPC').trim().slice(0,60);
  const identityFacts=isNPC ? `<div class="mv-inv-id-facts">
    <div class="mv-inv-id-fact wide"><span><i class="fa-solid fa-layer-group" aria-hidden="true"></i> CATEGORIA</span><strong>${esc(npcCategory)}</strong></div>
    <div class="mv-inv-id-fact"><span><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> TIPO</span><strong>${esc(npcRole)}</strong></div>
    <div class="mv-inv-id-fact"><span><i class="fa-solid fa-dumbbell" aria-hidden="true"></i> FORÇA</span><strong>${fmt(actor.system?.forcanumero)}</strong></div>
  </div>` : `<div class="mv-inv-id-facts">
    <div class="mv-inv-id-fact wide"><span><i class="fa-solid fa-hat-wizard" aria-hidden="true"></i> CLASSE / SUBCLASSE</span><strong title="${esc(className)}">${esc(className)}</strong></div>
    <div class="mv-inv-id-fact"><span><i class="fa-solid fa-dna" aria-hidden="true"></i> ESPÉCIE</span><strong>${esc(species)}</strong></div>
    <div class="mv-inv-id-fact"><span><i class="fa-solid fa-medal" aria-hidden="true"></i> NÍVEL</span><strong>${level}</strong></div>
    <div class="mv-inv-id-fact wide"><span><i class="fa-solid fa-user" aria-hidden="true"></i> JOGADOR</span><strong>${esc(player)}</strong></div>
  </div>`;
  const state=sheet._mvInventoryUiState ??= {query:'',category:'todos',rarity:'todas',sort:'tipo',mode:'grouped',selected:null,selectedIds:[]};
  const render=()=>{
    if(searchTimer!==null){clearTimeout(searchTimer);searchTimer=null;}
    const data=snapshot(actor);
    state.selectedIds=(state.selectedIds?.length?state.selectedIds:(state.selected?[state.selected]:[])).filter(id=>data.items.some(x=>x.id===id));
    const selectedIds=new Set(state.selectedIds);
    state.selected=state.selectedIds.length===1?state.selectedIds[0]:null;
    const availableRarities=[...new Set(data.items.map(rarity))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    let filtered=data.items.filter(i=>(state.category==='todos'||inventoryCategory(i)===state.category) && (state.rarity==='todas'||rarity(i)===state.rarity) && i.name.toLocaleLowerCase('pt-BR').includes(state.query.toLocaleLowerCase('pt-BR')));
    const byName=(a,b)=>a.name.localeCompare(b.name,'pt-BR');
    if(state.sort==='nome') filtered.sort(byName);
    else if(state.sort==='peso') filtered.sort((a,b)=>mass(b)-mass(a)||byName(a,b));
    else if(state.sort==='quantidade') filtered.sort((a,b)=>qty(b)-qty(a)||byName(a,b));
    else filtered.sort((a,b)=>inventoryCategory(a).localeCompare(inventoryCategory(b))||byName(a,b));
    const grouped = state.mode==='list' ? [['todos','Todos os itens']] : GROUPS;
    const categories = grouped.map(group=>groupMarkup(group,filtered.filter(i=>group[0]==='todos'||inventoryCategory(i)===group[0]),selectedIds)).join('');
    const selected=data.items.find(i=>i.id===state.selected) ?? null;
    const selectedItems=data.items.filter(i=>selectedIds.has(i.id));
    const hasSelection=selectedItems.length>0;
    const selectionDetail=selectedItems.length>1?`<div class="mv-inventory-multiselect"><i class="fa-solid fa-layer-group"></i><h3>${selectedItems.length} itens selecionados</h3><p>Use Ctrl + clique para adicionar ou retirar itens da seleção. As ações rápidas abaixo serão executadas sobre o conjunto.</p><div>${selectedItems.map(i=>`<span>${esc(i.name)} (${qty(i)})</span>`).join('')}</div></div>`:'';
    const categoryOptions=GROUPS.map(([id,name])=>`<option value="${id}" ${state.category===id?'selected':''}>${esc(name)}</option>`).join('');
    const rarityOptions=availableRarities.map(r=>`<option value="${esc(r)}" ${state.rarity===r?'selected':''}>${esc(r)}</option>`).join('');
    const fill=Math.max(0,Math.min(data.percent,100));
    const currencyMarkup=data.currencies.length ? data.currencies.map(c=>`<button class="mv-inv-currency" data-mv-inv-currency-edit="${esc(c.id)}" title="Editar ${esc(c.name)}"><i class="fa-solid fa-coins"></i><span><b>${c.amount.toLocaleString('pt-BR')}</b><small>${esc(c.name)}</small></span></button>`).join('') : '<small class="mv-inv-no-currency">Nenhuma moeda cadastrada.</small>';
    // O cabeçalho principal já identifica o NPC: no inventário mostramos apenas
    // os dados relevantes (carga e moedas), evitando imagem/nome duplicados.
    const identitySummary = isNPC ? '' : `<div class="mv-inv-identity" aria-label="Resumo do personagem">
        <div class="mv-inv-id-top">
          <img src="${esc(actor.img||'icons/svg/mystery-man.svg')}" alt="Retrato de ${esc(actor.name)}"/>
          <div class="mv-inv-id-title"><small><i class="fa-solid fa-compass" aria-hidden="true"></i> PERSONAGEM</small><strong>${esc(actor.name)}</strong><span>Inventário do personagem</span></div>
        </div>
        ${identityFacts}
      </div>`;
    const capacityFormula = isNPC
      ? `<div class="mv-npc-capacity-pills" aria-label="Cálculo da capacidade de carga">
          <span>Base <b>5</b></span><span>Força <b>${fmt(data.strength)}</b></span>
          <span>Armazenamento <b>${fmt(data.itemCapacityBonus)}</b></span>
          <span>Outras fontes <b>${fmt(data.extraCapacityBonus)}</b></span>
          <span>Condições <b>${fmt((data.capacityMultiplier-1)*100)}%</b></span>
        </div>`
      : `<div class="mv-inv-capacity-formula-text">Base <b>5</b> • Força <b>${fmt(data.strength)}</b> • Armazenamento <b>${fmt(data.itemCapacityBonus)}</b> • Outras fontes <b>${fmt(data.extraCapacityBonus)}</b> • Condições <b>${fmt((data.capacityMultiplier-1)*100)}%</b> • Total <b>${fmt(data.max)}</b></div>`;
    mount.innerHTML = `<div class="mv-inventory-v218 ${state.mode==='list'?'mv-inv-list-mode':'mv-inv-group-mode'}">
      <div class="mv-inv-summary ${isNPC?'mv-npc-inv-summary':''}">${identitySummary}
        <div class="mv-inv-carry"><div class="mv-inv-carry-head"><label>CAPACIDADE DE CARGA</label><button type="button" data-mv-inv-storage-extra title="Ajustar bônus extra de capacidade"><i class="fa-solid fa-wand-magic-sparkles"></i> Bônus extra</button></div><div class="mv-npc-capacity-amount"><strong>${fmt(data.weight)} <small>/ ${fmt(data.max)} de peso</small></strong><span>${data.percent}%</span></div><div class="mv-inv-loadbar"><span style="width:${fill}%;${data.percent>100?'background:#b74c4c':''}"></span></div>${capacityFormula}<small class="mv-inv-capacity-note">Use "Outras fontes" para magias, efeitos temporários e quaisquer bônus que também aumentem a capacidade.</small></div>
        <div class="mv-inv-money"><div class="mv-inv-money-head"><label>MOEDAS</label><button data-mv-inv-currency-add><i class="fa-solid fa-plus"></i> Adicionar</button></div><div class="mv-inv-money-list">${currencyMarkup}</div></div>
      </div>
      <div class="mv-inv-toolbar"><input data-mv-inv-search type="search" value="${esc(state.query)}" placeholder="Buscar item..." aria-label="Buscar item"/><select data-mv-inv-filter-category aria-label="Filtrar categoria"><option value="todos">Todas as categorias</option>${categoryOptions}</select><select data-mv-inv-filter-rarity aria-label="Filtrar raridade"><option value="todas">Todas as raridades</option>${rarityOptions}</select><select data-mv-inv-sort aria-label="Ordenar itens"><option value="tipo" ${state.sort==='tipo'?'selected':''}>Ordenar por categoria</option><option value="nome" ${state.sort==='nome'?'selected':''}>Ordenar por nome</option><option value="peso" ${state.sort==='peso'?'selected':''}>Maior peso</option><option value="quantidade" ${state.sort==='quantidade'?'selected':''}>Maior quantidade</option></select><button data-mv-inv-mode="${state.mode==='grouped'?'list':'grouped'}" title="Alternar visualização"><i class="fa-solid fa-${state.mode==='grouped'?'list':'table-cells-large'}"></i></button><button class="mv-inv-create" data-mv-inv-create><i class="fa-solid fa-circle-plus"></i> Criar item</button></div>
      <div class="mv-inv-body ${hasSelection?'has-detail':'no-detail'}"><div class="mv-inventory-groups">${categories}</div>${hasSelection?`<aside class="mv-inventory-detail" aria-label="Itens selecionados">${selectedItems.length>1?selectionDetail:detailsMarkup(selected)}</aside>`:''}</div>
      <footer class="mv-inv-footer"><div class="mv-inv-footer-status"><strong>CARGA</strong><span>${data.weight<=data.max?'Dentro da capacidade':'Acima da capacidade'}</span><small>${data.items.length} itens cadastrados • sem limite por categoria</small></div><div class="mv-inv-bulk"><strong>AÇÕES RÁPIDAS <small>${selectedItems.length===1?esc(selected.name):selectedItems.length>1?selectedItems.length+' itens selecionados':'nenhum item selecionado'}</small></strong><div><button data-mv-inv-selected="use" ${hasSelection?'':'disabled'}>Usar</button><button data-mv-inv-selected="store" ${hasSelection?'':'disabled'}>${selectedItems.some(i=>!i.system?.equipado)?'Equipar':'Guardar'}</button><button data-mv-inv-selected="transfer" ${hasSelection?'':'disabled'}>Transferir</button><button data-mv-inv-selected="discard" ${hasSelection?'':'disabled'}>Descartar</button></div></div></footer>
      </div>`;
  };
  let searchTimer=null;
  const rerender=()=>render();
  render();

  mount.addEventListener('input',event=>{
    const el=event.target;
    if(el.matches('[data-mv-inv-search]')){
      state.query=el.value;
      const a=el.selectionStart,b=el.selectionEnd;
      if(searchTimer!==null)clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{
        searchTimer=null;
        if(!mount.isConnected)return;
        render();
        const x=mount.querySelector('[data-mv-inv-search]');
        x?.focus();try{x?.setSelectionRange(a,b);}catch{}
      },100);
    }
  });
  mount.addEventListener('change',async event=>{
    const el=event.target;
    if(el.matches('[data-mv-inv-filter-category]')){ state.category=el.value; return rerender(); }
    if(el.matches('[data-mv-inv-filter-rarity]')){ state.rarity=el.value; return rerender(); }
    if(el.matches('[data-mv-inv-sort]')){ state.sort=el.value; return rerender(); }
    if(el.matches('[data-mv-inv-equip]')){
      const item=actor.items.get(el.dataset.mvInvEquip); if(!item) return;
      try{ await setEquipped(actor,[item],el.checked); rerender(); }catch(error){ ui.notifications.error(error.message); rerender(); }
    }
  });
  mount.addEventListener('click',async event=>{
    const button=event.target.closest('[data-mv-inv-mode], [data-mv-inv-create], [data-mv-inv-currency-add], [data-mv-inv-currency-edit], [data-mv-inv-favorite], [data-mv-inv-use], [data-mv-inv-cast], [data-mv-inv-store], [data-mv-inv-transfer], [data-mv-inv-edit], [data-mv-inv-discard], [data-mv-inv-selected], [data-mv-inventory-select], [data-mv-inv-toggle-equip], [data-mv-inv-storage-extra]');
    if(!button || event.target.closest('input,select,.mv-inventory-equip')) return;
    if(button.dataset.mvInventorySelect){
      const id=button.dataset.mvInventorySelect;
      const ids=new Set(state.selectedIds??[]);
      if(event.ctrlKey||event.metaKey){if(ids.has(id))ids.delete(id);else ids.add(id);}
      else if(ids.size===1&&ids.has(id))ids.clear();
      else {ids.clear();ids.add(id);}
      state.selectedIds=[...ids];state.selected=ids.size===1?[...ids][0]:null;
      return rerender();
    }
    try{
      if(button.hasAttribute('data-mv-inv-mode')){ state.mode=button.dataset.mvInvMode; return rerender(); }
      if(button.hasAttribute('data-mv-inv-storage-extra')){ await askStorageBonus(actor); sheet.render(false); return; }
      if(button.hasAttribute('data-mv-inv-create')){ const item=await askCreate(actor); if(item){state.selected=item.id;state.selectedIds=[item.id];} sheet.render(false); return; }
      if(button.hasAttribute('data-mv-inv-currency-add')){ await askCurrency(actor); sheet.render(false); return; }
      if(button.hasAttribute('data-mv-inv-currency-edit')){ const c=currencyList(actor).find(x=>x.id===button.dataset.mvInvCurrencyEdit); if(!c) return; const result=await choose({window:{title:esc(c.name)},content:`<p>Deseja editar ou remover este tipo de moeda?</p>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'delete',label:'Remover',callback:()=> 'delete'},{action:'edit',label:'Editar',default:true,callback:()=> 'edit'}],rejectClose:false}); if(result==='delete') await removeCurrency(actor,c.id); if(result==='edit') await askCurrency(actor,c); sheet.render(false); return; }
      if(button.hasAttribute('data-mv-inv-selected')){
        const currents=(state.selectedIds??[]).map(id=>actor.items.get(id)).filter(i=>i?.type==='equipamento');
        if(!currents.length)return;
        const action=button.dataset.mvInvSelected;
        if(action==='store')await setEquipped(actor,currents,currents.some(i=>!i.system?.equipado));
        if(action==='transfer')await transferItems(actor,currents);
        if(action==='discard')await discard(actor,currents);
        if(action==='use')for(const item of currents){if(actor.items.get(item.id))await useInventoryItem(actor,item);}
        if(['transfer','discard'].includes(action)){state.selectedIds=[];state.selected=null;}
        sheet.render(false);return;
      }
      const key = button.dataset.mvInvFavorite ?? button.dataset.mvInvUse ?? button.dataset.mvInvCast ?? button.dataset.mvInvStore ?? button.dataset.mvInvTransfer ?? button.dataset.mvInvEdit ?? button.dataset.mvInvDiscard ?? button.dataset.mvInvToggleEquip;
      const item = actor.items.get(key); if(!item) return;
      if(button.hasAttribute('data-mv-inv-favorite')) await setFavorite(item,item.getFlag(NS,'inventoryFavoriteV1')!==true);
      if(button.hasAttribute('data-mv-inv-use')) await useInventoryItem(actor,item);
      if(button.hasAttribute('data-mv-inv-cast'))await useItemMotor(item,{operationMode:'cast'});
      if(button.hasAttribute('data-mv-inv-store')) await setEquipped(actor,[item],false);
      if(button.hasAttribute('data-mv-inv-toggle-equip')) await setEquipped(actor,[item],!item.system?.equipado);
      if(button.hasAttribute('data-mv-inv-transfer')) await transferItems(actor,[item]);
      if(button.hasAttribute('data-mv-inv-edit')){ item.sheet?.render(true); return; }
      if(button.hasAttribute('data-mv-inv-discard')) await discard(actor,[item]);
      sheet.render(false);
    }catch(error){ console.error('Multiverso | Inventário',error); ui.notifications.error(error?.message??'Não foi possível concluir a operação.'); rerender(); }
  });
  mount.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-mv-inventory-select]')){e.preventDefault();const id=e.target.dataset.mvInventorySelect;const ids=new Set(state.selectedIds??[]);if(e.ctrlKey||e.metaKey){if(ids.has(id))ids.delete(id);else ids.add(id);}else if(ids.size===1&&ids.has(id))ids.clear();else {ids.clear();ids.add(id);}state.selectedIds=[...ids];state.selected=ids.size===1?[...ids][0]:null;rerender();}});
}
