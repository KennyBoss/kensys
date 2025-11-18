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

export interface CodeIssue {
  type: 'missing-function' | 'todo' | 'fixme' | 'error-handling' | 'risk';
  severity: 'low' | 'medium' | 'high';
  location: CodeLocation;
  description: string;
  suggestion?: string;
  affectedFunctions?: string[];
}

export interface CodeQuality {
  totalFunctions: number;
  functionsWithDocstring: number;
  functionsWithErrorHandling: number;
  todoCount: number;
  fixmeCount: number;
  issues: CodeIssue[];
  recommendations: string[];
}

export interface ProjectEntry {
  type: 'function' | 'class' | 'module';
  name: string;
  description: string;
  location: string;
  dependencies: string[];
  importance: 'critical' | 'high' | 'medium' | 'low';
}

export interface ProjectArchitecture {
  mainModules: string[];
  entryPoints: string[];
  layerStructure: Record<string, string[]>;
  dependencies: Record<string, string[]>;
}

export interface ProjectPassport {
  projectName: string;
  summary: string;
  language: string;
  filesAnalyzed: number;
  architecture: ProjectArchitecture;
  criticalFunctions: ProjectEntry[];
  keyModules: ProjectEntry[];
  warnings: string[];
  tips: string[];
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
  quality?: CodeQuality;
  passport?: ProjectPassport;
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
