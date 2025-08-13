const { tool } = require("@langchain/core/tools");
const { searchShoes, extractProductInfo } = require("./function/shoes");
const shoeSchemeTools = require("./scheme/shoes");
const { searchShoesFuncDeclaration, productInfoTool } = shoeSchemeTools;

const searchShoesTool = tool(searchShoes, searchShoesFuncDeclaration);
const extractProductInfoTool = tool(extractProductInfo, productInfoTool);

const langChainTools = [searchShoesTool, extractProductInfoTool];

const toolsByName = {
  searchShoes: searchShoesTool,
  extractProductInfo: extractProductInfoTool,
};

module.exports = { langChainTools, toolsByName };
