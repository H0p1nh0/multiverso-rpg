// Multiverso RPG 1.0.9 — Gestão retroativa de Diários, sem alterar suas páginas.
import { ensureActorDiary, findManagedJournal, linkExistingDiary, unlinkDiary } from './auto-diaries.mjs';

const SYSTEM_ID = 'multiverso-rpg';
const STYLE_URL = `systems/${SYSTEM_ID}/styles/diary-manager-v1.0.9.css?v=1.0.9`;
let openedDialog = null;
let busy = false;

function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.querySelector('link[data-mv-diary-styles="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = STYLE_URL;
  link.dataset.mvDiaryStyles = '1';
  document.head.append(link);
}

function html(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function actors() {
  return [...(game.actors?.contents ?? [])]
    .filter(a => a.type === 'personagem' && !a.pack)
    .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function journalsAvailable() {
  return [...(game.journal?.contents ?? [])]
    .filter(j => !j.pack && !j.getFlag?.(SYSTEM_ID, 'autoDiaryActorId'))
    .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function diaryCard(actor, freeJournals) {
  const journal = findManagedJournal(actor);
  const portrait = html(actor.img || 'icons/svg/mystery-man.svg');
  const name = html(actor.name);
  const options = freeJournals.map(j => `<option value="${html(j.id)}">${html(j.name)}</option>`).join('');
  return `<article class="mv-diary-card" data-diary-actor="${html(actor.id)}">
    <div class="mv-diary-card-heading"><img src="${portrait}" loading="lazy" alt="" />
      <div class="mv-diary-card-title"><strong>${name}</strong><small>${journal ? `Diário vinculado: ${html(journal.name)}` : 'Sem diário vinculado'}</small></div>
      <span class="mv-diary-status ${journal ? 'linked' : 'missing'}">${journal ? '<i class="fa-solid fa-check"></i> Vinculado' : 'Pendente'}</span>
    </div>
    ${journal ? `<div class="mv-diary-card-actions"><button type="button" data-diary-action="open" data-actor-id="${html(actor.id)}"><i class="fa-solid fa-book-open"></i> Abrir diário</button>
      <button type="button" class="mv-diary-outline" data-diary-action="unlink" data-actor-id="${html(actor.id)}"><i class="fa-solid fa-link-slash"></i> Desvincular</button></div>` :
      `<div class="mv-diary-card-actions"><button type="button" data-diary-action="create" data-actor-id="${html(actor.id)}"><i class="fa-solid fa-book-medical"></i> Criar diário</button>
      <div class="mv-diary-link-box"><select aria-label="Journal existente para ${name}" data-diary-select="${html(actor.id)}" ${options ? '' : 'disabled'}>
        ${options ? `<option value="">Selecionar Journal existente...</option>${options}` : '<option value="">Nenhum Journal disponível</option>'}
        </select><button type="button" data-diary-action="link" data-actor-id="${html(actor.id)}" ${options ? '' : 'disabled'}><i class="fa-solid fa-link"></i> Vincular</button></div></div>`}
  </article>`;
}

function managerView() {
  const all = actors();
  const linked = all.filter(a => Boolean(findManagedJournal(a))).length;
  const free = journalsAvailable();
  return `<div class="mv-diary-content">
    <header class="mv-diary-banner"><i class="fa-solid fa-book-open-reader" aria-hidden="true"></i><div><strong>Gerenciar Diários</strong><small>Crie diários para personagens antigos ou vincule Journals já escritos.</small></div></header>
    <div class="mv-diary-summary"><span><b>${linked}</b> vinculados</span><span><b>${all.length-linked}</b> pendentes</span><span><b>${free.length}</b> Journals disponíveis</span>
      <button type="button" data-diary-action="create-all" ${all.length===linked ? 'disabled' : ''}><i class="fa-solid fa-layer-group"></i> Criar os que faltam</button></div>
    <p class="mv-diary-hint"><i class="fa-solid fa-circle-info"></i> Ao vincular um Journal antigo, o texto e o nome são preservados. Ele será movido para <b>Diários</b> e terá as permissões sincronizadas com a ficha.</p>
    <div class="mv-diary-cards">${all.map(a => diaryCard(a, free)).join('') || '<p class="mv-diary-empty">Nenhuma ficha de personagem cadastrada.</p>'}</div>
  </div>`;
}

function refresh(dialog) {
  const target = dialog.element?.querySelector('[data-mv-diary-body]');
  if (target) target.innerHTML = managerView();
}

async function confirm(title, content, yesLabel) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title }, content,
    yes: { label: yesLabel }, no: { label: 'Cancelar' }, rejectClose: false
  });
}

async function handleAction(event, dialog) {
  const button = event.target.closest('[data-diary-action]');
  if (!button || busy || !game.user?.isGM) return;
  const action = button.dataset.diaryAction;
  const actor = game.actors?.get(button.dataset.actorId);
  try {
    if (action === 'open') {
      const journal = actor && findManagedJournal(actor);
      if (journal) journal.sheet?.render(true);
      return;
    }
    if (action === 'create-all') {
      const missing = actors().filter(a => !findManagedJournal(a));
      if (!missing.length) return;
      const ok = await confirm('Criar diários que faltam?', `<p>Criar <b>${missing.length}</b> diário(s) para personagens antigos que ainda não possuem vínculo?</p><p>Os Journals já existentes não serão apagados nem alterados. Se algum já pertence a um personagem, prefira <b>Vincular</b> antes.</p>`, 'Criar diários');
      if (!ok) return;
      busy = true;
      let made = 0; const failures = [];
      for (const current of missing) {
        try { if (await ensureActorDiary(current, { create: true })) made++; }
        catch(err) { failures.push(`${current.name}: ${err?.message || 'erro desconhecido'}`); }
      }
      refresh(dialog);
      if (failures.length) ui.notifications?.warn(`${made} diário(s) criado(s); ${failures.length} falha(s). Consulte o console.`);
      else ui.notifications?.info(`${made} diário(s) criado(s).`);
      if (failures.length) console.error('Multiverso RPG | Diários não criados:', failures);
      return;
    }
    if (!actor || actor.type !== 'personagem') throw new Error('Personagem não encontrado.');
    if (action === 'create') {
      busy = true;
      const journal = await ensureActorDiary(actor, { create: true });
      if (!journal) throw new Error('O diário não pôde ser criado. Confira as permissões do mestre.');
      ui.notifications?.info(`Diário criado para ${actor.name}.`);
    } else if (action === 'link') {
      const selected = dialog.element?.querySelector(`[data-diary-select="${actor.id}"]`)?.value;
      const journal = selected ? game.journal?.get(selected) : null;
      if (!journal) throw new Error('Selecione o Journal que deseja vincular.');
      const ok = await confirm('Vincular Journal à ficha?', `<p>Vincular <b>${html(journal.name)}</b> à ficha <b>${html(actor.name)}</b>?</p><p>As páginas e o nome serão preservados. O Journal ficará na pasta <b>Diários</b> e seus proprietários passarão a ser os mesmos da ficha; jogadores que não são donos da ficha perderão acesso.</p>`, 'Vincular');
      if (!ok) return;
      busy = true;
      await linkExistingDiary(actor, journal);
      ui.notifications?.info(`Journal ${journal.name} vinculado a ${actor.name}.`);
    } else if (action === 'unlink') {
      const journal = findManagedJournal(actor);
      if (!journal) throw new Error('Nenhum diário vinculado a esta ficha.');
      const ok = await confirm('Desvincular diário?', `<p>Remover o vínculo entre <b>${html(actor.name)}</b> e <b>${html(journal.name)}</b>?</p><p>O Journal e todas as páginas continuarão existindo. As permissões atuais permanecerão no documento até você alterá-las ou vinculá-lo novamente.</p>`, 'Desvincular');
      if (!ok) return;
      busy = true;
      await unlinkDiary(actor);
      ui.notifications?.info(`Diário de ${actor.name} desvinculado, sem apagar conteúdo.`);
    } else return;
    refresh(dialog);
  } catch(error) {
    console.error('Multiverso RPG | Gerenciar Diários:', error);
    ui.notifications?.error(error?.message ?? 'Falha ao gerenciar diários.');
  } finally { busy = false; }
}

export async function openDiaryManager() {
  if (!game.user?.isGM) return;
  ensureStyles();
  if (openedDialog?.rendered) { openedDialog.bringToFront(); return openedDialog; }
  const dialog = new foundry.applications.api.DialogV2({
    classes: ['mv-diary-manager-window'],
    window: { title: 'Multiverso RPG • Gerenciar Diários', resizable: true, minimizable: true },
    position: { width: 800, height: 'auto' },
    content: `<div id="mv-diary-layout"><div data-mv-diary-body>${managerView()}</div></div>`,
    buttons: [{ action: 'close', label: 'Fechar', callback: () => null }],
    rejectClose: false
  });
  openedDialog = dialog;
  await dialog.render(true);
  dialog.element?.querySelector('[data-mv-diary-body]')?.addEventListener('click', e => void handleAction(e, dialog));
  return dialog;
}

function injectDiaryButton(app, element) {
  if (!game.user?.isGM) return;
  const root = element?.[0] ?? element ?? app?.element;
  if (!root?.querySelector || root.querySelector('.mv-diary-directory-action')) return;
  const actions = root.querySelector('.directory-header .header-actions, .directory-header .action-buttons, .header-actions, .action-buttons');
  if (!actions) return;
  ensureStyles();
  actions.classList.add('mv-party-action-host'); // Já usado pelo botão de equipe; evita criar espaçamentos extras.
  const wrapper = document.createElement('div');
  wrapper.className = 'mv-diary-directory-action';
  wrapper.style.cssText = 'box-sizing:border-box;display:block;flex:0 0 100%;grid-column:1/-1;width:100%;padding:0;margin:0;';
  const button = document.createElement('button');
  button.type='button'; button.className='mv-diary-directory-button';
  button.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:33px;margin:0;border-radius:6px;';
  button.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i> Gerenciar Diários';
  button.addEventListener('click', () => void openDiaryManager().catch(err => {
    console.error('Multiverso RPG | Abertura do gerenciador de diários:', err);
    ui.notifications?.error('Não foi possível abrir o gerenciador de diários.');
  }));
  wrapper.append(button);
  // Mantém a ordem: Create Entry/Folder, Gerenciar Equipe, Gerenciar Diários.
  const party = actions.querySelector('.mv-party-directory-action');
  if (party) party.after(wrapper);
  else actions.append(wrapper);
}

export function registerDiaryManager() {
  ensureStyles();
  Hooks.on('renderJournalDirectory', injectDiaryButton);
  Hooks.on('renderApplicationV2', (app, element) => {
    if (app?.constructor?.name === 'JournalDirectory') injectDiaryButton(app, element);
  });
  Hooks.once('ready', () => {
    if (ui.journal?.element) injectDiaryButton(ui.journal, ui.journal.element);
  });
}
