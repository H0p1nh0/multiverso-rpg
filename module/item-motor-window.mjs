// Multiverso RPG v0.2.45 — janela independente com autosave e botão interno de fechamento oculto.
// Reutiliza o formulário e o salvamento de item-motor-ui.mjs, sem duplicar mecânicas.
import {mountItemMotor} from './item-motor-ui.mjs';

const openWindows=new Map();

export async function openItemMotorWindow(sheet){
  const item=sheet?.item;
  if(!item||item.type!=='equipamento')throw Error('O Motor do Item só pode ser aberto para equipamentos.');
  const key=item.uuid??item.id;
  const existing=openWindows.get(key);
  if(existing?.rendered){
    existing.bringToFront();
    return existing;
  }
  openWindows.delete(key);
  const esc=value=>foundry.utils.escapeHTML(String(value??''));
  const dialog=new foundry.applications.api.DialogV2({
    classes:['multiverso-item-sheet','mv-item-motor-window'],
    window:{title:`Multiverso RPG • Motor do Item: ${item.name}`,resizable:true,minimizable:true},
    position:{width:960,height:780},
    content:`<div class="mv-item-motor-dialog-content"><header class="mv-item-motor-dialog-head">
      <img src="${esc(item.img||'icons/svg/item-bag.svg')}" alt=""/>
      <div><span>CONFIGURAÇÃO MECÂNICA DO ITEM</span><h2>${esc(item.name)}</h2><p>Ataques, danos, recuperação, cargas, habilidades e efeitos opcionais.</p></div>
    </header><div data-mv-item-motor></div></div>`,
    // O DialogV2 do Foundry 14 exige ao menos um botão configurado.
    // O fechamento visível continua pelo X; o botão interno fica oculto via CSS.
    buttons:[{action:'close',label:'Fechar',callback:()=>null}],
    rejectClose:false
  });
  openWindows.set(key,dialog);
  try{
    await dialog.render(true);
    mountItemMotor(sheet,dialog.element);
    return dialog;
  }catch(error){
    openWindows.delete(key);
    try{await dialog.close();}catch{}
    throw error;
  }
}
