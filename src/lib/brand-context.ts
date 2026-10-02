/**
 * brand-context.ts — ClawDao 品牌上下文注入
 *
 * 设计目的：
 *   - 让 MiniMax M3 在理解参考图后，能识别这是 ClawDao 的素材
 *   - 让 image-01 生成时，自动遵守 ClawDao 视觉规范
 */

export interface BrandSpec {
  brand: string;                              // 'ClawDao'
  slogan: string;                            // '把重复工作，交给数字员工'
  one_liner: string;                         // '一个软件，顶一层屋子 SaaS'
  tagline: string;                           // '自己长出来的企业系统'
  three_features: string[];                 // 三大特性
  audience: string[];                        // 目标受众
  ip_name: string;                           // 橙色卡通龙虾吉祥物
  visual_dna: {
    palette: {
      blue_purple: string[];                // 蓝紫渐变色板
      black_gold: string[];                 // 黑金色板
    };
    typography: {
      primary: string;                     // 主标题字体
      secondary: string;                   // 副标题字体
    };
    motifs: string[];                        // 常见设计元素
  };
}

// ============ 默认品牌配置 ============
export const DEFAULT_BRAND: BrandSpec = {
  brand: 'ClawDao',
  slogan: '把重复工作，交给数字员工',
  one_liner: '一个软件，顶一层屋子 SaaS',
  tagline: '自己长出来的企业系统',
  three_features: [
    '内容自动生成',
    '流程自动执行',
    '增长任务自动运转',
  ],
  audience: [
    '企业老板',
    '实体商家',
    '生产工厂',
    '创业公司',
    '自媒体公司',
    '超级个体',
  ],
  ip_name: '橙色卡通龙虾吉祥物',
  visual_dna: {
    palette: {
      blue_purple: ['#667eea', '#764ba2'],
      black_gold: ['#FFD700', '#B8860B'],
    },
    typography: {
      primary: '金色书法体',
      secondary: '白色无衬线',
    },
    motifs: [
      '渐变底色',
      '金色光晕',
      '光斑星点',
      '丝带',
      '礼盒图标',
      '居中留白 ≥40%',
    ],
  },
};

/**
 * 序列化为提示词友好的纯文本
 */
export function brandToText(brand: BrandSpec = DEFAULT_BRAND): string {
  return `# 品牌上下文

公司：${brand.brand}
Slogan：${brand.slogan}
一句话定位：${brand.one_liner}
标语：${brand.tagline}

## 三大特性
${brand.three_features.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## 目标受众
${brand.audience.join('、')}

## 视觉 IP
${brand.ip_name}

## 视觉 DNA
- 蓝紫渐变色板：${brand.visual_dna.palette.blue_purple.join(' → ')}
- 黑金色板：${brand.visual_dna.palette.black_gold.join(' → ')}
- 主标题字体：${brand.visual_dna.typography.primary}
- 副标题字体：${brand.visual_dna.typography.secondary}
- 常见设计元素：${brand.visual_dna.motifs.join('、')}`;
}
