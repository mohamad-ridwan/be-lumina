const { tool } = require("@langchain/core/tools");
const { searchShoes, extractProductInfo } = require("./function/shoes");
const { rephraseQuery } = require("./function/rephrase-query");
const shoeSchemeTools = require("./scheme/shoes");
const rephraseQueryTools = require("./scheme/rephrase-query");
const { rephraseQueryTool: getRephraseQueryTool } = rephraseQueryTools;
const { searchShoesFuncDeclaration, productInfoTool } = shoeSchemeTools;

const searchShoesTool = tool(searchShoes, searchShoesFuncDeclaration);
const rephraseQueryTool = tool(rephraseQuery, getRephraseQueryTool);
// const extractProductInfoTool = tool(extractProductInfo, productInfoTool);

const langChainTools = [searchShoesTool, rephraseQueryTool];

const toolsByName = {
  searchShoes: searchShoesTool,
  rephraseQuery: rephraseQueryTool,
  // extractProductInfo: extractProductInfoTool,
};

module.exports = { langChainTools, toolsByName };
