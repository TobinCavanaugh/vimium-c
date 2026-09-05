import { fgCache, math, min_, max_ } from "../lib/utils"
import { createElement_, removeEl_s } from "../lib/dom_utils"
import { boundingRect_ } from "../lib/rect"
import { set_maxPrefixLen_ } from "./hint_filters"

// ---------------------------------------------------------------------------
// Spatial grid hint engine (optional). When enabled and filter mode is off,
// link hints are assigned by screen position using a user-configurable
// gridX x gridY division of the viewport. Cells whose top-left corner bucket
// contains more than one target are recursively subdivided, producing
// compound keys such as "d1", "da", "da3".
// ---------------------------------------------------------------------------

const DEFAULT_COLS = 4
const DEFAULT_ROWS = 4
const MIN_GRID = 2
const MAX_GRID = 12
const MAX_DEPTH = 3
const EMPTY_KEY = ""

interface HintAssignment {
  hint: import("./link_hints").HintItem
  x: number
  y: number
}

function spatialEnabled(): boolean {
  if (!fgCache) return false
  const v = fgCache.x
  return typeof v === "boolean" && v
}

function spatialCols(): number {
  if (!fgCache) return DEFAULT_COLS
  const v = fgCache.q
  if (typeof v === "number" && v >= MIN_GRID && v <= MAX_GRID) return v
  return DEFAULT_COLS
}

function spatialRows(): number {
  if (!fgCache) return DEFAULT_ROWS
  const v = fgCache.z
  if (typeof v === "number" && v >= MIN_GRID && v <= MAX_GRID) return v
  return DEFAULT_ROWS
}

function spatialDebug(): boolean {
  if (!fgCache) return false
  const v = fgCache.i
  return typeof v === "boolean" && v
}

function hintCharPool(): string {
  // In non-filter mode the content script uses fgCache.c (linkHintCharacters)
  // as the sequential hint alphabet. We reuse the same pool for spatial keys.
  return fgCache.c || "asdfghjklqwertyuiopzxcvbnm"
}

function colOf(x: number, boxL: number, boxW: number, cols: number): number {
  if (boxW <= 0) return 0
  const rel = x - boxL
  const col = math.floor(rel / (boxW / cols))
  return max_(0, min_(col, cols - 1))
}

function rowOf(y: number, boxT: number, boxH: number, rows: number): number {
  if (boxH <= 0) return 0
  const rel = y - boxT
  const row = math.floor(rel / (boxH / rows))
  return max_(0, min_(row, rows - 1))
}

function cellKeyFor(index: number, pool: string): string {
  const base = pool.length
  if (base <= 0) return String(index + 1)
  if (index < base) return pool[index]
  // Encode index in base-(pool.length) using the pool characters.
  // This ensures unique, selectable keys even when the grid exceeds the pool.
  const digits: string[] = []
  let n = index
  while (n > 0) {
    digits.push(pool[n % base])
    n = (n / base) | 0
  }
  digits.reverse()
  return digits.join("")
}

function recomputeMaxPrefixLen(hints: readonly import("./link_hints").HintItem[]): void {
  const len = hints.length
  if (len === 0) {
    set_maxPrefixLen_(0)
    return
  }
  let maxLen = 1
  for (let p = 1; p <= 20; p++) {
    const seen = new Set!<string>()
    let unique = true
    for (const hint of hints) {
      const pref = hint.a.length >= p ? hint.a.slice(0, p) : hint.a
      if (seen.has(pref)) {
        unique = false
        break
      }
      seen.add(pref)
    }
    if (unique) {
      maxLen = p
      break
    }
    maxLen = p
  }
  set_maxPrefixLen_(maxLen)
}

/**
 * Assign spatial keys to an array of hint items. Each hint item's marker
 * position is derived from the element's bounding rect; we use the top-left
 * corner to determine the cell bucket, matching how Vimium C positions its
 * hint markers.
 *
 * Keys are assigned hierarchically: when a cell contains more than one hint
 * (by top-left corner), that cell is treated as a new local viewport and
 * subdivided using the same grid dimensions. Keys are concatenated along the
 * path (e.g. "d" -> "d1"). The recursion stops when a cell contains 0 or 1
 * hint, or when MAX_DEPTH is reached.
 */
export function assignSpatialKeys(hints: readonly import("./link_hints").HintItem[]): void {
  if (!spatialEnabled() || hints.length === 0) return
  const pool = hintCharPool()
  const cols = spatialCols()
  const rows = spatialRows()
  const totalCells = cols * rows
  if (totalCells <= 0) return

  const vw = window.innerWidth || 0
  const vh = window.innerHeight || 0
  if (vw <= 0 || vh <= 0) return

  const assigned: HintAssignment[] = hints.map(hint => {
    const el = hint.d
    let rect: Rect | null = null
    try {
      rect = boundingRect_(el)
    } catch { /* ignore */ }
    const x = rect ? rect.l : 0
    const y = rect ? rect.t : 0
    return { hint, x, y }
  })

  for (let i = 0; i < hints.length; i++) {
    hints[i].a = EMPTY_KEY
  }

  const recurse = (
    items: HintAssignment[],
    box: Rect,
    prefix: string,
    depth: number
  ): void => {
    if (items.length === 0) return
    if (items.length === 1) {
      items[0].hint.a = prefix || EMPTY_KEY
      return
    }

    const boxW = box.r - box.l
    const boxH = box.b - box.t
    if ((boxW <= 0 || boxH <= 0) || depth >= MAX_DEPTH) {
      for (let i = 0; i < items.length; i++) {
        items[i].hint.a = prefix + String(i + 1)
      }
      return
    }

    const cellMap = new Map<number, HintAssignment[]>()
    for (const it of items) {
      const col = colOf(it.x, box.l, boxW, cols)
      const row = rowOf(it.y, box.t, boxH, rows)
      const cellIndex = row * cols + col
      let arr = cellMap.get(cellIndex)
      if (!arr) {
        arr = []
        cellMap.set(cellIndex, arr)
      }
      arr.push(it)
    }

    let multipleCells = false
    cellMap.forEach((arr) => {
      if (!multipleCells && arr.length > 1) multipleCells = true
    })

    if (!multipleCells) {
      cellMap.forEach((arr) => {
        const it = arr[0]
        const col = colOf(it.x, box.l, boxW, cols)
        const row = rowOf(it.y, box.t, boxH, rows)
        const cellIndex = row * cols + col
        const cellKey = cellKeyFor(cellIndex, pool)
        it.hint.a = prefix + cellKey
      })
      return
    }

    cellMap.forEach((arr) => {
      const first = arr[0]
      const col = colOf(first.x, box.l, boxW, cols)
      const row = rowOf(first.y, box.t, boxH, rows)
      const cellIndex = row * cols + col
      const cellKey = cellKeyFor(cellIndex, pool)

      const cellL = box.l + col * (boxW / cols)
      const cellT = box.t + row * (boxH / rows)
      const cellR = cellL + (boxW / cols)
      const cellB = cellT + (boxH / rows)

      recurse(arr, { l: cellL, t: cellT, r: cellR, b: cellB }, prefix + cellKey, depth + 1)
    })
  }

  recurse(assigned, { l: 0, t: 0, r: vw, b: vh }, EMPTY_KEY, 0)

  for (const hint of hints) {
    if (!hint.a) {
      hint.a = EMPTY_KEY
    }
  }

  recomputeMaxPrefixLen(hints)
}

// ---------------------------------------------------------------------------
// Debug overlay
// ---------------------------------------------------------------------------

let debugCanvas_: HTMLCanvasElement | null = null

function ensureDebugCanvas(): HTMLCanvasElement | null {
  if (debugCanvas_) return debugCanvas_
  if (!document.body) return null
  const canvas = createElement_("canvas")
  canvas.id = "vimium-spatial-debug-canvas"
  canvas.style.position = "fixed"
  canvas.style.top = "0"
  canvas.style.left = "0"
  canvas.style.width = "100vw"
  canvas.style.height = "100vh"
  canvas.style.pointerEvents = "none"
  canvas.style.zIndex = "2147483647"
  canvas.style.visibility = "hidden"
  try {
    document.body.appendChild(canvas)
  } catch { /* ignore */ }
  debugCanvas_ = canvas
  return canvas
}

function destroyDebugCanvas(): void {
  if (debugCanvas_) {
    try {
      removeEl_s(debugCanvas_)
    } catch { /* ignore */ }
    debugCanvas_ = null
  }
}

function drawDebugOverlay(): void {
  if (!spatialDebug()) {
    destroyDebugCanvas()
    return
  }
  const canvas = ensureDebugCanvas()
  if (!canvas) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth || 0
  const h = window.innerHeight || 0
  if (w <= 0 || h <= 0) {
    canvas.style.visibility = "hidden"
    return
  }

  canvas.width = math.round(w * dpr)
  canvas.height = math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.clearRect(0, 0, w, h)

  const cols = spatialCols()
  const rows = spatialRows()
  const pool = hintCharPool()

  const stepX = w / cols
  const stepY = h / rows

  ctx.strokeStyle = "rgba(255, 90, 95, 0.45)"
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let c = 1; c < cols; c++) {
    const x = math.round(c * stepX) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let r = 1; r < rows; r++) {
    const y = math.round(r * stepY) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()

  ctx.font = "12px monospace"
  ctx.fillStyle = "rgba(255, 90, 95, 0.85)"
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      const key = index < pool.length ? pool[index] : String(index + 1)
      const x = c * stepX + 8
      const y = r * stepY + 18
      const maxX = (c + 1) * stepX - 8
      let label = `[${key}]`
      if (ctx.measureText(label).width > maxX - x) {
        label = key
      }
      ctx.fillText(label, x, y)
    }
  }

  canvas.style.visibility = "visible"
}

/**
 * Called externally to (re)draw the debug overlay. No-op when debug is off.
 */
export function redrawDebugOverlay(): void {
  if (!spatialDebug()) {
    destroyDebugCanvas()
    return
  }
  // Defer to the next animation frame to avoid janking the hint activation
  // path.
  requestAnimationFrame(() => {
    drawDebugOverlay()
  })
}

/**
 * Tear down the debug overlay. Called when hint mode exits.
 */
export function clearDebugOverlay(): void {
  destroyDebugCanvas()
}
