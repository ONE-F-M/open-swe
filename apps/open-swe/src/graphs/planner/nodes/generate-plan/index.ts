import { v4 as uuidv4 } from "uuid";
import { benchListAppsTool } from "@openswe/cli/src/tools.js";
import { isAIMessage, ToolMessage } from "@langchain/core/messages";
import { createSessionPlanToolFields } from "../../../../tools/index.js";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import {
  loadModel,
  supportsParallelToolCallsParam,
} from "../../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task";
import {
  PlannerGraphState,
  PlannerGraphUpdate,
} from "@openswe/shared/open-swe/planner/types";
import { formatUserRequestPrompt } from "../../../../utils/user-request.js";
import {
  formatFollowupMessagePrompt,
  isFollowupRequest,
} from "../../utils/followup.js";
import { stopSandbox } from "../../../../utils/sandbox.js";
import { z } from "zod";
import { formatCustomRulesPrompt } from "../../../../utils/custom-rules.js";
import { getScratchpad } from "../../utils/scratchpad-notes.js";
import {
  SCRATCHPAD_PROMPT,
  CUSTOM_FRAMEWORK_PROMPT,
  MERGED_SYSTEM_PROMPT,
} from "./prompt.js";
import { shouldUseCustomFramework } from "../../../../utils/should-use-custom-framework.js";
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants";
import { filterMessagesWithoutContent } from "../../../../utils/message/content.js";
import { getModelManager } from "../../../../utils/llms/model-manager.js";
import { trackCachePerformance } from "../../../../utils/caching.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

function formatSystemPrompt(
  state: PlannerGraphState,
  config: GraphConfig,
): string {
  const isFollowup = isFollowupRequest(state.taskPlan, state.proposedPlan);
  const scratchpad = getScratchpad(state.messages)
    .map((n) => `- ${n}`)
    .join("\n");
  // Use merged Frappe prompt if frappeMode is enabled
  let prompt = MERGED_SYSTEM_PROMPT(config);
  prompt = prompt.replace(
    "{FOLLOWUP_MESSAGE_PROMPT}",
    isFollowup
      ? "\n" +
          formatFollowupMessagePrompt(state.taskPlan, state.proposedPlan) +
          "\n\n"
      : "",
  )
    .replace("{USER_REQUEST_PROMPT}", formatUserRequestPrompt(state.messages))
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(state.customRules))
    .replaceAll(
      "{SCRATCHPAD}",
      scratchpad.length
        ? SCRATCHPAD_PROMPT.replace("{SCRATCHPAD}", scratchpad)
        : "",
    )
    .replace(
      "{ADDITIONAL_INSTRUCTIONS}",
      shouldUseCustomFramework(config) ? CUSTOM_FRAMEWORK_PROMPT : "",
    );
  return prompt;
}

export async function generatePlan(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<PlannerGraphUpdate> {
  const model = await loadModel(config, LLMTask.PLANNER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.PLANNER);
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.PLANNER,
  );
  const sessionPlanTool = createSessionPlanToolFields();
  const modelWithTools = model.bindTools([sessionPlanTool], {
    tool_choice: sessionPlanTool.name,
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false,
        }
      : {}),
  });

  let optionalToolMessage: ToolMessage | undefined;
  const lastMessage = state.messages[state.messages.length - 1];
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.[0]) {
    const lastMessageToolCall = lastMessage.tool_calls?.[0];
    optionalToolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: lastMessageToolCall.id ?? "",
      name: lastMessageToolCall.name,
      content: "Tool call not executed. Max actions reached.",
    });
  }

  const inputMessages = filterMessagesWithoutContent([
    ...state.messages,
    ...(optionalToolMessage ? [optionalToolMessage] : []),
  ]);
  if (!inputMessages.length) {
    throw new Error("No messages to process.");
  }

  const response = await modelWithTools
    .withConfig({ tags: ["nostream"] })
    .invoke([
      {
        role: "system",
        content: formatSystemPrompt(state, config),
      },
      ...inputMessages,
    ]);

  // Filter out empty plans
  response.tool_calls = response.tool_calls?.map((tc) => {
    if (tc.id === sessionPlanTool.name) {
      return {
        ...tc,
        args: {
          ...tc.args,
          plan: (tc.args as z.infer<typeof sessionPlanTool.schema>).plan.filter(
            (p) => p.length > 0,
          ),
        },
      };
    }
    return tc;
  });

  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("Failed to generate plan");
  }

  let newSessionId: string | undefined;
  if (state.sandboxSessionId && !isLocalMode(config)) {
    // Stop before returning, as the next step will be to interrupt the graph.
    newSessionId = await stopSandbox(state.sandboxSessionId);
  }

  const proposedPlanArgs = toolCall.args as z.infer<
    typeof sessionPlanTool.schema
  >;

  // --- Frappe/ERPNext core file restriction enforcement ---
  const toolResponse = new ToolMessage({
    id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
    tool_call_id: toolCall.id ?? "",
    content: "Successfully saved plan.",
    name: sessionPlanTool.name,
  });

  const forbidden = proposedPlanArgs.plan.some(
    (item) => /frappe\//i.test(item) || /erpnext\//i.test(item)
  );
  if (forbidden) {
    return {
      messages: [response, toolResponse],
      proposedPlanTitle: "Invalid Plan",
      proposedPlan: [
        "This request cannot be completed because it requires modifying core files, which is not allowed. Please request a customization in one_fm only."
      ],
      ...(newSessionId && { sandboxSessionId: newSessionId }),
      tokenData: trackCachePerformance(response, modelName),
    };
  }
  // --- End restriction enforcement ---

  // Inject RUN_MIGRATION step if needed
  let plan = [...proposedPlanArgs.plan];
  const hasModifyCode = plan.some((item) => /MODIFY_CODE/i.test(item));
  const hasMigration = plan.some((item) => /RUN_MIGRATION/i.test(item));
  if (hasModifyCode && !hasMigration) {
    // Find the last MODIFY_CODE step
    let lastModifyIdx = -1;
    for (let i = 0; i < plan.length; i++) {
      if (/MODIFY_CODE/i.test(plan[i])) lastModifyIdx = i;
    }
    // Insert RUN_MIGRATION after last MODIFY_CODE
    if (lastModifyIdx !== -1) {
      plan.splice(
        lastModifyIdx + 1,
        0,
        'RUN_MIGRATION: Run bench migrate, clear-cache, and restart for the target site'
      );
    }
  }

  // Get the app name for the current site (fallback to one_fm if not found)
  let appName = "one_fm";
  try {
    const site = (config as any).site || process.env.FRAPPE_SITE || "onefm";
    const { apps } = await benchListAppsTool.invoke({ site });
    appName = (apps as string[]).find((a: string) => !["frappe", "erpnext"].includes(a)) || appName;
  } catch (e) {
    // fallback to default
  }

  const planWithAppName = plan.map((item: string) =>
    item.replace(/\[app_name\]/g, appName)
  );

  return {
    messages: [response, toolResponse],
    proposedPlanTitle: proposedPlanArgs.title,
    proposedPlan: planWithAppName,
    ...(newSessionId && { sandboxSessionId: newSessionId }),
    tokenData: trackCachePerformance(response, modelName),
  };
}