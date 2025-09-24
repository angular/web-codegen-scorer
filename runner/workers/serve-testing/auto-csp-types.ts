/**
 * Describes the structure of a Content Security Policy (CSP) violation report
 * sent by the browser.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only#violation_report_syntax
 */
export interface CspViolation {
  /** The page where the violation occurred. */
  'document-uri': string;
  /** The directive that was violated (e.g., 'script-src-elem'). */
  'violated-directive': string;
  /** The full original policy. */
  'original-policy': string;
  /** The disposition of the policy ('enforce' or 'report'). */
  disposition: 'enforce' | 'report';
  /** The URL of the resource that violated the policy, if applicable. */
  'blocked-uri'?: string;
  /** The source file where the violation originated. */
  'source-file'?: string;
  /** The line number in the source file. */
  'line-number'?: number;
  /** The column number in the source file. */
  'column-number'?: number;
  /** A sample of the violating code. */
  'script-sample'?: string;
  /** A custom field we add containing a snippet of the source code around the violation. */
  codeSnippet?: string;
}
