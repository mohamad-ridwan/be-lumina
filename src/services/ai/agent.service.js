const { ToolMessage } = require("@langchain/core/messages");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { StateGraph, END } = require("@langchain/langgraph");
const {
  conversationalFlowInstruction,
} = require("../../tools/instructions/shoe");
const { toolsByName, langChainTools } = require("../../tools/langChainTools");
const { langChainModel } = require("./gemini.service");

// Definisikan state
const agentState = {
  input: {
    value: null,
  },
  chat_history: {
    value: (x) => x.chat_history,
    default: () => [],
  },
  agent_scratchpad: {
    value: (x) => x.agent_scratchpad,
    default: () => [],
  },
  // Tambahkan field untuk menyimpan respons agen sementara
  agent_response: {
    value: null,
  },
  output: {
    value: null,
  },
};

// Buat agen yang mengimplementasikan ReAct
const agent = createReactAgent({
  llm: langChainModel,
  tools: langChainTools,
  systemMessage: async (x) => {
    return (await conversationalFlowInstruction()).content;
  },
});

// --- FUNGSI TUNGGAL UNTUK MENGGABUNGKAN LOGIKA AGEN DAN TOOL ---
const agentAndToolsNode = async (state) => {
  // 1. Panggil agen untuk mendapatkan respons
  const agentResponse = await agent.invoke({
    input: state.input,
    chat_history: state.chat_history,
    agent_scratchpad: state.agent_scratchpad,
  });

  // 2. Jika agen memberikan jawaban final, kembalikan output
  if (agentResponse.content) {
    return { output: agentResponse.content };
  }

  // 3. Jika agen ingin memanggil tool, eksekusi tool tersebut
  if (
    Array.isArray(agentResponse.tool_calls) &&
    agentResponse.tool_calls.length > 0
  ) {
    const toolCalls = agentResponse.tool_calls;
    const newScratchpad = [];

    for (const toolCall of toolCalls) {
      const selectedTool = toolsByName[toolCall.name];
      if (selectedTool) {
        const toolOutput = await selectedTool.invoke(toolCall.args);
        newScratchpad.push(
          new ToolMessage({
            content: JSON.stringify(toolOutput),
            tool_call_id: toolCall.id,
            name: toolCall.name,
          })
        );
      }
    }

    // Gabungkan hasil tool baru ke scratchpad yang ada
    const updatedScratchpad = [...state.agent_scratchpad, ...newScratchpad];
    return { agent_scratchpad: updatedScratchpad };
  }

  // Jika tidak ada jawaban atau tool call, ini adalah kasus error
  throw new Error("Agent did not return a content or tool call.");
};

// --- Perbaikan pada StateGraph ---
const workflow = new StateGraph({
  channels: agentState,
});

// Tambahkan satu node tunggal
workflow.addNode("agent_executor", agentAndToolsNode);

// Tambahkan edge yang mengarah dari executor kembali ke dirinya sendiri
workflow.addEdge("agent_executor", "agent_executor");

// Definisikan titik masuk dan keluar
workflow.setEntryPoint("agent_executor");

workflow.addConditionalEdges("agent_executor", (state) =>
  state.output ? END : "agent_executor"
);

// Kompilasi grafik
const agentApp = workflow.compile();

module.exports = { agentApp };
