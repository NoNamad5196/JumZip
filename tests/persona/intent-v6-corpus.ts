import { INTENT_V5_CASES } from './intent-v5-corpus.ts';

/** No new cases or expected answers. The executed v5 selection is the immutable
 * comparison target; only the candidate runtime and evaluation label change. */
export const INTENT_V6_CORPUS_VERSION = 'JumZipIntentV6Eval-v1';
export const INTENT_V6_CASES = INTENT_V5_CASES;
if (INTENT_V6_CASES.length !== 28 || new Set(INTENT_V6_CASES.map(item => item.id)).size !== 28) throw Error('INTENT_V6_CORPUS_INVALID');
