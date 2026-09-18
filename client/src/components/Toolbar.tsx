import React from 'react';
import { useWhiteboardStore } from '../store/whiteboard';
import { ToolType } from '../types';
import { getActiveLayer, getLayerUneditableReason } from '../utils/layers';

const tools: { type: ToolType; label: string; icon: string }[] = [
  { type: 'select', label: '选择', icon: '👆' },
  { type: 'pen', label: '画笔', icon: '✏️' },
  { type: 'rect', label: '矩形', icon: '⬜' },
  { type: 'circle', label: '圆形', icon: '⭕' },
  { type: 'line', label: '直线', icon: '📏' },
  { type: 'text', label: '文本', icon: '🔤' },
  { type: 'sticky-note', label: '便签', icon: '📝' },
  { type: 'eraser', label: '橡皮', icon: '🧹' },
];

export const Toolbar: React.FC = () => {
  const {
    activeTool, setActiveTool, strokeColor, setStrokeColor, fillColor, setFillColor,
    strokeWidth, setStrokeWidth, board, activeLayerIndex
  } = useWhiteboardStore();

  // 与画板工作台共用同一份判定：只有当前未锁定且可见的内容层可绘制/擦除
  const activeLayer = getActiveLayer(board, activeLayerIndex);
  const uneditableReason = getLayerUneditableReason(activeLayer);
  const isSelect = activeTool === 'select';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '8px',
      padding: '12px', background: '#fff', borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', width: '60px', alignItems: 'center'
    }}>
      {tools.map(tool => {
        // 选择工具不受图层锁定限制；其余工具在锁定/隐藏/无内容层时统一禁用
        const disabled = tool.type !== 'select' && uneditableReason !== null;
        const selected = activeTool === tool.type;
        return (
          <button
            key={tool.type}
            onClick={() => { if (!disabled) setActiveTool(tool.type); }}
            title={disabled ? `${tool.label}不可用：${uneditableReason}` : tool.label}
            aria-disabled={disabled}
            style={{
              width: '40px', height: '40px', border: 'none', borderRadius: '6px',
              background: selected ? '#e3f2fd' : 'transparent',
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '18px', display: 'flex',
              alignItems: 'center', justifyContent: 'center'
            }}
          >
            {tool.icon}
          </button>
        );
      })}
      <div style={{ width: '100%', height: '1px', background: '#ddd' }} />
      {/* 当前内容层状态，和图层面板的锁/眼睛标识保持一致 */}
      <div
        title={uneditableReason ?? (activeLayer ? `当前内容层：${activeLayer.name}（可编辑）` : undefined)}
        style={{
          width: '44px', fontSize: '10px', textAlign: 'center', lineHeight: 1.4,
          padding: '4px 2px', borderRadius: '4px',
          background: uneditableReason ? '#fdecea' : '#e8f5e9',
          color: uneditableReason ? '#b71c1c' : '#1b5e20',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}
      >
        {!activeLayer ? '无内容层' : activeLayer.locked ? '🔒已锁定' : activeLayer.visible ? '可编辑' : '🚫已隐藏'}
      </div>
      <label title="描边颜色" style={{ opacity: isSelect ? 0.4 : 1 }}>
        <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
          disabled={isSelect}
          style={{ width: '32px', height: '32px', border: 'none', cursor: isSelect ? 'not-allowed' : 'pointer' }} />
      </label>
      <label title="填充颜色" style={{ opacity: isSelect ? 0.4 : 1 }}>
        <input type="color" value={fillColor === 'transparent' ? '#ffffff' : fillColor}
          onChange={e => setFillColor(e.target.value)}
          disabled={isSelect}
          style={{ width: '32px', height: '32px', border: 'none', cursor: isSelect ? 'not-allowed' : 'pointer' }} />
      </label>
      <input type="range" min="1" max="20" value={strokeWidth}
        onChange={e => setStrokeWidth(Number(e.target.value))}
        title={`线宽: ${strokeWidth}`}
        style={{ width: '40px' }} />
    </div>
  );
};
