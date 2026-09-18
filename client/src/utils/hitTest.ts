import { BoardElement } from '../types';

const distToSegment = (
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

// 判断元素是否被橡皮（以 x,y 为圆心、radius 为半径）命中。
// 坐标系与渲染保持一致：path/line 的 points 为绝对坐标，其余类型使用 x/y/width/height。
export const isElementHitByEraser = (
  el: BoardElement,
  x: number,
  y: number,
  radius: number
): boolean => {
  const r = radius + (el.strokeWidth || 2) / 2;

  switch (el.type) {
    case 'path':
    case 'line': {
      const pts = el.points || [];
      if (pts.length === 0) return false;
      if (pts.length === 2) return Math.hypot(x - pts[0], y - pts[1]) <= r;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (distToSegment(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= r) return true;
      }
      return false;
    }
    case 'rect': {
      const w = el.width || 0;
      const h = el.height || 0;
      return x >= el.x - r && x <= el.x + w + r && y >= el.y - r && y <= el.y + h + r;
    }
    case 'circle': {
      const rx = (el.width || 0) / 2 + r;
      const ry = (el.height || 0) / 2 + r;
      if (rx <= 0 || ry <= 0) return Math.hypot(x - el.x, y - el.y) <= r;
      const nx = (x - el.x) / rx;
      const ny = (y - el.y) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case 'sticky-note': {
      const w = el.width || 160;
      const h = el.height || 120;
      return x >= el.x - r && x <= el.x + w + r && y >= el.y - r && y <= el.y + h + r;
    }
    case 'text': {
      // 渲染使用 16px 字体、fillText 以 (x, y) 为基线，按近似包围盒判定
      const text = el.text || '';
      const w = Math.max(text.length * 16, 16);
      return x >= el.x - r && x <= el.x + w + r && y >= el.y - 16 - r && y <= el.y + 4 + r;
    }
    default:
      return false;
  }
};
