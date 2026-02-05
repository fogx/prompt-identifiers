#!/usr/bin/env npx tsx
/**
 * LLM Accuracy Benchmark Runner
 *
 * Measures LLM error rates when working with UUIDs vs encoded placeholders.
 * Replicates the methodology from BoundaryML's UUID swap benchmark.
 *
 * Automatically loads .env from bench/accuracy/.env if present.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx bench/accuracy/run.ts
 *   ANTHROPIC_API_KEY=sk-... npx tsx bench/accuracy/run.ts --items=100 --runs=2
 *   OPENAI_API_KEY=sk-... npx tsx bench/accuracy/run.ts --provider=openai
 *
 * Options:
 *   --items=N      Number of items (default: 200)
 *   --classes=N    Number of classes (default: 100)
 *   --runs=N       Number of runs per configuration (default: 3)
 *   --provider=X   Provider to use: anthropic, openai, or all (default: anthropic)
 *   --model=X      Specific model to test (overrides provider default)
 *   --format=X     Specific format to test: raw, SafeNumeric, Numeric, or all (default: all)
 *   --output=X     Output file for JSON results (default: results/<timestamp>.json)
 *   --verbose      Show detailed output including prompts and responses
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { generateDataset, Item } from './generate-data';
import { createPrompt, BenchmarkFormat } from './prompts';
import { verify, VerificationResult } from './verify';
import {
  callClaude,
  isAnthropicAvailable,
  CLAUDE_MODELS,
  ClaudeModel,
  getModelDisplayName as getClaudeDisplayName,
} from './providers/anthropic';
import {
  callOpenAI,
  isOpenAIAvailable,
  OPENAI_MODELS,
  OpenAIModel,
  getModelDisplayName as getOpenAIDisplayName,
} from './providers/openai';

// =============================================================================
// Types
// =============================================================================

interface BenchmarkConfig {
  itemCount: number;
  classCount: number;
  runs: number;
  models: string[];
  formats: BenchmarkFormat[];
  verbose: boolean;
  outputFile: string;
}

interface RunResult {
  model: string;
  format: BenchmarkFormat;
  run: number;
  verification: VerificationResult;
  latencyMs: number;
  promptTokens?: number;
  responseTokens?: number;
}

interface ModelResults {
  model: string;
  modelDisplayName: string;
  results: RunResult[];
  averageErrors: Record<BenchmarkFormat, number>;
}

interface BenchmarkResults {
  config: {
    itemCount: number;
    classCount: number;
    runs: number;
    timestamp: string;
  };
  models: ModelResults[];
}

// =============================================================================
// CLI Parsing
// =============================================================================

function parseArgs(): BenchmarkConfig {
  const args = process.argv.slice(2);
  const config: BenchmarkConfig = {
    itemCount: 200,
    classCount: 100,
    runs: 3,
    models: [],
    formats: ['raw', 'SafeNumeric', 'Numeric'],
    verbose: false,
    outputFile: '',
  };

  let provider = 'anthropic';
  let specificModel: string | null = null;
  let specificFormat: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--items=')) {
      config.itemCount = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--classes=')) {
      config.classCount = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--runs=')) {
      config.runs = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--provider=')) {
      provider = arg.split('=')[1];
    } else if (arg.startsWith('--model=')) {
      specificModel = arg.split('=')[1];
    } else if (arg.startsWith('--format=')) {
      specificFormat = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      config.outputFile = arg.split('=')[1];
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Set models based on provider
  if (specificModel) {
    config.models = [specificModel];
  } else if (provider === 'all') {
    config.models = [...CLAUDE_MODELS, ...OPENAI_MODELS];
  } else if (provider === 'openai') {
    config.models = [...OPENAI_MODELS];
  } else {
    config.models = [...CLAUDE_MODELS];
  }

  // Set formats
  if (specificFormat && specificFormat !== 'all') {
    config.formats = [specificFormat as BenchmarkFormat];
  }

  // Set default output file
  if (!config.outputFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    config.outputFile = path.join(__dirname, 'results', `benchmark-${timestamp}.json`);
  }

  return config;
}

function printHelp(): void {
  console.log(`
LLM Accuracy Benchmark

Measures LLM error rates when working with UUIDs vs encoded placeholders.

Usage:
  ANTHROPIC_API_KEY=sk-... npx tsx bench/accuracy/run.ts [options]

Options:
  --items=N      Number of items (default: 200)
  --classes=N    Number of classes (default: 100)
  --runs=N       Number of runs per configuration (default: 3)
  --provider=X   Provider: anthropic, openai, or all (default: anthropic)
  --model=X      Specific model to test
  --format=X     Format: raw, SafeNumeric, Numeric, or all (default: all)
  --output=X     Output file for JSON results
  --verbose      Show detailed output
  --help         Show this help message

Examples:
  # Run with Claude Haiku only
  ANTHROPIC_API_KEY=sk-... npx tsx bench/accuracy/run.ts --model=claude-3-5-haiku-20241022

  # Run with fewer items for quick test
  ANTHROPIC_API_KEY=sk-... npx tsx bench/accuracy/run.ts --items=50 --classes=25 --runs=1

  # Run with OpenAI
  OPENAI_API_KEY=sk-... npx tsx bench/accuracy/run.ts --provider=openai

  # Run all providers
  ANTHROPIC_API_KEY=sk-... OPENAI_API_KEY=sk-... npx tsx bench/accuracy/run.ts --provider=all
`);
}

// =============================================================================
// LLM Caller
// =============================================================================

async function callLLM(prompt: string, model: string): Promise<string> {
  if (CLAUDE_MODELS.includes(model as ClaudeModel)) {
    return callClaude(prompt, model as ClaudeModel);
  } else if (OPENAI_MODELS.includes(model as OpenAIModel)) {
    return callOpenAI(prompt, model as OpenAIModel);
  } else {
    throw new Error(`Unknown model: ${model}`);
  }
}

function getDisplayName(model: string): string {
  if (CLAUDE_MODELS.includes(model as ClaudeModel)) {
    return getClaudeDisplayName(model as ClaudeModel);
  } else if (OPENAI_MODELS.includes(model as OpenAIModel)) {
    return getOpenAIDisplayName(model as OpenAIModel);
  }
  return model;
}

// =============================================================================
// Benchmark Runner
// =============================================================================

async function runSingleTest(
  items: Item[],
  format: BenchmarkFormat,
  model: string,
  runNumber: number,
  verbose: boolean
): Promise<RunResult> {
  const { prompt, mapping, expected } = createPrompt(items, format);

  if (verbose) {
    console.log(`\n--- Prompt (${format}) ---`);
    console.log(prompt.slice(0, 1000) + (prompt.length > 1000 ? '...' : ''));
  }

  const startTime = Date.now();
  const response = await callLLM(prompt, model);
  const latencyMs = Date.now() - startTime;

  if (verbose) {
    console.log(`\n--- Response ---`);
    console.log(response.slice(0, 1000) + (response.length > 1000 ? '...' : ''));
  }

  const verification = verify(response, expected, mapping);

  return {
    model,
    format,
    run: runNumber,
    verification,
    latencyMs,
  };
}

async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResults> {
  console.log('# LLM Accuracy Benchmark\n');
  console.log(`Configuration:`);
  console.log(`  Items: ${config.itemCount}`);
  console.log(`  Classes: ${config.classCount}`);
  console.log(`  Runs per config: ${config.runs}`);
  console.log(`  Models: ${config.models.join(', ')}`);
  console.log(`  Formats: ${config.formats.join(', ')}`);
  console.log('');

  // Check provider availability
  const anthropicAvailable = await isAnthropicAvailable();
  const openaiAvailable = await isOpenAIAvailable();

  const availableModels = config.models.filter((model) => {
    if (CLAUDE_MODELS.includes(model as ClaudeModel)) {
      if (!anthropicAvailable) {
        console.log(`⚠ Skipping ${model}: ANTHROPIC_API_KEY not set or SDK not installed`);
        return false;
      }
      return true;
    }
    if (OPENAI_MODELS.includes(model as OpenAIModel)) {
      if (!openaiAvailable) {
        console.log(`⚠ Skipping ${model}: OPENAI_API_KEY not set or SDK not installed`);
        return false;
      }
      return true;
    }
    console.log(`⚠ Skipping ${model}: Unknown model`);
    return false;
  });

  if (availableModels.length === 0) {
    console.error('\n❌ No models available. Please set API keys and install SDKs.');
    console.error('   Run: pnpm add -D @anthropic-ai/sdk openai');
    process.exit(1);
  }

  console.log('');

  const results: BenchmarkResults = {
    config: {
      itemCount: config.itemCount,
      classCount: config.classCount,
      runs: config.runs,
      timestamp: new Date().toISOString(),
    },
    models: [],
  };

  // Generate dataset once (same data for all tests to ensure fair comparison)
  console.log('Generating dataset...');
  const items = generateDataset(config.itemCount, config.classCount);
  console.log(`Generated ${items.length} items across ${new Set(items.map((i) => i.class_id)).size} classes\n`);

  // Run benchmarks for each model
  for (const model of availableModels) {
    console.log(`\n## ${getDisplayName(model)}\n`);

    const modelResults: ModelResults = {
      model,
      modelDisplayName: getDisplayName(model),
      results: [],
      averageErrors: {} as Record<BenchmarkFormat, number>,
    };

    const errorsByFormat: Record<BenchmarkFormat, number[]> = {
      raw: [],
      SafeNumeric: [],
      Numeric: [],
    };

    for (const format of config.formats) {
      console.log(`Testing format: ${format}`);

      for (let run = 1; run <= config.runs; run++) {
        process.stdout.write(`  Run ${run}/${config.runs}... `);

        try {
          const result = await runSingleTest(items, format, model, run, config.verbose);
          modelResults.results.push(result);
          errorsByFormat[format].push(result.verification.totalErrors);

          const v = result.verification;
          console.log(
            `✓ ${v.totalErrors} errors (misspelled: ${v.misspelledIds}, dropped: ${v.droppedIds}, counts: ${v.incorrectCounts}, names: ${v.incorrectNames}) [${(result.latencyMs / 1000).toFixed(1)}s]`
          );

          if (config.verbose && v.details.length > 0) {
            console.log('    Details:');
            for (const detail of v.details.slice(0, 5)) {
              console.log(`      - ${detail.type}: ${detail.message}`);
            }
            if (v.details.length > 5) {
              console.log(`      ... and ${v.details.length - 5} more`);
            }
          }
        } catch (error) {
          console.log(`✗ Error: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Small delay between API calls to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Calculate averages
    for (const format of config.formats) {
      const errors = errorsByFormat[format];
      modelResults.averageErrors[format] =
        errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
    }

    results.models.push(modelResults);
  }

  return results;
}

// =============================================================================
// Output Formatting
// =============================================================================

function printSummary(results: BenchmarkResults): void {
  console.log('\n' + '='.repeat(60));
  console.log('# Summary\n');

  const { config } = results;
  console.log(`Items: ${config.itemCount}, Classes: ${config.classCount}, Runs: ${config.runs}\n`);

  for (const modelResult of results.models) {
    console.log(`## ${modelResult.modelDisplayName}\n`);

    // Print table header
    const formats = Object.keys(modelResult.averageErrors) as BenchmarkFormat[];
    const runNumbers = [...new Set(modelResult.results.map((r) => r.run))];

    console.log('| Format | ' + runNumbers.map((r) => `Run ${r}`).join(' | ') + ' | Average |');
    console.log('|--------|' + runNumbers.map(() => '-------').join('|') + '|---------|');

    for (const format of formats) {
      const runs = modelResult.results.filter((r) => r.format === format);
      const runErrors = runNumbers.map((n) => {
        const run = runs.find((r) => r.run === n);
        return run ? run.verification.totalErrors.toString() : '-';
      });
      const avg = modelResult.averageErrors[format].toFixed(1);
      console.log(`| ${format.padEnd(12)} | ${runErrors.map((e) => e.padStart(5)).join(' | ')} | ${avg.padStart(7)} |`);
    }

    // Calculate improvement
    const rawAvg = modelResult.averageErrors['raw'] || 0;
    const safeAvg = modelResult.averageErrors['SafeNumeric'] || 0;

    if (rawAvg > 0 && safeAvg >= 0) {
      const improvement = ((rawAvg - safeAvg) / rawAvg) * 100;
      console.log(`\nSafeNumeric reduces errors by ${improvement.toFixed(0)}% vs raw UUIDs.`);
    }

    console.log('');
  }
}

function saveResults(results: BenchmarkResults, outputFile: string): void {
  // Ensure directory exists
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  try {
    const results = await runBenchmark(config);
    printSummary(results);
    saveResults(results, config.outputFile);
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

main();
