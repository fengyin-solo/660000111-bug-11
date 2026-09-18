const { Board } = require('../storage');

const activeUsers = new Map(); // boardId -> Set of socket ids
const cursorPositions = new Map(); // socketId -> { x, y, username, boardId }
const boardLayersCache = new Map(); // boardId -> layers[] （服务端锁定判定的唯一依据）

/** 懒加载画板图层（含锁定/可见性），多个协作入口共用同一份判定数据 */
async function loadLayers(boardId) {
  if (boardLayersCache.has(boardId)) {
    return boardLayersCache.get(boardId);
  }
  const board = await Board.findById(boardId);
  const layers = (board && Array.isArray(board.layers)) ? board.layers : [];
  boardLayersCache.set(boardId, layers);
  return layers;
}

/**
 * 锁定范围不允许改动：只有存在、未锁定且可见的内容层允许绘制/更新/擦除。
 * 不满足时向操作者说明原因并返回 null。
 */
function getEditableLayer(socket, boardId, layers, layerIndex) {
  const layer = layers[layerIndex];
  let reason = null;
  if (!layer) {
    reason = '目标内容层不存在，操作已被拒绝';
  } else if (layer.locked) {
    reason = `图层「${layer.name}」已锁定，锁定范围内不允许改动，请先解锁`;
  } else if (layer.visible === false) {
    reason = `图层「${layer.name}」已隐藏，隐藏图层不可编辑，请先恢复显示`;
  }
  if (reason) {
    socket.emit('operation-rejected', { boardId, layerIndex, reason });
    return null;
  }
  return layer;
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-board', async ({ boardId, username }) => {
      socket.join(`board:${boardId}`);

      if (!activeUsers.has(boardId)) {
        activeUsers.set(boardId, new Set());
      }
      activeUsers.get(boardId).add(socket.id);

      cursorPositions.set(socket.id, { x: 0, y: 0, username, boardId });

      // 进入画板即载入最新锁定状态，保证刚重开画板时判定也与图层规则一致
      await loadLayers(boardId);

      // Notify others in the room
      socket.to(`board:${boardId}`).emit('user-joined', { socketId: socket.id, username });

      // Send current active users to the joiner
      const users = [];
      for (const [sid, data] of cursorPositions) {
        if (data.boardId === boardId && sid !== socket.id) {
          users.push({ socketId: sid, username: data.username, x: data.x, y: data.y });
        }
      }
      socket.emit('active-users', users);
    });

    socket.on('cursor-move', ({ boardId, x, y }) => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        pos.x = x;
        pos.y = y;
        socket.to(`board:${boardId}`).emit('cursor-update', {
          socketId: socket.id,
          username: pos.username,
          x, y
        });
      }
    });

    socket.on('draw-element', async ({ boardId, element, layerIndex }) => {
      const layers = await loadLayers(boardId);
      const layer = getEditableLayer(socket, boardId, layers, layerIndex);
      if (!layer) return;
      // 同步服务端快照，后续擦除判定基于最新内容
      layer.elements = Array.isArray(layer.elements) ? [...layer.elements, element] : [element];
      socket.to(`board:${boardId}`).emit('element-added', { element, layerIndex });
    });

    socket.on('update-element', async ({ boardId, elementId, updates, layerIndex }) => {
      const layers = await loadLayers(boardId);
      const layer = getEditableLayer(socket, boardId, layers, layerIndex);
      if (!layer) return;
      if (Array.isArray(layer.elements)) {
        layer.elements = layer.elements.map((el) => (el.id === elementId ? { ...el, ...updates } : el));
      }
      socket.to(`board:${boardId}`).emit('element-updated', { elementId, updates, layerIndex });
    });

    socket.on('delete-element', async ({ boardId, elementId, layerIndex }) => {
      const layers = await loadLayers(boardId);
      const layer = getEditableLayer(socket, boardId, layers, layerIndex);
      if (!layer) return;
      if (Array.isArray(layer.elements)) {
        layer.elements = layer.elements.filter((el) => el.id !== elementId);
      }
      socket.to(`board:${boardId}`).emit('element-deleted', { elementId, layerIndex });
    });

    socket.on('add-sticky-note', async ({ boardId, note, layerIndex }) => {
      const layers = await loadLayers(boardId);
      const layer = getEditableLayer(socket, boardId, layers, layerIndex);
      if (!layer) return;
      layer.elements = Array.isArray(layer.elements) ? [...layer.elements, note] : [note];
      socket.to(`board:${boardId}`).emit('sticky-note-added', { note, layerIndex });
    });

    socket.on('add-shape', async ({ boardId, shape, layerIndex }) => {
      const layers = await loadLayers(boardId);
      const layer = getEditableLayer(socket, boardId, layers, layerIndex);
      if (!layer) return;
      layer.elements = Array.isArray(layer.elements) ? [...layer.elements, shape] : [shape];
      socket.to(`board:${boardId}`).emit('shape-added', { shape, layerIndex });
    });

    socket.on('layer-update', async ({ boardId, layers }) => {
      if (!Array.isArray(layers)) return;
      // 图层锁定/可见性以最新提交为准；落盘后重新打开画板规则仍然生效
      boardLayersCache.set(boardId, layers);
      try {
        await Board.findByIdAndUpdate(boardId, { layers });
      } catch (err) {
        console.error('[Socket] Failed to persist layers:', err);
      }
      socket.to(`board:${boardId}`).emit('layers-updated', { layers });
    });

    socket.on('canvas-transform', ({ boardId, transform }) => {
      socket.to(`board:${boardId}`).emit('canvas-transformed', { transform });
    });

    socket.on('disconnect', () => {
      const pos = cursorPositions.get(socket.id);
      if (pos) {
        const { boardId, username } = pos;
        const users = activeUsers.get(boardId);
        if (users) {
          users.delete(socket.id);
          if (users.size === 0) {
            activeUsers.delete(boardId);
            // 房间无人后释放缓存；下次有人打开画板时从磁盘重新读取锁定状态
            boardLayersCache.delete(boardId);
          }
        }
        cursorPositions.delete(socket.id);
        socket.to(`board:${boardId}`).emit('user-left', { socketId: socket.id, username });
      }
      console.log(`User disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
