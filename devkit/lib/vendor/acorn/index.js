import {
  parse as acornParse,
  tokenizer as acornTokenizer,
} from "./src/index.js";

function normalizeSyntaxError(error) {
  if (
    error &&
    error.name === "SyntaxError" &&
    error.loc &&
    typeof error.lineNumber !== "number" &&
    typeof error.loc.line === "number" &&
    typeof error.loc.column === "number"
  ) {
    error.lineNumber = error.loc.line;
    error.column = error.loc.column;
  }

  return error;
}

export function parse(sourceText, options) {
  try {
    return acornParse(sourceText, options);
  } catch (error) {
    throw normalizeSyntaxError(error);
  }
}

export function tokenizer(sourceText, options) {
  return acornTokenizer(sourceText, options);
}
