// v0.1.79 — Apenas apresentação: não modifica propriedades das regras.
// Campos preenchidos fora do contexto permanecem acessíveis para revisão.
const all=(root,query)=>[...root.querySelectorAll(query)];
export function conditionalIntro(section,peek=()=>'',effectIndex=1){
 const present=(ids)=>ids.some(id=>String(peek(id)??'').trim());
 const checkbox=(key,label,checked,hint='')=>`<label class="mv-ui-switch"><input type="checkbox" data-mv-ui-toggle="${key}" ${checked?'checked':''}><span>${label}</span>${hint?`<small>${hint}</small>`:''}</label>`;
 if(section==='efeito')return checkbox('target','Especificar alvo, teste ou propriedade?',present(['alvo'])||['teste','outro','outro_max'].includes(peek('afetado')),'Opcional; necessário apenas se este efeito apontar para uma propriedade ou teste específico.');
 if(section==='escolhas')return checkbox('choices','Esta habilidade exige escolhas ao usar?',present(['escolhatipo','escolhaquantidade','escolharepetir','escolhaopcoes'])||peek('definicao')==='escolhido');
 if(section==='aplicacao')return checkbox('area','Configurar formato e tamanho de área?',present(['formarea'])||peek('receptor')==='area');
 if(section==='custos')return checkbox('cost','Configurar modificador de custo?',present(['customodificador','custominimo'])||peek('tipo')==='modificador_custo'||peek('afetado')==='modificador_custo')
 +checkbox('usage','Configurar limite de usos ou recarga?',present(['usos','recarga','recargaespecial']));
 return '';
}
function controlValue(wrapper){
 const e=wrapper?.querySelector('[data-mv-key],[data-mv-inner-id]');
 return e?String(e.value??'').trim():'';
}
export function refreshAdaptiveEditor(root){
 const fields=all(root,'[data-mv-field]');
 const wrappers=new Map();
 // Canonical field can appear once in each of two mutually exclusive contexts.
 for(const el of fields){if(!wrappers.has(el.dataset.mvField)||!el.closest('[data-mv-filter-legacy-target]'))wrappers.set(el.dataset.mvField,el);}
 const val=id=>controlValue(wrappers.get(id));
 const toggle=name=>root.querySelector(`[data-mv-ui-toggle="${name}"]`)?.checked??false;
 const tipo=val('tipo'),afetado=val('afetado'),escala=val('escala');
 const registeredExtra=tipo==='recurso'&&['outro','outro_max'].includes(afetado);
 const activity=root.querySelector('[data-mv-canonical-activity]')?.value??'';
 // O destino é implícito para deslocamento; custo já possui configuração própria.
 const destination=root.querySelector('[data-mv-field="afetado"]');
 if(destination){
  const rules={
   atributo:['forca','agilidade','resistencia','inteligencia','carisma','percepcao'],
   teste:['teste'],
   deslocamento:['deslocamento'],defesa:['esquiva','bloqueio'],
   recurso:['pv','pm','sta','san','pv_max','pm_max','sta_max','san_max','outro','outro_max'],cura:['pv'],dano:['pv','dano_adicional'],
   resistencia:['protecao_dano'],vulnerabilidade:['protecao_dano'],imunidade:['protecao_dano'],
   condicao:[]
  };
  const valid=tipo==='dano' ? (activity==='passiva'?['dano_adicional']:['pv']):rules[tipo];
  for(const option of destination.querySelectorAll('option')){
   const allowed=!valid||!option.value||valid.includes(option.value)||option.selected;
   // Uma Skill existente continua legível; novos cadastros não oferecem
   // a mesma alteração em duas categorias diferentes.
   option.hidden=!allowed;option.disabled=!allowed;
  }
  const redundant=['deslocamento','modificador_custo','teste','condicao','dano','resistencia','vulnerabilidade','imunidade'].includes(tipo); // destino determinado pelo tipo
  destination.hidden=redundant;
 }
 const operation=wrappers.get('operacao');
 if(operation){
   const valid=tipo==='teste'?new Set(['somar','subtrair','vantagem','desvantagem']):
    tipo==='recurso'&&['pv','pm','sta','san','outro'].includes(afetado)?new Set(['somar','subtrair','multiplicar','maximizar','limitar_minimo','limitar_maximo']):
    ['atributo','deslocamento','defesa','recurso','dano'].includes(tipo)?new Set(['somar','subtrair']):
    ['resistencia','vulnerabilidade','imunidade'].includes(tipo)?new Set(['conceder','remover']):null;
   for(const o of operation.querySelectorAll('option')){
     const allowed=!valid||!o.value||valid.has(o.value)||o.selected;
     o.hidden=!allowed;o.disabled=!allowed;
   }
 }
 const receptor=val('receptor');
 // Toggles servem apenas para abrir um grupo opcional; onde já é obrigatório,
 // não mostramos um segundo controle que repete a mesma decisão.
 const targetToggle=root.querySelector('[data-mv-ui-toggle="target"]')?.closest('.mv-ui-switch');
 if(targetToggle)targetToggle.hidden=tipo==='teste'||registeredExtra;
 const areaToggle=root.querySelector('[data-mv-ui-toggle="area"]')?.closest('.mv-ui-switch');
 if(areaToggle)areaToggle.hidden=receptor==='area';
 const costToggle=root.querySelector('[data-mv-ui-toggle="cost"]')?.closest('.mv-ui-switch');
 if(costToggle)costToggle.hidden=tipo==='modificador_custo';
 const choicesToggle=root.querySelector('[data-mv-ui-toggle="choices"]')?.closest('.mv-ui-switch');
 if(choicesToggle)choicesToggle.hidden=val('definicao')==='escolhido';
 const damage=tipo==='dano'||['resistencia','vulnerabilidade','imunidade'].includes(tipo)||
   afetado==='dano_adicional'||afetado==='protecao_dano'||
   (['bonus','penalidade','defesa'].includes(tipo)&&!!val('tipodano'));
 const isCost=tipo==='modificador_custo'||afetado==='modificador_custo';
 const costEnabled=toggle('cost')||isCost;
 const costOnly=tipo==='modificador_custo';
 const show=(id,visible)=>{
  const w=wrappers.get(id);if(!w)return;
  const filled=!!val(id);
  w.hidden=!visible&&!filled;
  w.classList.toggle('mv-ui-legacy-filled',!visible&&filled);
  if(!visible&&filled)w.title='Configuração anterior preservada. Confira se ainda pertence a este efeito.';
  else w.removeAttribute('title');
 };
 // A identidade do Fluxo Extra vem da ficha, sem precisar digitar seu nome duas vezes.
 show('alvo',!registeredExtra&&(toggle('target')||tipo==='teste'||['teste','outro','outro_max'].includes(afetado)));
 if(registeredExtra){const target=wrappers.get('alvo');if(target){target.hidden=true;target.classList.remove('mv-ui-legacy-filled');}}
 const rollMode=tipo==='teste'&&['vantagem','desvantagem'].includes(val('operacao'));
 const numeric= !['vantagem','desvantagem','imunidade','vulnerabilidade','sentido'].includes(tipo) && !rollMode && !isCost && escala!=='sem_valor' && !(tipo==='recurso'&&val('operacao')==='maximizar');
 show('valor',numeric);
 // A roll provides the numerical threshold for this activation; it does
 // not modify the number of dice or apply min/max to each individual die.
 const helpTarget=wrappers.get('valor');
 if(helpTarget){
   const limit=['limitar_minimo','limitar_maximo'].includes(val('operacao'))&&tipo==='recurso';
   let note=helpTarget.querySelector('[data-mv-limit-help]');
   if(limit){
     if(!note){note=document.createElement('small');note.dataset.mvLimitHelp='';helpTarget.append(note);}
     note.textContent='Use Valor fixo (ex.: 5) ou Dados (ex.: 1d8). O resultado é o piso/teto do Fluxo atual nesta ativação; não altera os dados individualmente.';
   }else note?.remove();
 }
 // Dano imediato sempre publica dano para aplicação manual; Somar/Subtrair só define
 // a contribuição de uma passiva de Dano. Proteções não usam essa operação.
 const operationVisible=!['resistencia','vulnerabilidade','imunidade','condicao','modificador_custo'].includes(tipo) && (tipo!=='dano'||activity==='passiva');
 show('operacao',operationVisible);
 show('escala',!['vantagem','desvantagem','resistencia','vulnerabilidade','imunidade'].includes(tipo)&&!isCost&&!rollMode);
 show('origemescala',!isCost&&escala==='por_nivel');
 // Cura simples não solicita tipo de dano. Efeitos de proteção continuam usando tipos.
 show('tipodano',damage);
 show('tipodanomodo',tipo==='dano'&&!!val('tipodano'));
 // Não oferecer escolhas sem efeito real para proteções fixas.
 // O motor ignora valores antigos de escala/tipo escolhido nessas proteções.
 if(['resistencia','vulnerabilidade','imunidade'].includes(tipo)){
   for(const id of ['escala','origemescala','tipodanomodo']){
     const wrapper=wrappers.get(id);if(wrapper)wrapper.hidden=true;
   }
 }
 show('condicaores',tipo==='condicao');
 const resistance=['sim','oposto','conjurador'].includes(val('resistenciaativa'));
 const casterOnly=val('resistenciaativa')==='conjurador';
 const opposed=val('resistenciaativa')==='oposto';
 const targetLabel=wrappers.get('resistenciateste')?.querySelector('span');
 const userLabel=wrappers.get('resistenciadt')?.querySelector('span');
 if(targetLabel)targetLabel.textContent=casterOnly?'Perícia do conjurador':opposed?'Perícia do alvo (resiste)':'Teste de resistência';
 if(userLabel)userLabel.textContent=casterOnly?'DT fixa (opcional; vazio = mestre decide)':opposed?'Perícia do usuário (ataca)':'DT / fórmula da DT';
 for(const id of ['resistenciateste','resistenciadt'])show(id,resistance);
 for(const id of ['resistenciafalha','resistenciasucesso'])show(id,resistance&&!opposed&&!casterOnly);
 // Resistências com resultado especial foram dispensadas pelo usuário.

 const choice=toggle('choices')||val('definicao')==='escolhido';
 for(const id of ['escolhatipo','escolhaquantidade','escolharepetir'])show(id,choice);
 show('escolhaopcoes',choice&&val('escolhatipo')==='opcoes');
 const recTargets=['area','alvo'];
 show('alcance',recTargets.includes(receptor));
 show('qtdalvos',recTargets.includes(receptor));
 show('formarea',toggle('area')||receptor==='area');

 const filter=val('filtroaplicacao')==='sim';
 show('filtrotipodano',filter);
 // Filtro de passivo e modificador de custo têm agora campos INDEPENDENTES.
 const inCost=wrappers.get('custoalvohabilidade');
 if(inCost)inCost.hidden=!costEnabled;
 show('custo',!costOnly);
 show('custoopcional',!costOnly);
 show('customodificador',costEnabled);
 show('custominimo',costEnabled);
 const costTargets=root.querySelector('[data-mv-cost-targets]');
 if(costTargets){
  costTargets.hidden=!costEnabled;
  const options=costTargets.querySelector('[data-mv-cost-options]');
  if(options)options.hidden=costTargets.querySelector('select[data-mv-key*="mvCostTargetMode"]')?.value!=='especificas';
 }

 show('usos',toggle('usage'));
 show('recarga',toggle('usage'));
 show('recargaespecial',toggle('usage')&&val('recarga')==='manual');
 // Sustentação é um único bloco, exibindo só a modalidade escolhida.
 const sust=root.querySelector('[data-mv-ui-sustain-mode]');
 const smode=sust?.value??'none';
 for(const node of all(root,'[data-mv-sustain-part]'))node.hidden=node.dataset.mvSustainPart!==smode;
 // Automação avançada progressiva, independente de campos posteriores.
 const pm=valAdvanced(root,'mvPredicateMode');
 const predA=valAdvanced(root,'mvPredicateA');
 const predOn=toggle('predicate')||!!predA||!!pm;
 const second=toggle('second')||pm==='and'||pm==='or';
 const targets={mvPredicateA:predOn,mvPredicateMode:predOn&&second,mvPredicateB:predOn&&second,mvChain:true};
 for(const node of all(root,'[data-mv-advance-control]')){
  const field=node.dataset.mvAdvanceControl;
  const stored=valAdvanced(root,field);
  node.hidden=!(targets[field]??true)&&!stored;
  node.classList.toggle('mv-ui-legacy-filled',!(targets[field]??true)&&!!stored);
 }
 const cb=root.querySelector('[data-mv-ui-toggle="second"]');if(cb)cb.closest('.mv-ui-switch').hidden=!predOn;
 const conditionNote=root.querySelector('[data-mv-conditions-help]');
 if(conditionNote)conditionNote.hidden=predOn;
 const chain=root.querySelector('[data-mv-advance-control="mvChain"]');
 if(chain&&chain.dataset.mvCanChain==='false')chain.hidden=!valAdvanced(root,'mvChain');
 const passive=root.querySelector('[data-mv-passive-targets]');
 if(passive){
   const qualifies=['dano','bonus','penalidade'].includes(tipo)&&(afetado==='dano_adicional'||tipo==='dano'&&!afetado)&&activity==='passiva';
   passive.hidden=!qualifies;
   const opts=passive.querySelector('[data-mv-passive-options]');
   if(opts)opts.hidden=passive.querySelector('select[data-mv-key*="mvPassiveTargetMode"]')?.value!=='especificas';
 }
}
function valAdvanced(root,name){return String(root.querySelector(`[data-mv-advanced-name="${name}"]`)?.value??'');}
export function bindAdaptiveEditor(root){
 if(!root)return;
 refreshAdaptiveEditor(root);
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-mv-ui-toggle]')){
   refreshAdaptiveEditor(root);return;
  }
  // Legacy values intentionally retained when groups are hidden; user must clear them.
  refreshAdaptiveEditor(root);
 });
 root.addEventListener('input',e=>{
  if(e.target.matches('[data-mv-key],[data-mv-inner-id]'))refreshAdaptiveEditor(root);
 });
}
