import * as fs from 'fs';
import * as path from 'path';
import type { FileAnalysis, Function } from '../models/types';

/**
 * Простой каталог типа данных - БЕЗ угадывания!
 * Просто выкладываем ВСЕ типы как есть.
 * AI сам разберется что это разное.
 */
export interface DataEntity {
  name: string;
  type: 'interface' | 'type' | 'class' | 'schema';
  fields: Record<string, string>;
  location: string;
  file: string;
  usedIn: string[]; // Где используется этот тип
  line?: number;
}

export interface DataCatalog {
  totalEntities: number;
  entities: DataEntity[];
}

export class EntityMapper {
  /**
   * Анализирует проект и извлекает ВСЕ типы данных
   * БЕЗ попыток объединять или угадывать!
   */
  analyzeEntities(allFiles: FileAnalysis[]): DataCatalog {
    const entities: DataEntity[] = [];

    // Шаг 1: Извлекаем все типы данных
    for (const file of allFiles) {
      const fileContent = fs.readFileSync(file.path, 'utf-8');
      const fileEntities = this.extractEntitiesFromFile(file, fileContent);
      entities.push(...fileEntities);
    }

    // Шаг 2: Для каждого типа находим где он используется
    for (const entity of entities) {
      entity.usedIn = this.findUsages(entity.name, allFiles);
    }

    return {
      totalEntities: entities.length,
      entities,
    };
  }

  /**
   * Извлекает все типы данных из одного файла
   */
  private extractEntitiesFromFile(file: FileAnalysis, content: string): DataEntity[] {
    const entities: DataEntity[] = [];

    // Interface
    const interfaceRegex = /interface\s+(\w+)\s*(?:extends[^{]*)?\{([^}]+)}/g;
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const fields = this.parseFields(body);

      entities.push({
        name,
        type: 'interface',
        fields,
        location: file.path,
        file: path.basename(file.path),
        usedIn: [],
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Type
    const typeRegex = /type\s+(\w+)\s*=\s*\{([^}]+)}/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const fields = this.parseFields(body);

      entities.push({
        name,
        type: 'type',
        fields,
        location: file.path,
        file: path.basename(file.path),
        usedIn: [],
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Class
    const classRegex = /class\s+(\w+)\s*(?:extends[^{]*)?(?:implements[^{]*)?\{([^}]+)}/g;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      const fields = this.parseFields(body);

      entities.push({
        name,
        type: 'class',
        fields,
        location: file.path,
        file: path.basename(file.path),
        usedIn: [],
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Prisma Schema
    if (file.path.endsWith('.prisma')) {
      const modelRegex = /model\s+(\w+)\s*\{([^}]+)}/g;
      while ((match = modelRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];
        const fields = this.parsePrismaFields(body);

        entities.push({
          name,
          type: 'schema',
          fields,
          location: file.path,
          file: path.basename(file.path),
          usedIn: [],
          line: content.substring(0, match.index).split('\n').length,
        });
      }
    }

    return entities;
  }

  /**
   * Парсит поля из типа/интерфейса
   */
  private parseFields(body: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const fieldRegex = /(\w+)\s*:\s*([^;,\n}]+)/g;
    let match;

    while ((match = fieldRegex.exec(body)) !== null) {
      const fieldName = match[1].trim();
      const fieldType = match[2].trim();
      fields[fieldName] = fieldType;
    }

    return fields;
  }

  /**
   * Парсит поля из Prisma схемы
   */
  private parsePrismaFields(body: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const fieldRegex = /(\w+)\s+(\w+[\w\[\]?]*)/g;
    let match;

    while ((match = fieldRegex.exec(body)) !== null) {
      const fieldName = match[1].trim();
      const fieldType = match[2].trim();
      // Пропускаем декораторы типа @id, @unique
      if (!fieldName.startsWith('@')) {
        fields[fieldName] = fieldType;
      }
    }

    return fields;
  }

  /**
   * Находит где используется данный тип
   * Ищет в названиях функций, переменных, параметров
   */
  private findUsages(typeName: string, allFiles: FileAnalysis[]): string[] {
    const usages = new Set<string>();

    for (const file of allFiles) {
      const content = fs.readFileSync(file.path, 'utf-8');

      // Ищем функции которые используют этот тип
      for (const func of file.functions) {
        // Проверяем параметры функции
        if (func.params.some(p => p.includes(typeName))) {
          usages.add(func.name);
        }

        // Проверяем возвращаемый тип
        if (func.returns && func.returns.includes(typeName)) {
          usages.add(func.name);
        }

        // Проверяем в коде функции
        const funcContent = content.substring(0, 1000); // Первые 1000 букв
        if (funcContent.includes(typeName)) {
          usages.add(func.name);
        }
      }

      // Ищем в глобальных переменных/константах
      const varRegex = new RegExp(`const\\s+\\w+\\s*:\\s*${typeName}`, 'g');
      if (varRegex.test(content)) {
        usages.add(`[variable of type ${typeName}]`);
      }
    }

    return Array.from(usages).slice(0, 5); // Макс 5 мест
  }
}

export default EntityMapper;
