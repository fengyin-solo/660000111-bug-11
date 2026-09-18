import React, { useState, useEffect, useRef } from 'react';
import { WhiteboardCanvas } from './components/WhiteboardCanvas';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CursorOverlay } from './components/CursorOverlay';
import { Dashboard } from './components/Dashboard';
import { useWhiteboardStore } from './store/whiteboard';
import { socketService } from './services/socket';
import { Board, BoardElement, CursorPosition, Layer, CanvasTransform, ViewType } from './types';

const OperationToast: React.FC = () => {
  const notice = useWhiteboardStore((s) => s.notice);
  const clearNotice = useWhiteboardStore((s) => s.clearNotice);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notice) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(clearNotice, 2600);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notice, clearNotice]);

  if (!notice) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 2000, maxWidth: '70%',
        background: notice.kind === 'error' ? '#fdecea' : '#e8f1fd',
        color: notice.kind === 'error' ? '#b71c1c' : '#0d47a1',
        border: `1px solid ${notice.kind === 'error' ? '#f5c6c2' : '#b6d0f5'}`,
        borderRadius: '8px', padding: '8px 14px', fontSize: '13px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', pointerEvents: 'none',
      }}
    >
      {notice.message}
    </div>
  );
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  const {
    setBoard, setActiveLayerIndex, updateCursor, removeCursor, setCursors,
    username, notify, applyRemoteElement, applyRemoteElementUpdate, applyRemoteElementDelete
  } = useWhiteboardStore();

  useEffect(() => {
    if (currentView === 'board' && activeBoard) {
      // 进入画板：重置内容层索引，统一从第一个图层开始，避免沿用上一画板的越界索引
      setActiveLayerIndex(0);
      setBoard(activeBoard);

      socketService.connect();
      socketService.joinBoard(activeBoard._id, username);

      socketService.onUserJoined((data) => {
        console.log(`${data.username} 加入了白板`);
      });
      socketService.onUserLeft((data) => {
        removeCursor(data.socketId);
      });
      socketService.onActiveUsers((users) => {
        setCursors(users);
      });
      socketService.onCursorUpdate((data: CursorPosition) => {
        updateCursor(data);
      });
      // 协作入口全部经过同一套锁定/可见性判定，结果与本地操作一致
      socketService.onElementAdded((data: { element: BoardElement; layerIndex: number }) => {
        applyRemoteElement(data);
      });
      socketService.onElementUpdated((data: { elementId: string; updates: Partial<BoardElement>; layerIndex: number }) => {
        applyRemoteElementUpdate(data);
      });
      socketService.onElementDeleted((data: { elementId: string; layerIndex: number }) => {
        applyRemoteElementDelete(data);
      });
      socketService.onStickyNoteAdded((data: { note: BoardElement; layerIndex: number }) => {
        applyRemoteElement({ element: data.note, layerIndex: data.layerIndex });
      });
      socketService.onShapeAdded((data: { shape: BoardElement; layerIndex: number }) => {
        applyRemoteElement({ element: data.shape, layerIndex: data.layerIndex });
      });
      socketService.onLayersUpdated((data: { layers: Layer[] }) => {
        const { board: currentBoard } = useWhiteboardStore.getState();
        if (currentBoard) {
          setBoard({ ...currentBoard, layers: data.layers });
        }
      });
      socketService.onCanvasTransformed((data: { transform: CanvasTransform }) => {
        useWhiteboardStore.setState({ canvasTransform: data.transform });
      });
      // 服务端按同一锁定规则拒绝时，说明原因
      const socket = socketService.getSocket();
      socket?.on('operation-rejected', (payload: { reason?: string }) => {
        if (payload?.reason) notify(payload.reason, 'info');
      });

      return () => {
        socketService.disconnect();
      };
    }
  }, [currentView, activeBoard]);

  const handleBoardSelect = (boardItem: Board) => {
    setActiveBoard(boardItem);
    setCurrentView('board');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    setActiveBoard(null);
  };

  if (currentView === 'dashboard') {
    return <Dashboard onBoardSelect={handleBoardSelect} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{
        height: '48px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '12px',
      }}>
        <button
          onClick={handleBackToDashboard}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#374151',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          返回工作台
        </button>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a',
        }}>
          {activeBoard?.name}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Toolbar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <OperationToast />
          <WhiteboardCanvas />
          <CursorOverlay />
        </div>
        <LayerPanel />
      </div>
    </div>
  );
};

export default App;
