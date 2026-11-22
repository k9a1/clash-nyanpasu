import { parseDocument } from 'yaml'

/**
 * Marks the overlay profile that holds a config's custom rules, so the editor
 * can find it again among the config's transforms.
 */
export const CUSTOM_RULES_MARKER = 'nyanpasu:custom-rules'

/** The overlay directive that puts rules above the profile's own rules. */
const CUSTOM_RULES_KEY = 'prepend-rules'

export const RULE_TYPES = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'DOMAIN-WILDCARD',
  'GEOSITE',
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-ASN',
  'SRC-GEOIP',
  'SRC-IP-ASN',
  'SRC-IP-CIDR',
  'SRC-PORT',
  'DST-PORT',
  'IN-PORT',
  'IN-TYPE',
  'IN-USER',
  'IN-NAME',
  'PROCESS-NAME',
  'PROCESS-NAME-REGEX',
  'PROCESS-PATH',
  'PROCESS-PATH-REGEX',
  'UID',
  'NETWORK',
  'DSCP',
  'RULE-SET',
  'AND',
  'OR',
  'NOT',
  'SUB-RULE',
] as const

/** The built-in policies a rule can point at besides the proxy groups. */
export const BUILTIN_TARGETS = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
] as const

// A logic rule's payload is a parenthesised group that may itself hold commas.
const LOGIC_TYPES: ReadonlySet<string> = new Set([
  'AND',
  'OR',
  'NOT',
  'SUB-RULE',
])

// The types that accept the `no-resolve` option.
const NO_RESOLVE_TYPES: ReadonlySet<string> = new Set([
  'GEOIP',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-ASN',
  'SRC-GEOIP',
  'SRC-IP-ASN',
  'SRC-IP-CIDR',
  'RULE-SET',
])

const NO_RESOLVE = 'no-resolve'

export type CustomRule = {
  /** Stable key for the editor's rows; never written to the file. */
  id: string
  type: string
  payload: string
  target: string
  noResolve: boolean
  /** Options this editor does not model, kept as they were. */
  extra: string
}

export const isLogicType = (type: string) => LOGIC_TYPES.has(type)

export const supportsNoResolve = (type: string) => NO_RESOLVE_TYPES.has(type)

export const hasPayload = (type: string) => type !== 'MATCH'

export const createCustomRule = (
  patch: Partial<Omit<CustomRule, 'id'>> = {},
): CustomRule => ({
  id: crypto.randomUUID(),
  type: 'DOMAIN-SUFFIX',
  payload: '',
  target: 'DIRECT',
  noResolve: false,
  extra: '',
  ...patch,
})

const splitFields = (text: string) =>
  text.split(',').map((field) => field.trim())

// The index of the parenthesis closing the one that opens `text`.
const closingParen = (text: string) => {
  let depth = 0

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') {
      depth += 1
    } else if (text[index] === ')') {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

/** `null` for a line that is not a rule this editor can represent. */
export const parseRule = (line: string): CustomRule | null => {
  const text = line.trim()
  const comma = text.indexOf(',')

  if (comma === -1) {
    return null
  }

  const type = text.slice(0, comma).trim().toUpperCase()
  const rest = text.slice(comma + 1).trim()

  let payload = ''
  let tail: string[]

  if (type === 'MATCH') {
    tail = splitFields(rest)
  } else if (isLogicType(type)) {
    if (!rest.startsWith('(')) {
      return null
    }

    const end = closingParen(rest)

    if (end === -1) {
      return null
    }

    payload = rest.slice(0, end + 1)

    // The fields after the group follow a comma.
    tail = splitFields(rest.slice(end + 1)).slice(1)
  } else {
    const fields = splitFields(rest)

    payload = fields[0]
    tail = fields.slice(1)
  }

  const [target, ...options] = tail

  if (!type || !target || (hasPayload(type) && !payload)) {
    return null
  }

  return {
    id: crypto.randomUUID(),
    type,
    payload,
    target,
    noResolve: options.some((option) => option.toLowerCase() === NO_RESOLVE),
    extra: options
      .filter((option) => option.toLowerCase() !== NO_RESOLVE)
      .join(','),
  }
}

export const formatRule = (rule: CustomRule) => {
  const fields: string[] = [rule.type]

  if (hasPayload(rule.type)) {
    fields.push(rule.payload.trim())
  }

  fields.push(rule.target.trim())

  if (rule.noResolve && supportsNoResolve(rule.type)) {
    fields.push(NO_RESOLVE)
  }

  if (rule.extra) {
    fields.push(rule.extra)
  }

  return fields.join(',')
}

export type RuleProblem = 'payload' | 'target'

/** What stops a rule from being saved, if anything. */
export const ruleProblem = (rule: CustomRule): RuleProblem | undefined => {
  const payload = rule.payload.trim()

  if (hasPayload(rule.type)) {
    // A plain payload is a comma-separated field, so it cannot hold a comma.
    if (!payload || (!isLogicType(rule.type) && payload.includes(','))) {
      return 'payload'
    }
  }

  if (!rule.target.trim() || rule.target.includes(',')) {
    return 'target'
  }

  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The custom rules held by an overlay file; `null` when the file is not one
 * this editor can read back without losing something.
 */
export const readCustomRules = (content: string): CustomRule[] | null => {
  const document = parseDocument(content)

  if (document.errors.length > 0) {
    return null
  }

  const root: unknown = document.toJS()

  if (root == null) {
    return []
  }

  if (!isRecord(root)) {
    return null
  }

  const lines = root[CUSTOM_RULES_KEY]

  if (lines == null) {
    return []
  }

  if (!Array.isArray(lines)) {
    return null
  }

  const rules: CustomRule[] = []

  for (const line of lines) {
    const rule = typeof line === 'string' ? parseRule(line) : null

    if (!rule) {
      return null
    }

    rules.push(rule)
  }

  return rules
}

/**
 * The overlay file with its custom rules replaced. The document is edited in
 * place, so other directives and comments in the file stay as they were.
 */
export const writeCustomRules = (content: string, rules: CustomRule[]) => {
  const document = parseDocument(content)

  if (rules.length === 0) {
    document.delete(CUSTOM_RULES_KEY)
  } else {
    document.set(CUSTOM_RULES_KEY, rules.map(formatRule))
  }

  return String(document)
}
