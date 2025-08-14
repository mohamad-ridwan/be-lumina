const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { AIMessage, ToolMessage } = require("@langchain/core/messages");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnableWithMessageHistory,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { langChainTools, toolsByName } = require("../../tools/langChainTools");
const { generateRandomId } = require("../../helpers/generateRandomId");
const { MongooseChatHistory } = require("../../tools/classes/chat-history");
const {
  conversationalFlowInstruction,
} = require("../../tools/instructions/shoe");

const langChainModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0,
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

const processNewMessageWithAI = async (
  formattedHisory,
  message,
  sendMessageCallback,
  { io, socket, client, agenda }
) => {
  const latestMessageTimestamp = Date.now();
  const messageId = generateRandomId(15);
  let orderForFrontendData = [];
  let typeOrder = "";
  const userQuestions = message.latestMessage.textMessage;

  let functionCallForHistory = [];
  let functionResponseForHistory = [];

  try {
    const modelTools = langChainModel.bindTools(langChainTools);
    const instruction = await conversationalFlowInstruction();

    const prompt = ChatPromptTemplate.fromMessages([
      instruction,
      new MessagesPlaceholder("chat_history"),
      ["human", "{input}"],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);

    // Runnable yang mengelola history
    const runnableWithHistory = new RunnableWithMessageHistory({
      runnable: prompt.pipe(modelTools),
      getMessageHistory: (sessionId) =>
        new MongooseChatHistory(sessionId, message),
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
    });

    // Rantai utama yang akan dipanggil
    const mainChain = RunnableSequence.from([
      RunnablePassthrough.assign({
        agent_scratchpad: () => [],
      }),
      runnableWithHistory,
    ]);

    // Panggil chain pertama kali
    const firstResponse = await mainChain.invoke(
      { input: userQuestions },
      { configurable: { sessionId: messageId } }
    );

    // Periksa apakah model meminta tool call
    if (firstResponse.tool_calls && firstResponse.tool_calls.length > 0) {
      let toolCallResults = [];
      for (const toolCall of firstResponse.tool_calls) {
        const selectedTool = toolsByName[toolCall.name];
        // Pastikan tool.invoke() menerima argumen yang benar
        const toolMessage = await selectedTool.invoke(toolCall.args);
        toolCallResults.push(toolMessage);
      }

      const currentChatHistory = await new MongooseChatHistory(
        messageId,
        message
      ).getMessages();

      const toolCallMessage = new AIMessage({
        content: firstResponse.content, // Gunakan content sebagai string
        tool_calls: firstResponse.tool_calls,
      });

      const toolResultMessages = toolCallResults.map(
        (result) =>
          new ToolMessage({
            content: JSON.stringify(result),
            name: "searchShoes", // Nama tool harus sesuai
            tool_call_id: firstResponse.tool_calls[0].id, // Penting untuk mengaitkan respons dengan tool call
          })
      );

      const agentScratchpadMessages = [toolCallMessage, ...toolResultMessages];

      const finalAnswerResponse = await prompt.pipe(langChainModel).invoke({
        input: userQuestions,
        chat_history: currentChatHistory,
        agent_scratchpad: agentScratchpadMessages,
      });

      // Kirim jawaban akhir ke pengguna
      await sendMessageCallback(
        finalAnswerResponse.content,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId: messageId,
          productData: [], // Kirimkan hasil tools ke frontend
          orderData: {
            loading: false,
            type: typeOrder,
            orders: orderForFrontendData,
            isConfirmed: false,
          },
        },
        functionCallForHistory,
        functionResponseForHistory
      );
      return finalAnswerResponse.content;
    } else {
      // Jika tidak ada tool call, kirim respons awal langsung
      await sendMessageCallback(
        firstResponse.content,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId: messageId,
          productData: [],
          orderData: {},
        },
        functionCallForHistory,
        functionResponseForHistory
      );
      return firstResponse.content;
    }
  } catch (error) {
    await sendMessageCallback(
      "Maaf, kami tidak tersedia saat ini. Silakan coba lagi.",
      message,
      latestMessageTimestamp,
      {
        io,
        socket,
        client,
        agenda,
        newMessageId: messageId,
        productData: [],
        orderData: {},
      }
    );
    console.log(
      "Internal Server Error when process new message with AI : ",
      error
    );
    throw new Error("Failed process new message with AI : ", error);
  }
};

module.exports = { getGeminiResponse, langChainModel, processNewMessageWithAI };
