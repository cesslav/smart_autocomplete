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

/** Языки, для которых регистрируются провайдеры автодополнения. */
export const LANGUAGES: string[] = [
  'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
  'python', 'java', 'go', 'rust', 'cpp', 'c', 'csharp', 'php', 'ruby',
  'kotlin', 'swift', 'scala', 'groovy', 'perl', 'r', 'julia', 'elixir',
  'haskell', 'lua', 'dart', 'html', 'css', 'scss', 'less', 'vue', 'svelte',
  'sql', 'json', 'jsonc', 'xml', 'yaml', 'toml', 'markdown', 'dockerfile',
  'shellscript', 'powershell', 'bat', 'ini', 'graphql', 'solidity',
  'objective-c', 'objectivecpp', 'cmake', 'makefile', 'plaintext',
];

/** Символы, запускающие подсказки: буквы, `_`, `$`, `.`. */
export const TRIGGER_CHARS: string[] = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$.',
];
