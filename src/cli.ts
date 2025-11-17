#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ProjectAnalyzer from './analyzer/analyzer';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
${chalk.cyan('kensys')} - Project Code Analysis System

${chalk.bold('Usage:')}
  kensys analyze <project-path> [--output <file>] [--name <project-name>]

${chalk.bold('Options:')}
  --output, -o    Output file path (default: codex.json)
  --name, -n      Project name (default: folder name)

${chalk.bold('Examples:')}
  kensys analyze ./my-project
  kensys analyze ./my-project --output ./codex.json --name "MyApp"
`);
}

async function main() {
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command !== 'analyze') {
    console.error(chalk.red(`❌ Unknown command: ${command}`));
    printHelp();
    process.exit(1);
  }

  const projectPath = args[1];
  if (!projectPath) {
    console.error(chalk.red('❌ Project path is required'));
    printHelp();
    process.exit(1);
  }

  // Парсим опции
  let outputFile = 'codex.json';
  let projectName: string | undefined;

  for (let i = 2; i < args.length; i++) {
    if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
      outputFile = args[++i];
    } else if ((args[i] === '--name' || args[i] === '-n') && args[i + 1]) {
      projectName = args[++i];
    }
  }

  // Проверяем что путь существует
  if (!fs.existsSync(projectPath)) {
    console.error(chalk.red(`❌ Project path not found: ${projectPath}`));
    process.exit(1);
  }

  const absolutePath = path.resolve(projectPath);

  console.log(chalk.cyan('\n🔍 kensys - Code Analysis System\n'));
  console.log(chalk.gray(`Project: ${absolutePath}`));
  console.log(chalk.gray(`Output: ${outputFile}\n`));

  try {
    const analyzer = new ProjectAnalyzer();
    const codex = await analyzer.analyzeProject(absolutePath, projectName);

    // Сохраняем результат
    const outputPath = path.resolve(outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(codex, null, 2));

    console.log(chalk.green('✅ Analysis complete!'));
    console.log(chalk.green(`📊 Files analyzed: ${codex.filesAnalyzed}`));
    console.log(chalk.green(`🔧 Functions found: ${codex.allFunctions.length}`));
    console.log(chalk.green(`📦 Classes found: ${codex.allClasses.length}`));
    console.log(chalk.green(`🎯 Features identified: ${codex.features.length}`));
    console.log(chalk.green(`\n📄 Codex saved to: ${outputPath}\n`));

    // Показываем краткую информацию о фичах
    if (codex.features.length > 0) {
      console.log(chalk.cyan('Features:'));
      for (const feature of codex.features.slice(0, 10)) {
        console.log(chalk.gray(`  • ${feature.name} (${feature.functions.length} functions)`));
      }
      if (codex.features.length > 10) {
        console.log(chalk.gray(`  ... and ${codex.features.length - 10} more`));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during analysis:'));
    console.error(chalk.red((error as any).message));
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
