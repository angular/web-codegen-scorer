import { Rating } from './rating-types.js';
import {
  successfulBuildRating,
  noRuntimeExceptionsRating,
  sufficientCodeSizeRating,
  sufficientGeneratedFilesRating,
  codeQualityRating,
  visualAppearanceRating,
  validCssRating,
  axeRating,
  safetyWebRating,
  userJourneysRating,
  NoInnerHtmlBindingsRating,
  NoDangerouslySetInnerHtmlRating,
  cspViolationsRating,
  trustedTypesViolationsRating,
} from './built-in-ratings/index.js';

/** Set of basic ratings applicable to any framework. */
export function getBuiltInRatings(): Rating[] {
  return [
    successfulBuildRating,
    safetyWebRating,
    noRuntimeExceptionsRating,
    sufficientCodeSizeRating,
    sufficientGeneratedFilesRating,
    codeQualityRating,
    visualAppearanceRating,
    validCssRating,
    axeRating,
    userJourneysRating,
    NoInnerHtmlBindingsRating,
    NoDangerouslySetInnerHtmlRating,
    cspViolationsRating,
    // TODO: Re-enable after https://github.com/google/strict-csp update.
    // trustedTypesViolationsRating,
  ];
}
