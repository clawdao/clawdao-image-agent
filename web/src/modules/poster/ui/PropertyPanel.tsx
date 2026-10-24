/**
 * ui/PropertyPanel.tsx — 属性面板（改选中对象的文字 / 字号 / 颜色 / 位置 / 透明度）
 *
 * 直接操作 Fabric 对象，改完 fire('ddn:object:modified') 触发上层 onChange 保存。
 */
import {ColorPicker, Divider, Input, InputNumber, Select, Slider, Typography} from 'antd';

type Props = {
  object: any | null;
  onChanged: () => void;
};

const ALIGN_OPTIONS = [
  {value: 'left', label: '左对齐'},
  {value: 'center', label: '居中'},
  {value: 'right', label: '右对齐'},
  {value: 'justify', label: '两端对齐'},
];

function isText(obj: any): boolean {
  return obj?.type === 'textbox' || obj?.type === 'text' || obj?.type === 'i-text';
}

export default function PropertyPanel({object, onChanged}: Props) {
  if (!object) {
    return (
      <Typography.Text type="secondary" style={{fontSize: 12}}>
        在画布上选中一个对象后可编辑属性
      </Typography.Text>
    );
  }

  const apply = (patch: Record<string, unknown>) => {
    try {
      object.set(patch);
      if (typeof object.initDimensions === 'function' && isText(object)) {
        object.initDimensions();
      }
      object.setCoords();
      object.canvas?.requestRenderAll?.();
      onChanged();
    } catch {
      /* ignore */
    }
  };

  const fill = typeof object.fill === 'string' ? object.fill : '#333333';
  const opacity = typeof object.opacity === 'number' ? object.opacity : 1;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
      <Typography.Text strong style={{fontSize: 12}}>
        {isText(object) ? '文字对象' : object?.type ?? '对象'}
      </Typography.Text>

      {isText(object) && (
        <>
          <div>
            <Typography.Text type="secondary" style={{fontSize: 12}}>
              文字内容
            </Typography.Text>
            <Input.TextArea
              value={String(object.text ?? '')}
              autoSize={{minRows: 2, maxRows: 6}}
              onChange={(e) => apply({text: String(e.target.value ?? '')})}
              style={{width: '100%', marginTop: 4, fontSize: 12}}
            />
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <div style={{flex: 1}}>
              <Typography.Text type="secondary" style={{fontSize: 12}}>
                字号
              </Typography.Text>
              <InputNumber
                min={8}
                max={400}
                value={Number(object.fontSize ?? 16)}
                onChange={(v) => apply({fontSize: Number(v ?? 16)})}
                style={{width: '100%', marginTop: 4}}
              />
            </div>
            <div style={{flex: 1}}>
              <Typography.Text type="secondary" style={{fontSize: 12}}>
                对齐
              </Typography.Text>
              <Select
                size="small"
                value={object.textAlign ?? 'left'}
                options={ALIGN_OPTIONS}
                onChange={(v) => apply({textAlign: v})}
                style={{width: '100%', marginTop: 4}}
              />
            </div>
          </div>
          <div>
            <Typography.Text type="secondary" style={{fontSize: 12}}>
              颜色
            </Typography.Text>
            <div style={{marginTop: 4}}>
              <ColorPicker
                size="small"
                value={fill}
                onChange={(color) => apply({fill: color.toHexString()})}
                showText
              />
            </div>
          </div>
        </>
      )}

      <Divider style={{margin: '4px 0'}} />

      <div style={{display: 'flex', gap: 8}}>
        <div style={{flex: 1}}>
          <Typography.Text type="secondary" style={{fontSize: 12}}>
            X
          </Typography.Text>
          <InputNumber
            value={Math.round(Number(object.left ?? 0))}
            onChange={(v) => apply({left: Number(v ?? 0)})}
            style={{width: '100%', marginTop: 4}}
          />
        </div>
        <div style={{flex: 1}}>
          <Typography.Text type="secondary" style={{fontSize: 12}}>
            Y
          </Typography.Text>
          <InputNumber
            value={Math.round(Number(object.top ?? 0))}
            onChange={(v) => apply({top: Number(v ?? 0)})}
            style={{width: '100%', marginTop: 4}}
          />
        </div>
      </div>

      <div style={{display: 'flex', gap: 8}}>
        <div style={{flex: 1}}>
          <Typography.Text type="secondary" style={{fontSize: 12}}>
            宽
          </Typography.Text>
          <InputNumber
            value={Math.round(Number(object.width ?? 0))}
            onChange={(v) => apply({width: Number(v ?? 0)})}
            style={{width: '100%', marginTop: 4}}
          />
        </div>
        <div style={{flex: 1}}>
          <Typography.Text type="secondary" style={{fontSize: 12}}>
            旋转
          </Typography.Text>
          <InputNumber
            value={Math.round(Number(object.angle ?? 0))}
            onChange={(v) => apply({angle: Number(v ?? 0)})}
            style={{width: '100%', marginTop: 4}}
          />
        </div>
      </div>

      <div>
        <Typography.Text type="secondary" style={{fontSize: 12}}>
          透明度 {Math.round(opacity * 100)}%
        </Typography.Text>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(v) => apply({opacity: v})}
        />
      </div>
    </div>
  );
}
