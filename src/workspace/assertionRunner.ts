import type { HttpExecuteResponse, RequestAssertion } from '../models/types'

export type AssertionResult = {
  assertion: RequestAssertion
  pass: boolean
  detail: string
}

export function evaluateAssertions(
  assertions: RequestAssertion[],
  response: HttpExecuteResponse,
): AssertionResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((a) => {
      switch (a.type) {
        case 'status_code': {
          const expected = parseInt(a.target, 10)
          const pass = response.status === expected
          return { assertion: a, pass, detail: `Status ${response.status} ${pass ? '==' : '!='} ${expected}` }
        }
        case 'body_equals': {
          const pass = response.body === a.target
          return { assertion: a, pass, detail: pass ? 'Body matches exactly' : 'Body does not match' }
        }
        case 'body_contains': {
          const pass = response.body.includes(a.target)
          return { assertion: a, pass, detail: pass ? `Body contains "${a.target}"` : `Body missing "${a.target}"` }
        }
        case 'header_visible': {
          const found = response.responseHeaders.some(([k]) => k.toLowerCase() === a.target.toLowerCase())
          return { assertion: a, pass: found, detail: found ? `Header "${a.target}" present` : `Header "${a.target}" not found` }
        }
        case 'header_contains': {
          const hdr = response.responseHeaders.find(([k]) => k.toLowerCase() === a.target.toLowerCase())
          const pass = hdr ? hdr[1].includes(a.expected ?? '') : false
          return { assertion: a, pass, detail: hdr ? (pass ? `"${a.target}" contains "${a.expected}"` : `"${a.target}" missing "${a.expected}"`) : `Header "${a.target}" not found` }
        }
        case 'header_value_equals': {
          const hdr = response.responseHeaders.find(([k]) => k.toLowerCase() === a.target.toLowerCase())
          const pass = hdr ? hdr[1] === (a.expected ?? '') : false
          return { assertion: a, pass, detail: hdr ? (pass ? `"${a.target}" == "${a.expected}"` : `"${a.target}": "${hdr[1]}" != "${a.expected}"`) : `Header "${a.target}" not found` }
        }
        default:
          return { assertion: a, pass: false, detail: 'Unknown assertion type' }
      }
    })
}
