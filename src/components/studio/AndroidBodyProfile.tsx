import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/notifications'
import {
  BODY_DESCRIPTION_MAX, BODY_FIELDS, BODY_OPTIONS, BODY_PRESET_LIMIT, BODY_VOLUME_LEVELS, BUILTIN_BODY_PRESETS, HEAD_RATIO,
  bodyDescriptionConflicts, bodyVolumeLevel, buildBodyPrompt, defaultBodyProfile, normalizeBodyParameters, normalizePresetName,
  type BodyParameters, type BodyPreset, type BodyProfile,
} from '@/lib/bodyProfile'

export function AndroidBodyProfile({ value, presets, onChange, onPresetsChange, disabled }: {
  value?: BodyProfile
  presets: BodyPreset[]
  onChange: (value: BodyProfile) => void
  onPresetsChange: (value: BodyPreset[]) => void
  disabled: boolean
}) {
  const profile = value ?? defaultBodyProfile(false)
  const volume = bodyVolumeLevel(profile.bodyVolume)
  const volumeStep = BODY_VOLUME_LEVELS.indexOf(volume) + 1
  const allPresets = [...BUILTIN_BODY_PRESETS, ...presets]
  const selected = allPresets.find(item => item.id === profile.presetId)
  const editable = presets.find(item => item.id === profile.presetId)
  const changed = selected && (selected.parameters.headRatio !== profile.headRatio ||
    selected.parameters.customDescription !== profile.customDescription || BODY_FIELDS.some(key => selected.parameters[key] !== profile[key]))
  const [action, setAction] = useState<'save' | 'rename' | 'delete' | null>(null)
  const [name, setName] = useState('')
  const update = <K extends keyof BodyParameters>(key: K, next: BodyParameters[K]) => onChange({ ...profile, [key]: next })
  const applyPreset = (id: string) => {
    const preset = allPresets.find(item => item.id === id)
    if (preset) onChange({ ...preset.parameters, enabled: profile.enabled, presetId: preset.id })
    setAction(null)
  }
  const savePreset = () => {
    const normalized = normalizePresetName(name)
    if (!normalized) { toast.error('请输入预设名称'); return }
    if (allPresets.some(item => item.name === normalized && (action !== 'rename' || item.id !== editable?.id))) {
      toast.error('这个预设名称已存在'); return
    }
    if (action === 'rename' && editable) {
      onPresetsChange(presets.map(item => item.id === editable.id ? { ...item, name: normalized } : item))
    } else if (action === 'save' && presets.length < BODY_PRESET_LIMIT) {
      const id = `custom-${crypto.randomUUID()}`
      onPresetsChange([...presets, { id, name: normalized, parameters: normalizeBodyParameters(profile) }])
      onChange({ ...profile, presetId: id })
    }
    setAction(null)
  }
  const fieldClass = 'h-10 min-w-0 w-full rounded-xl border bg-background px-2 text-sm disabled:opacity-60'
  return <details className="min-w-0 rounded-xl border bg-card p-3">
    <summary className="cursor-pointer text-sm font-semibold">
      人物形体 <span className="ml-1 font-normal text-muted-foreground">{profile.enabled
        ? `已启用 · ${profile.headRatio.toFixed(1)} 头身 · ${profile.bodyType}` : '未启用'}</span>
    </summary>
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <label htmlFor="android-body-enabled">启用独立人物形体</label>
      <Switch id="android-body-enabled" disabled={disabled} checked={profile.enabled}
        onCheckedChange={enabled => onChange({ ...profile, enabled })} />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">只调整提示词，不锁定 3D 几何。换人像、服饰、动作或画风不会重置这些设置。</p>
    <fieldset disabled={disabled} className="mt-3 min-w-0 space-y-3">
      <label className="grid gap-1 text-xs">形体预设
        <select aria-label="形体预设" className={fieldClass} value={selected?.id ?? ''} onChange={event => applyPreset(event.currentTarget.value)}>
          <option value="" disabled>自定义参数</option>
          <optgroup label="内置">{BUILTIN_BODY_PRESETS.map(item =>
            <option key={item.id} value={item.id}>{item.name}{selected?.id === item.id && changed ? '（已调整）' : ''}</option>)}</optgroup>
          {presets.length > 0 && <optgroup label="我的预设">{presets.map(item =>
            <option key={item.id} value={item.id}>{item.name}{selected?.id === item.id && changed ? '（已调整）' : ''}</option>)}</optgroup>}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" type="button" onClick={() => applyPreset('natural')}>恢复默认参数</Button>
        <Button variant="outline" size="sm" type="button" disabled={presets.length >= BODY_PRESET_LIMIT}
          onClick={() => { setName(''); setAction('save') }}>另存为预设</Button>
        {editable && <>
          <Button variant="outline" size="sm" type="button" onClick={() => { setName(editable.name); setAction('rename') }}>重命名</Button>
          <Button variant="outline" size="sm" type="button" onClick={() => setAction('delete')}>删除预设</Button>
        </>}
      </div>
      {(action === 'save' || action === 'rename') && <div className="flex flex-wrap gap-2">
        <Input aria-label="预设名称" className="min-w-0 flex-1" value={name} maxLength={40}
          onChange={event => setName(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') savePreset() }} />
        <Button type="button" size="sm" onClick={savePreset}>保存</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>取消</Button>
      </div>}
      {action === 'delete' && editable && <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
        <span>删除「{editable.name}」？当前参数和历史仍保留。</span>
        <Button type="button" size="sm" variant="destructive" onClick={() => {
          onPresetsChange(presets.filter(item => item.id !== editable.id))
          const next = { ...profile }; delete next.presetId; onChange(next)
          setAction(null)
        }}>确认删除</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>取消</Button>
      </div>}
      <label className="grid gap-1 text-sm">
        <span className="flex justify-between"><span>头身比例</span><output className="font-medium">{profile.headRatio.toFixed(1)} 头身</output></span>
        <input aria-label="头身比例" type="range" min={HEAD_RATIO.min} max={HEAD_RATIO.max} step={HEAD_RATIO.step} value={profile.headRatio}
          className="h-7 w-full accent-primary" onChange={event => update('headRatio', event.currentTarget.valueAsNumber)} />
        <span className="flex justify-between text-xs text-muted-foreground"><span>{HEAD_RATIO.min.toFixed(1)}</span><span>{HEAD_RATIO.max.toFixed(1)}</span></span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {BODY_FIELDS.filter(key => key !== 'bodyVolume').map(key => <label key={key} className="grid min-w-0 gap-1 text-xs">{BODY_OPTIONS[key].label}
          <select aria-label={BODY_OPTIONS[key].label} className={fieldClass} value={profile[key]}
            onChange={event => update(key, event.currentTarget.value as BodyParameters[typeof key])}>
            {BODY_OPTIONS[key].options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>)}
      </div>
      <label className="grid gap-1 text-sm">
        <span className="flex flex-wrap justify-between gap-1">
          <span>身体丰满程度</span>
          <output className="font-medium">{volumeStep} / {BODY_VOLUME_LEVELS.length} · {volume.label}</output>
        </span>
        <input type="range" aria-label="身体丰满程度" aria-valuetext={`第 ${volumeStep} 级：${volume.label}`}
          min={1} max={BODY_VOLUME_LEVELS.length} step={1} value={volumeStep} className="h-8 w-full accent-primary"
          onChange={event => update('bodyVolume', BODY_VOLUME_LEVELS[event.currentTarget.valueAsNumber - 1].id)} />
        <span className="text-xs text-muted-foreground">{volume.promptZh}。</span>
      </label>
      <label className="grid gap-1 text-xs">自定义补充形体描述
        <Textarea rows={2} value={profile.customDescription} maxLength={BODY_DESCRIPTION_MAX}
          placeholder="例如：肩线平缓，四肢肌肉线条自然"
          onChange={event => update('customDescription', event.currentTarget.value)} />
      </label>
      {bodyDescriptionConflicts(profile) && <p role="status" className="text-xs text-destructive">补充词里的头身数值与滑杆不一致，以滑杆为准。</p>}
      <details className="rounded-lg border p-2">
        <summary className="cursor-pointer text-xs font-medium">预览形体提示词</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{buildBodyPrompt(profile) || '未启用，不向模型追加形体提示词。'}</pre>
      </details>
    </fieldset>
  </details>
}
