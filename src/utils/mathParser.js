/**
 * SKETCH3D — Safe Recursive-Descent Math Expression Parser
 * ========================================================
 * Evaluates mathematical expressions with variables without eval() or new Function().
 * Supports: +, -, *, /, unary minus, parentheses, floating point numbers, and bound variables.
 * Enforces cycle detection and safe tokenization.
 */

export class MathParserError extends Error {
  constructor(message, position = -1) {
    super(position >= 0 ? `${message} at position ${position}` : message);
    this.name = 'MathParserError';
    this.position = position;
  }
}

/**
 * Token types
 */
const TOKEN = {
  NUMBER: 'NUMBER',
  IDENT: 'IDENT',
  PLUS: '+',
  MINUS: '-',
  MUL: '*',
  DIV: '/',
  LPAREN: '(',
  RPAREN: ')',
  EOF: 'EOF',
};

/**
 * Tokenize input string into an array of tokens
 * @param {string} input
 * @returns {Array<{type: string, value: any, pos: number}>}
 */
export function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '+') {
      tokens.push({ type: TOKEN.PLUS, value: '+', pos: i++ });
    } else if (ch === '-') {
      tokens.push({ type: TOKEN.MINUS, value: '-', pos: i++ });
    } else if (ch === '*') {
      tokens.push({ type: TOKEN.MUL, value: '*', pos: i++ });
    } else if (ch === '/') {
      tokens.push({ type: TOKEN.DIV, value: '/', pos: i++ });
    } else if (ch === '(') {
      tokens.push({ type: TOKEN.LPAREN, value: '(', pos: i++ });
    } else if (ch === ')') {
      tokens.push({ type: TOKEN.RPAREN, value: ')', pos: i++ });
    } else if (/[0-9.]/.test(ch)) {
      const start = i;
      let hasDot = false;
      while (i < n && /[0-9.]/.test(input[i])) {
        if (input[i] === '.') {
          if (hasDot) {
            throw new MathParserError('Multiple decimal points in number', i);
          }
          hasDot = true;
        }
        i++;
      }
      const numStr = input.slice(start, i);
      const val = parseFloat(numStr);
      if (isNaN(val)) {
        throw new MathParserError(`Invalid number "${numStr}"`, start);
      }
      tokens.push({ type: TOKEN.NUMBER, value: val, pos: start });
    } else if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_]/.test(input[i])) {
        i++;
      }
      const ident = input.slice(start, i);
      tokens.push({ type: TOKEN.IDENT, value: ident, pos: start });
    } else {
      throw new MathParserError(`Unexpected character "${ch}"`, i);
    }
  }

  tokens.push({ type: TOKEN.EOF, value: null, pos: n });
  return tokens;
}

/**
 * Recursive descent parser class
 */
class Parser {
  constructor(tokens, variables = {}, activeStack = new Set()) {
    this.tokens = tokens;
    this.variables = variables;
    this.activeStack = activeStack;
    this.cursor = 0;
  }

  peek() {
    return this.tokens[this.cursor];
  }

  consume(expectedType = null) {
    const tok = this.peek();
    if (expectedType && tok.type !== expectedType) {
      throw new MathParserError(
        `Expected "${expectedType}" but found "${tok.type}"`,
        tok.pos
      );
    }
    this.cursor++;
    return tok;
  }

  parse() {
    const result = this.expr();
    if (this.peek().type !== TOKEN.EOF) {
      throw new MathParserError('Unexpected extra tokens after expression', this.peek().pos);
    }
    return result;
  }

  expr() {
    let left = this.term();

    while (this.peek().type === TOKEN.PLUS || this.peek().type === TOKEN.MINUS) {
      const op = this.consume().type;
      const right = this.term();
      if (op === TOKEN.PLUS) {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  term() {
    let left = this.factor();

    while (this.peek().type === TOKEN.MUL || this.peek().type === TOKEN.DIV) {
      const op = this.consume().type;
      const right = this.factor();
      if (op === TOKEN.MUL) {
        left = left * right;
      } else {
        if (Math.abs(right) < 1e-12) {
          throw new MathParserError('Division by zero');
        }
        left = left / right;
      }
    }

    return left;
  }

  factor() {
    const tok = this.peek();

    // Unary plus
    if (tok.type === TOKEN.PLUS) {
      this.consume();
      return this.factor();
    }

    // Unary minus
    if (tok.type === TOKEN.MINUS) {
      this.consume();
      return -this.factor();
    }

    // Number literal
    if (tok.type === TOKEN.NUMBER) {
      return this.consume().value;
    }

    // Parenthesized sub-expression
    if (tok.type === TOKEN.LPAREN) {
      this.consume(TOKEN.LPAREN);
      const val = this.expr();
      this.consume(TOKEN.RPAREN);
      return val;
    }

    // Variable identifier
    if (tok.type === TOKEN.IDENT) {
      const varName = this.consume().value;
      return this.resolveVariable(varName, tok.pos);
    }

    throw new MathParserError(`Unexpected token "${tok.type}"`, tok.pos);
  }

  resolveVariable(name, pos) {
    if (this.activeStack.has(name)) {
      throw new MathParserError(`Circular variable reference detected in "${name}"`, pos);
    }

    if (!(name in this.variables)) {
      throw new MathParserError(`Undefined variable "${name}"`, pos);
    }

    const raw = this.variables[name];
    if (typeof raw === 'number') {
      return raw;
    }

    if (typeof raw === 'string') {
      this.activeStack.add(name);
      try {
        return evaluateExpression(raw, this.variables, this.activeStack);
      } finally {
        this.activeStack.delete(name);
      }
    }

    throw new MathParserError(`Invalid variable value type for "${name}"`, pos);
  }
}

/**
 * Evaluate a mathematical expression string safely
 * @param {string} expr
 * @param {Record<string, number|string>} [variables]
 * @param {Set<string>} [activeStack]
 * @returns {number}
 */
export function evaluateExpression(expr, variables = {}, activeStack = new Set()) {
  if (typeof expr !== 'string' || !expr.trim()) {
    throw new MathParserError('Expression must be a non-empty string');
  }
  const tokens = tokenize(expr.trim());
  const parser = new Parser(tokens, variables, activeStack);
  const result = parser.parse();
  if (isNaN(result) || !isFinite(result)) {
    throw new MathParserError('Expression evaluated to non-finite number');
  }
  return result;
}

/**
 * Validate that an expression is syntactically sound and non-cyclical
 * @param {string} expr
 * @param {Record<string, number|string>} [variables]
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateExpression(expr, variables = {}) {
  try {
    const val = evaluateExpression(expr, variables);
    return { valid: true, value: val };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export const evaluateMathExpression = evaluateExpression;
