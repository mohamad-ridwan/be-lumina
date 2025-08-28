const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");
const {
  MessagesPlaceholder,
  ChatPromptTemplate,
} = require("@langchain/core/prompts");
const { StateGraph, END, Annotation } = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { langChainTools, toolsByName } = require("../../tools/langChainTools");
const { generateRandomId } = require("../../helpers/generateRandomId");
const {
  AdvancedIntentFlowManager,
} = require("../../tools/classes/dynamic-prompt");
const { findRelevantTools } = require("../../tools/function/tool-description");

const routerModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxRetries: 2,
  maxOutputTokens: 256, // Reduced significantly
  apiKey: process.env.GEMINI_API_KEY,
});

const summarizer = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.7,
  maxOutputTokens: 1024, // Reduced significantly
  apiKey: process.env.GEMINI_API_KEY,
});

const mainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxRetries: 1,
  maxOutputTokens: 512, // Reduced from 256
  apiKey: process.env.GEMINI_API_KEY,
});

const toolNode = new ToolNode(langChainTools);

const flowManager = new AdvancedIntentFlowManager();

// Definisikan tipe state untuk LangGraph
const State = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => {
      const combined = x.concat(y);
      // Keep only last 10 messages to minimize context
      return combined;
    },
    default: () => [],
  }),
  userProfile: Annotation({
    reducer: (x) => x,
    default: () => {},
  }),
  intent: Annotation({
    reducer: (x, y) => y || x,
    default: () => null,
  }),
  summary: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  turnCount: Annotation({
    reducer: (x, y) => (x ?? 0) + (y ?? 0),
    default: () => 0,
  }),
  uniqueTimeId: Annotation({
    reducer: (x, y) => y || x,
    default: () => generateRandomId(10),
  }),
});

const summarizeHistory = async (messages, prevSummary) => {
  const response = await summarizer.invoke([
    {
      role: "system",
      content: "Ringkas percakapan untuk arsip, singkat, fokus info penting.",
    },
    {
      role: "user",
      content: `Summary lama:\n${prevSummary}\n\nPesan baru:\n${messages
        .map((m) => m.role + ": " + m.content)
        .join("\n")}`,
    },
  ]);
  console.log(
    "RESPONSE SUMMARY TOKEN:",
    response.usage_metadata,
    response.response_metadata
  );
  return response.content;
};

const MAX_HISTORY = 5;
const SUMMARY_INTERVAL = 5;

const summarizerNode = async (state) => {
  // cek kondisi: tiap 5 turn atau history > 20
  console.log("TURN COUNT:", state.turnCount);
  console.log("CURRENT SUMMARY:", state.summary);

  // Pastikan summary selalu ada, default-nya adalah string kosong jika undefined
  const prevSummary = state.summary || "";

  if (
    state.turnCount % SUMMARY_INTERVAL !== 0 &&
    state.messages.length <= MAX_HISTORY
  ) {
    return {
      // Pastikan selalu mengembalikan summary, meskipun tidak diringkas ulang
      summary: prevSummary,
      messages: state.messages,
    };
  }

  const newMessages = state.messages
    .filter(
      (msg) =>
        msg instanceof HumanMessage ||
        (msg instanceof AIMessage && !Array.isArray(msg.content))
    )
    .slice(-3);
  console.log("PESAN BARU : ", newMessages);

  // Jika tidak ada pesan baru, kembalikan summary yang ada tanpa ringkasan baru
  if (newMessages.length === 0) {
    return {
      summary: prevSummary,
      messages: state.messages,
    };
  }

  const newSummary = await summarizeHistory(newMessages, prevSummary);
  console.log("NEW SUMMARY : ", newSummary);

  return {
    summary: newSummary,
    messages: state.messages
      .filter(
        (msg) =>
          msg instanceof HumanMessage ||
          (msg instanceof AIMessage && !Array.isArray(msg.content))
      )
      .slice(-3),
  };
};

const intentRouter = async (state) => {
  const { messages, userProfile } = state;

  const queryIntent = `[Berdasarkan riwayat percakapan terakhir]:
    ${[...messages]
      .filter(
        (msg) =>
          msg instanceof HumanMessage ||
          (msg instanceof AIMessage && !Array.isArray(msg.content))
      )
      .slice(-3)
      .map((msg, index) => {
        let content = ``;
        if (msg instanceof AIMessage && !Array.isArray(msg.content)) {
          content = `${
            index + 1
          }.Assistant: Aku telah memberikan rekomendasi sepatu`;
        } else if (msg instanceof AIMessage) {
          content = `${index + 1}.Assistant: ${msg.content}`;
        } else if (msg instanceof HumanMessage) {
          content = `${index + 1}.User: ${msg.content}`;
        }
        return content;
      })
      .join(", ")}
      [Tugas]: Temukan intent untuk alur percakapan selanjutnya.
    `;

  // Get intent from embedding system
  const intentResults = await findRelevantTools(queryIntent);
  console.log(
    "INTENT RESULTS: ",
    intentResults.map((i) => i.name)
  );

  // Determine flow based on intents
  const flow = flowManager.determineFlow(intentResults);
  console.log("FLOW:", flow);

  // Generate ultra-compact instruction
  const instruction = flowManager.generatePrompt(
    flow.type,
    userProfile?.assistan_username,
    flow.specificIntent
  );

  // Prepare model with or without tools
  let model = routerModel;
  if (flow.needsTools) {
    model = model.bindTools([toolsByName.searchShoes]);
  }

  const recentMessages = [...messages]
    .filter(
      (msg) =>
        msg instanceof HumanMessage ||
        (msg instanceof AIMessage && !Array.isArray(msg.content))
    )
    .slice(-1);
  console.log("FULL MESSAGES :", messages.length);
  console.log("SUMMARY : ", state.summary);
  const context = [
    new SystemMessage(
      instruction +
        `Gunakan ringkasan percakapan:\n${state.summary || "Belum ada"}\n`
    ),
    ...recentMessages,
  ];

  const response = await model.invoke(context);

  console.log(
    "ROUTER:",
    response.usage_metadata,
    response.tool_calls?.length || 0,
    response.response_metadata
  );

  if (response.tool_calls?.length > 0) {
    return {
      messages: [
        new AIMessage({
          ...response,
          additional_kwargs: { uniqueTimeId: state.uniqueTimeId },
        }),
      ],
      turnCount: 1,
      summary: state.summary,
    };
  }
  return { messages: [response], turnCount: 1, summary: state.summary };
};

const responseGenerator = async (state) => {
  const { messages, userProfile, flowType, uniqueTimeId } = state;
  const oneRoundMessages = [...messages].filter(
    (msg) => msg.uniqueTimeId === uniqueTimeId
  );
  console.log("FULL MESSAGES IN TOOLS RESPONSE:", messages);

  // Ultra-minimal response generation for non-tool flows
  const instruction = `Asisten ${
    userProfile?.assistan_username || "Wawan"
  }. Jawab singkat dari hasil tool. Gunakan Format HTML jika ada produk. Gunakan "Kak" 👟`;

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      instruction + state.summary
        ? `Gunakan ringkasan percakapan:\n${state.summary}\n`
        : "",
    ],
    new MessagesPlaceholder("messages"),
  ]);

  const formattedPrompt = await prompt.formatMessages({
    messages: oneRoundMessages,
  });
  const response = await mainModel.invoke(formattedPrompt);

  console.log(
    "RESPONSE TOOLS GENERATOR:",
    response.usage_metadata,
    response.response_metadata
  );
  return { messages: [response], summary: state.summary };
};

const intentRouterConditional = (state) => {
  const lastMessage = state.messages[state.messages.length - 1];

  // Check if tools needed
  if (lastMessage.tool_calls?.length > 0) {
    return "tools";
  }

  return END;
};

// Optimized Graph with smarter routing
const graph = new StateGraph(State)
  .addNode("summarize", summarizerNode)
  .addNode("intentRouter", intentRouter)
  .addNode("responseGenerator", responseGenerator)
  .addNode("tools", toolNode)
  .addEdge("__start__", "summarize")
  .addConditionalEdges("intentRouter", intentRouterConditional)
  .addEdge("summarize", "intentRouter")
  .addEdge("tools", "responseGenerator")
  .addEdge("responseGenerator", END);

const processNewMessageWithAI = async (
  formattedHistory,
  message,
  sendMessageCallback,
  { io, socket, client, agenda, assistan_username, customer_username, agentApp }
) => {
  const latestMessageTimestamp = Date.now();
  const messageId = generateRandomId(15);

  try {
    const threadId = message?.chatRoomId;
    const userQuestion = message.latestMessage?.textMessage || "";

    if (!threadId) {
      const fallback = generateFallback(assistan_username, customer_username);
      await sendResponse(fallback, []);
      return fallback;
    }

    const startTime = Date.now();

    const finalState = await agentApp.invoke(
      {
        messages: [
          new HumanMessage({
            content: userQuestion,
            additional_kwargs: {
              uniqueTimeId: messageId,
            },
          }),
        ],
        userProfile: { assistan_username, customer_username },
        uniqueTimeId: messageId,
      },
      { configurable: { thread_id: threadId } }
    );

    const responseMessage = finalState.messages[finalState.messages.length - 1];
    const finalResponse = extractResponseContent(responseMessage);

    console.log(
      `Processing: ${Date.now() - startTime}ms, Flow: ${
        finalState.flowType?.type
      }`
    );

    await sendResponse(finalResponse, finalState);
    return finalResponse;
  } catch (error) {
    const errorResponse = generateFallback(
      assistan_username,
      customer_username
    );
    await sendResponse(errorResponse, []);
    console.error("AI error:", error.message);
    return errorResponse;
  }

  function generateFallback(assistantName, customerName) {
    const name = assistantName || "Wawan";
    const customer = customerName ? ` Kak ${customerName}` : " Kakak";
    return `Maaf${customer}, ${name} ada kendala. Coba lagi ya 👟`;
  }

  async function sendResponse(response, state) {
    await sendMessageCallback(response, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData: state?.productData || [],
      toolArguments: state?.tool_arguments || [],
      orderData: {},
    });
  }
};

function extractResponseContent(responseMessage) {
  if (Array.isArray(responseMessage.content)) {
    return responseMessage.content.find((msg) => msg.type === "text")?.text;
  }
  return responseMessage.content;
}

module.exports = {
  mainModel,
  processNewMessageWithAI,
  graph,
};
