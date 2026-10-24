/**
 * ui/AiOpsPanel.tsx — AI 指令面板
 *
 * 迁移自 ddn-hub 的 AIPosterAssistant，但把**假的** AI 换成真的：
 *   ddn-hub / admin/src/services/aiPoster.ts 里是 setTimeout + 随机数 mock，
 *   这里改成打本项目后端 /api/poster/ai-ops —— LLM 读当前画布摘要，
 *   吐受控的 PosterOperation[]，前端 applyOperations 落到画布上。
 */
import {useRef, useState} from 'react';
import {Alert, Button, Card, Input, Space, Spin, Typography, message} from 'antd';
import {RobotOutlined, SendOutlined} from '@ant-design/icons';

import {posterApi} from '../../../lib/poster-api';
import type {PosterDesignV2Config, PosterOperation} from '../types';

type ChatItem = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  rejected?: string[];
};

type Props = {
  getDesign: () => PosterDesignV2Config;
  onOperations: (ops: PosterOperation[], explanation?: string) => Promise<void>;
};

const QUICK = [
  '把标题改成更短更有力的 8 个字',
  '底部加一行说明文字，字号 24',
  '主标题往下移 60 像素',
  '背景换成深蓝到黑的线性渐变',
];

export default function AiOpsPanel({getDesign, onOperations}: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const run = async (instruction: string) => {
    const text = instruction.trim();
    if (!text || loading) return;

    setItems((prev) => [
      ...prev,
      {id: `u-${Date.now()}`, role: 'user', content: text},
    ]);
    setInput('');
    setLoading(true);

    try {
      const result = await posterApi.aiOps(getDesign(), text);
      if (result.operations?.length) {
        await onOperations(result.operations, result.explanation);
      }
      setItems((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            result.explanation ||
            (result.operations?.length
              ? `已执行 ${result.operations.length} 个操作`
              : '这条指令没有可执行的改动'),
          rejected: result.rejected?.length ? result.rejected : undefined,
        },
      ]);
    } catch (e) {
      const msg = (e as Error).message || '指令执行失败';
      setItems((prev) => [
        ...prev,
        {id: `a-${Date.now()}`, role: 'assistant', content: `失败：${msg}`},
      ]);
      message.error(msg);
    } finally {
      setLoading(false);
      setTimeout(() => {
        listRef.current?.scrollTo({top: listRef.current.scrollHeight, behavior: 'smooth'});
      }, 50);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <RobotOutlined />
          AI 指令
        </Space>
      }
    >
      <div
        ref={listRef}
        style={{
          maxHeight: 260,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginBottom: 8,
        }}
      >
        {items.length === 0 && (
          <Typography.Text type="secondary" style={{fontSize: 12}}>
            用一句话描述你要的改动，AI 会在当前画布上执行（加字 / 改字 / 移动 /
            缩放 / 换底），执行前会先做安全校验。
          </Typography.Text>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '92%',
              background: item.role === 'user' ? '#e6f4ff' : '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 8,
              padding: '6px 8px',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {item.content}
            {item.rejected?.length ? (
              <Alert
                type="warning"
                showIcon
                style={{marginTop: 6, fontSize: 11}}
                message={`已拦截 ${item.rejected.length} 条越权操作`}
                description={item.rejected.join('；')}
              />
            ) : null}
          </div>
        ))}
        {loading && <Spin size="small" />}
      </div>

      <Input.TextArea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="例：把主标题改成「智能体实操课」，字号 96，白色"
        autoSize={{minRows: 2, maxRows: 4}}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            void run(input);
          }
        }}
      />
      <Button
        type="primary"
        block
        size="small"
        style={{marginTop: 8}}
        icon={<SendOutlined />}
        loading={loading}
        onClick={() => void run(input)}
      >
        执行指令
      </Button>

      <div style={{marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4}}>
        {QUICK.map((q) => (
          <Button key={q} size="small" type="text" onClick={() => void run(q)}>
            {q}
          </Button>
        ))}
      </div>
    </Card>
  );
}
