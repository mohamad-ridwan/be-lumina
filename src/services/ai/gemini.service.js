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

const langChainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  temperature: 1,
  maxRetries: 4,
  maxOutputTokens: 1024,
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

// Definisikan tipe state untuk LangGraph
const State = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
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
});

// Buat Graph
const graph = new StateGraph(State)
  .addNode("agent", async (state) => {
    const {
      messages,
      searchAttempts,
      userProfile,
      searchAttemptsLimit,
      isFailedQuery,
    } = state;

    // Ambil instruksi percakapan
    const instruction = await conversationalFlowInstruction(
      userProfile?.assitan_username,
      userProfile?.customer_username,
      searchAttempts,
      searchAttemptsLimit,
      isFailedQuery
    );

    // Kumpulkan semua data produk yang ada dari seluruh riwayat pesan AI
    const allExistingProducts = messages
      ?.filter((msg) => msg.additional_kwargs?.product_data?.length > 0)
      ?.flatMap((msg) => msg.additional_kwargs.product_data);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a helpful AI assistant, collaborating with other assistants. Use the provided tools to progress towards answering the question. If you are unable to fully answer, that's OK, another assistant with different tools will help where you left off. Execute what you can to make progress. If you or any of the other assistants have the final answer or deliverable, prefix your response with FINAL ANSWER so the team knows to stop. You have access to the following tools: {tool_names}.\n{system_message}\nCurrent time: {time}.`,
      ],
      new MessagesPlaceholder("messages"),
    ]);
    const formattedPrompt = await prompt.formatMessages({
      system_message: instruction,
      time: new Date().toISOString(),
      tool_names: langChainTools.map((tool) => tool.name).join(", "),
      messages: state.messages,
    });

    // const fullMessages = [new SystemMessage(instruction), ...messages];

    // Panggil model dengan tools
    const response = await modelWithTools.invoke(formattedPrompt);

    // Lakukan modifikasi pada tool_calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        if (
          toolCall.name === "searchShoes" &&
          toolCall.args.shoeNames &&
          toolCall.args.shoeNames.length > 0
        ) {
          const requestedShoeNames = toolCall.args.shoeNames.map((name) =>
            name.toLowerCase()
          );
          let data_memory = [];
          requestedShoeNames.forEach((name) => {
            const existingShoe = allExistingProducts.find(
              (shoe) => name === shoe.name.toLowerCase()
            );
            if (existingShoe) {
              data_memory.push(existingShoe);
            }
          });

          if (data_memory.length > 0) {
            // Jika sepatu ditemukan, tambahkan data mentah ke dalam field baru
            toolCall.args.data_memory = data_memory;
          }
        }
        // Tool lainnya tidak dimodifikasi
      }
    }

    console.log(
      "Call Agent : ",
      searchAttempts,
      searchAttemptsLimit,
      isFailedQuery,
      response.tool_calls,
      userProfile,
      messages
    );

    // Mengembalikan AIMessage dari LLM yang sudah dimodifikasi
    if (response.tool_calls && response.tool_calls.length > 0) {
      return {
        messages: [response],
        // searchAttempts: searchAttempts + 1,
      };
    } else {
      return { messages: [response] };
    }
  })
  .addNode("tools", toolNode)

  // Hubungkan node
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", (state) => {
    const { messages, searchAttempts, searchAttemptsLimit } = state;
    const lastMessage = messages[messages.length - 1];
    console.log("state:", searchAttempts, lastMessage.tool_calls);

    // Aturan 2: Lanjutkan jika ada tool_calls
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "tools";
    }

    // Aturan 3: Jika tidak ada tool_calls, akhiri
    return END;
  })
  .addEdge("tools", "agent");

// Kompilasi graph menjadi sebuah runnable

const processNewMessageWithAI = async (
  formattedHisory,
  message,
  sendMessageCallback,
  { io, socket, client, agenda, assitan_username, customer_username, agentApp }
) => {
  const latestMessageTimestamp = Date.now();
  const messageId = generateRandomId(15);
  let finalResponse = `Maaf, ${
    assitan_username || "Kami"
  } sedang mengalami kendala 😩. Silakan coba lagi ya Kak${
    ` ${customer_username} 😉.` || "😉."
  }`;

  try {
    const threadId = message?.chatRoomId;
    const userQuestions = message.latestMessage.textMessage;

    if (!threadId) {
      console.error("Chat room ID is missing, cannot process message with AI.");
      return;
    }

    const finalState = await agentApp.invoke(
      {
        messages: [new HumanMessage(userQuestions)],
        userProfile: {
          assitan_username,
          customer_username,
        },
      },
      {
        configurable: {
          thread_id: threadId,
        },
      }
    );

    const responseMessage = finalState.messages[finalState.messages.length - 1];
    if (Array.isArray(responseMessage.content)) {
      console.log("Response Message is Array : ", responseMessage.content);
      finalResponse =
        responseMessage.content.find((msg) => msg.type === "text")?.text ||
        `Maaf, ${
          assitan_username || "Kami"
        } sedang mengalami kendala 😩. Silakan coba lagi ya Kak${
          ` ${customer_username} 😉.` || "😉."
        }`;
    } else {
      finalResponse = responseMessage.content;
    }

    // Kirim jawaban akhir ke pengguna
    await sendMessageCallback(finalResponse, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData: finalState?.productData || [],
      toolArguments: finalState?.tool_arguments || [],
      orderData: {},
    });
    return finalResponse;
  } catch (error) {
    let errorMessage;
    const assistantName = assitan_username || "Kami";
    const customerName = customer_username ? ` Kak ${customer_username}` : "";

    // Periksa jenis error dan sesuaikan pesan
    if (error?.statusText?.includes("Too Many Requests")) {
      errorMessage = `Mohon maaf, ${assistantName} sedang sibuk melayani banyak pelanggan. Silakan coba lagi sebentar lagi ya${customerName} 😉.`;
    } else if (error?.status === 500) {
      errorMessage = `Mohon maaf, ${assistantName} sedang mengalami kendala teknis. Mohon tunggu sebentar ya${customerName} 🙏.`;
    } else {
      // Pesan default untuk error lainnya
      errorMessage = `Maaf, ${assistantName} sedang tidak bisa dihubungi saat ini. Silakan coba lagi ya${customerName} 😉.`;
    }

    await sendMessageCallback(errorMessage, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData: [],
      toolArguments: [],
      orderData: {},
    });
    console.error(
      "Internal Server Error when process new message with AI:",
      error
    );
    return errorMessage; // Kembalikan pesan error untuk ditampilkan
  }
};

module.exports = {
  getGeminiResponse,
  langChainModel,
  processNewMessageWithAI,
  graph,
};
