/**
 * OAuth authorization `code` appears in 302 `Location` as `?code=...` or `&code=...`.
 * JMeter often records `&code=(.+)` which (1) misses `?code=` and (2) lets `.+` swallow `&session_state=...`.
 */

export function normalizeOAuthAuthorizationCodeHeaderRegex(
  pattern: string,
  regexSource: string | undefined,
): string {
  if (regexSource !== 'headers' || !pattern.includes('code=')) return pattern
  let p = pattern.trim()
  if (!/\[\?&\]code=/i.test(p)) {
    p = p.replace(/&(?:amp;)?code=/gi, '[?&]code=')
  }
  p = p.replace(/(\[\?&\]code=)\(\.\*\)/gi, '$1([^&\\s#]+)')
  p = p.replace(/(\[\?&\]code=)\(\.\+\?\)/gi, '$1([^&\\s#]+)')
  p = p.replace(/(\[\?&\]code=)\(\.\+\)/gi, '$1([^&\\s#]+)')
  return p
}
