import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

const isElement = (node: ESTree.JSXChild) =>
  node.type === "JSXElement" || node.type === "JSXFragment";
const holds = (node: ESTree.JSXChild, ...types: string[]) =>
  node.type === "JSXExpressionContainer" && types.includes(node.expression.type);
const isConditional = (node: ESTree.JSXChild) =>
  holds(node, "ConditionalExpression", "LogicalExpression");
const isComment = (node: ESTree.JSXChild) => holds(node, "JSXEmptyExpression");
// What Oxfmt counts as text: `{" "}`, or anything more than the indentation of a new line.
const isText = (node: ESTree.JSXChild) =>
  node.type === "JSXText"
    ? /[^ \n\r\t]/.test(node.value) || !node.value.includes("\n")
    : node.type === "JSXExpressionContainer" &&
      node.expression.type === "Literal" &&
      node.expression.value === " ";

/**
 * Requires a blank line after a closing tag and around a conditional.
 *
 * Stylistic's jsx-newline does too, but it rejects inline text like `Hi {name}, you have {count}`,
 * which it can't fix, and it fights Oxfmt, which removes blank lines between the children of an
 * element that holds text. This rule skips those elements.
 */
export const jsxBlankLines = defineRule({
  meta: {
    fixable: "whitespace",
    messages: { expected: "Expected a blank line between these JSX siblings." },
  },
  create(context) {
    function check({ children }: ESTree.JSXElement | ESTree.JSXFragment) {
      if (children.some(isText)) {
        return;
      }

      children.forEach((separator, index) => {
        const previous = children[index - 1];
        const next = children[index + 1];

        // Without text, a separator is only line breaks, and two of them are already a blank line.
        if (
          !previous ||
          !next ||
          separator.type !== "JSXText" ||
          separator.value.split("\n").length > 2
        ) {
          return;
        }

        if (
          isElement(previous) ||
          isConditional(previous) ||
          (isConditional(next) && !isComment(previous))
        ) {
          context.report({
            node: next,
            messageId: "expected",
            fix: (fixer) => fixer.insertTextAfter(previous, "\n"),
          });
        }
      });
    }

    return { JSXElement: check, JSXFragment: check };
  },
});

export default definePlugin({
  meta: { name: "style" },
  rules: { "jsx-blank-lines": jsxBlankLines },
});
