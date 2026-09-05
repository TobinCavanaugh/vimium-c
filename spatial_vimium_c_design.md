# Spatial-Hierarchical Hint Engine for Vimium C

## Overview

Traditional hint engines (including Vimium C's default implementation) assign hint strings sequentially based on a flat character pool (e.g., `asdfg...`). While efficient for pure typing speed, this forces the brain to constantly scan random string labels scattered across the viewport. 

This document outlines the architectural design and implementation specification for a **Spatial-Hierarchical Hint Engine** for Vimium C. This engine maps the user's physical key layout directly to a grid coordinate system over the screen. When links are sparse, a single keystroke selects them based on their physical quadrant. When a region is dense, the engine recursively subdivides that region using the same spatial key layout, scaling seamlessly from 1 to $N$ levels without breaking the user's spatial mental model.

---

## Core Architecture

### 1. Dynamic Grid Partitioning (`Grid X` × `Grid Y`)
Instead of hardcoding a fixed 16-key layout, the system reads user-configurable dimensions:
* **`gridX`**: Number of columns across the viewport (e.g., 4)
* **`gridY`**: Number of rows down the viewport (e.g., 4)
* **Key Pool Mapping**: The keys are mapped dynamically from the user's custom character set (e.g., `1234qwerasdfzxcv`). If `gridX * gridY` exceeds the custom key set length, the system gracefully wraps or requires recursive depth.

### 2. Bounding Box & Centroid Assignment
Every interactive element on the page is evaluated by its bounding client rectangle (`getBoundingClientRect()`):
1. Compute the element's **center point (centroid)** `(cx, cy)`.
2. Determine which global grid cell `(col, row)` contains `(cx, cy)`.
3. Assign the corresponding primary key from the user's layout string to that element.

### 3. Hierarchical / Recursive Sub-Routing
If a single grid cell contains more elements than can be uniquely identified by a single key pass (or if density triggers a collision threshold):
* Pressing the primary key (e.g., `d`) filters out all other global elements.
* The targeted cell becomes the new local coordinate space.
* A secondary grid (matching the same `gridX` × `gridY` dimensions or scaled appropriately) is overlaid *strictly* within that cell's bounding box.
* The hints update instantly to reflect compound codes (e.g., `d1`, `da`, `dz`).
* If necessary, this recurses indefinitely (`d -> da -> da3`), though in practice, viewport resolution limits practical needs to 2 levels.

---

## Configuration Options (Vimium C Options Panel)

To integrate seamlessly into Vimium C's existing options page, add the following fields under the **Link Hints** section:

| Setting Name | Field ID | Default | Description |
| :--- | :--- | :--- | :--- |
| **Enable Spatial Grid Hints** | `spatialGridEnabled` | `false` | Toggles the spatial-hierarchical hint engine on/off. |
| **Grid Columns (X)** | `spatialGridCols` | `4` | Number of horizontal divisions across the viewport. |
| **Grid Rows (Y)** | `spatialGridRows` | `4` | Number of vertical divisions down the viewport. |
| **Debug Visual Grid** | `spatialGridDebug` | `false` | Renders a live canvas overlay showing grid lines, cell boundaries, and assigned keys. |

---

## Canvas-Based Debug Overlay

When `spatialGridDebug` is enabled, Vimium C injects a fixed full-screen HTML5 `<canvas>` element overlaying the viewport (pointer events disabled so it never interferes with page interaction). 

### Debug Renderer Specifications
* **Grid Lines**: Draw subtle semi-transparent grid lines dividing the screen into `gridX` × `gridY` sectors.
* **Cell Labels**: Display the primary key and cell coordinate (e.g., `[Zone: d]`) in the top-left corner of each cell.
* **Element Centroids**: Draw small markers at each interactive element's calculated centroid, linking them visually to their assigned grid bucket.

---

## Implementation Blueprint (TypeScript / JavaScript)

Below is the core logic blueprint for calculating grid cells, managing recursive keys, and rendering the debug canvas.

```typescript
interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

class SpatialHintEngine {
  private cols: number;
  private rows: number;
  private keyPool: string[];
  private debugCanvas: HTMLCanvasElement | null = null;

  constructor(cols: number, rows: number, keyPoolString: string) {
    this.cols = cols;
    this.rows = rows;
    this.keyPool = keyPoolString.split('');
  }

  /**
   * Maps an element's bounding rect to a primary grid coordinate.
   */
  public getCellForRect(rect: Rect, viewportWidth: number, viewportHeight: number): { col: number; row: number; key: string } {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;

    const colWidth = viewportWidth / this.cols;
    const rowHeight = viewportHeight / this.rows;

    const col = Math.min(Math.floor(cx / colWidth), this.cols - 1);
    const row = Math.min(Math.floor(cy / rowHeight), this.rows - 1);

    const index = row * this.cols + col;
    const key = this.keyPool[index] || String(index);

    return { col, row, key };
  }

  /**
   * Renders the visual grid and cell keys using HTML5 Canvas for debugging.
   */
  public renderDebugOverlay(enabled: boolean): void {
    if (!enabled) {
      if (this.debugCanvas) {
        this.debugCanvas.remove();
        this.debugCanvas = null;
      }
      return;
    }

    if (!this.debugCanvas) {
      this.debugCanvas = document.createElement('canvas');
      this.debugCanvas.id = 'vimium-spatial-debug-canvas';
      this.debugCanvas.style.position = 'fixed';
      this.debugCanvas.style.top = '0';
      this.debugCanvas.style.left = '0';
      this.debugCanvas.style.width = '100vw';
      this.debugCanvas.style.height = '100vh';
      this.debugCanvas.style.pointerEvents = 'none';
      this.debugCanvas.style.zIndex = '2147483647';
      document.body.appendChild(this.debugCanvas);
    }

    const canvas = this.debugCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const colWidth = width / this.cols;
    const rowHeight = height / this.rows;

    ctx.strokeStyle = 'rgba(255, 90, 95, 0.4)';
    ctx.lineWidth = 1;
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(255, 90, 95, 0.8)';

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * colWidth;
        const y = r * rowHeight;

        ctx.strokeRect(x, y, colWidth, rowHeight);

        const index = r * this.cols + c;
        const key = this.keyPool[index] || '';
        ctx.fillText(`Key: [${key}] (${c},${r})`, x + 8, y + 20);
      }
    }
  }
}
```

---

## User Flow & Interaction Example

1. **Activation**: User presses `f`.
2. **Overlay Display**: Hints appear over links. High-density areas show single primary keys corresponding to their screen region.
3. **First Keystroke (`d`)**: 
   - Elements outside zone `d` vanish.
   - Zone `d` expands or recalculates its internal sub-grid.
   - Secondary characters (`d1`, `da`, `ds`, etc.) render cleanly over the remaining filtered elements.
4. **Second Keystroke (`a`)**: The target element is successfully activated.
5. **Debugging**: Toggling the debug panel checkbox illuminates the background grid dynamically via canvas, verifying exact coordinate alignment instantly.
