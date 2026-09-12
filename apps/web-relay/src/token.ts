// Le lien de l'email est https://<front>/relay/<token> ; le token fait au
// moins 32 caractères URL-safe. La page propose aussi le deep link de l'app.

const TOKEN = /^[A-Za-z0-9_-]{32,}$/

export function tokenFromLocation(pathname: string, search: string): string | null {
  const m = /^\/relay\/([^/]+)\/?$/.exec(pathname)
  const candidate = m?.[1] ?? new URLSearchParams(search).get('token')
  return candidate && TOKEN.test(candidate) ? candidate : null
}

export function appLink(token: string): string {
  return `relais://relay/${token}`
}
