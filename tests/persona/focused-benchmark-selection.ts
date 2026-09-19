// A bounded diagnostic subset of the unchanged core/supplement corpora. It cannot
// satisfy their full-coverage acceptance gates. Selected before the v3 live run.
export const FOCUSED_CORE_CASE_IDS = ['06-one-card', '07-general-three', '08-relationship-three', '09-decision-three', '10-retry-same-draw', '11-redraw-request'] as const;
export const FOCUSED_SUPPLEMENT_CASE_IDS = ['s01-confirmed-strength', 's02-unknown-hour', 's03-correlated-boundary', 's05-compatibility-evidence', 's06-compatibility-uncertain', 's07-no-invented-score'] as const;
