import { uploadedReferences } from './recipeImages'

type Drawing = (ctx: CanvasRenderingContext2D) => void

function png(draw: Drawing) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法载入内置示例')
  ctx.fillStyle = '#f3efea'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(128, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  draw(ctx)
  return canvas.toDataURL('image/png')
}

function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
}

function line(ctx: CanvasRenderingContext2D, points: [number, number][], color: string, width: number, fill = false) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const point of points.slice(1)) ctx.lineTo(...point)
  if (fill) { ctx.closePath(); ctx.fillStyle = color; ctx.fill() }
  else { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke() }
}

/** Original schematic examples only. No bundled faces or third-party photos. */
export function androidSampleReferences() {
  const face = png(ctx => {
    oval(ctx, 0, 252, 82, 46, '#516477')
    oval(ctx, 0, 130, 60, 76, '#344052')
    oval(ctx, 0, 147, 45, 57, '#c68969')
    line(ctx, [[-46, 124], [-44, 101], [-20, 79], [31, 88], [49, 120], [22, 111], [-5, 96]], '#344052', 1, true)
    oval(ctx, -17, 144, 3, 2.5, '#323039'); oval(ctx, 17, 144, 3, 2.5, '#323039')
    line(ctx, [[-10, 171], [0, 174], [10, 171]], '#79463e', 2)
  })
  const outfit = png(ctx => {
    line(ctx, [[-33, 65], [-75, 82], [-92, 126], [-67, 141], [-48, 106], [-47, 203], [47, 203], [48, 106], [67, 141], [92, 126], [75, 82], [33, 65], [0, 89]], '#4a6c82', 1, true)
    line(ctx, [[-39, 204], [-44, 274], [-8, 274], [0, 232], [8, 274], [44, 274], [39, 204]], '#343c48', 1, true)
    line(ctx, [[0, 89], [0, 203]], '#e6e1da', 2)
  })
  const pose = png(ctx => {
    const color = '#536477'
    oval(ctx, 0, 57, 20, 21, color)
    line(ctx, [[0, 82], [-4, 151], [15, 184]], color, 25)
    line(ctx, [[-2, 100], [-47, 134], [-63, 179]], color, 13)
    line(ctx, [[1, 101], [41, 120], [69, 90]], color, 13)
    line(ctx, [[14, 175], [-22, 220], [-39, 270], [-55, 274]], color, 15)
    line(ctx, [[14, 175], [43, 224], [53, 270], [69, 274]], color, 15)
  })
  return {
    portrait: uploadedReferences('示例人像 · 插画', face, 256, 320, 0).portrait,
    costume: uploadedReferences('示例服装 · 夹克', outfit, 256, 320, 0).costume,
    pose: uploadedReferences('示例姿势 · 站姿', pose, 256, 320, 0).pose,
  }
}
