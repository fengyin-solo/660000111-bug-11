import { Board, Layer } from '../types';

/**
 * 取当前内容层。activeLayerIndex 越界（例如重新打开画板后）
 * 返回 null，而不是去读写其它图层。
 */
export function getActiveLayer(board: Board | null, activeLayerIndex: number): Layer | null {
  if (!board) return null;
  return board.layers[activeLayerIndex] ?? null;
}

/** 只有「未锁定且可见」的内容层允许绘制与擦除，否则返回不可编辑的原因。 */
export function getLayerUneditableReason(layer: Layer | null): string | null {
  if (!layer) return '当前没有可操作的内容层，请先在图层面板选择或新建图层';
  if (layer.locked) {
    return `图层「${layer.name}」已锁定，锁定范围内的内容不允许绘制或擦除，请先解锁`;
  }
  if (!layer.visible) {
    return `图层「${layer.name}」已隐藏，隐藏图层既不可见也不可编辑，请先恢复显示`;
  }
  return null;
}

export function isLayerEditable(layer: Layer | null): boolean {
  return getLayerUneditableReason(layer) === null;
}
