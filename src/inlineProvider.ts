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
import { Dictionary } from './dictionary';
import { SmartEngine } from './engine';
import { LANGUAGES } from './languages';

/**
 * Провайдер ghost-text (по умолчанию, режим inline).
 *
 * Показывает только лучшего кандидата серым «призрачным» текстом поверх
 * кода: Tab — принять, Alt+]/Alt+[ — переключиться на следующий вариант.
 * Остальные кандидаты показывает выпадающий список (см.
 * WidgetCompletionProvider); оба провайдера разделяют один запрос к LLM.
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly engine: SmartEngine;

  /**
   * Создаёт провайдера.
   *
   * Вход: dict — словарь имён. Возвращает: ничего (конструктор).
   */
  constructor(dict: Dictionary) {
    this.engine = new SmartEngine(dict);
  }

  /**
   * Регистрирует провайдера для всех поддерживаемых языков.
   *
   * Вход: context — контекст расширения, dict — словарь.
   * Возвращает: ничего.
   */
  static register(context: vscode.ExtensionContext, dict: Dictionary): void {
    const selector = LANGUAGES.map((language) => ({ language }));
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(selector, new InlineCompletionProvider(dict)),
    );
  }

  /**
   * Вызывается VSCode при наборе символов (в режиме inline).
   *
   * Вход: document, position — где печатает пользователь; context — контекст
   * inline-подсказок; token — токен отмены.
   * Возвращает: не более одного InlineCompletionItem — лучший кандидат,
   * заменяющий набранный префикс; пусто, если дополнять нечего или
   * плагин выключен/не в режиме inline.
   */
  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.InlineCompletionItem[]> {
    const cfg = vscode.workspace.getConfiguration('smartAutocomplete');
    if (cfg.get<string>('mode', 'inline') !== 'inline') {
      return [];
    }
    return this.engine.complete(document, position, token).then((r) => {
      if (!r || r.entries.length === 0) {
        return [];
      }
      // Ghost-text показывает только главный (первый) вариант; остальные —
      // в выпадающем списке.
      const top = r.entries[0];
      // Призрачный текст должен заменить уже набранный префикс.
      const start = new vscode.Position(
        position.line,
        Math.max(0, position.character - r.prefix.length),
      );
      return [new vscode.InlineCompletionItem(top.name, new vscode.Range(start, position))];
    });
  }
}
