import './admin.css';
import { dollarsToCents, formatSignedUsd, formatUsd } from '../../src/shared/money.ts';
import type {
  AdminHand,
  AdminSessionDetail,
  AdminSessionSummary,
  AdminSettings,
  AdminStats,
  AuditEntry,
  DealerCardView,
} from '../../src/shared/types.ts';

class ApiError extends Error {}

const app = document.querySelector('#app');
if (!app) throw new Error('Missing #app');

let username = '';
let stats: AdminStats | null = null;
let settings: AdminSettings | null = null;
let sessions: AdminSessionSummary[] = [];
let detail: AdminSessionDetail | null = null;
let audit: AuditEntry[] = [];
let errorMessage = '';
let notice = '';

document.body.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.dataset.form === 'login') void login(form);
  if (form.dataset.form === 'settings') void saveSettings(form);
  if (form.dataset.form === 'search') void loadSessions(new FormData(form).get('q')?.toString() ?? '');
});

document.body.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action], [data-session]');
  if (!target) return;
  if (target.dataset.session) void openSession(target.dataset.session);
  const action = target.dataset.action;
  if (action === 'logout') void logout();
  if (action === 'adjust') void adjust();
  if (action === 'ban') void ban(true);
  if (action === 'unban') void ban(false);
  if (action === 'hide') void visibility(true);
  if (action === 'show') void visibility(false);
});

void boot();

async function boot(): Promise<void> {
  try {
    const me = await request<{ username: string }>('/admin/api/me');
    username = me.username;
    await reload();
  } catch {
    renderLogin();
  }
}

async function login(form: HTMLFormElement): Promise<void> {
  errorMessage = '';
  const data = new FormData(form);
  try {
    const me = await request<{ username: string }>('/admin/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
    });
    username = me.username;
    await reload();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Sign-in failed';
    renderLogin();
  }
}

async function logout(): Promise<void> {
  await request('/admin/api/logout', { method: 'POST' });
  username = '';
  renderLogin();
}

async function reload(): Promise<void> {
  stats = await request<AdminStats>('/admin/api/stats');
  settings = await request<AdminSettings>('/admin/api/settings');
  audit = (await request<{ entries: AuditEntry[] }>('/admin/api/audit')).entries;
  await loadSessions('');
}

async function loadSessions(query: string): Promise<void> {
  const path = query ? `/admin/api/sessions?q=${encodeURIComponent(query)}` : '/admin/api/sessions';
  sessions = (await request<{ sessions: AdminSessionSummary[] }>(path)).sessions;
  if (detail && !sessions.some((session) => session.id === detail?.session.id)) {
    detail = null;
  }
  renderHouse();
}

async function openSession(id: string): Promise<void> {
  detail = await request<AdminSessionDetail>(`/admin/api/sessions/${id}`);
  renderHouse();
}

async function saveSettings(form: HTMLFormElement): Promise<void> {
  if (!settings) return;
  errorMessage = '';
  notice = '';
  const data = new FormData(form);
  const startingBankrollCents = dollarsToCents(String(data.get('starting') ?? ''));
  const decks = Number(data.get('decks'));
  const hitSoft17 = data.get('hitSoft17') === 'on';
  if (startingBankrollCents == null) {
    errorMessage = 'Enter a whole dollar starting stack.';
    renderHouse();
    return;
  }
  try {
    settings = await request<AdminSettings>('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ decks, hitSoft17, startingBankrollCents }),
    });
    notice = 'Table rules saved. They apply to the next hand.';
    audit = (await request<{ entries: AuditEntry[] }>('/admin/api/audit')).entries;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Could not save settings';
  }
  renderHouse();
}

async function adjust(): Promise<void> {
  if (!detail) return;
  const amount = dollarsToCents(valueOf('adjust-amount'));
  const reason = valueOf('reason').trim();
  if (amount == null || amount === 0) {
    errorMessage = 'Enter a chip change such as 25 or -10.50.';
    renderHouse();
    return;
  }
  await mutate(`/admin/api/sessions/${detail.session.id}/adjust`, { deltaCents: amount, reason });
}

async function ban(banned: boolean): Promise<void> {
  if (!detail) return;
  const reason = valueOf('reason').trim();
  const path = banned ? 'ban' : 'unban';
  await mutate(`/admin/api/sessions/${detail.session.id}/${path}`, banned ? { reason } : { reason: reason || 'Lifted by the house' });
}

async function visibility(hidden: boolean): Promise<void> {
  if (!detail) return;
  await mutate(`/admin/api/sessions/${detail.session.id}/visibility`, { hidden });
}

async function mutate(path: string, body: unknown): Promise<void> {
  errorMessage = '';
  notice = '';
  try {
    await request(path, { method: 'POST', body: JSON.stringify(body) });
    notice = 'Saved.';
    if (detail) detail = await request<AdminSessionDetail>(`/admin/api/sessions/${detail.session.id}`);
    stats = await request<AdminStats>('/admin/api/stats');
    sessions = (await request<{ sessions: AdminSessionSummary[] }>('/admin/api/sessions')).sessions;
    audit = (await request<{ entries: AuditEntry[] }>('/admin/api/audit')).entries;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Request failed';
  }
  renderHouse();
}

function renderLogin(): void {
  app!.innerHTML = `
    <main class="login-wrap">
      <form class="card login" data-form="login">
        <h1>House</h1>
        <p class="muted">Operator access. This door is not part of the game.</p>
        <label for="username">Username <input id="username" name="username" autocomplete="username" required></label>
        <label for="password">Password <input id="password" name="password" type="password" autocomplete="current-password" required></label>
        ${errorMessage ? `<p class="error" data-testid="login-error">${escapeHtml(errorMessage)}</p>` : ''}
        <button class="primary" type="submit">Sign in</button>
      </form>
    </main>`;
}

function renderHouse(): void {
  if (!stats || !settings) return;
  const selected = detail?.session.id ?? '';
  app!.innerHTML = `
    <main class="wrap">
      <header class="top">
        <div>
          <h1>House ledger</h1>
          <p class="muted">Signed in as ${escapeHtml(username)}. Chip changes are audited. They do not by themselves move a session's peak. Hide a gifted session if it should not rank.</p>
        </div>
        <button class="secondary" type="button" data-action="logout">Sign out</button>
      </header>
      ${errorMessage ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
      ${notice ? `<p class="pos">${escapeHtml(notice)}</p>` : ''}
      <section class="stats" data-testid="stats">
        ${stat('Sessions', String(stats.sessions))}
        ${stat('Played', String(stats.playedSessions))}
        ${stat('Hands', String(stats.hands))}
        ${stat('Banned', String(stats.bannedSessions))}
        ${stat('Wagered', formatUsd(stats.wageredCents))}
        ${stat('Player net', formatSignedUsd(stats.playerNetCents), stats.playerNetCents)}
        ${stat('House net', formatSignedUsd(-stats.playerNetCents), -stats.playerNetCents)}
      </section>
      <form class="panel settings" data-form="settings">
        <label>Starting stack <input name="starting" inputmode="decimal" value="${settings.startingBankrollCents / 100}" required></label>
        <label>Decks <select name="decks">${[1, 2, 3, 4, 5, 6, 7, 8].map((count) => `<option ${count === settings!.decks ? 'selected' : ''}>${count}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="hitSoft17" ${settings.hitSoft17 ? 'checked' : ''}> Dealer hits soft 17</label>
        <button class="primary" type="submit">Save rules</button>
      </form>
      <div class="split">
        <section class="panel">
          <h2>Sessions</h2>
          <form data-form="search" class="row">
            <input name="q" aria-label="Search sessions" placeholder="Name or id">
            <button class="secondary" type="submit">Search</button>
          </form>
          <table>
            <thead><tr><th>Table</th><th class="num">Stack</th><th class="num">Peak</th></tr></thead>
            <tbody>
              ${sessions.length === 0 ? '<tr><td colspan="3">No sessions yet.</td></tr>' : sessions.map((session) => `
                <tr data-testid="session-row" data-session="${session.id}" class="${session.id === selected ? 'selected' : ''}">
                  <td>${escapeHtml(session.displayName)}${session.banned ? ' · banned' : ''}${session.hiddenFromBoard ? ' · hidden' : ''}</td>
                  <td class="num">${formatUsd(session.bankrollCents)}</td>
                  <td class="num">${formatUsd(session.peakBankrollCents)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section class="panel detail" data-testid="detail">
          ${detail ? detailHtml(detail) : '<p class="muted">Select a session. The hole card is visible here while a hand is in progress.</p>'}
        </section>
      </div>
      <section class="panel audit">
        <h2>Audit</h2>
        <ul>${audit.length === 0 ? '<li>No operator actions yet.</li>' : audit.map((entry) => `<li><span>${escapeHtml(entry.createdAt.slice(0, 19).replace('T', ' '))}</span><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.adminUsername)} ${escapeHtml(JSON.stringify(entry.detail))}</span></li>`).join('')}</ul>
      </section>
    </main>`;
}

function detailHtml(current: AdminSessionDetail): string {
  const session = current.session;
  const round = current.round;
  return `
    <h2>${escapeHtml(session.displayName)}</h2>
    <p class="muted">${escapeHtml(session.id)}</p>
    <p>Stack ${formatUsd(session.bankrollCents)} · peak ${formatUsd(session.peakBankrollCents)} · net ${formatSignedUsd(session.netCents)} · wagered ${formatUsd(session.totalWageredCents)}</p>
    <p>${session.banned ? `Banned${session.banReason ? `: ${escapeHtml(session.banReason)}` : ''}` : 'Allowed to play'} · ${session.hiddenFromBoard ? 'Hidden from the board' : 'Listed on the board'} · ${current.shoeRemaining} cards left in the shoe</p>
    ${round ? `<div><p>Open hand · ${escapeHtml(round.phase)} · hole card is visible to the house</p><div class="cards">${round.dealerCards.map((card) => miniCard(card)).join('')}</div></div>` : '<p>No hand in progress.</p>'}
    <label>Reason <input id="reason" data-testid="reason" maxlength="200" placeholder="Why this change"></label>
    <label>Chip change in dollars <input id="adjust-amount" data-testid="adjust-amount" inputmode="decimal" placeholder="25 or -10"></label>
    <div class="row">
      <button class="primary" type="button" data-action="adjust">Apply chips</button>
      ${session.banned ? '<button class="secondary" type="button" data-action="unban">Unban</button>' : '<button class="danger" type="button" data-action="ban">Ban</button>'}
      ${session.hiddenFromBoard ? '<button class="secondary" type="button" data-action="show">Show on board</button>' : '<button class="secondary" type="button" data-action="hide">Hide from board</button>'}
    </div>
    <h2>Hands</h2>
    <ul class="hands" data-testid="hand-history">
      ${current.hands.length === 0 ? '<li>No hands yet.</li>' : current.hands.map((hand) => handItem(hand)).join('')}
    </ul>`;
}

function handItem(hand: AdminHand): string {
  return `<li><strong>${escapeHtml(hand.description)}</strong> ${formatSignedUsd(hand.netCents)}
    <span class="muted">Wager ${formatUsd(hand.wagerCents)} · player ${escapeHtml(hand.player)} · dealer ${escapeHtml(hand.dealer)}</span></li>`;
}

function miniCard(card: DealerCardView): string {
  if ('hidden' in card) return '<div class="mini back" aria-label="Hole card"></div>';
  const red = card.suit === 'H' || card.suit === 'D' ? ' red' : '';
  const glyph = { S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit] ?? card.suit;
  return `<div class="mini${red}">${escapeHtml(card.rank)}${glyph}</div>`;
}

function stat(label: string, value: string, tone?: number): string {
  const klass = tone == null ? '' : tone > 0 ? 'pos' : tone < 0 ? 'neg' : '';
  return `<article class="card stat"><span>${label}</span><strong class="${klass}">${value}</strong></article>`;
}

function valueOf(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.value : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed');
  return data as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[character] ?? character;
  });
}
