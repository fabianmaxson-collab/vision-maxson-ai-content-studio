import type { z } from 'zod';
import type { storyboardOutputV2Schema } from '@vision-maxson/contracts';
import {
  editorialLanguageFindings,
  scriptCritiqueSourcePrimaryLanguage,
  SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES,
} from './critique-language';

type Storyboard = z.infer<typeof storyboardOutputV2Schema>;

export class StoryboardLanguageCapabilityError extends Error {
  readonly status = 422;
  readonly code = 'storyboard_language_not_supported';
  readonly stage = 'STORYBOARD_PLANNER';
  readonly supportedPrimaryLanguages = SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES;
  constructor(readonly sourceLanguage: string) {
    super('storyboard_language_not_supported: sourceLanguage=' + sourceLanguage);
  }
}

export function storyboardSourcePrimaryLanguage(sourceLanguage: string) {
  try {
    return scriptCritiqueSourcePrimaryLanguage(sourceLanguage);
  } catch {
    throw new StoryboardLanguageCapabilityError(sourceLanguage);
  }
}

export function storyboardLanguageFindings(output: Storyboard, sourceLanguage: string) {
  storyboardSourcePrimaryLanguage(sourceLanguage);
  const fields: Array<{ field: string; text: string; codeMismatch?: boolean }> = [];
  const add = (field: string, text: string) => {
    if (text.trim()) fields.push({ field, text });
  };
  for (const [i, scene] of output.scenes.entries()) {
    const prefix = `scenes[${i}]`;
    add(`${prefix}.visualDescription`, scene.visualDescription);
    add(`${prefix}.location`, scene.location);
    add(`${prefix}.action`, scene.action);
    add(`${prefix}.cameraFraming`, scene.cameraFraming);
    add(`${prefix}.cameraMovement`, scene.cameraMovement);
    add(`${prefix}.mood`, scene.mood);
    add(`${prefix}.continuityNotes`, scene.continuityNotes);
    add(`${prefix}.transitionNotes`, scene.transitionNotes);
    add(`${prefix}.safeAreaGuidance.notes`, scene.safeAreaGuidance.notes);
    for (const [j, text] of scene.onScreenText.entries()) {
      if (text.languageCode !== sourceLanguage)
        fields.push({
          field: `${prefix}.onScreenText[${j}].languageCode`,
          text: '',
          codeMismatch: true,
        });
      add(`${prefix}.onScreenText[${j}].text`, text.text);
    }
    if (scene.captions.languageCode !== sourceLanguage)
      fields.push({ field: `${prefix}.captions.languageCode`, text: '', codeMismatch: true });
    add(`${prefix}.captions.styleGuidance`, scene.captions.styleGuidance);
    add(`${prefix}.captions.safeAreaNotes`, scene.captions.safeAreaNotes);
    for (const [j, claim] of scene.factualClaims.entries()) {
      add(`${prefix}.factualClaims[${j}].claimText`, claim.claimText);
      add(`${prefix}.factualClaims[${j}].visualTreatment`, claim.visualTreatment);
    }
    for (const [j, asset] of scene.assetRequirements.entries())
      add(`${prefix}.assetRequirements[${j}]`, asset);
    for (const [j, media] of scene.mediaReferences.entries()) {
      add(`${prefix}.mediaReferences[${j}].requirement`, media.requirement);
      add(`${prefix}.mediaReferences[${j}].notes`, media.notes);
    }
    add(`${prefix}.generationInstructions`, scene.generationInstructions);
    add(`${prefix}.audioGuidance.ambience`, scene.audioGuidance.ambience);
    for (const [j, sound] of scene.audioGuidance.soundEffects.entries())
      add(`${prefix}.audioGuidance.soundEffects[${j}]`, sound);
    add(`${prefix}.audioGuidance.music.guidance`, scene.audioGuidance.music.guidance);
  }
  const mismatchedCode = fields.filter((field) => field.codeMismatch === true);
  return [
    ...mismatchedCode.map((field) => ({ field: field.field, reason: 'language_code_mismatch' })),
    ...editorialLanguageFindings(
      fields.filter((field) => !field.codeMismatch),
      sourceLanguage,
    ),
  ];
}
