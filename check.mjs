/**
 * 文献工作台插件自检:宿主同款 new Function('ctx', src) 求值 main.js + DOM 垫片(抄 bluebird)。
 * 覆盖(SPEC「check.mjs 额外必测」全项):
 *   贡献点齐全(1 视图/2 命令/2 设置)/ disposer / fixture 解析(条目·creators 拼名·批注·附件·缺字段容错)
 *   引用名生成与重名序号 / 批注导入幂等(二次 0 新增·新 key 只增量)/「我的笔记」节逐字节保护
 *   引用块组装 / 连接失败降级不抛 / XSS(标题含 <script> 进 DOM 无 attrs)
 *   旧宿主(无块表面 getPage)→ 插入引用降级「复制引用」(剪贴板)不抛 / 契约往返(写→读→再写不丢字段)
 *   打开阅读笔记走 loadPage 绝不 openFile(裸 .md 回落系统默认程序)/ 写活动页后 loadPage 强制回灌
 *   哨兵字面消毒(批注/AI/frontmatter 嵌他条哨兵不抑制真批注导入)/ /collections 显式 limit / ztGet 超时 signal
 *   frontmatter YAML 引号转义往返 / 索引 zt_key 身份校验(快路径+自愈)/ 幂等去重域=导入区+批次内去重
 *   集合 parent 成环救援 / 引用名滤 []|#^ 与码点截断 / zotero:// 唤起被宿主 deny 时降级复制
 *   视图 mount 全链路(连接/集合/列表渲染+视图 disposer)/ loadCollections 重入竞态 / dispose 清理浮层与样式
 * 跑法:node check.mjs
 */
import { readFileSync } from 'node:fs'
import { strict as A } from 'node:assert'

process.env.TZ = 'Asia/Shanghai'
const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')

// ── 极简 DOM 垫片 ──
function mkText(t) {
  const n = { tag: '#text', children: [], attrs: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {} }
  let v = String(t)
  Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } })
  return n
}
function mkEl(tag) {
  const n = {
    tag, children: [], attrs: {}, listeners: {}, style: { setProperty(k, v) { n.style[k] = v }, removeProperty() {} },
    className: '', isConnected: true, parentNode: null, value: '', disabled: false,
    focus() {}, blur() {},
    getContext: () => null, // parseColor 的 canvas 探针:回 null 走兜底,不 TypeError
    addEventListener(t, f) { (n.listeners[t] = n.listeners[t] || []).push(f) },
    removeEventListener() {},
    click() { for (const f of (n.listeners.click || []).slice()) f({}) },
    remove() { const p = n.parentNode; if (p && p.children) { const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1) } n.parentNode = null },
    // 视图 mount 用:按 [data-*] 选择器在子树里找元素(main.js 的 $() 只用这一种形状)
    querySelector(sel) {
      const dm = /^\[([\w-]+)\]$/.exec(String(sel))
      if (!dm) return null
      let hit = null
      const walk = (x) => { if (hit) return; for (const c of (x.children || [])) { if (c.attrs && dm[1] in c.attrs) { hit = c; return } walk(c) } }
      walk(n)
      return hit
    },
  }
  let own = ''
  n.appendChild = (c) => {
    if (c && c.tag === '#frag') { for (const k of c.children.slice()) n.appendChild(k); return c }
    n.children.push(c)
    if (c && typeof c === 'object') c.parentNode = n
    return c
  }
  n.setAttribute = (k, val) => { n.attrs[k] = val }
  Object.defineProperty(n, 'textContent', { get: () => own + n.children.map((c) => c.textContent || '').join(''), set: (x) => { n.children.length = 0; own = String(x) } })
  // innerHTML 轻量解析:mount 的模板只有 div/input + class/data-*,平铺子元素即可
  // (querySelector 只按 [data-*] 找,不需要真实嵌套结构);赋 '' 即清空。
  Object.defineProperty(n, 'innerHTML', {
    get: () => '',
    set: (html) => {
      n.children.length = 0
      own = ''
      const s = String(html)
      const re = /<(\w+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
      let m
      while ((m = re.exec(s))) {
        const el = mkEl(m[1])
        const attrs = m[2] || ''
        const cm = /class="([^"]*)"/.exec(attrs)
        if (cm) el.className = cm[1]
        for (const am of attrs.matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)) el.attrs[am[1]] = am[2] || ''
        el.parentNode = n
        n.children.push(el)
      }
    },
  })
  return n
}
globalThis.document = {
  createElement: mkEl, createTextNode: mkText, createDocumentFragment: () => mkEl('#frag'),
  head: mkEl('head'), body: mkEl('body'), querySelector: () => null, addEventListener() {}, removeEventListener() {},
}
const findAll = (node, tag) => { const out = []; const walk = (n) => { for (const c of (n.children || [])) { if (c.tag === tag) out.push(c); walk(c) } }; walk(node); return out }
const anyAttr = (node, key) => { let hit = false; const walk = (n) => { if (n.attrs && key in n.attrs) hit = true; for (const c of (n.children || [])) walk(c) }; walk(node); return hit }

// 冻钟 + 假 localStorage
const NOW = new Date('2026-08-06T12:00:00+08:00').getTime()
Date.now = () => NOW
const _ls = new Map()
globalThis.localStorage = { getItem: (k) => (_ls.has(k) ? _ls.get(k) : null), setItem: (k, v) => _ls.set(k, String(v)), removeItem: (k) => _ls.delete(k) }
// 默认网络:全 reject(连接失败降级用例先行)
globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'))

// ── 静态卫生:ASI 陷阱 + 写死白字 ──
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
  A.ok(!/color:\s*#fff\b/i.test(src), 'CSS 不许写死白字(强调色上的字一律 var(--zt-on-fill))')
  A.ok(!/\bsetInterval\s*\(/.test(src), '轮询禁 setInterval(BRIEF 时间纪律)')
  A.ok(!/^\s*(import|export)\s/m.test(src), '裸 setup 体不许顶层 import/export')
  A.ok(!/ctx\.app\.openFile\s*\(/.test(src), '禁调 ctx.app.openFile:宿主对裸 .md 回落系统默认程序(TextEdit/VS Code),阅读笔记一律 loadPage 进编辑器')
}

// ── 求值 main.js(完整宿主 mock;内存 vault) ──
globalThis.__ZOTERO_TEST__ = {}
const V = new Map()
const writes = []
const notices = []
const activityLog = []
const opened = []
const loads = []
const reg = { views: [], commands: [], settings: [] }
const ctx = {
  registerView: (v) => reg.views.push(v),
  registerCommand: (c) => reg.commands.push(c),
  registerSetting: (s) => reg.settings.push(s),
  registerStatusItem: () => ({ update() {}, dispose() {} }),
  notify: (m, o) => notices.push({ m, o }),
  activity: { log: (e, d) => activityLog.push({ e, d }) },
  openView() {},
  app: {
    notify: (m) => notices.push({ m }),
    workFolder: () => '文献工作台',
    readFile: async (p) => (V.has(p) ? V.get(p) : null),
    writeFile: async (p, t) => { V.set(p, String(t)); writes.push(p) },
    openFile: (p) => opened.push(p),
    loadPage: (p) => loads.push(p),
    getActivePage: () => null,
  },
}
const dispose = new Function('ctx', src)(ctx)
const T = globalThis.__ZOTERO_TEST__

// ── ① 贡献点契约 ──
A.equal(typeof dispose, 'function', 'setup 应返回 disposer')
const view = reg.views.find((v) => v.id === 'library')
A.ok(view && typeof view.mount === 'function', '应注册 library 视图')
A.equal(view.title, '文献工作台', '视图标题=文献工作台')
A.ok(reg.commands.find((c) => c.id === 'zotero-open' && c.title === '文献工作台:打开'), '应注册 zotero-open 命令')
A.ok(reg.commands.find((c) => c.id === 'zotero-cite' && c.title.includes('插入引用')), '应注册 zotero-cite 命令')
const setPort = reg.settings.find((s) => s.key === 'port')
A.ok(setPort && setPort.type === 'number' && setPort.default === 23119, 'port 设置 number 默认 23119')
const setStyle = reg.settings.find((s) => s.key === 'noteNameStyle')
A.ok(setStyle && setStyle.type === 'text' && setStyle.default === 'author-year', 'noteNameStyle 设置 text 默认 author-year')
for (const k of ['parseItem', 'parseItems', 'parseAnnotations', 'findPdfAttachment', 'citeName', 'buildNoteMd', 'mergeAnnotations', 'buildCitation', 'ztGet', 'ensureNote', 'importAnnotations', 'insertCite', 'upsertAiSection', 'parseLitreview', 'buildItemRow', 'buildDetailCard', 'stripZann', 'openNoteInEditor', 'writeNote', 'openZoteroUri', 'fmQ']) {
  A.equal(typeof T[k], 'function', `钩子应暴露 ${k}`)
}

// ── 契约 URL(SPEC 钉死的查询串) ──
A.equal(T.apiBase(23119), 'http://localhost:23119/api/users/0')
A.equal(T.qConn(), '/items?limit=1')
A.equal(T.qAllItems(), '/items?itemType=-attachment&limit=100')
A.equal(T.qSearch('注意力 attention'), `/items?q=${encodeURIComponent('注意力 attention')}&itemType=-attachment&limit=100`)
A.equal(T.qColItems('COL1'), '/collections/COL1/items?itemType=-attachment&limit=100')
A.equal(T.qCollections(), '/collections?limit=100', '集合端点须显式 limit(本地 API 默认只回 25 条,集合树会静默截断)')
A.equal(T.qChildren('ABCD1234'), '/items/ABCD1234/children')
A.equal(T.portOf(), 23119, '未配置时端口=23119')
_ls.set('plugin.zotero.port', '9999')
A.equal(T.portOf(), 9999, '设置端口生效')
_ls.set('plugin.zotero.port', 'abc')
A.equal(T.portOf(), 23119, '非法端口回落默认')
_ls.delete('plugin.zotero.port')

// ── ⑥ 连接失败降级:fetch reject → {ok:false},不抛 ──
{
  const r = await T.ztGet(T.qConn())
  A.equal(r.ok, false, '网络拒绝应回 ok:false 而不是抛')
  A.ok(String(r.error).includes('ECONNREFUSED'), '错误信息透传')
}

// ── fixture(按 SPEC 响应形状造)+ 路由 fetch ──
const FIX_ITEM_A = { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'Attention Is All You Need', creators: [{ lastName: 'Vaswani', firstName: 'Ashish', creatorType: 'author' }, { lastName: 'Shazeer', firstName: 'Noam', creatorType: 'author' }], date: '2017-06-12', publicationTitle: 'NeurIPS', DOI: '10.48550/arXiv.1706.03762', url: 'https://arxiv.org/abs/1706.03762', abstractNote: 'The dominant sequence transduction models are based on complex recurrent networks.', dateAdded: '2024-01-02T03:04:05Z' } }
const FIX_ITEM_NODATE = { key: 'NODATE01', data: { itemType: 'report', title: '无日期条目', creators: [{ lastName: '王', firstName: '五', creatorType: 'author' }] } }
const FIX_ITEM_NOCREATORS = { key: 'NOCREAT1', data: { itemType: 'webpage', title: 'No creators here', date: '2020' } }
const FIX_ITEM_NOTE = { key: 'ZNOTE001', data: { itemType: 'note' } }
let FIX_CHILDREN = [
  { key: 'ANN00001', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'Attention is all you need', annotationComment: '核心论点', annotationColor: '#ffd400', annotationPageLabel: '3' } },
  { key: 'ANN00002', data: { itemType: 'annotation', annotationType: 'note', annotationComment: '查 BLEU 分数' } },
  { key: 'ATT00001', data: { itemType: 'attachment', contentType: 'application/pdf', filename: 'paper.pdf' } },
  { key: 'ATT00002', data: { itemType: 'attachment', contentType: 'text/html', filename: 'snapshot.html' } },
  { key: 'ANNIMG01', data: { itemType: 'annotation', annotationType: 'image' } },
]
const fetched = []
const fetchOpts = []
globalThis.fetch = async (url, opts) => {
  fetched.push(String(url))
  fetchOpts.push(opts || {})
  const u = String(url)
  let payload = []
  if (u.includes('/children')) payload = FIX_CHILDREN
  else if (u.includes('/collections?') || u.endsWith('/collections')) payload = [{ key: 'C1', data: { name: '机器学习', parentCollection: false } }, { key: 'C2', data: { name: '注意力', parentCollection: 'C1' } }, { key: 'C3', data: { name: '孤儿集合', parentCollection: 'GONE' } }]
  else if (u.includes('/items')) payload = [FIX_ITEM_A, FIX_ITEM_NODATE, FIX_ITEM_NOCREATORS, FIX_ITEM_NOTE]
  return { ok: true, status: 200, json: async () => payload }
}

// ── fixture 解析:条目 / creators 拼名 / 缺字段容错 ──
const itA = T.parseItem(FIX_ITEM_A)
A.equal(itA.key, 'ABCD1234')
A.equal(itA.title, 'Attention Is All You Need')
A.equal(itA.authors, 'Vaswani, Shazeer', 'creators 拼姓,逗号分隔')
A.equal(itA.year, '2017')
A.equal(itA.journal, 'NeurIPS')
A.equal(itA.doi, '10.48550/arXiv.1706.03762')
const itND = T.parseItem(FIX_ITEM_NODATE)
A.equal(itND.year, '', '无 date → year 空,不抛')
A.equal(itND.authors, '王')
const itNC = T.parseItem(FIX_ITEM_NOCREATORS)
A.equal(itNC.authors, '', '无 creators → authors 空,不抛')
A.equal(itNC.year, '2020')
A.equal(T.parseItem({}).title, '(无标题)', '空对象容错')
A.equal(T.parseItem(null).key, '', 'null 容错')
const list = T.parseItems([FIX_ITEM_A, FIX_ITEM_NODATE, FIX_ITEM_NOCREATORS, FIX_ITEM_NOTE, null])
A.equal(list.length, 3, '列表解析滤掉 note 型与 null')

// 集合解析 + 树(孤儿不弄丢)
const cols = T.parseCollections([{ key: 'C1', data: { name: '机器学习', parentCollection: false } }, { key: 'C2', data: { name: '注意力', parentCollection: 'C1' } }, { key: 'C3', data: { name: '孤儿', parentCollection: 'GONE' } }])
A.equal(cols.length, 3)
const tree = T.collectionTree(cols)
A.equal(tree.length, 3, '孤儿集合不丢')
A.equal(tree.find((c) => c.key === 'C2').depth, 1, '子集合缩进一层')
A.equal(tree.find((c) => c.key === 'C3').depth, 0, '孤儿提顶层')
// parentCollection 互指成环:环成员的 parent 都在 keys 里,只救孤儿会整组静默丢失
{
  const cyc = T.collectionTree([{ key: 'CYA', name: '甲', parent: 'CYB' }, { key: 'CYB', name: '乙', parent: 'CYA' }])
  A.equal(cyc.length, 2, 'parent 成环的集合不得整组静默丢失')
  A.ok(cyc.some((c) => c.key === 'CYA') && cyc.some((c) => c.key === 'CYB'), '环成员都提到树里')
}

// 批注/附件解析
const anns = T.parseAnnotations(FIX_CHILDREN)
A.equal(anns.length, 2, 'highlight+note 各一条,image 型忽略')
A.equal(anns[0].key, 'ANN00001')
A.equal(anns[0].type, 'highlight')
A.equal(anns[1].type, 'note')
A.equal(T.findPdfAttachment(FIX_CHILDREN), 'ATT00001', '认 PDF 附件')
A.equal(T.findPdfAttachment([FIX_CHILDREN[3]]), '', '非 PDF 附件不算')
A.equal(T.colorName('#ffd400'), 'yellow')
A.equal(T.colorName('#123456'), '#123456', '未知色原样')
A.equal(T.annLines(anns[0]), '- 「Attention is all you need」(p.3, yellow) — 核心论点\n<!-- zann:ANN00001 -->', '契约行格式')
A.ok(T.annLines(anns[1]).startsWith('- (批注) 查 BLEU 分数'), 'note 型批注行')

// ── 引用名生成 ──
A.equal(T.citeName(itA), 'Vaswani2017-attention-is-all-you')
A.equal(T.citeName(itND), '王-无日期条目', '无年份仍可生成')
A.equal(T.citeName(itNC), 'Anon2020-no-creators-here', '无作者 → Anon')
A.equal(T.slugTitle(''), 'untitled')
// slug 按码点截断:slice 码元会从代理对中间切断,文件名尾孤立高代理落盘变 U+FFFD,
// 磁盘文件名 / .zotero-index.json path / [[双链]] 三者字面就不一致了
A.equal(T.slugTitle('aaaaaaaaaaaaaaaaaaa😀bbbb'), 'aaaaaaaaaaaaaaaaaaa😀', 'slug 码点截断,不得切出孤立代理')
A.ok(!/[\uD800-\uDBFF]$/.test(T.citeName(T.parseItem({ key: 'EMOJI001', data: { title: 'aaaaaaaaaaaaaaaaaaa😀bbbb', date: '2020' } }))), '引用名不以孤立高代理结尾')
// 作者姓含 ]] | # ^:进 sanitizeFileName 必须滤掉,否则 [[引用名]] 在第一个 ]] 处提前闭合
{
  const trick = T.parseItem({ key: 'BRKT0001', data: { title: 'Bracket Paper', date: '2020', creators: [{ lastName: 'Sm]]ith|X#y^z', creatorType: 'author' }] } })
  const nm = T.citeName(trick)
  A.ok(!/[[\]|#^]/.test(nm), '引用名不得含 []|#^ 等拆坏 [[双链]] 的字符')
  const cite = T.buildCitation(trick, nm)
  const inner = /\[\[([^\]]*)\]\]/.exec(cite)
  A.ok(inner && inner[1] === nm, '引用块双链完整闭合,不被作者姓里的 ]] 提前截断')
}
A.equal(T.authorCite(itA.creators), 'Vaswani & Shazeer')
A.equal(T.authorCite([{ lastName: 'A' }, { lastName: 'B' }, { lastName: 'C' }]), 'A et al.')
A.equal(T.authorCite([]), 'Anon')

// ── 数据契约:笔记骨架 + frontmatter 往返 ──
const noteMd = T.buildNoteMd(itA)
for (const s of ['zt_key: "ABCD1234"', 'zt_title: "Attention Is All You Need"', 'zt_authors: "Vaswani, Shazeer"', 'zt_year: "2017"', 'zt_doi: "10.48550/arXiv.1706.03762"', '(zotero://select/library/items/ABCD1234)', '`zotero://select/library/items/ABCD1234`', '## 划线与批注', '## 我的笔记']) {
  A.ok(noteMd.includes(s), `笔记骨架应含:${s}`)
}
const meta = T.parseNoteMeta(noteMd)
A.equal(meta.zt_key, 'ABCD1234', 'frontmatter 往返 key')
A.equal(meta.zt_title, 'Attention Is All You Need', 'frontmatter 往返 title')
A.equal(meta.zt_year, '2017')
A.ok(T.buildNoteMd(T.parseItem({ key: 'X1', data: { title: '换\n行\n标题' } })).includes('zt_title: "换 行 标题"'), 'frontmatter 值折叠换行')

// ── frontmatter YAML 引号转义:带冒号/井号/引号/反斜杠的标题是学术常态,裸写会让宿主属性面板
//    解析抛错(原文模式下点「添加属性」整段 zt_* 被覆盖)或 ` #` 静默截断后回写永久丢失 ──
{
  const tricky = T.parseItem({ key: 'YAML0001', data: { itemType: 'journalArticle', title: 'BERT: Pre-training #1 "Deep" \\Bidirectional', date: '2019', creators: [{ lastName: 'Devlin: Jr', creatorType: 'author' }], DOI: '10.1/x: y' } })
  const md = T.buildNoteMd(tricky)
  A.ok(md.includes('zt_title: "BERT: Pre-training #1 \\"Deep\\" \\\\Bidirectional"'), 'zt_title 双引号包裹且转义 " 与 \\')
  A.ok(/^zt_key: "/m.test(md) && /^zt_authors: "/m.test(md) && /^zt_year: "/m.test(md) && /^zt_doi: "/m.test(md), '五个 zt_* 一律引号包裹')
  const back = T.parseNoteMeta(md)
  A.equal(back.zt_title, 'BERT: Pre-training #1 "Deep" \\Bidirectional', '读回剥引号反转义,含 # 不截断')
  A.equal(back.zt_key, 'YAML0001')
  A.equal(back.zt_authors, 'Devlin: Jr')
  A.equal(back.zt_doi, '10.1/x: y')
  A.equal(T.fmQ('a' + String.fromCharCode(1) + 'b'), '"a b"', '残余控制字符置空格(YAML 双引号标量不许裸控制字符)')
  // 旧笔记(无引号 frontmatter)读回仍兼容
  A.equal(T.parseNoteMeta('---\nzt_key: OLDKEY01\nzt_title: 旧式无引号标题\n---\n').zt_title, '旧式无引号标题')
  A.equal(T.parseNoteMeta('---\nzt_key: OLDKEY01\n---\n').zt_key, 'OLDKEY01')
}

// ── frontmatter 也是外来面:标题嵌哨兵字面必须消毒,否则该 key 真批注永远 added=0 ──
{
  const evil = T.parseItem({ key: 'FMEVIL01', data: { title: 'Paper <!-- zann:AAAA1111 --> X' } })
  const md = T.buildNoteMd(evil)
  A.ok(!T.extractZannKeys(md).has('AAAA1111'), '标题嵌哨兵字面进 frontmatter 被打断')
  A.equal(T.mergeAnnotations(md, [{ key: 'AAAA1111', type: 'highlight', text: 'real', comment: '', color: '', pageLabel: '' }]).added, 1, '该 key 真批注照导')
}

// ── 批注导入幂等 + 「我的笔记」节逐字节保护 ──
{
  const first = T.mergeAnnotations(noteMd, anns)
  A.equal(first.added, 2, '首次导入 2 条')
  A.ok(first.md.includes('<!-- zann:ANN00001 -->') && first.md.includes('<!-- zann:ANN00002 -->'), '哨兵落盘')
  A.ok(first.md.indexOf('## 划线与批注') < first.md.indexOf('zann:ANN00001'), '批注在节内')
  A.ok(first.md.indexOf('zann:ANN00002') < first.md.indexOf('## 我的笔记'), '批注在「我的笔记」之上')
  const again = T.mergeAnnotations(first.md, anns)
  A.equal(again.added, 0, '二次导入 0 新增')
  A.equal(again.md, first.md, '二次导入内容逐字节不变')
  // 用户在「我的笔记」写入含子标题/伪批注行的敌意内容 → 导入新 key 后该节逐字节不变
  const hostile = first.md + '用户自由区第一行\n\n## 子标题也不许动\n\n- 「fake」(p.9, red) — 伪装批注行\n<!-- zann:FAKE0001 -->\n尾行'
  const tailBefore = hostile.slice(hostile.indexOf('## 我的笔记'))
  const more = [...anns, { key: 'ANN00003', type: 'highlight', text: 'New highlight', comment: '', color: '#2ea8e5', pageLabel: '7' }]
  const second = T.mergeAnnotations(hostile, more)
  A.equal(second.added, 1, '新 key 只增量 1 条')
  A.ok(second.md.includes('<!-- zann:ANN00003 -->'), '新批注写入')
  A.equal(second.md.slice(second.md.indexOf('## 我的笔记')), tailBefore, '「我的笔记」节(至 EOF)逐字节不变')
  A.ok(second.md.indexOf('zann:ANN00003') < second.md.indexOf('## 我的笔记'), '新批注仍在「我的笔记」之上')
  // 「划线与批注」标题被用户删掉 → 自愈补回
  const noSection = noteMd.replace('## 划线与批注\n', '')
  const healed = T.mergeAnnotations(noSection, anns)
  A.ok(healed.md.includes('## 划线与批注'), '缺节自愈补标题')
  A.equal(healed.added, 2)
}

// ── AI 速览节:置于「我的笔记」之上;重写替换;tail 不动 ──
{
  const withAnn = T.mergeAnnotations(noteMd, anns).md
  const seeded = withAnn + '我的私货\n'
  const tail = seeded.slice(seeded.indexOf('## 我的笔记'))
  const v1 = T.upsertAiSection(seeded, '**贡献**:提出 Transformer。')
  A.ok(v1.includes('## AI 速览'), 'AI 节写入')
  A.ok(v1.indexOf('## AI 速览') < v1.indexOf('## 我的笔记'), 'AI 节在「我的笔记」之上')
  A.ok(v1.indexOf('zann:ANN00001') < v1.indexOf('## AI 速览'), 'AI 节在批注之下')
  A.equal(v1.slice(v1.indexOf('## 我的笔记')), tail, 'AI 写入不动「我的笔记」')
  const v2 = T.upsertAiSection(v1, '第二版速览')
  A.ok(v2.includes('第二版速览') && !v2.includes('提出 Transformer'), '重跑 AI 替换旧节')
  A.equal((v2.match(/## AI 速览/g) || []).length, 1, 'AI 节不重复')
  A.equal(v2.slice(v2.indexOf('## 我的笔记')), tail, '替换也不动「我的笔记」')
}

// ── 导入 → AI 速览 → 再导入 → AI 重跑:批注必须始终落「划线与批注」节内,AI 重跑不吃批注 ──
{
  const m1 = T.mergeAnnotations(T.buildNoteMd(itA), anns).md
  const ai1 = T.upsertAiSection(m1, '速览第一版')
  const tail = ai1.slice(ai1.indexOf('## 我的笔记'))
  const late = { key: 'ANNLATE1', type: 'highlight', text: 'late highlight', comment: '', color: '', pageLabel: '' }
  const m2 = T.mergeAnnotations(ai1, [...anns, late])
  A.equal(m2.added, 1, 'AI 节已存在时新批注仍增量导入')
  const iSec = m2.md.indexOf('## 划线与批注')
  const iNew = m2.md.indexOf('zann:ANNLATE1')
  const iAi = m2.md.indexOf('## AI 速览')
  const iMy = m2.md.indexOf('## 我的笔记')
  A.ok(iSec >= 0 && iSec < iNew && iNew < iAi && iAi < iMy, 'AI 节已存在时,新批注插进「划线与批注」节内(节 < 新批注 < AI < 我的笔记)')
  A.equal(m2.md.slice(m2.md.indexOf('## 我的笔记')), tail, '再导入不动「我的笔记」')
  const ai2 = T.upsertAiSection(m2.md, '速览第二版')
  A.equal(T.extractZannKeys(ai2).size, T.extractZannKeys(m2.md).size, 'AI 重跑不吃掉批注哨兵')
  A.ok(ai2.includes('zann:ANNLATE1') && ai2.includes('速览第二版') && !ai2.includes('速览第一版'), '后导入的批注在 AI 重跑后幸存,AI 节被替换')
  A.equal(ai2.slice(ai2.indexOf('## 我的笔记')), tail, 'AI 重跑不动「我的笔记」')
}

// ── 哨兵字面消毒:批注/AI 文本内嵌他条哨兵字面,不得抑制真批注导入(幂等防全文字面污染) ──
{
  const evilAnn = { key: 'AAAA0001', type: 'highlight', text: '看这段 <!-- zann:BBBB0002 --> 注入', comment: '评论也来一发 <!--zann:CCCC0003-->', color: '', pageLabel: '' }
  const lineKeys = T.extractZannKeys(T.annLines(evilAnn))
  A.equal(lineKeys.size, 1, '批注行只带自己的真哨兵')
  A.ok(lineKeys.has('AAAA0001'), '真哨兵保留')
  A.ok(T.annLines(evilAnn).includes('看这段'), '消毒不吞正文')
  const m1 = T.mergeAnnotations(T.buildNoteMd(itA), [evilAnn])
  A.equal(m1.added, 1)
  const realB = { key: 'BBBB0002', type: 'highlight', text: 'the real highlight', comment: '', color: '', pageLabel: '' }
  const realC = { key: 'CCCC0003', type: 'note', text: '', comment: 'real note', color: '', pageLabel: '' }
  const m2 = T.mergeAnnotations(m1.md, [evilAnn, realB, realC])
  A.equal(m2.added, 2, '被注入哨兵字面的 key 的真批注仍然导得进(不被字面污染抑制)')
  A.ok(m2.md.includes('<!-- zann:BBBB0002 -->') && m2.md.includes('<!-- zann:CCCC0003 -->'), '真批注哨兵落盘')
  // AI 文本同面消毒:模型产出嵌哨兵字面不得污染幂等
  const ai = T.upsertAiSection(m2.md, '速览正文 <!-- zann:DDDD0004 --> 尾巴')
  A.ok(!T.extractZannKeys(ai).has('DDDD0004'), 'AI 文本里的哨兵字面被打断')
  A.equal(T.extractZannKeys(ai).size, T.extractZannKeys(m2.md).size, 'AI 写入不多不少一个哨兵')
  A.equal(T.mergeAnnotations(ai, [{ key: 'DDDD0004', type: 'highlight', text: 'later', comment: '', color: '', pageLabel: '' }]).added, 1, 'AI 注入后该 key 真批注照导')
}

// ── 幂等去重范围=head(导入区):用户把批注行连哨兵剪切进「我的笔记」自由区,不得反向抑制导入 ──
{
  const base = T.mergeAnnotations(T.buildNoteMd(itA), anns).md
  const annLine = '- 「Attention is all you need」(p.3, yellow) — 核心论点\n<!-- zann:ANN00001 -->\n'
  A.ok(base.includes(annLine), '前提:批注行在导入区')
  const moved = base.replace(annLine, '').replace(/## 我的笔记\n/, `## 我的笔记\n把这条拎过来展开评论:\n${annLine}`)
  const re = T.mergeAnnotations(moved, anns)
  A.equal(re.added, 1, '哨兵只在「我的笔记」自由区时,该批注仍能导回导入区')
  const myIdx = re.md.indexOf('## 我的笔记')
  A.ok(re.md.slice(0, myIdx).includes('<!-- zann:ANN00001 -->'), '导回的落在导入区')
  A.equal(re.md.slice(myIdx), moved.slice(moved.indexOf('## 我的笔记')), '自由区仍逐字节不变')
  // 批次内部重复 key(畸形 /children 响应):只写一行一枚哨兵
  const dup = { key: 'DUPK0001', type: 'highlight', text: 'dup', comment: '', color: '', pageLabel: '' }
  const md2 = T.mergeAnnotations(T.buildNoteMd(itA), [dup, dup, { ...dup }])
  A.equal(md2.added, 1, '批次内重复 key 只算一条')
  A.equal((md2.md.match(/<!-- zann:DUPK0001 -->/g) || []).length, 1, '哨兵只落一枚')
}

// ── 引用块组装 ──
A.equal(
  T.buildCitation(itA, 'Vaswani2017-attention-is-all-you'),
  '> Vaswani & Shazeer(2017). Attention Is All You Need. NeurIPS. [Zotero](zotero://select/library/items/ABCD1234) · [[Vaswani2017-attention-is-all-you]]',
  '引用块契约格式(SPEC 钉死「作者(年)」,作者与年份间不带空格)')
const citeND = T.buildCitation(itND, '王-无日期条目')
A.ok(citeND.includes('(n.d.)') && !citeND.includes('undefined'), '无年份 → n.d.,无期刊不留空段')
A.ok(!citeND.includes('.  ['), '无期刊时不出现双空格')

// ── AI 指令(英文纪律)与 litreview 解析 ──
{
  const msg = T.buildLitreviewMessage('note body here', 'abstract here')
  A.ok(msg.includes('litreview') && msg.includes('Never fabricate'), '指令为英文且带 litreview 约定')
  A.ok(msg.includes('note body here') && msg.includes('abstract here'), '材料注入')
  A.ok(msg.includes('(none)') === false, '有摘要时不标 none')
  A.ok(T.buildLitreviewMessage('x', '').includes('(none)'), '无摘要标 (none)')
  A.equal(T.parseLitreview('前言\n```litreview\n**贡献**:A\n```\n后记'), '**贡献**:A', '取 litreview 块')
  A.equal(T.parseLitreview('```\n裸块\n```'), '裸块', '通用围栏兜底')
  A.equal(T.parseLitreview('纯文本回答'), '纯文本回答', '无围栏整段兜底')
}

// ── ztGet 走 fixture:URL 形状 + 数据落地 ──
{
  const r = await T.ztGet(T.qConn())
  A.equal(r.ok, true)
  A.ok(fetched[fetched.length - 1] === 'http://localhost:23119/api/users/0/items?limit=1', '连接检查 URL 契约')
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    A.ok(fetchOpts[fetchOpts.length - 1].signal, 'ztGet 应带超时 signal(防火墙 DROP 挂起时连接卡死无恢复)')
  }
}

// ── ensureNote:建盘 + 索引 + 重名序号 + 索引丢失按 zt_key 认领 ──
{
  const n1 = await T.ensureNote(itA)
  A.equal(n1.created, true)
  A.equal(n1.path, '文献工作台/Vaswani2017-attention-is-all-you.md', '笔记落工作文件夹,引用名命名')
  A.ok(V.has(n1.path), '笔记已写盘')
  A.equal(T.parseNoteMeta(V.get(n1.path)).zt_key, 'ABCD1234')
  const idx1 = JSON.parse(V.get('文献工作台/.zotero-index.json'))
  A.ok(idx1.notes.ABCD1234 && idx1.notes.ABCD1234.path === n1.path && idx1.notes.ABCD1234.touched === NOW, '索引契约 {path,title,touched}')
  A.equal(idx1.notes.ABCD1234.title, 'Attention Is All You Need')
  const n1b = await T.ensureNote(itA)
  A.equal(n1b.created, false, '已有笔记复用不重建')
  // 同名不同条目 → 序号
  const itClone = { ...itA, key: 'DUPL5678' }
  const n2 = await T.ensureNote(itClone)
  A.equal(n2.path, '文献工作台/Vaswani2017-attention-is-all-you-2.md', '重名加序号')
  // 索引整个丢失 → 按文件 zt_key 认领,不再建第三份
  V.delete('文献工作台/.zotero-index.json')
  const n3 = await T.ensureNote(itA)
  A.equal(n3.path, n1.path, '索引丢失按 zt_key 认领原文件')
  A.equal(n3.created, false)
  const idx2 = JSON.parse(V.get('文献工作台/.zotero-index.json'))
  A.ok(idx2.notes.ABCD1234, '认领后索引重建')
}

// ── 索引自愈:指向已删文件的项被剔除;坏 JSON 容错 ──
{
  const idx = await T.readIndex()
  idx.notes.GHOST999 = { path: '文献工作台/已删.md', title: '鬼', touched: NOW }
  await T.writeIndex(idx)
  const healed = await T.healIndex()
  A.ok(!healed.notes.GHOST999, '自愈剔除失效项')
  A.ok(healed.notes.ABCD1234, '有效项保留')
  A.ok(!JSON.parse(V.get('文献工作台/.zotero-index.json')).notes.GHOST999, '自愈落盘')
  V.set('文献工作台/.zotero-index.json', '不是 JSON{{{')
  A.deepEqual((await T.readIndex()).notes, {}, '坏索引回空不抛')
  const reIdx = { notes: { ABCD1234: { path: '文献工作台/Vaswani2017-attention-is-all-you.md', title: 'Attention Is All You Need', touched: NOW } } }
  await T.writeIndex(reIdx)
}

// ── 索引身份校验:索引是用户库里的普通 JSON(同步/手改/路径复用都可能串),快路径与自愈都必须
//    验文件 zt_key 归属,否则导入/AI 会写进无关笔记 ──
{
  V.set('文献工作台/别人的笔记.md', '---\nzt_key: "OTHER999"\n---\n\n## 划线与批注\n\n## 我的笔记\n他人内容\n')
  const idx = await T.readIndex()
  idx.notes.HJCK0001 = { path: '文献工作台/别人的笔记.md', title: '被串改', touched: NOW }
  await T.writeIndex(idx)
  const victim = { key: 'HJCK0001', itemType: 'journalArticle', title: 'Hijack Test Paper', creators: [{ lastName: 'Hijack', creatorType: 'author' }], authors: 'Hijack', year: '2021', journal: '', doi: '', url: '', abstract: '', dateAdded: '' }
  const n = await T.ensureNote(victim)
  A.ok(n.path !== '文献工作台/别人的笔记.md', '身份不符的索引项不得复用别人的笔记')
  A.equal(T.parseNoteMeta(V.get(n.path)).zt_key, 'HJCK0001', '认领/新建的笔记 zt_key 归本条目')
  A.ok(V.get('文献工作台/别人的笔记.md').includes('他人内容'), '别人的笔记未被触碰')
  // healIndex 同法剔除身份不符项
  const idx2 = await T.readIndex()
  idx2.notes.HJCK0002 = { path: '文献工作台/别人的笔记.md', title: '又一条串改', touched: NOW }
  await T.writeIndex(idx2)
  const healed = await T.healIndex()
  A.ok(!healed.notes.HJCK0002, 'healIndex 剔除 zt_key 不符的索引项')
  A.ok(healed.notes.HJCK0001, '身份相符的项保留')
  // 无 zt_key 的老笔记(用户删过 frontmatter)放行:快路径复用 + 自愈保留
  V.set('文献工作台/无头老笔记.md', '# 老笔记\n正文')
  const idx3 = await T.readIndex()
  idx3.notes.OLDNOTE1 = { path: '文献工作台/无头老笔记.md', title: '老', touched: NOW }
  await T.writeIndex(idx3)
  const n2 = await T.ensureNote({ key: 'OLDNOTE1', title: 'Old Note', creators: [], authors: '', year: '', journal: '', doi: '', url: '', abstract: '', dateAdded: '' })
  A.equal(n2.path, '文献工作台/无头老笔记.md', '无 zt_key 的老笔记放行复用')
  A.ok((await T.healIndex()).notes.OLDNOTE1, 'healIndex 对无 zt_key 老笔记放行')
  // 清场:剔掉本段的临时项,别污染后面的契约往返
  const idx4 = await T.readIndex()
  delete idx4.notes.HJCK0001
  delete idx4.notes.OLDNOTE1
  await T.writeIndex(idx4)
}

// ── importAnnotations:走 fixture children,幂等 ──
{
  const r1 = await T.importAnnotations(itA)
  A.equal(r1.added, 2, '首次导入新增 2')
  A.equal(r1.total, 2)
  const fileMd = V.get(r1.note.path)
  A.ok(fileMd.includes('<!-- zann:ANN00001 -->') && fileMd.includes('- 「Attention is all you need」(p.3, yellow) — 核心论点'), '批注行落盘')
  const r2 = await T.importAnnotations(itA)
  A.equal(r2.added, 0, '二次导入 0 新增')
  A.equal(V.get(r1.note.path), fileMd, '二次导入文件逐字节不变')
  FIX_CHILDREN = [...FIX_CHILDREN, { key: 'ANN00009', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'Later highlight', annotationColor: '#5fb236', annotationPageLabel: '12' } }]
  const r3 = await T.importAnnotations(itA)
  A.equal(r3.added, 1, '新 key 只增量')
  A.ok(V.get(r1.note.path).includes('zann:ANN00009'))
  // 无批注条目:children 全是附件 → added 0, total 0,不建笔记
  const saveChildren = FIX_CHILDREN
  FIX_CHILDREN = [{ key: 'ATTX', data: { itemType: 'attachment', contentType: 'application/pdf' } }]
  const r4 = await T.importAnnotations({ ...itA, key: 'EMPTY001', title: 'Empty', creators: [], year: '' })
  A.equal(r4.total, 0)
  A.equal(r4.note, null, '无批注不建笔记')
  FIX_CHILDREN = saveChildren
}

// ── 插入引用:令牌现取、null 起插、活动页缺失提示、activity 埋点 ──
{
  let pageCalls = 0
  const inserted = []
  ctx.app.getPage = () => { pageCalls++; return { token: `tok-${pageCalls}`, path: 'notes/正在写.md', status: 'ready', blocks: {}, order: [], fmExtra: '' } }
  ctx.app.insertBlockAfter = (token, afterId, content) => { inserted.push({ token, afterId, content }); return 'b9' }
  A.equal(T.hasBlockSurface(), true)
  const res = await T.insertCite(itA, 'Vaswani2017-attention-is-all-you')
  A.equal(res, 'inserted')
  A.equal(inserted.length, 1)
  A.equal(inserted[0].afterId, null, '按 SPEC insertBlockAfter(token, null, md)')
  A.equal(inserted[0].token, 'tok-1', '令牌现取')
  A.ok(inserted[0].content.startsWith('> Vaswani & Shazeer(2017).'), '插入的是引用块')
  A.ok(activityLog.find((l) => l.e === 'cite'), '插入引用记 activity cite')
  await T.insertCite(itA, 'x')
  A.equal(inserted[1].token, 'tok-2', '每次点击重新取 token,绝不缓存')
  // 无活动页 → 提示,不插入
  ctx.app.getPage = () => ({ token: 't', path: null, status: 'idle', blocks: {}, order: [], fmExtra: '' })
  const res2 = await T.insertCite(itA, 'x')
  A.equal(res2, 'nopage')
  A.ok(notices.some((n) => String(n.m).includes('先在编辑器里打开一篇笔记')), '无活动页有提示')
  // 令牌过期 → insertBlockAfter 回 null
  ctx.app.getPage = () => ({ token: 'stale', path: 'a.md', status: 'ready', blocks: {}, order: [], fmExtra: '' })
  ctx.app.insertBlockAfter = () => null
  A.equal(await T.insertCite(itA, 'x'), 'stale', '令牌过期报插入失败')
}

// ── zotero:// 唤起降级:Electron 宿主对非 http(s) 的 window.open 一律 deny(返回 null),
//    不能装作打开成功——必须回落复制 URI + 提示,否则「在 Zotero 打开 PDF」点了毫无反应 ──
{
  const copied = []
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => copied.push(t) } }, configurable: true })
  globalThis.window = { open: () => null } // 宿主 deny
  const r1 = await T.openZoteroUri('zotero://open-pdf/library/items/ATT00001')
  A.equal(r1, 'copied', 'window.open 被宿主 deny 时回落复制')
  A.deepEqual(copied, ['zotero://open-pdf/library/items/ATT00001'], 'URI 原样进剪贴板')
  A.ok(notices.some((n) => String(n.m).includes('已复制链接')), '降级有用户可感提示')
  // 浏览器直跑:window.open 回真窗口代理 → 视为打开成功,不复制不提示
  globalThis.window = { open: () => ({}) }
  copied.length = 0
  A.equal(await T.openZoteroUri('zotero://select/library/items/K1'), 'opened', 'window.open 成功即打开')
  A.equal(copied.length, 0, '打开成功不复制')
  // window.open 抛(某些 webview 环境)也不许炸,照走降级
  globalThis.window = { open: () => { throw new Error('blocked') } }
  A.equal(await T.openZoteroUri('zotero://select/library/items/K2'), 'copied', 'window.open 抛异常照走复制降级')
  delete globalThis.window
}

// ── 打开阅读笔记=loadPage 进宿主编辑器(绝不 openFile);写活动页后强制回灌 ──
{
  loads.length = 0
  opened.length = 0
  A.equal(T.openNoteInEditor('文献工作台/x.md'), true)
  A.deepEqual(loads, ['文献工作台/x.md'], '打开阅读笔记走 ctx.app.loadPage')
  A.equal(opened.length, 0, '绝不 ctx.app.openFile(裸 .md 会被系统默认程序抢走)')
  // writeNote:目标=活动页 → 写盘后 loadPage 强制回灌(编辑器陈旧副本的防抖保存不再回滚导入)
  const p = '文献工作台/回灌.md'
  const prevActive = ctx.app.getActivePage
  ctx.app.getActivePage = () => p
  loads.length = 0
  await T.writeNote(p, 'v1 内容')
  A.equal(V.get(p), 'v1 内容', '写盘生效')
  A.deepEqual(loads, [p], '目标是活动页 → 写完 loadPage 回灌')
  // 目标非活动页 → 只写盘不回灌
  ctx.app.getActivePage = () => '别的笔记.md'
  loads.length = 0
  await T.writeNote(p, 'v2 内容')
  A.equal(V.get(p), 'v2 内容')
  A.equal(loads.length, 0, '非活动页写盘不回灌')
  ctx.app.getActivePage = prevActive
  loads.length = 0
}

// ── ④ XSS:恶意标题/字段走 DOM 拼装后无元素/属性注入 ──
{
  const evil = T.parseItem({ key: 'EVIL0001', data: { itemType: 'journalArticle', title: '<script>alert(1)</script><img src=x onerror=alert(2)>', creators: [{ lastName: '"><svg onload=alert(3)>' }], publicationTitle: '<b>期刊</b>', abstractNote: '<iframe src=evil>' } })
  const row = T.buildItemRow(evil, { hasNote: true })
  A.equal(findAll(row, 'script').length, 0, '绝不创建 script 元素')
  A.equal(findAll(row, 'img').length, 0, '绝不创建 img 元素')
  A.equal(anyAttr(row, 'onerror'), false)
  A.equal(anyAttr(row, 'onload'), false)
  A.ok(row.textContent.includes('<script>alert(1)</script>'), '恶意标题成为字面文字')
  const card = T.buildDetailCard(evil)
  A.equal(findAll(card, 'b').length, 0, '期刊字段不解析 HTML')
  A.equal(findAll(card, 'iframe').length, 0)
  A.equal(anyAttr(card, 'onload'), false)
  // 链接协议:javascript: 拒,https 放行
  A.equal(T.safeHref('javascript:alert(1)'), '')
  A.equal(T.safeHref('https://doi.org/10.1/x'), 'https://doi.org/10.1/x')
  const badUrl = T.parseItem({ key: 'U1', data: { title: 't', url: 'javascript:evil()' } })
  const card2 = T.buildDetailCard(badUrl)
  A.equal(anyAttr(card2, 'href'), false, '危险协议不设 href')
}

// ── 主题兜底可读性(照 bluebird 血泪回归) ──
{
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  A.equal(T.onColorOf(hex('#f8f7f6')), '#16161a', '纸白强调色配深字')
  A.equal(T.onColorOf(hex('#1c1c1c')), '#ffffff', '炭黑强调色配白字')
  for (const ac of ['#f8f7f6', '#ece7dd', '#ff9a7d', '#5fa3b2', '#1e96eb']) {
    A.ok(T.contrast(hex(ac), hex(T.onColorOf(hex(ac)))) >= 4.5, `${ac} 上的兜底字色对比度不足`)
  }
  const rgbOf = (s) => s.match(/\d+/g).map(Number)
  const blended = rgbOf(T.readableOn(hex('#2a292b'), hex('#2a292b'), hex('#f2efe8')))
  A.ok(T.contrast(blended, hex('#2a292b')) >= 3, '强调色贴底色时应掺开到 3:1')
}

// ── ⑤ 契约往返(写→读→再写,不丢字段) ──
{
  const p = '文献工作台/Vaswani2017-attention-is-all-you.md'
  const before = V.get(p)
  const meta2 = T.parseNoteMeta(before)
  A.deepEqual(
    [meta2.zt_key, meta2.zt_title, meta2.zt_year, meta2.zt_doi],
    ['ABCD1234', 'Attention Is All You Need', '2017', '10.48550/arXiv.1706.03762'],
    '导入后 frontmatter 字段全保留')
  const keys = T.extractZannKeys(before)
  A.ok(keys.has('ANN00001') && keys.has('ANN00002') && keys.has('ANN00009'), '哨兵 key 读回齐全')
  const rewritten = T.mergeAnnotations(T.upsertAiSection(before, '速览 v3'), T.parseAnnotations(FIX_CHILDREN)).md
  const meta3 = T.parseNoteMeta(rewritten)
  A.equal(meta3.zt_key, 'ABCD1234', '再写一轮 frontmatter 不丢')
  A.equal(T.extractZannKeys(rewritten).size, keys.size, '再写一轮哨兵不丢不重')
  const idxRt = await T.readIndex()
  await T.writeIndex(idxRt)
  A.deepEqual(await T.readIndex(), idxRt, '索引写→读→再写往返一致')
}

// ── 视图 mount 全链路:首屏不抛、fixture 下连接/集合/列表渲染、视图 disposer 是函数且执行不抛;
//    loadCollections 竞态(连点重试,迟到的旧失败响应不得覆盖新一轮集合树) ──
{
  globalThis.window = globalThis // themeObserver 要 window.matchMedia(缺席走兜底)
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', color: 'rgb(40,40,40)', backgroundColor: '' })
  const host = mkEl('div')
  let off
  A.doesNotThrow(() => { off = view.mount(host) }, 'mount 首屏不抛')
  A.equal(typeof off, 'function', '视图 mount 返回视图 disposer')
  const settle = async (pred, why) => {
    for (let i = 0; i < 50; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 5)) }
    A.fail(`等待超时:${why}`)
  }
  const root = host.children.find((c) => c.className === 'zt-root')
  A.ok(root, 'mount 挂出 .zt-root')
  const connEl = root.querySelector('[data-conn]')
  const colsEl = root.querySelector('[data-cols]')
  const mainEl = root.querySelector('[data-main]')
  A.ok(connEl && colsEl && mainEl, '模板三区齐全')
  await settle(() => connEl.textContent.includes('已连接'), 'fixture 下应连上 Zotero')
  await settle(() => colsEl.textContent.includes('机器学习'), '集合树渲染')
  await settle(() => !mainEl.textContent.includes('加载中'), '列表加载完成')
  const rows = findAll(mainEl, 'div').filter((c) => String(c.className).includes('zt-item'))
  A.equal(rows.length, 3, '条目列表渲染 3 条(note 型已滤)')
  A.ok(mainEl.textContent.includes('Attention Is All You Need'), '条目标题上屏')
  A.ok(colsEl.textContent.includes('孤儿集合'), '孤儿集合也在树里')
  // — loadCollections 竞态:第一轮 collections 挂起期间点第二轮,先回的新结果不得被后回的旧失败覆盖 —
  const fixtureFetch = globalThis.fetch
  const colDefers = []
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/collections')) return new Promise((res) => colDefers.push(res))
    return fixtureFetch(url, opts)
  }
  const btn1 = findAll(connEl, 'button')[0]
  A.ok(btn1, '连接卡有刷新按钮')
  btn1.click()
  await settle(() => colDefers.length === 1, '第一轮已过连接检查,collections 挂起') // 载荷断言:证明第一轮已越过 refreshConn 自身的 seq 闸
  findAll(connEl, 'button')[0].click() // renderConn 已重建按钮,现取
  await settle(() => colDefers.length === 2, '第二轮 collections 挂起')
  colDefers[1]({ ok: true, status: 200, json: async () => [{ key: 'C9', data: { name: '新一轮集合', parentCollection: false } }] })
  await settle(() => colsEl.textContent.includes('新一轮集合'), '新一轮集合结果上屏')
  colDefers[0]({ ok: false, status: 500, json: async () => null }) // 迟到的旧一轮:失败
  await new Promise((r) => setTimeout(r, 30))
  A.ok(colsEl.textContent.includes('新一轮集合'), '迟到的旧响应不得覆盖新一轮集合树')
  A.ok(!colsEl.textContent.includes('还没有集合'), '迟到失败响应不得清空集合树')
  globalThis.fetch = fixtureFetch
  A.doesNotThrow(() => off(), '视图 disposer 执行不抛')
  delete globalThis.window
}

// ── ⑥ 旧宿主(07-18 后 API 全删 + 无块表面):setup 不抛,插入引用降级复制 ──
{
  const T1 = { ...globalThis.__ZOTERO_TEST__ }
  globalThis.__ZOTERO_TEST__ = {}
  const copied = []
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => copied.push(t) } }, configurable: true })
  const reg2 = { commands: [], settings: [] }
  const oldNotices = []
  const ctxOld = {
    registerCommand: (c) => reg2.commands.push(c),
    registerSetting: (s) => reg2.settings.push(s),
    registerStatusItem: () => {},
    app: { notify: (m) => oldNotices.push(m), getActivePage: () => null, getActivePageText: () => '', loadPage() {}, createPage() {}, toggleMode() {}, setTheme() {}, openSearch() {}, openSwitcher() {} },
  }
  let dispose2
  A.doesNotThrow(() => { dispose2 = new Function('ctx', src)(ctxOld) }, '旧宿主 setup 不抛')
  const T2 = globalThis.__ZOTERO_TEST__
  A.equal(reg2.commands.length, 2, '旧宿主两命令照注册')
  A.doesNotThrow(() => reg2.commands.find((c) => c.id === 'zotero-open').run(), '旧宿主跑 zotero-open 不抛(降级提示)')
  A.ok(oldNotices.some((m) => String(m).includes('宿主版本过旧')), '旧宿主打开视图给提示')
  A.equal(T2.hasBlockSurface(), false, '旧宿主无块表面')
  const r = await T2.insertCite(itA, 'Vaswani2017-attention-is-all-you')
  A.equal(r, 'copied', '插入引用降级为复制引用')
  A.equal(copied.length, 1)
  A.ok(copied[0].startsWith('> Vaswani & Shazeer(2017).') && copied[0].includes('[[Vaswani2017-attention-is-all-you]]'), '剪贴板拿到完整引用块')
  A.ok(oldNotices.some((m) => String(m).includes('已复制引用')), '降级有提示')
  A.doesNotThrow(() => dispose2(), '旧宿主 disposer 不抛')
  globalThis.__ZOTERO_TEST__ = T1
}

// ── ② disposer:执行不抛,且浮层容器与注入样式收干净 ──
A.ok(globalThis.document.body.children.some((c) => String(c.className).includes('zt-layer')), 'dispose 前浮层容器在场(mount 期创建)')
A.doesNotThrow(() => dispose(), 'disposer 执行不抛')
A.ok(!globalThis.document.body.children.some((c) => String(c.className).includes('zt-layer')), 'dispose 后浮层容器已从 body 移除')
A.ok(!globalThis.document.head.children.some((c) => c.tag === 'style'), 'dispose 后注入的 <style> 已从 head 移除')

console.log(`check ok — ${reg.views.length} view / ${reg.commands.length} cmds / ${reg.settings.length} settings;fixture 解析+引用名序号+批注幂等(head 域+批次去重)+我的笔记保护+AI 速览节+引用块+连接降级+XSS+旧宿主复制降级+契约往返+loadPage 打开/回灌+哨兵消毒(含 frontmatter)+YAML 引号转义+索引身份校验+集合环救援+码点截断+双链字符消毒+zotero:// 降级复制+视图 mount/竞态/清理+collections limit+超时 signal 全部通过`)
