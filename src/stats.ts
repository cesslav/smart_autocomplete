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
import { log } from './log';

/** Целое слово (идентификатор) без пробелов. */
const WHOLE_WORD = /^[A-Za-z_$][\w$]*$/;

/**
 * Собирает статистику использования имён.
 *
 * VSCode не сообщает провайдерам о принятии подсказки, поэтому используется
 * правило по изменениям текста: любое изменение, вставляющее целое имя
 * (3+ символа) одним куском — принятая подсказка (из списка или ghost-text),
 * вставленное имя, сниппет — считается использованием этого имени.
 * По посимвольной печати счётчики не раздуваются.
 */
export class AcceptTracker {
  private readonly sub: vscode.Disposable;

  /**
   * Подписывается на изменения документов.
   *
   * Вход: dict — словарь, context — контекст расширения (для подписки).
   * Возвращает: ничего (конструктор).
   */
  constructor(
    private readonly dict: Dictionary,
    context: vscode.ExtensionContext,
  ) {
    this.sub = vscode.workspace.onDidChangeTextDocument((e) => this.onChanges(e));
    context.subscriptions.push(this.sub);
  }

  /**
   * Обрабатывает пакет изменений документа: находит вставки целых имён и
   * фиксирует их использование.
   *
   * Вход: event — событие изменения документа. Возвращает: ничего; ошибки
   * пишутся в Output-канал.
   */
  private onChanges(event: vscode.TextDocumentChangeEvent): void {
    try {
      for (const change of event.contentChanges) {
        if (!change.text || change.text.length < 3) {
          continue;
        }
        if (!WHOLE_WORD.test(change.text)) {
          continue;
        }
        this.dict.recordUse(change.text);
        const e = this.dict.get(change.text);
        log(`Usage recorded: "${change.text}" (uses=${e?.uses ?? 1})`);
      }
    } catch (err) {
      log(`AcceptTracker error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
