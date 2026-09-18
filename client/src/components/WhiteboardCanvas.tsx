import React, { useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWhiteboardStore } from '../store/whiteboard';
import { socketService } from '../services/socket';
import { BoardElement } from '../types';

export const WhiteboardCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef<number[]>([]);
  const startPosRef = useRef({ x: 0, y: 0 });

  const {
    board, activeTool, strokeColor, fillColor, strokeWidth,
    canvasTransform, addElement, eraseElementsAt,
    getActiveLayerBlockReason, setNotice
  } = useWhiteboardStore();

  // 橡皮半径跟随线宽，保证连续擦除时有稳定的判定范围
  const eraserRadius = Math.max(10, strokeWidth * 2);

  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - canvasTransform.translateX) / canvasTransform.scale,
      y: (e.clientY - rect.top - canvasTransform.translateY) / canvasTransform.scale
    };
  }, [canvasTransform]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'select') return;
    // 锁定或隐藏的层不允许任何绘制/擦除，并说明原因
    const blockReason = getActiveLayerBlockReason();
    if (blockReason) {
      setNotice(blockReason);
      return;
    }
    const point = getCanvasPoint(e);
    isDrawingRef.current = true;
    startPosRef.current = point;
    currentPathRef.current = [point.x, point.y];
    if (activeTool === 'eraser') {
      eraseElementsAt(point.x, point.y, eraserRadius);
    }
  }, [activeTool, getCanvasPoint, getActiveLayerBlockReason, setNotice, eraseElementsAt, eraserRadius]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    socketService.moveCursor(point.x, point.y);

    if (!isDrawingRef.current) return;
    // 橡皮在拖拽过程中连续擦除
    if (activeTool === 'eraser') {
      eraseElementsAt(point.x, point.y, eraserRadius);
      return;
    }
    currentPathRef.current.push(point.x, point.y);
  }, [activeTool, getCanvasPoint, eraseElementsAt, eraserRadius]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const point = getCanvasPoint(e);
    let element: BoardElement | null = null;

    switch (activeTool) {
      case 'eraser':
        // 擦除已在按下/拖拽过程中完成，这里收尾即可
        break;
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
      case 'circle':
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
    }

    if (element) {
      addElement(element);
    }
    currentPathRef.current = [];
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

  // 绘制类工具在锁定/隐藏层上显示禁止光标，与锁定规则保持一致
  const layerBlocked = activeTool !== 'select' && getActiveLayerBlockReason() !== null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        cursor: activeTool === 'select' ? 'default' : layerBlocked ? 'not-allowed' : 'crosshair',
        backgroundColor: board?.backgroundColor || '#f5f5f5'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { isDrawingRef.current = false; }}
    />
  );
};
