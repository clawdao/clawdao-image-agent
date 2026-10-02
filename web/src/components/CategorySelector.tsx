/**
 * CategorySelector — 两层选择（场景 + 类别）
 */
import {Card, Col, Grid, Row, Space, Tag, Typography} from 'antd';
import {
  AppstoreOutlined,
  BorderTopOutlined,
  GiftOutlined,
  PictureOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type {Category, SceneKey} from '@shared/types/index';
import {SCENES} from '@lib/scenes';

const {Text} = Typography;
const {useBreakpoint} = Grid;

const CATEGORIES: Array<{
  key: Category;
  label: string;
  icon: React.ReactNode;
  hint: string;
}> = [
  {key: 'cover', label: '直播间封面', icon: <PictureOutlined />, hint: '1080×1920 · 9:16 竖屏'},
  {key: 'top_banner', label: '顶部广告条', icon: <BorderTopOutlined />, hint: '1920×320 · 21:9 横屏'},
  {key: 'mid_banner', label: '中间广告条', icon: <AppstoreOutlined />, hint: '1920×600 · 宽幅横屏'},
  {key: 'popup', label: '福利弹窗', icon: <GiftOutlined />, hint: '1024×1024 · 1:1 方形'},
  {key: 'custom', label: '自定义比例', icon: <SettingOutlined />, hint: '默认 16:9，可补充提示词'},
];

interface Props {
  scene: SceneKey;
  category: Category;
  onChange: (scene: SceneKey, category: Category) => void;
}

export function CategorySelector({scene, category, onChange}: Props) {
  const screens = useBreakpoint();
  const sceneCol = screens.lg ? 6 : screens.sm ? 12 : 24;
  const categoryCol = screens.lg ? 8 : screens.sm ? 12 : 24;

  return (
    <Space direction="vertical" size="middle" style={{width: '100%'}}>
      <div>
        <Text strong>业务场景</Text>
        <Text type="secondary" style={{marginLeft: 8, fontSize: 12}}>
          场景会联动默认文案、色调与龙虾 IP 动作
        </Text>
        <Row gutter={[12, 12]} style={{marginTop: 10}}>
          {Object.values(SCENES).map((item) => {
            const active = scene === item.key;
            return (
              <Col span={sceneCol} key={item.key}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => onChange(item.key, category)}
                  className={`choice-card ${active ? 'choice-card--active' : ''}`}
                >
                  <Card.Meta
                    avatar={<span className="choice-card__icon">{item.icon}</span>}
                    title={item.displayName}
                    description={item.hint}
                  />
                </Card>
              </Col>
            );
          })}
        </Row>
      </div>

      <div>
        <Text strong>素材类别</Text>
        <Text type="secondary" style={{marginLeft: 8, fontSize: 12}}>
          输出尺寸会随类别自动切换
        </Text>
        <Row gutter={[12, 12]} style={{marginTop: 10}}>
          {CATEGORIES.map((item) => {
            const active = category === item.key;
            return (
              <Col span={categoryCol} key={item.key}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => onChange(scene, item.key)}
                  className={`choice-card ${active ? 'choice-card--active' : ''}`}
                >
                  <Card.Meta
                    avatar={<span className="choice-card__icon">{item.icon}</span>}
                    title={item.label}
                    description={item.hint}
                  />
                </Card>
              </Col>
            );
          })}
        </Row>
      </div>

      <Tag color="processing">
        已选：{SCENES[scene].displayName} · {CATEGORIES.find((item) => item.key === category)?.label}
      </Tag>
    </Space>
  );
}
