import React from 'react';
import { useWhiteboardStore } from '../store/whiteboard';

export const LayerPanel: React.FC = () => {
  const { board, activeLayerIndex, setActiveLayerIndex, toggleLayerVisibility, toggleLayerLock, addLayer } = useWhiteboardStore();

  if (!board) return null;

  return (
    <div style={{
      width: '220px', background: '#fff', borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: '12px',
      display: 'flex', flexDirection: 'column', gap: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>图层</h3>
        <button onClick={() => addLayer(`图层 ${board.layers.length + 1}`)}
          style={{ border: 'none', background: '#4472C4', color: '#fff', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>
          + 新建
        </button>
      </div>
      {board.layers.map((layer, index) => {
        const isActive = index === activeLayerIndex;
        return (
          <div key={index}
            onClick={() => setActiveLayerIndex(index)}
            title={
              layer.locked
                ? `图层「${layer.name}」已锁定：锁定范围内不允许绘制、擦除或改动，请先解锁`
                : layer.visible
                  ? `图层「${layer.name}」可见且可编辑`
                  : `图层「${layer.name}」已隐藏：不可见也不可编辑，请先恢复显示`
            }
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px', borderRadius: '4px', cursor: 'pointer',
              background: isActive ? '#e3f2fd' : '#f5f5f5',
              outline: isActive ? '1px solid #4472C4' : 'none',
              opacity: layer.visible ? 1 : 0.6
            }}>
            <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(index); }}
              title={layer.visible ? '隐藏图层（隐藏后不可编辑）' : '显示图层'}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }}>
              {layer.visible ? '👁' : '🚫'}
            </button>
            <span style={{
              flex: 1, fontSize: '13px',
              color: layer.locked ? '#b71c1c' : '#1a1a1a',
              textDecoration: layer.visible ? 'none' : 'line-through'
            }}>
              {layer.name}
            </span>
            <button onClick={(e) => { e.stopPropagation(); toggleLayerLock(index); }}
              title={layer.locked ? '解锁图层（解锁后可绘制/擦除）' : '锁定图层（锁定后内容不允许改动）'}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '14px' }}>
              {layer.locked ? '🔒' : '🔓'}
            </button>
            <span style={{ fontSize: '11px', color: '#888' }}>{layer.elements.length}</span>
          </div>
        );
      })}
      <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5, borderTop: '1px solid #eee', paddingTop: '8px' }}>
        仅当前选中且未锁定、可见的图层可绘制与擦除；锁定范围不允许改动，隐藏图层不可编辑。
      </div>
    </div>
  );
};
