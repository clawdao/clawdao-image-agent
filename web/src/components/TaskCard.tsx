/**
 * TaskCard — 历史任务卡片
 */
import {Button, Card, Image, Popconfirm, Space, Tag, Typography} from 'antd';
import {DeleteOutlined, EyeOutlined} from '@ant-design/icons';
import {useState} from 'react';
import type {Category, Task, TaskStatus} from '@shared/types/index';

interface Props {
  task: Task;
  onDelete: (id: string) => Promise<void>;
  onLoad: (task: Task) => void;
}

const CATEGORY_LABELS: Record<Category, string> = {
  cover: '直播封面',
  top_banner: '顶部广告条',
  mid_banner: '中间广告条',
  popup: '福利弹窗',
  custom: '自定义',
};

const STATUS: Record<TaskStatus, {label: string; color: string}> = {
  pending: {label: '排队中', color: 'default'},
  analyzing: {label: '分析中', color: 'processing'},
  generating: {label: '生成中', color: 'processing'},
  completed: {label: '已完成', color: 'success'},
  failed: {label: '失败', color: 'error'},
};

const {Text} = Typography;

export function TaskCard({task, onDelete, onLoad}: Props) {
  const [deleting, setDeleting] = useState(false);
  const status = STATUS[task.status];
  const thumbnail = task.result?.thumbUrl ?? task.result?.imageUrl;

  return (
    <Card
      hoverable
      size="small"
      className="history-card"
      cover={
        thumbnail ? (
          <Image
            src={thumbnail}
            alt={task.theme.title ?? '生成结果'}
            preview={false}
            height={150}
            style={{objectFit: 'cover'}}
          />
        ) : (
          <div className="history-card__placeholder">暂无预览</div>
        )
      }
      actions={[
        <Button
          key="view"
          type="text"
          size="small"
          icon={<EyeOutlined />}
          disabled={!task.result}
          onClick={() => onLoad(task)}
        >
          查看
        </Button>,
        <Popconfirm
          key="delete"
          title="删除该任务？"
          description="任务记录会从本地历史中移除，已生成图片不会自动删除。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{danger: true, loading: deleting}}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await onDelete(task.id);
            } finally {
              setDeleting(false);
            }
          }}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>,
      ]}
    >
      <Card.Meta
        title={task.theme.title || '未命名任务'}
        description={
          <Space direction="vertical" size={6} style={{width: '100%'}}>
            <Space wrap size={[4, 4]}>
              <Tag color={status.color}>{status.label}</Tag>
              <Tag>{CATEGORY_LABELS[task.category]}</Tag>
              <Tag>{task.ratio}</Tag>
              {task.variantConfig && task.variantConfig.count > 1 && (
                <Tag color="purple">A/B ×{task.variantConfig.count}</Tag>
              )}
            </Space>
            <Text type="secondary" style={{fontSize: 12}}>
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </Text>
          </Space>
        }
      />
    </Card>
  );
}
