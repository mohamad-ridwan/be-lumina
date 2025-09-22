const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const {
  MessagesPlaceholder,
  ChatPromptTemplate,
} = require("@langchain/core/prompts");
const { StateGraph, END, Annotation } = require("@langchain/langgraph");
const { z } = require("zod");
const { generateRandomId } = require("../../helpers/generateRandomId");
const {
  AdvancedIntentFlowManager,
} = require("../../tools/classes/dynamic-prompt");
const { toolsByName } = require("../../tools/langChainTools");
const { stripHtml } = require("../../helpers/general");

const parser = StructuredOutputParser.fromZodSchema(
  z.object({
    intent: z
      .string()
      .describe(
        "Intent pelanggan di percakapan. Contoh: Pelanggan tertarik sepatu lari yang direkomendasikan"
      ),
    criteria: z.object({
      aktivitas: z.string().optional(),
      preferensi: z
        .string()
        .optional()
        .describe(
          "Preferensi sepatu. Contoh: warna putih, ukuran 40, bahan yang nyaman, empuk"
        ),
    }),
    // conversationState: z
    //   .enum([
    //     "ongoing",
    //     "needs_clarification",
    //     "search_failed",
    //     "recommendation_process",
    //     "interested_users",
    //   ])
    //   .optional()
    //   .describe("Intent yang ada di percakapan"),
  })
);

const routerModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY,
});

const summarizer = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
});

const mainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
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
  toolResult: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  structuredSummary: Annotation({
    // <-- tambahan
    reducer: (x, y) => ({ ...x, ...y }), // merge JSON lama + baru
    default: () => ({}),
  }),
  uniqueTimeId: Annotation({
    reducer: (x, y) => y || x,
    default: () => generateRandomId(10),
  }),
});

const parseToolResult = async (text) => {
  try {
    const json = JSON.parse(text);
    if (json?.content) {
      return json.content;
    }
    return json;
  } catch (error) {
    return "Pencarian data tidak ditemukan.";
  }
};

const formatMessagesForPrompt = async (messages) => {
  const formattedMessages = await Promise.all(
    messages.map(async (m) => {
      // Tentukan peran pesan dengan lebih ringkas
      const role =
        m instanceof HumanMessage
          ? "User"
          : m instanceof ToolMessage
          ? "Tool"
          : "Assistant";

      // Ambil konten pesan
      let content = "";
      if (m instanceof ToolMessage) {
        // Asumsi parseToolResult adalah fungsi async
        content = await parseToolResult(m.content);
      } else if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content) && m.tool_calls) {
        // Tangani tool_calls dengan lebih spesifik
        content = m.tool_calls
          .map(
            (tc) =>
              `Calling tool '${tc.name}' with args: ${JSON.stringify(tc.args)}`
          )
          .join(", ");
      } else {
        // Default konten jika format tidak dikenal
        content = "Message content received.";
      }

      const cleanedContent = stripHtml(content);
      const compactedContent = cleanedContent.replace(/\s+/g, " ").trim();

      return `${role}: ${compactedContent}`;
    })
  );

  return formattedMessages.join("\n");
};

const summarizerHistoryWithTools = async (
  messages,
  prevSummary,
  prevStructured = {}
) => {
  const formatInstructions = parser.getFormatInstructions();

  // Format pesan baru ke dalam string yang ringkas
  const formattedMessages = await formatMessagesForPrompt(messages);

  const response = await summarizer.invoke([
    new SystemMessage(
      `Kamu adalah summarizer percakapan.
       Ringkas percakapan singkat untuk arsip.
       Ekstrak info penting dalam format JSON.
       ${formatInstructions}
       `
    ),
    new HumanMessage(
      `Summary lama:\n${prevSummary || ""}\n
       Structured lama:\n${JSON.stringify(prevStructured || {}, null, 2)}\n
       Pesan baru:\n${formattedMessages}` // Gunakan formattedMessages di sini
    ),
  ]);

  console.log(
    "TOKEN FOR SUMMMARIZER WITH TOOLS:",
    response.usage_metadata,
    response.response_metadata
  );

  const structuredPart = await parser.parse(response.content);
  return { text: response.content, structured: structuredPart };
};

const summarizeHistory = async (messages, prevSummary, prevStructured = {}) => {
  const context = messages
    .map(
      (m) =>
        (m instanceof HumanMessage
          ? "User"
          : m instanceof ToolMessage
          ? "Tool"
          : "Assistant") +
        ": " +
        (() => {
          const cleanedContent = stripHtml(m.content);
          const compactedContent = cleanedContent.replace(/\s+/g, " ").trim();
          return compactedContent;
        })()
    )
    .join("\n");

  const formatInstructions = parser.getFormatInstructions();

  const response = await summarizer.invoke([
    new SystemMessage(
      `Kamu adalah summarizer percakapan. 
    Ringkas percakapan singkat untuk arsip.
    Ekstrak info penting dalam format JSON. 
    ${formatInstructions}`
    ),
    new HumanMessage(
      `Summary lama:\n${prevSummary}\n
    Structured lama:\n${JSON.stringify(prevStructured, null, 2)}\n
    Pesan baru:\n${context}`
    ),
  ]);

  console.log(
    "TOKEN USAGE FOR SUMMARIZER:",
    response.usage_metadata,
    response.response_metadata
  );

  const structuredPart = await parser.parse(response.content);

  return { text: response.content, structured: structuredPart };
};

const SUMMARY_INTERVAL = 3;

const summarizerNode = async (state) => {
  // cek kondisi: tiap 5 turn atau history > 20

  // Pastikan summary selalu ada, default-nya adalah string kosong jika undefined
  const prevSummary = state.summary || "";
  const prevStructured = state.structuredSummary || {};

  // Jalankan ringkasan jika turnCount <= 2 ATAU (ringkasan dijadwalkan)
  if (state.turnCount === 0 || state.turnCount % SUMMARY_INTERVAL === 0) {
    const newMessages = state.messages
      .filter(
        (msg) =>
          msg instanceof HumanMessage ||
          (msg instanceof AIMessage && !Array.isArray(msg.content))
      )
      .slice(-5);

    const { text, structured } = await summarizeHistory(
      newMessages,
      prevSummary,
      prevStructured
    );

    return {
      summary: text,
      structuredSummary: structured,
      turnCount: 1,
    };
  }

  // Jika kondisi di atas tidak terpenuhi, lewati ringkasan
  return {
    turnCount: 1, // Mengatur ulang turnCount
  };
};

const updateSummarizeNode = async (state) => {
  const prevSummary = state.summary || "";
  const prevStructured = state.structuredSummary || {};

  const oneRoundMessages = [...state.messages].filter(
    (msg) =>
      msg.additional_kwargs?.uniqueTimeId === state.uniqueTimeId &&
      ((msg instanceof AIMessage && msg.tool_calls.length > 0) ||
        msg instanceof HumanMessage ||
        msg instanceof ToolMessage)
  );

  const toolResults = [];
  for (const msg of oneRoundMessages) {
    if (msg instanceof AIMessage && msg.tool_calls?.length > 0) {
      // Cari ToolMessage yang punya tool_call_id sama
      for (const call of msg.tool_calls) {
        const toolMsg = oneRoundMessages.find(
          (m) => m instanceof ToolMessage && m.tool_call_id === call.id
        );

        toolResults.push({
          tool_name: call.name,
          args: call.args,
          result: toolMsg ? toolMsg.content : null,
        });
      }
    }
  }

  const { text, structured } = await summarizerHistoryWithTools(
    oneRoundMessages,
    prevSummary,
    prevStructured
  );

  return {
    summary: text,
    structuredSummary: structured,
    toolResult: toolResults,
  };
};

const intentRouter = async (state) => {
  const { messages, userProfile, structuredSummary, toolResult } = state;
  const lastMessages = [...messages]
    .filter(
      (msg) =>
        msg instanceof HumanMessage ||
        (msg instanceof AIMessage && !Array.isArray(msg.content))
    )
    .map((msg) => {
      const cleanedContent = stripHtml(msg.content);
      const compactedContent = cleanedContent.replace(/\s+/g, " ").trim();
      msg.content = compactedContent;
      return msg;
    })
    .slice(-3);

  const criteria = structuredSummary?.criteria || {};
  const intent = structuredSummary?.intent || "unknown";

  const toolExecutionHistory = `
  - Riwayat Tools:
  ${
    toolResult?.length
      ? toolResult
          .map(
            (tr, i) => `(${i + 1})
  - Tool Name: ${tr.tool_name}
  - Args: ${JSON.stringify(tr.args)}
  - Result: ${typeof tr.result === "string" ? tr.result : ""}
  `
          )
          .join("\n")
      : "- Belum ada tool yang pernah dijalankan"
  }
`;

  const persona = `Sebagai {assistan_username}, asisten yang ramah dan gaul. Selalu gunakan sapaan "Kak".`;

  const criteriaFormatted = Object.entries(criteria)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  const conversationSummary = `
  [Konteks Percakapan]:
  - Tujuan: ${intent}
  ${criteriaFormatted ? `- Criteria: ${criteriaFormatted}` : ""}
  ${toolExecutionHistory}
  `;

  const rule = `
  [Format Jawaban]:
- Maksimal 100-250 karakter dan 15-40 kata.
- Format teks dengan HTML untuk keterbacaan.
- Gunakan tag <strong>, <i> untuk info penting.
- Ukuran teks 13px dengan warna #000.
- Gunakan <br/> untuk baris baru.
  `;

  const task = `
  [Tugas]:
  - Panggil tool yang tersedia jika user menyebutkan aktivitas dan salah satu dari warna atau ukuran.
- Gunakan tool untuk rekomendasi sepatu, bukan sumber eksternal.
  `;
  const instruction = `
${persona} 
${conversationSummary} 
${task}
${rule} 
`;

  console.log("INSTRUCTION ROUTER:", instruction);

  // Prepare model with or without tools
  let model = routerModel;
  // if (flow.needsTools) {
  //   model = model.bindTools([toolsByName.searchShoes]);
  // }
  model = model.bindTools([toolsByName.searchShoes]);

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage({
      content: instruction,
      additional_kwargs: { uniqueTimeId: state.uniqueTimeId },
    }),
    new MessagesPlaceholder("messages"),
  ]);

  const formattedPrompt = await prompt.formatMessages({
    messages: lastMessages,
    assistan_username: userProfile?.assistan_username || "Wawan",
  });

  const response = await model.invoke(formattedPrompt);

  console.log(
    "ROUTER INFO :",
    response.usage_metadata,
    response.response_metadata,
    state.turnCount
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
  const { messages, userProfile, uniqueTimeId, structuredSummary } = state;
  const oneRoundMessages = [...messages]
    .filter((msg) => msg.additional_kwargs?.uniqueTimeId === uniqueTimeId)
    .map((msg) => {
      if (typeof msg?.content === "string") {
        const cleanedContent = stripHtml(msg.content);
        const compactedContent = cleanedContent.replace(/\s+/g, " ").trim();
        msg.content = compactedContent;
      }
      return msg;
    });

  const criteria = structuredSummary?.criteria || {};
  const intent = structuredSummary?.intent || "unknown";

  const criteriaFormatted = Object.entries(criteria)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  const persona = `Sebagai {assistan_username}, asisten yang ramah dan gaul. Selalu gunakan sapaan "Kak".`;

  const conversationSummary = `
  [Konteks Percakapan]:
  - Tujuan: ${intent}
  ${criteriaFormatted ? `- Criteria: ${criteriaFormatted}` : ""}
  `;

  const rule = `
  [Format Jawaban]:
- Maksimal 100-250 karakter dan 15-40 kata.
- Format teks dengan HTML untuk keterbacaan.
- Gunakan tag <strong>, <i> untuk info penting.
- Ukuran teks 13px dengan warna #000.
- Gunakan <br/> untuk baris baru.
  `;

  // Ultra-minimal response generation for non-tool flows
  const instruction = `${persona} ${conversationSummary} ${rule}`;

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(instruction),
    new MessagesPlaceholder("messages"),
  ]);

  const formattedPrompt = await prompt.formatMessages({
    messages: oneRoundMessages,
    assistan_username: userProfile?.assistan_username || "Wawan",
  });
  const response = await mainModel.invoke(formattedPrompt);

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
  };
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
  .addNode("updateSummarize", updateSummarizeNode)
  .addNode("tools", toolNode)
  .addEdge("__start__", "summarize")
  .addConditionalEdges("intentRouter", intentRouterConditional)
  .addEdge("summarize", "intentRouter")
  .addEdge("tools", "responseGenerator")
  .addEdge("responseGenerator", "updateSummarize")
  .addEdge("updateSummarize", END);

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
