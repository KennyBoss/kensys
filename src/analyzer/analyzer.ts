import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { FileAnalysis, ProjectCodex, Feature, DependencyGraph, DependencyNode, DependencyEdge, SearchIndex, Function } from '../models/types';
import JavaScriptParser from '../parser/js-parser';

export class ProjectAnalyzer {
  private parser: JavaScriptParser;
  private allFiles: FileAnalysis[] = [];

  constructor() {
    this.parser = new JavaScriptParser();
  }

  /**
   * Анализирует весь проект и создаёт codex
   */
  async analyzeProject(rootPath: string, projectName?: string): Promise<ProjectCodex> {
    console.log(`📂 Анализирую проект: ${rootPath}`);

    // Находим все файлы проекта
    const files = await this.findProjectFiles(rootPath);
    console.log(`📄 Найдено файлов: ${files.length}`);

    // Парсим каждый файл
    for (const filePath of files) {
      try {
        const analysis = this.parser.parse(filePath);
        this.allFiles.push(analysis);
      } catch (error) {
        console.warn(`⚠️ Ошибка парсинга ${filePath}:`, error);
      }
    }

    console.log(`✅ Спарсено файлов: ${this.allFiles.length}`);

    // Анализируем зависимости
    this.analyzeCallDependencies();

    // Создаём фичи
    const features = this.createFeatures();

    // Создаём граф зависимостей
    const dependencies = this.buildDependencyGraph();

    // Создаём индекс поиска
    const searchIndex = this.createSearchIndex();

    const allFunctions = this.allFiles.flatMap(f => f.functions);
    const allClasses = this.allFiles.flatMap(f => f.classes);

    return {
      projectName: projectName || path.basename(rootPath),
      rootPath,
      language: this.detectLanguage(),
      filesAnalyzed: this.allFiles.length,
      features,
      allFunctions,
      allClasses,
      dependencies,
      searchIndex,
    };
  }

  /**
   * Находит все файлы проекта (JS, TS, Python и т.д.)
   */
  private async findProjectFiles(rootPath: string): Promise<string[]> {
    const patterns = [
      '**/*.js',
      '**/*.ts',
      '**/*.tsx',
      '**/*.jsx',
      '**/*.py',
      '**/*.go',
      '**/*.java',
    ];

    const ignorePatterns = [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      'build/**',
      '.git/**',
      'coverage/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.min.js',
      '.next/**',
      '.nuxt/**',
    ];

    const files: string[] = [];

    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: rootPath,
        ignore: ignorePatterns,
        absolute: true,
      });
      files.push(...matches);
    }

    return [...new Set(files)].sort();
  }

  /**
   * Анализирует какие функции вызывают какие
   */
  private analyzeCallDependencies(): void {
    const functionMap = new Map<string, Function>();

    // Создаём map всех функций с полным путём
    for (const file of this.allFiles) {
      for (const func of file.functions) {
        const key = `${file.path}:${func.name}`;
        functionMap.set(key, func);
        // Также добавляем по имени (для локальных вызовов)
        functionMap.set(func.name, func);
      }
    }

    // Для каждой функции ищем кто её вызывает
    for (const file of this.allFiles) {
      for (const func of file.functions) {
        for (const [key, calledFunc] of functionMap) {
          if (calledFunc.calls.includes(func.name) && key !== `${file.path}:${func.name}`) {
            if (!func.calledBy) func.calledBy = [];
            func.calledBy.push(calledFunc.name);
          }
        }
      }
    }
  }

  /**
   * Создаёт фичи из анализа кода
   * Фича = группа функций с общей целью
   */
  private createFeatures(): Feature[] {
    const features = new Map<string, Feature>();

    // Простой алгоритм: группируем функции по папкам и именам
    for (const file of this.allFiles) {
      // Извлекаем название папки как фичу
      const relPath = path.relative(process.cwd(), file.path);
      const parts = relPath.split(path.sep);

      // Берём первую папку после src (если есть) или вторую часть
      let featureName = 'common';
      if (parts.length >= 2) {
        if (parts[0] === 'src' && parts[1] !== undefined) {
          featureName = parts[1];
        } else {
          featureName = parts[0];
        }
      }

      featureName = featureName.replace(/\./g, '').toLowerCase();

      if (!features.has(featureName)) {
        features.set(featureName, {
          name: featureName,
          description: `Feature: ${featureName}`,
          functions: [],
          files: [],
          dependencies: [],
        });
      }

      const feature = features.get(featureName)!;
      feature.functions.push(...file.functions);
      feature.files.push(file.path);
    }

    // Анализируем зависимости между фичами
    for (const [name, feature] of features) {
      const deps = new Set<string>();

      for (const func of feature.functions) {
        for (const called of func.calls) {
          // Ищем в каких фичах находится вызываемая функция
          for (const [otherName, otherFeature] of features) {
            if (otherName !== name) {
              if (otherFeature.functions.some(f => f.name === called)) {
                deps.add(otherName);
              }
            }
          }
        }
      }

      feature.dependencies = Array.from(deps);
    }

    return Array.from(features.values());
  }

  /**
   * Строит граф зависимостей
   */
  private buildDependencyGraph(): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];

    // Добавляем все функции как узлы
    for (const file of this.allFiles) {
      for (const func of file.functions) {
        const id = `${func.name}@${file.path}`;
        nodes.set(id, {
          id,
          type: 'function',
          name: func.name,
          file: file.path,
        });

        // Добавляем рёбра для вызовов
        for (const called of func.calls) {
          for (const otherFile of this.allFiles) {
            const otherFunc = otherFile.functions.find(f => f.name === called);
            if (otherFunc) {
              const targetId = `${called}@${otherFile.path}`;
              edges.push({
                from: id,
                to: targetId,
                type: 'calls',
              });
              break;
            }
          }
        }
      }
    }

    return {
      nodes: Object.fromEntries(nodes),
      edges: Array.from(new Set(edges.map(e => JSON.stringify(e)))).map(e => JSON.parse(e)),
    };
  }

  /**
   * Создаёт индекс для быстрого поиска
   */
  private createSearchIndex(): SearchIndex {
    const index: SearchIndex = {
      functions: {},
      classes: {},
      files: {},
      keywords: {},
    };

    // Индекс функций
    for (const file of this.allFiles) {
      index.files[file.path] = file;

      for (const func of file.functions) {
        if (!index.functions[func.name]) {
          index.functions[func.name] = [];
        }
        index.functions[func.name].push(func);

        // Добавляем ключевые слова
        const keywords = func.name.split(/(?=[A-Z])|_/).filter(k => k.length > 0);
        for (const keyword of keywords) {
          if (keyword.length > 2) {
            const keywordLower = keyword.toLowerCase();
            if (!index.keywords[keywordLower]) {
              index.keywords[keywordLower] = [];
            }
            if (!index.keywords[keywordLower].includes(func.name)) {
              index.keywords[keywordLower].push(func.name);
            }
          }
        }
      }

      // Индекс классов
      for (const cls of file.classes) {
        if (!index.classes[cls.name]) {
          index.classes[cls.name] = [];
        }
        index.classes[cls.name].push(cls);
      }
    }

    return index;
  }

  /**
   * Определяет язык проекта
   */
  private detectLanguage(): string {
    const languages = new Set<string>();

    for (const file of this.allFiles) {
      languages.add(file.language);
    }

    return Array.from(languages).join(', ') || 'unknown';
  }
}

export default ProjectAnalyzer;
