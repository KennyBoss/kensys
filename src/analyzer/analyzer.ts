import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { FileAnalysis, ProjectCodex, Feature, DependencyGraph, DependencyNode, DependencyEdge, SearchIndex, Function, CodeQuality, CodeIssue, ProjectPassport, ProjectEntry, ProjectArchitecture } from '../models/types';
import JavaScriptParser from '../parser/js-parser';
import EntityMapper, { type DataCatalog } from './entity-mapper';

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

    // Генерируем проектный паспорт для AI
    const passport = this.generateProjectPassport(projectName, features, quality);

    // Анализируем типы данных - выкладываем ВСЕ как есть!
    const entityMapper = new EntityMapper();
    const dataCatalog = entityMapper.analyzeEntities(this.allFiles);

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
      passport,
      dataCatalog,
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
   * Возвращает встроенные функции и методы которые не нужно анализировать
   */
  private getBuiltInFunctions(): Set<string> {
    return new Set([
      // Global constructors and functions
      'console', 'JSON', 'Math', 'Date', 'Array', 'Object', 'String', 'Number',
      'Boolean', 'Symbol', 'WeakMap', 'WeakSet', 'Map', 'Set', 'Promise',
      'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
      'URIError', 'EvalError', 'AggregateError',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'encodeURI',
      'encodeURIComponent', 'decodeURIComponent',
      'eval', 'fetch', 'alert', 'confirm', 'prompt', 'Buffer', 'process',
      'global', 'globalThis', 'Infinity', 'undefined',

      // Common console methods
      'log', 'error', 'warn', 'info', 'debug', 'assert', 'trace', 'group',
      'groupEnd', 'groupCollapsed', 'table', 'time', 'timeEnd', 'profile',
      'profileEnd', 'count', 'clear', 'dir', 'dirxml',

      // Array methods
      'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'find', 'findIndex',
      'every', 'some', 'includes', 'indexOf', 'lastIndexOf', 'slice', 'splice',
      'concat', 'join', 'reverse', 'sort', 'push', 'pop', 'shift', 'unshift',
      'fill', 'flat', 'flatMap', 'at', 'copyWithin',

      // String methods
      'charAt', 'charCodeAt', 'codePointAt', 'includes', 'match', 'matchAll',
      'repeat', 'replace', 'replaceAll', 'search', 'split', 'substring', 'substr',
      'toLowerCase', 'toUpperCase', 'toLocaleUpperCase', 'toLocaleLowerCase',
      'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd', 'startsWith', 'endsWith',
      'localeCompare', 'normalize', 'fromCharCode', 'fromCodePoint',

      // Date methods
      'now', 'parse', 'UTC', 'getTime', 'getUTCDate', 'getDay', 'getMonth',
      'getFullYear', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
      'setTime', 'setDate', 'setMonth', 'setFullYear', 'setHours', 'setMinutes',
      'setSeconds', 'setMilliseconds', 'toString', 'toISOString', 'toJSON',
      'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString',

      // JSON methods
      'parse', 'stringify',

      // Math methods
      'abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'cos', 'exp', 'floor',
      'log', 'max', 'min', 'pow', 'random', 'round', 'sin', 'sqrt', 'tan',
      'trunc', 'sign', 'cbrt', 'hypot', 'clz32', 'cosh', 'sinh', 'tanh',

      // Object methods
      'keys', 'values', 'entries', 'assign', 'create', 'defineProperty',
      'defineProperties', 'freeze', 'seal', 'preventExtensions', 'isFrozen',
      'isSealed', 'isExtensible', 'getPrototypeOf', 'setPrototypeOf',
      'getOwnPropertyNames', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors',
      'getOwnPropertySymbols', 'hasOwnProperty', 'propertyIsEnumerable',
      'toString', 'valueOf', 'toLocaleString',

      // Promise methods
      'then', 'catch', 'finally', 'all', 'race', 'allSettled', 'any', 'resolve',
      'reject',

      // Common npm packages and methods
      'require', 'readFile', 'writeFile', 'readFileSync', 'writeFileSync',
      'dirname', 'basename', 'join', 'resolve', 'relative', 'parse', 'format',
      'normalize', 'isAbsolute', 'existsSync', 'stat', 'lstat', 'unlink', 'mkdir',
      'rmdir', 'readdir', 'copyFile', 'rename', 'chmod', 'chown', 'access',
      'listen', 'close', 'send', 'end', 'on', 'emit', 'once', 'off', 'removeListener',
      'connect', 'disconnect', 'save', 'delete', 'create', 'findOne', 'find', 'update',
      'exec', 'run', 'query', 'execute', 'deleteMany', 'all', 'hash', 'render',
      'next', 'use', 'get', 'post', 'put', 'patch', 'delete', 'router',
      'status', 'json', 'send', 'redirect', 'render', 'sendFile', 'sendStatus',
      'cookie', 'clearCookie', 'header', 'set', 'getHeader', 'setHeader',

      // chalk color methods
      'cyan', 'red', 'green', 'yellow', 'blue', 'magenta', 'white', 'gray', 'black',
      'bgCyan', 'bgRed', 'bgGreen', 'bgYellow', 'bgBlue', 'bgMagenta', 'bgWhite',
      'bold', 'dim', 'italic', 'underline', 'inverse', 'hidden', 'strikethrough',

      // process and stream methods
      'exit', 'cwd', 'chdir', 'getenv', 'putenv', 'unsetenv', 'kill', 'uptime',
      'stdin', 'stdout', 'stderr', 'argv', 'env', 'platform', 'arch', 'version',

      // Map/Set/Object methods
      'has', 'get', 'set', 'add', 'delete', 'clear', 'size', 'forEach',

      // Prisma methods
      'findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert',
      'delete', 'deleteMany', 'createMany', 'updateMany', 'aggregate', 'count',
      'groupBy', 'findUniqueOrThrow', 'findFirstOrThrow', '$transaction',
      '$connect', '$disconnect', 'findRaw', 'aggregateRaw', '$queryRaw',
      '$executeRaw', '$on', '$off', '$use',

      // React hooks and methods
      'useState', 'useEffect', 'useContext', 'useReducer', 'useRef', 'useCallback',
      'useMemo', 'useLayoutEffect', 'useDebugValue', 'useImperativeHandle',
      'preventDefault', 'stopPropagation', 'stopImmediatePropagation',
      'toString', 'valueOf',

      // i18n translation methods
      't', 'i18n', 'i18next',

      // RegExp methods
      'test', 'exec', 'compile', 'source', 'flags', 'global', 'ignoreCase',
      'multiline', 'dotAll', 'unicode', 'sticky', 'lastIndex',

      // Number methods
      'toFixed', 'toExponential', 'toPrecision', 'toLocaleString',
      'valueOf', 'toString',

      // Date methods extended
      'getDate', 'getMonth', 'getFullYear', 'getTime', 'getDay',
      'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
      'getUTCDate', 'getUTCMonth', 'getUTCFullYear', 'getUTCDay',
      'getUTCHours', 'getUTCMinutes', 'getUTCSeconds', 'getUTCMilliseconds',
      'toDateString', 'toTimeString', 'toISOString', 'toLocaleString',
      'toLocaleDateString', 'toLocaleTimeString',

      // localStorage/sessionStorage
      'localStorage', 'sessionStorage', 'setItem', 'getItem', 'removeItem',
      'clear', 'key',

      // Common function parameters that look like calls
      'fn', 'callback', 'handler', 'onSuccess', 'onError', 'onComplete',
      'onClose', 'onOpen', 'onSubmit', 'onChange', 'onClick', 'onBidPlaced',
      'onAccept', 'onReject', 'e', 'event', 'err',
    ]);
  }

  /**
   * Проверяет если это обычное имя метода (типа "delete", "save", "create")
   * которое вызывается на объектах а не как отдельная функция
   */
  private isCommonMethodName(funcName: string): boolean {
    const commonMethods = new Set([
      'delete', 'save', 'create', 'update', 'remove', 'destroy', 'find',
      'findOne', 'findAll', 'get', 'set', 'add', 'remove', 'clear',
      'init', 'close', 'open', 'read', 'write', 'parse', 'serialize',
      'validate', 'check', 'verify', 'authenticate', 'authorize',
    ]);
    return commonMethods.has(funcName);
  }

  /**
   * Генерирует проектный паспорт для быстрого понимания проекта AI
   */
  private generateProjectPassport(
    projectName: string | undefined,
    features: Feature[],
    quality: CodeQuality
  ): ProjectPassport {
    const name = projectName || 'Unknown Project';
    const allFunctions = this.allFiles.flatMap(f => f.functions);

    // Находим основные модули (файлы с наибольшим количеством функций)
    const mainModules = this.allFiles
      .sort((a, b) => b.functions.length - a.functions.length)
      .slice(0, 5)
      .map(f => path.basename(f.path));

    // Находим entry points (main, index, app, server и т.д.)
    const entryPoints = this.allFiles
      .filter(f => {
        const name = path.basename(f.path).toLowerCase();
        return name === 'index.js' || name === 'index.ts' ||
               name === 'app.js' || name === 'app.ts' ||
               name === 'server.js' || name === 'server.ts' ||
               name === 'main.js' || name === 'main.ts';
      })
      .map(f => path.basename(f.path));

    // Определяем слои архитектуры (src/models, src/services и т.д.)
    const layerMap = new Map<string, string[]>();
    for (const file of this.allFiles) {
      const parts = file.path.split(path.sep);
      const srcIndex = parts.indexOf('src');
      if (srcIndex !== -1 && srcIndex + 1 < parts.length) {
        const layer = parts[srcIndex + 1];
        if (!layerMap.has(layer)) {
          layerMap.set(layer, []);
        }
        layerMap.get(layer)!.push(path.basename(file.path));
      }
    }

    // Находим критические функции (вызываются часто или в основных модулях)
    const functionCallCount = new Map<string, number>();
    for (const file of this.allFiles) {
      for (const func of file.functions) {
        functionCallCount.set(func.name, (functionCallCount.get(func.name) || 0) + func.calls.length);
      }
    }

    const criticalFunctions: ProjectEntry[] = Array.from(functionCallCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, calls]) => {
        const func = allFunctions.find(f => f.name === name);
        return {
          type: 'function',
          name,
          description: func?.logic || `Function with ${calls} dependencies`,
          location: func?.location.file || 'unknown',
          dependencies: func?.calls || [],
          importance: calls > 10 ? 'critical' : calls > 5 ? 'high' : 'medium',
        };
      });

    // Ключевые модули
    const keyModules: ProjectEntry[] = this.allFiles
      .sort((a, b) => b.functions.length - a.functions.length)
      .slice(0, 5)
      .map(file => ({
        type: 'module',
        name: path.basename(file.path),
        description: `Module with ${file.functions.length} functions and ${file.classes.length} classes`,
        location: file.path,
        dependencies: [...new Set(file.functions.flatMap(f => f.calls))],
        importance: file.functions.length > 10 ? 'critical' : file.functions.length > 5 ? 'high' : 'medium',
      }));

    // Предупреждения
    const warnings: string[] = [];
    if (quality.todoCount > 0) {
      warnings.push(`⚠️ ${quality.todoCount} TODO comments found`);
    }
    if (quality.fixmeCount > 0) {
      warnings.push(`⚠️ ${quality.fixmeCount} FIXME comments found`);
    }
    const missingFuncCount = quality.issues.filter(i => i.type === 'missing-function').length;
    if (missingFuncCount > 0) {
      warnings.push(`⚠️ ${missingFuncCount} missing functions detected`);
    }
    if (quality.functionsWithDocstring < allFunctions.length * 0.5) {
      warnings.push(`⚠️ Less than 50% of functions have documentation`);
    }

    // Советы
    const tips: string[] = [
      `📌 Start with entry points: ${entryPoints.join(', ') || 'index.js/main.js'}`,
      `📦 Main modules: ${mainModules.join(', ')}`,
      `🔍 Total functions: ${allFunctions.length}, Classes: ${this.allFiles.flatMap(f => f.classes).length}`,
      `✅ Error handling coverage: ${Math.round((quality.functionsWithErrorHandling / allFunctions.length) * 100)}%`,
    ];

    return {
      projectName: name,
      summary: `${name} - ${features.length} features, ${allFunctions.length} functions, ${features.reduce((sum, f) => sum + f.files.length, 0)} files`,
      language: this.detectLanguage(),
      filesAnalyzed: this.allFiles.length,
      architecture: {
        mainModules,
        entryPoints,
        layerStructure: Object.fromEntries(layerMap),
        dependencies: {},
      },
      criticalFunctions,
      keyModules,
      warnings,
      tips,
    };
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

    // Встроенные функции и методы которые не нужно анализировать
    const builtInFunctions = this.getBuiltInFunctions();

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
          // Пропускаем встроенные функции и методы
          if (builtInFunctions.has(calledFunc)) continue;

          // Пропускаем функции из импортов (точное совпадение имени)
          if (file.imports.some(i => i.name === calledFunc)) continue;

          // Пропускаем функции из импортов если это namespace import (X.method где X импортирован)
          const methodBase = calledFunc.split('.')[0];
          if (file.imports.some(i => {
            // Обычный namespace: chalk.red где chalk импортирован
            if (i.name === methodBase) return true;
            // Скомпилированный TypeScript: types_1.ApiError где types_1 это результат require
            if (i.name.split('_')[0] === methodBase.split('_')[0]) return true;
            return false;
          })) continue;

          // Пропускаем обычные методы объектов
          if (this.isCommonMethodName(calledFunc)) continue;

          // Проверяем если функция реально реализована
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
