import type { ApiConfig, GenerationHistoryItem, GenerationSnapshot, RecipeState } from '@/types/gallery'
import { durableRecipe } from './persistentImages'
import { validateGenerationSnapshot } from './studioBackup'
import { workflowIdentity } from './comfyWorkflowParameters'
export { durableImage } from './persistentImages'

export async function snapshotGeneration(recipe: RecipeState, config: ApiConfig, prompt: string, customPrompt: string | null): Promise<GenerationSnapshot> {
  const {providers, ...settings} = structuredClone(config)
  const models = Object.fromEntries(Object.entries(providers).map(([key, value]) => [key, {model: value.model, customModel: value.customModel}])) as GenerationSnapshot['models']
  return {recipe: await durableRecipe(recipe), prompt, customPrompt, settings, models}
}


export type HistoryFormRestore =
  | { kind: 'prompt-only'; prompt: string; reason: 'legacy' | 'invalid' }
  | { kind: 'full'; snapshot: GenerationSnapshot; customPrompt: string | null; skippedWorkflowInputs: boolean }

/** Legacy/corrupt records do not provide evidence for the old selections. */
export function prepareHistoryRestore(item: GenerationHistoryItem): HistoryFormRestore {
  if (item.snapshot !== undefined) {
    try {
      const snapshot = validateGenerationSnapshot(item.snapshot)
      if (snapshot.settings.activeProvider !== item.provider) throw new Error('历史供应商与快照不一致')
      let skippedWorkflowInputs = false
      if (item.provider === 'comfyui') {
        const { recipe, settings: { comfyuiParams } } = snapshot
        const identity = workflowIdentity(comfyuiParams.workflowJson)
        if (!identity) throw new Error('原始工作流无效')
        // Credential redaction or an old workflow can invalidate node bindings.
        // Do not carry references or overrides onto an unverified graph.
        if (recipe.workflowImagesIdentity !== identity && Object.keys(recipe.workflowImages || {}).length) {
          delete recipe.workflowImages
          delete recipe.workflowImagesIdentity
          skippedWorkflowInputs = true
        }
        if (comfyuiParams.parameterOverrides && comfyuiParams.parameterOverrides.workflowId !== identity) {
          delete comfyuiParams.parameterOverrides
          skippedWorkflowInputs = true
        }
      }
      return { kind: 'full', snapshot, customPrompt: snapshot.customPrompt === undefined ? snapshot.prompt : snapshot.customPrompt, skippedWorkflowInputs }
    } catch { /* Restore the independently recorded prompt only. */ }
  }
  if (typeof item.prompt !== 'string') throw new Error('此记录没有可还原的表单或提示词')
  return { kind: 'prompt-only', prompt: item.prompt, reason: item.snapshot === undefined ? 'legacy' : 'invalid' }
}

/** Restore the selected provider's form, never its connection, or any unrelated provider's setup. */
export function restoreGenerationConfig(current: ApiConfig, snapshot: GenerationSnapshot): ApiConfig {
  const settings = snapshot.settings, activeProvider = settings.activeProvider
  const { model, customModel } = snapshot.models[activeProvider]
  return {
    ...current,
    activeProvider,
    stylePreset: settings.stylePreset,
    ...(activeProvider !== 'comfyui' && { imagePassMode: settings.imagePassMode, sendStitchedSheet: settings.sendStitchedSheet }),
    providers: { ...current.providers, [activeProvider]: { ...current.providers[activeProvider], model, customModel } },
    ...(activeProvider === 'gpt' ? { gptParams: settings.gptParams }
      : activeProvider === 'gemini' ? { geminiParams: settings.geminiParams }
      : activeProvider === 'qwen' ? { qwenParams: settings.qwenParams }
      : activeProvider === 'doubao' ? { doubaoParams: settings.doubaoParams }
      : { comfyuiParams: { ...settings.comfyuiParams, configVersion: current.comfyuiParams.configVersion } }),
  }
}
