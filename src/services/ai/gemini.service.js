const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const {
  MessagesPlaceholder,
  ChatPromptTemplate,
} = require("@langchain/core/prompts");
const { StateGraph, END, Annotation } = require("@langchain/langgraph");
const { generateRandomId } = require("../../helpers/generateRandomId");
const {
  AdvancedIntentFlowManager,
} = require("../../tools/classes/dynamic-prompt");

const routerModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
});

const summarizer = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
});

const mainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.7,
  maxRetries: 1,
  maxOutputTokens: 512, // Reduced from 256
  apiKey: process.env.GEMINI_API_KEY,
});

// const toolNode = new ToolNode(langChainTools);

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
  let context = ``;

  if (prevSummary) {
    context += `Summary lama: ${prevSummary}\n`;
  }
  if (messages.length > 0) {
    context += `Pesan baru: ${messages
      .map(
        (m) =>
          (m instanceof HumanMessage
            ? "Pengguna"
            : m instanceof ToolMessage
            ? "Tool"
            : "Assistant") +
          ": " +
          m.content
      )
      .join("\n")}`;
  }
  const response = await summarizer.invoke([
    new SystemMessage(
      "Ringkas percakapan untuk arsip, singkat, fokus info penting."
    ),
    new HumanMessage(context),
  ]);
  console.log(
    "RESPONSE SUMMARY TOKEN:",
    response.usage_metadata,
    response.response_metadata
  );
  return response.content;
};

const SUMMARY_INTERVAL = 5;

const summarizerNode = async (state) => {
  // cek kondisi: tiap 5 turn atau history > 20

  // Pastikan summary selalu ada, default-nya adalah string kosong jika undefined
  const prevSummary = state.summary || "";

  // Jalankan ringkasan jika turnCount <= 2 ATAU (ringkasan dijadwalkan)
  if (state.turnCount <= 2 || state.turnCount % SUMMARY_INTERVAL === 0) {
    const newMessages = state.messages
      .filter(
        (msg) =>
          msg instanceof HumanMessage ||
          (msg instanceof AIMessage && !Array.isArray(msg.content))
      )
      .slice(-3);

    const newSummary = await summarizeHistory(newMessages, prevSummary);
    console.log("NEW SUMMARY : ", newSummary);

    return {
      summary: newSummary,
      turnCount: 1, // Mengatur ulang turnCount setelah ringkasan
    };
  }

  // Jika kondisi di atas tidak terpenuhi, lewati ringkasan
  return {
    summary: prevSummary,
    turnCount: 1, // Mengatur ulang turnCount
  };
};

const intentRouter = async (state) => {
  const { messages, userProfile } = state;
  const lastMessages = [...messages]
    .filter(
      (msg) =>
        msg instanceof HumanMessage ||
        (msg instanceof AIMessage && !Array.isArray(msg.content))
    )
    .slice(-3);

  // Get intent from embedding system
  const intentResults = [];

  // Determine flow based on intents
  const flow = flowManager.determineFlow(intentResults);

  // Generate ultra-compact instruction
  const instruction = flowManager.generatePrompt(
    flow.type,
    userProfile?.assistan_username,
    flow.specificIntent
  );

  // Prepare model with or without tools
  let model = routerModel;
  // if (flow.needsTools) {
  //   model = model.bindTools([toolsByName.searchShoes]);
  // }
  model = model.bindTools([toolsByName.searchShoes]);
  console.log("SUMMARY : ", state.summary);

  const exampleInstruction = `
  [Tugas]:
  - Temuka salah satu kriteria sepatu pengguna (aktivitas, warna, ukuran).
  - Panggil tools 'searchShoes' Jika sudah menemukan kriteria.
  `;

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage({
      content: state.summary
        ? `[Ringkasan percakapan terakhir]:\n${state.summary}\n` +
          exampleInstruction
        : exampleInstruction,
      additional_kwargs: { uniqueTimeId: state.uniqueTimeId },
    }),
    new MessagesPlaceholder("messages"),
  ]);

  const formattedPrompt = await prompt.formatMessages({
    messages: lastMessages,
  });

  const response = await model.invoke(formattedPrompt);

  console.log(
    "ROUTER:",
    response.usage_metadata,
    response.tool_calls?.length || 0,
    response.response_metadata,
    `TURN COUNT = ${state.turnCount}`
  );

  return {
    messages: [
      new AIMessage({
        ...response,
        additional_kwargs: {
          ...response.additional_kwargs,
          uniqueTimeId: state.uniqueTimeId,
        },
      }),
    ],
    summary: state.summary,
  };
};

const toolNode = async (state) => {
  const { messages, uniqueTimeId } = state;
  const lastMessage = messages[messages.length - 1];

  // Pastikan pesan terakhir adalah AIMessage dengan tool_calls
  if (
    !(lastMessage instanceof AIMessage) ||
    !lastMessage.tool_calls ||
    lastMessage.tool_calls.length === 0
  ) {
    return state;
  }

  const toolMessages = [];

  // Loop melalui setiap tool call yang ditemukan
  for (const toolCall of lastMessage.tool_calls) {
    const tool = toolsByName[toolCall.name];

    if (tool) {
      try {
        // Eksekusi tool
        const result = await tool.invoke(toolCall.args);

        // Buat ToolMessage baru dengan uniqueTimeId
        const toolMsg = new ToolMessage({
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
          name: toolCall.name,
          additional_kwargs: {
            uniqueTimeId: uniqueTimeId, // Tambahkan uniqueTimeId di sini
          },
        });
        toolMessages.push(toolMsg);
      } catch (error) {
        console.error(`Error invoking tool ${toolCall.name}:`, error);

        const errorMsg = new ToolMessage({
          content: `Error: ${error.message}`,
          tool_call_id: toolCall.id,
          name: toolCall.name,
          additional_kwargs: {
            uniqueTimeId: uniqueTimeId,
          },
        });
        toolMessages.push(errorMsg);
      }
    } else {
      // Jika tool tidak ditemukan, berikan pesan error
      const notFoundMsg = new ToolMessage({
        content: `Tool ${toolCall.name} not found.`,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        additional_kwargs: {
          uniqueTimeId: uniqueTimeId,
        },
      });
      toolMessages.push(notFoundMsg);
    }
  }

  // Gabungkan pesan lama dengan ToolMessage yang baru dibuat

  // Kembalikan state dengan pesan yang diperbarui
  return {
    messages: toolMessages,
  };
};

const responseGenerator = async (state) => {
  const { messages, userProfile, flowType, uniqueTimeId } = state;
  const oneRoundMessages = [...messages].filter(
    (msg) => msg.additional_kwargs?.uniqueTimeId === uniqueTimeId
  );
  console.log("ONE ROUND MESSAGES : ", oneRoundMessages);

  // Ultra-minimal response generation for non-tool flows
  const instruction = `Asisten ${
    userProfile?.assistan_username || "Wawan"
  }. Jawab singkat dari hasil tool. Gunakan Format HTML jika ada produk. Gunakan "Kak" 👟`;

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(
      instruction + state.summary
        ? `Gunakan ringkasan percakapan:\n${state.summary}\n`
        : ""
    ),
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
