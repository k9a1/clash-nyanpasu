import { useMemo } from 'react'
import { m } from '@/paraglide/messages'
import {
  isConfigItem,
  isTransformItem,
  scopedTransformsOf,
  useProfile,
  useProfileContent,
} from '@nyanpasu/query'
import {
  CUSTOM_RULES_MARKER,
  readCustomRules,
  writeCustomRules,
  type CustomRule,
} from './custom-rule'

// Materialization rewrites the managed path to `{uid}.{ext}` on add.
const PENDING_FILE = 'pending.yaml'

export type CustomRulesState =
  /** No config is active, so there is nothing to put rules on. */
  | { status: 'unavailable' }
  | { status: 'loading' }
  /** The overlay holds something this editor cannot write back faithfully. */
  | { status: 'unreadable' }
  | { status: 'ready'; rules: CustomRule[] }

/**
 * The custom rules of the active config. They live in an overlay profile,
 * attached to that config alone, whose `prepend-rules` put them above the
 * config's own rules, so a subscription update leaves them in place.
 */
export const useCustomRules = () => {
  const { query, create, replaceDefinition, drop } = useProfile()

  const document = query.data

  const config = useMemo(() => {
    const item = document?.items.find(({ uid }) => uid === document.current)

    return item && isConfigItem(item) ? item : undefined
  }, [document])

  const overlay = useMemo(() => {
    if (!document || !config) {
      return undefined
    }

    const attached = new Set(scopedTransformsOf(config))

    return document.items.find(
      (item) =>
        attached.has(item.uid) &&
        isTransformItem(item) &&
        item.transform.type === 'overlay' &&
        item.desc === CUSTOM_RULES_MARKER,
    )
  }, [document, config])

  const content = useProfileContent(overlay?.uid ?? '')

  const state = useMemo<CustomRulesState>(() => {
    if (query.isPending) {
      return { status: 'loading' }
    }

    if (!config) {
      return { status: 'unavailable' }
    }

    // Without an overlay there are no rules yet; the first save makes it.
    if (!overlay) {
      return { status: 'ready', rules: [] }
    }

    if (content.query.data == null) {
      return { status: 'loading' }
    }

    const rules = readCustomRules(content.query.data)

    return rules ? { status: 'ready', rules } : { status: 'unreadable' }
  }, [query.isPending, config, overlay, content.query.data])

  const save = async (rules: CustomRule[]) => {
    if (!config) {
      return
    }

    if (overlay) {
      await content.upsert.mutateAsync(
        writeCustomRules(content.query.data ?? '', rules),
      )

      return
    }

    // Nothing to keep, and no overlay to empty.
    if (rules.length === 0) {
      return
    }

    const created = await create.mutateAsync({
      type: 'manual',
      data: {
        request: {
          metadata: {
            name: `${m.rules_custom_title()} · ${config.name}`,
            desc: CUSTOM_RULES_MARKER,
          },
          definition: {
            type: 'transform',
            transform: {
              type: 'overlay',
              source: {
                type: 'local',
                binding: { type: 'managed', file: PENDING_FILE },
              },
            },
          },
          folder: null,
        },
        fileData: writeCustomRules('', rules),
      },
    })

    try {
      await replaceDefinition.mutateAsync({
        uid: config.uid,
        definition: {
          type: 'config',
          config: {
            ...config.config,
            transforms: [...scopedTransformsOf(config), created.value],
          },
        },
      })
    } catch (error) {
      // An overlay no config uses would be left behind, and the next save
      // would make another.
      await drop.mutateAsync(created.value).catch(() => undefined)

      throw error
    }
  }

  return { state, save }
}
