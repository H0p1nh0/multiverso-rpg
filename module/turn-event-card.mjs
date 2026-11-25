// Multiverso RPG v0.1.84: apresentação isolada dos registros de duração/efeitos.
// Apenas HTML: nunca altera atributos, durações, recursos ou ActiveEffects.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const genericEffectName = name => /^efeito\s+\d+$/i.test(String(name ?? '').trim());

function renderEvent(event) {
  const ended = event.kind === 'ended';
  const source = String(event.source ?? '').trim();
  const name = String(event.name ?? '').trim();
  const displayName = source || (name && !genericEffectName(name) ? name : 'Habilidade');
  const subtitle = name && name !== source && !genericEffectName(name) ? name : '';
  const resource = String(event.resource ?? '').replace(/_atual$/i, '').toUpperCase();
  const detail = ended
    ? (event.maintainedAttribute ? 'Bônus encerrado e atributo restaurado na ficha.' :
      event.maintainedCondition ? 'Condição encerrada e removida da ficha.' : 'Duração concluída.')
    : `${resource || 'Recurso'} atualizado no início do turno.`;
  const value = ended
    ? '<span class="mv-turn-event-result mv-turn-event-result-end">Encerrado</span>'
    : `<span class="mv-turn-event-result"><b>${escapeHtml(resource)}</b> ${escapeHtml(event.before)} <span aria-hidden="true">→</span> <strong>${escapeHtml(event.after)}</strong></span>`;
  return `<div class="mv-turn-event-entry ${ended ? 'mv-turn-event-entry-end' : 'mv-turn-event-entry-change'}">
    <span class="mv-turn-event-symbol" aria-hidden="true">${ended ? '✓' : '↗'}</span>
    <div class="mv-turn-event-info"><strong class="mv-turn-event-source">${escapeHtml(displayName)}</strong>${subtitle ? `<small class="mv-turn-event-effect-name">${escapeHtml(subtitle)}</small>` : ''}<p>${escapeHtml(detail)}</p></div>
    ${value}
  </div>`;
}

export function renderTurnEventCard({actorName,events}) {
  if (!Array.isArray(events) || events.length === 0) return '';
  const endedOnly = events.every(event => event.kind === 'ended');
  const label = endedOnly ? (events.length === 1 ? 'Efeito encerrado' : 'Efeitos encerrados') : 'Efeitos atualizados';
  return `<section class="mv-chat-effect mv-chat-automatic mv-turn-event">
    <header class="mv-turn-event-header">
      <span class="mv-turn-event-ornament" aria-hidden="true">✦</span>
      <div class="mv-turn-event-heading"><small>Multiverso RPG <span aria-hidden="true">•</span> Início do turno</small><strong>${label}</strong></div>
    </header>
    <div class="mv-turn-event-entries">${events.map(renderEvent).join('')}</div>
    <footer class="mv-turn-event-footer"><span aria-hidden="true">◆</span> ${escapeHtml(actorName)} <span aria-hidden="true">•</span> Atualização automática</footer>
  </section>`;
}
