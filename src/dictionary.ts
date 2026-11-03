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

import * as fs from 'fs';
import * as path from 'path';

/** Тип идентификатора в словаре. */
export type NameKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'struct'
  | 'function'
  | 'method'
  | 'variable'
  | 'property'
  | 'keyword';

/** Запись словаря: имя и статистика. */
export interface DictEntry {
  name: string;
  kind: NameKind;
  /** сколько раз имя встречалось в исходниках воркспейса */
  count: number;
  /** сколько раз пользователь его реально использовал */
  uses: number;
  /** время последнего использования (мс), 0 — никогда */
  lastUsed: number;
}

const USE_WEIGHT = 10;
/** Жёсткий предел размера словаря (защита на очень больших воркспейсах). */
const MAX_ENTRIES = 200_000;

/**
 * Считает приоритет записи: использование пользователем важнее
 * встречаемости в коде.
 *
 * Вход: e — запись словаря. Возвращает: число (больше — лучше).
 */
export function entryScore(e: DictEntry): number {
  return e.uses * USE_WEIGHT + e.count;
}

/**
 * Персистентный словарь всех известных имён («библиотека» плагина).
 * Хранится как JSON в глобальном хранилище расширения, запись на диск
 * дебаунсится (2 с).
 */
export class Dictionary {
  private readonly entries = new Map<string, DictEntry>();
  private saveTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  /**
   * Создаёт словарь и загружает его из файла (если есть).
   *
   * Вход: file — путь к JSON-файлу словаря. Возвращает: ничего.
   */
  constructor(private readonly file: string) {
    this.load();
  }

  /**
   * Читает словарь из JSON-файла; при отсутствии/повреждении — пустой.
   *
   * Вход: ничего. Возвращает: ничего.
   */
  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data: unknown = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item === 'object' && typeof (item as DictEntry).name === 'string') {
            const e = item as DictEntry;
            this.entries.set(e.name, {
              name: e.name,
              kind: typeof e.kind === 'string' ? e.kind : 'variable',
              count: Number(e.count) || 0,
              uses: Number(e.uses) || 0,
              lastUsed: Number(e.lastUsed) || 0,
            });
          }
        }
      }
    } catch {
      this.entries.clear();
    }
  }

  /**
   * Планирует запись на диск через 2 с (повторные вызовы объединяются).
   *
   * Вход: ничего. Возвращает: ничего.
   */
  scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, 2000);
  }

  /**
   * Немедленно записывает словарь в файл (если были изменения).
   *
   * Вход: ничего. Возвращает: ничего.
   */
  flush(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify([...this.entries.values()]));
    } catch {
      this.dirty = true;
    }
  }

  /**
   * Проверка, можно ли добавлять новые записи (лимит размера).
   *
   * Вход: ничего. Возвращает: true, если словарь ещё не достиг предела.
   */
  private canGrow(): boolean {
    return this.entries.size < MAX_ENTRIES;
  }

  /**
   * Добавляет запись, если её ещё нет (используется для сид-словаря).
   *
   * Вход: name — имя, kind — тип. Возвращает: ничего.
   */
  ensure(name: string, kind: NameKind): void {
    if (!this.entries.has(name) && this.canGrow()) {
      this.entries.set(name, { name, kind, count: 1, uses: 0, lastUsed: 0 });
      this.scheduleSave();
    }
  }

  /**
   * Увеличивает счётчик встречаемости имени в исходниках.
   *
   * Вход: name — имя, kind — тип, weight — сколько раз встретилось (1 по
   * умолчанию). Возвращает: ничего.
   */
  add(name: string, kind: NameKind, weight = 1): void {
    const e = this.entries.get(name);
    if (e) {
      e.count += weight;
    } else if (this.canGrow()) {
      this.entries.set(name, { name, kind, count: weight, uses: 0, lastUsed: 0 });
    }
    this.scheduleSave();
  }

  /**
   * Фиксирует, что пользователь использовал имя (принятая подсказка,
   * вставка).
   *
   * Вход: name — имя. Возвращает: ничего.
   */
  recordUse(name: string): void {
    const now = Date.now();
    const e = this.entries.get(name);
    if (e) {
      e.uses += 1;
      e.lastUsed = now;
    } else if (this.canGrow()) {
      this.entries.set(name, { name, kind: 'variable', count: 1, uses: 1, lastUsed: now });
    }
    this.scheduleSave();
  }

  /**
   * Возвращает запись по имени.
   *
   * Вход: name — имя. Возвращает: запись или undefined.
   */
  get(name: string): DictEntry | undefined {
    return this.entries.get(name);
  }

  /** Размер словаря (число записей). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Топ записей по приоритету.
   *
   * Вход: max — сколько взять. Возвращает: отсортированный массив записей.
   */
  top(max: number): DictEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => entryScore(b) - entryScore(a))
      .slice(0, max);
  }

  /**
   * Отсеивает записи по префиксу (без учёта регистра), опционально по
   * типам, сортирует по приоритету.
   *
   * Вход: prefix — префикс, max — лимит, kinds — опциональный набор типов.
   * Возвращает: отсортированный массив записей, не более max.
   */
  filter(prefix: string, max: number, kinds?: NameKind[]): DictEntry[] {
    const p = prefix.toLowerCase();
    const out: DictEntry[] = [];
    for (const e of this.entries.values()) {
      if (kinds && !kinds.includes(e.kind)) {
        continue;
      }
      if (p && !e.name.toLowerCase().startsWith(p)) {
        continue;
      }
      out.push(e);
    }
    out.sort((a, b) => entryScore(b) - entryScore(a));
    return out.slice(0, max);
  }

  /**
   * Обнуляет статистику использования (uses, lastUsed); встречаемость в
   * коде (count) сохраняется.
   *
   * Вход: ничего. Возвращает: ничего.
   */
  resetUsage(): void {
    for (const e of this.entries.values()) {
      e.uses = 0;
      e.lastUsed = 0;
    }
    this.scheduleSave();
  }

  /**
   * Полностью очищает словарь.
   *
   * Вход: ничего. Возвращает: ничего.
   */
  clear(): void {
    this.entries.clear();
    this.scheduleSave();
  }
}
