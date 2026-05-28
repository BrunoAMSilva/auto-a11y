import { ACCNAME_PAGE_FN } from './algorithm.js';
import type { EvalTarget } from './utils.js';

export { isHiddenFromAT, getSelector, normalizeFlatString } from './utils.js';
export type { HiddenInfo, EvalTarget } from './utils.js';

type AnyEval = (fn: unknown, arg?: unknown) => Promise<unknown>;

export async function computeAccessibleName(target: EvalTarget): Promise<string> {
  return (target as unknown as { evaluate: AnyEval }).evaluate(ACCNAME_PAGE_FN, {
    mode: 'name',
  }) as Promise<string>;
}

export async function computeAccessibleDescription(target: EvalTarget): Promise<string> {
  return (target as unknown as { evaluate: AnyEval }).evaluate(ACCNAME_PAGE_FN, {
    mode: 'description',
  }) as Promise<string>;
}
