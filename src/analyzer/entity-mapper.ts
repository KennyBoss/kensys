import * as fs from 'fs';
import * as path from 'path';
import type { FileAnalysis } from '../models/types';

export interface DataType {
  name: string;
  type: 'interface' | 'class' | 'type' | 'schema' | 'model' | 'dto' | 'entity';
  fields: Map<string, string>; // fieldName -> fieldType
  location: string;
  isDatabase?: boolean;
  isAPI?: boolean;
  isBackend?: boolean;
}

export interface EntityMapping {
  primaryName: string;
  aliases: string[]; // money, coin - все имена сущности
  definitions: DataType[];
  fieldMappings: Map<string, string[]>; // БД поле -> API поля
  warnings: string[];
}

export interface DataDictionary {
  entities: EntityMapping[];
  typeMismatches: string[];
  recommendations: string[];
}

export class EntityMapper {
  /**
   * Анализирует проект и находит все сущности данных
   */
  analyzeEntities(allFiles: FileAnalysis[]): DataDictionary {
    const dataTypes = this.extractDataTypes(allFiles);
    const entities = this.groupEntitiesByMeaning(dataTypes, allFiles);
    const typeMismatches = this.findTypeMismatches(entities);
    const recommendations = this.generateRecommendations(entities, typeMismatches);

    return {
      entities,
      typeMismatches,
      recommendations,
    };
  }

  /**
   * Извлекает все типы данных (interface, type, class, schema)
   */
  private extractDataTypes(allFiles: FileAnalysis[]): DataType[] {
    const dataTypes: DataType[] = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file.path, 'utf-8');
      const isDbFile = this.isDbFile(file.path);
      const isApiFile = this.isApiFile(file.path);
      const isBackendFile = this.isBackendFile(file.path);

      // Ищем interface
      const interfaceRegex = /interface\s+(\w+)\s*{([^}]+)}/g;
      let match;
      while ((match = interfaceRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];
        const fields = this.extractFields(body);

        dataTypes.push({
          name,
          type: 'interface',
          fields,
          location: file.path,
          isDatabase: isDbFile,
          isAPI: isApiFile,
          isBackend: isBackendFile,
        });
      }

      // Ищем type
      const typeRegex = /type\s+(\w+)\s*=\s*{([^}]+)}/g;
      while ((match = typeRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];
        const fields = this.extractFields(body);

        dataTypes.push({
          name,
          type: 'type',
          fields,
          location: file.path,
          isDatabase: isDbFile,
          isAPI: isApiFile,
          isBackend: isBackendFile,
        });
      }

      // Ищем class
      const classRegex = /class\s+(\w+)\s*{([^}]+)}/g;
      while ((match = classRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];
        const fields = this.extractFields(body);

        dataTypes.push({
          name,
          type: 'class',
          fields,
          location: file.path,
          isDatabase: isDbFile,
          isAPI: isApiFile,
          isBackend: isBackendFile,
        });
      }

      // Ищем Prisma schema
      if (file.path.endsWith('.prisma')) {
        const modelRegex = /model\s+(\w+)\s*{([^}]+)}/g;
        while ((match = modelRegex.exec(content)) !== null) {
          const name = match[1];
          const body = match[2];
          const fields = this.extractPrismaFields(body);

          dataTypes.push({
            name,
            type: 'schema',
            fields,
            location: file.path,
            isDatabase: true,
          });
        }
      }
    }

    return dataTypes;
  }

  /**
   * Извлекает поля из типа/интерфейса
   */
  private extractFields(body: string): Map<string, string> {
    const fields = new Map<string, string>();
    const fieldRegex = /(\w+)\s*:\s*([^;,\n}]+)/g;
    let match;

    while ((match = fieldRegex.exec(body)) !== null) {
      const fieldName = match[1].trim();
      const fieldType = match[2].trim();
      fields.set(fieldName, fieldType);
    }

    return fields;
  }

  /**
   * Извлекает поля из Prisma schema
   */
  private extractPrismaFields(body: string): Map<string, string> {
    const fields = new Map<string, string>();
    const fieldRegex = /(\w+)\s+(\w+)/g;
    let match;

    while ((match = fieldRegex.exec(body)) !== null) {
      const fieldName = match[1].trim();
      const fieldType = match[2].trim();
      fields.set(fieldName, fieldType);
    }

    return fields;
  }

  /**
   * Группирует типы по смыслу (находит синонимы)
   * money, coin, value - это одна сущность
   */
  private groupEntitiesByMeaning(
    dataTypes: DataType[],
    allFiles: FileAnalysis[]
  ): EntityMapping[] {
    const entities = new Map<string, EntityMapping>();
    const similarityMap = new Map<string, string[]>();

    // Находим похожие имена
    for (const type of dataTypes) {
      const similar = this.findSimilarNames(type.name, dataTypes);
      if (similar.length > 1) {
        const key = similar.sort().join('_');
        if (!similarityMap.has(key)) {
          similarityMap.set(key, similar);
        }
      }
    }

    // Создаём группы сущностей
    const processed = new Set<string>();

    for (const [key, names] of similarityMap) {
      if (processed.has(key)) continue;

      const primaryName = names.sort((a, b) => {
        // Приоритет: более полное имя, потом более частое использование
        return b.length - a.length;
      })[0];

      const definitions = dataTypes.filter(t => names.includes(t.name));
      const fieldMappings = this.mapFields(definitions);
      const warnings = this.validateEntity(definitions);

      entities.set(primaryName, {
        primaryName,
        aliases: names,
        definitions,
        fieldMappings,
        warnings,
      });

      names.forEach(n => processed.add(n));
    }

    return Array.from(entities.values());
  }

  /**
   * Находит похожие имена (money, coin, value и т.д.)
   */
  private findSimilarNames(name: string, allTypes: DataType[]): string[] {
    const similar = [name];
    const normalized = this.normalizeName(name);

    // Близкие по смыслу слова
    const synonyms: Record<string, string[]> = {
      money: ['coin', 'amount', 'balance', 'value', 'price'],
      coin: ['money', 'amount', 'balance', 'value'],
      user: ['userData', 'userInfo', 'profile', 'account'],
      product: ['item', 'good', 'sku', 'commodity'],
      transaction: ['tx', 'transfer', 'payment', 'order'],
      wallet: ['account', 'ledger', 'balance'],
    };

    // Ищем известные синонимы
    if (synonyms[normalized]) {
      for (const syn of synonyms[normalized]) {
        const matching = allTypes.find(t =>
          this.normalizeName(t.name).includes(syn) ||
          syn.includes(this.normalizeName(t.name))
        );
        if (matching) {
          similar.push(matching.name);
        }
      }
    }

    // Ищем по схожести названия (хотя бы 70% букв совпадает)
    for (const type of allTypes) {
      if (type.name !== name && this.isSimilar(name, type.name)) {
        similar.push(type.name);
      }
    }

    return [...new Set(similar)];
  }

  /**
   * Нормализует имя для сравнения
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/([A-Z])/g, '_$1')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Проверяет схожесть двух строк
   */
  private isSimilar(a: string, b: string): boolean {
    const normA = this.normalizeName(a);
    const normB = this.normalizeName(b);

    if (normA === normB) return true;

    // Если одно содержит другое или наоборот
    if (normA.includes(normB) || normB.includes(normA)) return true;

    // Если половина букв совпадает
    const common = [...normA].filter(c => normB.includes(c)).length;
    const similarity = (common * 2) / (normA.length + normB.length);
    return similarity > 0.6;
  }

  /**
   * Маппирует поля между разными представлениями сущности
   */
  private mapFields(definitions: DataType[]): Map<string, string[]> {
    const mappings = new Map<string, string[]>();

    // Группируем по смыслу поля
    for (const def of definitions) {
      for (const [fieldName, fieldType] of def.fields) {
        const normalized = this.normalizeName(fieldName);
        if (!mappings.has(normalized)) {
          mappings.set(normalized, []);
        }
        mappings.get(normalized)!.push(`${def.name}.${fieldName}`);
      }
    }

    return mappings;
  }

  /**
   * Проверяет сущность на ошибки
   */
  private validateEntity(definitions: DataType[]): string[] {
    const warnings: string[] = [];

    if (definitions.length < 2) {
      return warnings;
    }

    // Проверяем типы полей
    const fieldTypes = new Map<string, Set<string>>();

    for (const def of definitions) {
      for (const [field, type] of def.fields) {
        const normalized = this.normalizeName(field);
        if (!fieldTypes.has(normalized)) {
          fieldTypes.set(normalized, new Set());
        }
        fieldTypes.get(normalized)!.add(type);
      }
    }

    // Ищем несоответствия типов
    for (const [field, types] of fieldTypes) {
      if (types.size > 1) {
        warnings.push(
          `⚠️ Field "${field}" has different types: ${Array.from(types).join(', ')}`
        );
      }
    }

    // Проверяем разное количество полей
    const fieldCounts = definitions.map(d => d.fields.size);
    if (new Set(fieldCounts).size > 1) {
      warnings.push(
        `⚠️ Different number of fields: ${fieldCounts.join(', ')}`
      );
    }

    return warnings;
  }

  /**
   * Находит несоответствия типов данных
   */
  private findTypeMismatches(entities: EntityMapping[]): string[] {
    const mismatches: string[] = [];

    for (const entity of entities) {
      const dbDef = entity.definitions.find(d => d.isDatabase);
      const apiDef = entity.definitions.find(d => d.isAPI);
      const backendDef = entity.definitions.find(d => d.isBackend);

      if (dbDef && apiDef) {
        for (const [field, type] of dbDef.fields) {
          const normalized = this.normalizeName(field);
          const apiField = Array.from(apiDef.fields.entries()).find(
            ([f]) => this.normalizeName(f) === normalized
          );

          if (apiField) {
            const [apiFieldName, apiType] = apiField;
            if (!this.areTypesCompatible(type, apiType)) {
              mismatches.push(
                `❌ ${entity.primaryName}: DB field "${field}" (${type}) vs API field "${apiFieldName}" (${apiType})`
              );
            }
          }
        }
      }
    }

    return mismatches;
  }

  /**
   * Проверяет совместимость типов
   */
  private areTypesCompatible(type1: string, type2: string): boolean {
    const map: Record<string, string[]> = {
      bigint: ['string', 'number', 'BigInt'],
      'int(11)': ['number', 'Int32'],
      varchar: ['string', 'String'],
      boolean: ['bool', 'Boolean', 'boolean'],
      timestamp: ['Date', 'DateTime', 'string'],
      decimal: ['number', 'float', 'Decimal'],
    };

    const normalized1 = type1.toLowerCase();
    const normalized2 = type2.toLowerCase();

    if (normalized1 === normalized2) return true;

    for (const [dbType, compatibleTypes] of Object.entries(map)) {
      if (
        normalized1.includes(dbType) &&
        compatibleTypes.some(t => normalized2.includes(t.toLowerCase()))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Генерирует рекомендации
   */
  private generateRecommendations(
    entities: EntityMapping[],
    mismatches: string[]
  ): string[] {
    const recommendations: string[] = [];

    for (const entity of entities) {
      if (entity.warnings.length > 0) {
        recommendations.push(
          `🔧 ${entity.primaryName}: Standardize naming - use "${entity.primaryName}" everywhere instead of ${entity.aliases.join(', ')}`
        );
      }
    }

    if (mismatches.length > 0) {
      recommendations.push(
        `🔴 Fix ${mismatches.length} type mismatches between DB and API`
      );
    }

    if (entities.length === 0) {
      recommendations.push(
        `ℹ️ No data entities found. Make sure you have interfaces/types defined.`
      );
    }

    return recommendations;
  }

  /**
   * Проверяет если это файл БД
   */
  private isDbFile(filePath: string): boolean {
    return (
      filePath.includes('prisma') ||
      filePath.includes('schema') ||
      filePath.includes('migration') ||
      filePath.includes('database')
    );
  }

  /**
   * Проверяет если это файл API
   */
  private isApiFile(filePath: string): boolean {
    return (
      filePath.includes('api') ||
      filePath.includes('routes') ||
      filePath.includes('controller') ||
      filePath.includes('handler') ||
      filePath.includes('dto')
    );
  }

  /**
   * Проверяет если это файл backend логики
   */
  private isBackendFile(filePath: string): boolean {
    return (
      filePath.includes('service') ||
      filePath.includes('model') ||
      filePath.includes('entity') ||
      filePath.includes('src')
    );
  }
}

export default EntityMapper;
