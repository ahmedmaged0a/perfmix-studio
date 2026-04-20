import { describe, expect, it } from 'vitest'
import type { ApiRequestItem, RequestTestCase } from '../models/types'
import { buildK6Script } from './generator'

function tc(partial: Partial<RequestTestCase> & Pick<RequestTestCase, 'id' | 'name'>): RequestTestCase {
  return {
    vus: 5,
    duration: '2m',
    rampUp: '30s',
    thinkTimeMs: 0,
    ...partial,
  }
}

function baseReq(overrides: Partial<ApiRequestItem> = {}): ApiRequestItem {
  return {
    id: 'r1',
    folder: 'f',
    name: 'req',
    method: 'GET',
    url: 'https://example.com/',
    headers: '',
    body: '',
    testCases: [tc({ id: 'tc1', name: 'TC1' })],
    ...overrides,
  }
}

describe('buildK6Script load controls', () => {
  it('parallel ramping-vus omits ramp-down unless rampDownEnabled', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'r1',
      requests: [baseReq()],
      scenarioName: 'sc',
      vus: 5,
      duration: '2m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'parallel',
    })
    expect(script).toContain(`gracefulRampDown: '0s'`)
    expect(script).not.toContain("{ duration: '15s', target: 0 }")
    expect(script.match(/stages:/g)?.length).toBe(1)
    const rampBlock = script.slice(script.indexOf('stages:'), script.indexOf('gracefulRampDown'))
    expect(rampBlock.split('duration:').length - 1).toBe(2)
  })

  it('parallel ramp-down adds third stage when enabled', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'r1',
      requests: [
        baseReq({
          testCases: [
            tc({
              id: 'tc1',
              name: 'TC1',
              rampDownEnabled: true,
              rampDown: '22s',
            }),
          ],
        }),
      ],
      scenarioName: 'sc',
      vus: 5,
      duration: '2m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'parallel',
    })
    expect(script).toContain('"22s"')
    expect(script).toContain('PERFMIX_LOAD_RAMP_DOWN')
    const rampBlock = script.slice(script.indexOf('stages:'), script.indexOf('gracefulRampDown'))
    expect(rampBlock.split('duration:').length - 1).toBe(3)
  })

  it('sequential journey scenario uses PERFMIX_COLLECTION_* fallbacks', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'r1',
      requests: [baseReq()],
      scenarioName: 'sc',
      vus: 5,
      duration: '2m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'sequential',
      collectionLoadVus: 7,
      collectionLoadDuration: '9m',
    })
    expect(script).toContain('PERFMIX_COLLECTION_DURATION')
    expect(script).toContain('PERFMIX_COLLECTION_VUS')
    expect(script).toContain('Math.max(1, parseInt(String(__ENV.PERFMIX_COLLECTION_VUS')
  })

  it('sequential Keycloak journey wraps authenticate POST with perfMixKeycloakAuthPostBody', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'a',
      requests: [
        baseReq({
          id: 'a',
          name: 'Auth',
          method: 'GET',
          url: 'https://kc.example/realms/r/protocol/openid-connect/auth',
          body: '',
        }),
        baseReq({
          id: 'b',
          name: 'Authenticate',
          method: 'POST',
          url: 'https://kc.example/realms/r/login-actions/authenticate',
          body: 'username={{user}}&password={{pass}}',
        }),
      ],
      scenarioName: 'sc',
      vus: 1,
      duration: '1m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'sequential',
    })
    expect(script).toContain('function perfMixKeycloakAuthPostBody(')
    expect(script).toContain('perfMixKeycloakAuthPostBody(tmpl(')
    expect(script).toContain('perfMixKeycloakAuthPostBody(tmpl("username={{user}}&password={{pass}}"), RUNTIME)')
  })

  it('sequential setup + main requests emit k6 setup() and merge setupRuntime into default', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'setup1',
      requests: [
        baseReq({
          id: 'setup1',
          name: 'Login',
          jmeterThreadGroupKind: 'setup',
        }),
        baseReq({
          id: 'main1',
          name: 'HitApi',
        }),
      ],
      scenarioName: 'sc',
      vus: 1,
      duration: '1m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'sequential',
    })
    expect(script).toContain('export function setup(')
    expect(script).toContain('Object.assign(RUNTIME, (data && data.setupRuntime)')
    expect(script).toContain('Sequential main requests')
  })

  it('parallel collection export prepends a note when setup-phase requests exist', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 's',
      requests: [
        baseReq({ id: 's', name: 'SetupStep', jmeterThreadGroupKind: 'setup' }),
        baseReq({ id: 'm', name: 'MainStep' }),
      ],
      scenarioName: 'sc',
      vus: 1,
      duration: '1m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'parallel',
    })
    expect(script).toContain('NOTE: This collection has setup-phase requests')
  })

  it('exports CLI env comment block', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'r1',
      requests: [baseReq()],
      scenarioName: 'sc',
      vus: 5,
      duration: '2m',
      thresholds: [],
      scenarios: [],
      activeEnvironment: 'staging',
      envVariables: {},
      sharedVariables: {},
      dataCsv: '',
      runPurpose: 'performance',
      collectionExecution: 'parallel',
    })
    expect(script).toContain('CLI load overrides')
    expect(script).toContain('PERFMIX_LOAD_DURATION')
  })
})
