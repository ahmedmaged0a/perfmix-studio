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

  it('sequential journey wraps steps when k6ScenarioIteration is set', () => {
    const script = buildK6Script({
      mode: 'collection',
      selectedRequestId: 'r1',
      requests: [baseReq({ k6ScenarioIteration: 1 })],
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
      collectionLoadVus: 2,
      collectionLoadDuration: '3m',
    })
    expect(script).toContain('exec.scenario.iterationInTest === 1')
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
