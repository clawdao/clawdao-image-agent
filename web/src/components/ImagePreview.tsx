/**
 * ImagePreview — 实时预览生成结果，支持多变体画廊
 */
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Image as AntImage,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
} from 'antd';
import {CloseCircleOutlined, DownloadOutlined, ReloadOutlined} from '@ant-design/icons';
import {useState} from 'react';
import {api} from '../lib/api';
import type {Task, TaskStatus} from '@shared/types/index';

interface Props {
  task: Task | null;
  onCancel?: () => Promise<void>;
}

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: '排队中',
  analyzing: '分析参考图',
  generating: '生成图片',
  completed: '已完成',
  failed: '已失败',
};

export function ImagePreview({task, onCancel}: Props) {
  const [cancelling, setCancelling] = useState(false);

  if (!task) {
    return (
      <Card title="生成结果" className="panel-card">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="完成左侧配置后，生成结果会显示在这里"
        />
      </Card>
    );
  }

  const {status, progress, result, error, variantConfig} = task;
  const running = status === 'pending' || status === 'analyzing' || status === 'generating';

  if (running) {
    const tip =
      status === 'generating' && (variantConfig?.count ?? 1) > 1
        ? `正在生成 ${variantConfig?.count} 张变体`
        : STATUS_TEXT[status];
    return (
      <Card
        title="生成进度"
        className="panel-card"
        extra={<Tag color="processing">{tip}</Tag>}
      >
        <div className="generation-progress">
          <Spin size="large" />
          <div className="generation-progress__body">
            <Progress
              percent={Math.max(4, Math.round(progress * 100))}
              status="active"
              strokeColor={{'0%': '#667eea', '100%': '#764ba2'}}
            />
            <p>{tip}，通常需要 30~60 秒。</p>
          </div>
        </div>
        {onCancel && (
          <Button
            danger
            block
            icon={<CloseCircleOutlined />}
            loading={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await onCancel();
              } finally {
                setCancelling(false);
              }
            }}
          >
            取消任务
          </Button>
        )}
      </Card>
    );
  }

  if (status === 'failed') {
    return (
      <Card title="生成失败" className="panel-card">
        <Alert
          type="error"
          showIcon
          message="任务执行失败"
          description={error ?? '未知错误，请检查 API Key 和网络后重试。'}
        />
        <Button
          type="primary"
          block
          icon={<ReloadOutlined />}
          style={{marginTop: 16}}
          onClick={() => window.location.reload()}
        >
          刷新后重试
        </Button>
      </Card>
    );
  }

  const variants =
    result?.variants && result.variants.length > 0
      ? result.variants
      : result?.imageUrl
        ? [{url: result.imageUrl, width: 0, height: 0, bytes: 0}]
        : [];

  return (
    <Card
      title={
        <Space>
          <span>生成结果</span>
          <Tag color="success">完成</Tag>
          {variants.length > 1 && <Tag color="processing">{variants.length} 张变体</Tag>}
        </Space>
      }
      className="panel-card"
    >
      {variants.length === 0 ? (
        <Empty description="任务已完成，但没有返回图片" />
      ) : variants.length === 1 ? (
        <div className="single-result">
          <AntImage
            src={variants[0].url}
            alt="生成结果"
            style={{width: '100%', borderRadius: 12}}
          />
          <Button
            type="primary"
            block
            icon={<DownloadOutlined />}
            href={api.downloadUrl(task.id, 0)}
            download={`clawdao_${task.id}.jpeg`}
            style={{marginTop: 12}}
          >
            下载图片
          </Button>
        </div>
      ) : (
        <AntImage.PreviewGroup>
          <Row gutter={[12, 12]}>
            {variants.map((variant, index) => (
              <Col xs={24} sm={12} key={variant.url}>
                <Card
                  size="small"
                  title={`变体 ${index + 1}`}
                  extra={
                    <Button
                      type="link"
                      size="small"
                      icon={<DownloadOutlined />}
                      href={api.downloadUrl(task.id, index)}
                      download={`clawdao_${task.id}_v${index + 1}.jpeg`}
                    >
                      下载
                    </Button>
                  }
                  className="variant-card"
                >
                  <AntImage
                    src={variant.url}
                    alt={`变体 ${index + 1}`}
                    style={{width: '100%', display: 'block', borderRadius: 8}}
                    preview={{mask: '查看大图'}}
                  />
                  <div className="variant-meta">
                    {variant.width}×{variant.height} · {(variant.bytes / 1024).toFixed(1)} KB
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </AntImage.PreviewGroup>
      )}

      <Descriptions
        size="small"
        column={1}
        style={{marginTop: 16}}
        items={[
          {key: 'category', label: '类别', children: task.category},
          {key: 'ratio', label: '比例', children: task.ratio},
          {
            key: 'count',
            label: '变体',
            children: variantConfig?.count ?? variants.length,
          },
        ]}
      />
    </Card>
  );
}
