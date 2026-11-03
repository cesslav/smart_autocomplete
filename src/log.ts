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

let channel: vscode.OutputChannel | undefined;

/**
 * Создаёт Output-канал «Smart Autocomplete» (вызывается один раз на
 * активацию).
 *
 * Вход: ничего. Возвращает: ничего.
 */
export function initLog(): void {
  channel = vscode.window.createOutputChannel('Smart Autocomplete');
}

/**
 * Добавляет строку с меткой времени в Output-канал.
 *
 * Вход: message — текст. Возвращает: ничего (тихо, если канал ещё не
 * создан).
 */
export function log(message: string): void {
  if (!channel) {
    return;
  }
  channel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}
