import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';
import { getActiveLayer, getLayerUneditableReason } from '../utils/layers';

export interface OperationNotice {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface WhiteboardState {
  board: Board | null;
  activeTool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  activeLayerIndex: number;
  cursors: Map<string, CursorPosition>;
  canvasTransform: CanvasTransform;
  username: string;
  notice: OperationNotice | null;

  // Actions
  setBoard: (board: Board) => void;
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveLayerIndex: (index: number) => void;
  addElement: (element: BoardElement) => boolean;
  updateElement: (elementId: string, updates: Partial<BoardElement>) => boolean;
  deleteElement: (elementId: string) => boolean;
  addLayer: (name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  toggleLayerLock: (index: number) => void;
  setCanvasTransform: (transform: CanvasTransform) => void;
  updateCursor: (cursor: CursorPosition) => void;
  removeCursor: (socketId: string) => void;
  setCursors: (cursors: CursorPosition[]) => void;
  setUsername: (name: string) => void;
  notify: (message: string, kind?: 'info' | 'error') => void;
  clearNotice: () => void;

  // 协作入口：远程事件落地前同样必须通过锁定/可见性判定
  applyRemoteElement: (data: { element: BoardElement; layerIndex: number }) => void;
  applyRemoteElementUpdate: (data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => void;
  applyRemoteElementDelete: (data: { elementId: string; layerIndex: number }) => void;
}

let noticeSeq = 0;

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  board: null,
  activeTool: 'pen',
  strokeColor: '#000000',
  fillColor: 'transparent',
  strokeWidth: 2,
  activeLayerIndex: 0,
  cursors: new Map(),
  canvasTransform: { scale: 1, translateX: 0, translateY: 0 },
  username: `User_${Math.random().toString(36).substr(2, 6)}`,
  notice: null,

  setBoard: (board) => {
    // 重新打开画板后把内容层索引收敛到有效范围，避免写入 undefined 层误伤数据
    const { activeLayerIndex } = get();
    const safeIndex = activeLayerIndex >= 0 && activeLayerIndex < board.layers.length ? activeLayerIndex : 0;
    set({ board, activeLayerIndex: safeIndex });
  },
  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setActiveLayerIndex: (index) => set({ activeLayerIndex: index }),

  notify: (message, kind = 'error') => {
    set({ notice: { id: ++noticeSeq, message, kind } });
  },

  clearNotice: () => set({ notice: null }),

  addElement: (element) => {
    const { board, activeLayerIndex, notify } = get();
    if (!board) return false;
    const reason = getLayerUneditableReason(getActiveLayer(board, activeLayerIndex));
    if (reason) {
      notify(reason);
      return false;
    }
    const layers = [...board.layers];
    layers[activeLayerIndex] = {
      ...layers[activeLayerIndex],
      elements: [...layers[activeLayerIndex].elements, element]
    };
    set({ board: { ...board, layers } });
    socketService.drawElement(element, activeLayerIndex);
    return true;
  },

  updateElement: (elementId, updates) => {
    const { board, activeLayerIndex, notify } = get();
    if (!board) return false;
    const reason = getLayerUneditableReason(getActiveLayer(board, activeLayerIndex));
    if (reason) {
      notify(reason);
      return false;
    }
    const layers = [...board.layers];
    const elements = layers[activeLayerIndex].elements.map(el =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    layers[activeLayerIndex] = { ...layers[activeLayerIndex], elements };
    set({ board: { ...board, layers } });
    socketService.updateElement(elementId, updates, activeLayerIndex);
    return true;
  },

  deleteElement: (elementId) => {
    const { board, activeLayerIndex, notify } = get();
    if (!board) return false;
    const reason = getLayerUneditableReason(getActiveLayer(board, activeLayerIndex));
    if (reason) {
      notify(reason);
      return false;
    }
    const layers = [...board.layers];
    const elements = layers[activeLayerIndex].elements.filter(el => el.id !== elementId);
    layers[activeLayerIndex] = { ...layers[activeLayerIndex], elements };
    set({ board: { ...board, layers } });
    socketService.deleteElement(elementId, activeLayerIndex);
    return true;
  },

  addLayer: (name) => {
    const { board } = get();
    if (!board) return;
    const newLayer: Layer = { name, visible: true, locked: false, order: board.layers.length, elements: [] };
    const layers = [...board.layers, newLayer];
    set({ board: { ...board, layers }, activeLayerIndex: layers.length - 1 });
    socketService.updateLayers(layers);
  },

  toggleLayerVisibility: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], visible: !layers[index].visible };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  toggleLayerLock: (index) => {
    const { board } = get();
    if (!board) return;
    const layers = [...board.layers];
    layers[index] = { ...layers[index], locked: !layers[index].locked };
    set({ board: { ...board, layers } });
    socketService.updateLayers(layers);
  },

  setCanvasTransform: (transform) => {
    set({ canvasTransform: transform });
    socketService.canvasTransform(transform);
  },

  updateCursor: (cursor) => {
    const cursors = new Map(get().cursors);
    cursors.set(cursor.socketId, cursor);
    set({ cursors });
  },

  removeCursor: (socketId) => {
    const cursors = new Map(get().cursors);
    cursors.delete(socketId);
    set({ cursors });
  },

  setCursors: (cursorsList) => {
    const cursors = new Map();
    cursorsList.forEach(c => cursors.set(c.socketId, c));
    set({ cursors });
  },

  setUsername: (name) => set({ username: name }),

  applyRemoteElement: ({ element, layerIndex }) => {
    const { board, notify } = get();
    if (!board) return;
    const reason = getLayerUneditableReason(board.layers[layerIndex] ?? null);
    if (reason) {
      // 多个入口与锁定规则保持一致：拒绝改动锁定/隐藏层
      console.warn('[协作] 已忽略对不可编辑图层的绘制:', reason);
      notify(`协作操作被忽略：${reason}`, 'info');
      return;
    }
    const layers = [...board.layers];
    layers[layerIndex] = {
      ...layers[layerIndex],
      elements: [...layers[layerIndex].elements, element]
    };
    set({ board: { ...board, layers } });
  },

  applyRemoteElementUpdate: ({ elementId, updates, layerIndex }) => {
    const { board, notify } = get();
    if (!board) return;
    const reason = getLayerUneditableReason(board.layers[layerIndex] ?? null);
    if (reason) {
      console.warn('[协作] 已忽略对不可编辑图层的更新:', reason);
      notify(`协作操作被忽略：${reason}`, 'info');
      return;
    }
    const layers = [...board.layers];
    const exists = layers[layerIndex].elements.some(el => el.id === elementId);
    if (!exists) return;
    layers[layerIndex] = {
      ...layers[layerIndex],
      elements: layers[layerIndex].elements.map(el =>
        el.id === elementId ? { ...el, ...updates } : el
      )
    };
    set({ board: { ...board, layers } });
  },

  applyRemoteElementDelete: ({ elementId, layerIndex }) => {
    const { board, notify } = get();
    if (!board) return;
    const reason = getLayerUneditableReason(board.layers[layerIndex] ?? null);
    if (reason) {
      console.warn('[协作] 已忽略对不可编辑图层的擦除:', reason);
      notify(`协作擦除被忽略：${reason}`, 'info');
      return;
    }
    const layers = [...board.layers];
    layers[layerIndex] = {
      ...layers[layerIndex],
      elements: layers[layerIndex].elements.filter(el => el.id !== elementId)
    };
    set({ board: { ...board, layers } });
  },
}));
