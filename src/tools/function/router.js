const routeConversationFunc = async ({ tool_name, description }) => {
  return {
    content: JSON.stringify({ decision: tool_name, reason: description }),
  };
};

module.exports = {
  routeConversationFunc,
};
