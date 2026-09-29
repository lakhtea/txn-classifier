import type Anthropic from "@anthropic-ai/sdk";

type ContentBlock = Anthropic.Messages.ContentBlock;
type Message = Anthropic.Messages.Message;
type MessageCreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

/** A complete Messages API response, as the real SDK returns it. */
export const buildMessage = (content: ContentBlock[]): Message => ({
  id: "msg_fake_01",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5-20251001",
  content,
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 3 },
});

export const replyWith = (text: string): Message => buildMessage([{ type: "text", text }]);

export interface FakeClient {
  requests: MessageCreateParams[];
  messages: { create(params: MessageCreateParams): Promise<Message> };
}

/** A client whose `messages.create` answers each request with `respond`, recording requests. */
export const fakeClient = (
  respond: (params: MessageCreateParams) => Message | Promise<Message>,
): FakeClient => {
  const requests: MessageCreateParams[] = [];
  return {
    requests,
    messages: {
      create: async (params: MessageCreateParams): Promise<Message> => {
        requests.push(params);
        return respond(params);
      },
    },
  };
};

/**
 * Which of `descriptions` this request is about, found in the user message the way a reader would.
 * Fails loudly when the request matches none or several, so a fake never answers the wrong row.
 */
export const requestedDescription = (
  params: MessageCreateParams,
  descriptions: readonly string[],
): string => {
  const userMessage = JSON.stringify(params.messages);
  const matches = descriptions.filter((description) => userMessage.includes(description));
  if (matches.length !== 1) {
    throw new Error(`fake expected one known description in request, found ${matches.length}: ${userMessage}`);
  }
  return matches[0];
};

/** A reply Claude might send for a description, or an error the API call throws instead. */
export type ScriptedReply = string | Error;

/** A client that answers each request from `replies`, keyed by the transaction description. */
export const answerByDescription = (replies: Record<string, ScriptedReply>): FakeClient =>
  fakeClient((params) => {
    const reply = replies[requestedDescription(params, Object.keys(replies))];
    if (reply instanceof Error) {
      throw reply;
    }
    return replyWith(reply);
  });
