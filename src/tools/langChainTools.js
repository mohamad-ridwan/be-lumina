const { tool } = require("@langchain/core/tools");
const { searchShoes } = require("./function/shoes");
const { rephraseQuery } = require("./function/rephrase-query");
const shoeSchemeTools = require("./scheme/shoes");
const rephraseQueryTools = require("./scheme/rephrase-query");
const { routeConversationFunc } = require("./function/router");
const { routeConversation } = require("./scheme/router");
const { rephraseQueryTool: getRephraseQueryTool } = rephraseQueryTools;
const { searchShoesFuncDeclaration } = shoeSchemeTools;

const searchShoesTool = tool(searchShoes, searchShoesFuncDeclaration);
const rephraseQueryTool = tool(rephraseQuery, getRephraseQueryTool);
const routeConversationTool = tool(routeConversationFunc, routeConversation);

const langChainTools = [searchShoesTool];
const routerTools = [routeConversationTool];

const toolsByName = {
  searchShoes: searchShoesTool,
};

module.exports = { langChainTools, toolsByName, routerTools };
