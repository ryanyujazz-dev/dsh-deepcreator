import { BrowserRuntimeError } from './errors.ts'
import type { BrowserActCommand, BrowserActionStep } from './types.ts'

/** Normalize the backward-compatible single action and the transactional steps surface. */
export function browserActionSteps(command: BrowserActCommand): BrowserActionStep[] {
  if (command.steps !== undefined && command.action !== undefined) throw new BrowserRuntimeError('INVALID_ACTION', 'browser_act accepts either action or steps, not both.')
  const steps = command.steps ?? (command.action === undefined ? [] : [{
    action: command.action,
    ...(command.locator === undefined ? {} : { locator: command.locator }),
    ...(command.destination === undefined ? {} : { destination: command.destination }),
    ...(command.value === undefined ? {} : { value: command.value }),
    ...(command.files === undefined ? {} : { files: command.files }),
  }])
  if (steps.length === 0) throw new BrowserRuntimeError('INVALID_ACTION', 'browser_act requires one action or a non-empty steps array.')
  if (steps.length > 20) throw new BrowserRuntimeError('INVALID_ACTION', 'browser_act accepts at most 20 steps.')
  return steps
}

/** Reject combinations that commonly apply a mutation and then wait for an impossible postcondition. */
export function validateBrowserActionCommand(command: BrowserActCommand): BrowserActionStep[] {
  const steps = browserActionSteps(command)
  const finalAction = steps.at(-1)?.action
  if (command.expected === 'navigation' && steps.length === 1 && (finalAction === 'fill' || finalAction === 'type' || finalAction === 'select' || finalAction === 'check' || finalAction === 'scroll' || finalAction === 'drag' || finalAction === 'upload')) {
    throw new BrowserRuntimeError('INVALID_ACTION', `${finalAction} cannot be the sole step of a navigation transaction. Put the input action and the submitting press/click in one steps array, then attach expected=navigation to the transaction.`)
  }
  if (command.expected === 'download' && command.observe === 'snapshot') throw new BrowserRuntimeError('INVALID_ACTION', 'A download transaction cannot atomically return a page snapshot.')
  return steps
}
