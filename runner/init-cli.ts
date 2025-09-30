import {Argv, CommandModule, Options} from 'yargs';
import {input, confirm} from '@inquirer/prompts';
import chalk from 'chalk';
import {join, relative, dirname} from 'path';
import {cp} from 'fs/promises';
import {formatTitleCard} from './reporting/format.js';
import {generateId} from './utils/id-generation.js';
import {safeWriteFile, toProcessAbsolutePath} from './file-system-utils.js';
import {MODEL_PROVIDERS} from './codegen/genkit/models.js';

export const InitModule = {
  builder,
  handler,
  command: 'init',
  describe: 'Interactive guide through the process of creating an eval environment',
} satisfies CommandModule<{}, Options>;

interface InitOptions {
  configPath: string;
  displayName: string;
  clientSideFramework: string;
  sourceDirectory: string;
  executablePrompts?: string;
  generationSystemPrompt?: string;
}

function builder(argv: Argv): Argv<{}> {
  return argv.strict().version(false).help();
}

async function handler(): Promise<void> {
  try {
    const answers = await getAnswers();

    if (answers !== null) {
      await writeConfig(answers);
    }
  } catch (e: unknown) {
    // If the user presses ctrl + c, Inquirer will throw `ExitPromptError`. Ignore it.
    if (!(e instanceof Error) || e.name !== 'ExitPromptError') {
      throw e;
    }
  }
}

async function getAnswers(): Promise<InitOptions | null> {
  console.log(
    formatTitleCard(
      [
        'Welcome LLM enthusiast! 🎉',
        'Answer the following questions to create an eval environment',
      ].join('\n'),
    ),
  );

  // Add some spaces at the end to align to the text of the line above.
  const newLineSeparator = '\n  ';
  const apiKeyVariables = MODEL_PROVIDERS.map(p => p.apiKeyVariableName);

  if (!apiKeyVariables.some(name => process.env[name])) {
    const hasConfirmed = await confirm({
      message: chalk.red(
        `Could not detect an API key in any of the following environment variables: ${apiKeyVariables.join(', ')}` +
          newLineSeparator +
          'You may not be able to run the evals. Do you want to continue generating an environment anyway?',
      ),
    });

    if (!hasConfirmed) {
      return null;
    }
  }

  const displayName = await input({
    message: 'What will be the name of your environment?',
    required: true,
    default: 'Hello World',
  });
  const configPath = await input({
    message: 'Where should we place the environment config file?',
    required: true,
    default: join(generateId(displayName) || 'env', 'config.mjs'),
    validate: value =>
      value.endsWith('.js') || value.endsWith('.mjs') ? true : 'Config must be a .mjs or .js file',
  });
  const clientSideFramework = await input({
    message: 'What client-side framework will it be using?',
    required: true,
    default: 'unknown',
  });
  const sourceDirectory = await input({
    message:
      'In which directory should the LLM generate and execute code?' +
      newLineSeparator +
      'This should be the root of the project, e.g. where the `package.json` is placed',
    required: true,
  });
  const generationSystemPrompt = await input({
    message:
      'What file contains your system instructions (e.g. `my-instructions.md`)?' +
      newLineSeparator +
      'Leave this blank and we will create an example for you',
  });
  const executablePrompts = await input({
    message:
      'What prompts should the LLM execute (e.g. `my-prompts/**/*.md`)?' +
      newLineSeparator +
      'Leave this blank and we will create some example prompts for you',
  });

  return {
    displayName,
    configPath,
    clientSideFramework,
    sourceDirectory,
    generationSystemPrompt,
    executablePrompts,
  };
}

async function writeConfig(options: InitOptions) {
  const configPath = toProcessAbsolutePath(options.configPath);
  const configDir = dirname(configPath);
  const sourcePath = toProcessAbsolutePath(options.sourceDirectory);
  let generationPromptPath: string;
  let executablePromptsPattern: string;

  if (options.generationSystemPrompt) {
    generationPromptPath = relative(
      configDir,
      toProcessAbsolutePath(options.generationSystemPrompt),
    );
  } else {
    generationPromptPath = './example-system-instructions.md';
    await safeWriteFile(join(configDir, generationPromptPath), getExampleSystemInstructions());
  }

  if (options.executablePrompts) {
    executablePromptsPattern = relative(
      configDir,
      toProcessAbsolutePath(options.executablePrompts),
    );
  } else {
    const executablePromptDir = './example-prompts';
    executablePromptsPattern = `${executablePromptDir}/**/*.md`;

    await cp(
      join(import.meta.dirname, '../examples/prompts'),
      join(configDir, executablePromptDir),
      {recursive: true},
    );
  }

  await safeWriteFile(
    configPath,
    [
      `import { getBuiltInRatings } from 'web-codegen-scorer';`,
      ``,
      `/** @type {import("web-codegen-scorer").EnvironmentConfig} */`,
      `export default {`,
      `  displayName: '${options.displayName}',`,
      `  clientSideFramework: '${options.clientSideFramework}',`,
      `  sourceDirectory: '${relative(configDir, sourcePath)}',`,
      `  ratings: [`,
      `    // This includes some framework-agnostic scoring ratings to your eval.`,
      `    // You can add your own custom ratings to this array.`,
      `    ...getBuiltInRatings()`,
      `  ],`,
      `  generationSystemPrompt: '${generationPromptPath}',`,
      `  executablePrompts: ['${executablePromptsPattern}'],`,
      ``,
      `  // The following options aren't mandatory, but can be useful:`,
      `  // id: '', Unique ID for the environment. If empty, one is generated from the \`displayName\`.`,
      `  // packageManager: 'npm', // Name of the package manager used to install dependencies.`,
      `  // skipInstall: false, // Whether to skip installing dependencies. Useful if you're doing it yourself already.`,
      `  // buildCommand: 'npm run build', // Command used to build the generated code.`,
      `  // serveCommand: 'npm run start -- --port 0', // Command used to start a dev server with the generated code.`,
      `  // mcpServers: [], // Model Context Protocal servers to run during the eval.`,
      ``,
      `  // repairSystemPrompt: '', // Path to a prompt used when repairing broken code.`,
      `  // editingSystemPrompt: '', // Path to a prompt used when editing code during a multi-step eval.`,
      `  // codeRatingPrompt: '', // Path to a prompt to use when automatically rating the generated code with an LLM.`,
      `  // classifyPrompts: false, // Whether to exclude the prompt text from the final report.`,
      ``,
      `  // Path to a directory that will be merged with the \`sourceDirectory\` to produce`,
      `  // the final project. Useful for reusing boilerplate between environments.`,
      `  // projectTemplate: '',`,
      ``,
      `  // If your setup has different client-side and full-stack framework, `,
      `  // you can specify a different full-stack framework here.`,
      `  // fullStackFramework: '',`,
      `};`,
    ].join('\n'),
  );

  console.log(
    formatTitleCard(
      [
        'Done! 🎉 You can run your eval with the following command:',
        `web-codegen-scorer eval --env=${options.configPath}`,
      ].join('\n'),
    ),
  );
}

function getExampleSystemInstructions(): string {
  return [
    `You are an expert in JavaScript, TypeScript, CSS, HTML, and scalable web application development.`,
    `You write functional, maintainable, performant, and accessible code following web development best practices.`,
    ``,
    `### TypeScript Best Practices`,
    ``,
    `- Use strict type checking`,
    `- Prefer type inference when the type is obvious`,
    `- Avoid the \`any\` type; use \`unknown\` when type is uncertain`,
    ``,
    `Follow instructions below CAREFULLY:`,
    ``,
    `- Include all necessary code to run independently`,
    `- Use comments sparingly and only for complex parts of the code`,
    `- Make sure the generated code is **complete** and **runnable**`,
    `- Aesthetics are **crucial**, make the application look amazing!`,
    ``,
    `<!--`,
    `  Normally you would put other important instructions here, like where to`,
    `  output the generated code and best practices for your framework.`,
    `-->`,
  ].join('\n');
}
