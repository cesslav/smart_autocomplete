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
import * as path from 'path';
import { Dictionary } from './dictionary';
import { seedDictionary } from './seed';
import { scanWorkspace, scanText } from './scanner';
import { AcceptTracker } from './stats';
import { WidgetCompletionProvider } from './completionProvider';
import { InlineCompletionProvider } from './inlineProvider';
import { initLog, log } from './log';

let dict: Dictionary;
let status: vscode.StatusBarItem;
let savedQuickSuggestions: string | undefined;

/**
 * Обёртка обработчика события: любая ошибка внутри не должна ронять
 * extension host.
 *
 * Вход: name — имя обработчика (для лога), fn — сама функция.
 * Возвращает: ничего.
 */
function safe(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log(`${name} handler error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

/**
 * Точка входа расширения: создаёт словарь, статус-бар, провайдеры
 * (ghost-text + список), статистику использования, авто-индексирование
 * документов и стартовый фоновый скан воркспейса.
 *
 * Вход: context — контекст расширения VSCode (хранение, подписки).
 * Возвращает: ничего. Ошибки активации показываются сообщением и пишутся
 * в канал Output «Smart Autocomplete».
 */
export function activate(context: vscode.ExtensionContext): void {
  initLog();
  try {
    const file = path.join(context.globalStorageUri.fsPath, 'dictionary.json');
    dict = new Dictionary(file);
    seedDictionary(dict);

    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    status.command = 'smartAutocomplete.showStats';
    status.text = `$(zap) smart-AC: ${dict.size}`;
    status.tooltip =
      'Smart Autocomplete — dictionary size. Click to show identifier statistics.';
    status.show();
    context.subscriptions.push(status);
    const updateStatus = (): void => {
      status.text = `$(zap) smart-AC: ${dict.size}`;
    };

    new AcceptTracker(dict, context);
    WidgetCompletionProvider.register(context, dict);
    InlineCompletionProvider.register(context, dict);

    // Подавление / восстановление автопоказа встроенных подсказок
    // (только глобальные настройки VSCode).
    safe('manageBuiltInSuggest', manageBuiltInSuggest);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('smartAutocomplete.enabled') ||
          e.affectsConfiguration('smartAutocomplete.mode') ||
          e.affectsConfiguration('smartAutocomplete.suppressBuiltInSuggest')
        ) {
          safe('manageBuiltInSuggest', manageBuiltInSuggest);
        }
      }),
    );

    // Авто-индексирование: трототированная очередь вместо синхронных сканов
    // на каждое событие (залп открытий при загрузке воркспейса не должен
    // блокировать extension host).
    const indexQueue = new Set<string>();
    let indexTimer: NodeJS.Timeout | undefined;

    /**
     * Ставит документ в очередь индексирования (объединяет повторы,
     * обрабатывает через 1 с).
     *
     * Вход: doc — документ. Возвращает: ничего.
     */
    const scheduleIndex = (doc: vscode.TextDocument): void => {
      if (doc.uri.scheme !== 'file') {
        return;
      }
      indexQueue.add(doc.uri.toString());
      if (indexTimer) {
        return;
      }
      indexTimer = setTimeout(() => {
        indexTimer = undefined;
        safe('indexQueue', () => {
          for (const uri of indexQueue) {
            indexQueue.delete(uri);
            const doc2 = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
            if (doc2 && doc2.uri.scheme === 'file') {
              const text = doc2.getText();
              if (text.length > 0 && text.length <= 1_000_000) {
                scanText(dict, text);
              }
            }
          }
          updateStatus();
        });
      }, 1000);
    };

    context.subscriptions.push(
      vscode.commands.registerCommand('smartAutocomplete.rescan', () => {
        safe('rescan', async () => {
          log('Manual rescan started.');
          const scanned = await scanWorkspace(dict, false);
          dict.flush();
          updateStatus();
          log(`Manual rescan done: ${scanned} files scanned, dictionary size ${dict.size}.`);
          void vscode.window.showInformationMessage(
            `Smart Autocomplete: scanned ${scanned} files, dictionary size ${dict.size}.`,
          );
        });
      }),
      vscode.commands.registerCommand('smartAutocomplete.showStats', () => {
        safe('showStats', async () => {
          await showStats(dict);
        });
      }),
      vscode.commands.registerCommand('smartAutocomplete.resetUsage', () => {
        safe('resetUsage', () => {
          dict.resetUsage();
          dict.flush();
          void vscode.window.showInformationMessage('Smart Autocomplete: usage statistics reset.');
        });
      }),
      // Авто-индексирование открытых и сохраняемых документов (трототировано).
      vscode.workspace.onDidOpenTextDocument((doc) => safe('onDidOpenTextDocument', () => scheduleIndex(doc))),
      vscode.workspace.onDidSaveTextDocument((doc) => safe('onDidSaveTextDocument', () => scheduleIndex(doc))),
      { dispose: () => dict.flush() },
    );

    for (const doc of vscode.workspace.textDocuments) {
      scheduleIndex(doc);
    }

    const mode = vscode.workspace.getConfiguration('smartAutocomplete').get<string>('mode', 'inline');
    log(`Activated. Dictionary: ${dict.size} entries. Mode: ${mode}. File: ${file}`);
    void vscode.window.showInformationMessage(
      `Smart Autocomplete: ACTIVATED (dictionary: ${dict.size} entries, mode: ${mode}). ` +
        'Follow activity in View → Output → "Smart Autocomplete".',
    );

    // Стартовый фоновый скан воркспейса — с задержкой, чтобы не конкурировать
    // с загрузкой окна, и полностью защищён от ошибок.
    const startedAt = Date.now();
    setTimeout(() => {
      void scanWorkspace(dict, true)
        .then((scanned) => {
          dict.flush();
          updateStatus();
          log(`Initial scan done: ${scanned} files in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, dictionary size ${dict.size}.`);
        })
        .catch((e) => log(`Initial scan failed: ${e}`));
    }, 3000);
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log(`ACTIVATION FAILED: ${msg}`);
    void vscode.window.showErrorMessage(
      `Smart Autocomplete failed to activate: ${err instanceof Error ? err.message : String(err)}. ` +
        'Open View → Output → "Smart Autocomplete" for details.',
    );
  }
}

/**
 * Отключает/восстанавливает автопоказ встроенного IntelliSense
 * (editor.quickSuggestions = false), пока включён inline-режим и
 * suppressBuiltInSuggest. Трогает только ГЛОБАЛЬНЫЕ настройки — никогда
 * не пишет в .vscode/settings.json проекта.
 *
 * Вход: ничего (читает настройки smartAutocomplete).
 * Возвращает: ничего; результат операции пишется в Output-канал.
 */
function manageBuiltInSuggest(): void {
  const cfg = vscode.workspace.getConfiguration('smartAutocomplete');
  const enabled = cfg.get<boolean>('enabled', true);
  const mode = cfg.get<string>('mode', 'inline');
  const suppress = cfg.get<boolean>('suppressBuiltInSuggest', false);

  const editorCfg = vscode.workspace.getConfiguration('editor');
  const current = editorCfg.get('quickSuggestions');

  if (enabled && mode === 'inline' && suppress) {
    if (current !== false) {
      savedQuickSuggestions = JSON.stringify(current);
      void editorCfg
        .update('quickSuggestions', false, vscode.ConfigurationTarget.Global)
        .then(
          () =>
            log(
              'Built-in auto-suggest SUPPRESSED (editor.quickSuggestions=false, global). ' +
                'Built-in IntelliSense will not pop up while typing (Ctrl+Space still works).',
            ),
          (e) => log(`Failed to suppress built-in suggestions: ${e}`),
        );
    }
  } else if (savedQuickSuggestions !== undefined) {
    const previous = JSON.parse(savedQuickSuggestions);
    savedQuickSuggestions = undefined;
    if (current === false) {
      void editorCfg
        .update('quickSuggestions', previous, vscode.ConfigurationTarget.Global)
        .then(
          () => log('Built-in auto-suggest RESTORED (editor.quickSuggestions).'),
          (e) => log(`Failed to restore editor.quickSuggestions: ${e}`),
        );
    }
  }
}

/**
 * Показывает топ-200 имён словаря со статистикой в QuickPick.
 *
 * Вход: dict — словарь. Возвращает: Promise (завершается после выбора/закрытия).
 */
async function showStats(dict: Dictionary): Promise<void> {
  const items = dict.top(200).map((e) => ({
    label: e.name,
    description: e.kind,
    detail: `uses: ${e.uses} · seen: ${e.count}${
      e.lastUsed > 0 ? ` · last: ${new Date(e.lastUsed).toLocaleString()}` : ''
    }`,
  }));
  await vscode.window.showQuickPick(items, {
    title: 'Smart Autocomplete — identifier statistics (top 200)',
    placeHolder: 'score = uses × 10 + seen',
  });
}
