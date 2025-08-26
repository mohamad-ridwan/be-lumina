const { tool } = require("@langchain/core/tools");
const { searchShoes, extractProductInfo } = require("./function/shoes");
const { rephraseQuery } = require("./function/rephrase-query");
const shoeSchemeTools = require("./scheme/shoes");
const rephraseQueryTools = require("./scheme/rephrase-query");
const {
  routeConversationFunc,
  clarificationFunc,
  endConversationFunc,
} = require("./function/router");
const {
  routeConversation,
  clarificationTool,
  endConversationTool,
} = require("./scheme/router");
const { rephraseQueryTool: getRephraseQueryTool } = rephraseQueryTools;
const { searchShoesFuncDeclaration } = shoeSchemeTools;

const searchShoesTool = tool(searchShoes, searchShoesFuncDeclaration);
const rephraseQueryTool = tool(rephraseQuery, getRephraseQueryTool);
const routeConversationTool = tool(routeConversationFunc, routeConversation);
const clarificationTools = tool(clarificationFunc, clarificationTool);
const endConversationTools = tool(endConversationFunc, endConversationTool);
// const extractProductInfoTool = tool(extractProductInfo, productInfoTool);

const langChainTools = [searchShoesTool, rephraseQueryTool];
const routerTools = [routeConversationTool];

const toolsByName = {
  searchShoes: searchShoesTool,
  rephraseQuery: rephraseQueryTool,
  routeConversation: routeConversationTool,
  clarification: clarificationTools,
  endConversation: endConversationTools,
  // extractProductInfo: extractProductInfoTool,
};

module.exports = { langChainTools, toolsByName, routerTools };
