import {readdirSync, readFileSync, statSync} from 'fs';
import {basename, extname, join, resolve} from 'path';
import {globSync} from 'tinyglobby';
import {Executor} from '../orchestration/executors/executor.js';
import {Rating} from '../ratings/rating-types.js';
import {
  FrameworkInfo,
  MultiStepPromptDefinition,
  PromptDefinition,
  RootPromptDefinition,
} from '../shared-interfaces.js';
import {UserFacingError} from '../utils/errors.js';
import {generateId} from '../utils/id-generation.js';
import {lazy} from '../utils/lazy-creation.js';
import {EnvironmentConfig} from './environment-config.js';
import {EvalPromptWithMetadata, MultiStepPrompt} from './prompts.js';
import {renderPromptTemplate} from './prompt-templating.js';

/** Represents a single prompt evaluation environment. */
export class Environment {
  /** Path at which the environment is defined. */
  readonly rootPath: string;
  /** Unique ID for the environment. */
  readonly id: string;
  /** Display name of the environment. */
  readonly displayName: string;
  /** Information about the fullstack framework used within the environment. */
  readonly fullStackFramework: FrameworkInfo;
  /** Information about the client-side framework used within the environment. */
  readonly clientSideFramework: FrameworkInfo;
  /** Path from which to read the code rating prompt. */
  readonly codeRatingPromptPath: string | null;
  /** Whether the prompts should be removed from the final report. */
  readonly classifyPrompts: boolean;
  /** Whether this is one of the built-in environment that come with the runner. */
  readonly isBuiltIn: boolean;
  /** Configured executor. */
  readonly executor: Executor;

  constructor(
    rootPath: string,
    private readonly config: EnvironmentConfig & Required<Pick<EnvironmentConfig, 'executor'>>,
  ) {
    this.rootPath = rootPath;
    this.id = config.id || this.generateId(config.displayName);
    this.displayName = config.displayName;
    this.clientSideFramework = {
      id: config.clientSideFramework,
      displayName:
        this.getFrameworkDisplayName(config.clientSideFramework) || config.clientSideFramework,
    };
    this.fullStackFramework = config.fullStackFramework
      ? {
          id: config.fullStackFramework,
          displayName:
            this.getFrameworkDisplayName(config.fullStackFramework) || config.clientSideFramework,
        }
      : {...this.clientSideFramework};
    this.codeRatingPromptPath = config.codeRatingPrompt
      ? join(rootPath, config.codeRatingPrompt)
      : null;
    this.classifyPrompts = config.classifyPrompts ?? false;
    this.isBuiltIn = rootPath.includes('node_modules');
    this.executor = config.executor;
  }

  /** Prompts that should be executed as a part of the evaluation. */
  executablePrompts = lazy(async () => {
    return this.resolveExecutablePrompts(this.config.executablePrompts, this.config.ratings);
  });

  systemPromptGeneration = lazy(async () => {
    return (await this.renderSystemPrompt(this.config.generationSystemPrompt)).result;
  });

  systemPromptRepair = lazy(async () => {
    if (!this.config.repairSystemPrompt) {
      return 'Please fix the given errors and return the corrected code.';
    }
    return (await this.renderSystemPrompt(this.config.repairSystemPrompt)).result;
  });

  systemPromptEditing = lazy(async () => {
    if (!this.config.editingSystemPrompt) {
      return this.systemPromptGeneration();
    }
    return (await this.renderSystemPrompt(this.config.editingSystemPrompt)).result;
  });

  /**
   * Augments a prompt based on the environment's config.
   * @param userPrompt Prompt that is being augmented.
   * @param ragEndpoint Optional RAG endpoint to use when augmenting the prompt.
   */
  async getPrompt(
    type: 'generation' | 'editing',
    userPrompt: string,
    ragEndpoint?: string,
  ): Promise<string> {
    const systemPrompt =
      type === 'generation'
        ? await this.systemPromptGeneration()
        : await this.systemPromptEditing();

    if (!ragEndpoint) {
      return [systemPrompt, userPrompt].join('\n\n');
    }

    if (!ragEndpoint.includes('PROMPT')) {
      throw new UserFacingError('The ragEndpoint must include the "PROMPT" substring.');
    }
    const url = ragEndpoint.replace('PROMPT', encodeURIComponent(userPrompt));
    const response = await fetch(url);
    if (!response.ok) {
      throw new UserFacingError(`Failed to fetch from ${url}: ${response.statusText}`);
    }
    const ragContent = await response.text();
    return `${systemPrompt}\n\n${ragContent}`;
  }

  /**
   * Renders out a prompt with our custom templating support.
   * @param content Raw content of the prompt.
   * @param promptFilePath Path where the prompt is located. If null, embedding files into
   *   the prompt will not be supported.
   * @param additionalContext Additional context variables to expose to the prompt.
   */
  renderPrompt(
    content: string,
    promptFilePath: string | null,
    additionalContext: Record<string, string> = {},
  ) {
    return renderPromptTemplate(content, {
      containingFile: promptFilePath ? promptFilePath : null,
      FULL_STACK_FRAMEWORK_NAME: this.fullStackFramework.displayName,
      CLIENT_SIDE_FRAMEWORK_NAME: this.clientSideFramework.displayName,
      ...additionalContext,
    });
  }

  /**
   * Gets the readable display name of a framework, based on its ID.
   * @param id ID to be resolved.
   */
  private getFrameworkDisplayName(id: string): string | null {
    switch (id) {
      case 'angular':
        return 'Angular';
      case 'next':
        return 'Next.js';
      case 'react':
        return 'React';
      case 'vue':
        return 'Vue.js';
      case 'svelte':
        return 'Svelte';
      case 'solid':
        return 'Solid.js';
      default:
        return null;
    }
  }

  /**
   * Resolves the prompt configuration into prompt definitions.
   * @param rootPath Root path of the project.
   * @param prompts Prompts to be resolved.
   * @param envRatings Environment-level ratings.
   */
  private async resolveExecutablePrompts(
    prompts: EnvironmentConfig['executablePrompts'],
    envRatings: Rating[],
  ): Promise<RootPromptDefinition[]> {
    const result: Promise<RootPromptDefinition>[] = [];

    for (const def of prompts) {
      if (def instanceof MultiStepPrompt) {
        result.push(this.getMultiStepPrompt(def, envRatings));
      } else if (def instanceof EvalPromptWithMetadata) {
        result.push(
          Promise.resolve({
            name: def.name,
            kind: 'single',
            prompt: def.text,
            ratings: [...envRatings, ...(def.opts.extraRatings ?? [])],
            systemPromptType: 'generation',
            contextFilePatterns: def.opts.contextFilePatterns ?? [],
            metadata: def.opts.metadata,
          } satisfies PromptDefinition),
        );
      } else {
        let path: string;
        let ratings: Rating[];
        let name: string | undefined = undefined;

        if (typeof def === 'string') {
          path = def;
          ratings = envRatings.slice();
        } else {
          path = def.path;
          ratings = [...(def.ratings ?? []), ...envRatings];
          name = def.name;
        }

        result.push(
          ...globSync(path, {cwd: this.rootPath}).map(
            async relativePath =>
              await this.getStepPromptDefinition(
                name ?? basename(relativePath, extname(relativePath)),
                relativePath,
                ratings,
                /* isEditing */ false,
                undefined,
              ),
          ),
        );
      }
    }

    return Promise.all(result);
  }

  /**
   * Creates a prompt definition for a given step.
   *
   * @param name Name of the prompt.
   * @param rootPath Root path of the project.
   * @param relativePath Relative path to the prompt.
   * @param ratings Ratings to run against the definition.
   * @param isEditing Whether this is an editing or generation step.
   */
  private async getStepPromptDefinition<Metadata>(
    name: string,
    relativePath: string,
    ratings: Rating[],
    isEditing: boolean,
    metadata: Metadata,
  ): Promise<PromptDefinition<Metadata>> {
    const {result, contextFiles} = await this.renderEnvironmentPrompt(relativePath);

    return {
      name: name,
      kind: 'single',
      prompt: result,
      ratings,
      systemPromptType: isEditing ? 'editing' : 'generation',
      contextFilePatterns: contextFiles,
      metadata,
    } satisfies PromptDefinition<Metadata>;
  }

  /**
   * Gets a multi-step form based on a configuration.
   * @param rootPath Root path of the project.
   * @param def Definition of the prompt.
   * @param envRatings Environment-level ratings.
   */
  private async getMultiStepPrompt(
    def: MultiStepPrompt,
    envRatings: Rating[],
  ): Promise<MultiStepPromptDefinition> {
    const promptRoot = resolve(this.rootPath, def.directoryPath);
    const name = basename(promptRoot);
    const steps: PromptDefinition[] = [];
    const stepRegex = /^step-(\d+)/;
    const stepValues: Record<string, number> = {};

    if (!statSync(promptRoot).isDirectory()) {
      throw new UserFacingError(
        `Multi-step prompt root must point to a directory. "${promptRoot}" is not a directory.`,
      );
    }

    const entities = readdirSync(promptRoot, {withFileTypes: true});

    if (entities.length === 0) {
      throw new UserFacingError('Multi-step prompt directory cannot be empty.');
    }

    for (const current of entities) {
      if (!current.isFile()) {
        throw new UserFacingError(
          `Multi-step prompt directory can only contain files. ${current.name} is not a file.`,
        );
      }

      const match = current.name.match(stepRegex);

      if (!match || !match[1]) {
        throw new UserFacingError(
          `Multi-step prompt name must be in the form of \`step-<number>\`, ` +
            `but received '${current.name}'`,
        );
      }

      const ratings = [...envRatings];

      if (def.stepRatings[current.name]) {
        ratings.unshift(...def.stepRatings[current.name]);
      }

      const stepMetadata = def.stepMetadata[current.name];
      const stepNum = parseInt(match[1]);
      if (stepNum === 0) {
        throw new UserFacingError('Multi-step prompts start with `step-1`.');
      }
      const step = await this.getStepPromptDefinition(
        `${name}-step-${stepNum}`,
        join(def.directoryPath, current.name),
        ratings,
        /*isEditing */ stepNum !== 1,
        stepMetadata,
      );

      stepValues[step.name] = stepNum;
      steps.push(step);
    }

    return {
      name,
      kind: 'multi-step',
      steps: steps.sort((a, b) => stepValues[a.name] - stepValues[b.name]),
    } satisfies MultiStepPromptDefinition;
  }

  private generateId(displayName: string): string {
    const id = generateId(displayName);

    if (id === null) {
      throw new UserFacingError(`Could not auto-generate an ID from "${displayName}"`);
    }

    return id;
  }

  /** Renders a prompt from a path relative to the environment config. */
  private async renderEnvironmentPrompt(relativePath: string) {
    const path = resolve(this.rootPath, relativePath);
    return this.renderPrompt(readFileSync(path, 'utf8'), path);
  }

  private async renderSystemPrompt(relativePath: string) {
    const result = await this.renderEnvironmentPrompt(relativePath);

    // Optional hooks for post processing environment system prompts. Useful for e.g.
    // supporting `@` references from Gemini CLI or inside g3.
    if (this.executor.postProcessSystemPrompt !== undefined) {
      result.result = await this.executor.postProcessSystemPrompt(result.result, this.rootPath);
    }

    return result;
  }
}
