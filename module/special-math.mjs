// v0.2.09 — Operações especiais estritamente numéricas para Fluxos atuais.
// Não altera dano manual, efeitos mantidos ou custo da habilidade.
export const SPECIAL_RESOURCE_OPERATIONS=Object.freeze(['multiplicar','maximizar','limitar_minimo','limitar_maximo']);
export function isSpecialResourceOperation(operation){return SPECIAL_RESOURCE_OPERATIONS.includes(operation);}
export function applyResourceOperation({current,maximum,operation,value=0}){
 const before=Number(current),max=Number(maximum),n=Number(value);
 if(!Number.isFinite(before)||!Number.isFinite(max)||max<0)throw Error('Fluxo atual ou máximo inválido.');
 if(operation!=='maximizar' && (!Number.isFinite(n)||n<0))throw Error('Valor da operação especial inválido.');
 let result;
 switch(operation){
  case 'somar':result=before+n;break;
  case 'subtrair':result=before-n;break;
  case 'multiplicar':result=before*n;break;
  case 'maximizar':result=max;break;
  case 'limitar_minimo':result=Math.max(before,n);break;
  case 'limitar_maximo':result=Math.min(before,n);break;
  default:throw Error(`Operação não suportada: ${operation}`);
 }
 if(!Number.isFinite(result))throw Error('Operação resultou em valor inválido.');
 return Math.min(max,Math.max(0,result));
}
export function verifySpecialResourceOperation({type,affected,operation,cadence,diceFormula,resistanceActive,dynamicValue}){
 if(!isSpecialResourceOperation(operation))return null;
 if(type!=='recurso')return 'Operações especiais só são permitidas em Alteração de Fluxo.';
 if(['pv_max','pm_max','sta_max','san_max','outro_max'].includes(affected))return 'Operações especiais alteram Fluxo atual. Para máximo temporário, use Somar/Subtrair.';
 if(cadence!=='once')return 'Operações especiais precisam de Aplicar uma vez (sem repetição ou manutenção).';
 if(diceFormula && !['limitar_minimo','limitar_maximo'].includes(operation))return 'Esta operação especial exige um valor fixo (sem dados).';
 if(resistanceActive || dynamicValue)return 'Operações especiais não aceitam teste de resistência nem escolha dinâmica nesta versão.';
 return null;
}
