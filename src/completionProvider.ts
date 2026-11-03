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
import { Dictionary, DictEntry, NameKind, entryScore } from './dictionary';
import { SmartEngine } from './engine';
import { LANGUAGES, TRIGGER_CHARS } from './languages';

/** Соответствие типа словарной записи и иконки пункта VSCode. */
const KIND_MAP: Record<NameKind, vscode.CompletionItemKind> = {
  class: vscode.CompletionItemKind.Class,
  interface: vscode.CompletionItemKind.Interface,
  type: vscode.CompletionItemKind.TypeParameter,
  enum: vscode.CompletionItemKind.Enum,
  struct: vscode.CompletionItemKind.Struct,
  function: vscode.CompletionItemKind.Function,
  method: vscode.CompletionItemKind.Method,
  variable: vscode.CompletionItemKind.Variable,
  property: vscode.CompletionItemKind.Property,
  keyword: vscode.CompletionItemKind.Keyword,
};

/**
 * Провайдер выпадающего списка подсказок (как обычные подсказки VSCode).
 *
 * В режиме inline показывает ВСЕ кандидаты, кроме главного (он — в
 * ghost-text), чтобы список не дублировал призрачный текст; в режиме widget
 * (классический) — весь ранжированный список. Пункты помечены:
 * `LLM/freq · uses N · seen M`.
 */
export class WidgetCompletionProvider implements vscode.CompletionItemProvider {
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
   * Регистрирует провайдера для всех поддерживаемых языков с
   * trigger-символами (буквы, `_`, `$`, `.`).
   *
   * Вход: context — контекст расширения, dict — словарь.
   * Возвращает: ничего.
   */
  static register(context: vscode.ExtensionContext, dict: Dictionary): void {
    const selector = LANGUAGES.map((language) => ({ language }));
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        selector,
        new WidgetCompletionProvider(dict),
        ...TRIGGER_CHARS,
      ),
    );
  }

  /**
   * Вызывается VSCode при наборе trigger-символов (и по Ctrl+Space).
   *
   * Вход: document, position — где печатает пользователь; token — токен
   * отмены.
   * Возвращает: ранжированный список CompletionItem (в режиме inline — без
   * первого кандидата, занятого ghost-text; в режиме widget — полный список);
   * пусто, если плагин выключен или в режиме inline (список не используется).
   */
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const cfg = vscode.workspace.getConfiguration('smartAutocomplete');
    if (!cfg.get<boolean>('enabled', true)) {
      return [];
    }
    const mode = cfg.get<string>('mode', 'inline');
    return this.engine.complete(document, position, token).then((r) => {
      if (!r || r.entries.length === 0) {
        return [];
      }
      if (mode === 'inline') {
        // Главный кандидат уже виден ghost-text — в списке «остальные».
        return r.entries.slice(1).map((e, i) => this.toItem(e, i, r.viaLlm));
      }
      return r.entries.map((e, i) => this.toItem(e, i, r.viaLlm));
    });
  }

  /**
   * Строит пункт списка из записи словаря.
   *
   * Вход: e — запись словаря, rank — позиция в ранжировании, viaLlm —
   * ранжировал ли LLM. Возвращает: CompletionItem с иконкой типа, пометкой
   * источника и sortText по рангу.
   */
  private toItem(e: DictEntry, rank: number, viaLlm: boolean): vscode.CompletionItem {
    const item = new vscode.CompletionItem(e.name, KIND_MAP[e.kind]);
    item.detail = `${viaLlm ? 'LLM' : 'freq'} · uses ${e.uses} · seen ${e.count}`;
    item.sortText = `${String(rank).padStart(3, '0')}${String(
      Math.max(0, 1_000_000 - entryScore(e)),
    ).padStart(7, '0')}`;
    return item;
  }
}
