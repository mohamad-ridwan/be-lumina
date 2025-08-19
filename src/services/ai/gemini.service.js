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
  model: "gemini-2.5-flash",
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
  formattedHistory, // Fixed typo: formattedHisory -> formattedHistory
  message,
  sendMessageCallback,
  { io, socket, client, agenda }
) => {
  const latestMessageTimestamp = Date.now();
  const messageId = generateRandomId(15);
  const userQuestions = message.latestMessage.textMessage;
  let productData = [];

  try {
    // Get chat history
    const getHistoryMessages = new MongooseChatHistory(messageId, message);
    const history = await getHistoryMessages.getMessages();

    // Build the conversation context
    let conversationContext = "";
    if (history && history.length > 0) {
      conversationContext =
        history
          .map((msg) => {
            if (typeof msg === "string") return `Human: ${msg}`;
            if (msg.content) {
              const role =
                msg.constructor.name.includes("Human") ||
                msg.type === "human" ||
                msg.role === "user"
                  ? "Human"
                  : "Assistant";
              return `${role}: ${msg.content}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n") + "\n";
    }

    // Manual ReAct implementation with multiple tool call capability
    const systemMessage = await conversationalFlowInstruction();
    const systemPrompt =
      typeof systemMessage === "string" ? systemMessage : systemMessage.content;

    let finalAnswer = "";
    let maxIterations = 2;
    let iteration = 0;
    let shouldContinue = true;
    let allToolResults = []; // Track all tool results across iterations
    let conversationHistory = ""; // Build conversation history with tool results

    while (shouldContinue && iteration < maxIterations) {
      iteration++;
      console.log(`ReAct iteration ${iteration}`);

      // Build the current context with previous tool results
      let currentContext = `${systemPrompt}

${conversationContext}Human: ${userQuestions}`;

      if (allToolResults.length > 0) {
        const previousToolResults = allToolResults
          .map(
            (tr, index) =>
              `Tool Call ${index + 1} - ${tr.tool}: ${
                typeof tr.result === "string"
                  ? tr.result
                  : JSON.stringify(tr.result)
              }`
          )
          .join("\n\n");

        currentContext += `\n\nPrevious tool results:\n${previousToolResults}`;
        currentContext += `\n\nBased on the above results, you can either:
1. Call another tool with different parameters if the results are empty or insufficient
2. Provide your final answer if you have enough information

What would you like to do next?`;
      } else {
        currentContext += `\n\nIf you need to search for information, please use the available tools. If the first search doesn't return results, try with different parameters or alternative approaches.`;
      }

      try {
        // Get model response with tools
        const modelWithTools = langChainModel.bindTools(langChainTools);
        const messages = [new HumanMessage(currentContext)];
        const aiMessage = await modelWithTools.invoke(messages);

        // If there are tool calls, execute them
        if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
          let currentIterationResults = [];

          for (const toolCall of aiMessage.tool_calls) {
            const selectedTool = toolsByName[toolCall.name];

            if (selectedTool) {
              try {
                const toolResult = await selectedTool.invoke(
                  toolCall.args || toolCall
                );

                const resultObj = {
                  tool: toolCall.name,
                  args: toolCall.args,
                  result: toolResult,
                  iteration: iteration,
                };

                currentIterationResults.push(resultObj);
                allToolResults.push(resultObj);

                // Save product data if it's a shoe search and has results
                if (
                  toolCall.name === "searchShoes" &&
                  toolResult.shoes &&
                  toolResult.shoes.length > 0
                ) {
                  productData = [...productData, ...toolResult.shoes]; // Accumulate results
                }
              } catch (toolError) {
                console.error(
                  `Error executing tool ${toolCall.name}:`,
                  toolError
                );
                const errorResult = {
                  tool: toolCall.name,
                  args: toolCall.args,
                  result: `Error: ${toolError.message}`,
                  iteration: iteration,
                };
                currentIterationResults.push(errorResult);
                allToolResults.push(errorResult);
              }
            }
          }

          // Check if we should continue or provide final answer
          const hasEmptyResults = currentIterationResults.some(
            (r) =>
              r.tool === "searchShoes" &&
              (r.result.shoes?.length === 0 || r.result.error)
          );

          // If we have empty results and haven't reached max iterations, continue
          if (hasEmptyResults && iteration < maxIterations) {
            console.log(
              `Iteration ${iteration}: Got empty results, continuing to next iteration...`
            );
            shouldContinue = true;
            // Continue to next iteration to let model try different approach
          } else {
            // Either we have results or we've reached max iterations, time for final answer
            shouldContinue = false;

            const allToolResultsText = allToolResults
              .map(
                (tr, index) =>
                  `Tool Call ${index + 1} (Iteration ${tr.iteration}) - ${
                    tr.tool
                  }:\nArgs: ${JSON.stringify(tr.args)}\nResult: ${
                    typeof tr.result === "string"
                      ? tr.result
                      : JSON.stringify(tr.result)
                  }`
              )
              .join("\n\n---\n\n");

            const finalPrompt = `${systemPrompt}

${conversationContext}Human: ${userQuestions}

All tool executions completed:
${allToolResultsText}

Based on all the tool results above, please provide your final comprehensive answer to the user. If no products were found despite multiple searches, suggest alternatives or ask for different criteria.`;

            const finalResponse = await langChainModel.invoke([
              new HumanMessage(finalPrompt),
            ]);
            finalAnswer = finalResponse.content;
          }
        } else {
          // No tool calls, this is the final answer
          finalAnswer =
            aiMessage.content || "Maaf, tidak ada respons yang dihasilkan.";
          shouldContinue = false;

          console.log("No tool calls, ai content:", aiMessage.content);
        }
      } catch (iterationError) {
        console.error(`Error in iteration ${iteration}:`, iterationError);
        if (iteration === maxIterations) {
          throw iterationError;
        }
        // Continue to next iteration
      }
    }

    if (!finalAnswer) {
      finalAnswer = "Maaf, saya tidak bisa memproses pertanyaan Anda saat ini.";
    }

    await sendMessageCallback(finalAnswer, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData,
      orderData: {},
    });

    return finalAnswer;
  } catch (error) {
    console.error("Detailed error in processNewMessageWithAI:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    const errorMessage =
      "Maaf, kami tidak tersedia saat ini. Silakan coba lagi.";

    await sendMessageCallback(errorMessage, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId: messageId,
      productData: [],
      orderData: {},
    });

    throw new Error(`Failed to process new message with AI: ${error.message}`);
  }
};

// const processNewMessageWithAI = async (
//   formattedHisory,
//   message,
//   sendMessageCallback,
//   { io, socket, client, agenda }
// ) => {
//   const latestMessageTimestamp = Date.now();
//   const messageId = generateRandomId(15);
//   let orderForFrontendData = [];
//   let typeOrder = "";
//   const userQuestions = message.latestMessage.textMessage;
//   const collectedProductIds = new Set();
//   let productData = [];
//   let functionCallForHistory = [];
//   let functionResponseForHistory = [];

//   try {
//     const modelTools = langChainModel.bindTools(langChainTools);
//     const instruction = await conversationalFlowInstruction();

//     const prompt = ChatPromptTemplate.fromMessages([
//       instruction,
//       new MessagesPlaceholder("chat_history"),
//       ["human", "{input}"],
//       new MessagesPlaceholder("agent_scratchpad"),
//     ]);

//     // Runnable yang mengelola history
//     const runnableWithHistory = new RunnableWithMessageHistory({
//       runnable: prompt.pipe(modelTools),
//       getMessageHistory: (sessionId) =>
//         new MongooseChatHistory(sessionId, message),
//       inputMessagesKey: "input",
//       historyMessagesKey: "chat_history",
//     });

//     // Rantai utama yang akan dipanggil
//     const mainChain = RunnableSequence.from([
//       RunnablePassthrough.assign({
//         agent_scratchpad: () => [],
//       }),
//       runnableWithHistory,
//     ]);

//     // Panggil chain pertama kali
//     const firstResponse = await mainChain.invoke(
//       { input: userQuestions },
//       { configurable: { sessionId: messageId } }
//     );

//     // Periksa apakah model meminta tool call
//     if (firstResponse.tool_calls && firstResponse.tool_calls.length > 0) {
//       let toolCallResults = [];
//       for (const toolCall of firstResponse.tool_calls) {
//         const functionName = toolCall.name;
//         const functionArgs = { ...toolCall.args };
//         const selectedTool = toolsByName[toolCall.name];

//         if (functionName === "searchShoes") {
//           functionArgs.excludeIds = Array.from(collectedProductIds);
//         }
//         // Pastikan tool.invoke() menerima argumen yang benar
//         const toolMessage = await selectedTool.invoke(functionArgs);
//         toolCallResults.push(toolMessage.content);

//         if (functionName === "searchShoes" && toolMessage.shoes.length > 0) {
//           toolMessage.shoes.forEach((product) => {
//             const id = product._id?.toString();
//             if (id && !collectedProductIds.has(id)) {
//               productData.push(product);
//               collectedProductIds.add(id); // Tambahkan ID ke set global
//             }
//           });
//         }
//       }

//       const currentChatHistory = await new MongooseChatHistory(
//         messageId,
//         message
//       ).getMessages();

//       const toolCallMessage = new AIMessage({
//         content: firstResponse.content, // Gunakan content sebagai string
//         tool_calls: firstResponse.tool_calls,
//       });

//       const toolResultMessages = toolCallResults.map(
//         (result) =>
//           new ToolMessage({
//             content: result,
//             name: "searchShoes", // Nama tool harus sesuai
//             tool_call_id: firstResponse.tool_calls[0].id, // Penting untuk mengaitkan respons dengan tool call
//           })
//       );

//       const agentScratchpadMessages = [toolCallMessage, ...toolResultMessages];

//       const finalAnswerResponse = await prompt.pipe(langChainModel).invoke({
//         input: userQuestions,
//         chat_history: currentChatHistory,
//         agent_scratchpad: agentScratchpadMessages,
//       });

//       // Kirim jawaban akhir ke pengguna
//       await sendMessageCallback(
//         finalAnswerResponse.content,
//         message,
//         latestMessageTimestamp,
//         {
//           io,
//           socket,
//           client,
//           agenda,
//           newMessageId: messageId,
//           productData, // Kirimkan hasil tools ke frontend
//           orderData: {
//             loading: false,
//             type: typeOrder,
//             orders: orderForFrontendData,
//             isConfirmed: false,
//           },
//         },
//         functionCallForHistory,
//         functionResponseForHistory
//       );
//       return finalAnswerResponse.content;
//     } else {
//       // Jika tidak ada tool call, kirim respons awal langsung
//       await sendMessageCallback(
//         firstResponse.content,
//         message,
//         latestMessageTimestamp,
//         {
//           io,
//           socket,
//           client,
//           agenda,
//           newMessageId: messageId,
//           productData,
//           orderData: {},
//         },
//         functionCallForHistory,
//         functionResponseForHistory
//       );
//       return firstResponse.content;
//     }
//   } catch (error) {
//     await sendMessageCallback(
//       "Maaf, kami tidak tersedia saat ini. Silakan coba lagi.",
//       message,
//       latestMessageTimestamp,
//       {
//         io,
//         socket,
//         client,
//         agenda,
//         newMessageId: messageId,
//         productData,
//         orderData: {},
//       }
//     );
//     console.log(
//       "Internal Server Error when process new message with AI : ",
//       error
//     );
//     throw new Error("Failed process new message with AI : ", error);
//   }
// };

module.exports = { getGeminiResponse, langChainModel, processNewMessageWithAI };
