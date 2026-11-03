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
import { Dictionary, NameKind } from './dictionary';

const MAX_FILES = 4000;
const MAX_FILE_BYTES = 1024 * 1024;

/** Маска поиска исходников в воркспейсе. */
const GLOB =
  '**/*.{ts,tsx,js,jsx,mjs,cjs,py,java,go,rs,cpp,cc,cxx,c,h,hpp,hh,hxx,cs,php,rb,kt,kts,swift,scala,groovy,vue,svelte,sh,bat,ps1,sql,graphql,html,css,scss,less,json,yaml,toml,xml}';

/** Папки, которые не сканируются. */
const EXCLUDE =
  '**/{node_modules,.git,.hg,.svn,dist,build,out,target,bin,obj,venv,.venv,__pycache__,.next,.nuxt,.cache,.idea,.vscode,coverage,vendor,pods}/**';

/** Паттерн извлечения имён: регулярка + тип записи. */
interface Pattern {
  re: RegExp;
  kind: NameKind;
}

/**
 * Регулярные паттерны извлечения имён из исходников: объявления
 * классов/интерфейсов/функций/переменных и вызовы методов `.name()`.
 */
const PATTERNS: Pattern[] = [
  { re: /\bclass\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /\binterface\s+([A-Za-z_$][\w$]*)/g, kind: 'interface' },
  { re: /\b(?:struct|protocol|trait)\s+([A-Za-z_$][\w$]*)/g, kind: 'struct' },
  { re: /\benum\s+([A-Za-z_$][\w$]*)/g, kind: 'enum' },
  { re: /\btype\s+([A-Za-z_$][\w$]*)\s*[=<]/g, kind: 'type' },
  { re: /\btypedef\s+(?:struct\s+)?([A-Za-z_$][\w$]*)/g, kind: 'type' },
  { re: /\bfunction\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /\b(?:def|fn|func)\s+([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /\b(?:const|let)\s+([A-Za-z_$][\w$]*)/g, kind: 'variable' },
  { re: /\b(?:val|var)\s+([A-Za-z_]\w*)/g, kind: 'variable' },
  { re: /^[ \t]*([A-Za-z_]\w*)\s*=(?!=)/gm, kind: 'variable' },
  { re: /\.\s*([A-Za-z_$][\w$]*)\s*\(/g, kind: 'method' },
];

/**
 * Извлекает имена из куска исходного текста и добавляет их в словарь со
 * счётчиком встречаемости.
 *
 * Вход: dict — словарь, text — текст файла. Возвращает: ничего.
 */
export function scanText(dict: Dictionary, text: string): void {
  for (const p of PATTERNS) {
    try {
      p.re.lastIndex = 0;
      const counts = new Map<string, number>();
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(text)) !== null) {
        const name = m[1];
        if (name) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      for (const [name, c] of counts) {
        dict.add(name, p.kind, c);
      }
    } catch {
      // некорректный кусок текста не должен ломать индексирование
    }
  }
}

/**
 * Сканирует весь воркспейс (с ограничениями по числу файлов и размеру)
 * и пополняет словарь.
 *
 * Вход: dict — словарь, silent — без всплывающего прогресс-индикатора
 * (true при фоновом скане на активации).
 * Возвращает: Promise с числом просканированных файлов.
 */
export async function scanWorkspace(dict: Dictionary, silent: boolean): Promise<number> {
  const run = async (report: (message: string) => void): Promise<number> => {
    const files = await vscode.workspace.findFiles(GLOB, EXCLUDE, MAX_FILES);
    let scanned = 0;
    for (const file of files) {
      report(`Scanning ${vscode.workspace.asRelativePath(file)} (${scanned + 1}/${files.length})`);
      try {
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }
        const bytes = await vscode.workspace.fs.readFile(file);
        const text = new TextDecoder('utf-8').decode(bytes);
        scanText(dict, text);
        scanned += 1;
      } catch {
        // нечитаемый файл — пропускаем
      }
    }
    return scanned;
  };

  if (silent) {
    return run(() => undefined);
  }
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Smart Autocomplete',
      cancellable: false,
    },
    (progress) => run((message) => progress.report({ message })),
  );
}
