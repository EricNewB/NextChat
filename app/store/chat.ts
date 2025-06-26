import { getMessageTextContent, safeLocalStorage } from "../utils";

import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import { nanoid } from "nanoid";
import type { MultimodalContent, RequestMessage } from "../client/api";
import { getClientApi } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  GEMINI_SUMMARIZE_MODEL,
  DEEPSEEK_SUMMARIZE_MODEL,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import Locale, { getLang } from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { useAccessStore } from "./access";
import { collectModelsWithDefaultModel } from "../utils/model";
import { createEmptyMask, Mask } from "./mask";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";

const localStorage = safeLocalStorage();

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  // if it is using gpt-* models, force to use 4o-mini to summarize
  if (currentModel.startsWith("gpt") || currentModel.startsWith("chatgpt")) {
    const configStore = useAppConfig.getState();
    const accessStore = useAccessStore.getState();
    const allModel = collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
    const summarizeModel = allModel.find(
      (m) => m.name === SUMMARIZE_MODEL && m.available,
    );
    if (summarizeModel) {
      return [
        summarizeModel.name,
        summarizeModel.provider?.providerName as string,
      ];
    }
  }
  if (currentModel.startsWith("gemini")) {
    return [GEMINI_SUMMARIZE_MODEL, ServiceProvider.Google];
  } else if (currentModel.startsWith("deepseek-")) {
    return [DEEPSEEK_SUMMARIZE_MODEL, ServiceProvider.DeepSeek];
  }

  return [currentModel, providerName];
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const modelInfo = DEFAULT_MODELS.find((m) => m.name === modelConfig.model);

  var serviceProvider = "OpenAI";
  if (modelInfo) {
    // TODO: auto detect the providerName from the modelConfig.model

    // Directly use the providerName from the modelInfo
    serviceProvider = modelInfo.provider.providerName;
  }

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  const tools = await getAllTools();

  let toolsStr = "";

  tools.forEach((i) => {
    // error client has no tools
    if (!i.tools) return;

    toolsStr += MCP_TOOLS_TEMPLATE.replace(
      "{{ clientId }}",
      i.clientId,
    ).replace(
      "{{ tools }}",
      i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
    );
  });

  return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      forkSession() {
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        newSession.mask = { ...currentSession.mask };
        newSession.messages = [...currentSession.messages];
        newSession.memoryPrompt = currentSession.memoryPrompt;
        newSession.stat = { ...currentSession.stat };

        get().selectSession(get().sessions.length);

        set((state) => {
          newSession.id = nanoid();
          newSession.lastUpdate = Date.now();
          state.sessions.push(newSession);
          return state;
        });
      },

      clearSessions() {
        set((state) => {
          state.sessions = [createEmptySession()];
          state.currentSessionIndex = 0;
          return state;
        });
      },
      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex } = state;

          const session = sessions.splice(from, 1)[0];
          sessions.splice(to, 0, session);

          let newIndex =
            currentSessionIndex === from ? to : currentSessionIndex;
          if (currentSessionIndex > from && currentSessionIndex <= to) {
            newIndex -= 1;
          } else if (currentSessionIndex < from && currentSessionIndex >= to) {
            newIndex += 1;
          }

          state.currentSessionIndex = newIndex;
          return state;
        });
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();

        if (mask) {
          const globalModelConfig = useAppConfig.getState().modelConfig;
          const sessionModelConfig = mask.modelConfig;
          session.mask = {
            ...mask,
            // a new chat session should not have context - EXCEPT for Emora mask
            context: String(mask.id) === "100000" ? mask.context : [],
            modelConfig: {
              ...globalModelConfig,
              ...sessionModelConfig,
            },
          };
          if (mask.syncGlobalConfig) {
            session.mask.modelConfig.sendMemory =
              useAppConfig.getState().modelConfig.sendMemory;
          }
        }
        session.topic = session.mask.name;
        session.memoryPrompt = session.mask.context
          .map((m) => getMessageTextContent(m))
          .join("\n");

        set((state) => {
          session.id = nanoid();
          session.lastUpdate = Date.now();
          state.sessions.unshift(session);
          state.currentSessionIndex = 0;
          return state;
        });
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - (index < currentIndex ? 1 : 0),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete
        const lastSessions = get().sessions.slice();
        const lastIndex = get().currentSessionIndex;

        set((state) => {
          state.sessions = sessions;
          state.currentSessionIndex = nextIndex;
          return state;
        });

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set((state) => {
                state.sessions = lastSessions;
                state.currentSessionIndex = lastIndex;
                return state;
              });
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.max(0, Math.min(index, sessions.length - 1));
          set((state) => {
            state.currentSessionIndex = index;
            return state;
          });
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        targetSession.messages.push(message);
        targetSession.lastUpdate = Date.now();
        get().updateStat(message, targetSession);
        get().summarizeSession(false, targetSession);
      },

      async onUserInput(
        content: string,
        attachImages?: string[],
        isMcpResponse?: boolean,
      ) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;

        const userMessage: ChatMessage = createMessage({
          role: "user",
          content: content,
        });
        if (attachImages && attachImages.length > 0) {
          const multimodalContent: MultimodalContent[] = [];
          for (const url of attachImages) {
            multimodalContent.push({
              type: "image_url",
              image_url: {
                url: url,
              },
            });
          }
          userMessage.content = multimodalContent;
        }

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          isMcpResponse: isMcpResponse,
        });

        // get all messages for this session
        const recentMessages = await get().getMessagesWithMemory();
        const allMessages = recentMessages.concat(userMessage);
        const clientApi = getClientApi(modelConfig.providerName);
        const controller = new AbortController();
        const { signal } = controller;

        const chatPayload = {
          messages: allMessages,
          config: {
            ...modelConfig,
            stream: true,
            providerName: modelConfig.providerName,
          },
          onUpdate(message: string) {
            botMessage.streaming = true;
            if (message) botMessage.content = message;
            get().updateMessage(
              get().currentSessionIndex,
              botMessage.id,
              (msg) => {
                if (msg) msg.content = message;
              },
            );
          },
          async onFinish(message: string, responseRes: any) {
            botMessage.streaming = false;
            if (message) botMessage.content = message;
            if (responseRes?.audio_url)
              botMessage.audio_url = responseRes?.audio_url;
            get().updateMessage(
              get().currentSessionIndex,
              botMessage.id,
              (msg) => {
                if (msg) {
                  msg.streaming = false;
                  if (message) msg.content = message;
                  if (responseRes?.audio_url)
                    msg.audio_url = responseRes?.audio_url;
                }
              },
            );
            ChatControllerPool.remove(session.id, botMessage.id);

            // check mcp-json format
            if (!isMcpResponse && isMcpJson(message))
              await get().checkMcpJson(botMessage);
          },
          onBeforeTool(tool: ChatMessageTool) {
            get().updateMessage(
              get().currentSessionIndex,
              botMessage.id,
              (msg) => {
                if (!msg) return;
                if (!msg.tools) msg.tools = [];
                msg.tools.push(tool);
              },
            );
          },
          onAfterTool(tool: ChatMessageTool) {
            get().updateMessage(
              get().currentSessionIndex,
              botMessage.id,
              (msg) => {
                if (!msg) return;
                if (!msg.tools) return;
                const index = msg.tools.findIndex((t) => t.id === tool.id);
                if (index === -1) return;
                msg.tools[index] = tool;
              },
            );
          },
          onError(error: Error) {
            const isAborted = error.message.includes("aborted");
            botMessage.content +=
              "\n\n" +
              prettyObject({
                error: true,
                message: error.message,
              });
            botMessage.streaming = false;
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;
            get().updateMessage(
              get().currentSessionIndex,
              botMessage.id,
              (msg) => {
                if (msg) {
                  msg.content = botMessage.content;
                  msg.isError = !isAborted;
                }
              },
            );
            ChatControllerPool.remove(session.id, botMessage.id);

            console.error("[Chat] failed ", error);
          },
          onController(controller: AbortController) {
            // Attach the controller to the session id
            ChatControllerPool.addController(
              session.id,
              botMessage.id,
              controller,
            );
          },
        };
        // client side call a api to chat
        get().onNewMessage(userMessage, session);
        get().onNewMessage(botMessage, session);
        await clientApi.llm.chat(chatPayload);
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        return {
          role: "system",
          content:
            session.memoryPrompt.length > 0
              ? Locale.Store.Prompt.History(session.memoryPrompt)
              : "",
          date: "",
        } as ChatMessage;
      },
      async getMessagesWithMemory() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const config = useAppConfig.getState();

        // some models do not support system prompt, write it in user prompt
        const systemPrompt =
          modelConfig.enableInjectSystemPrompts &&
          session.mask.context.length > 0
            ? session.mask.context
            : [];
        const memoryPrompt = get().getMemoryPrompt();
        if (memoryPrompt.content.length > 0) {
          memoryPrompt.content =
            memoryPrompt.content + "\n" + (await getMcpSystemPrompt());
        } else {
          memoryPrompt.content = await getMcpSystemPrompt();
        }
        const chatMemos = session.mask.context
          .slice()
          .concat(memoryPrompt.content.length > 0 ? memoryPrompt : []);
        const limit = config.modelConfig.historyMessageCount;
        const recentMessages = session.messages.slice(-limit).map(async (m) => {
          if (m.role === "user" && (await isMcpEnabled())) {
            const messageContent =
              typeof m.content === "string"
                ? m.content
                : getMessageTextContent(m);
            return {
              ...m,
              content: fillTemplateWith(messageContent, modelConfig),
            };
          }
          return m;
        });

        // Wait for all async operations to complete
        const resolvedRecentMessages = await Promise.all(recentMessages);

        // see discussion point 2 here: https://github.com/orgs/Yidadaa/discussions/1070
        const recentMessagesWithCutoff = resolvedRecentMessages.filter(
          (m) =>
            !m.date ||
            (m.date &&
              new Date(m.date) >
                new Date(
                  new Date().setDate(
                    new Date().getDate() -
                      config.modelConfig.historyMessageCount,
                  ),
                )),
        );
        const sendMessages = chatMemos.concat(recentMessagesWithCutoff);

        return sendMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageId: string,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions[sessionIndex];
        const messageIndex = session.messages.findIndex(
          (m) => m.id === messageId,
        );
        if (messageIndex < 0) return;
        updater(session.messages[messageIndex]);
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        const config = useAppConfig.getState();

        let PADDING_MESSAGE_COUNT = 4;
        const messages = session.messages;

        // some models do not support system prompt, write it in user prompt
        const systemPrompt =
          modelConfig.enableInjectSystemPrompts &&
          session.mask.context.length > 0
            ? session.mask.context
                .map((m) => m.content)
                .join("\n")
                .trim()
            : "";

        if (
          messages.length <=
            session.lastSummarizeIndex + PADDING_MESSAGE_COUNT &&
          !refreshTitle
        )
          return;

        const memoryPrompt = get().getMemoryPrompt();

        let newTopic = session.topic;
        const earlyMsgs = session.messages.slice(0, session.lastSummarizeIndex);
        const recentMsgs = session.messages.slice(session.lastSummarizeIndex);

        let summarized = session.memoryPrompt;

        const [summarizeModel, summarizeProvider] = getSummarizeModel(
          modelConfig.model,
          (modelConfig.providerName as string) ?? ServiceProvider.OpenAI,
        );

        if (
          !summarizeModel ||
          (config.modelConfig.compressMessageLengthThreshold &&
            session.topic !== DEFAULT_TOPIC &&
            !refreshTitle)
        ) {
          // just store recent messages
          session.memoryPrompt = summarized.length > 0 ? summarized : "";
          return;
        }

        const tokens = countMessages(recentMsgs);
        const maxTokens = config.modelConfig.max_tokens;

        // do not summarize if tokens are not enough
        if (tokens < maxTokens * 0.3 && !refreshTitle) return;

        // add a word limit to memory prompt
        const memoryLimit = 4000;
        if (summarized.length > memoryLimit) {
          summarized = summarized.slice(summarized.length - memoryLimit);
        }

        const client = getClientApi(summarizeProvider as ServiceProvider);
        const controller = new AbortController();
        const { signal } = controller;

        const rawMessages = recentMsgs.map((m) => ({
          role: m.role,
          content: getMessageTextContent(m),
        }));

        const chatPayload = {
          messages: [
            ...systemPrompt,
            ...earlyMsgs,
            memoryPrompt,
            ...rawMessages,
          ].map((m: any) => ({
            role: m.role,
            content: getMessageTextContent(m),
          })),
          config: {
            model: summarizeModel,
            stream: false,
            temperature: 0.1,
            providerName: summarizeProvider,
          },
          onUpdate(message: string) {},
          async onFinish(message: string, responseRes: any) {
            let memoryContent = "";
            let topic = session.topic;

            if (message.includes("记忆：")) {
              const splited = message.split("记忆：");
              topic = splited[0].replace("标题：", "").trim();
              memoryContent = splited[1].trim();
            } else {
              memoryContent = message;
            }

            // console.log("[summary] topic: ", topic, "memory: ", memoryContent);
            get().updateTargetSession(session, (session) => {
              session.topic = topic;
              session.memoryPrompt = memoryContent;
              session.lastSummarizeIndex = session.messages.length;
            });
            if (refreshTitle) {
              showToast(`标题已更新: ${topic}`);
            }
          },
          onError(err: Error) {
            console.error("[summarize] failed", err);
          },
          onController(controller: AbortController) {},
        };
        client.llm.chat(chatPayload);
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        const messageContent = getMessageTextContent(message);
        session.stat.charCount += messageContent.length;
        // TODO: should be improved
        session.stat.wordCount = session.stat.charCount / 2;
        session.stat.tokenCount = estimateTokenLength(messageContent);
      },

      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const sessions = get().sessions.slice();
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index === -1) return;
        const session = sessions[index];
        updater(session);
        set(() => ({ sessions }));
      },
      async clearAllData() {
        if (confirm(Locale.Settings.Danger.Clear.Confirm)) {
          await indexedDBStorage.clear();
          localStorage.clear();
          location.reload();
        }
      },
      setLastInput(lastInput: string) {
        set({ lastInput });
      },
      getLastInput() {
        return get().lastInput;
      },

      async checkMcpJson(message: ChatMessage) {
        const session = get().currentSession();

        const mcpActionJson = extractMcpJson(getMessageTextContent(message));
        if (!mcpActionJson) return;

        const { clientId, mcp } = mcpActionJson;
        const action = mcp?.action;
        const params = mcp?.params;
        const think = mcp?.think;

        if (!action || !params) return;

        const executeThinkContent = `我将执行一个Mcp Action:
\`\`\`json
${JSON.stringify({ action, params }, null, 2)}
\`\`\`
${think || ""}`;

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          content: executeThinkContent,
          isMcpResponse: true,
        });

        get().onNewMessage(botMessage, session);

        await executeMcpAction(action, params);
      },
    };

    return {
      ...DEFAULT_CHAT_STATE,
      ...methods,
      get,
    };
  },
  {
    name: StoreKey.Chat,
    version: 3.1,
    migrate(persistedState, version) {
      const state = persistedState as any;
      if (version < 2) {
        state.sessions.forEach((s: ChatSession) => {
          s.mask.modelConfig = {
            ...useAppConfig.getState().modelConfig,
            ...s.mask.modelConfig,
          };
          s.mask.modelConfig.sendMemory = true;
          // make sure all sessions' modelConfig has sendMemory
        });
      }
      if (version < 3) {
        state.sessions.forEach((s: ChatSession) => {
          s.messages.forEach((m: ChatMessage) => {
            if (m.date) return;
            m.date = new Date().toLocaleString();
          });
        });
      }
      if (version < 3.1) {
        state.sessions.forEach((s: ChatSession) => {
          if (s.mask.modelConfig.providerName) return;
          const modelName = s.mask.modelConfig.model;
          const provider = collectModelsWithDefaultModel(
            useAppConfig.getState().models,
            [
              useAppConfig.getState().customModels,
              useAccessStore.getState().customModels,
            ].join(","),
            useAccessStore.getState().defaultModel,
          ).find((m) => m.name === modelName)?.provider;
          s.mask.modelConfig.providerName =
            (provider?.providerName as ServiceProvider) ??
            ServiceProvider.OpenAI;
        });
      }

      return state as any;
    },
    onRehydrateStorage: (state) => {
      if (state) {
        // Use setTimeout to avoid accessing useChatStore before initialization
        setTimeout(() => {
          useChatStore.setState({
            lastInput: state.lastInput,
          });
        }, 0);
      }
    },
  },
);
