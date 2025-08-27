const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
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
  maxOutputTokens: 768, // Reduced significantly
  apiKey: process.env.GEMINI_API_KEY,
});

const mainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxRetries: 1,
  maxOutputTokens: 768, // Reduced from 256
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
      return combined.slice(-10);
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
});

// Optimized Graph with smarter routing
const graph = new StateGraph(State)
  .addNode("intentRouter", async (state) => {
    const { messages, userProfile } = state;
    const lastMessage = messages[messages.length - 1];

    // const queryIntent = `[Berdasarkan riwayat percakapan terakhir]:
    // ${[...messages]
    //   .filter((msg) => typeof msg.content === "string")
    //   .slice(-4)
    //   .map((msg, index) => {
    //     let content = ``;
    //     if (msg instanceof AIMessage && msg.response_metadata?.tokenUsage) {
    //       content = `${index + 1}.AI: Aku telah memberikan rekomendasi sepatu`;
    //     } else if (msg instanceof AIMessage) {
    //       content = `${index + 1}.AI: ${msg.content}`;
    //     } else if (msg instanceof HumanMessage) {
    //       content = `${index + 1}.User: ${msg.content}`;
    //     }
    //     return content;
    //   })
    //   .join(", ")}
    //   [Tugas]: Temukan intent untuk alur percakapan selanjutnya.
    // `;

    const queryIntent = `[Pertanyaan pengguna]: ${lastMessage.content}
    [Tugas]: Temukan intent untuk alur percakapan selanjutnya.`;

    console.log("QUERY INTENT : ", queryIntent);

    // Get intent from embedding system
    const intentResults = await findRelevantTools(queryIntent);
    console.log("INTENTS:", intentResults?.map((i) => i.name) || []);

    if (!intentResults?.length) {
      // Fallback for no intent detected
      const fallbackFlow = {
        type: "CONVO_FLOWS",
        needsTools: false,
        specificIntent: "generalInquiry",
      };
      return { flowType: fallbackFlow };
    }

    // Determine flow based on intents
    const flow = flowManager.determineFlow(intentResults);
    console.log("FLOW:", flow);

    // Generate ultra-compact instruction
    const instruction = flowManager.generatePrompt(
      flow.type,
      userProfile?.assistan_username,
      flow.specificIntent
    );
    console.log("INSTRUKSI : ", instruction);

    // If direct response available, skip LLM call entirely
    if (
      flow.type === "CONVO_FLOWS" &&
      flow.specificIntent === "startConversation" &&
      flowManager.intentActions[flow.specificIntent]
    ) {
      const directResponse = flowManager.intentActions[flow.specificIntent]();
      return {
        messages: [new AIMessage(directResponse)],
        flowType: flow,
      };
    }

    // Prepare model with or without tools
    let model = routerModel;
    if (flow.needsTools) {
      model = model.bindTools([toolsByName.searchShoes]);
    }

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", instruction],
      new MessagesPlaceholder("messages"),
    ]);

    const routerMessages = await prompt.formatMessages({ messages });
    const response = await model.invoke(routerMessages);

    console.log(
      "ROUTER:",
      response.usage_metadata,
      response.tool_calls?.length || 0,
      response.response_metadata
    );
    return { messages: [response], flowType: flow };
  })

  .addNode("responseGenerator", async (state) => {
    const { messages, userProfile, flowType } = state;

    // Ultra-minimal response generation for non-tool flows
    const instruction = `Asisten ${
      userProfile?.assistan_username || "Wawan"
    }. Jawab singkat dari hasil tool. Format HTML jika produk. Gunakan "Kak" 👟`;

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", instruction],
      new MessagesPlaceholder("messages"),
    ]);

    const formattedPrompt = await prompt.formatMessages({ messages });
    const response = await mainModel.invoke(formattedPrompt);

    console.log(
      "RESPONSE TOOLS GENERATOR:",
      response.usage_metadata,
      response.response_metadata
    );
    return { messages: [response] };
  })

  .addNode("tools", toolNode)
  .addEdge("__start__", "intentRouter")
  .addConditionalEdges("intentRouter", (state) => {
    const lastMessage = state.messages[state.messages.length - 1];

    // Check if tools needed
    if (lastMessage.tool_calls?.length > 0) {
      return "tools";
    }

    return END;
  })
  .addEdge("tools", "responseGenerator");

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
        messages: [new HumanMessage(userQuestion)],
        userProfile: { assistan_username, customer_username },
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
