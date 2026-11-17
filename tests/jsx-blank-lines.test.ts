import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";
import { jsxBlankLines } from "../lint/jsx-blank-lines";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});
const invalid = (code: string, output: string, errors = 1) => ({ code, output, errors });

tester.run("jsx-blank-lines", jsxBlankLines, {
  valid: [
    "<div>\n  <p />\n\n  <p />\n</div>",
    "<div>\n  <p />\n\n  {show && <p />}\n\n  <p />\n</div>",
    // Elements that hold text, where Oxfmt removes blank lines.
    "<p>Hi {name}, you have {count} items</p>",
    "<p>\n  <b>bold</b>\n  text\n</p>",
    "<p>\n  word\n  <a />\n  <b />\n</p>",
    "<p>\n  <i /> <i />\n  <a />\n  <b />\n</p>",
    '<p>\n  <i />{" "}\n  <a />\n  <b />\n</p>',
    "<p>\n  &nbsp;\n  <a />\n  <b />\n</p>",
    // Plain values are neither closing tags nor conditionals.
    "<p>\n  {name}\n  {count}\n</p>",
    // A comment stays attached to what it describes.
    "<div>\n  {/* Why */}\n  <p />\n</div>",
    "<div>\n  <p />\n\n  {/* Why */}\n  {show && <p />}\n</div>",
    // An only child has no sibling.
    "<div>\n  <p />\n</div>",
  ],
  invalid: [
    invalid("<div>\n  <p />\n  <p />\n</div>", "<div>\n  <p />\n\n  <p />\n</div>"),
    invalid("<div>\n  <p></p>\n  {name}\n</div>", "<div>\n  <p></p>\n\n  {name}\n</div>"),
    invalid("<>\n  <p />\n  <></>\n  <p />\n</>", "<>\n  <p />\n\n  <></>\n\n  <p />\n</>", 2),
    invalid("<div>\n  <p />\n  {/* Why */}\n</div>", "<div>\n  <p />\n\n  {/* Why */}\n</div>"),
    // Around a conditional, whatever its neighbour is.
    invalid(
      "<div>\n  {name}\n  {show && <p />}\n</div>",
      "<div>\n  {name}\n\n  {show && <p />}\n</div>",
    ),
    invalid(
      "<div>\n  {show && <p />}\n  {name}\n</div>",
      "<div>\n  {show && <p />}\n\n  {name}\n</div>",
    ),
    invalid(
      "<div>\n  {show ? <p /> : null}\n  <p />\n</div>",
      "<div>\n  {show ? <p /> : null}\n\n  <p />\n</div>",
    ),
    // A string in braces isn't text to Oxfmt, so it keeps blank lines here.
    invalid(
      '<div>\n  {"word"}\n  {show && <p />}\n</div>',
      '<div>\n  {"word"}\n\n  {show && <p />}\n</div>',
    ),
  ],
});
