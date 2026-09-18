import { create } from 'zustand';
import { Board, BoardElement, CursorPosition, CanvasTransform, ToolType, Layer } from '../types';
import { socketService } from '../services/socket';
import { isElementHitByEraser } from '../utils/hitTest';

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
  notice: string | null;

  // Actions
  setBoard: (board: Board) => void;
  setActiveTool: (tool: ToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setActiveLayerIndex: (index: number) => void;
  addElement: (element: BoardElement) => void;
  updateElement: (elementId: string, updates: Partial<BoardElement>) => void;
  deleteElement: (elementId: string) => void;
  eraseElementsAt: (x: number, y: number, radius: number) => void;
  addLayer: (name: string) => void;
  toggleLayerVisibility: (index: number) => void;
  toggleLayerLock: (index: number) => void;
  setCanvasTransform: (transform: CanvasTransform) => void;
  updateCursor: (cursor: CursorPosition) => void;
  removeCursor: (socketId: string) => void;
  setCursors: (cursors: CursorPosition[]) => void;
  setUsername: (name: string) => void;
  setNotice: (notice: string | null) => void;
  // 返回 null 表示当前激活层可编辑，否则返回不可编辑的原因
  getActiveLayerBlockReason: () => string | null;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

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

  // 重新打开画板时钳制激活层下标，避免越界后误伤其它层
  setBoard: (board) => set((state) => ({
    board,
    activeLayerIndex: board.layers.length === 0
      ? 0
      : Math.min(Math.max(state.activeLayerIndex, 0), board.layers.length - 1)
  })),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setActiveLayerIndex: (index) => set({ activeLayerIndex: index }),

  setNotice: (notice) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    set({ notice });
    if (notice) {
      noticeTimer = setTimeout(() => set({ notice: null }), 2500);
    }
  },

  // 只有未锁定且可见的内容层才允许编辑；其余情况返回原因
  getActiveLayerBlockReason: () => {
    const { board, activeLayerIndex } = get();
    if (!board) return '画板尚未加载';
    const layer = board.layers[activeLayerIndex];
    if (!layer) return '当前没有选中的内容层';
    if (layer.locked) return `图层「${layer.name}」已锁定，无法修改，请先在图层面板解锁`;
    if (!layer.visible) return `图层「${layer.name}」已隐藏，无法修改，请先设为可见`;
    return null;
  },

  addElement: (element) => {
    const { board, activeLayerIndex } = get();
    if (!board || get().getActiveLayerBlockReason()) return;
    const layers = [...board.layers];
    layers[activeLayerIndex] = {
      ...layers[activeLayerIndex],
      elements: [...layers[activeLayerIndex].elements, element]
    };
    set({ board: { ...board, layers } });
    socketService.drawElement(element, activeLayerIndex);
  },

  updateElement: (elementId, updates) => {
    const { board, activeLayerIndex } = get();
    if (!board || get().getActiveLayerBlockReason()) return;
    const layers = [...board.layers];
    const elements = layers[activeLayerIndex].elements.map(el =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    layers[activeLayerIndex] = { ...layers[activeLayerIndex], elements };
    set({ board: { ...board, layers } });
    socketService.updateElement(elementId, updates, activeLayerIndex);
  },

  deleteElement: (elementId) => {
    const { board, activeLayerIndex } = get();
    if (!board || get().getActiveLayerBlockReason()) return;
    const layers = [...board.layers];
    const elements = layers[activeLayerIndex].elements.filter(el => el.id !== elementId);
    layers[activeLayerIndex] = { ...layers[activeLayerIndex], elements };
    set({ board: { ...board, layers } });
    socketService.deleteElement(elementId, activeLayerIndex);
  },

  // 橡皮：只删除当前激活层（已校验未锁定且可见）内被命中的元素，其它层不受影响
  eraseElementsAt: (x, y, radius) => {
    const { board, activeLayerIndex } = get();
    if (!board || get().getActiveLayerBlockReason()) return;
    const layer = board.layers[activeLayerIndex];
    if (layer.elements.length === 0) return;
    const hitIds = new Set(
      layer.elements
        .filter(el => isElementHitByEraser(el, x, y, radius))
        .map(el => el.id)
    );
    if (hitIds.size === 0) return;
    const layers = [...board.layers];
    layers[activeLayerIndex] = {
      ...layer,
      elements: layer.elements.filter(el => !hitIds.has(el.id))
    };
    set({ board: { ...board, layers } });
    hitIds.forEach(id => socketService.deleteElement(id, activeLayerIndex));
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
}));
