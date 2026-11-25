// Multiverso — Proficiências e Impasses se anulam par a par.
// Regra atual aprovada por Hope: cada Proficiência remanescente vale +3,
// cada Impasse remanescente vale -5. Ex.: 3 P e 2 I -> +3.
export function resolveTestMarks(proficiencies = 0, impasses = 0) {
  const prof = Math.max(0, Math.trunc(Number(proficiencies) || 0));
  const imp = Math.max(0, Math.trunc(Number(impasses) || 0));
  const canceled = Math.min(prof, imp);
  const remainingProf = prof - canceled;
  const remainingImp = imp - canceled;
  const profBonus = remainingProf * 3;
  const impPenalty = remainingImp * 5;
  return {prof, imp, canceled, remainingProf, remainingImp, profBonus, impPenalty, net: profBonus - impPenalty};
}
