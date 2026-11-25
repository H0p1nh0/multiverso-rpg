// Resumo VISUAL dos bônus fixos de teste: não altera os dados persistidos nem
// interfere no motor de rolagem (que já soma esses efeitos por conta própria).
import {passiveTests} from './passive-bonuses.mjs';

const normalize = value => String(value ?? '').trim().toLowerCase();
const isOptional = row => normalize(row?.definicao ?? 'fixo') === 'escolhido' || row?.escolhidoAoUsar === true;

// Apenas modificadores numéricos fixos podem ser exibidos como um total estático.
// Efeitos com dados, vantagens, escolhas e modificadores manuais continuam no teste.
export function sumVisibleFixedTestBonuses(sources = []) {
  let bonus = 0;
  const details = [];
  let variable = false;
  for (const row of sources) {
    if (!row || isOptional(row)) continue;
    const kind = normalize(row.tipo);
    if (!['bonus', 'penalidade'].includes(kind)) continue;
    const expression = String(row.formula ?? '').trim().replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(expression)) {
      variable = true;
      continue;
    }
    const amount = kind === 'penalidade' ? -Math.abs(Number(expression)) : Number(expression);
    if (!Number.isFinite(amount)) { variable = true; continue; }
    bonus += amount;
    details.push({ name: String(row.item ?? 'Efeito'), amount });
  }
  return { bonus, details, variable };
}

export function npcFixedTestDisplay(actor, name, key) {
  const native = passiveTests(actor, name);
  // A rolagem recusa testes com passivos inválidos; não prometer bônus no cartão.
  if (native.errors?.length) return { bonus: 0, details: [], variable: false, errors: native.errors };
  const legacy = globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor, key)
    ?? globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor, name) ?? {};
  const sources = [ ...(legacy.fontes ?? []), ...(legacy.modificadores ?? []), ...native.fixed ];
  return { ...sumVisibleFixedTestBonuses(sources), errors: [] };
}
