import AddRounded from '~icons/material-symbols/add-rounded'
import ArrowDownwardRounded from '~icons/material-symbols/arrow-downward-rounded'
import ArrowUpwardRounded from '~icons/material-symbols/arrow-upward-rounded'
import DeleteRounded from '~icons/material-symbols/delete-rounded'
import EditNoteRounded from '~icons/material-symbols/edit-note-rounded'
import { useMemo, useState } from 'react'
import { Button } from '@nyanpasu/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@nyanpasu/ui/card'
import { Input } from '@nyanpasu/ui/input'
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalTitle,
  ModalTrigger,
  useModal,
} from '@nyanpasu/ui/modal'
import { CircularProgress } from '@nyanpasu/ui/progress'
import { ScrollArea } from '@nyanpasu/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nyanpasu/ui/select'
import { Switch } from '@nyanpasu/ui/switch'
import { useBlockTask } from '@/components/providers/block-task-provider'
import { m } from '@/paraglide/messages'
import { formatError } from '@/utils'
import { message } from '@/utils/notification'
import { useClashProxies } from '@nyanpasu/query'
import {
  BUILTIN_TARGETS,
  createCustomRule,
  hasPayload,
  RULE_TYPES,
  ruleProblem,
  supportsNoResolve,
  type CustomRule,
} from './custom-rule'
import { useCustomRules } from './use-custom-rules'

function RuleEditorRow({
  rule,
  position,
  count,
  types,
  targets,
  showProblem,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  rule: CustomRule
  /** 1-based position among the custom rules. */
  position: number
  count: number
  types: string[]
  targets: string[]
  showProblem: boolean
  disabled: boolean
  onChange: (patch: Partial<CustomRule>) => void
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}) {
  const problem = showProblem ? ruleProblem(rule) : undefined

  return (
    <li
      className="bg-surface-variant/30 flex flex-col gap-1 rounded-2xl p-2"
      data-slot="rules-custom-row"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={rule.type}
          disabled={disabled}
          onValueChange={(type) => onChange({ type })}
        >
          <SelectTrigger
            className="w-52 shrink-0"
            aria-label={m.rules_custom_type()}
          >
            <SelectValue placeholder={m.rules_custom_type()}>
              {rule.type}
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {types.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasPayload(rule.type) && (
          <div className="min-w-48 flex-1" data-slot="rules-custom-payload">
            <Input
              label={m.rules_custom_payload()}
              value={rule.payload}
              disabled={disabled}
              aria-invalid={problem === 'payload'}
              onChange={(event) => onChange({ payload: event.target.value })}
            />
          </div>
        )}

        <Select
          value={rule.target}
          disabled={disabled}
          onValueChange={(target) => onChange({ target })}
        >
          <SelectTrigger
            className="w-52 shrink-0"
            aria-label={m.rules_custom_policy()}
          >
            <SelectValue placeholder={m.rules_custom_policy()}>
              {rule.target}
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {targets.map((target) => (
              <SelectItem key={target} value={target}>
                {target}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {supportsNoResolve(rule.type) && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={rule.noResolve}
              disabled={disabled}
              onCheckedChange={(noResolve) => onChange({ noResolve })}
            />

            <span>{m.rules_custom_no_resolve()}</span>
          </label>
        )}

        <div className="ml-auto flex shrink-0 items-center">
          <Button
            icon
            disabled={disabled || position === 1}
            aria-label={m.rules_custom_move_up()}
            onClick={() => onMove(-1)}
          >
            <ArrowUpwardRounded aria-hidden />
          </Button>

          <Button
            icon
            disabled={disabled || position === count}
            aria-label={m.rules_custom_move_down()}
            onClick={() => onMove(1)}
          >
            <ArrowDownwardRounded aria-hidden />
          </Button>

          <Button
            icon
            disabled={disabled}
            aria-label={m.rules_custom_remove()}
            onClick={onRemove}
          >
            <DeleteRounded aria-hidden />
          </Button>
        </div>
      </div>

      {problem && (
        <p
          className="text-error px-2 text-xs"
          role="alert"
          data-slot="rules-custom-row-problem"
        >
          {problem === 'payload'
            ? m.rules_custom_invalid_payload()
            : m.rules_custom_invalid_target()}
        </p>
      )}
    </li>
  )
}

// The draft starts from the rules at the moment the dialog opens, so a refetch
// while it is open cannot overwrite what is being typed.
function RulesForm({
  initial,
  onSave,
}: {
  initial: CustomRule[]
  onSave: (rules: CustomRule[]) => Promise<void>
}) {
  const { setOpen } = useModal()

  const {
    proxies: { data: proxies },
  } = useClashProxies()

  const [rules, setRules] = useState(initial)
  const [attempted, setAttempted] = useState(false)

  const types = useMemo(
    () => [
      ...new Set<string>([...RULE_TYPES, ...rules.map(({ type }) => type)]),
    ],
    [rules],
  )

  const targets = useMemo(
    () => [
      ...new Set<string>([
        ...BUILTIN_TARGETS,
        ...(proxies?.groups.map(({ name }) => name) ?? []),
        ...rules.map(({ target }) => target),
      ]),
    ],
    [proxies, rules],
  )

  const blockTask = useBlockTask('custom-rules', async () => {
    setAttempted(true)

    if (rules.some((rule) => ruleProblem(rule))) {
      return
    }

    try {
      await onSave(rules)

      setOpen(false)
    } catch (error) {
      message(m.rules_custom_save_failed({ error: formatError(error) }), {
        title: 'Error',
        kind: 'error',
        error,
      })
    }
  })

  // The task already runs one save at a time.
  const handleSave = blockTask.execute

  const updateRule = (id: string, patch: Partial<CustomRule>) =>
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    )

  const moveRule = (index: number, offset: -1 | 1) =>
    setRules((current) => {
      const next = [...current]

      ;[next[index], next[index + offset]] = [next[index + offset], next[index]]

      return next
    })

  return (
    <>
      <CardContent asChild>
        <ScrollArea className="max-h-[60dvh]">
          <div className="space-y-3 pt-2">
            <p className="text-on-surface-variant text-sm">
              {m.rules_custom_description()}
            </p>

            {rules.length === 0 ? (
              <p
                className="text-on-surface-variant py-6 text-center text-sm"
                data-slot="rules-custom-empty"
              >
                {m.rules_custom_empty()}
              </p>
            ) : (
              <ol className="space-y-2" data-slot="rules-custom-list">
                {rules.map((rule, index) => (
                  <RuleEditorRow
                    key={rule.id}
                    rule={rule}
                    position={index + 1}
                    count={rules.length}
                    types={types}
                    targets={targets}
                    showProblem={attempted}
                    disabled={blockTask.isPending}
                    onChange={(patch) => updateRule(rule.id, patch)}
                    onMove={(offset) => moveRule(index, offset)}
                    onRemove={() =>
                      setRules((current) =>
                        current.filter(({ id }) => id !== rule.id),
                      )
                    }
                  />
                ))}
              </ol>
            )}

            <Button
              variant="stroked"
              disabled={blockTask.isPending}
              onClick={() =>
                setRules((current) => [...current, createCustomRule()])
              }
            >
              <AddRounded aria-hidden />
              {m.rules_custom_add()}
            </Button>
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="gap-1">
        <Button
          onClick={handleSave}
          loading={blockTask.isPending}
          disabled={blockTask.isPending}
        >
          {m.common_save()}
        </Button>

        <ModalClose disabled={blockTask.isPending}>
          {m.common_cancel()}
        </ModalClose>
      </CardFooter>
    </>
  )
}

function CustomRulesCard() {
  const { state, save } = useCustomRules()

  const notice =
    state.status === 'unavailable'
      ? m.rules_custom_unavailable()
      : state.status === 'unreadable'
        ? m.rules_custom_unreadable()
        : undefined

  return (
    <Card
      className="w-[56rem] max-w-[calc(100dvw-2rem)]"
      data-slot="rules-custom-card"
    >
      <CardHeader>
        <ModalTitle>{m.rules_custom_title()}</ModalTitle>
      </CardHeader>

      {state.status === 'ready' ? (
        <RulesForm initial={state.rules} onSave={save} />
      ) : (
        <>
          <CardContent>
            {state.status === 'loading' ? (
              <div className="grid place-items-center py-6">
                <CircularProgress className="size-8" indeterminate />
              </div>
            ) : (
              <p
                className="text-on-surface-variant py-6 text-center text-sm"
                data-slot="rules-custom-notice"
              >
                {notice}
              </p>
            )}
          </CardContent>

          <CardFooter>
            <ModalClose>{m.common_close()}</ModalClose>
          </CardFooter>
        </>
      )}
    </Card>
  )
}

/** Edits the rules that are kept above the active profile's own rules. */
export default function CustomRulesEditor() {
  return (
    <Modal>
      <ModalTrigger asChild>
        <Button variant="glass" data-slot="rules-custom-open">
          <EditNoteRounded aria-hidden />
          {m.rules_custom_button()}
        </Button>
      </ModalTrigger>

      <ModalContent>
        <CustomRulesCard />
      </ModalContent>
    </Modal>
  )
}
