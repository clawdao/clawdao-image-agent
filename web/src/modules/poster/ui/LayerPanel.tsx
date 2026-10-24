/**
 * ui/LayerPanel.tsx — 图层列表
 *
 * 迁移自 ddn-hub 的 PosterDesigner 图层区（那边是 5000 行大组件里的一小块），
 * 这里重写成独立面板：列表 + 选中 + 显隐 + 锁定 + 层级调整。
 */
import {Button, Empty, Tooltip} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  UnlockOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';

export interface LayerItem {
  id: string;
  type: string;
  label: string;
  visible: boolean;
  locked: boolean;
}

type Props = {
  layers: LayerItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
};

const TYPE_LABEL: Record<string, string> = {
  textbox: '文字',
  text: '文字',
  rect: '色块',
  circle: '圆形',
  ellipse: '椭圆',
  triangle: '三角',
  image: '图片',
  group: '组合',
  line: '线条',
  path: '路径',
};

export default function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onDelete,
  onMove,
}: Props) {
  if (!layers.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="画布还没有图层"
        style={{marginTop: 24}}
      />
    );
  }

  // 顶部是视觉最上层（与画布堆叠顺序一致：数组末尾为顶层）
  const ordered = [...layers].reverse();

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
      {ordered.map((layer) => (
        <div
          key={layer.id}
          data-testid="layer-row"
          data-layer-id={layer.id}
          onClick={() => onSelect(layer.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            borderRadius: 8,
            cursor: 'pointer',
            background: selectedId === layer.id ? '#e6f4ff' : 'transparent',
            border:
              selectedId === layer.id ? '1px solid #91caff' : '1px solid transparent',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: layer.visible ? 1 : 0.4,
            }}
            title={layer.label}
          >
            {layer.label}
          </span>
          <span style={{fontSize: 10, color: '#999'}}>
            {TYPE_LABEL[layer.type] ?? layer.type}
          </span>
          <Tooltip title={layer.visible ? '隐藏' : '显示'}>
            <Button
              type="text"
              size="small"
              icon={layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible(layer.id);
              }}
            />
          </Tooltip>
          <Tooltip title={layer.locked ? '解锁' : '锁定'}>
            <Button
              type="text"
              size="small"
              icon={layer.locked ? <LockOutlined /> : <UnlockOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(layer.id);
              }}
            />
          </Tooltip>
          <Tooltip title="上移一层">
            <Button
              type="text"
              size="small"
              icon={<ArrowUpOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onMove(layer.id, 'up');
              }}
            />
          </Tooltip>
          <Tooltip title="下移一层">
            <Button
              type="text"
              size="small"
              icon={<ArrowDownOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onMove(layer.id, 'down');
              }}
            />
          </Tooltip>
          <Tooltip title="置顶">
            <Button
              type="text"
              size="small"
              icon={<VerticalAlignTopOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onMove(layer.id, 'top');
              }}
            />
          </Tooltip>
          <Tooltip title="置底">
            <Button
              type="text"
              size="small"
              icon={<VerticalAlignBottomOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onMove(layer.id, 'bottom');
              }}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(layer.id);
              }}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
