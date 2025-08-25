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
const {
  OptimizedInstructionGenerator,
  ResponseQualityValidator,
} = require("../../tools/classes/dynamic-prompt");

const langChainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.7, // Reduced for more consistent responses
  maxRetries: 2, // Reduced retries for faster response
  maxOutputTokens: 512, // Reduced token limit for cost efficiency
  apiKey: process.env.GEMINI_API_KEY,
});

const getGeminiResponse = async (prompt) => {
  try {
    const modelTools = langChainModel.bindTools(langChainTools);
    const messages = prompt;
    const aiMessage = await modelTools.invoke(messages);
    console.log(aiMessage);

    messages.push(aiMessage);

    for (const toolCall of aiMessage.tool_calls) {
      const selectedTool = toolsByName[toolCall.name];
      const toolMessage = await selectedTool.invoke(toolCall);
      messages.push(toolMessage);
    }

    console.log(messages);

    if (aiMessage.tool_calls.length === 0) {
      return aiMessage;
    }

    const response = await modelTools.invoke(messages);
    return response;
  } catch (error) {
    console.error("Error getting response from Gemini:", error);
    throw new Error("Failed to get response from Gemini.");
  }
};

const modelWithTools = langChainModel.bindTools(langChainTools);
const toolNode = new ToolNode(langChainTools);
const instructionGenerator = new OptimizedInstructionGenerator();

// Definisikan tipe state untuk LangGraph
const State = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => {
      const updatedMessages = x.concat(y);
      const limitedMessages = updatedMessages.slice(-5);
      return limitedMessages;
    },
    default: () => [],
  }),
  userProfile: Annotation({
    reducer: (x) => x,
    default: () => {},
  }),
  conversationStage: Annotation({
    reducer: (x, y) => y || x,
    default: () => "greeting",
  }),
});

// Optimized Graph with smarter routing
const graph = new StateGraph(State)
  .addNode("agent", async (state) => {
    const { messages, userProfile } = state;

    const instruction = await instructionGenerator.generateInstruction(
      userProfile?.assistan_username,
      userProfile?.customer_username,
      messages,
      userProfile
    );

    console.log("INSTRUCTION:", instruction);

    // Minimal prompt template
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", instruction],
      new MessagesPlaceholder("messages"),
    ]);

    const formattedPrompt = await prompt.formatMessages({
      messages: state.messages,
      time: new Date().toISOString(),
      link_url_sepatu: "",
      availableCategories: "",
      availableBrands: "",
      availableOffers: "",
    });

    const response = await modelWithTools.invoke(formattedPrompt);

    // Log usage metrics
    console.log("AI usage:", response.usage_metadata);
    console.log("Messages count:", messages.length);

    if (response.tool_calls?.length > 0) {
      optimizeToolCalls(response.tool_calls, messages);
    }

    return {
      messages: [response],
      conversationStage: instructionGenerator.stateManager.determineStage(
        [...messages, response],
        userProfile
      ),
    };
  })
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length > 0 ? "tools" : END;
  })
  .addEdge("tools", "agent");

function optimizeToolCalls(toolCalls, messages) {
  const existingProducts = extractExistingProducts(messages);

  for (const toolCall of toolCalls) {
    if (toolCall.name === "searchShoes") {
      if (existingProducts.length > 0 && toolCall.args.shoeNames?.length > 0) {
        const requestedNames = toolCall.args.shoeNames.map((name) =>
          name.toLowerCase()
        );
        const memoryData = existingProducts.filter((product) =>
          requestedNames.includes(product.name.toLowerCase())
        );

        if (memoryData.length > 0) {
          toolCall.args.data_memory = memoryData;
          toolCall.args.shoeNames = toolCall.args.shoeNames.filter(
            (name) =>
              !memoryData.some(
                (product) => product.name.toLowerCase() === name.toLowerCase()
              )
          );
        }
      }

      toolCall.args._context = {
        stage: "searching",
        timestamp: Date.now(),
        messageCount: messages.length,
      };
    }
  }
  return toolCalls;
}

function extractExistingProducts(messages) {
  // Extract products from recent messages (last 6 messages for efficiency)
  return messages;
}

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
    customer_username,
    "default"
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
    const timeout = determineTimeout(userQuestion);

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

    const validator = new ResponseQualityValidator();
    const responseMessage = finalState.messages[finalState.messages.length - 1];
    const extractedContent = extractResponseContent(responseMessage);

    const validation = validator.validateResponse(
      extractedContent,
      finalState.conversationStage || "default",
      { assistantName: assistan_username }
    );

    const processingTime = Date.now() - startTime;
    console.log(
      `AI Response - Time: ${processingTime}ms, Quality: ${validation.score}%, Stage: ${finalState.conversationStage}`
    );

    let finalResponse = extractedContent;

    if (!validation.isValid && validation.score < 60) {
      console.warn("Low quality response:", validation.issues);
      finalResponse = generateFallback(
        assistan_username,
        customer_username,
        "quality_issue"
      );
    }

    await sendSuccessResponse(finalResponse || fallbackResponse, finalState);
    return finalResponse;
  } catch (error) {
    const errorType = categorizeError(error);
    const errorResponse = generateFallback(
      assistan_username,
      customer_username,
      errorType
    );

    await sendFallbackResponse(errorResponse);
    console.error(`AI error [${errorType}]:`, error.message);
    return errorResponse;
  }

  function generateFallback(assistantName, customerName, errorType) {
    const name = assistantName || "Wawan";
    const customer = customerName ? ` Kak ${customerName}` : " Kakak";

    const responses = {
      default: `<p style="color:#000;background:transparent;padding:0;">Maaf${customer}, <strong>${name}</strong> sedang ada kendala 😩. Coba lagi ya${customer} 😉.</p>`,
      timeout: `<p style="color:#000;background:transparent;padding:0;">Wah${customer}, <strong>${name}</strong> butuh waktu lebih lama. Coba tanya lebih spesifik ya${customer} 😊.</p>`,
      rate_limit: `<p style="color:#000;background:transparent;padding:0;"><strong>${name}</strong> lagi sibuk melayani. Tunggu sebentar ya${customer} 😉.</p>`,
      server_error: `<p style="color:#000;background:transparent;padding:0;">Maaf${customer}, <strong>${name}</strong> ada gangguan teknis. Tunggu ya${customer} 🙏.</p>`,
      quality_issue: `<p style="color:#000;background:transparent;padding:0;">Maaf${customer}, <strong>${name}</strong> bingung. Jelaskan kebutuhan sepatunya lagi ya${customer}? 🤔</p>`,
    };

    return responses[errorType] || responses.default;
  }

  function determineTimeout(userQuestion) {
    const question = userQuestion.toLowerCase();

    if (question.includes("rekomendasi") || question.includes("cari sepatu")) {
      return 20000;
    }

    if (
      question.includes("ukuran") ||
      question.includes("warna") ||
      question.includes("harga")
    ) {
      return 10000;
    }

    return 15000;
  }

  function categorizeError(error) {
    const errorMessage = error.message?.toLowerCase() || "";

    if (errorMessage.includes("timeout")) return "timeout";
    if (error.statusText?.includes("Too Many Requests")) return "rate_limit";
    if (error.status === 500) return "server_error";

    return "default";
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
  getGeminiResponse,
  langChainModel,
  processNewMessageWithAI,
  graph,
};
