const { tool } = require("@langchain/core/tools");
const { searchShoes } = require("./function/shoes");
const shoeSchemeTools = require("./scheme/shoes");
const { searchShoesFuncDeclaration } = shoeSchemeTools;

const searchShoesTool = tool(searchShoes, searchShoesFuncDeclaration);

const langChainTools = [searchShoesTool];

const toolsByName = {
  searchShoes: searchShoesTool,
};

module.exports = { langChainTools, toolsByName };
