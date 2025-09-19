import chalk from 'chalk';
import boxen from 'boxen';
import {
  IndividualAssessment,
  IndividualAssessmentState,
  SkippedIndividualAssessment,
} from '../shared-interfaces.js';

/** Formats a title card that can be shown at the beginning a script. */
export function formatTitleCard(text: string, width = 80): string {
  return boxen(text, {
    title: 'web-codegen-scorer',
    titleAlignment: 'center',
    borderStyle: 'double',
    borderColor: 'cyan',
    padding: 1,
    width: Math.min(width, process.stdout.columns),
  });
}

/**
 * Formats a number representing a token count into a human-readable string
 * using 'K' for thousands and 'M' for millions.
 *
 * @param count The number of tokens.
 * @returns A string representing the formatted token count (e.g., "1.5K", "2.3M", "500").
 *          Returns "N/A" if the count is undefined or null.
 */
export function formatTokenCount(count: number | undefined | null): string {
  if (count == null) {
    return 'N/A';
  }
  if (count >= 1_000_000) {
    return (count / 1_000_000).toFixed(1) + 'M';
  }
  if (count >= 1_000) {
    return (count / 1_000).toFixed(1) + 'K';
  }
  return count.toString();
}

/**
 * Formats an assessment message for display by adding a color depending on the
 * assessments score.
 *
 * @param assessment The assessment for which the message is printed.
 * @param message Message to be formatted.
 */
export function formatAssessmentMessage(
  assessment: IndividualAssessment | SkippedIndividualAssessment,
  message: string
): string {
  if (assessment.state === IndividualAssessmentState.SKIPPED) {
    return chalk.gray(message);
  }
  return formatScore(assessment.successPercentage, message);
}

/**
 * Formats a score message for display by adding a color depending on its value.
 *
 * @param score Score percentage that was achieved. Between 0 and 1.
 * @param message Message to be formatted.
 */
export function formatScore(score: number, message: string): string {
  let formatFn: (value: string) => string;

  if (score >= 0.8) {
    formatFn = chalk.green; // Green for high scores
  } else if (score >= 0.5) {
    formatFn = chalk.yellow; // Yellow for medium scores
  } else {
    formatFn = chalk.red; // Red for low scores
  }

  return formatFn(message);
}

/**
 * Converts a JavaScript object into a JSON string, pretty-printed with an
 * indent of 2 spaces.
 *
 * @param obj The JavaScript object to convert to a JSON string.
 * @returns A JSON string representation of the object.
 */
export function printJson(obj: {}): string {
  return JSON.stringify(obj, null, 2);
}

/** Returns a green checkmark icon. */
export function greenCheckmark(): string {
  return chalk.green('✔');
}

/** Returns a yellow warning icon. */
export function yellowWarning(): string {
  return chalk.yellow('⚠');
}

/** Returns a red X icon. */
export function redX(): string {
  return chalk.red('✘');
}
