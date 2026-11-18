import { parse } from "acorn";
import { simple } from "acorn-walk";

const inspected = new WeakMap();
const plain = { external: false, needsOrigin: false };
export const executable = (file) => file.role === "script" || file.role === "module";
export const isModuleFile = (file) => file.role === "module" || /\.mjs(?:$|[?#])/i.test(file.path);
const string = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
const name = (node) => node?.type === "Identifier" ? node.name : undefined;
function member(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type !== "MemberExpression") return "";
  const property = node.computed ? string(node.property) : name(node.property);
  return property ? member(node.object) + "." + property : "";
}

function importAddress(node) {
  if (node?.type !== "TemplateLiteral") return string(node);
  if (!node.expressions.length) return node.quasis[0].value.cooked;
  // A trailing timestamp changes the HTTP cache key, not the requested script.
  const [clock] = node.expressions;
  if (node.expressions.length === 1 && clock.type === "CallExpression" && !clock.arguments.length &&
      member(clock.callee) === "Date.now" && node.quasis[1].value.cooked === "") {
    const base = node.quasis[0].value.cooked;
    if (base && /[?&](?:t|_|timestamp|cacheBust)=$/i.test(base)) return base.replace(/[?&][^?&]*=$/, "");
  }
}

// Accept only a discarded import or a literal script insertion with no other effects.
function scriptTarget(body) {
  let parameter, literal;
  if (body.length === 2 && body[0].type === "FunctionDeclaration") {
    const [fn, invoke] = body;
    const call = invoke.expression;
    if (fn.async || fn.generator || fn.params.length !== 1 || !name(fn.params[0]) ||
        call?.type !== "CallExpression" || name(call.callee) !== name(fn.id) || call.arguments.length !== 1)
      return;
    parameter = name(fn.params[0]);
    literal = string(call.arguments[0]);
    if (!literal) return;
    body = fn.body.body;
  }
  const [decl] = body;
  const variable = decl?.declarations?.[0];
  if (decl?.type !== "VariableDeclaration" || decl.declarations.length !== 1 || !name(variable.id) ||
      variable.init?.type !== "CallExpression" || member(variable.init.callee) !== "document.createElement" ||
      variable.init.arguments.length !== 1 || string(variable.init.arguments[0]) !== "script") return;
  const id = name(variable.id), append = body.at(-1)?.expression;
  if (append?.type !== "CallExpression" || !["append", "appendChild"].includes(name(append.callee.property)) ||
      append.arguments.length !== 1 || name(append.arguments[0]) !== id) return;
  const parent = append.callee.object;
  const headList = parent?.object;
  const indexedHead = parent?.computed && parent.property.value === 0 && headList?.type === "CallExpression" &&
    member(headList.callee) === "document.getElementsByTagName" && headList.arguments.length === 1 &&
    string(headList.arguments[0]) === "head";
  if (member(parent) !== "document.head" && !indexedHead) return;
  let url, module = false;
  for (const statement of body.slice(1, -1)) {
    const set = statement.expression;
    if (set?.type !== "AssignmentExpression" || set.operator !== "=" || name(set.left.object) !== id) return;
    const prop = set.left.computed ? string(set.left.property) : name(set.left.property);
    if (prop === "src" && !url) {
      url = parameter && name(set.right) === parameter ? literal : string(set.right);
      if (!url) return;
    } else if (prop === "type" && ["module", "text/javascript", "application/javascript"].includes(string(set.right))) {
      module = set.right.value === "module";
    } else if (!(["defer", "async"].includes(prop) && typeof set.right.value === "boolean")) return;
  }
  return url && { url, module };
}

function directTarget(ast) {
  const body = ast.body.filter((s) => !s.directive && s.type !== "EmptyStatement");
  let expr = body.length === 1 && body[0].expression;
  if (expr?.type === "AwaitExpression" || (expr?.type === "UnaryExpression" && expr.operator === "void"))
    expr = expr.argument;
  const target = expr?.type === "ImportExpression" && !expr.options
    ? { url: importAddress(expr.source), module: true }
    : scriptTarget(body);
  if (target?.url && /^https:\/\//i.test(target.url)) {
    try {
      const url = new URL(target.url);
      if (!url.username && !url.password) return { ...target, url: url.href };
    } catch {}
  }
}

function inspect(text) {
  if (!/\b(?:import|export|script|currentScript|Worker|importScripts)\b/i.test(text)) return plain;
  let ast;
  for (const sourceType of ["module", "script"]) {
    try { ast = parse(text, { sourceType, ecmaVersion: "latest", allowHashBang: true }); break; } catch {}
  }
  // Unknown syntax must never claim an entire executable is pinned.
  if (!ast) return { external: true, needsOrigin: true };
  let external = false, needsOrigin = false, createsScript = false, setsSrc = false;
  function dependency(node) {
    if (!node) return;
    const url = string(node);
    if (url?.startsWith("data:")) return;
    external = true;
    // Relative module requests must keep the URL of the original remote module.
    if (!url || !/^(https?:|data:|blob:)/i.test(url)) needsOrigin = true;
  }
  simple(ast, {
    ImportExpression(n) { dependency(n.source); },
    ImportDeclaration(n) { dependency(n.source); },
    ExportAllDeclaration(n) { dependency(n.source); },
    ExportNamedDeclaration(n) { dependency(n.source); },
    MetaProperty(n) { if (name(n.meta) === "import") needsOrigin = true; },
    MemberExpression(n) {
      const property = n.computed ? string(n.property) : name(n.property);
      if (property === "currentScript") needsOrigin = true;
      if (property === "src") setsSrc = true;
    },
    CallExpression(n) {
      const method = name(n.callee.property) || string(n.callee.property);
      if (method === "createElement" && string(n.arguments[0])?.toLowerCase() === "script") createsScript = true;
      if (method === "setAttribute" && string(n.arguments[0])?.toLowerCase() === "src") setsSrc = true;
      if (name(n.callee) === "importScripts") external = true;
    },
    NewExpression(n) {
      if (["Worker", "SharedWorker"].includes(name(n.callee))) { external = true; needsOrigin = true; }
    },
  });
  return { external: external || (createsScript && setsSrc), needsOrigin, direct: directTarget(ast) };
}

export function inspectScript(file) {
  if (!inspected.has(file)) inspected.set(file, inspect(file.text));
  return inspected.get(file);
}

export function codeScope(files) {
  if (files.some((f) => (executable(f) || f.role === "app" || f.role === "subfile") && inspectScript(f).external))
    return "runtime";
  return files.some((f) => f.role === "loader") ? "captured" : "package";
}

