/**
 * Модели данных для системы анализа проектов kensys
 */

export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
}

export interface Function {
  name: string;
  type: 'function' | 'method' | 'arrow' | 'async';
  location: CodeLocation;
  params: string[];
  returns?: string;
  logic?: string; // Описание логики функции
  calls: string[]; // Какие функции вызывает
  calledBy?: string[]; // Кто вызывает эту функцию
  isExported: boolean;
  isAsync: boolean;
  docstring?: string;
}

export interface Class {
  name: string;
  location: CodeLocation;
  methods: Function[];
  properties: string[];
  extends?: string;
  isExported: boolean;
}

export interface ImportExport {
  name: string;
  from: string;
  type: 'import' | 'export' | 'default-import' | 'default-export';
}

export interface FileAnalysis {
  path: string;
  language: string;
  functions: Function[];
  classes: Class[];
  imports: ImportExport[];
  exports: ImportExport[];
}

export interface Feature {
  name: string;
  description?: string;
  functions: Function[];
  files: string[];
  missingFunctions?: string[]; // Что не хватает
  dependencies: string[]; // Зависит от других фич
}

export interface ProjectCodex {
  projectName: string;
  description?: string;
  language: string;
  rootPath: string;
  filesAnalyzed: number;
  features: Feature[];
  allFunctions: Function[];
  allClasses: Class[];
  dependencies: DependencyGraph;
  searchIndex?: SearchIndex;
}

export interface DependencyGraph {
  nodes: Record<string, DependencyNode>;
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  type: 'function' | 'class' | 'file' | 'feature';
  name: string;
  file?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'calls' | 'imports' | 'extends' | 'implements';
}

export interface SearchIndex {
  functions: Record<string, Function[]>;
  classes: Record<string, Class[]>;
  files: Record<string, FileAnalysis>;
  keywords: Record<string, string[]>; // keyword -> array of items
}
