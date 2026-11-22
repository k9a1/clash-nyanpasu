import { describe, expect, it } from 'vitest'
import {
  createCustomRule,
  formatRule,
  parseRule,
  readCustomRules,
  ruleProblem,
  writeCustomRules,
} from '@/pages/(main)/main/rules/_modules/custom-rule'

const lines = (content: string) =>
  readCustomRules(content)?.map((rule) => formatRule(rule))

describe('parseRule', () => {
  it('splits a plain rule into type, payload and target', () => {
    expect(parseRule('DOMAIN-SUFFIX,example.com,Proxy')).toMatchObject({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      target: 'Proxy',
      noResolve: false,
      extra: '',
    })
  })

  it('reads the no-resolve option and keeps unknown ones', () => {
    expect(parseRule('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve')).toMatchObject({
      target: 'DIRECT',
      noResolve: true,
      extra: '',
    })
    expect(parseRule('IP-CIDR,10.0.0.0/8,DIRECT,src,no-resolve')).toMatchObject(
      { noResolve: true, extra: 'src' },
    )

    // The order of options does not matter to Clash, so no-resolve goes first.
    expect(
      formatRule(parseRule('IP-CIDR,10.0.0.0/8,DIRECT,src,no-resolve')!),
    ).toBe('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src')
  })

  it('keeps the parenthesised payload of a logic rule whole', () => {
    expect(
      parseRule('AND,((DOMAIN,example.com),(NETWORK,UDP)),REJECT'),
    ).toMatchObject({
      type: 'AND',
      payload: '((DOMAIN,example.com),(NETWORK,UDP))',
      target: 'REJECT',
    })
  })

  it('reads a MATCH rule without a payload', () => {
    expect(parseRule('MATCH,Proxy')).toMatchObject({
      type: 'MATCH',
      payload: '',
      target: 'Proxy',
    })
  })

  it('rejects lines it cannot represent', () => {
    expect(parseRule('DOMAIN')).toBeNull()
    expect(parseRule('DOMAIN,example.com')).toBeNull()
    expect(parseRule('AND,(DOMAIN,example.com,REJECT')).toBeNull()
    expect(parseRule('OR,DOMAIN,REJECT')).toBeNull()
  })
})

describe('formatRule', () => {
  it.each([
    'DOMAIN-SUFFIX,example.com,Proxy',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src',
    'AND,((DOMAIN,example.com),(NETWORK,UDP)),REJECT',
    'SUB-RULE,(NETWORK,tcp),sub',
    'MATCH,Proxy',
  ])('round-trips %s', (line) => {
    const rule = parseRule(line)

    expect(rule).not.toBeNull()
    expect(formatRule(rule!)).toBe(line)
  })

  it('drops no-resolve from a type that does not take it', () => {
    expect(
      formatRule(
        createCustomRule({
          type: 'DOMAIN',
          payload: 'a.com',
          target: 'DIRECT',
          noResolve: true,
        }),
      ),
    ).toBe('DOMAIN,a.com,DIRECT')
  })
})

describe('ruleProblem', () => {
  it('asks for a payload and a target', () => {
    expect(ruleProblem(createCustomRule({ payload: ' ' }))).toBe('payload')
    expect(
      ruleProblem(createCustomRule({ payload: 'a.com', target: '' })),
    ).toBe('target')
    expect(ruleProblem(createCustomRule({ payload: 'a.com' }))).toBeUndefined()
  })

  it('refuses a comma in a plain payload but not in a logic one', () => {
    expect(ruleProblem(createCustomRule({ payload: 'a,b' }))).toBe('payload')
    expect(
      ruleProblem(
        createCustomRule({ type: 'NOT', payload: '((DOMAIN,a.com))' }),
      ),
    ).toBeUndefined()
  })
})

describe('readCustomRules', () => {
  it('reads an empty file and a file without the directive as no rules', () => {
    expect(readCustomRules('')).toEqual([])
    expect(readCustomRules('append-rules:\n  - MATCH,DIRECT\n')).toEqual([])
  })

  it('reads the prepended rules in order', () => {
    expect(
      lines(
        'prepend-rules:\n  - DOMAIN,a.com,DIRECT\n  - DOMAIN-SUFFIX,b.com,Proxy\n',
      ),
    ).toEqual(['DOMAIN,a.com,DIRECT', 'DOMAIN-SUFFIX,b.com,Proxy'])
  })

  it('refuses a file it could not write back faithfully', () => {
    expect(readCustomRules('prepend-rules: nope\n')).toBeNull()
    expect(readCustomRules('prepend-rules:\n  - 42\n')).toBeNull()
    expect(readCustomRules('prepend-rules:\n  - DOMAIN\n')).toBeNull()
    expect(readCustomRules('- just\n- a list\n')).toBeNull()
    expect(readCustomRules('prepend-rules: [\n')).toBeNull()
  })
})

describe('writeCustomRules', () => {
  it('writes the rules into an empty file', () => {
    const content = writeCustomRules('', [
      createCustomRule({ payload: 'a.com', target: 'Proxy' }),
    ])

    expect(content).toBe('prepend-rules:\n  - DOMAIN-SUFFIX,a.com,Proxy\n')
    expect(lines(content)).toEqual(['DOMAIN-SUFFIX,a.com,Proxy'])
  })

  it('keeps other directives and comments', () => {
    const content = writeCustomRules(
      '# mine\nappend-rules:\n  - MATCH,DIRECT\nprepend-rules:\n  - DOMAIN,old.com,DIRECT\n',
      [createCustomRule({ type: 'DOMAIN', payload: 'new.com' })],
    )

    expect(content).toContain('# mine')
    expect(content).toContain('MATCH,DIRECT')
    expect(content).not.toContain('old.com')
    expect(lines(content)).toEqual(['DOMAIN,new.com,DIRECT'])
  })

  it('removes the directive when no rules are left', () => {
    const content = writeCustomRules(
      'append-rules:\n  - MATCH,DIRECT\nprepend-rules:\n  - DOMAIN,old.com,DIRECT\n',
      [],
    )

    expect(content).not.toContain('prepend-rules')
    expect(content).toContain('append-rules')
    expect(readCustomRules(content)).toEqual([])
  })
})
