import { chromium } from 'playwright';
const root = new URL('..', import.meta.url).pathname;
const css = await Bun.file(root + 'configs/poster-html/spec.css').text();
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<!doctype html><html><head><style id="s">${css}</style></head><body><div class="poster" data-bg="solid" data-theme="fresh" data-palette="main" style="--poster-w:1080px;--canvas-w:1080px;--canvas-h:1080px;--scale:1;--layout-h:1080px;--tone-text:#111;--tone-text-dim:#333;--tone-text-faint:#555;--tone-gold:#5CB02F;--tone-gold-soft:#3E8E1F;--tone-gold-faint:#CDE9A8;--tone-card-fill:#fff;--tone-card-stroke:#eee;--tone-chip-fill:#CDE9A8;--tone-chip-text:#2A6E12;--tone-rail:#ddd;--tone-divider:#eee;--tone-brand-text:#123A2B;--tone-bg-top:#007AFF;"><div class="poster__bg"></div><div class="poster__content"><section class="blk blk--hero" data-kind="hero"><div class="hero__kicker"><i class="hero__kicker-bar"></i><span>副标</span></div><h1 class="hero__title t-title">标题</h1><p class="hero__subtitle">说明</p></section><section class="blk blk--cards" data-kind="cards" style="--cols:3"><div class="cards__list"><div class="card"><span class="card__tag">T</span><div class="card__title">卡标题</div><div class="card__body">卡正文</div></div></div></section></div><div class="poster__brand brand brand--chip" data-position="top-right"><span class="brand__text">ClawDao</span></div></div></body></html>`);
const info: any = await p.evaluate(() => {
  const sheet = (document.getElementById('s') as HTMLStyleElement).sheet as CSSStyleSheet;
  const rules = Array.from(sheet.cssRules);
  const sels = rules.map((r: any) => r.selectorText).filter(Boolean);
  const poster = document.querySelector('.poster') as HTMLElement;
  const cs = getComputedStyle(poster);
  const hero = document.querySelector('.hero__title') as HTMLElement;
  const hs = getComputedStyle(hero);
  const bg = document.querySelector('.poster__bg') as HTMLElement;
  const bgs = getComputedStyle(bg);
  const card = document.querySelector('.card') as HTMLElement;
  const cards = getComputedStyle(card);
  return {
    ruleCount: rules.length,
    selHits: ['.poster','.blk--hero','.blk--cards','[data-palette]',"[data-theme='fresh']",'.poster__bg','.card'].map(s => [s, sels.includes(s)]),
    padX: cs.getPropertyValue('--pad-x').trim(),
    blockGap: cs.getPropertyValue('--block-gap').trim(),
    fsHeroTitleMax: cs.getPropertyValue('--fs-hero-title-max').trim(),
    cText: cs.getPropertyValue('--c-text').trim(),
    heroFontSize: hs.fontSize,
    heroFontFamily: hs.fontFamily.slice(0, 40),
    heroColor: hs.color,
    bgImage: bgs.backgroundImage,
    bgColor: bgs.backgroundColor,
    cardBg: cards.backgroundColor,
    cardRadius: cards.borderRadius,
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
