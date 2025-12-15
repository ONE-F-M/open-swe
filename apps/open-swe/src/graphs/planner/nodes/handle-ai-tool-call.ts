import {ToolMessage, isAIMessage } from "@langchain/core/messages";

/**
 * Handles strict tool call/result alternation for LLM function-calling protocol.
 * @param messages - Array of HumanMessage | AIMessage | ToolMessage
 * @param executeToolFn - Function to execute a tool by name and args
 * @param callModel - Function to call the LLM with the current message history
 * @returns The final LLM response (when no more tool calls are present)
 */
export async function handleAIToolCall(
  messages: any[],
  executeToolFn: (name: string, args: any) => Promise<any>,
  callModel: (msgs: any[]) => Promise<any>
) {
  let history = [...messages];

  while (true) {
    const last = history[history.length - 1];

    // If last is an AI message with tool_calls, execute the tool(s)
    if (isAIMessage(last) && last.tool_calls && last.tool_calls.length > 0) {
      for (const toolCall of last.tool_calls) {
        if (!toolCall.id) {
          throw new Error("tool_call_id is required but was undefined");
        }
        const toolResult = await executeToolFn(toolCall.name, toolCall.args);
        const toolMessage = new ToolMessage({
          tool_call_id: toolCall.id as string,
          name: toolCall.name,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
          status: "success",
        });
        history.push(toolMessage);
      }
      // After appending tool results, call the model again
      const response = await callModel(history);
      history.push(response);
      continue;
    }

    // If no tool call, return the final response or plan
    return last;
  }
}
