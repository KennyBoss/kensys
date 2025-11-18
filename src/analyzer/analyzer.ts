import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { FileAnalysis, ProjectCodex, Feature, DependencyGraph, DependencyNode, DependencyEdge, SearchIndex, Function, CodeQuality, CodeIssue } from '../models/types';
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

    // Анализируем качество кода
    const quality = this.analyzeCodeQuality();

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
      quality,
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

  /**
   * Анализирует качество кода и находит проблемы
   */
  private analyzeCodeQuality(): CodeQuality {
    const issues: CodeIssue[] = [];
    const allFunctions = this.allFiles.flatMap(f => f.functions);
    let functionsWithDocstring = 0;
    let functionsWithErrorHandling = 0;
    let todoCount = 0;
    let fixmeCount = 0;
    const recommendations: string[] = [];

    // Анализируем каждый файл
    for (const file of this.allFiles) {
      const fileContent = fs.readFileSync(file.path, 'utf-8');
      const lines = fileContent.split('\n');

      // 1. Ищем TODO и FIXME комментарии
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('TODO')) {
          todoCount++;
          issues.push({
            type: 'todo',
            severity: 'low',
            location: { file: file.path, line: i + 1 },
            description: `TODO: ${line.trim().substring(0, 80)}`,
          });
        }
        if (line.includes('FIXME')) {
          fixmeCount++;
          issues.push({
            type: 'fixme',
            severity: 'medium',
            location: { file: file.path, line: i + 1 },
            description: `FIXME: ${line.trim().substring(0, 80)}`,
          });
        }
      }

      // 2. Анализируем функции в этом файле
      for (const func of file.functions) {
        // Проверяем документацию
        if (func.docstring && func.docstring.length > 10) {
          functionsWithDocstring++;
        }

        // Проверяем обработку ошибок
        const funcContent = fileContent.substring(0, fileContent.length);
        if (funcContent.includes('try') && funcContent.includes('catch')) {
          functionsWithErrorHandling++;
        }

        // 3. Находим недостающие функции (вызываются но не реализованы)
        for (const calledFunc of func.calls) {
          const isImplemented = allFunctions.some(f => f.name === calledFunc);
          if (!isImplemented) {
            issues.push({
              type: 'missing-function',
              severity: 'high',
              location: func.location,
              description: `Function "${func.name}" calls non-existent function "${calledFunc}"`,
              suggestion: `Implement function "${calledFunc}" or remove this call`,
              affectedFunctions: [func.name],
            });
          }
        }
      }
    }

    // 4. Анализируем риски
    for (const file of this.allFiles) {
      const fileContent = fs.readFileSync(file.path, 'utf-8');

      // Проверяем на потенциально опасные паттерны
      if (
        fileContent.includes('eval(') ||
        fileContent.includes('JSON.parse(') ||
        fileContent.includes('require(')
      ) {
        issues.push({
          type: 'risk',
          severity: 'high',
          location: { file: file.path, line: 1 },
          description: `File contains potentially dangerous patterns (eval, JSON.parse, require)`,
          suggestion: `Review this file for security issues`,
        });
      }

      // Проверяем на отсутствие обработки ошибок
      if (
        fileContent.includes('async') &&
        !fileContent.includes('try') &&
        !fileContent.includes('catch')
      ) {
        issues.push({
          type: 'error-handling',
          severity: 'medium',
          location: { file: file.path, line: 1 },
          description: `Async functions without error handling detected`,
          suggestion: `Add try-catch blocks for async operations`,
        });
      }
    }

    // 5. Генерируем рекомендации
    const docstringPercentage =
      allFunctions.length > 0
        ? Math.round((functionsWithDocstring / allFunctions.length) * 100)
        : 0;

    if (docstringPercentage < 50) {
      recommendations.push(
        `⚠️ Only ${docstringPercentage}% of functions have documentation. Target: 80%+`
      );
    }

    const errorHandlingPercentage =
      allFunctions.length > 0
        ? Math.round((functionsWithErrorHandling / allFunctions.length) * 100)
        : 0;

    if (errorHandlingPercentage < 30) {
      recommendations.push(
        `⚠️ Only ${errorHandlingPercentage}% of functions have error handling. Consider adding try-catch blocks`
      );
    }

    if (todoCount > 10) {
      recommendations.push(
        `⚠️ ${todoCount} TODO comments found. Consider addressing them in future sprints`
      );
    }

    if (issues.filter(i => i.type === 'missing-function').length > 0) {
      recommendations.push(
        `❌ ${issues.filter(i => i.type === 'missing-function').length} missing functions detected. Implement them or remove calls`
      );
    }

    if (allFunctions.length > 100) {
      recommendations.push(
        `💡 Large number of functions (${allFunctions.length}). Consider breaking into smaller modules`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(`✅ Good code quality! Keep up the excellent work!`);
    }

    return {
      totalFunctions: allFunctions.length,
      functionsWithDocstring,
      functionsWithErrorHandling,
      todoCount,
      fixmeCount,
      issues,
      recommendations,
    };
  }
}

export default ProjectAnalyzer;
