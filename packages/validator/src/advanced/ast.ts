// AST Parser, Evaluator, and Emitter for JS expressions in validation rules.
// Replaces dynamic code evaluation (new Function / eval) with static AST execution.

export type ASTNode =
  | { type: 'Literal'; value: unknown }
  | { type: 'Identifier'; name: string }
  | { type: 'MemberExpression'; object: ASTNode; property: ASTNode; computed: boolean }
  | { type: 'CallExpression'; callee: ASTNode; arguments: ASTNode[] }
  | { type: 'UnaryExpression'; operator: string; argument: ASTNode }
  | { type: 'BinaryExpression'; operator: string; left: ASTNode; right: ASTNode }
  | { type: 'LogicalExpression'; operator: string; left: ASTNode; right: ASTNode }
  | { type: 'ConditionalExpression'; test: ASTNode; consequent: ASTNode; alternate: ASTNode }
  | { type: 'ArrayExpression'; elements: ASTNode[] }
  | { type: 'ObjectExpression'; properties: { key: string; value: ASTNode }[] };

type TokenType = 'IDENT' | 'NUMBER' | 'STRING' | 'OP' | 'PUNCT' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Single-line comment
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < len && src[i] !== '\n') i++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      if (i < len) i += 2;
      continue;
    }

    // String literals: "...", '...', `...`
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      let val = '';
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < len) {
          i++;
          const esc = src[i]!;
          if (esc === 'n') val += '\n';
          else if (esc === 'r') val += '\r';
          else if (esc === 't') val += '\t';
          else val += esc;
        } else {
          val += src[i]!;
        }
        i++;
      }
      if (i < len) i++; // consume closing quote
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let numStr = '';
      while (i < len && /[0-9._eE+-]/.test(src[i]!)) {
        // Guard against matching operator + or - if not exponent
        if ((src[i] === '+' || src[i] === '-') && !/[eE]$/.test(numStr)) {
          break;
        }
        numStr += src[i++]!;
      }
      tokens.push({ type: 'NUMBER', value: numStr });
      continue;
    }

    // Identifiers & Keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let ident = '';
      while (i < len && /[A-Za-z0-9_$]/.test(src[i]!)) {
        ident += src[i++]!;
      }
      if (ident === 'typeof') {
        tokens.push({ type: 'OP', value: 'typeof' });
      } else {
        tokens.push({ type: 'IDENT', value: ident });
      }
      continue;
    }

    // Multi-char operators
    const three = src.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'OP', value: three });
      i += 3;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '??'].includes(two)) {
      tokens.push({ type: 'OP', value: two });
      i += 2;
      continue;
    }

    // Single-char operators
    if (['+', '-', '*', '/', '%', '!', '<', '>', '?'].includes(ch)) {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }

    // Punctuation
    if (['.', ',', ':', '(', ')', '[', ']', '{', '}'].includes(ch)) {
      tokens.push({ type: 'PUNCT', value: ch });
      i++;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${ch}' at index ${i}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(src: string) {
    this.tokens = tokenize(src);
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '' };
  }

  private consume(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  private matchOp(op: string): boolean {
    const tok = this.peek();
    if (tok.type === 'OP' && tok.value === op) {
      this.consume();
      return true;
    }
    return false;
  }

  private matchPunct(p: string): boolean {
    const tok = this.peek();
    if (tok.type === 'PUNCT' && tok.value === p) {
      this.consume();
      return true;
    }
    return false;
  }

  parse(): ASTNode {
    const node = this.parseExpression();
    if (this.peek().type !== 'EOF') {
      throw new SyntaxError(`Unexpected token '${this.peek().value}' at index ${this.pos}`);
    }
    return node;
  }

  private parseExpression(): ASTNode {
    return this.parseConditional();
  }

  private parseConditional(): ASTNode {
    let test = this.parseLogicalOr();
    if (this.matchOp('?')) {
      const consequent = this.parseExpression();
      if (!this.matchPunct(':') && !this.matchOp(':')) {
        // accept : as punct or op
      }
      const alternate = this.parseExpression();
      return { type: 'ConditionalExpression', test, consequent, alternate };
    }
    return test;
  }

  private parseLogicalOr(): ASTNode {
    let left = this.parseLogicalAnd();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && (tok.value === '||' || tok.value === '??')) {
        const op = this.consume().value;
        const right = this.parseLogicalAnd();
        left = { type: 'LogicalExpression', operator: op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseLogicalAnd(): ASTNode {
    let left = this.parseEquality();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && tok.value === '&&') {
        this.consume();
        const right = this.parseEquality();
        left = { type: 'LogicalExpression', operator: '&&', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseEquality(): ASTNode {
    let left = this.parseRelational();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && ['===', '!==', '==', '!='].includes(tok.value)) {
        const op = this.consume().value;
        const right = this.parseRelational();
        left = { type: 'BinaryExpression', operator: op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseRelational(): ASTNode {
    let left = this.parseAdditive();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && ['<', '>', '<=', '>='].includes(tok.value)) {
        const op = this.consume().value;
        const right = this.parseAdditive();
        left = { type: 'BinaryExpression', operator: op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && ['+', '-'].includes(tok.value)) {
        const op = this.consume().value;
        const right = this.parseMultiplicative();
        left = { type: 'BinaryExpression', operator: op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();
    while (true) {
      const tok = this.peek();
      if (tok.type === 'OP' && ['*', '/', '%'].includes(tok.value)) {
        const op = this.consume().value;
        const right = this.parseUnary();
        left = { type: 'BinaryExpression', operator: op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): ASTNode {
    const tok = this.peek();
    if (tok.type === 'OP' && ['typeof', '!', '+', '-'].includes(tok.value)) {
      const op = this.consume().value;
      const arg = this.parseUnary();
      return { type: 'UnaryExpression', operator: op, argument: arg };
    }
    return this.parseMemberOrCall();
  }

  private parseMemberOrCall(): ASTNode {
    let expr = this.parsePrimary();

    while (true) {
      if (this.matchPunct('.')) {
        const propTok = this.peek();
        if (propTok.type === 'IDENT') {
          this.consume();
          const property: ASTNode = { type: 'Identifier', name: propTok.value };
          expr = { type: 'MemberExpression', object: expr, property, computed: false };
        } else {
          break;
        }
      } else if (this.matchPunct('[')) {
        const indexExpr = this.parseExpression();
        this.matchPunct(']');
        expr = { type: 'MemberExpression', object: expr, property: indexExpr, computed: true };
      } else if (this.matchPunct('(')) {
        const args: ASTNode[] = [];
        if (!this.matchPunct(')')) {
          while (true) {
            args.push(this.parseExpression());
            if (this.matchPunct(',')) continue;
            this.matchPunct(')');
            break;
          }
        }
        expr = { type: 'CallExpression', callee: expr, arguments: args };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek();

    if (tok.type === 'STRING') {
      this.consume();
      return { type: 'Literal', value: tok.value };
    }

    if (tok.type === 'NUMBER') {
      this.consume();
      return { type: 'Literal', value: Number(tok.value) };
    }

    if (tok.type === 'IDENT') {
      this.consume();
      if (tok.value === 'true') return { type: 'Literal', value: true };
      if (tok.value === 'false') return { type: 'Literal', value: false };
      if (tok.value === 'null') return { type: 'Literal', value: null };
      if (tok.value === 'undefined') return { type: 'Literal', value: undefined };
      return { type: 'Identifier', name: tok.value };
    }

    if (this.matchPunct('(')) {
      const expr = this.parseExpression();
      this.matchPunct(')');
      return expr;
    }

    if (this.matchPunct('[')) {
      const elements: ASTNode[] = [];
      if (!this.matchPunct(']')) {
        while (true) {
          elements.push(this.parseExpression());
          if (this.matchPunct(',')) continue;
          this.matchPunct(']');
          break;
        }
      }
      return { type: 'ArrayExpression', elements };
    }

    if (this.matchPunct('{')) {
      const properties: { key: string; value: ASTNode }[] = [];
      if (!this.matchPunct('}')) {
        while (true) {
          const keyTok = this.peek();
          let key = '';
          if (keyTok.type === 'IDENT' || keyTok.type === 'STRING') {
            key = this.consume().value;
          }
          if (this.matchPunct(':')) {
            // matched ':'
          } else {
            this.matchOp(':');
          }
          const val = this.parseExpression();
          properties.push({ key, value: val });
          if (this.matchPunct(',')) continue;
          this.matchPunct('}');
          break;
        }
      }
      return { type: 'ObjectExpression', properties };
    }

    throw new SyntaxError(`Unexpected token '${tok.value}' (type: ${tok.type})`);
  }
}

export function parseExpression(src: string): ASTNode {
  return new Parser(src).parse();
}

export function evaluateAst(node: ASTNode, scope: Record<string, unknown>): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier': {
      if (node.name in scope) return scope[node.name];
      if (node.name === 'undefined') return undefined;
      if (node.name === 'null') return null;
      if (node.name === 'true') return true;
      if (node.name === 'false') return false;
      if (node.name === 'NaN') return NaN;
      if (node.name === 'Infinity') return Infinity;
      if (node.name === 'Math') return Math;
      if (node.name === 'String') return String;
      if (node.name === 'Number') return Number;
      if (node.name === 'Boolean') return Boolean;
      if (node.name === 'Array') return Array;
      if (node.name === 'Object') return Object;
      return scope[node.name];
    }

    case 'MemberExpression': {
      const obj = evaluateAst(node.object, scope);
      const prop = node.computed ? evaluateAst(node.property, scope) : (node.property as { name: string }).name;
      if (obj == null) return undefined;
      return (obj as Record<string | number | symbol, unknown>)[prop as string | number];
    }

    case 'CallExpression': {
      if (node.callee.type === 'MemberExpression') {
        const obj = evaluateAst(node.callee.object, scope);
        const prop = node.callee.computed
          ? evaluateAst(node.callee.property, scope)
          : (node.callee.property as { name: string }).name;
        const args = node.arguments.map(a => evaluateAst(a, scope));
        if (obj != null && typeof (obj as Record<string, unknown>)[prop as string] === 'function') {
          return ((obj as Record<string, Function>)[prop as string] as Function).apply(obj, args);
        }
        return undefined;
      }
      const fn = evaluateAst(node.callee, scope);
      const args = node.arguments.map(a => evaluateAst(a, scope));
      if (typeof fn === 'function') {
        return fn(...args);
      }
      return undefined;
    }

    case 'UnaryExpression': {
      const val = evaluateAst(node.argument, scope);
      switch (node.operator) {
        case 'typeof':
          return typeof val;
        case '!':
          return !val;
        case '+':
          return +(val as number);
        case '-':
          return -(val as number);
        default:
          return undefined;
      }
    }

    case 'BinaryExpression': {
      const left = evaluateAst(node.left, scope);
      const right = evaluateAst(node.right, scope);
      switch (node.operator) {
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '==':
          // eslint-disable-next-line eqeqeq
          return left == right;
        case '!=':
          // eslint-disable-next-line eqeqeq
          return left != right;
        case '<':
          return (left as number) < (right as number);
        case '>':
          return (left as number) > (right as number);
        case '<=':
          return (left as number) <= (right as number);
        case '>=':
          return (left as number) >= (right as number);
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? String(left) + String(right)
            : Number(left) + Number(right);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          return (left as number) / (right as number);
        case '%':
          return (left as number) % (right as number);
        default:
          return undefined;
      }
    }

    case 'LogicalExpression': {
      if (node.operator === '&&') {
        return evaluateAst(node.left, scope) && evaluateAst(node.right, scope);
      }
      if (node.operator === '||') {
        return evaluateAst(node.left, scope) || evaluateAst(node.right, scope);
      }
      if (node.operator === '??') {
        return evaluateAst(node.left, scope) ?? evaluateAst(node.right, scope);
      }
      return undefined;
    }

    case 'ConditionalExpression': {
      const test = evaluateAst(node.test, scope);
      return test ? evaluateAst(node.consequent, scope) : evaluateAst(node.alternate, scope);
    }

    case 'ArrayExpression':
      return node.elements.map(e => evaluateAst(e, scope));

    case 'ObjectExpression': {
      const res: Record<string, unknown> = {};
      for (const p of node.properties) {
        res[p.key] = evaluateAst(p.value, scope);
      }
      return res;
    }

    default:
      return undefined;
  }
}

export function emitAstJs(node: ASTNode, vName: string): string {
  switch (node.type) {
    case 'Literal':
      return JSON.stringify(node.value);

    case 'Identifier':
      return node.name === 'v' ? vName : node.name;

    case 'MemberExpression': {
      const obj = emitAstJs(node.object, vName);
      if (node.computed) {
        const prop = emitAstJs(node.property, vName);
        return `${obj}[${prop}]`;
      }
      const prop = (node.property as { name: string }).name;
      return `${obj}.${prop}`;
    }

    case 'CallExpression': {
      const callee = emitAstJs(node.callee, vName);
      const args = node.arguments.map(a => emitAstJs(a, vName)).join(', ');
      return `${callee}(${args})`;
    }

    case 'UnaryExpression': {
      const arg = emitAstJs(node.argument, vName);
      if (node.operator === 'typeof') {
        return `typeof ${arg}`;
      }
      return `${node.operator}(${arg})`;
    }

    case 'BinaryExpression': {
      const left = emitAstJs(node.left, vName);
      const right = emitAstJs(node.right, vName);
      return `(${left} ${node.operator} ${right})`;
    }

    case 'LogicalExpression': {
      const left = emitAstJs(node.left, vName);
      const right = emitAstJs(node.right, vName);
      return `(${left} ${node.operator} ${right})`;
    }

    case 'ConditionalExpression': {
      const test = emitAstJs(node.test, vName);
      const cons = emitAstJs(node.consequent, vName);
      const alt = emitAstJs(node.alternate, vName);
      return `(${test} ? ${cons} : ${alt})`;
    }

    case 'ArrayExpression': {
      const elems = node.elements.map(e => emitAstJs(e, vName)).join(', ');
      return `[${elems}]`;
    }

    case 'ObjectExpression': {
      const props = node.properties.map(p => `${JSON.stringify(p.key)}: ${emitAstJs(p.value, vName)}`).join(', ');
      return `{ ${props} }`;
    }
  }
}
