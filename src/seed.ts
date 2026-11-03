/*
 * Smart Autocomplete (Local LLM)
 * Copyright (C) 2026 ceslav
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Dictionary } from './dictionary';

/**
 * Встроенный сид-словарь, чтобы плагин был полезен даже в пустом
 * воркспейсе. Записи добавляются только если их ещё нет — сканирование
 * кода всегда имеет приоритет.
 */

/** Распространённые ключевые слова разных языков. */
const KEYWORDS: string[] = [
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'throws',
  'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'await', 'async',
  'yield', 'import', 'export', 'from', 'as', 'using', 'package', 'public',
  'private', 'protected', 'internal', 'static', 'final', 'const', 'let',
  'var', 'val', 'func', 'fn', 'def', 'class', 'struct', 'enum', 'interface',
  'type', 'trait', 'protocol', 'extends', 'implements', 'super', 'this',
  'self', 'that', 'null', 'none', 'nil', 'undefined', 'true', 'false',
  'True', 'False', 'None', 'True', 'pass', 'lambda', 'match', 'when',
  'then', 'end', 'begin', 'unless', 'not', 'and', 'or', 'is', 'void',
  'int', 'float', 'double', 'char', 'bool', 'boolean', 'string', 'str',
  'long', 'short', 'byte', 'number', 'object', 'any', 'unknown', 'never',
  'record', 'sealed', 'abstract', 'override', 'virtual', 'extern', 'inline',
  'operator', 'sizeof', 'template', 'typename', 'using', 'namespace',
];

/** Распространённые типы и глобальные объекты. */
const TYPES: string[] = [
  'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'Math', 'RegExp',
  'Symbol', 'Error', 'TypeError', 'RangeError', 'Map', 'URL', 'URLSearchParams',
  'Buffer', 'TextDecoder', 'TextEncoder', 'process', 'globalThis',
  'List', 'Optional', 'HashMap', 'Vec', 'Box', 'Result', 'Ok', 'Err',
  'String', 'Int', 'Float', 'Double', 'Bool', 'Any',
  'DataFrame', 'Series', 'dict', 'list', 'tuple', 'set', 'str', 'int',
  'float', 'bool', 'bytes', 'super', 'slice', 'string', 'error', 'byte',
  'rune', 'chan', 'go', 'defer', 'map',
];

/** Распространённые методы и функции стандартных библиотек. */
const METHODS: string[] = [
  'log', 'info', 'warn', 'error', 'debug', 'trace', 'print', 'println',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join',
  'split', 'replace', 'replaceAll', 'match', 'search', 'trim', 'trimStart',
  'trimEnd', 'toUpperCase', 'toLowerCase', 'toString', 'toFixed', 'valueOf',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'parse', 'stringify',
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'includes', 'indexOf', 'lastIndexOf', 'flat', 'flatMap', 'sort', 'reverse',
  'fill', 'keys', 'values', 'entries', 'at', 'copyWithin', 'assign', 'freeze',
  'get', 'set', 'has', 'add', 'delete', 'clear', 'append', 'extend', 'insert',
  'remove', 'pop', 'update', 'upsert', 'create', 'destroy', 'save', 'load',
  'read', 'write', 'readFile', 'writeFile', 'open', 'close', 'exists',
  'existsSync', 'mkdir', 'rm', 'rename', 'copy', 'stat',
  'fetch', 'request', 'send', 'post', 'put', 'patch', 'del', 'get',
  'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race',
  'run', 'execute', 'exec', 'spawn', 'start', 'stop', 'begin', 'end',
  'init', 'reset', 'refresh', 'reload', 'render', 'draw', 'paint', 'show',
  'hide', 'focus', 'blur', 'click', 'submit', 'change', 'addEventListener',
  'removeEventListener', 'querySelector', 'querySelectorAll', 'getElementById',
  'createElement', 'createTextNode', 'appendChild', 'removeChild',
  'setAttribute', 'getAttribute', 'hasAttribute',
  'length', 'size', 'len', 'count', 'first', 'last', 'min', 'max', 'sum',
  'avg', 'mean', 'sort_by', 'sorted', 'reversed', 'abs', 'round', 'floor',
  'ceil', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'clamp',
  'format', 'sprintf', 'f', 'd', 's', 'p', 'w', 'e',
];

/** Распространённые имена переменных. */
const VARIABLES: string[] = [
  'data', 'result', 'results', 'value', 'values', 'item', 'items', 'index',
  'key', 'keys', 'name', 'names', 'type', 'id', 'uuid', 'url', 'path',
  'file', 'files', 'dir', 'root', 'text', 'content', 'message', 'msg',
  'err', 'error', 'exception', 'status', 'state', 'config', 'options', 'opt',
  'params', 'args', 'arg', 'context', 'ctx', 'callback', 'cb', 'handler',
  'promise', 'queue', 'stack', 'buffer', 'stream', 'reader', 'writer',
  'header', 'headers', 'body', 'payload', 'response', 'res', 'req',
  'request', 'client', 'server', 'socket', 'connection', 'conn', 'db',
  'database', 'table', 'row', 'rows', 'record', 'records', 'entity',
  'user', 'users', 'session', 'token', 'auth', 'password', 'username',
  'email', 'title', 'description', 'label', 'text', 'html', 'css', 'class',
  'id', 'src', 'href', 'target', 'value', 'checked', 'disabled', 'hidden',
  'width', 'height', 'top', 'left', 'right', 'bottom', 'x', 'y', 'z',
  'min', 'max', 'start', 'end', 'from', 'to', 'step', 'limit', 'offset',
  'page', 'size', 'total', 'current', 'previous', 'next', 'old', 'new',
  'tmp', 'temp', 'tmpDir', 'cwd', 'env', 'process', 'os', 'fs', 'path',
  'utils', 'helper', 'helpers', 'service', 'services', 'repository', 'repo',
  'model', 'models', 'view', 'views', 'controller', 'component',
];

/**
 * Заполняет словарь сид-записями (ключевые слова, типы, методы,
 * переменные), не перетирая уже известные имена.
 *
 * Вход: dict — словарь. Возвращает: ничего.
 */
export function seedDictionary(dict: Dictionary): void {
  for (const n of KEYWORDS) {
    dict.ensure(n, 'keyword');
  }
  for (const n of TYPES) {
    dict.ensure(n, 'class');
  }
  for (const n of METHODS) {
    dict.ensure(n, 'method');
  }
  for (const n of VARIABLES) {
    dict.ensure(n, 'variable');
  }
}
