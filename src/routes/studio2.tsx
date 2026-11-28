import { createFileRoute, Link, useBlocker } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AndroidBodyProfile } from '@/components/studio/AndroidBodyProfile'
import { AndroidGalleryDialog } from '@/components/studio/AndroidGalleryDialog'
import { AndroidImageViewer } from '@/components/studio/AndroidStudioUi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ANDROID_IMAGE_MODELS, androidStudio, isAndroidStudio } from '@/lib/androidStudio'
import { CHANGES, MODEL_QUALITIES, MODEL_SIZES, emptyStudio2, makeCharacterVersion, planFixedEdit,
  readStudio2, readStudio2Image, stageStudio2Image, writeStudio2, writeStudio2Draft,
  type Change, type ExtraKind, type StoredImage, type Studio2Draft, type Studio2State } from '@/lib/androidFixedCharacter'
import { defaultBodyProfile, type BodyProfile, type BodyPreset } from '@/lib/bodyProfile'
import { toast } from '@/lib/notifications'
import { useStudio } from '@/store/studioStore'

export const Route = createFileRoute('/studio2')({
  staticData: { title: '合成台 2' },
  validateSearch: (search: Record<string, unknown>) => ({
    source: typeof search.source === 'string' ? search.source.slice(0, 120) : undefined,
  }),
  component: Studio2Entry,
})

const panel = 'space-y-3 rounded-xl border bg-card p-3'
const field = 'min-h-11 min-w-0 w-full rounded-lg border bg-background px-2 text-sm'
const extraKinds: ExtraKind[] = ['background', 'light', 'style']
type PickTarget = 'master' | 'identity' | 'outfit' | 'pose' | ExtraKind
type Editor = { assetId?: string; name: string; description: string; master?: StoredImage; identity?: StoredImage;
  confirmed: boolean; reviewBody: boolean; body: BodyProfile; sourceHistoryId?: string }

function Studio2Entry() {
  return isAndroidStudio() ? <Studio2Page /> : <Link to="/studio">返回合成台</Link>
}

function Studio2Thumb({ image, label, onOpen }: { image: StoredImage; label: string; onOpen: (image: StoredImage) => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    void readStudio2Image(image, true).then(url => { if (active) setSrc(url) }, () => {})
    return () => { active = false }
  }, [image])
  return <button type="button" className="grid min-w-0 gap-1 rounded-lg border p-1 text-xs" onClick={() => onOpen(image)}>
    {src && <img src={src} alt="" className="aspect-square w-full rounded-md object-contain" loading="lazy" decoding="async" />}
    <span>{label}</span>
  </button>
}

function Studio2Page() {
  const { history, hydrated, bodyPresets, apiConfig } = useStudio()
  const { source } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [state, setState] = useState<Studio2State>()
  const latest = useRef<Studio2State>(undefined)
  const op = useRef(false)
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor>()
  const [presets, setPresets] = useState<BodyPreset[]>()
  const [extra, setExtra] = useState<ExtraKind>('background')
  const [gallery, setGallery] = useState<{ slot: 'portrait' | 'costume' | 'pose'; target: PickTarget }>()
  const [preview, setPreview] = useState('')
  const [lastRun, setLastRun] = useState('')
  const [historyLimit, setHistoryLimit] = useState(6)
  useBlocker({
    shouldBlockFn: ({ current, next }) => op.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => op.current,
  })

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const load = () => readStudio2().then(saved => {
    if (!active.current || latest.current) return
    const value = saved ?? emptyStudio2(apiConfig.providers.gpt.model)
    if (value.schema !== 1 || !Array.isArray(value.assets) || !Array.isArray(value.history)) throw Error('人物资产数据版本不受支持')
    latest.current = value
    setState(value)
    setError('')
  }, () => { throw Error('读取本机人物资产失败') })
  useEffect(() => {
    if (!hydrated) return
    void load().catch(() => { if (active.current) setError('读取本机人物资产失败，请重试') })
    // The initial provider model is read only once and is not written back to the original form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  const persist = async (next: Studio2State, photos: Awaited<ReturnType<typeof stageStudio2Image>>[] = []) => {
    await writeStudio2(next, photos)
    latest.current = next
    if (active.current) setState(next)
  }
  const run = async (task: () => Promise<void>) => {
    if (op.current || !latest.current) return
    op.current = true
    setBusy(true)
    setError('')
    try { await task() }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : '操作失败，请检查本机存储后重试') }
    finally { op.current = false; if (active.current) setBusy(false) }
  }
  const updateDraft = (patch: Partial<Studio2Draft>) => {
    const prior = latest.current
    if (!prior || op.current) return
    const next = { ...prior, draft: { ...prior.draft, ...patch } }
    latest.current = next
    setState(next)
    void writeStudio2Draft(next.draft).catch(() => { if (active.current) setError('未能保存草稿，请检查存储空间后重试') })
    setLastRun('')
  }
  const startEditor = () => {
    setPresets(bodyPresets)
    setEditor({ name: '', description: '', confirmed: false, reviewBody: false, body: defaultBodyProfile(false) })
  }
  const promote = (dataUrl: () => Promise<string>, body?: BodyProfile, sourceHistoryId?: string) => run(async () => {
    const image = await stageStudio2Image(await dataUrl())
    const prior = latest.current!
    await persist(prior, [image])
    if (!active.current) return
    setPresets(bodyPresets)
    setEditor({ name: '', description: '', master: image.image, identity: image.image, sourceHistoryId,
      confirmed: false, reviewBody: false, body: body ?? defaultBodyProfile(false) })
    window.scrollTo({ top: 0 })
  })
  const autoSource = useRef('')
  useEffect(() => {
    if (!state || !source || autoSource.current === source) return
    autoSource.current = source
    const item = history.find(entry => entry.id === source)
    if (item) void promote(async () => item.imageUrl, item.snapshot?.recipe.bodyProfile, item.id)
    else setError('找不到所选历史图片，请从历史或相册重新选择')
    void navigate({ search: { source: undefined }, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, state, history])

  const setReferencePhoto = async (target: PickTarget, dataUrl: string) => {
    const image = await stageStudio2Image(dataUrl)
    const prior = latest.current!
    if (target === 'master' || target === 'identity') {
      await persist(prior, [image])
      if (active.current) setEditor(value => value && ({ ...value, [target]: image.image, confirmed: false,
        ...(target === 'master' ? { sourceHistoryId: undefined } : {}) }))
      return
    }
    const draft = target === 'outfit' || target === 'pose' ? { ...prior.draft, [target]: image.image }
      : { ...prior.draft, extras: [...prior.draft.extras.filter(ref => ref.kind !== target), { kind: target, image: image.image }] }
    await persist({ ...prior, draft, }, [image])
    if (active.current) setLastRun('')
  }
  const pick = (target: PickTarget) => run(async () => {
    const result = await androidStudio.pickImage()
    if (!('cancelled' in result)) await setReferencePhoto(target, result.dataUrl)
  })
  const saveAsset = () => run(async () => {
    if (!editor?.confirmed || !editor.reviewBody || !editor.master || !editor.identity || !editor.name.trim())
      throw Error('请填写名称并确认身份、全身母版和形体快照')
    const prior = latest.current!
    const existing = prior.assets.find(asset => asset.id === editor.assetId)
    await Promise.all([readStudio2Image(editor.master), readStudio2Image(editor.identity)])
    const version = makeCharacterVersion({ master: editor.master, identity: editor.identity, body: editor.body, sourceHistoryId: editor.sourceHistoryId }, existing)
    const asset = { id: existing?.id ?? crypto.randomUUID(), name: editor.name.trim(), description: editor.description.trim(),
      versions: [...(existing?.versions ?? []), version] }
    await persist({ ...prior, assets: [asset, ...prior.assets.filter(a => a.id !== asset.id)],
      draft: { ...prior.draft, assetId: asset.id, version: version.number } })
    if (active.current) { setEditor(undefined); setLastRun(''); toast.success(`已保存人物母版 v${version.number}`) }
  })
  const asset = state?.assets.find(a => a.id === state.draft.assetId)
  const version = asset?.versions.find(v => v.number === state?.draft.version)
  const draft = state?.draft
  const planned = useMemo(() => {
    if (!draft) return {}
    try { return { plan: planFixedEdit(draft, version) } }
    catch (failure) { return { problem: failure instanceof Error ? failure.message : '无法构建本次请求' } }
  }, [draft, version])
  const show = (image: StoredImage) => {
    void readStudio2Image(image).then(setPreview, () => setError('本机图片读取失败'))
  }
  const startVersion = () => {
    if (!version || !asset) return
    setPresets(bodyPresets)
    setEditor({ assetId: asset.id, name: asset.name, description: asset.description, master: version.master, identity: version.identity,
      body: version.body ?? defaultBodyProfile(false), confirmed: false, reviewBody: false, sourceHistoryId: version.sourceHistoryId })
  }
  const generate = () => run(async () => {
    const prior = latest.current!
    if (!version || !asset) throw Error('请先选定人物资产')
    const { prompt, references } = planFixedEdit(prior.draft, version)
    const images = await Promise.all(references.map(ref => readStudio2Image(ref.image)))
    const { model, size, quality } = prior.draft
    const { dataUrl } = await androidStudio.generate({ provider: 'gpt', model, size, quality, images, prompt })
    const saved = await stageStudio2Image(dataUrl, true)
    const record = { id: crypto.randomUUID(), createdAt: Date.now(), assetName: asset.name, version,
      draft: prior.draft, references, prompt, result: saved.image }
    await persist({ ...prior, history: [record, ...prior.history] }, [saved])
    if (active.current) { setLastRun(record.id); setPreview(dataUrl) }
  })

  if (!state || !draft) return <div className={panel}>
    <h1>合成台 2</h1><p role="status">{error || '正在读取本机人物资产…'}</p>
    {error && <Button onClick={() => void load().catch(() => setError('读取本机人物资产失败，请重试'))}>重试</Button>}
  </div>
  const changeKeys = Object.keys(CHANGES) as Change[]
  const editText = (key: Change, value: string) => updateDraft({ descriptions: { ...draft.descriptions, [key]: value } })
  const galleryButton = (slot: 'portrait' | 'costume' | 'pose', target: PickTarget, label: string) =>
    <Button type="button" disabled={busy} variant="outline" onClick={() => setGallery({ slot, target })}>{label}</Button>
  const thumb = (image: StoredImage, label: string) => <Studio2Thumb key={image.id + label} image={image} label={label} onOpen={show} />
  return <>
    <header className="space-y-1">
      <h1 className="text-xl font-semibold">合成台 2</h1>
      <p className="text-sm text-muted-foreground">用确认过的全身母版编辑同一人物。与原合成台的草稿、历史独立。可减少漂移，不保证锁定 3D 形体。</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-destructive/50 p-2 text-sm text-destructive">{error}</p>}
    <section className={panel}>
      <h2 className="font-semibold">固定人物资产</h2>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={startEditor}>创建人物资产</Button>
        {version && <Button type="button" disabled={busy} variant="outline" onClick={startVersion}>创建新版本</Button>}
      </div>
      {editor && <fieldset disabled={busy} className="space-y-3 rounded-lg border p-2">
        <legend className="px-1 text-sm font-semibold">{editor.assetId ? '确认新版本' : '确认新人物母版'}</legend>
        <label className="grid gap-1 text-sm">人物名称<Input value={editor.name} maxLength={60} onChange={e => setEditor({ ...editor, name: e.currentTarget.value })} /></label>
        <label className="grid gap-1 text-sm">本地描述<Input value={editor.description} maxLength={160} onChange={e => setEditor({ ...editor, description: e.currentTarget.value })} /></label>
        <div className="grid grid-cols-2 gap-2">{editor.master && thumb(editor.master, '全身母版')}{editor.identity && thumb(editor.identity, '身份参考')}</div>
        <p className="text-xs text-muted-foreground">建议选择从头到脚完整、少遮挡、穿普通不透明服装的照片。裁切、宽松服饰或遮挡会降低形体参考效果。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" type="button" onClick={() => void pick('master')}>从相册选全身母版</Button>
          <Button variant="outline" type="button" onClick={() => void pick('identity')}>从相册选身份图</Button>
          {galleryButton('portrait', 'identity', '从人像库选身份图')}
          {editor.master && <Button variant="outline" type="button" onClick={() => setEditor({ ...editor, identity: editor.master, confirmed: false })}>母版兼作身份图</Button>}
        </div>
        <AndroidBodyProfile value={editor.body} presets={presets ?? bodyPresets} onPresetsChange={setPresets}
          onChange={body => setEditor({ ...editor, body, reviewBody: false })} disabled={busy} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.confirmed}
          onChange={e => setEditor({ ...editor, confirmed: e.currentTarget.checked })} />我确认身份图及母版可作为该版本基准</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.reviewBody}
          onChange={e => setEditor({ ...editor, reviewBody: e.currentTarget.checked })} />我已检查形体快照，冲突时以确认的母版为准</label>
        <div className="flex gap-2"><Button type="button" onClick={() => void saveAsset()}>确认并保存</Button>
          <Button type="button" variant="outline" onClick={() => setEditor(undefined)}>取消</Button></div>
      </fieldset>}
      <details>
        <summary className="cursor-pointer text-sm">从原合成台的近期历史创建</summary>
        <div className="mt-2 grid gap-1">
          {history.filter(item => /^data:image\/(png|jpeg);base64,/.test(item.imageUrl)).slice(0, 8).map(item =>
            <Button key={item.id} type="button" variant="outline" disabled={busy}
              className="justify-start truncate" onClick={() => void promote(async () => item.imageUrl, item.snapshot?.recipe.bodyProfile, item.id)}>
              {new Date(item.createdAt).toLocaleDateString()} · {item.recipeSummary}
            </Button>)}
        </div>
      </details>
      <label className="grid gap-1 text-sm">人物
        <select className={field} value={draft.assetId} disabled={busy} onChange={e => {
          const id = e.currentTarget.value
          updateDraft({ assetId: id, version: state.assets.find(a => a.id === id)?.versions.at(-1)?.number ?? 0 })
        }}>
          <option value="">选择已确认人物</option>
          {state.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {asset && version && <>
        <label className="grid gap-1 text-sm">人物版本<select className={field} value={draft.version} disabled={busy}
          onChange={e => updateDraft({ version: Number(e.currentTarget.value) })}>
          {asset.versions.map(v => <option key={v.number} value={v.number}>v{v.number}</option>)}
        </select></label>
        <div className="grid max-w-sm grid-cols-2 gap-2">{thumb(version.master, '全身母版')}{thumb(version.identity, '身份参考')}</div>
        {asset.description && <p className="text-sm">{asset.description}</p>}
        <div className="text-xs text-muted-foreground">{version.body?.enabled ? `形体快照：${version.body.headRatio.toFixed(1)} 头身 · ${version.body.bodyType}` : '形体以母版为准，未启用文字快照'}</div>
      </>}
    </section>
    <section className={panel}>
      <h2 className="font-semibold">本次修改</h2>
      <p className="text-xs text-muted-foreground">只改勾选的项目。附加参考只负责背景、光影或画风；需要改变人物形体时，请另建人物版本。</p>
      <fieldset disabled={busy} className="space-y-3">
        {changeKeys.map(key => <div key={key} className="space-y-2">
          <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={draft.changes.includes(key)}
            onChange={e => updateDraft({ changes: e.currentTarget.checked ? [...draft.changes, key] : draft.changes.filter(k => k !== key) })} />
            {CHANGES[key]}</label>
          {draft.changes.includes(key) && <>
            <Textarea aria-label={CHANGES[key] + '目标'} value={draft.descriptions[key] ?? ''} placeholder={'仅填写本项要怎样修改'}
              maxLength={1000} onChange={e => editText(key, e.currentTarget.value)} />
            {(key === 'outfit' || key === 'pose') && <div className="flex flex-wrap items-start gap-2">
              {galleryButton(key === 'outfit' ? 'costume' : 'pose', key, key === 'outfit' ? '选择服饰' : '选择姿势')}
              <Button type="button" variant="outline" onClick={() => void pick(key)}>从相册选参考图</Button>
              {draft[key] && <><div className="w-24">{thumb(draft[key], '本次参考')}</div>
                <Button type="button" variant="ghost" onClick={() => updateDraft({ [key]: undefined })}>移除参考</Button></>}
            </div>}
          </>}
        </div>)}
        {extraKinds.some(kind => draft.changes.includes(kind)) && <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-sm">附加图职责<select className={field} value={draft.changes.includes(extra) ? extra : extraKinds.find(k => draft.changes.includes(k))}
            onChange={e => setExtra(e.currentTarget.value as ExtraKind)}>
            {extraKinds.filter(key => draft.changes.includes(key)).map(key => <option key={key} value={key}>{CHANGES[key]}</option>)}
          </select></label>
          <Button type="button" variant="outline" className="self-end" onClick={() => {
            const target = draft.changes.includes(extra) ? extra : extraKinds.find(k => draft.changes.includes(k))
            if (target) void pick(target)
          }}>从相册选附加图</Button>
        </div>}
        {draft.extras.map(ref => <div key={ref.kind} className="flex items-center gap-2">
          <div className="w-24">{thumb(ref.image, CHANGES[ref.kind])}</div>
          <span className="text-xs">{draft.changes.includes(ref.kind) ? '本次采用' : '本次不发送'}</span>
          <Button type="button" variant="ghost" onClick={() => updateDraft({ extras: draft.extras.filter(item => item.kind !== ref.kind) })}>移除附加图</Button>
        </div>)}
      </fieldset>
    </section>
    <section className={panel}>
      <h2 className="font-semibold">预览与生成</h2>
      <fieldset disabled={busy} className="grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2 grid gap-1">OpenAI 模型<select className={field} value={draft.model} onChange={e => updateDraft({ model: e.currentTarget.value })}>
          {ANDROID_IMAGE_MODELS.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
        <label>尺寸<select className={field} value={draft.size} onChange={e => updateDraft({ size: e.currentTarget.value })}>
          {MODEL_SIZES.map(size => <option key={size}>{size}</option>)}</select></label>
        <label>质量<select className={field} value={draft.quality} onChange={e => updateDraft({ quality: e.currentTarget.value })}>
          {MODEL_QUALITIES.map(quality => <option key={quality}>{quality}</option>)}</select></label>
      </fieldset>
      <Link to="/settings" className="inline-block text-sm text-primary underline">复用现有 OpenAI Key · 打开设置</Link>
      {planned.plan ? <details>
        <summary className="cursor-pointer text-sm font-medium">查看实际发送的图片和提示词</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">{planned.plan.references.map(({ image, roles }, index) =>
          thumb(image, `图${index + 1} · ${roles.map(role => role === 'master' ? '母版' : role === 'identity' ? '身份' : CHANGES[role]).join('、')}`))}</div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{planned.plan.prompt}</pre>
        <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(planned.plan!.prompt)
          .then(() => toast.success('已复制'), () => setError('无法写入剪贴板'))}>复制提示词</Button>
      </details> : <p role="status" className="text-sm text-muted-foreground">{planned.problem}</p>}
      <p className="text-xs text-muted-foreground">点击后仅将上方列出的参考图与提示词发送给 OpenAI，可能产生费用。</p>
      <Button type="button" disabled={busy || !!editor || !planned.plan} onClick={() => void generate()}>{busy ? '处理中…' : '生成图片'}</Button>
      {lastRun && state.history[0]?.id === lastRun && <div className="w-28">{thumb(state.history[0].result, '最新结果')}</div>}
    </section>
    <details className={panel}>
      <summary className="cursor-pointer font-semibold">合成台 2 的生成历史（{state.history.length}）</summary>
      {state.history.slice(0, historyLimit).map(item => <article key={item.id} className="space-y-2 rounded-lg border p-2">
        <p className="text-sm">{item.assetName} · v{item.version.number} · {new Date(item.createdAt).toLocaleString()}</p>
        <div className="w-28">{thumb(item.result, '生成结果')}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} variant="outline" onClick={() => { updateDraft(item.draft); window.scrollTo({ top: 0 }) }}>还原表单</Button>
          <Button type="button" disabled={busy} variant="outline" onClick={() => void promote(() => readStudio2Image(item.result), item.version.body, item.id)}>保存为人物母版</Button>
        </div>
        <details className="text-xs"><summary className="cursor-pointer">查看当时的图片和提示词</summary>
          <div className="mt-2 grid grid-cols-3 gap-1">{item.references.map(({ image }, i) => thumb(image, `图${i + 1}`))}</div>
          <pre className="mt-2 whitespace-pre-wrap break-words">{item.prompt}</pre>
        </details>
      </article>)}
      {state.history.length > historyLimit && <Button type="button" variant="outline" onClick={() => setHistoryLimit(count => count + 6)}>加载更多</Button>}
    </details>
    {gallery && <AndroidGalleryDialog slot={gallery.slot} onClose={() => setGallery(undefined)} onSelect={item => {
      const target = gallery.target
      setGallery(undefined)
      void run(() => setReferencePhoto(target, item.dataUrl))
    }} />}
    {preview && <AndroidImageViewer imageUrl={preview} open onOpenChange={open => { if (!open) setPreview('') }} />}
  </>
}
