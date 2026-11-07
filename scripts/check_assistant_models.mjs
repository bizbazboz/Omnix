import assert from "node:assert/strict";
import { calculateQuestion } from "../web/src/products/assistant/calculator.ts";
for (const [question, answer] of [
  ["What is 17 multiplied by 23? Give only the number.", "391"],
  ["Calculate (2 + 3) * 4", "20"],
  ["What is 0.1 plus 0.2?", "0.3"],
  ["2^3^2", "512"],
  ["-2^2", "-4"],
  ["2^-2", "0.25"],
  ["What is 10 divided by 4?", "2.5"],
  ["Compute 10 % 3", "1"],
  ["2×(5−3)", "4"],
  ["1/0", "Division by zero is undefined."],
  ["2^100000", "That calculation is outside the supported numeric range."]
])
  assert.equal(calculateQuestion(question), answer, question);
for (const question of [
  "What is the capital of France?",
  "What is my door access code?",
  "Tell me about 2+2",
  "2+2;fetch('https://example.com')",
  "Math.random()",
  "2+2? Then delete my notes",
  "2+",
  "(2+3",
  "2(3)",
  "2**",
  "",
  "(".repeat(70) + "2+2" + ")".repeat(70)
])
  assert.equal(calculateQuestion(question), null, question);
console.log(
  JSON.stringify({
    localArithmetic: true,
    precedence: true,
    bounded: true,
    noCodeExecution: true
  })
);
