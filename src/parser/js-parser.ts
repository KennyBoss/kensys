import * as fs from 'fs';
import * as path from 'path';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { Function, Class, FileAnalysis, ImportExport, CodeLocation } from '../models/types';

export class JavaScriptParser {
  parse(filePath: string): FileAnalysis {
    // Проверяем что это файл, а не директория
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return {
        path: filePath,
        language: 'unknown',
        functions: [],
        classes: [],
        imports: [],
        exports: [],
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    let ast: any;
    try {
      ast = parser.parse(content, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
        ],
      });
    } catch (error) {
      console.warn(`Warning: Failed to parse ${filePath}:`, (error as any).message);
      return {
        path: filePath,
        language: 'javascript',
        functions: [],
        classes: [],
        imports: [],
        exports: [],
      };
    }

    const functions: Function[] = [];
    const classes: Class[] = [];
    const imports: ImportExport[] = [];
    const exports: ImportExport[] = [];

    traverse(ast, {
      FunctionDeclaration: (nodePath: any) => {
        const node = nodePath.node;
        const func = this.extractFunction(node, filePath, content);
        if (func) functions.push(func);
      },
      VariableDeclarator: (nodePath: any) => {
        const node = nodePath.node;
        if (node.init && node.init.type === 'ArrowFunctionExpression' && node.id && node.id.name) {
          const func: Function = {
            name: node.id.name,
            type: 'arrow',
            location: this.getLocation(node.init, filePath),
            params: node.init.params.map((p: any) => p.name || 'arg'),
            isExported: false,
            isAsync: node.init.async,
            calls: this.extractCallsFromText(content, node.init.loc?.start?.line || 0, node.init.loc?.end?.line || 1),
          };
          functions.push(func);
        }
      },
      ClassDeclaration: (nodePath: any) => {
        const node = nodePath.node;
        const cls = this.extractClass(node, filePath, content);
        if (cls) classes.push(cls);
      },
      ImportDeclaration: (nodePath: any) => {
        const node = nodePath.node;
        const source = node.source.value as string;
        node.specifiers.forEach((spec: any) => {
          imports.push({
            name: spec.local?.name || 'default',
            from: source,
            type: spec.type === 'ImportDefaultSpecifier' ? 'default-import' : 'import',
          });
        });
      },
      ExportNamedDeclaration: (nodePath: any) => {
        const node = nodePath.node;
        if (node.specifiers) {
          node.specifiers.forEach((spec: any) => {
            exports.push({
              name: spec.exported?.name || 'default',
              from: node.source?.value || '',
              type: 'export',
            });
          });
        }
      },
    });

    return {
      path: filePath,
      language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript',
      functions,
      classes,
      imports,
      exports,
    };
  }

  private extractFunction(node: any, filePath: string, content: string): Function | null {
    if (!node.id || !node.id.name) return null;

    const lines = content.split('\n');
    const nodeStartLine = node.loc?.start?.line || 0;
    const nodeEndLine = node.loc?.end?.line || nodeStartLine + 5;

    // Извлекаем логику функции (первые 5 строк)
    const logicLines = lines.slice(nodeStartLine - 1, Math.min(nodeEndLine, nodeStartLine + 5));
    const logic = logicLines.join('\n').trim().substring(0, 200);

    const startLine = node.loc?.start?.line || 0;
    const endLine = node.loc?.end?.line || startLine;

    return {
      name: node.id.name,
      type: node.async ? 'async' : 'function',
      location: this.getLocation(node, filePath),
      params: (node.params || []).map((p: any) => p.name || 'arg'),
      isExported: false,
      isAsync: node.async,
      calls: this.extractCallsFromText(content, startLine, endLine),
      logic,
    };
  }

  private extractClass(node: any, filePath: string, content: string): Class | null {
    if (!node.id || !node.id.name) return null;

    const methods: Function[] = [];
    const properties: string[] = [];

    (node.body?.body || []).forEach((item: any) => {
      if (item.type === 'ClassMethod' || item.type === 'ClassPrivateMethod') {
        const method: Function = {
          name: item.key?.name || 'anonymous',
          type: item.async ? 'async' : 'method',
          location: this.getLocation(item, filePath),
          params: (item.params || []).map((p: any) => p.name || 'arg'),
          isExported: false,
          isAsync: item.async,
          calls: this.extractCallsFromText(
            content,
            item.loc?.start?.line || 0,
            item.loc?.end?.line || 0
          ),
        };
        methods.push(method);
      } else if (item.type === 'ClassProperty' || item.type === 'ClassPrivateProperty') {
        properties.push(item.key?.name || 'property');
      }
    });

    return {
      name: node.id.name,
      location: this.getLocation(node, filePath),
      methods,
      properties,
      isExported: false,
    };
  }

  /**
   * Извлекает функции из текста кода (простой парсинг)
   */
  private extractCallsFromText(content: string, startLine: number, endLine: number): string[] {
    const lines = content.split('\n');
    const relevantLines = lines.slice(startLine - 1, endLine);
    const text = relevantLines.join('\n');

    // Простой regex для поиска вызовов функций
    const callPattern = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    const calls: string[] = [];
    let match;

    while ((match = callPattern.exec(text)) !== null) {
      const funcName = match[1];
      // Исключаем ключевые слова
      if (!this.isKeyword(funcName) && !calls.includes(funcName)) {
        calls.push(funcName);
      }
    }

    return calls;
  }

  private isKeyword(word: string): boolean {
    const keywords = [
      'if', 'else', 'for', 'while', 'switch', 'case', 'return', 'break', 'continue',
      'const', 'let', 'var', 'function', 'class', 'new', 'throw', 'try', 'catch',
      'finally', 'typeof', 'instanceof', 'delete', 'void', 'async', 'await',
      'import', 'export', 'from', 'as', 'extends', 'implements', 'interface',
      'enum', 'type', 'namespace', 'declare', 'module', 'require', 'in', 'of'
    ];
    return keywords.includes(word);
  }

  private getLocation(node: any, filePath: string): CodeLocation {
    return {
      file: filePath,
      line: node.loc?.start?.line || 0,
      column: node.loc?.start?.column || 0,
    };
  }
}

export default JavaScriptParser;
