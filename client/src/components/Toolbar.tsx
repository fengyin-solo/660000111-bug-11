import React from 'react';
import { useWhiteboardStore } from '../store/whiteboard';
import { ToolType } from '../types';

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
  const { activeTool, setActiveTool, strokeColor, setStrokeColor, fillColor, setFillColor, strokeWidth, setStrokeWidth, getActiveLayerBlockReason } = useWhiteboardStore();
  const blockReason = getActiveLayerBlockReason();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '8px',
      padding: '12px', background: '#fff', borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', width: '60px', alignItems: 'center'
    }}>
      {tools.map(tool => (
        <button
          key={tool.type}
          onClick={() => setActiveTool(tool.type)}
          title={tool.label}
          style={{
            width: '40px', height: '40px', border: 'none', borderRadius: '6px',
            background: activeTool === tool.type ? '#e3f2fd' : 'transparent',
            cursor: 'pointer', fontSize: '18px', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
          }}
        >
          {tool.icon}
        </button>
      ))}
      <div style={{ width: '100%', height: '1px', background: '#ddd' }} />
      <label title="描边颜色">
        <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
          style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer' }} />
      </label>
      <label title="填充颜色">
        <input type="color" value={fillColor === 'transparent' ? '#ffffff' : fillColor}
          onChange={e => setFillColor(e.target.value)}
          style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer' }} />
      </label>
      <input type="range" min="1" max="20" value={strokeWidth}
        onChange={e => setStrokeWidth(Number(e.target.value))}
        title={`线宽: ${strokeWidth}`}
        style={{ width: '40px' }} />
      {blockReason && (
        <div title={blockReason} style={{ fontSize: '16px', cursor: 'help' }}>
          🔒
        </div>
      )}
    </div>
  );
};
