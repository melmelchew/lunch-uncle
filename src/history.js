/**
 * Keep the conversation sent to the model short, so long chats stay cheap.
 *
 * Only the most recent messages are kept, each capped in length. The client
 * sends the full history, so this is the one place the limit is enforced.
 */

export const MAX_HISTORY_MESSAGES = 10;
export const MAX_MESSAGE_CHARS = 1000;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Return the last few valid {role, content} messages, starting with a user turn.
 */
export function trimHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  const valid = history.filter(
    (m) =>
      (m?.role === "user" || m?.role === "assistant") &&
      typeof m.content === "string",
  );
  const recent = valid.slice(-MAX_HISTORY_MESSAGES);
  const firstUser = recent.findIndex((m) => m.role === "user");
  return (firstUser === -1 ? [] : recent.slice(firstUser)).map((m) => ({
    role: m.role,
    content:
      m.content.length > MAX_MESSAGE_CHARS
        ? `${m.content.slice(0, MAX_MESSAGE_CHARS)}...`
        : m.content,
  }));
}

/**
 * Use the client's conversation id if it looks like a UUID, otherwise make one.
 */
export function sessionIdFrom(conversationId) {
  return typeof conversationId === "string" && SESSION_ID.test(conversationId)
    ? conversationId
    : crypto.randomUUID();
}
