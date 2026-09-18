import React, { useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWhiteboardStore } from '../store/whiteboard';
import { socketService } from '../services/socket';
import { BoardElement } from '../types';
import { getActiveLayer, getLayerUneditableReason } from '../utils/layers';

const HIT_TOLERANCE = 6;

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 命中判定只用于橡皮，返回元素包围/描边范围是否包含该点（画布坐标）。 */
export function hitTestElement(el: BoardElement, x: number, y: number): boolean {
  const tol = HIT_TOLERANCE;
  switch (el.type) {
    case 'path': {
      if (!el.points || el.points.length < 4) return false;
      for (let i = 0; i < el.points.length - 2; i += 2) {
        if (distanceToSegment(
          x, y,
          el.points[i], el.points[i + 1],
          el.points[i + 2], el.points[i + 3]
        ) <= tol) return true;
      }
      return false;
    }
    case 'line': {
      if (!el.points || el.points.length < 4) return false;
      return distanceToSegment(x, y, el.points[0], el.points[1], el.points[2], el.points[3]) <= tol;
    }
    case 'rect':
    case 'sticky-note': {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      const filled = el.type === 'sticky-note' || (!!el.fill && el.fill !== 'transparent');
      if (filled) {
        return x >= el.x - tol && x <= el.x + w + tol && y >= el.y - tol && y <= el.y + h + tol;
      }
      return x >= el.x - tol && x <= el.x + w + tol && y >= el.y - tol && y <= el.y + h + tol &&
        !(x > el.x + tol && x < el.x + w - tol && y > el.y + tol && y < el.y + h - tol);
    }
    case 'circle': {
      const rx = (el.width ?? 0) / 2;
      const ry = (el.height ?? 0) / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (x - el.x) / rx;
      const ny = (y - el.y) / ry;
      const d = nx * nx + ny * ny;
      const filled = !!el.fill && el.fill !== 'transparent';
      return filled ? d <= 1 + tol / Math.min(rx, ry) : Math.abs(d - 1) <= tol / Math.min(rx, ry) + 0.02;
    }
    case 'text': {
      // 粗略包围盒（约 16px 字号），保证文本可被擦中
      const w = el.text ? el.text.length * 9 : 0;
      return x >= el.x - tol && x <= el.x + w + tol && y >= el.y - 18 && y <= el.y + tol;
    }
    default:
      return false;
  }
}

export const WhiteboardCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef<number[]>([]);
  const startPosRef = useRef({ x: 0, y: 0 });
  const erasedIdsRef = useRef<Set<string>>(new Set());

  const {
    board, activeTool, activeLayerIndex, strokeColor, fillColor, strokeWidth,
    canvasTransform, addElement, deleteElement, notify
  } = useWhiteboardStore();

  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - canvasTransform.translateX) / canvasTransform.scale,
      y: (e.clientY - rect.top - canvasTransform.translateY) / canvasTransform.scale
    };
  }, [canvasTransform]);

  // 工具面板与画板工作台共用同一判定：当前内容层必须未锁定且可见
  const guardEditable = useCallback((): boolean => {
    const { board: currentBoard, activeLayerIndex } = useWhiteboardStore.getState();
    const reason = getLayerUneditableReason(getActiveLayer(currentBoard, activeLayerIndex));
    if (reason) {
      notify(reason);
      return false;
    }
    return true;
  }, [notify]);

  const eraseAt = useCallback((point: { x: number; y: number }) => {
    const { board: currentBoard, activeLayerIndex } = useWhiteboardStore.getState();
    // 只检索当前内容层；该层为空、索引失效（重开画板）都安全无操作，绝不误伤其它层
    const layer = getActiveLayer(currentBoard, activeLayerIndex);
    if (!layer) return;
    for (const el of layer.elements) {
      if (erasedIdsRef.current.has(el.id)) continue;
      if (hitTestElement(el, point.x, point.y)) {
        erasedIdsRef.current.add(el.id);
        deleteElement(el.id); // store 内再次校验锁定/可见性，失败会带原因提示
      }
    }
  }, [deleteElement]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select') return;
    if (!guardEditable()) return; // 锁定/隐藏层：本次按下不进入任何绘制或擦除流程

    const point = getCanvasPoint(e);
    isDrawingRef.current = true;
    startPosRef.current = point;
    currentPathRef.current = [point.x, point.y];
    erasedIdsRef.current = new Set();

    if (activeTool === 'eraser') {
      eraseAt(point); // 单击也应能擦中元素
    }
  }, [activeTool, getCanvasPoint, guardEditable, eraseAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    socketService.moveCursor(point.x, point.y);

    if (!isDrawingRef.current) return;
    if (activeTool === 'eraser') {
      eraseAt(point); // 连续拖拽擦除，仅作用于当前未锁定且可见的内容层
      return;
    }
    currentPathRef.current.push(point.x, point.y);
  }, [getCanvasPoint, activeTool, eraseAt]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const point = getCanvasPoint(e);
    let element: BoardElement | null = null;

    switch (activeTool) {
      case 'pen':
        element = {
          id: uuidv4(), type: 'path', x: 0, y: 0,
          points: [...currentPathRef.current],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
        break;
      case 'rect':
        element = {
          id: uuidv4(), type: 'rect',
          x: Math.min(startPosRef.current.x, point.x),
          y: Math.min(startPosRef.current.y, point.y),
          width: Math.abs(point.x - startPosRef.current.x),
          height: Math.abs(point.y - startPosRef.current.y),
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
        break;
      case 'circle': {
        const cx = (startPosRef.current.x + point.x) / 2;
        const cy = (startPosRef.current.y + point.y) / 2;
        const rx = Math.abs(point.x - startPosRef.current.x) / 2;
        const ry = Math.abs(point.y - startPosRef.current.y) / 2;
        element = {
          id: uuidv4(), type: 'circle', x: cx, y: cy,
          width: rx * 2, height: ry * 2,
          fill: fillColor, stroke: strokeColor, strokeWidth
        };
        break;
      }
      case 'line':
        element = {
          id: uuidv4(), type: 'line',
          x: startPosRef.current.x, y: startPosRef.current.y,
          points: [startPosRef.current.x, startPosRef.current.y, point.x, point.y],
          stroke: strokeColor, strokeWidth, fill: 'transparent'
        };
        break;
      case 'sticky-note':
        element = {
          id: uuidv4(), type: 'sticky-note',
          x: point.x, y: point.y, width: 160, height: 120,
          fill: '#FFF59D', stroke: '#F9A825', strokeWidth: 1, text: '便签内容'
        };
        break;
      case 'text':
        element = {
          id: uuidv4(), type: 'text', x: point.x, y: point.y,
          text: '文本', stroke: strokeColor, fill: strokeColor, strokeWidth: 1
        };
        break;
      case 'eraser':
        // 擦除在 mousedown/mousemove 中已按命中实时完成
        break;
    }

    if (element) {
      addElement(element); // addElement 内部仍有锁定/可见性兜底
    }
    currentPathRef.current = [];
    erasedIdsRef.current = new Set();
  }, [activeTool, strokeColor, fillColor, strokeWidth, addElement, getCanvasPoint]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvasTransform.translateX, canvasTransform.translateY);
    ctx.scale(canvasTransform.scale, canvasTransform.scale);

    if (board) {
      board.layers.forEach((layer) => {
        if (!layer.visible) return;
        layer.elements.forEach(el => {
          ctx.save();
          ctx.globalAlpha = el.opacity ?? 1;
          ctx.strokeStyle = el.stroke || '#000';
          ctx.fillStyle = el.fill || 'transparent';
          ctx.lineWidth = el.strokeWidth || 2;

          switch (el.type) {
            case 'path':
              if (el.points && el.points.length >= 4) {
                ctx.beginPath();
                ctx.moveTo(el.points[0], el.points[1]);
                for (let i = 2; i < el.points.length; i += 2) {
                  ctx.lineTo(el.points[i], el.points[i + 1]);
                }
                ctx.stroke();
              }
              break;
            case 'rect':
              ctx.beginPath();
              ctx.rect(el.x, el.y, el.width || 0, el.height || 0);
              if (el.fill && el.fill !== 'transparent') ctx.fill();
              ctx.stroke();
              break;
            case 'circle':
              ctx.beginPath();
              ctx.ellipse(el.x, el.y, (el.width || 0) / 2, (el.height || 0) / 2, 0, 0, Math.PI * 2);
              if (el.fill && el.fill !== 'transparent') ctx.fill();
              ctx.stroke();
              break;
            case 'line':
              if (el.points && el.points.length >= 4) {
                ctx.beginPath();
                ctx.moveTo(el.points[0], el.points[1]);
                ctx.lineTo(el.points[2], el.points[3]);
                ctx.stroke();
              }
              break;
            case 'sticky-note':
              ctx.fillStyle = el.fill || '#FFF59D';
              ctx.fillRect(el.x, el.y, el.width || 160, el.height || 120);
              ctx.strokeStyle = el.stroke || '#F9A825';
              ctx.strokeRect(el.x, el.y, el.width || 160, el.height || 120);
              if (el.text) {
                ctx.fillStyle = '#333';
                ctx.font = '14px sans-serif';
                ctx.fillText(el.text, el.x + 10, el.y + 30);
              }
              break;
            case 'text':
              if (el.text) {
                ctx.fillStyle = el.fill || '#000';
                ctx.font = '16px sans-serif';
                ctx.fillText(el.text, el.x, el.y);
              }
              break;
          }
          ctx.restore();
        });
      });
    }
    ctx.restore();
  }, [board, canvasTransform]);

  // Handle wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { canvasTransform, setCanvasTransform } = useWhiteboardStore.getState();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(canvasTransform.scale * delta, 0.1), 5);
      setCanvasTransform({
        scale: newScale,
        translateX: canvasTransform.translateX,
        translateY: canvasTransform.translateY
      });
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const activeLayer = getActiveLayer(board, activeLayerIndex);
  const locked = !!activeLayer?.locked;
  const hidden = activeLayer ? !activeLayer.visible : false;
  const blocked = activeTool !== 'select' && (locked || hidden || !activeLayer);
  const cursorStyle = activeTool === 'select'
    ? 'default'
    : activeTool === 'eraser'
      ? (blocked ? 'not-allowed' : 'cell')
      : (blocked ? 'not-allowed' : 'crosshair');

  return (
    <canvas
      ref={canvasRef}
      title={blocked ? (activeLayer ? getLayerUneditableReason(activeLayer) ?? undefined : '没有可操作的内容层') : undefined}
      style={{
        width: '100%',
        height: '100%',
        cursor: cursorStyle,
        backgroundColor: board?.backgroundColor || '#f5f5f5'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isDrawingRef.current = false; }}
    />
  );
};
