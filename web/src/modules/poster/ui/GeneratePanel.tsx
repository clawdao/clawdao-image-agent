/**
 * ui/GeneratePanel.tsx — 文生图 / 图生图 面板
 *
 * 后端复用本项目统一的 image-generator（MiniMax image-01），
 * 生成结果落到 outputs/poster/studio/，前端拿到 /outputs/... URL 后：
 *   - 「设为背景」：直接铺满画布（cover），随后可继续叠字；
 *   - 「插入为图层」：作为一个可拖动的图片对象参与编辑。
 */
import {useState} from 'react';
import {
  Alert,
  Button,
  Card,
  Image,
  Input,
  Select,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
import {PictureOutlined, ThunderboltOutlined, UploadOutlined} from '@ant-design/icons';
import type {UploadFile} from 'antd/es/upload/interface';

import {posterApi, type GeneratedImage} from '../../../lib/poster-api';

const RATIOS = [
  {value: '9:16', label: '9:16 竖版'},
  {value: '3:4', label: '3:4 海报'},
  {value: '1:1', label: '1:1 方图'},
  {value: '4:3', label: '4:3 横图'},
  {value: '16:9', label: '16:9 宽幅'},
  {value: '21:9', label: '21:9 通栏'},
];

type Props = {
  onUseAsBackground: (src: string) => void;
  onInsertAsLayer: (src: string, width?: number, height?: number) => void;
};

export default function GeneratePanel({onUseAsBackground, onInsertAsLayer}: Props) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('3:4');
  const [n, setN] = useState(1);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleUpload = async (file: File) => {
    try {
      const dataUrl = await readFile(file);
      setRefImages((prev) => [...prev, dataUrl].slice(0, 3));
      message.success('已添加参考图（将走图生图）');
    } catch {
      message.error('参考图读取失败');
    }
    return false;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      message.warning('先写一句画面描述');
      return;
    }
    setLoading(true);
    try {
      const out = await posterApi.generate({
        prompt: prompt.trim(),
        aspectRatio: ratio,
        n,
        refImages,
        noText: true,
      });
      setResults(out.images);
      message.success(`生成完成（${out.mode === 'i2i' ? '图生图' : '文生图'}，${out.images.length} 张）`);
    } catch (e) {
      message.error((e as Error).message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={12} style={{width: '100%'}}>
      <Card size="small" title="文生图 / 图生图">
        <Space direction="vertical" size={8} style={{width: '100%'}}>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例：深蓝渐变背景，几何光带，右侧留出标题区，干净无文字"
            autoSize={{minRows: 3, maxRows: 6}}
          />
          <Space size={8} style={{width: '100%'}}>
            <Select
              value={ratio}
              onChange={setRatio}
              options={RATIOS}
              style={{flex: 1}}
              size="small"
            />
            <Select
              value={n}
              onChange={setN}
              options={[1, 2, 3, 4].map((v) => ({value: v, label: `${v} 张`}))}
              style={{width: 80}}
              size="small"
            />
          </Space>
          <Space size={8}>
            <Upload
              accept="image/png,image/jpeg"
              showUploadList={false}
              beforeUpload={handleUpload}
              multiple
            >
              <Button size="small" icon={<UploadOutlined />}>
                参考图{refImages.length ? `（${refImages.length}）` : ''}
              </Button>
            </Upload>
            {refImages.length > 0 && (
              <Button size="small" type="text" onClick={() => setRefImages([])}>
                清空
              </Button>
            )}
          </Space>
          <Button
            type="primary"
            block
            loading={loading}
            icon={<ThunderboltOutlined />}
            onClick={handleGenerate}
          >
            {loading ? '生成中…' : refImages.length ? '图生图' : '文生图'}
          </Button>
          <Alert
            type="info"
            showIcon
            message="画面默认不带文字，文案一律在画布上排版层叠加"
            style={{fontSize: 11, padding: '4px 8px'}}
          />
        </Space>
      </Card>

      {results.length > 0 && (
        <Card size="small" title="生成结果">
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            {results.map((img) => (
              <Card key={img.url} size="small" styles={{body: {padding: 8}}}>
                <Image
                  src={img.url}
                  alt={img.url}
                  width="100%"
                  style={{borderRadius: 6, display: 'block'}}
                />
                <Typography.Text type="secondary" style={{fontSize: 11}}>
                  {img.width}×{img.height} · {Math.round((img.bytes ?? 0) / 1024)}KB
                </Typography.Text>
                <Space size={6} style={{marginTop: 6}}>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<PictureOutlined />}
                    onClick={() => onUseAsBackground(img.url)}
                  >
                    设为背景
                  </Button>
                  <Button
                    size="small"
                    icon={<PictureOutlined />}
                    onClick={() => onInsertAsLayer(img.url, img.width, img.height)}
                  >
                    插入图层
                  </Button>
                  <Button
                    size="small"
                    type="link"
                    href={img.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    原图
                  </Button>
                </Space>
              </Card>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
