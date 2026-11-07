// Deliberately narrow arithmetic, with no eval, functions, identifiers or I/O.
// Everything else remains an ordinary model question.
export function calculateQuestion(question: string): string | null {
  if (question.length > 500) return null;
  const parts = question.trim().split("?");
  if (parts.length > 2) return null;
  if (
    parts[1]?.trim() &&
    !/^(?:(?:give|return) (?:only )?(?:the )?(?:number|answer|result)|answer briefly)[.!]?$/i.test(
      parts[1].trim()
    )
  )
    return null;
  const expression = parts[0]
    .toLowerCase()
    .replace(/^(?:what is|what's|calculate|compute|evaluate)\s+/, "")
    .replace(/multiplied by|times|×/g, "*")
    .replace(/divided by|÷/g, "/")
    .replace(/to the power of|\*\*/g, "^")
    .replace(/plus/g, "+")
    .replace(/minus|−/g, "-")
    .replace(/\s/g, "");
  if (expression.length > 120 || !/[+*/%^()-]/.test(expression)) return null;
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+*/%^()-]/g) || [];
  if (tokens.length > 64 || tokens.join("") !== expression) return null;
  let at = 0;
  function atom(): number {
    if (tokens[at] === "(") {
      at++;
      const value = sum();
      if (tokens[at++] !== ")") throw new Error("syntax");
      return value;
    }
    const token = tokens[at++];
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw new Error("syntax");
    return Number(token);
  }
  function power(): number {
    const left = atom();
    if (tokens[at] !== "^") return left;
    at++;
    const right = unary();
    if (Math.abs(right) > 1000) throw new Error("range");
    return Math.pow(left, right);
  }
  function unary(): number {
    if (tokens[at] === "+") {
      at++;
      return unary();
    }
    if (tokens[at] === "-") {
      at++;
      return -unary();
    }
    return power();
  }
  function product(): number {
    let value = unary();
    while (["*", "/", "%"].includes(tokens[at])) {
      const operator = tokens[at++],
        right = unary();
      if (operator !== "*" && right === 0) throw new Error("zero");
      value =
        operator === "*"
          ? value * right
          : operator === "/"
            ? value / right
            : value % right;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (["+", "-"].includes(tokens[at])) {
      const operator = tokens[at++],
        right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  try {
    const value = sum();
    if (at !== tokens.length) return null;
    if (!Number.isFinite(value))
      return "That calculation is outside the supported numeric range.";
    return String(Number(value.toPrecision(12)));
  } catch (error) {
    if ((error as Error).message === "zero")
      return "Division by zero is undefined.";
    if ((error as Error).message === "range")
      return "That calculation is outside the supported numeric range.";
    return null;
  }
}
