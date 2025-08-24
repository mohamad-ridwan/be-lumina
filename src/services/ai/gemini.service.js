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
  conversationalFlowInstruction,
} = require("../../tools/instructions/shoe");
const {
  OptimizedInstructionGenerator,
  ResponseQualityValidator,
} = require("../../tools/classes/dynamic-prompt");

const langChainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 0.7, // Reduced for more consistent responses
  maxRetries: 2, // Reduced retries for faster response
  maxOutputTokens: 1024, // Reduced token limit for cost efficiency
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
      return x.concat(y);
    },
    default: () => [],
  }),
  collectedProductIds: Annotation({
    reducer: (x, y) => new Set([...x, ...y]),
    default: () => new Set(),
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

    // Generate dynamic instruction based on conversation stage
    const instruction = await instructionGenerator.generateInstruction(
      userProfile?.assistan_username,
      userProfile?.customer_username,
      messages,
      userProfile
    );

    console.log("INSTRUCTION :", instruction);

    // Simplified prompt template
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", `${instruction}\n\nCurrent time: {time}`],
      new MessagesPlaceholder("messages"),
    ]);

    const formattedPrompt = await prompt.formatMessages({
      time: new Date().toISOString(),
      link_url_sepatu: "",
      availableCategories: "",
      availableBrands: "",
      availableOffers: "",
      messages: state.messages,
    });

    const response = await modelWithTools.invoke(formattedPrompt);
    console.log("AI Response:", response);

    // Optimize tool calls with memory
    if (response.tool_calls?.length > 0) {
      await optimizeToolCalls(response.tool_calls, messages);
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

    // Smart routing based on conversation stage
    if (lastMessage.tool_calls?.length > 0) {
      return "tools";
    }

    return END;
  })
  .addEdge("tools", "agent");

// Enhanced tool call optimization with memory management
function optimizeToolCalls(toolCalls, messages) {
  const existingProducts = extractExistingProducts(messages);

  for (const toolCall of toolCalls) {
    if (toolCall.name === "searchShoes") {
      // Add conversation memory to tool calls
      if (
        existingProducts.length > 0 &&
        toolCall.args.shoeNames &&
        toolCall.args.shoeNames.length > 0
      ) {
        const requestedNames = toolCall.args.shoeNames.map((name) =>
          name.toLowerCase()
        );
        const memoryData = existingProducts.filter((product) =>
          requestedNames.includes(product.name.toLowerCase())
        );

        if (memoryData.length > 0) {
          toolCall.args.data_memory = memoryData;
          // Remove shoes already in memory from new search to avoid duplicates
          toolCall.args.shoeNames = toolCall.args.shoeNames.filter(
            (name) =>
              !memoryData.some(
                (product) => product.name.toLowerCase() === name.toLowerCase()
              )
          );
        }
      }

      // Add metadata for better tool usage tracking
      toolCall.args._context = {
        conversationStage: "searching",
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

  // Pre-generate contextual fallback response with proper persona
  const fallbackResponse = generatePersonalizedFallback(
    assistan_username,
    customer_username,
    "default"
  );

  try {
    const threadId = message?.chatRoomId;
    const userQuestion = message.latestMessage
      ? message.latestMessage.textMessage
      : "";

    if (!threadId) {
      console.error("Chat room ID is missing");
      await sendFallbackResponse(fallbackResponse);
      return fallbackResponse;
    }

    // Add performance monitoring
    const startTime = Date.now();

    // Optimized timeout with stage-specific durations
    const timeoutDuration = determineTimeout(userQuestion);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeoutDuration);
    });

    const agentPromise = agentApp.invoke(
      {
        messages: [new HumanMessage(userQuestion)],
        userProfile: { assistan_username, customer_username },
      },
      {
        configurable: { thread_id: threadId },
      }
    );

    const finalState = await Promise.race([agentPromise, timeoutPromise]);

    // Validate response quality
    const validator = new ResponseQualityValidator();
    const responseMessage = finalState.messages[finalState.messages.length - 1];
    const extractedContent = extractResponseContent(responseMessage);

    const validation = validator.validateResponse(
      extractedContent,
      finalState.conversationStage || "default",
      { assistantName: assistan_username }
    );

    // Log performance metrics
    const processingTime = Date.now() - startTime;
    console.log(
      `AI Response - Time: ${processingTime}ms, Quality: ${validation.score}%, Stage: ${finalState.conversationStage}`
    );

    let finalResponse = extractedContent;

    // Handle low quality responses
    if (!validation.isValid && validation.score < 60) {
      console.warn("Low quality response detected:", validation.issues);
      finalResponse = generatePersonalizedFallback(
        assistan_username,
        customer_username,
        "quality_issue"
      );
    }

    await sendSuccessResponse(finalResponse || fallbackResponse, finalState);
    return finalResponse;
  } catch (error) {
    const errorType = categorizeError(error);
    const errorResponse = generatePersonalizedFallback(
      assistan_username,
      customer_username,
      errorType
    );

    await sendFallbackResponse(errorResponse);
    console.error(`AI processing error [${errorType}]:`, error.message);
    return errorResponse;
  }

  // Helper functions with proper formatting
  function generatePersonalizedFallback(
    assistantName,
    customerName,
    errorType
  ) {
    const name = assistantName || "Wawan";
    const customer = customerName ? ` Kak ${customerName}` : " Kakak";

    const responses = {
      default: `<p style="color: #000; background: transparent; padding: 0;">Maaf${customer}, <strong>${name}</strong> sedang mengalami kendala 😩. Silakan coba lagi ya${customer} 😉.</p>`,

      timeout: `<p style="color: #000; background: transparent; padding: 0;">Wah${customer}, <strong>${name}</strong> butuh waktu lebih lama nih buat cariin yang pas. Coba tanya yang lebih spesifik ya${customer} 😊.</p>`,

      rate_limit: `<p style="color: #000; background: transparent; padding: 0;"><strong>${name}</strong> lagi sibuk banget melayani pelanggan lain. Tunggu sebentar ya${customer} 😉.</p>`,

      server_error: `<p style="color: #000; background: transparent; padding: 0;">Mohon maaf${customer}, <strong>${name}</strong> sedang ada gangguan teknis. Mohon tunggu sebentar ya${customer} 🙏.</p>`,

      quality_issue: `<p style="color: #000; background: transparent; padding: 0;">Maaf${customer}, <strong>${name}</strong> agak bingung dengan permintaan ini. Bisa dijelasin lagi kebutuhan sepatunya ya${customer}? 🤔</p>`,
    };

    return responses[errorType] || responses.default;
  }

  function determineTimeout(userQuestion) {
    const question = userQuestion.toLowerCase();

    // Complex queries need more time
    if (question.includes("rekomendasi") || question.includes("cari sepatu")) {
      return 20000; // 20 seconds for search queries
    }

    // Simple clarifications need less time
    if (
      question.includes("ukuran") ||
      question.includes("warna") ||
      question.includes("harga")
    ) {
      return 10000; // 10 seconds for clarifications
    }

    return 15000; // Default 15 seconds
  }

  function categorizeError(error) {
    const errorMessage = error.message?.toLowerCase() || "";

    if (errorMessage.includes("timeout")) return "timeout";
    if (error.statusText && error.statusText.includes("Too Many Requests"))
      return "rate_limit";
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
