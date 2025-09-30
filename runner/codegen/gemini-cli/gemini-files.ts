/** Generates the `GEMINI.md` file for an eval run. */
export function getGeminiInstructionsFile(
  systemInstructions: string,
  buildCommand: string,
): string {
  return [
    `# Important Rules`,
    `The following instructions dictate how you should behave. It is CRITICAL that you follow them AS CLOSELY AS POSSIBLE:`,
    `- Do NOT attempt to improve the existing code, only implement the user request.`,
    `- STOP once you've implemented the user request, do NOT try to clean up the project.`,
    `- You ARE NOT ALLOWED to install dependencies. Assume that all necessary dependencies are already installed.`,
    `- Do NOT clean up unused files.`,
    `- Do NOT run the dev server, use \`${buildCommand}\` to verify the build correctness instead.`,
    `- Do NOT use \`git\` or any other versioning software.`,
    `- Do NOT attempt to lint the project.`,
    '',
    `Following the rules is VERY important and should be done with the utmost care!`,
    '',
    '',
    systemInstructions,
  ].join('\n');
}

/** Generates the `.geminiignore` file for an eval run. */
export function getGeminiIgnoreFile(): string {
  return [
    '/dist',
    '/tmp',
    '/out-tsc',
    '/bazel-out',
    '/node_modules',
    'npm-debug.log',
    'yarn-error.log',
    '.editorconfig',
    '.postcssrc.json',
    '.gitignore',
    'yarn.lock',
    'pnpm-lock.yaml',
    'package-lock.json',
    'pnpm-workspace.yaml',
    '/.angular/cache',
    '.sass-cache/',
    '.DS_Store',
    'Thumbs.db',
  ].join('\n');
}

/** Gets the content of the `.gemini/settings.json` file. */
export function getGeminiSettingsFile(
  packageManager: string,
  possiblePackageManagers: string[],
): string {
  const config = {
    excludeTools: [
      // Prevent Gemini from using version control and package
      // managers since doing so via prompting doesn't always work.
      'run_shell_command(git)',
      ...possiblePackageManagers
        .filter(m => m !== packageManager)
        .map(m => `run_shell_command(${m})`),

      // Note that we don't block all commands,
      // because the build commands also go through it.
      `run_shell_command(${packageManager} install)`,
      `run_shell_command(${packageManager} add)`,
      `run_shell_command(${packageManager} remove)`,
      `run_shell_command(${packageManager} update)`,
      `run_shell_command(${packageManager} list)`,
    ],
  };

  return JSON.stringify(config, null, 2);
}
