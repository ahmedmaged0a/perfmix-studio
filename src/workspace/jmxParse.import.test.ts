/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { parseJmx } from './jmxParse'

const threadGroupSnippet = `
    <ThreadGroup testname="TG" testclass="ThreadGroup">
      <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="LC">
        <stringProp name="LoopController.loops">1</stringProp>
        <boolProp name="LoopController.continue_forever">false</boolProp>
      </elementProp>
      <stringProp name="ThreadGroup.num_threads">1</stringProp>
      <stringProp name="ThreadGroup.ramp_time">0</stringProp>
    </ThreadGroup>`

function wrapPlan(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6">
  <hashTree>
    <TestPlan testname="Plan" testclass="TestPlan">
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" testclass="Arguments">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree/>
    ${threadGroupSnippet}
    <hashTree>
      ${inner}
    </hashTree>
  </hashTree>
</jmeterTestPlan>`
}

/** One HTTP sampler plus its following hashTree (JMeter layout). `innerHashTreeXml` is optional child XML inside that hashTree. */
function httpSampler(name: string, path: string, enabled = true, innerHashTreeXml = ''): string {
  const en = enabled ? 'true' : 'false'
  return `<HTTPSamplerProxy testname="${name}" testclass="HTTPSamplerProxy" enabled="${en}">
          <stringProp name="HTTPSampler.domain">example.com</stringProp>
          <stringProp name="HTTPSampler.path">${path}</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
          <boolProp name="HTTPSampler.postBodyRaw">false</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" testclass="Arguments">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
        </HTTPSamplerProxy>
        <hashTree>
        ${innerHashTreeXml}
        </hashTree>`
}

describe('parseJmx import parity', () => {
  it('emits one correlation rule per following sampler for controller-scoped RegexExtractor', () => {
    const inner = `
      <TransactionController testname="Tx" testclass="TransactionController"/>
      <hashTree>
        <RegexExtractor testname="rx" testclass="RegexExtractor">
          <stringProp name="RegexExtractor.refname">token</stringProp>
          <stringProp name="RegexExtractor.regex">"x":"(.+?)"</stringProp>
          <stringProp name="RegexExtractor.template">$1$</stringProp>
          <stringProp name="RegexExtractor.useHeaders">false</stringProp>
        </RegexExtractor>
        <hashTree/>
        ${httpSampler('step-a', '/a')}
        ${httpSampler('step-b', '/b')}
      </hashTree>`
    const res = parseJmx(wrapPlan(inner))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const tokenRules = res.correlationRules.filter((r) => r.variableName === 'token' && r.kind === 'regex')
    expect(tokenRules).toHaveLength(2)
    expect(new Set(tokenRules.map((r) => r.fromRequestId)).size).toBe(2)
  })

  it('skips disabled HTTP samplers and warns', () => {
    const inner = `
      ${httpSampler('on', '/ok', true)}
      ${httpSampler('off', '/skip', false)}`
    const res = parseJmx(wrapPlan(inner))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.collection.requests.map((r) => r.name)).toEqual(['on'])
    expect(res.warnings.some((w) => w.includes('Skipped 1 disabled'))).toBe(true)
  })

  it('maps ResponseAssertion on sampler hashTree to body_contains', () => {
    const assertXml = `
        <ResponseAssertion testname="chk" testclass="ResponseAssertion">
          <collectionProp name="Asserion.test_strings">
            <stringProp name="1">Flight Selections</stringProp>
          </collectionProp>
          <stringProp name="Assertion.test_field">Assertion.response_data</stringProp>
          <intProp name="Assertion.test_type">16</intProp>
        </ResponseAssertion>
        <hashTree/>`
    const inner = `${httpSampler('withAssert', '/x', true, assertXml)}`
    const res = parseJmx(wrapPlan(inner))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const req = res.collection.requests.find((r) => r.name === 'withAssert')
    expect(req?.assertions?.length).toBe(1)
    expect(req?.assertions?.[0].type).toBe('body_contains')
    expect(req?.assertions?.[0].target).toBe('Flight Selections')
  })

  it('merges CSVDataSet variable names and warns about file path', () => {
    const inner = `
      <CSVDataSet testname="csv" testclass="CSVDataSet">
        <stringProp name="delimiter">,</stringProp>
        <stringProp name="filename">A:/data/file.csv</stringProp>
        <stringProp name="variableNames">username,password</stringProp>
      </CSVDataSet>
      <hashTree/>
      ${httpSampler('only', '/')} `
    const res = parseJmx(wrapPlan(inner))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.collection.variables?.username).toBeDefined()
    expect(res.collection.variables?.password).toBeDefined()
    expect(res.warnings.some((w) => w.includes('CSV Data Set Config') && w.includes('file.csv'))).toBe(true)
  })

  it('corrects (+?) typo in RegexExtractor and warns once per element', () => {
    const inner = `
      <TransactionController testname="Tx" testclass="TransactionController"/>
      <hashTree>
        <RegexExtractor testname="rx" testclass="RegexExtractor">
          <stringProp name="RegexExtractor.refname">Sign_username</stringProp>
          <stringProp name="RegexExtractor.regex">prefix(+?)suffix</stringProp>
          <stringProp name="RegexExtractor.template">$1$</stringProp>
          <stringProp name="RegexExtractor.useHeaders">false</stringProp>
        </RegexExtractor>
        <hashTree/>
        ${httpSampler('s1', '/one')}
        ${httpSampler('s2', '/two')}
      </hashTree>`
    const res = parseJmx(wrapPlan(inner))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const rules = res.correlationRules.filter((r) => r.variableName === 'Sign_username')
    expect(rules.length).toBeGreaterThanOrEqual(1)
    for (const r of rules) {
      expect(r.regexPattern).not.toMatch(/\(\+\?\)/)
      expect(r.regexPattern).toContain('(.+?)')
    }
    expect(res.warnings.some((w) => w.includes('(+?)') && w.includes('(.+?)'))).toBe(true)
  })
})
