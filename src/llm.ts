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

/** Параметры подключения к локальному LLM-серверу. */
export interface LlmConfig {
  backend: 'ollama' | 'openai';
  url: string;
  model: string;
  timeoutMs: number;
}

/** Готовый промпт для LLM. */
export interface LlmPrompt {
  system: string;
  user: string;
}

/**
 * Собирает промпт: системная инструкция + последние строки кода, набранный
 * префикс и список кандидатов. Модель должна ответить JSON
 * {"completions": [...]}.
 *
 * Вход: prefix — набранный префикс, candidates — кандидаты из словаря,
 * context — последние строки кода, topN — сколько вариантов запросить.
 * Возвращает: объект LlmPrompt.
 */
export function buildPrompt(
  prefix: string,
  candidates: string[],
  context: string,
  topN: number,
): LlmPrompt {
  const system = [
    'You are a code autocomplete engine inside a code editor.',
    'You are given: the last few lines of code, the prefix the developer is typing, and a list of candidate identifiers.',
    'Return the most likely candidate identifiers (at most the requested number) that the developer wants to type next, ordered by likelihood.',
    'Rules: use ONLY identifiers from the candidate list; every returned identifier must start with the typed prefix (case-insensitive); never invent new identifiers.',
    'Respond with a single valid JSON object and nothing else: {"completions":["a","b","c"]}',
  ].join(' ');

  const user = [
    `Recent code:`,
    context || '(no context)',
    ``,
    `Typed prefix: "${prefix}"`,
    ``,
    `Candidate identifiers:`,
    candidates.join(', '),
    ``,
    `Return the top ${topN} most likely candidates as JSON.`,
  ].join('\n');

  return { system, user };
}

/**
 * Достаёт массив имён из (возможно «шумного») ответа модели: ищет JSON-
 * объект/массив и разбирает поле completions.
 *
 * Вход: text — сырой ответ LLM. Возвращает: массив строк (до 10), пустой
 * при нераспознаваемом ответе.
 */
export function parseCompletions(text: string): string[] {
  const cleaned = text.trim();
  const fragments = [
    cleaned.match(/\{[\s\S]*\}/)?.[0],
    cleaned.match(/\[[\s\S]*\]/)?.[0],
  ].filter((s): s is string => Boolean(s));

  for (const fragment of fragments) {
    try {
      const obj: unknown = JSON.parse(fragment);
      const arr: unknown = Array.isArray(obj)
        ? obj
        : (obj as { completions?: unknown }).completions;
      if (Array.isArray(arr)) {
        return arr
          .map((x) => String(x).trim())
          .filter((x) => x.length > 0)
          .slice(0, 10);
      }
    } catch {
      // пробуем следующий фрагмент
    }
  }
  return [];
}

/**
 * Вызывает локальный LLM и возвращает ранжированный список имён.
 *
 * Вход: cfg — параметры сервера, prompt — промпт, signal — токен отмены
 * (новый символ / закрытие виджета).
 * Возвращает: Promise с массивом имён; при сетевой ошибке, HTTP-ошибке или
 * таймауте — отбрасывает исключение (вызовчик включает частотный fallback).
 */
export async function queryLlm(
  cfg: LlmConfig,
  prompt: LlmPrompt,
  signal?: AbortSignal,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const base = cfg.url.replace(/\/+$/, '');
    let url: string;
    let body: Record<string, unknown>;
    if (cfg.backend === 'ollama') {
      url = `${base}/api/generate`;
      body = {
        model: cfg.model,
        prompt: prompt.user,
        system: prompt.system,
        stream: false,
        options: { temperature: 0, num_predict: 120 },
      };
    } else {
      url = `${base}/v1/chat/completions`;
      body = {
        model: cfg.model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      response?: unknown;
      choices?: { message?: { content?: unknown } }[];
    };
    const text: unknown =
      cfg.backend === 'ollama' ? data.response : data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      return [];
    }
    return parseCompletions(text);
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}
