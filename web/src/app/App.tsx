/**
 * app/App.tsx — 主页面
 * 上传 → 选类型 → 写文案 → 生成 → 预览
 */
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Grid,
  Layout,
  Row,
  Segmented,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  HistoryOutlined,
  HomeOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {useEffect, useMemo, useState} from 'react';
import {ImageUploader} from '../components/ImageUploader';
import {CategorySelector} from '../components/CategorySelector';
import {PromptEditor} from '../components/PromptEditor';
import {ImagePreview} from '../components/ImagePreview';
import {TaskCard} from '../components/TaskCard';
import {api, type HealthData} from '../lib/api';
import {useTaskStore} from '../stores/task-store';
import type {Category, ColorTone, SceneKey, Task} from '@shared/types/index';
import {SCENES} from '@lib/scenes';

const {Title, Text, Paragraph} = Typography;
const {useBreakpoint} = Grid;
const DEFAULT_SCENE: SceneKey = 'livestream';

export default function App() {
  const {
    currentTask,
    history,
    loading,
    historyLoading,
    createTask,
    loadTask,
    cancelTask,
    deleteTask,
    loadHistory,
    clearCurrent,
  } = useTaskStore();

  const screens = useBreakpoint();
  const [step, setStep] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState('');

  const defaults = SCENES[DEFAULT_SCENE].themeDefaults;
  const [refImages, setRefImages] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>('cover');
  const [scene, setScene] = useState<SceneKey>(DEFAULT_SCENE);
  const [title, setTitle] = useState(defaults.title);
  const [subtitle, setSubtitle] = useState(defaults.subtitle ?? '');
  const [tags, setTags] = useState<string[]>(defaults.tags ?? []);
  const [gifts, setGifts] = useState<Array<{name: string; value: string}>>(
    defaults.gifts ?? [],
  );
  const [colorTone, setColorTone] = useState<ColorTone>('blue_purple');
  const [useLobster, setUseLobster] = useState(true);
  const [variantCount, setVariantCount] = useState(1);
  const [customPrompt, setCustomPrompt] = useState('');
  const [themeTouched, setThemeTouched] = useState(false);

  useEffect(() => {
    void loadHistory();
    void api
      .health()
      .then(setHealth)
      .catch((error: Error) => setHealthError(error.message));
  }, [loadHistory]);

  useEffect(() => {
    if (themeTouched) return;
    const next = SCENES[scene].themeDefaults;
    setTitle(next.title);
    setSubtitle(next.subtitle ?? '');
    setTags(next.tags ?? []);
    setGifts(next.gifts ?? []);
    setColorTone(SCENES[scene].brandContext.colorTone ?? 'blue_purple');
    setUseLobster(SCENES[scene].brandContext.useLobster ?? true);
  }, [scene, themeTouched]);

  const stepItems = useMemo(
    () => [
      {title: '参考图'},
      {title: '场景与类别'},
      {title: '主题文案'},
      {title: '生成结果'},
    ],
    [],
  );

  const resetForm = () => {
    const next = SCENES[DEFAULT_SCENE].themeDefaults;
    clearCurrent();
    setStep(1);
    setRefImages([]);
    setCategory('cover');
    setScene(DEFAULT_SCENE);
    setTitle(next.title);
    setSubtitle(next.subtitle ?? '');
    setTags(next.tags ?? []);
    setGifts(next.gifts ?? []);
    setColorTone('blue_purple');
    setUseLobster(true);
    setVariantCount(1);
    setCustomPrompt('');
    setThemeTouched(false);
  };

  const handleGenerate = async () => {
    if (!title.trim()) {
      message.warning('请填写主标题');
      return;
    }

    try {
      await createTask({
        category,
        refImages,
        theme: {title: title.trim(), subtitle, tags, gifts},
        colorTone,
        useLobster,
        scene,
        variantCount,
        customPrompt: customPrompt.trim() || undefined,
      });
      setStep(4);
      message.success('任务已创建，正在生成图片');
    } catch (error) {
      message.error(`创建失败：${(error as Error).message}`);
    }
  };

  const openHistoryTask = async (task: Task) => {
    try {
      await loadTask(task.id);
      setShowHistory(false);
      setStep(4);
    } catch (error) {
      message.error(`加载任务失败：${(error as Error).message}`);
    }
  };

  const content = showHistory ? (
    <HistoryView
      history={history}
      loading={historyLoading}
      onDelete={async (id) => {
        await deleteTask(id);
        message.success('任务记录已删除');
      }}
      onLoad={openHistoryTask}
      onBack={() => setShowHistory(false)}
    />
  ) : (
    <Row gutter={[24, 24]} align="top">
      <Col xs={24} lg={15}>
        <Card className="workflow-card">
          <Steps current={step - 1} items={stepItems} responsive />
          <div className="workflow-card__body">
            {step === 1 && (
              <Step1
                refImages={refImages}
                onChange={setRefImages}
                onNext={() => setStep(2)}
              />
            )}
            {step === 2 && (
              <Step2
                scene={scene}
                category={category}
                onChange={(nextScene, nextCategory) => {
                  setScene(nextScene);
                  setCategory(nextCategory);
                  setThemeTouched(false);
                }}
                onBack={() => setStep(1)}
                onNext={() => setStep(3)}
              />
            )}
            {step === 3 && (
              <Step3
                category={category}
                title={title}
                subtitle={subtitle}
                tags={tags}
                gifts={gifts}
                colorTone={colorTone}
                useLobster={useLobster}
                customPrompt={customPrompt}
                onChange={(patch) => {
                  setThemeTouched(true);
                  if (patch.title !== undefined) setTitle(patch.title);
                  if (patch.subtitle !== undefined) setSubtitle(patch.subtitle);
                  if (patch.tags !== undefined) setTags(patch.tags);
                  if (patch.gifts !== undefined) setGifts(patch.gifts);
                  if (patch.colorTone !== undefined) setColorTone(patch.colorTone);
                  if (patch.useLobster !== undefined) setUseLobster(patch.useLobster);
                  if (patch.customPrompt !== undefined) {
                    setCustomPrompt(patch.customPrompt);
                  }
                }}
                onBack={() => setStep(2)}
                onGenerate={handleGenerate}
                loading={loading}
                variantCount={variantCount}
                onVariantCountChange={setVariantCount}
              />
            )}
            {step === 4 && (
              <Step4 task={currentTask} onReset={resetForm} />
            )}
          </div>
        </Card>
      </Col>

      <Col xs={24} lg={9}>
        <div className="sticky-panel">
          <ImagePreview
            task={currentTask}
            onCancel={async () => {
              if (!currentTask) return;
              try {
                await cancelTask(currentTask.id);
                message.info('任务已取消');
              } catch (error) {
                message.error(`取消失败：${(error as Error).message}`);
              }
            }}
          />
        </div>
      </Col>
    </Row>
  );

  return (
    <Layout className="app-shell">
      <Layout.Header className="app-header">
        <div className="app-header__inner">
          <button type="button" className="brand" onClick={resetForm}>
            <span className="brand__mark">🦞</span>
            <span>
              <strong>ClawDao 图像工厂</strong>
              <small>直播间视觉素材生成器</small>
            </span>
          </button>
          <Space wrap>
            {health && (
              <Tag color={health.keyConfigured ? 'success' : 'warning'}>
                {health.keyConfigured ? '图像 API 已就绪' : '未配置图像 API Key'}
              </Tag>
            )}
            <Button
              icon={showHistory ? <HomeOutlined /> : <HistoryOutlined />}
              onClick={() => setShowHistory((value) => !value)}
            >
              {showHistory ? '返回工作台' : `历史任务 ${history.length ? `(${history.length})` : ''}`}
            </Button>
          </Space>
        </div>
      </Layout.Header>

      <Layout.Content className="app-content">
        <div className="app-content__inner">
          {!showHistory && (
            <div className="hero">
              <div>
                <Text className="hero__eyebrow">CLAWDAO / IMAGE FACTORY</Text>
                <Title level={1}>把一套品牌视觉，快速变成直播间素材。</Title>
                <Paragraph>
                  上传参考图，选择业务场景和素材类别，填写文案即可生成封面、广告条与福利弹窗。
                </Paragraph>
              </div>
              <div className="hero__stats">
                <div><strong>4</strong><span>业务场景</span></div>
                <div><strong>5</strong><span>素材类别</span></div>
                <div><strong>1-5</strong><span>一次多变体</span></div>
              </div>
            </div>
          )}

          {health && !health.keyConfigured && !showHistory && (
            <Alert
              type="warning"
              showIcon
              closable
              message="尚未检测到 MiniMax API Key"
              description={`当前模型：${health.model}。请在项目 .env 配置 MINIMAX_API_KEY，或确认本机 ~/.clawdao/auth.json 可用。`}
              style={{marginBottom: 20}}
            />
          )}
          {healthError && !showHistory && (
            <Alert
              type="error"
              showIcon
              message="后端服务不可用"
              description={healthError}
              style={{marginBottom: 20}}
            />
          )}

          {content}
        </div>
      </Layout.Content>
    </Layout>
  );
}

function Step1({
  refImages,
  onChange,
  onNext,
}: {
  refImages: string[];
  onChange: (images: string[]) => void;
  onNext: () => void;
}) {
  return (
    <div className="step-section">
      <div className="step-heading">
        <div>
          <Text type="secondary">STEP 01</Text>
          <Title level={3}>上传参考图</Title>
          <Paragraph>可选。AI 会提取配色、构图、光线和品牌元素，建议上传 2~4 张。</Paragraph>
        </div>
        <Tag color={refImages.length ? 'processing' : 'default'}>
          已上传 {refImages.length} 张
        </Tag>
      </div>
      <ImageUploader value={refImages} onChange={onChange} max={6} />
      <div className="step-actions">
        <Text type="secondary">没有参考图也可以直接生成预设品牌视觉。</Text>
        <Button type="primary" size="large" onClick={onNext}>
          {refImages.length ? '继续选择场景' : '跳过，选择场景'}
        </Button>
      </div>
    </div>
  );
}

function Step2({
  scene,
  category,
  onChange,
  onBack,
  onNext,
}: {
  scene: SceneKey;
  category: Category;
  onChange: (scene: SceneKey, category: Category) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="step-section">
      <div className="step-heading">
        <div>
          <Text type="secondary">STEP 02</Text>
          <Title level={3}>选择业务场景与素材类别</Title>
          <Paragraph>场景影响品牌调性和文案默认值，类别决定输出比例。</Paragraph>
        </div>
      </div>
      <CategorySelector scene={scene} category={category} onChange={onChange} />
      <div className="step-actions">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" size="large" onClick={onNext}>填写文案</Button>
      </div>
    </div>
  );
}

interface Step3Props {
  category: Category;
  title: string;
  subtitle?: string;
  tags?: string[];
  gifts?: Array<{name: string; value: string}>;
  colorTone: ColorTone;
  useLobster: boolean;
  customPrompt?: string;
  onChange: (value: Partial<Step3Props>) => void;
  onBack: () => void;
  onGenerate: () => void;
  loading: boolean;
  variantCount: number;
  onVariantCountChange: (value: number) => void;
}

function Step3(props: Step3Props) {
  return (
    <div className="step-section">
      <div className="step-heading">
        <div>
          <Text type="secondary">STEP 03</Text>
          <Title level={3}>填写主题文案</Title>
          <Paragraph>文案会直接进入生成提示词，请优先保证主标题简短、信息清晰。</Paragraph>
        </div>
      </div>

      <PromptEditor
        category={props.category}
        title={props.title}
        subtitle={props.subtitle}
        tags={props.tags}
        gifts={props.gifts}
        colorTone={props.colorTone}
        useLobster={props.useLobster}
        customPrompt={props.customPrompt}
        onChange={props.onChange}
      />

      <div className="variant-picker">
        <div>
          <Text strong>生成变体数量</Text>
          <div><Text type="secondary">多变体会一次生成多张同主题方案，便于挑选。</Text></div>
        </div>
        <Segmented
          value={props.variantCount}
          onChange={(value) => props.onVariantCountChange(Number(value))}
          options={[1, 2, 3, 4, 5].map((value) => ({
            label: value === 1 ? '单张' : `${value} 张`,
            value,
          }))}
        />
      </div>

      <div className="step-actions">
        <Button icon={<ArrowLeftOutlined />} onClick={props.onBack}>上一步</Button>
        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          loading={props.loading}
          disabled={!props.title.trim()}
          onClick={props.onGenerate}
        >
          生成{props.variantCount > 1 ? ` ${props.variantCount} 张` : ''}图片
        </Button>
      </div>
    </div>
  );
}

function Step4({task, onReset}: {task: Task | null; onReset: () => void}) {
  return (
    <div className="step-section step-section--centered">
      <CheckCircleOutlined className="step-success-icon" />
      <Title level={3}>{task ? '任务已进入生成队列' : '任务已创建'}</Title>
      <Paragraph type="secondary">
        右侧会实时展示生成进度。完成页面后可以下载单张图片，也可以继续创建新任务。
      </Paragraph>
      {task && (
        <Space wrap>
          <Tag color="processing">{task.category}</Tag>
          <Tag>{task.ratio}</Tag>
          <Tag>{task.status === 'completed' ? '已完成' : '生成中'}</Tag>
        </Space>
      )}
      <div className="step-actions step-actions--centered">
        <Button icon={<ReloadOutlined />} onClick={onReset}>创建新任务</Button>
      </div>
    </div>
  );
}

function HistoryView({
  history,
  loading,
  onDelete,
  onLoad,
  onBack,
}: {
  history: Task[];
  loading: boolean;
  onDelete: (id: string) => Promise<void>;
  onLoad: (task: Task) => void;
  onBack: () => void;
}) {
  return (
    <div className="history-view">
      <div className="history-view__header">
        <div>
          <Text type="secondary">HISTORY</Text>
          <Title level={2}>历史任务</Title>
          <Paragraph>查看、复用或删除本地生成记录。</Paragraph>
        </div>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回工作台</Button>
      </div>

      {loading ? (
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((item) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={item}>
              <Card><Skeleton active /></Card>
            </Col>
          ))}
        </Row>
      ) : history.length === 0 ? (
        <Card className="empty-card">
          <Empty description="还没有历史任务">
            <Button type="primary" onClick={onBack}>开始生成第一张</Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {history.map((task) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={task.id}>
              <TaskCard task={task} onDelete={onDelete} onLoad={onLoad} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
