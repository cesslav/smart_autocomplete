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
import { Dictionary, DictEntry, NameKind } from './dictionary';
import { getContext } from './context';
import { buildPrompt, queryLlm, LlmConfig } from './llm';
import { log } from './log';

/** Типы словарных записей, подходящие для дополнения после `.` (обращение к члену). */
const MEMBER_KINDS: NameKind[] = ['method', 'property', 'function'];

/**
 * Результат конвейера автодополнения.
 *
 * Поля: entries — ранжированные кандидаты; viaLlm — ранжировал ли их LLM
 * (false — fallback по частоте использования); prefix — набранный префикс
 * (пустой для обращения вида `obj.`).
 */
export interface EngineResult {
  entries: DictEntry[];
  viaLlm: boolean;
  prefix: string;
}

/**
 * Общий конвейер автодополнения, используемый и ghost-text провайдером,
 * и провайдером выпадающего списка:
 *
 *   префикс -> отсев по префиксу в словаре -> пауза debounceMs -> локальная
 *   LLM -> ранжированный список (или частотный список, если LLM недоступна).
 *
 * Каждый новый символ отменяет предыдущий незавершённый запрос к LLM, а два
 * одновременных вызова для одной и той же позиции (ghost + список)
 * консолидируются в один, чтобы не дублировать запрос к модели.
 */
export class SmartEngine {
  private pending: AbortController | null = null;
  private inflight: Promise<EngineResult | null> | null = null;
  private inflightKey: string | null = null;

  /**
   * Создаёт движок, привязанный к словарю.
   *
   * Вход: dict — словарь имён со статистикой использования.
   * Возвращает: ничего (конструктор).
   */
  constructor(private readonly dict: Dictionary) {}

  /**
   * Определяет набранный префикс до курсора.
   *
   * Вход: document — документ, position — позиция курсора.
   * Возвращает: объект { prefix, memberAccess }, где prefix — слово (или часть
   * имени после `.`), memberAccess — истинно, если курсор после `.`.
   */
  readPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { prefix: string; memberAccess: boolean } {
    const before = document.lineAt(position.line).text.slice(0, position.character);
    const dot = before.match(/\.([A-Za-z_$][\w$]*)?$/);
    if (dot) {
      return { prefix: dot[1] ?? '', memberAccess: true };
    }
    const word = before.match(/([A-Za-z_$][\w$]*)$/);
    return { prefix: word ? word[1] : '', memberAccess: false };
  }

  /**
   * Выполняет полный конвейер: отсев кандидатов, debounce, запрос к LLM.
   *
   * Вход: document — документ, position — позиция курсора, token — токен
   * отмены. Повторный вызов для той же позиции возвращает тот же промис
   * (консолидация), новый набор символов отменяет предыдущий запрос.
   * Возвращает: Promise с ранжированными кандидатами или null, если
   * дополнять нечего. При недоступности LLM возвращает частотный список
   * (viaLlm = false).
   */
  complete(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<EngineResult | null> {
    const cfg = vscode.workspace.getConfiguration('smartAutocomplete');
    if (!cfg.get<boolean>('enabled', true)) {
      return Promise.resolve(null);
    }

    // Консолидация: ghost-text и выпадающий список вызывают конвейер для
    // одной позиции одновременно — выполняем один запрос, а не два.
    const key = `${document.uri.toString()}|${document.version}|${position.line}:${position.character}`;
    if (this.inflight && this.inflightKey === key) {
      return this.inflight;
    }

    const { prefix, memberAccess } = this.readPrefix(document, position);
    if (!prefix && !memberAccess) {
      return Promise.resolve(null);
    }

    const maxCandidates = cfg.get<number>('maxCandidates', 30);
    const entries: DictEntry[] = memberAccess
      ? this.dict.filter(prefix, Math.min(maxCandidates, 40), MEMBER_KINDS)
      : this.dict.filter(prefix, maxCandidates);
    if (entries.length === 0) {
      return Promise.resolve(null);
    }

    // Новый набор символов отменяет предыдущий незавершённый запрос к LLM.
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const signal = controller.signal;

    const debounceMs = cfg.get<number>('debounceMs', 300);
    const topN = cfg.get<number>('topN', 5);
    const llmCfg: LlmConfig = {
      backend: cfg.get<string>('backend', 'ollama') as LlmConfig['backend'],
      url: cfg.get<string>('llmUrl', 'http://localhost:11434'),
      model: cfg.get<string>('llmModel', 'qwen2.5-coder:1.5b'),
      timeoutMs: cfg.get<number>('llmTimeoutMs', 2500),
    };
    const fallback: EngineResult = { entries, viaLlm: false, prefix };

    const promise = new Promise<EngineResult | null>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const cancelSub = token.onCancellationRequested(() => finish(null));

      /**
       * Финализирует промис ровно один раз (защита от гонки
       * таймер/отмена/ответ LLM).
       *
       * Вход: result — результат или null. Возвращает: ничего.
       */
      const finish = (result: EngineResult | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        cancelSub.dispose();
        resolve(result);
      };

      timer = setTimeout(() => {
        if (signal.aborted) {
          finish(null);
          return;
        }
        void (async () => {
          try {
            const startedAt = Date.now();
            log(
              `LLM request: prefix="${prefix}" candidates=${entries.length} ` +
                `model=${llmCfg.model} @ ${llmCfg.url} (timeout ${llmCfg.timeoutMs}ms)`,
            );
            const context = getContext(document, position, cfg.get<number>('contextLines', 8));
            const prompt = buildPrompt(prefix, entries.map((e) => e.name), context, topN);
            const ranked = await queryLlm(llmCfg, prompt, signal);
            const elapsed = Date.now() - startedAt;
            if (signal.aborted || token.isCancellationRequested) {
              finish(null);
              return;
            }
            const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
            const picked: DictEntry[] = [];
            for (const name of ranked) {
              const e = byName.get(name.toLowerCase());
              if (e && !picked.includes(e)) {
                picked.push(e);
              }
            }
            if (picked.length > 0) {
              log(`LLM ok in ${elapsed}ms: [${picked.map((e) => e.name).join(', ')}]`);
              finish({ entries: picked, viaLlm: true, prefix });
            } else {
              log(`LLM responded in ${elapsed}ms but returned no valid candidates — showing frequency ranking.`);
              finish(fallback);
            }
          } catch (err) {
            if (signal.aborted || token.isCancellationRequested) {
              finish(null);
              return;
            }
            const reason =
              err instanceof Error
                ? err.name === 'AbortError'
                  ? `timeout ${llmCfg.timeoutMs}ms`
                  : err.message
                : String(err);
            log(`LLM unavailable (${reason}) — showing frequency ranking.`);
            finish(fallback);
          }
        })();
      }, debounceMs);
    });

    this.inflight = promise;
    this.inflightKey = key;
    void promise.then(() => {
      if (this.inflight === promise) {
        this.inflight = null;
        this.inflightKey = null;
      }
    });
    return promise;
  }
}
