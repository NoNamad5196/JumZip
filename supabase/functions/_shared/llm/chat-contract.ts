/** Server-selected, internal response contracts. Neither contract changes the public reply. */
export type ChatResponseContract = 'DEFAULT' | 'TAROT_EVIDENCE_V1';
export const TAROT_EVIDENCE_SPAN_MAX_LENGTH = 200;

export const CHAT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['text', 'toolReferences'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 6000 },
    toolReferences: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['cardId', 'orientation', 'positionIndex'], properties: { cardId: { type: 'integer', minimum: 0, maximum: 21 }, orientation: { type: 'string', enum: ['UPRIGHT', 'REVERSED'] }, positionIndex: { type: 'integer', minimum: 0, maximum: 2 } } } },
  },
};
export const TAROT_EVIDENCE_RESPONSE_SCHEMA: Record<string, unknown> = {
  ...CHAT_RESPONSE_SCHEMA, required: ['text', 'toolReferences', 'interpretationEvidence'],
  properties: {
    ...CHAT_RESPONSE_SCHEMA.properties as Record<string, unknown>,
    interpretationEvidence: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false, required: ['positionIndex', 'keywordIndices', 'textEvidence'],
      properties: {
        positionIndex: { type: 'integer', minimum: 0, maximum: 2 },
        keywordIndices: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'integer', minimum: 0 } },
        textEvidence: { type: 'string', minLength: 1, maxLength: TAROT_EVIDENCE_SPAN_MAX_LENGTH },
      },
    } },
  },
};

/** The caller supplies stored tool data; user prose never selects a contract. */
export function selectChatResponseContract(toolResult: unknown): ChatResponseContract {
  if (!toolResult || typeof toolResult !== 'object' || !('cards' in toolResult)) return 'DEFAULT';
  return Array.isArray(toolResult.cards) && toolResult.cards.length > 0 ? 'TAROT_EVIDENCE_V1' : 'DEFAULT';
}
export function getChatResponseDefinition(contract: ChatResponseContract = 'DEFAULT'): { schema: Record<string, unknown>; name: string } {
  return contract === 'TAROT_EVIDENCE_V1'
    ? { schema: TAROT_EVIDENCE_RESPONSE_SCHEMA, name: 'jumzip_tarot_evidence_v1' }
    : { schema: CHAT_RESPONSE_SCHEMA, name: 'jumzip_chat' };
}
