// La page du contact (E5, F4) : mêmes étapes que l'app, même logique
// (app-core RelayFlow). Le coffre est reconstitué en mémoire ; rien de
// lisible n'est écrit dans le navigateur (décision du 12/09/2026).
import './polyfills'
import { ApiClient, MemoryCookieJar } from '@relais/api-client'
import { type ContactAccess, type RelayLinkView, RelayFlow, phaseOf } from '@relais/app-core'
import { browserLang, type Key, t } from './i18n'
import { BrowserStorage } from './storage'
import { appLink, tokenFromLocation } from './token'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const lang = browserLang()
const root = document.getElementById('app')!
const flow = new RelayFlow({ api: new ApiClient({ baseUrl: API_URL, cookieJar: new MemoryCookieJar(), language: lang }), storage: new BrowserStorage() })

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { text?: string; className?: string } = {}, children: Node[] = []) => {
  const node = document.createElement(tag)
  const { text, ...rest } = props
  Object.assign(node, rest)
  if (text !== undefined) node.textContent = text
  for (const c of children) node.append(c)
  return node
}
const p = (text: string, className?: string) => el('p', { text, ...(className ? { className } : {}) })
const button = (text: string, onClick: () => void, secondary = false, disabled = false) => {
  const b = el('button', { text, className: secondary ? 'secondary' : '', disabled })
  b.addEventListener('click', onClick)
  return b
}
const render = (...nodes: Node[]) => root.replaceChildren(...nodes)

const token = tokenFromLocation(location.pathname, location.search)
if (!token) render(el('h1', { text: 'Relais' }), p(t(lang, 'noToken')))
else void start(token)

async function start(token: string): Promise<void> {
  try {
    const [link, status] = await Promise.all([flow.link(token), flow.status(token)])
    const phase = phaseOf(link, status)
    if (phase === 'questions') return questions(token, link, null)
    if (phase === 'waiting') return waiting(link, status.answered, status.needed, () => void start(token))
    if (phase === 'done') return finished()
    return access(token, link, await flow.unlock(token))
  } catch (err) {
    fail(err)
  }
}

function fail(err: unknown): void {
  const code = (err as { code?: string }).code
  const key: Key = code === 'RELAY_TOKEN_INVALID' ? 'expired' : code === 'RELAY_CONTACT_BLOCKED' || code === 'RELAY_TOKEN_EXHAUSTED' ? 'blocked' : 'error'
  render(el('h1', { text: 'Relais' }), p(t(lang, key), 'error'))
}

function questions(token: string, link: RelayLinkView, attemptsLeft: number | null): void {
  const owner = link.owner_name
  const inputs = link.questions.map(() => el('input', { type: 'text', autocomplete: 'off', placeholder: t(lang, 'answer') }))
  const submit = button(t(lang, 'submit'), () => {
    submit.disabled = true
    void flow
      .answer(token, link, inputs.map((i) => i.value) as [string, string, string])
      .then((r) => (r.ok ? start(token) : questions(token, link, r.attempts_left)), fail)
  })
  const open = el('a', { href: appLink(token), text: t(lang, 'openApp'), className: 'muted' })
  render(
    el('h1', { text: t(lang, 'title', { owner }) }),
    p(t(lang, 'intro', { owner })),
    ...link.questions.flatMap((q, i) => [el('label', { text: lang === 'fr' ? q.text_fr : q.text_en }, [inputs[i]!])]),
    ...(attemptsLeft !== null ? [p(t(lang, 'wrong', { left: attemptsLeft, owner }), 'error')] : []),
    submit,
    open,
  )
}

function waiting(link: RelayLinkView, answered: number, needed: number, refresh: () => void): void {
  render(
    el('h1', { text: t(lang, 'waitingTitle', { owner: link.owner_name }) }),
    p(t(lang, 'waitingBody', { owner: link.owner_name, missing: Math.max(needed - answered, 0), answered, needed })),
    button(t(lang, 'refresh'), refresh, true),
  )
}

async function access(token: string, link: RelayLinkView, data: ContactAccess): Promise<void> {
  const owner = link.owner_name
  const done = new Set(await flow.progress(token))
  const revealed = new Set<string>()
  const draw = () => {
    const sections = data.checklist.map((s) =>
      el('section', {}, [
        el('h2', { text: t(lang, s.urgency as Key) }),
        ...(s.items.length === 0 ? [p(t(lang, 'empty'), 'muted')] : []),
        ...s.items.map((item) => {
          const isDone = done.has(item.id)
          const children: Node[] = [el('strong', { text: item.service_name })]
          if (item.login) children.push(p(`${t(lang, 'login')} : ${item.login}`))
          if (item.password) {
            const shown = revealed.has(item.id)
            children.push(p(`${t(lang, 'password')} : ${shown ? item.password : '••••••••'}`))
            children.push(
              button(t(lang, shown ? 'hide' : 'reveal'), () => {
                if (shown) revealed.delete(item.id)
                else revealed.add(item.id)
                draw()
              }, true),
            )
          }
          if (item.instructions) children.push(p(item.instructions))
          if (item.notes) children.push(p(item.notes))
          children.push(
            button(t(lang, isDone ? 'done' : 'todo'), () => {
              void flow.markDone(token, item.id, !isDone, data.access_expires_at).then(() => {
                if (isDone) done.delete(item.id)
                else done.add(item.id)
                draw()
              })
            }, !isDone),
          )
          return el('div', { className: `item${isDone ? ' done' : ''}` }, children)
        }),
      ]),
    )
    const journal = data.journal && data.journal.length > 0 ? [el('h2', { text: t(lang, 'journal', { owner }) }), ...data.journal.map((e) => p(`${e.entry_month.slice(0, 7)} — ${e.texte}`))] : []
    render(
      el('h1', { text: t(lang, 'accessTitle', { owner }) }),
      p(t(lang, 'accessBody', { date: new Date(data.access_expires_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB') })),
      ...(data.message?.message_personnel ? [el('h2', { text: t(lang, 'message') }), p(data.message.message_personnel)] : []),
      ...sections,
      ...journal,
      button(t(lang, 'finish'), () => {
        if (confirm(t(lang, 'finishConfirm'))) void flow.confirm(token).then(finished, fail)
      }, false, done.size === 0),
    )
  }
  draw()
}

function finished(): void {
  render(el('h1', { text: t(lang, 'finishedTitle') }), p(t(lang, 'finishedBody')))
}
