// v0.2.34 — Efeitos manuais com editor compartilhado e ativação passiva reconhecida.
// Não há um segundo formulário de mecânicas: os registros são Itens de tipo skill.
import {openMultiversoSkillEffectEditor} from './skill-editor-original.mjs';
import {executeNativeEffectTest} from './native-effects.mjs';
const NS='multiverso-rpg';
export const isManualEffectSource=item=>item?.getFlag?.(NS,'manualEffectSourceV1')===true;
const canEdit=actor=>Boolean(actor?.isOwner||game.user?.isGM);
const str=x=>String(x??'').trim();
const legacyMap={forcanumero:'forca',agilidadenumero:'agilidade',resistencianumero:'resistencia',inteligencianumero:'inteligencia',carismanumero:'carisma',percepcaonumero:'percepcao',esquivabonus:'esquiva',bloqueiobonus:'bloqueio',deslocamentonumero:'deslocamento',pv_max:'pv_max',pm_max:'pm_max',sta_max:'sta_max',san_max:'san_max'};
function convertLegacy(config){
  const canonical=Array.isArray(config?.canonicalEffects)?config.canonicalEffects:(config?.modifiers??[]).map(mod=>{
    const type=str(mod.type),value=Number(mod.value)||0,target=str(mod.target);
    if(type.startsWith('resistencia'))return {tipo:'resistencia',afetado:'protecao_dano',tipodano:target,valor:type==='resistencia-metade'?'50':String(value),escala:type==='resistencia-metade'?'percentual':'fixo',operacao:'conceder'};
    if(['imunidade','vulnerabilidade'].includes(type))return {tipo:type,afetado:'protecao_dano',tipodano:target,operacao:'conceder'};
    if(type==='bonus-atributo')return {tipo:['esquivabonus','bloqueiobonus'].includes(target)?'defesa':target==='deslocamentonumero'?'deslocamento':'atributo',afetado:legacyMap[target]||'',operacao:value<0?'subtrair':'somar',valor:String(Math.abs(value)),escala:'fixo'};
    if(type==='restricao')return {tipo:'condicao',condicaores:target,detalhe:mod.note||''};
    return {tipo:'condicao',detalhe:mod.note||''};
  });
  const props={mvEffectCount:Math.min(5,canonical.length||1),descricaoskill:str(config?.description)};
  const note=[];
  for(const [i,e] of canonical.slice(0,5).entries()){
    const ix=i===0?'':String(i+1),slot=i+1;
    const set=(field,v)=>{if(v!==undefined&&v!==null&&str(v))props[`efeitoskill${field}${ix}`]=str(v);};
    for(const field of ['tipo','receptor','definicao','afetado','alvo','operacao','valor','escala','origemescala','tipodano','tipodanomodo','condicaores','resistenciaativa','resistenciateste','resistenciadt','resistenciafalha','resistenciasucesso','escolhatipo','escolhaquantidade','escolharepetir','escolhaopcoes','duracao','alcance','qtdalvos','formarea','custo','custoopcional','usos','recarga','acumulo','nome','detalhe'])set(field,e?.[field]);
    set('receptor',e?.receptor||'proprio');
    set('definicao',e?.definicao||'fixo');
    set('operacao',e?.operacao||'somar');
    set('escala',e?.escala||'fixo');
    props[`ativacaotempotiposkill${ix}`]='livre';
    props[`mvEffectTitle${slot}`]=str(e?.nome)||`Efeito ${slot}`;
    if(e?.modoProtecao==='percentual'){
      props[`efeitoskillescala${ix}`]='percentual';
      props[`efeitoskillvalor${ix}`]='50';
      note.push(`Resistência percentual no efeito ${slot}: confira antes de executar. O executor de proteção mantida requer resistência fixa; passivas possuem regras próprias.`);
    }
  }
  if(canonical.length>5)note.push(`O registro antigo tinha ${canonical.length} modificadores; apenas os 5 primeiros foram copiados. Os originais permanecem no ActiveEffect legado.`);
  return {props,note};
}
async function createSource(actor,{name,img='icons/svg/aura.svg',description='',props={},legacyEffectId=null,notes=[]}){
  if(!canEdit(actor))throw Error('Sem permissão para criar efeitos neste personagem.');
  const flags={[NS]:{manualEffectSourceV1:true,legacyEffectId,legacyNotes:notes}};
  // A origem mantém o formato de Skill apenas internamente, para reutilizar o editor
  // e os coletores passivos já existentes. Na ficha é tratada como Efeito.
  const configured={mvEffectCount:1,...props};
  const total=Math.min(5,Math.max(1,Number(configured.mvEffectCount)||1));
  for(let i=1;i<=total;i++){
    const suffix=i===1?'':String(i);
    configured[`ativacaotempotiposkill${suffix}`]='passiva';
    configured[`efeitoskillreceptor${suffix}`]='proprio';
    configured[`efeitoskilldefinicao${suffix}`] ||= 'fixo';
    configured[`efeitoskilloperacao${suffix}`] ||= 'somar';
    configured[`efeitoskillescala${suffix}`] ||= 'fixo';
  }
  const [item]=await actor.createEmbeddedDocuments('Item',[{name,type:'skill',img,system:{descricao:description,props:configured},flags}]);
  if(!item)throw Error('Não foi possível criar a origem do efeito.');
  return item;
}
export async function createManualEffectSource(actor){
  if(!canEdit(actor))throw Error('Sem permissão para criar efeitos neste personagem.');
  const result=await foundry.applications.api.DialogV2.wait({
    window:{title:'Adicionar efeito'},
    content:`<div class="mv-ef-source-dialog"><label>Nome do efeito<input type="text" data-mv-source-name maxlength="120" placeholder="Ex.: Proteção Elemental" /></label><small>O efeito fica no personagem. Abra-o para configurar seus modificadores.</small></div>`,
    buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'create',label:'Criar efeito',default:true,callback:(_e,_b,d)=>d.element.querySelector('[data-mv-source-name]')?.value?.trim()??''}],rejectClose:false
  });
  if(result===null||result===undefined)return null;
  if(!result)return ui.notifications.warn('Informe o nome do efeito.');
  const item=await createSource(actor,{name:result});
  openMultiversoSkillEffectEditor(item);
  return item;
}
export async function getOrCreateSourceForLegacy(actor,effect){
  if(!effect?.getFlag?.(NS,'manualOverviewEffectV1'))throw Error('Esse efeito não pertence ao cadastro manual anterior.');
  if(!canEdit(actor))throw Error('Sem permissão para editar este efeito.');
  const linked=[...(actor.items??[])].find(i=>isManualEffectSource(i)&&i.getFlag(NS,'legacyEffectId')===effect.id);
  if(linked)return linked;
  const cfg=effect.flags?.[NS]?.manualOverviewConfig??{};
  const {props,note}=convertLegacy(cfg);
  const item=await createSource(actor,{name:effect.name,img:effect.img,description:cfg.description??effect.description??'',props,legacyEffectId:effect.id,notes:note});
  // Mantém o AE original intocado. O novo editor usa o mesmo motor de Skills.
  await effect.setFlag(NS,'manualOverviewSourceItemId',item.id);
  ui.notifications.info('Efeito antigo preservado. Um registro editável foi criado; enquanto o efeito anterior estiver ativo, modificadores duplicados não serão aplicados.');
  return item;
}
export function manualSources(actor){return [...(actor.items??[])].filter(isManualEffectSource);}
export async function openManualEffectSource(item){
  if(!isManualEffectSource(item))throw Error('Origem de efeito inválida.');
  if(!canEdit(item.parent))throw Error('Sem permissão para editar o efeito.');
  // Adaptação única dos registros que vieram da v0.2.33: cada modificador
  // passa a ser contínuo, não uma ação ou rolagem de habilidade.
  const props=item.system?.props??{};
  const patch={};
  const total=Math.max(1,Math.min(5,Number(props.mvEffectCount)||1));
  for(let i=1;i<=total;i++){
    const suffix=i===1?'':String(i);
    const key=`ativacaotempotiposkill${suffix}`;
    if(String(props[key]??'')!=='passiva')patch[`system.props.${key}`]='passiva';
    const receiver=`efeitoskillreceptor${suffix}`;
    if(String(props[receiver]??'')!=='proprio')patch[`system.props.${receiver}`]='proprio';
  }
  if(Object.keys(patch).length)await item.update(patch);
  openMultiversoSkillEffectEditor(item);
}
export async function applyManualEffectSource(item){
  if(!isManualEffectSource(item))throw Error('Origem de efeito inválida.');
  const actor=item.parent;
  if(!canEdit(actor))throw Error('Sem permissão para executar o efeito.');
  const legacyId=item.getFlag(NS,'legacyEffectId');
  if(legacyId&&actor.effects?.get(legacyId)&&!actor.effects.get(legacyId).disabled){
    ui.notifications.warn('A versão antiga deste efeito ainda está ativa. Encerre-a antes de executar a nova configuração, para evitar aplicar bônus duplicados.');
    return false;
  }
  // Executa exatamente o mesmo motor de uma Skill/Técnica, inclusive diagnósticos,
  // escolhas, ação, custos, confirmação, chat e aplicação.
  return executeNativeEffectTest(item);
}
