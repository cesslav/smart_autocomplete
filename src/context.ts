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

import * as vscode from 'vscode';

/**
 * Срез последних строк кода для контекста LLM: строки выше курсора плюс
 * текущая строка, обрезанная по позиции курсора.
 *
 * Вход: document — документ, position — позиция курсора, lines — сколько
 * строк брать.
 * Возвращает: строку с кодом (строки склеены переводом строки).
 */
export function getContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  lines: number,
): string {
  const start = Math.max(0, position.line - lines + 1);
  const out: string[] = [];
  for (let i = start; i <= position.line; i++) {
    const line = document.lineAt(i).text;
    out.push(i === position.line ? line.slice(0, position.character) : line);
  }
  return out.join('\n');
}
