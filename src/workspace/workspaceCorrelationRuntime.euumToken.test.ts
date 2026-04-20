import { describe, expect, it } from 'vitest'
import type { HttpExecuteResponse } from '../models/types'
import {
  maybeFillAccessTokensFromRemappedAuthorizationHeader,
  maybeFillEuumpAccessTokenFromAuthorizeTokenResponse,
  syncEuumpJwtFromRuntimeIntoCollectionVars,
} from './workspaceCorrelationRuntime'

const EUUM_TOKEN_URL = 'https://gateway.example/euum/authorize/v1/token'
const DEFAULT_API_URL = 'https://api.example/euum/v1/default'

function makeResult(partial: Partial<HttpExecuteResponse>): HttpExecuteResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    responseHeaders: [],
    body: '',
    durationMs: 0,
    ...partial,
  }
}

describe('maybeFillEuumpAccessTokenFromAuthorizeTokenResponse', () => {
  const jwtFromBody = 'bodyA.bodyB.bodyC'
  const jwtFromHeader = 'hdrA.hdrB.hdrC'

  it('prefers x-amzn-remapped-authorization over JSON access_token when both are JWT-shaped', () => {
    const runtime: Record<string, string> = {}
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${jwtFromHeader}`]],
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.token).toBe(`Bearer ${jwtFromHeader}`)
    expect(runtime.updatedToken).toBeUndefined()
    expect(runtime.access_token).toBe(jwtFromHeader)
    expect(runtime.accessToken).toBe(jwtFromHeader)
  })

  it('uses JSON access_token when remapped header is absent', () => {
    const runtime: Record<string, string> = {}
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.token).toBe(`Bearer ${jwtFromBody}`)
    expect(runtime.updatedToken).toBeUndefined()
  })

  it('falls back to JSON when remapped header is present but not JWT-shaped', () => {
    const runtime: Record<string, string> = {}
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        responseHeaders: [['x-amzn-remapped-authorization', 'Bearer not-a-jwt']],
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.token).toBe(`Bearer ${jwtFromBody}`)
    expect(runtime.updatedToken).toBeUndefined()
  })

  it('does not run when URL is not EUUM authorize token', () => {
    const runtime: Record<string, string> = { token: 'unchanged' }
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${jwtFromHeader}`]],
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      'https://other.example/oauth/token',
    )
    expect(runtime.token).toBe('unchanged')
  })

  it('preserves existing JWT-shaped runtime.token and does not set updatedToken on token URL', () => {
    const prior = 'priorA.priorB.priorC'
    const runtime: Record<string, string> = { token: prior }
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${jwtFromHeader}`]],
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.token).toBe(prior)
    expect(runtime.updatedToken).toBeUndefined()
    expect(runtime.access_token).toBe(jwtFromHeader)
    expect(runtime.accessToken).toBe(jwtFromHeader)
  })

  it('fills runtime.token when it is a placeholder name', () => {
    const runtime: Record<string, string> = { token: 'token' }
    maybeFillEuumpAccessTokenFromAuthorizeTokenResponse(
      runtime,
      makeResult({
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${jwtFromHeader}`]],
        body: JSON.stringify({ access_token: jwtFromBody }),
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.token).toBe(`Bearer ${jwtFromHeader}`)
    expect(runtime.updatedToken).toBeUndefined()
  })
})

describe('maybeFillAccessTokensFromRemappedAuthorizationHeader', () => {
  const hdrJwt = 'apiA.apiB.apiC'

  it('updates updatedToken from remapped header on non-token URL without changing preserved token', () => {
    const runtime: Record<string, string> = {
      token: 'login.login.login',
      updatedToken: 'stale.stale.stale',
    }
    maybeFillAccessTokensFromRemappedAuthorizationHeader(
      runtime,
      makeResult({
        status: 200,
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${hdrJwt}`]],
      }),
      DEFAULT_API_URL,
    )
    expect(runtime.token).toBe('login.login.login')
    expect(runtime.updatedToken).toBe(`Bearer ${hdrJwt}`)
    expect(runtime.access_token).toBe(hdrJwt)
  })

  it('on EUUM token URL updates access aliases but not updatedToken', () => {
    const runtime: Record<string, string> = { updatedToken: 'from.extractor.only' }
    maybeFillAccessTokensFromRemappedAuthorizationHeader(
      runtime,
      makeResult({
        status: 200,
        responseHeaders: [['x-amzn-remapped-authorization', `Bearer ${hdrJwt}`]],
      }),
      EUUM_TOKEN_URL,
    )
    expect(runtime.access_token).toBe(hdrJwt)
    expect(runtime.accessToken).toBe(hdrJwt)
    expect(runtime.updatedToken).toBe('from.extractor.only')
  })

  it('no-ops when status is not 2xx', () => {
    const runtime: Record<string, string> = { updatedToken: 'keep.keep.keep' }
    maybeFillAccessTokensFromRemappedAuthorizationHeader(
      runtime,
      makeResult({ status: 500, responseHeaders: [['x-amzn-remapped-authorization', 'Bearer x.y.z']] }),
      DEFAULT_API_URL,
    )
    expect(runtime.updatedToken).toBe('keep.keep.keep')
  })

  it('no-ops when remapped header is absent', () => {
    const runtime: Record<string, string> = { updatedToken: 'u.u.u' }
    maybeFillAccessTokensFromRemappedAuthorizationHeader(
      runtime,
      makeResult({ status: 200, body: '{}' }),
      DEFAULT_API_URL,
    )
    expect(runtime.updatedToken).toBe('u.u.u')
  })
})

describe('syncEuumpJwtFromRuntimeIntoCollectionVars', () => {
  it('fills {{access_token}} from access lineage only (not updatedToken)', () => {
    const runtime: Record<string, string> = {
      accessToken: 'acc.acc.acc',
      updatedToken: 'upd.upd.upd',
    }
    const collectionVars: Record<string, string> = { slot: '{{access_token}}' }
    syncEuumpJwtFromRuntimeIntoCollectionVars(runtime, collectionVars)
    expect(collectionVars.slot).toBe('acc.acc.acc')
  })

  it('fills {{updatedToken}} from updated lineage even when accessToken is set', () => {
    const runtime: Record<string, string> = {
      accessToken: 'acc.acc.acc',
      updatedToken: 'upd.upd.upd',
    }
    const collectionVars: Record<string, string> = {
      a: '{{access_token}}',
      u: '{{updatedToken}}',
      t: '{{token}}',
    }
    syncEuumpJwtFromRuntimeIntoCollectionVars(runtime, collectionVars)
    expect(collectionVars.a).toBe('acc.acc.acc')
    expect(collectionVars.u).toBe('Bearer upd.upd.upd')
    expect(collectionVars.t).toBe('Bearer acc.acc.acc')
  })

  it('does not copy access JWT into updated placeholders when updated lineage is empty', () => {
    const runtime: Record<string, string> = {
      accessToken: 'only.only.only',
    }
    const collectionVars: Record<string, string> = { u: '{{updatedToken}}' }
    syncEuumpJwtFromRuntimeIntoCollectionVars(runtime, collectionVars)
    expect(collectionVars.u).toBe('{{updatedToken}}')
  })
})
