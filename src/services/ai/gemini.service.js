const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const {
  MessagesPlaceholder,
  ChatPromptTemplate,
} = require("@langchain/core/prompts");
const { StateGraph, END, Annotation } = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { langChainTools, toolsByName } = require("../../tools/langChainTools");
const { generateRandomId } = require("../../helpers/generateRandomId");
const { instructionGen } = require("../../tools/classes/dynamic-prompt");
const { findRelevantTools } = require("../../tools/function/tool-description");

const routerModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxRetries: 2,
  maxOutputTokens: 768, // Reduced from 128
  apiKey: process.env.GEMINI_API_KEY,
});

const mainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.7,
  maxRetries: 1,
  maxOutputTokens: 256, // Reduced from 128
  apiKey: process.env.GEMINI_API_KEY,
});

// const mainModelWithTools = routerModel.bindTools(langChainTools);
const toolNode = new ToolNode(langChainTools);

// Definisikan tipe state untuk LangGraph
const State = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => {
      const combined = x.concat(y);
      // Keep only last 2 messages to minimize context
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
});

// Optimized Graph with smarter routing
const graph = new StateGraph(State)
  .addNode("intentDetector", async (state) => {
    const { messages, userProfile } = state;
    const lastMessage = messages[messages.length - 1];

    let toolUsage = [];
    const intentUser = await findRelevantTools(lastMessage.content);
    console.log("RESULT INTENT USER : ", intentUser);

    const searchIntent = intentUser?.filter(
      (intent) => intent.name === "requestProductRecommendation"
    );
    const greetingIntent = intentUser?.filter(
      (intent) => intent.name === "startConversation"
    );

    let stage = "greeting";
    if (greetingIntent?.length > 0) {
      stage = "greeting";
    } else if (
      searchIntent?.length > 0 ||
      toolUsage[0]?.name === "searchShoes"
    ) {
      stage = "search";
    }

    if (stage === "search") {
      toolUsage.push(toolsByName.searchShoes);
    }
    const instruction = instructionGen.generate(
      stage,
      userProfile?.assistan_username,
      messages
    );

    console.log("INSTRUKSI : ", instruction);
    console.log("STAGE : ", stage);

    // Ultra-minimal router prompt
    const routerPrompt = ChatPromptTemplate.fromMessages([
      ["system", instruction],
      new MessagesPlaceholder("messages"),
    ]);

    const routerMessages = await routerPrompt.formatMessages({
      messages,
      link: "",
    });
    let model = routerModel;
    if (toolUsage.length > 0) {
      model = model.bindTools(toolUsage);
    }
    const response = await model.invoke(routerMessages);

    console.log("ROUTER:", response.usage_metadata, response.tool_calls);
    return { messages: [response] };
  })

  .addNode("responseGenerator", async (state) => {
    const { messages, userProfile } = state;

    // Generate ultra-compact instruction
    const stage = "recommend";
    const instruction = instructionGen.generate(
      stage,
      userProfile?.assistan_username,
      messages
    );

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", instruction],
      new MessagesPlaceholder("messages"),
    ]);

    const formattedPrompt = await prompt.formatMessages({
      messages,
      link: "",
    });

    const response = await mainModel.invoke(formattedPrompt);

    console.log("AI:", response.usage_metadata);
    return { messages: [response] };
  })
  .addNode("tools", toolNode)
  .addEdge("__start__", "intentDetector")
  .addConditionalEdges("intentDetector", (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length > 0 ? "tools" : END;
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
  const fallbackResponse = generateFallback(
    assistan_username,
    customer_username
  );

  try {
    const threadId = message?.chatRoomId;
    const userQuestion = message.latestMessage?.textMessage || "";

    if (!threadId) {
      console.error("Missing chat room ID");
      await sendFallbackResponse(fallbackResponse);
      return fallbackResponse;
    }

    const startTime = Date.now();
    const timeout = 60000; // Fixed timeout

    const agentPromise = agentApp.invoke(
      {
        messages: [new HumanMessage(userQuestion)],
        userProfile: { assistan_username, customer_username },
      },
      { configurable: { thread_id: threadId } }
    );

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeout);
    });

    const finalState = await Promise.race([agentPromise, timeoutPromise]);
    const responseMessage = finalState.messages[finalState.messages.length - 1];
    const finalResponse = extractResponseContent(responseMessage);

    const processingTime = Date.now() - startTime;
    console.log(`Processing time: ${processingTime}ms`);

    await sendSuccessResponse(finalResponse || fallbackResponse, finalState);
    return finalResponse;
  } catch (error) {
    const errorResponse = generateFallback(
      assistan_username,
      customer_username
    );
    await sendFallbackResponse(errorResponse);
    console.error("AI error:", error.message);
    return errorResponse;
  }

  function generateFallback(assistantName, customerName) {
    const name = assistantName || "Wawan";
    const customer = customerName ? ` Kak ${customerName}` : " Kakak";
    return `<p style="color:#000;background:transparent;padding:0;">Maaf${customer}, <strong>${name}</strong> sedang ada kendala 😩. Coba lagi ya${customer} 😉.</p>`;
  }

  async function sendSuccessResponse(response, state) {
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

  async function sendFallbackResponse(response) {
    await sendMessageCallback(response, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData: [],
      toolArguments: [],
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
