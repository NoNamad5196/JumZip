import { buildPersonaMessages, type PersonaPromptInput } from '../persona/prompt.ts';
import type { TarotCard } from '../domain/tarot.ts';
import { LLMError, type LLMProvider } from './provider.ts';
import { segmentReply, validateChatOutput } from './validator.ts';
import { selectChatResponseContract } from './chat-contract.ts';

export const PERSONA_PROMPT_VERSION = 'JumZipPersona-v9';
export interface PersonaReply {
  content: string; segments: string[]; repaired: boolean;
  metadata: { model: string; promptVersion: string; provider: 'openai-compatible'; generatedAt: string; usage?: { promptTokens: number; completionTokens: number } };
}
export async function generatePersonaReply(provider: LLMProvider, input: PersonaPromptInput): Promise<PersonaReply> {
  const messages = buildPersonaMessages(input);
  const tool = input.toolResult as { cards?: readonly TarotCard[] } | undefined;
  const expectedCards = tool && Array.isArray(tool.cards) ? tool.cards : undefined;
  const contract = selectChatResponseContract(input.toolResult);
  const first = await provider.generateChat(messages, contract);
  const validationOptions = { characterId: input.characterId, expectedCards, toolResult: input.toolResult, currentMessage: input.currentMessage };
  const initial = validateChatOutput(first.content, validationOptions);
  let output = first;
  let validated = initial;
  let repaired = false;
  if (!initial.ok) {
    repaired = true;
    output = await provider.repairChat(messages, first.content, initial.issues, contract);
    validated = validateChatOutput(output.content, validationOptions);
  }
  if (!validated.ok) throw new LLMError('LLM_INVALID_RESPONSE');
  return { content: validated.value.text, segments: segmentReply(validated.value.text), repaired,
    metadata: { model: output.model, promptVersion: PERSONA_PROMPT_VERSION, provider: 'openai-compatible', generatedAt: new Date().toISOString(), ...(output.usage ? { usage: output.usage } : {}) } };
}
