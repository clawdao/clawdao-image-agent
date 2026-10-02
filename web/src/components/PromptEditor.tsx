/**
 * PromptEditor — 文案编辑（含标题 / 副标题 / 标签 / 加赠）
 */
import {Alert, Card, Form, Input, Segmented, Select, Space, Switch, Typography} from 'antd';
import {DeleteOutlined, PlusOutlined} from '@ant-design/icons';
import type {Category, ColorTone} from '@shared/types/index';

const {TextArea} = Input;
const {Text} = Typography;

interface Props {
  category: Category;
  title: string;
  subtitle?: string;
  tags?: string[];
  gifts?: Array<{name: string; value: string}>;
  colorTone: ColorTone;
  useLobster: boolean;
  customPrompt?: string;
  onChange: (patch: Partial<Props>) => void;
}

export function PromptEditor(props: Props) {
  const gifts = props.gifts ?? [];
  const isPopup = props.category === 'popup';

  return (
    <Form layout="vertical">
      <Form.Item label="主标题" required>
        <Input
          value={props.title}
          placeholder="例如：把重复工作，交给数字员工"
          onChange={(event) => props.onChange({title: event.target.value})}
          maxLength={32}
          showCount
        />
      </Form.Item>

      <Form.Item label="副标题">
        <Input
          value={props.subtitle ?? ''}
          placeholder="例如：一个软件，顶一层屋子 SaaS"
          onChange={(event) => props.onChange({subtitle: event.target.value})}
          maxLength={48}
          showCount
        />
      </Form.Item>

      <Form.Item label="标签行">
        <Select
          mode="tags"
          value={props.tags ?? []}
          placeholder="输入标签后回车，例如：限时 3 天"
          onChange={(value) => props.onChange({tags: value})}
          tokenSeparators={[',', '，']}
          style={{width: '100%'}}
        />
      </Form.Item>

      {isPopup && (
        <Alert
          type="info"
          showIcon
          message="福利弹窗建议填写 3 张加赠卡片，生成时会作为画面信息层级的一部分。"
          style={{marginBottom: 18}}
        />
      )}

      {(isPopup || gifts.length > 0) && (
        <Form.Item label="加赠卡片">
          <Space direction="vertical" style={{width: '100%'}}>
            {gifts.map((gift, index) => (
              <Space.Compact key={`${index}-${gift.name}`} style={{display: 'flex'}}>
                <Input
                  value={gift.name}
                  placeholder="名称，如公众号选题智能体"
                  onChange={(event) => {
                    const next = [...gifts];
                    next[index] = {...gift, name: event.target.value};
                    props.onChange({gifts: next});
                  }}
                  style={{width: '68%'}}
                />
                <Input
                  value={gift.value}
                  placeholder="价值"
                  onChange={(event) => {
                    const next = [...gifts];
                    next[index] = {...gift, value: event.target.value};
                    props.onChange({gifts: next});
                  }}
                  style={{width: '32%'}}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="删除加赠"
                  onClick={() => {
                    const next = gifts.filter((_, itemIndex) => itemIndex !== index);
                    props.onChange({gifts: next});
                  }}
                >
                  <DeleteOutlined />
                </button>
              </Space.Compact>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => props.onChange({gifts: [...gifts, {name: '', value: ''}]})}
            >
              <PlusOutlined /> 添加加赠卡片
            </button>
          </Space>
        </Form.Item>
      )}

      <Form.Item label="品牌色调">
        <Segmented
          block
          value={props.colorTone}
          onChange={(value) => props.onChange({colorTone: value as ColorTone})}
          options={[
            {label: '蓝紫渐变', value: 'blue_purple'},
            {label: '黑金商务', value: 'black_gold'},
          ]}
        />
      </Form.Item>

      <Form.Item>
        <Space align="center">
          <Switch
            checked={props.useLobster}
            onChange={(checked) => props.onChange({useLobster: checked})}
          />
          <Text>加入 ClawDao 橙色龙虾 IP</Text>
        </Space>
      </Form.Item>

      <Form.Item
        label="补充要求（可选）"
        extra="会作为额外画面约束附加到提示词，例如：不要出现二维码、保持大面积留白。"
      >
        <TextArea
          value={props.customPrompt ?? ''}
          onChange={(event) => props.onChange({customPrompt: event.target.value})}
          placeholder="补充构图、禁用元素或品牌细节"
          maxLength={240}
          autoSize={{minRows: 2, maxRows: 5}}
          showCount
        />
      </Form.Item>
    </Form>
  );
}
