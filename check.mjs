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
 *   双语:MSG 两侧键集合相等(占位符一致·en 侧无残留中文)/ 切 en 后视图**不重挂**即变英文(骨架静态
 *   标签与 placeholder 一并跟) / 切语言绝不改笔记磁盘字节(节标题·批注行·引用块·骨架逐字节相同,
 *   fixture 含空标题条目与 12 作者条目——占位符正是唯一两条泄漏路径)/ zh 建的笔记索引丢失后 en 下
 *   必须认领得回来(不许建出第二篇)/ 切语言保留两栏滚动位置与进行中的 AI 进度行 / 未命名集合与
 *   无标题条目的占位符即时跟随语言(渲染时兜底而非解析时烘死)/ space.json 与 manifest 英文名一致
 *   / manifest.version = CHANGELOG 顶节版本
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
    className: '', isConnected: true, parentNode: null, value: '', disabled: false, scrollTop: 0,
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
  // 清空内容时 scrollTop 归零 —— 真浏览器行为(内容没了就滚不动了)。垫片必须照做:否则
  // 「切语言保留滚动位置」那条断言恒真,把 rerender 里的存/复原代码整段删掉也照样绿。
  Object.defineProperty(n, 'textContent', { get: () => own + n.children.map((c) => c.textContent || '').join(''), set: (x) => { n.children.length = 0; own = String(x); n.scrollTop = 0 } })
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
// 语言 mock:getLocale 同步返回当前值;subscribeLocale 只报变化,退订幂等(宿主 types.ts 契约)
let loc = 'zh'
const localeSubs = new Set()
const setLocale = (l) => { loc = l; localeSubs.forEach((cb) => { try { cb(l) } catch { /* 单个回调抛错不影响其它订阅 */ } }) }
const ctx = {
  registerView: (v) => reg.views.push(v),
  registerCommand: (c) => reg.commands.push(c),
  registerSetting: (s) => reg.settings.push(s),
  registerStatusItem: () => ({ update() {}, dispose() {} }),
  notify: (m, o) => notices.push({ m, o }),
  activity: { log: (e, d) => activityLog.push({ e, d }) },
  openView() {},
  getLocale: () => loc,
  subscribeLocale: (cb) => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
  app: {
    notify: (m) => notices.push({ m }),
    workFolder: () => '文献工作台',
    readFile: async (p) => (V.has(p) ? V.get(p) : null),
    listPages: async () => Array.from(V.keys()).filter((x) => /\.md$/i.test(x) && !x.split('/').pop().startsWith('.')),
    listFiles: async () => Array.from(V.keys()).filter((x) => !/\.md$/i.test(x) && !x.split('/').pop().startsWith('.')),
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

// ── 双语术语收口:同一个东西不许有两个名字 ──
// space.json 的名字是 Space 切换器上的,manifest 的是插件页/命令面板/标签页上的;两处英文名一旦
// 不一致(曾经是 Zotero Desk vs Literature Workbench),英文用户会以为是两个不相干的东西。
{
  const mf = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
  const sp = JSON.parse(readFileSync(new URL('./spaces/zotero/space.json', import.meta.url), 'utf8'))
  A.equal(sp.name.zh, mf.name, 'space.json 中文名 = manifest.name')
  A.equal(sp.name.en, mf.nameEn, 'space.json 英文名 = manifest.nameEn(术语单源)')
  A.equal(view.title, mf.name, '视图标题(注册时 zh)= manifest.name')
  A.equal(T.MSG.en.view_title, mf.nameEn, 'MSG.en.view_title = manifest.nameEn')
  A.ok(T.MSG.en.cmd_open.startsWith(mf.nameEn) && T.MSG.en.cmd_cite.startsWith(mf.nameEn), '英文命令标题用同一个产品名')
  A.ok(mf.descriptionEn && mf.onboarding.en && mf.onboarding.en.steps.length === mf.onboarding.steps.length, 'manifest 英文面齐全且步骤一一对应')
  // 版本号真源 = CHANGELOG 顶节;manifest 不跟着 bump = 用户装上后看不出换过版本
  const top = /^##\s+([0-9.]+)/m.exec(readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8'))
  A.ok(top, 'CHANGELOG 应有版本节')
  A.equal(mf.version, top[1], 'manifest.version 必须 = CHANGELOG 顶节版本')
}
for (const k of ['parseItem', 'parseItems', 'parseAnnotations', 'findPdfAttachment', 'citeName', 'buildNoteMd', 'mergeAnnotations', 'buildCitation', 'ztGet', 'ensureNote', 'importAnnotations', 'insertCite', 'upsertAiSection', 'parseLitreview', 'buildItemRow', 'buildDetailCard', 'stripZann', 'openNoteInEditor', 'writeNote', 'openZoteroUri', 'fmQ',
  'escapeBib', 'bibVerbatim', 'protectCase', 'pickCreators', 'bibNames', 'cslNames', 'bibPages', 'cslPages', 'bareDoi', 'urlDate', 'dateParts', 'entryType', 'cslType', 'keySeg', 'bibKeyBase', 'suffixLetters', 'assignKeys', 'toBibtex', 'toCslJson', 'bibFile', 'cslFile', 'exportBaseName', 'exportBib', 'copyText']) {
  A.equal(typeof T[k], 'function', `钩子应暴露 ${k}`)
}

// ── 契约 URL(SPEC 钉死的查询串) ──
A.equal(T.apiBase(23119), 'http://localhost:23119/api/users/0')
A.equal(T.qConn(), '/items?limit=1')
A.equal(T.qAllItems(), '/items?itemType=-attachment&limit=100')
A.equal(T.qSearch('注意力 attention'), `/items?q=${encodeURIComponent('注意力 attention')}&itemType=-attachment&limit=100`)
A.equal(T.qColItems('COL1'), '/collections/COL1/items?itemType=-attachment&limit=100')
A.equal(T.qCollections(), '/collections?limit=100', '集合端点须显式 limit(本地 API 默认只回 25 条,集合树会静默截断)')
A.equal(T.qChildren('ABCD1234'), '/items/ABCD1234/children?limit=100', '子对象端点须显式 limit(本地 API 默认只回 25 条,划线批注会静默截断 → 导入少导)')
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
// 无标题条目:UI 占位符「(无标题)/(Untitled)」必须在**渲染时**兜底,切语言即变(不重载列表)
const FIX_ITEM_NOTITLE = { key: 'NOTITLE1', data: { itemType: 'journalArticle', date: '2022', creators: [{ lastName: 'Lee', creatorType: 'author' }] } }
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
  // C4 无名集合:同 FIX_ITEM_NOTITLE,占位符必须渲染时兜底(烘进 parseCollections 的话切语言后卡在旧语言)
  else if (u.includes('/collections?') || u.endsWith('/collections')) payload = [{ key: 'C1', data: { name: '机器学习', parentCollection: false } }, { key: 'C2', data: { name: '注意力', parentCollection: 'C1' } }, { key: 'C3', data: { name: '孤儿集合', parentCollection: 'GONE' } }, { key: 'C4', data: { name: '', parentCollection: false } }]
  else if (u.includes('/items')) payload = [FIX_ITEM_A, FIX_ITEM_NODATE, FIX_ITEM_NOCREATORS, FIX_ITEM_NOTE, FIX_ITEM_NOTITLE]
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
// 解析层存**原始值**(空串),占位符由 diskTitle(磁盘,恒中文)/ uiTitle(界面,跟随语言)各自兜底。
// 在 parseItem 里烘占位符 = 界面语言泄进磁盘身份(见下面「语言泄漏防线」段),且 S.items 是加载
// 那一刻解析好的,切语言后只重画不重解析 → 占位符卡在旧语言。
A.equal(T.parseItem({}).title, '', '空对象容错:标题存原始空串,不在解析层烘占位符')
A.equal(T.diskTitle(T.parseItem({})), '(无标题)', '磁盘面占位符')
A.equal(T.parseItem(null).key, '', 'null 容错')
const list = T.parseItems([FIX_ITEM_A, FIX_ITEM_NODATE, FIX_ITEM_NOCREATORS, FIX_ITEM_NOTE, null])
A.equal(list.length, 3, '列表解析滤掉 note 型与 null')

// 集合解析 + 树(孤儿不弄丢)
const cols = T.parseCollections([{ key: 'C1', data: { name: '机器学习', parentCollection: false } }, { key: 'C2', data: { name: '注意力', parentCollection: 'C1' } }, { key: 'C3', data: { name: '孤儿', parentCollection: 'GONE' } }])
A.equal(cols.length, 3)
// 同 parseItem:名字存原始空串,「(未命名)」由 renderCols 按**当时**语言兜底(S.cols 是加载那一刻
// 解析好的,rerender 只重画不重解析 → 烘在这里的话切语言后集合树卡在旧语言直到重新加载)
A.equal(T.parseCollections([{ key: 'C0', data: { name: '' } }])[0].name, '', '无名集合存原始空串,不在解析层烘占位符')
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
  A.equal(r1.truncated, false, '子对象没到 100 条 → 不报截断')
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
  A.equal(r4.truncated, false)
  // 满 100 条子对象 = 命中端点上限。走的是「零批注」那条早退,截断标记照样得带出来 ——
  // 这正是最像「这篇没划线」的一种截断。
  FIX_CHILDREN = Array.from({ length: 100 }, (_, i) => ({ key: `ATTF${i}`, data: { itemType: 'attachment', contentType: 'application/pdf' } }))
  const r5 = await T.importAnnotations({ ...itA, key: 'FULL0001', title: 'Full', creators: [], year: '' })
  A.equal(r5.truncated, true, '子对象满 100 条 → 报可能截断')
  A.equal(r5.note, null, '截断提示不改变「无批注不建笔记」')
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

// ── v4/unified 笔记(宿主 2026-08-20 起的默认载体):没有块模型,块口一律返 null。
//    ⚠️ 这正是老版本谎报「已插入」的地方:宿主无页时返回的是 `''` 而不是 null,而判据写的是
//    `id == null` —— 空串走成功分支,用户以为引用进去了。现在走 insertMarkdown。 ──
{
  const md = []
  ctx.app.getPage = () => ({ token: 'v4tok', path: 'notes/v4.md', status: 'ready', text: '# 正在写\n\n正文', model: 'text', blocks: {}, order: [], fmExtra: '' })
  ctx.app.insertBlockAfter = () => null // v4 上宿主的诚实拒绝
  ctx.app.insertMarkdown = (token, text, where) => { md.push({ token, text, where }); return true }
  A.equal(T.hasBlockSurface(), true, 'v4 上仍算「有块表面」(能插字就算)')
  A.equal(await T.insertCite(itA, 'x'), 'inserted', 'v4 笔记上引用真的插进去')
  A.equal(md.length, 1)
  A.equal(md[0].where, 'start', '引用插到文首(与 v3 的 afterId=null 同语义)')
  A.equal(md[0].token, 'v4tok', '令牌现取')
  A.ok(md[0].text.startsWith('> Vaswani'), '插的是引用块')
  ctx.app.insertMarkdown = () => false // 令牌过期 / 实例不在
  A.equal(await T.insertCite(itA, 'x'), 'stale', 'v4 上插不进去要报失败,不许谎报成功')
  delete ctx.app.insertMarkdown
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

// ══ 严格引文导出(1.2.0):转义 / 大小写保护 / 姓名分段 / cite key / 两种格式同源 / 确定性 ══════
{
  const countOf = (s, ch) => String(s).split(ch).length - 1
  // V1 转义地狱:LaTeX 十个特殊字符一趟到位
  A.equal(
    T.escapeBib('100% {A} \\ B & C_D #E $F ~G ^H'),
    '100\\% \\textbraceleft{}A\\textbraceright{} \\textbackslash{} B \\& C\\_D \\#E \\$F \\textasciitilde{}G \\textasciicircum{}H',
    'LaTeX 转义全表(\\ { } & % $ # _ ~ ^)')
  // V2 落单大括号 → 括号必须平衡。⚠️这是本次最大的已知风险:写成 \{ 的话 bibtex 的分词器数层级时
  //    不看反斜杠,整份 .bib 解析就坏,而插件已经报了「导出成功」。
  const braced = T.escapeBib('Bad { title')
  A.equal(braced, 'Bad \\textbraceleft{} title', '落单 { 必须转成 \\textbraceleft{} 而不是 \\{')
  A.equal(countOf(braced, '{'), countOf(braced, '}'), '转义后大括号层级平衡')
  const itEvil = T.parseItem({ key: 'EVILBIB1', data: { itemType: 'journalArticle', title: 'Bad { title 100% & _x^y ~z $d # h \\ back', creators: [{ lastName: 'Zhao', firstName: 'Q', creatorType: 'author' }], date: '2015', publicationTitle: 'A & B {Journal}' } })
  const evilBib = T.bibFile([itEvil])
  A.equal(countOf(evilBib, '{'), countOf(evilBib, '}'), '整份 .bib 的大括号全局平衡(转义地狱串也不例外)')
  A.ok(!/(^|[^\\])\\[{}]/.test(evilBib), '.bib 里不许出现 \\{ / \\} 这种会让层级失衡的写法')
  // V3 标题大小写保护:首字符之后还有大写才包 {}
  A.equal(T.protectCase('BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding'),
    '{BERT:} Pre-training of Deep Bidirectional Transformers for Language Understanding', '缩写词整词保护')
  A.equal(T.protectCase('The iPhone and DNA'), 'The {iPhone} and {DNA}', '驼峰与全大写都保护')
  A.equal(T.protectCase('Attention Is All You Need'), 'Attention Is All You Need', '仅首字母大写的普通词不加保护')
  A.equal(T.protectCase('Bad { title'), 'Bad \\textbraceleft{} title', '大小写保护内部照样转义')
  // V4 法人作者(单字段 name)整体保护
  A.equal(T.bibNames([{ name: 'World Health Organization', creatorType: 'author' }], 'author'), '{World Health Organization}', '法人作者整体 {} 保护')
  // V5 and 分隔 + von / Jr 姓名分段(逗号形式让 bibtex 自己按 von Last, Jr, First 分段)
  A.equal(T.bibNames([
    { lastName: 'King, Jr.', firstName: 'Martin Luther', creatorType: 'author' },
    { lastName: 'van der Berg', firstName: 'Jan', creatorType: 'author' },
  ], 'author'), 'King, Jr., Martin Luther and van der Berg, Jan', 'Last, First 逗号形式 + and 分隔')
  A.equal(T.bibNames([{ lastName: '王', creatorType: 'author' }], 'author'), '王', '只有姓时不留孤零零的逗号')
  // editor:author + editor 两种 creatorType 都导;**编者绝不许被当成 author**(编著书的错误著录)
  const edOnly = T.parseItem({ key: 'EDONLY01', data: { itemType: 'bookSection', title: 'A Chapter', bookTitle: 'The Big Book', date: '2019', creators: [{ lastName: 'Ed', firstName: 'It', creatorType: 'editor' }] } })
  const edBib = T.bibFile([edOnly])
  A.ok(!edBib.includes('author = {'), '只有编者的条目不许冒出 author 字段')
  A.ok(edBib.includes('editor = {Ed, It}') && edBib.includes('booktitle = {The Big Book}'), '编者与 booktitle 照常出')
  A.equal(T.bibKeyBase(edOnly), 'ed2019a', 'cite key 仍用编者姓,不掉进 anon')
  A.deepEqual(JSON.parse(T.cslFile([edOnly]))[0].editor, [{ family: 'Ed', given: 'It' }], 'CSL 侧同样只出 editor')
  // V6 cite key 基键
  A.equal(T.bibKeyBase(itA), 'vaswani2017attention', '基键 = <姓><年><题首词>')
  A.equal(T.bibKeyBase(T.parseItem({ key: 'CJKKEY01', data: { itemType: 'journalArticle', date: '2020', creators: [{ lastName: '王', creatorType: 'author' }], title: '注意力机制在中文分词中的应用' } })),
    '王2020注意力机制在中文分词中的', 'CJK 标题整条算一个 token,按码点截 12')
  A.equal(T.bibKeyBase(T.parseItem({})), 'anonnduntitled', '三段兜底 anon / nd / untitled')
  A.equal(T.keySeg('Sm]]ith|X#y^z', 'anon'), 'smithxyz', '基键段只留字母数字')
  A.ok(!/[\uD800-\uDBFF]$/.test(T.keySeg('aaaaaaaaaaa😀bbb', 'x')), '基键段按码点截断,不留孤立高代理')
  // V7 同批冲突:全员加 -a/-b/-c,按 Zotero 条目 key 升序,与传入顺序无关
  const mkSmith = (k) => T.parseItem({ key: k, data: { itemType: 'journalArticle', date: '2020', creators: [{ lastName: 'Smith', creatorType: 'author' }], title: 'Data things' } })
  const clash = T.assignKeys([mkSmith('KEY3'), mkSmith('KEY1'), mkSmith('KEY2')])
  A.deepEqual(clash.map((p) => p.key), ['smith2020data-a', 'smith2020data-b', 'smith2020data-c'], '冲突组全员加后缀')
  A.deepEqual(clash.map((p) => p.item.key), ['KEY1', 'KEY2', 'KEY3'], '后缀按 Zotero 条目 key 升序分配')
  A.deepEqual(T.assignKeys([mkSmith('KEY2'), mkSmith('KEY3'), mkSmith('KEY1')]).map((p) => p.item.key), ['KEY1', 'KEY2', 'KEY3'], '乱序传入结果相同')
  A.equal(T.assignKeys([mkSmith('KEY1')])[0].key, 'smith2020data', '不冲突时不带后缀(单条复制永远是裸键)')
  A.deepEqual([0, 25, 26, 27].map(T.suffixLetters), ['a', 'z', 'aa', 'ab'], '后缀 26 进制展开')
  // V8 完整 BibTeX 条目(字段顺序 + entry type + 逗号规则)
  A.equal(T.bibFile([itA]),
    '% Encoding: UTF-8\n\n@article{vaswani2017attention,\n  author = {Vaswani, Ashish and Shazeer, Noam},\n  title = {Attention Is All You Need},\n  journal = {NeurIPS},\n  year = {2017},\n  doi = {10.48550/arXiv.1706.03762},\n  url = {https://arxiv.org/abs/1706.03762}\n}\n',
    '完整 @article 条目逐字节(字段顺序钉死,末位字段行不带逗号)')
  // V9 verbatim url:biblatex 里 url/doi 是 verbatim 字段,转义会把 \_ 原样印出来
  const wp = T.parseItem({ key: 'VERB0001', data: { itemType: 'webpage', title: 'Verb', url: 'https://ex.com/a_b{c}' } })
  const wpBib = T.toBibtex(T.assignKeys([wp]))
  const urlLine = wpBib.split('\n').find((l) => l.trim().startsWith('url ='))
  A.equal(urlLine, '  url = {https://ex.com/a_b%7Bc%7D}', 'url 不转义下划线,只把大括号百分号编码,且末位字段行无逗号')
  A.ok(wpBib.includes('  title = {Verb},'), '非末位字段行带逗号')
  A.equal(T.bibVerbatim('a\\b{c}'), 'a%5Cb%7Bc%7D', 'verbatim 只编码 { } \\')
  // V10 CSL-JSON:官方 schema 字段名,值不做任何 LaTeX 转义
  const cslA = JSON.parse(T.cslFile([itA]))
  A.equal(cslA.length, 1)
  A.equal(cslA[0].id, T.bibKeyBase(itA), '.csl.json 的 id 与 .bib 的 key 同源')
  A.equal(cslA[0].type, 'article-journal')
  A.equal(cslA[0].title, 'Attention Is All You Need')
  A.deepEqual(cslA[0].author, [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }])
  A.deepEqual(cslA[0].issued, { 'date-parts': [[2017, 6, 12]] }, 'issued.date-parts 是数字三元组')
  A.equal(cslA[0]['container-title'], 'NeurIPS')
  A.equal(cslA[0].DOI, '10.48550/arXiv.1706.03762')
  A.equal(cslA[0].URL, 'https://arxiv.org/abs/1706.03762')
  A.ok(!('volume' in cslA[0]) && !('issue' in cslA[0]) && !('page' in cslA[0]), '空字段不出现')
  A.deepEqual(JSON.parse(T.cslFile([T.parseItem({ key: 'ORG00001', data: { itemType: 'report', title: 'R', creators: [{ name: 'World Health Organization', creatorType: 'author' }] } })]))[0].author,
    [{ literal: 'World Health Organization' }], '法人作者走 CSL 的 literal')
  A.ok(!/\\text|\\&|\\_/.test(T.cslFile([itEvil])), 'CSL 值里不许出现 LaTeX 转义')
  A.deepEqual(T.dateParts('2017-06-12', '2017'), [2017, 6, 12])
  A.deepEqual(T.dateParts('2020', '2020'), [2020], '只有年份时 date-parts 只出年')
  A.equal(T.dateParts('', ''), null, '没有任何日期 → null')
  A.ok(!('issued' in JSON.parse(T.cslFile([T.parseItem({ key: 'NODATE99', data: { itemType: 'book', title: 'No date' } })]))[0]), '无日期条目整个省掉 issued')
  // 带 volume / issue / page 的条目(itA 没有这三项,要另造一条才断得到)
  const full = T.parseItem({ key: 'FULL0001', data: { itemType: 'journalArticle', title: 'Full Fields', creators: [{ lastName: 'Han', firstName: 'M', creatorType: 'author' }], date: '2018-05-01', publicationTitle: 'J', volume: '7', issue: '2', pages: '12-34', DOI: 'https://doi.org/10.1/x', ISBN: '978-0', publisher: 'P', accessDate: '2024-01-02T03:04:05Z' } })
  const fullBib = T.toBibtex(T.assignKeys([full]))
  A.ok(fullBib.includes('  volume = {7},') && fullBib.includes('  number = {2},'), 'issue 落 BibTeX 的 number')
  A.ok(fullBib.includes('  pages = {12--34},'), 'BibTeX 页码连接号是 --')
  A.ok(fullBib.includes('  doi = {10.1/x},'), 'DOI 归一为裸 10.x')
  A.ok(fullBib.includes('  urldate = {2024-01-02}'), 'urldate 截到日期,不留时间戳')
  const cslFull = JSON.parse(T.cslFile([full]))[0]
  A.equal(cslFull.page, '12-34', 'CSL 页码是普通连接号,不是 LaTeX 的 --')
  A.equal(cslFull.volume, '7')
  A.equal(cslFull.issue, '2')
  A.equal(cslFull.DOI, '10.1/x')
  A.equal(cslFull.ISBN, '978-0')
  A.equal(cslFull.publisher, 'P')
  // V11 页码 / DOI 归一
  A.equal(T.bibPages('12-34'), '12--34')
  A.equal(T.bibPages('12–34'), '12--34')
  A.equal(T.bibPages('12--34'), '12--34')
  A.equal(T.bibPages('e12345'), 'e12345', '无连接号的页码原样')
  A.equal(T.bareDoi('https://doi.org/10.1/x'), '10.1/x')
  A.equal(T.bareDoi('http://dx.doi.org/10.1/x'), '10.1/x')
  A.equal(T.bareDoi('doi:10.1/x'), '10.1/x')
  A.equal(T.bareDoi('10.1/x'), '10.1/x')
  // V12 类型映射全表
  const TYPE_MAP = [['journalArticle', 'article', 'article-journal'], ['book', 'book', 'book'], ['bookSection', 'incollection', 'chapter'], ['conferencePaper', 'inproceedings', 'paper-conference'], ['thesis', 'phdthesis', 'thesis'], ['webpage', 'online', 'webpage'], ['report', 'techreport', 'report']]
  for (const [zt, bib, csl] of TYPE_MAP) {
    A.equal(T.entryType(zt), bib, `${zt} → @${bib}`)
    A.equal(T.cslType(zt), csl, `${zt} → CSL ${csl}`)
  }
  A.equal(T.entryType('letter'), 'misc', '未知类型 → misc')
  A.equal(T.cslType('letter'), 'document', '未知类型 → document')
  A.equal(T.entryType(''), 'misc')
  // conferencePaper 的 booktitle 取 proceedingsTitle(bookSection 取 bookTitle)
  const conf = T.parseItem({ key: 'CONF0001', data: { itemType: 'conferencePaper', title: 'Conf Paper', proceedingsTitle: 'Proc of X', date: '2022', creators: [{ lastName: 'Li', firstName: 'A', creatorType: 'author' }] } })
  A.ok(T.toBibtex(T.assignKeys([conf])).includes('booktitle = {Proc of X}'), 'inproceedings 的 booktitle 取 proceedingsTitle')
  // thesis → school 取 university
  const th = T.parseItem({ key: 'THES0001', data: { itemType: 'thesis', title: 'A Thesis', university: 'MIT', date: '2016', creators: [{ lastName: 'Ma', firstName: 'B', creatorType: 'author' }] } })
  A.ok(T.toBibtex(T.assignKeys([th])).includes('school = {MIT}'), 'phdthesis 的 school 取 university')
  // V13 确定性:重复导出必须逐字节相同(否则「内容没变就不写盘」永远不成立,-2/-3 无限增殖)
  const batch = [itA, full, conf, th]
  A.equal(T.bibFile(batch), T.bibFile(batch), '同一批重复调用逐字节相同')
  A.equal(T.bibFile([...batch].reverse()), T.bibFile(batch), '输出按最终 key 升序,与输入顺序无关')
  A.equal(T.cslFile([...batch].reverse()), T.cslFile(batch), 'CSL 同样与输入顺序无关')
  const bibLines = T.bibFile(batch).split('\n')
  A.equal(bibLines[0], '% Encoding: UTF-8', '首行恒 UTF-8 声明')
  A.equal(bibLines.filter((l) => l.startsWith('%')).length, 1, '全文以 % 开头的行有且只有这一行(没人偷偷加时间戳注释头)')
  A.deepEqual(JSON.parse(T.cslFile(batch)).map((o) => o.id), T.assignKeys(batch).map((p) => p.key), '两种格式的键序列完全一致')
  // 导出文件基名:三态优先级与 loadItems 的取数路径一致(检索 > 集合 > 全部)
  A.equal(T.exportBaseName({}), '导出-全部条目')
  A.equal(T.exportBaseName({ colKey: 'C1', colName: '机器学习' }), '导出-机器学习')
  A.equal(T.exportBaseName({ colKey: 'C4', colName: '' }), '导出-(未命名)')
  A.equal(T.exportBaseName({ query: '注意力' }), '导出-检索-注意力')
  A.equal(T.exportBaseName({ colKey: 'C1', colName: '机器学习', query: '注意力' }), '导出-检索-注意力', '检索优先(与 loadItems 一致)')
  A.ok(!/[[\]|#^]/.test(T.exportBaseName({ query: 'a]]b|c#d^e' })), '基名过 sanitizeFileName')
}

// ══ 导出落盘:三态探测 / 读失败中止 / 绝不覆写 / 活动页让位 / 序号耗尽 / 零页面写入 / 零网络 ══
{
  const f0 = fetched.length
  // 页表面探针:导出/复制全程不许碰 getPage / insertBlockAfter / insertMarkdown(BRIEF 增量五第 9 项)
  let pageCalls = 0
  const prevGetPage = ctx.app.getPage
  const prevInsertBlock = ctx.app.insertBlockAfter
  ctx.app.getPage = (...a) => { pageCalls++; return prevGetPage ? prevGetPage(...a) : null }
  ctx.app.insertBlockAfter = (...a) => { pageCalls++; return prevInsertBlock ? prevInsertBlock(...a) : null }
  ctx.app.insertMarkdown = () => { pageCalls++; return false }

  const items = [itA, itND]
  const r1 = await T.exportBib(items, '导出-测试')
  A.equal(r1.skipped, false)
  A.equal(r1.bib, '文献工作台/导出-测试.bib', '.bib 落工作文件夹')
  A.equal(r1.csl, '文献工作台/导出-测试.csl.json', '.csl.json 与 .bib 同名成对')
  A.equal(r1.n, 2)
  A.equal(V.get(r1.bib), T.bibFile(items), '.bib 内容 = bibFile')
  A.equal(V.get(r1.csl), T.cslFile(items), '.csl.json 内容 = cslFile')
  A.equal(fetched.length, f0, '导出不发任何网络请求(只序列化已经在列表里的数据)')

  // P0②:二次导出内容相同 → 不写盘、不产 -2 垃圾
  const w1 = writes.length
  const r2 = await T.exportBib(items, '导出-测试')
  A.equal(r2.skipped, true, '内容没变 → skipped')
  A.equal(r2.bib, '文献工作台/导出-测试.bib', 'skipped 仍指向原文件')
  A.equal(writes.length, w1, '内容相同一个字节都不写')
  A.ok(!V.has('文献工作台/导出-测试-2.bib'), '内容相同不许产生 -2 垃圾')

  // P0②:内容不同 → 另存 -2,原文件逐字节不变;.bib 与 .csl.json 必须**一起** bump
  const keepBib = V.get('文献工作台/导出-测试.bib')
  const keepCsl = V.get('文献工作台/导出-测试.csl.json')
  const r3 = await T.exportBib([itA], '导出-测试')
  A.equal(r3.bib, '文献工作台/导出-测试-2.bib', '内容变了另存 -2,绝不无声覆写')
  A.equal(r3.csl, '文献工作台/导出-测试-2.csl.json', '两个文件一起 bump(不许出现 x.bib + x-2.csl.json 的错配对)')
  A.equal(V.get('文献工作台/导出-测试.bib'), keepBib, '原 .bib 逐字节不变')
  A.equal(V.get('文献工作台/导出-测试.csl.json'), keepCsl, '原 .csl.json 逐字节不变')

  // P0①:readFile 抛错 ≠ 文件不存在 —— 立刻中止,绝不当成「还没有」然后写一份新的
  const prevRead = ctx.app.readFile
  ctx.app.readFile = async (p) => { if (String(p).endsWith('.bib')) throw new Error('EIO 磁盘炸了'); return V.has(p) ? V.get(p) : null }
  const w2 = writes.length
  let readErr = null
  try { await T.exportBib(items, '导出-读失败') } catch (e) { readErr = e }
  A.ok(readErr && String(readErr.message).includes('读不出已有的导出文件'), '读失败必须中止导出并报 msg_export_readfail')
  A.ok(String(readErr.message).includes('EIO 磁盘炸了'), '原始错误透传给用户')
  A.equal(writes.length, w2, '读失败一个字节都不许写')
  A.ok(!V.has('文献工作台/导出-读失败.bib'), '读失败不留半个产物')
  ctx.app.readFile = prevRead

  // 活动页写保护(BRIEF 增量一第 2 条 / 增量五第 10 项):撞上当前活动页 → 让位到 -2,原文件不动
  // ⚠️[回归 2026-08-21 · 评审 Finding 3] 这段以前先给活动页塞了**不同内容**,于是即使删掉
  //   `busy` 分支,probe() 也会走 'taken' → 一样 bump 到 -2 → 断言照绿。也就是说这条交付闸
  //   对本插件从来没真的验证过。现在活动页路径在盘上**不存在**(free 相位),只有 busy 分支能救它。
  const activePath = '文献工作台/导出-活动页.bib'
  const prevActive = ctx.app.getActivePage
  ctx.app.getActivePage = () => activePath
  const w3 = writes.length
  const r4 = await T.exportBib(items, '导出-活动页')
  A.equal(r4.bib, '文献工作台/导出-活动页-2.bib', '导出路径撞上活动页 → 自动让位到 -2,绝不整文件覆写活动页')
  A.equal(r4.csl, '文献工作台/导出-活动页-2.csl.json', '成对让位')
  A.equal(V.has(activePath), false, '活动页路径一个字节都没被写过(free 相位:只有 busy 分支能挡住它)')
  A.ok(!writes.slice(w3).includes(activePath), 'writes 轨迹里没有对活动页路径的写')
  // 对称相位:活动页文件内容**恰好等于**本次要写的字节('same')时也必须让位,而不是「反正一样,写一遍」
  V.set(activePath, T.bibFile(items))
  const w3b = writes.length
  const r4b = await T.exportBib(items, '导出-活动页')
  A.notEqual(r4b.bib, activePath, 'same 相位也必须让位:没有 busy 分支时 probe 会判 same 并直接返回活动页路径')
  A.equal(r4b.bib, '文献工作台/导出-活动页-2.bib', 'same 相位落到已有的 -2(内容一致,不重复写)')
  A.ok(!writes.slice(w3b).includes(activePath), 'same 相位同样零写入')
  ctx.app.getActivePage = prevActive

  // 序号耗尽:抛错,绝不兜底覆写(照 ensureNote 的既有纪律)
  for (let n = 1; n <= 99; n++) {
    const cand = n === 1 ? '导出-占满' : `导出-占满-${n}`
    V.set(`文献工作台/${cand}.bib`, `别的内容 ${n}`)
    V.set(`文献工作台/${cand}.csl.json`, `别的内容 ${n}`)
  }
  const w4 = writes.length
  let fullErr = null
  try { await T.exportBib(items, '导出-占满') } catch (e) { fullErr = e }
  A.ok(fullErr && String(fullErr.message).includes('序号已占满'), '序号耗尽抛错')
  A.equal(writes.length, w4, '序号耗尽绝不兜底覆写')

  A.equal(pageCalls, 0, '整个导出流程零页面读写:不碰 getPage / insertBlockAfter / insertMarkdown')
  A.equal(fetched.length, f0, '整个导出流程零网络请求')
  ctx.app.getPage = prevGetPage
  ctx.app.insertBlockAfter = prevInsertBlock
  delete ctx.app.insertMarkdown
  for (const k of [...V.keys()]) if (k.includes('/导出-')) V.delete(k)
}

// ══ 回归防线:新字段不许渗进笔记磁盘契约;既有引用块逐字节不变 ══════════════════════════
{
  // parseItem 加了 13 个导出字段 —— 一个都不许跑进 frontmatter,否则存量笔记形状全变
  const fm = /^---\n([\s\S]*?)\n---/.exec(T.buildNoteMd(itA))
  A.ok(fm, '笔记有 frontmatter')
  A.deepEqual(fm[1].split('\n').map((l) => (/^([a-z_]+):/.exec(l) || [])[1]).filter(Boolean),
    ['zt_key', 'zt_title', 'zt_authors', 'zt_year', 'zt_doi'],
    'frontmatter 键集合逐字钉死(导出用的新字段一个都不许渗进来)')
  A.equal(T.buildNoteMd(itA),
    '---\nzt_key: "ABCD1234"\nzt_title: "Attention Is All You Need"\nzt_authors: "Vaswani, Shazeer"\nzt_year: "2017"\nzt_doi: "10.48550/arXiv.1706.03762"\n---\n\n> [在 Zotero 中打开](zotero://select/library/items/ABCD1234) `zotero://select/library/items/ABCD1234`\n\n## 划线与批注\n\n## 我的笔记\n',
    '笔记骨架与 1.1.2 逐字节相同')
  // 既有的 Markdown 近似引用块不许被「顺手统一」成严格格式(存量笔记里的引用块与新插入的要一致)
  const cite = T.buildCitation(itA, 'X')
  A.equal(cite, '> Vaswani & Shazeer(2017). Attention Is All You Need. NeurIPS. [Zotero](zotero://select/library/items/ABCD1234) · [[X]]', '引用块逐字节不变')
  A.ok(!cite.includes('@article') && !cite.includes(T.bibKeyBase(itA)), '引用块里没有 BibTeX 的痕迹(两条出口互不污染)')
  A.equal(T.citeName(itA), 'Vaswani2017-attention-is-all-you', '阅读笔记的引用名(≠ cite key)不变')
  A.notEqual(T.citeName(itA), T.bibKeyBase(itA), '笔记文件名与 BibTeX cite key 是两套东西,不许混用')
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
  // 1.2.0:恶意条目走导出流程 —— .bib / .csl.json 是**纯文本产物,不进 DOM**(不做预览面板,
  // 零新增渲染面);要保证的是产物结构不被撑破:大括号仍平衡、JSON 仍可解析、恶意串原样是数据
  const evilBib = T.bibFile([evil])
  A.equal(evilBib.split('{').length, evilBib.split('}').length, '恶意标题不撑破 .bib 的大括号层级')
  A.ok(evilBib.includes('alert(1)'), '恶意串在 .bib 里就是普通文本(文件是用户自己的,原样写)')
  A.equal(JSON.parse(T.cslFile([evil]))[0].title, evil.title, '.csl.json 走 JSON.stringify,恶意串原样往返')
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
  A.equal(rows.length, 4, '条目列表渲染 4 条(note 型已滤)')
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

// ══ ⑦ 双语词表:两侧键集合必须完全相等(漏翻一条就红) ══════════════════════
{
  A.ok(T.MSG && T.MSG.zh && T.MSG.en, 'MSG 应经 __ZOTERO_TEST__ 暴露')
  const zk = Object.keys(T.MSG.zh).sort()
  const ek = Object.keys(T.MSG.en).sort()
  A.deepEqual(zk, ek, '双语词表两侧键集合必须完全相等')
  A.ok(zk.length > 60, `词表条目数应覆盖全部 UI 文案(实得 ${zk.length})`)
  for (const k of zk) {
    A.equal(typeof T.MSG.zh[k], 'string', `zh.${k} 应为字符串`)
    A.equal(typeof T.MSG.en[k], 'string', `en.${k} 应为字符串`)
    A.ok(T.MSG.zh[k].trim() && T.MSG.en[k].trim(), `${k} 两侧都不许空`)
    const zv = (T.MSG.zh[k].match(/\{[a-z]+\}/g) || []).sort().join(',')
    const ev = (T.MSG.en[k].match(/\{[a-z]+\}/g) || []).sort().join(',')
    A.equal(zv, ev, `${k} 两侧占位符必须一致`)
    A.ok(!/[一-鿿]/.test(T.MSG.en[k]), `en.${k} 不许残留中文`)
  }
  loc = 'zh'
  A.equal(T.t('btn_import'), '导入划线批注')
  A.equal(T.t('list_count', { n: 7 }), '7 条')
  loc = 'en'
  A.equal(T.t('btn_import'), 'Import Highlights')
  A.equal(T.t('list_count', { n: 7 }), '7 items')
  A.equal(T.t('no_such_key_xyz'), 'no_such_key_xyz', '缺键回落键名而不是崩')
  loc = 'zh'
}
// ── 1.2.0 新增的 14 个词表键:两侧都在、占位符一致;t() 必须**单趟**替换 ──
{
  for (const k of ['btn_copy_bib', 'btn_copy_csl', 'btn_export', 'btn_exporting', 'msg_bib_copied', 'msg_csl_copied', 'msg_copy_fail', 'msg_export_done', 'msg_export_same', 'msg_export_fail', 'msg_export_readfail', 'msg_export_nofs', 'msg_export_taken', 'export_truncated_hint']) {
    A.ok(T.MSG.zh[k] && T.MSG.en[k], `导出词表键 ${k} 两侧都要有`)
  }
  for (const side of ['zh', 'en']) {
    A.equal((T.MSG[side].msg_export_done.match(/\{[a-z]+\}/g) || []).sort().join(','), '{bib},{csl},{n}', `${side}.msg_export_done 占位符集合`)
  }
  loc = 'zh'
  A.equal(T.t('msg_export_done', { n: 2, bib: 'B', csl: 'C' }), '已导出 2 条到 B 与 C')
  loc = 'en'
  A.equal(T.t('msg_export_done', { n: 1, bib: 'B', csl: 'C' }), 'Exported 1 item to B and C', '英文复数:n===1 抹掉 (s),不写 1 items')
  A.equal(T.t('msg_export_done', { n: 3, bib: 'B', csl: 'C' }), 'Exported 3 items to B and C')
  loc = 'zh'
  // ⚠️占位符替换必须单趟:{bib} 是集合名/检索词拼出来的路径,用户把集合命名成「{csl}」时,
  //   逐个 split/join 会让先替进去的这段用户数据被后面那一轮当占位符吃掉(BRIEF 铁律,1.2.0 修)。
  A.equal(T.t('msg_export_done', { n: 2, bib: 'x{csl}y', csl: 'Z' }), '已导出 2 条到 x{csl}y 与 Z', 't() 必须单趟替换:替进去的用户数据不许被后面的轮次再吃一遍')
  A.equal(T.t('msg_export_taken', { base: '导出-{n}' }), '同名导出文件过多(「导出-{n}」序号已占满),请清理后重试', '未知/未传的占位符原样留着')
}
// ══ 语言泄漏防线:凡是会落到磁盘的串,一律不许随界面语言变 ═════════════════════
// 反例(1.1.0 双语改造途中真写出来过):parseItem 解析期就烘 t('untitled')、joinCreators 用 t('authors_more')
//   → 同一条文献在中/英下拥有两套磁盘身份:①索引丢失(被同步删/换机器/手删)后按 citeName
//   认领笔记会认不到中文那篇,凭空建出第二篇,此后导入批注与 AI 速览写进新那篇,用户写在旧那篇
//   「## 我的笔记」里的东西再也看不到;②还没建笔记就「插入引用」时 [[双链]] 用的是当时语言的
//   名字,切回另一门语言建出的笔记名对不上 → 永久死链;③zt_title / zt_authors 两套值。
// ⚠️ fixture 必须覆盖**占位符路径**:只喂 itA(有标题 + 2 作者)会整条绕开唯一的两处泄漏口,
//   断言就是空的(v1.1.0 的漏检正是出在这儿)。空标题条目与 >8 作者条目一条都不能少。
{
  const ann = { key: 'ANNBI001', type: 'highlight', text: '划线原文', comment: '我的评论', color: '#ffd400', pageLabel: '3' }
  // 空标题:导入不全的条目里常见(另有个**未实证**的怀疑:case/statute/email 等类型 Zotero 本地 API
  //   回的可能是 caseName/nameOfAct/subject 而非 title —— 待有真 Zotero 时验,本条断言不依赖它)
  const itEmptyTitle = T.parseItem({ key: 'EMPTY001', data: { itemType: 'journalArticle', date: '2020-03-01', creators: [{ lastName: 'Smith', creatorType: 'author' }] } })
  // 12 作者:合作论文是文献库常态,joinCreators 的 >8 省略后缀是第二处泄漏口
  const itManyAuthors = T.parseItem({ key: 'MANY0001', data: { itemType: 'journalArticle', title: 'Big Collaboration', date: '2021', creators: Array.from({ length: 12 }, (_, i) => ({ lastName: `A${i}`, creatorType: 'author' })) } })
  const diskFace = () => [
    T.buildNoteMd(itA), T.annLines(ann), T.buildCitation(itA, 'X'), T.upsertAiSection('', 'body'),
    // 占位符路径:文件名 / 骨架 / 引用块 / frontmatter 值
    T.citeName(itEmptyTitle), T.buildNoteMd(itEmptyTitle), T.buildCitation(itEmptyTitle, T.citeName(itEmptyTitle)), T.diskTitle(itEmptyTitle),
    T.citeName(itManyAuthors), T.buildNoteMd(itManyAuthors), itManyAuthors.authors, T.joinCreators(itManyAuthors.creators),
    // 1.2.0 的导出产物同样是磁盘面:.bib / .csl.json 的字节与导出文件基名都不许随界面语言变
    T.bibFile([itA, itEmptyTitle, itManyAuthors]), T.cslFile([itEmptyTitle, itManyAuthors]),
    T.exportBaseName({}), T.exportBaseName({ colKey: 'C4', colName: '' }), T.exportBaseName({ query: '注意力' }),
  ]
  loc = 'zh'
  const zhSide = diskFace()
  loc = 'en'
  const enSide = diskFace()
  loc = 'zh'
  A.deepEqual(enSide, zhSide, '笔记骨架/批注行/引用块/AI 节/文件名/zt_title/zt_authors 在两种语言下必须逐字节相同')
  A.ok(zhSide[0].includes('## 划线与批注') && zhSide[3].includes('## AI 速览'), '前提:节标题恒中文')
  A.equal(T.citeName(itEmptyTitle), 'Smith2020-无标题', '空标题的文件名锚点钉死中文常量(与 v1.0.0 存量笔记逐字节兼容)')
  A.ok(itManyAuthors.authors.endsWith(' 等'), 'zt_authors 的 >8 省略后缀恒中文')
  A.equal(T.exportBaseName({ colKey: 'C4', colName: '' }), '导出-(未命名)', '未命名集合的导出文件名钉死中文常量(取 UI 词表键会让中英两套文件名无限增殖)')
  A.equal(T.exportBaseName({}), '导出-全部条目', '「全部条目」的导出文件名同样是磁盘常量')
  A.ok(T.bibFile([itEmptyTitle]).includes('title = {(无标题)}'), '空标题条目的 .bib 标题占位符恒中文常量')
  // 反过来:UI 面必须跟着语言变(占位符在渲染时兜底,所以切语言即变,不必重载列表)
  loc = 'en'
  A.equal(T.uiTitle(itEmptyTitle), '(Untitled)', 'UI 面空标题占位跟随语言')
  A.equal(T.diskTitle(itEmptyTitle), '(无标题)', '同一时刻磁盘面仍是中文')
  A.ok(T.uiAuthors(itManyAuthors).endsWith('et al.'), 'UI 面 >8 作者英文侧 et al.')
  A.equal(T.uiAuthors(itA), 'Vaswani, Shazeer', '≤8 作者两语言同形(文献著录惯例)')
  // 反向泄漏也要挡:界面上直接摆 item.authors(磁盘串)会让英文界面冒出中文「等」
  for (const el of [T.buildDetailCard(itManyAuthors), T.buildItemRow(itManyAuthors, {})]) {
    A.ok(el.textContent.includes('et al.') && !el.textContent.includes(' 等'), '英文界面的作者串不许摆磁盘面的中文「等」')
  }
  loc = 'zh'
  A.equal(T.uiTitle(itEmptyTitle), '(无标题)', '切回中文 UI 面跟着回来')
}
// 端到端:zh 下建的笔记,索引丢失后在 en 下必须认得回来,不许凭空建出第二篇
{
  const itX = T.parseItem({ key: 'BILING01', data: { itemType: 'journalArticle', date: '2019', creators: [{ lastName: 'Zhang', creatorType: 'author' }] } })
  const idxBefore = V.get('文献工作台/.zotero-index.json') // 本段故意删索引,末尾要原样放回
  loc = 'zh'
  const a1 = await T.ensureNote(itX)
  A.equal(a1.created, true, '前提:zh 下新建')
  V.delete('文献工作台/.zotero-index.json') // 索引被同步删 / 换机器 / 用户手删
  loc = 'en'
  const a2 = await T.ensureNote(itX)
  loc = 'zh'
  A.equal(a2.created, false, '切英文后必须认领到 zh 建的那篇,不得建出第二篇')
  A.equal(a2.path, a1.path, '认领到同一个文件')
  A.equal([...V.keys()].filter((p) => p.startsWith('文献工作台/Zhang2019')).length, 1, '磁盘上只留一篇 Zhang2019 笔记')
  A.equal(JSON.parse(V.get('文献工作台/.zotero-index.json')).notes.BILING01.title, '(无标题)', '认领路径写回索引的 title 也是磁盘面,恒中文')
  // ensureNote 有两条写索引的路径(认领 / 新建),两条都得钉:en 下**新建**的笔记同样落中文常量
  loc = 'en'
  const b1 = await T.ensureNote(T.parseItem({ key: 'BILING02', data: { itemType: 'journalArticle', date: '2018', creators: [{ lastName: 'Wu', creatorType: 'author' }] } }))
  loc = 'zh'
  A.equal(b1.name, 'Wu2018-无标题', 'en 下新建的笔记文件名也是中文常量')
  A.equal(JSON.parse(V.get('文献工作台/.zotero-index.json')).notes.BILING02.title, '(无标题)', '新建路径写进索引的 title 也恒中文')
  V.set('文献工作台/.zotero-index.json', idxBefore) // 清场:把 ABCD1234 等既有映射放回,别影响后面的用例
}
// ══ ⑧ mock ctx 切 en:视图**不重挂**也必须变英文(BRIEF 判定标准) ═════════════
{
  globalThis.window = globalThis // themeObserver 要 window.matchMedia(上一个块 delete 掉了)
  loc = 'zh'
  const host2 = mkEl('div')
  const off2 = view.mount(host2)
  const settle2 = async (pred, why) => {
    for (let i = 0; i < 50; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 5)) }
    A.fail(`等待超时:${why}`)
  }
  const root2 = host2.children.find((c) => c.className === 'zt-root')
  const conn2 = root2.querySelector('[data-conn]')
  const cols2 = root2.querySelector('[data-cols]')
  const main2 = root2.querySelector('[data-main]')
  const search2 = root2.querySelector('[data-search]')
  const lbl2 = root2.querySelector('[data-lbl-search]')
  await settle2(() => conn2.textContent.includes('已连接'), '中文态先连上')
  await settle2(() => !main2.textContent.includes('加载中'), '中文态列表加载完成')
  A.ok(cols2.textContent.includes('全部条目'), '中文集合树含「全部条目」')
  A.ok(lbl2.textContent.includes('检索'), '中文静态标签在场')
  A.ok(main2.textContent.includes('条'), '中文列表计数')
  A.ok(cols2.textContent.includes('(未命名)'), '中文态无名集合占位符')
  A.ok(main2.textContent.includes('(无标题)'), '中文态无标题条目占位符')
  // 选中无名集合:列表头的占位符同样要渲染时兜底(S.colName 存原始名,存 UI 占位符会把语言烘进 state)
  const unnamedFold = findAll(cols2, 'div').filter((c) => String(c.className).includes('zt-fold')).find((d) => d.textContent === '(未命名)')
  A.ok(unnamedFold, '侧栏有无名集合那一行')
  unnamedFold.click()
  await settle2(() => !main2.textContent.includes('加载中'), '切到无名集合后列表加载完成')
  A.ok(main2.textContent.includes('(未命名)'), '中文态列表头显示无名集合占位符')
  // ——— 切 en:不重挂、不重跑 mount,只靠 subscribeLocale 回调重渲 ———
  main2.scrollTop = 120 // 用户已经滚下去了(垫片在清空内容时会归零,与真浏览器同)
  setLocale('en')
  A.equal(main2.scrollTop, 120, '切语言只换文案,不得把用户滚到的位置弹回顶部(renderMain 整清重建会归零,rerender 必须存/复原)')
  A.ok(conn2.textContent.includes('Connected to Zotero'), `切 en 后连接卡应变英文,实得:${conn2.textContent.slice(0, 80)}`)
  A.ok(!conn2.textContent.includes('已连接'), '切 en 后连接卡中文应消失')
  A.ok(cols2.textContent.includes('All Items'), `切 en 后集合树应变英文,实得:${cols2.textContent.slice(0, 80)}`)
  A.ok(!cols2.textContent.includes('全部条目'), '切 en 后「全部条目」应消失')
  A.equal(lbl2.textContent, 'Search', '骨架里的静态标签也跟着变(不是只重渲动态区)')
  A.equal(search2.placeholder, 'Title or author…', '输入框 placeholder 也跟着变')
  A.ok(main2.textContent.includes('items'), `切 en 后列表头计数变英文,实得:${main2.textContent.slice(0, 80)}`)
  A.ok(main2.textContent.includes('Attention Is All You Need'), '用户数据(文献标题)原样保留,不受语言影响')
  // 占位符是**渲染时**兜底的,所以切语言即变 —— 烘在 parseItem/parseCollections 里的话,
  // S.items / S.cols 是加载那一刻解析好的,这里会卡在中文直到用户重新加载列表
  A.ok(cols2.textContent.includes('(Unnamed)') && !cols2.textContent.includes('(未命名)'), `无名集合占位符应跟着切成英文,实得:${cols2.textContent.slice(0, 80)}`)
  A.ok(main2.textContent.includes('(Untitled)') && !main2.textContent.includes('(无标题)'), '无标题条目占位符应跟着切成英文(不必重新加载列表)')
  A.ok(!main2.textContent.includes('(未命名)'), '列表头的无名集合占位符也跟着切英文(S.colName 里不许存 UI 占位符)')
  // 详情页动作按钮 + 元数据标签
  loc = 'en'
  const evilFree = T.parseItem(FIX_ITEM_A)
  A.ok(T.buildDetailCard(evilFree).textContent.includes('Journal'), '详情卡标签英文')
  A.ok(T.buildItemRow(evilFree, { hasNote: true }).textContent.includes('Note'), '「笔记」徽标英文')
  // 缺 title 的条目:UI 面走英文占位,磁盘面(文件名/frontmatter/索引)恒中文
  A.equal(T.parseItem({ key: 'K' }).title, '', '解析层不烘占位符')
  A.equal(T.uiTitle(T.parseItem({ key: 'K' })), '(Untitled)', 'UI 占位跟随语言')
  A.equal(T.diskTitle(T.parseItem({ key: 'K' })), '(无标题)', '磁盘占位恒中文')
  // 切回中文,视图也要跟着回来
  setLocale('zh')
  A.ok(cols2.textContent.includes('全部条目'), '切回 zh 后中文回来')
  A.equal(T.uiTitle(T.parseItem({ key: 'K' })), '(无标题)')
  // ── 切语言不得清空进行中的 AI 进度行(renderDetail 每次都新建一个空的 .zt-aiprog,
  //    不从 state 回填的话「ai_start 到首 token 之间切语言」那行会一直空着) ──
  {
    const row = findAll(main2, 'div').filter((c) => String(c.className).includes('zt-item'))
      .find((r) => r.textContent.includes('Attention Is All You Need'))
    A.ok(row, '列表里找到 itA 那行')
    row.click()
    await settle2(() => main2.textContent.includes(T.MSG.zh.lbl_abstract), '详情页上屏')
    const aiBtn = () => findAll(main2, 'button').find((b) => b.textContent === T.MSG.zh.btn_ai)
    await settle2(() => aiBtn() && !aiBtn().disabled, 'AI 按钮就绪(itA 已有阅读笔记 + 有摘要)')
    aiBtn().click() // 无引擎无 backendUrl → 走失败分支,进度行留一条失败提示
    await settle2(() => { const p = main2.querySelector('[data-aiprog]'); return !!(p && p.textContent.trim()) }, 'AI 进度行有内容')
    const progText = main2.querySelector('[data-aiprog]').textContent
    setLocale('en')
    const p2 = main2.querySelector('[data-aiprog]')
    A.ok(p2 && p2.textContent === progText, `切语言后 AI 进度/失败提示必须原样回填,实得:${p2 && JSON.stringify(p2.textContent)}`)
    A.ok(main2.textContent.includes(T.MSG.en.lbl_abstract), '详情页其余文案照常变英文')
    A.ok(main2.textContent.includes('Attention Is All You Need'), '详情页标题是用户数据,不翻译')
    setLocale('zh')
  }
  A.doesNotThrow(() => off2(), '双语视图 disposer 不抛')
  // 视图退订后不再吃语言事件(disposer 删掉了自己的重渲函数)
  A.doesNotThrow(() => setLocale('en'), '视图卸载后切语言不抛')
  setLocale('zh')
  loc = 'zh'
  delete globalThis.window
}

// ══ 导出出口的界面契约:列表头按钮三态(加载/报错/空)+ 详情页两个复制按钮 + 端到端导出 ══════
{
  globalThis.window = globalThis // themeObserver 要 window.matchMedia(上一个块 delete 掉了)
  const fixtureFetch = globalThis.fetch
  let listMode = 'defer' // defer(挂起)/ err / empty / ok
  const listDefers = []
  globalThis.fetch = async (url, opts) => {
    // 列表/集合条目/检索都带 itemType=-attachment;连接检查(/items?limit=1)不带,照走 fixture
    if (String(url).includes('itemType=-attachment')) {
      if (listMode === 'defer') return new Promise((res) => { listDefers.push(res) })
      if (listMode === 'err') return { ok: false, status: 500, json: async () => null }
      if (listMode === 'empty') return { ok: true, status: 200, json: async () => [] }
      if (listMode === 'many') return { ok: true, status: 200, json: async () => Array.from({ length: 100 }, (_, i) => ({ ...FIX_ITEM_A, key: `MANY${String(i).padStart(4, '0')}` })) }
    }
    return fixtureFetch(url, opts)
  }
  const host3 = mkEl('div')
  let off3
  A.doesNotThrow(() => { off3 = view.mount(host3) }, '导出用例的 mount 不抛')
  const settle3 = async (pred, why) => {
    for (let i = 0; i < 80; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 5)) }
    A.fail(`等待超时:${why}`)
  }
  const root3 = host3.children.find((c) => c.className === 'zt-root')
  const cols3 = root3.querySelector('[data-cols]')
  const main3 = root3.querySelector('[data-main]')
  const btnsIn = (el) => findAll(el, 'button').map((b) => b.textContent)
  const exBtn = () => findAll(main3, 'button').find((b) => b.textContent === T.MSG.zh.btn_export || b.textContent === T.MSG.zh.btn_exporting || b.textContent === T.MSG.en.btn_export || b.textContent === T.MSG.en.btn_exporting)
  const folds = () => findAll(cols3, 'div').filter((c) => String(c.className).includes('zt-fold'))

  // ① 加载中:列表还没回来,不许画导出按钮(点了必炸)
  await settle3(() => listDefers.length === 1, '列表请求挂起中(加载态)')
  A.ok(main3.textContent.includes(T.MSG.zh.list_loading), '前提:处于加载态')
  A.ok(!exBtn(), '加载中不画导出按钮')
  // ② 列表报错:同样不画
  listDefers[0]({ ok: false, status: 500, json: async () => null })
  await settle3(() => !main3.textContent.includes(T.MSG.zh.list_loading), '列表报错落地')
  A.ok(main3.textContent.includes('加载失败'), '前提:处于报错态')
  A.ok(!exBtn(), '列表报错时不画导出按钮')
  // ③ 空列表:同样不画
  listMode = 'empty'
  folds()[0].click()
  await settle3(() => main3.textContent.includes(T.MSG.zh.list_empty_col) || main3.textContent.includes(T.MSG.zh.list_nohit), '空列表上屏')
  A.ok(!exBtn(), '空列表不画导出按钮')
  // ④ 有条目:按钮出现,点它端到端导出两个文件
  listMode = 'ok'
  folds()[0].click()
  await settle3(() => !!exBtn(), '有条目时导出按钮出现')
  const n0 = notices.length
  const w0 = writes.length
  exBtn().click()
  await settle3(() => V.has('文献工作台/导出-全部条目.bib'), '端到端导出落盘')
  A.ok(V.has('文献工作台/导出-全部条目.csl.json'), '两个产物成对')
  A.ok(V.get('文献工作台/导出-全部条目.bib').startsWith('% Encoding: UTF-8'), '.bib 文件头')
  A.deepEqual(JSON.parse(V.get('文献工作台/导出-全部条目.csl.json')).map((o) => o.type).sort(), ['article-journal', 'article-journal', 'report', 'webpage'], 'CSL 产物覆盖当前列表的 4 条')
  await settle3(() => notices.slice(n0).some((x) => String(x.m).includes('已导出')), '导出成功有提示')
  A.ok(activityLog.some((l) => l.e === 'export'), '导出记 activity(Muse 看得到)')
  A.equal(writes.slice(w0).length, 2, '一次导出只写两个文件')
  // 再点一次:内容没变 → 不写盘、提示「已是最新」
  const w1 = writes.length
  const n1 = notices.length
  exBtn().click()
  await settle3(() => notices.slice(n1).some((x) => String(x.m).includes('已是最新')), '二次导出提示已是最新')
  A.equal(writes.length, w1, '二次导出内容没变一个字节都不写')

  // ④b 列表被截断到 100 条:导出前必须先提示「导出的也只有这 100 条」,不许假装导了全部
  listMode = 'many'
  folds()[0].click()
  await settle3(() => main3.textContent.includes('100 条'), '100 条列表上屏')
  const n1b = notices.length
  exBtn().click()
  await settle3(() => notices.slice(n1b).some((x) => String(x.m).includes('当前列表已截断到前 100 条')), '截断时导出先给提示')
  await settle3(() => V.has('文献工作台/导出-全部条目-2.bib'), '截断批次另存 -2(内容与上一批不同,绝不覆写)')
  const manyKeys = JSON.parse(V.get('文献工作台/导出-全部条目-2.csl.json')).map((o) => o.id)
  A.equal(new Set(manyKeys).size, 100, '100 条同名同年同首词的条目拿到 100 个互不相同的 key')
  A.ok(manyKeys.includes('vaswani2017attention-a') && manyKeys.includes('vaswani2017attention-aa'), '超过 26 条时后缀展开成 -aa/-ab')
  A.ok(!manyKeys.includes('vaswani2017attention'), '冲突组里没有裸键(旧 \\cite{裸键} 宁可断,不可错指)')
  listMode = 'ok'
  folds()[0].click()
  await settle3(() => findAll(main3, 'div').filter((c) => String(c.className).includes('zt-item')).length === 4, '切回 4 条列表')

  // ⑤ 详情页:新的两个复制按钮在场,既有按钮一个都没被挤掉
  const row3 = findAll(main3, 'div').filter((c) => String(c.className).includes('zt-item')).find((r) => r.textContent.includes('Attention Is All You Need'))
  A.ok(row3, '列表里找到 itA 那行')
  row3.click()
  await settle3(() => main3.textContent.includes(T.MSG.zh.lbl_abstract), '详情页上屏')
  const dbtns = btnsIn(main3)
  A.ok(dbtns.includes(T.MSG.zh.btn_copy_bib) && dbtns.includes(T.MSG.zh.btn_copy_csl), '详情页有「复制 BibTeX」「复制 CSL-JSON」')
  A.ok(dbtns.includes(T.MSG.zh.btn_new_note) || dbtns.includes(T.MSG.zh.btn_open_note), '既有的阅读笔记按钮还在')
  A.ok(dbtns.includes(T.MSG.zh.btn_import), '既有的「导入划线批注」还在')
  A.ok(dbtns.includes(T.MSG.zh.btn_cite) || dbtns.includes(T.MSG.zh.btn_copy_cite), '既有的「插入引用/复制引用」还在')
  A.ok(dbtns.length >= 6, `动作行按钮不少于 6 个(返回 + 5 个动作),实得 ${dbtns.length}`)
  // 无剪贴板 → 走「复制失败」提示,不抛不崩
  const copyBtn = () => findAll(main3, 'button').find((b) => b.textContent === T.MSG.zh.btn_copy_bib)
  const prevNav = globalThis.navigator
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  const n2 = notices.length
  A.doesNotThrow(() => copyBtn().click(), '无剪贴板时点复制不抛')
  await settle3(() => notices.slice(n2).some((x) => String(x.m).includes('复制失败')), '无剪贴板走复制失败提示')
  // 有剪贴板 → 剪贴板里是单条 BibTeX,键与批量导出同源
  const clip = []
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (tx) => { clip.push(tx) } } }, configurable: true })
  const n3 = notices.length
  copyBtn().click()
  await settle3(() => clip.length === 1, 'BibTeX 进剪贴板')
  A.ok(clip[0].includes('@article{vaswani2017attention,'), '复制的是单条 BibTeX,cite key 与批量导出同源')
  A.ok(notices.slice(n3).some((x) => String(x.m).includes('已复制 BibTeX')), '复制成功有提示')
  const cslBtn = findAll(main3, 'button').find((b) => b.textContent === T.MSG.zh.btn_copy_csl)
  cslBtn.click()
  await settle3(() => clip.length === 2, 'CSL-JSON 进剪贴板')
  A.equal(JSON.parse(clip[1])[0].id, 'vaswani2017attention', '两种格式的键同源')

  // ⑥ 切 en:新按钮文案不重挂即变(既有 ⑧ 判定标准对新出口同样适用)
  setLocale('en')
  const enBtns = btnsIn(main3)
  A.ok(enBtns.includes('Copy BibTeX') && enBtns.includes('Copy CSL-JSON'), `切 en 后详情页复制按钮变英文,实得:${enBtns.join('|')}`)
  A.ok(!enBtns.includes(T.MSG.zh.btn_copy_bib), '切 en 后中文按钮消失')
  findAll(main3, 'button').find((b) => b.textContent === T.MSG.en.btn_back).click()
  await settle3(() => !!findAll(main3, 'button').find((b) => b.textContent === T.MSG.en.btn_export), '切 en 后列表头导出按钮变英文')
  setLocale('zh')
  Object.defineProperty(globalThis, 'navigator', { value: prevNav, configurable: true })
  A.doesNotThrow(() => off3(), '导出用例的视图 disposer 不抛')
  globalThis.fetch = fixtureFetch
  delete globalThis.window
  for (const k of [...V.keys()]) if (k.includes('/导出-')) V.delete(k)
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
  // 1.2.0:旧宿主没有 readFile/writeFile → 导出必须报「不支持文件读写」,不许崩
  let exErr = null
  try { await T2.exportBib([itA], '导出-全部条目') } catch (e) { exErr = e }
  A.ok(exErr && String(exErr.message).includes('不支持文件读写'), '旧宿主导出报缺文件面而不是崩')
  A.equal(copied.length, 1, '导出失败没有顺手往剪贴板里塞东西')
  // 纯序列化不依赖任何 07-18 后的 API,旧宿主上照样能复制
  await T2.copyText(T2.bibFile([itA]), 'msg_bib_copied')
  A.ok(copied[1].includes('@article{vaswani2017attention,'), '旧宿主上复制 BibTeX 照常可用')
  A.ok(oldNotices.some((m) => String(m).includes('已复制 BibTeX')), '旧宿主复制有提示')
  A.doesNotThrow(() => dispose2(), '旧宿主 disposer 不抛')
  globalThis.__ZOTERO_TEST__ = T1
}

// ── ② disposer:执行不抛,且浮层容器与注入样式收干净 ──
A.ok(globalThis.document.body.children.some((c) => String(c.className).includes('zt-layer')), 'dispose 前浮层容器在场(mount 期创建)')
A.doesNotThrow(() => dispose(), 'disposer 执行不抛')
A.ok(!globalThis.document.body.children.some((c) => String(c.className).includes('zt-layer')), 'dispose 后浮层容器已从 body 移除')
A.ok(!globalThis.document.head.children.some((c) => c.tag === 'style'), 'dispose 后注入的 <style> 已从 head 移除')

// ══════════════════════════════════════════════════════════════════════════
// [回归] 2026-08-21 对抗评审 P0:宿主的读失败形态是 **return null**,不是 throw
//   (真源 electron/amadeus/ipc.ts:981-989 —— catch { return null } 吞掉一切 fs 错误)。
//   四个站点原本都把 null 折叠成「还没有」,下一行就整文件写回。
//   判据用只读枚举面:路径在 listPages/listFiles 里、readFile 却给 null ⇒ 读失败 ⇒ 中止。
// ══════════════════════════════════════════════════════════════════════════
{
  const rItems = [itA] // itA 是顶层 fixture(check.mjs:242);块内的 items 是别处的局部量
  const NOTE = '文献工作台/回归笔记.md'
  const BIB = '文献工作台/导出-R.bib'
  const prevRead = ctx.app.readFile
  const nulls = new Set()
  ctx.app.readFile = async (x) => (nulls.has(x) ? null : (V.has(x) ? V.get(x) : null))

  // R1:导出撞上一份「在库里、但这一刻读不回来」的 .bib → 中止,零写入
  V.set(BIB, '% 用户手改过的 bib\n@book{mine1999,}\n')
  nulls.add(BIB)
  const w0 = writes.length
  let err = null
  try { await T.exportBib(rItems, '导出-R') } catch (e) { err = e }
  A.ok(err && String(err.message).includes('读不出已有的导出文件'), 'R1 null 形态的读失败同样必须中止导出')
  A.equal(writes.length, w0, 'R1 读失败一个字节都不许写')
  A.equal(V.get(BIB), '% 用户手改过的 bib\n@book{mine1999,}\n', 'R1 用户手改的 .bib 逐字节不变')
  nulls.delete(BIB); V.delete(BIB)

  // R2:反向 —— 路径真的不存在时照常导出(别拒过头)
  const r2 = await T.exportBib(rItems, '导出-R2')
  A.equal(r2.bib, '文献工作台/导出-R2.bib', 'R2 真空位仍照常导出')

  // R3:healIndex 对「读不回来」的项必须**保留**,只剔明确不存在的
  V.set(NOTE, '---\nzt_key: KEEP\n---\n用户正文\n')
  const idxPath = '文献工作台/.zotero-index.json'
  V.set(idxPath, JSON.stringify({ notes: { KEEP: { path: NOTE }, GONE: { path: '文献工作台/没了.md' } } }))
  nulls.add(NOTE)
  const healed = await T.healIndex()
  A.ok(healed.notes.KEEP, 'R3 读不回来的项必须保留(剔了就把「这一刻读不出来」写死成「文件已删」)')
  A.ok(!healed.notes.GONE, 'R3 明确不存在的项照旧剔除')
  nulls.delete(NOTE)

  // R4:索引读失败/坏 JSON → ok:false,且一切 writeIndex 一律跳过
  V.set(idxPath, '{坏 JSON')
  const bad = await T.readIndex()
  A.equal(bad.ok, false, 'R4 坏 JSON = 读失败态,不是「还没有索引」')
  const w4 = writes.length
  await T.writeIndex(bad)
  A.equal(writes.length, w4, 'R4 读失败态一律不落盘')
  A.equal(V.get(idxPath), '{坏 JSON', 'R4 坏索引原样保留,等下一次自愈')
  V.delete(idxPath); V.delete(NOTE)
  ctx.app.readFile = prevRead
}

// [回归] CSL 日期形态(评审 Finding 5):能确定几段出几段,越界降级,绝不出非法 CSL
{
  A.deepEqual(T.dateParts('2017-06-12', ''), [2017, 6, 12], 'R5 完整日期')
  A.deepEqual(T.dateParts('2017-06', ''), [2017, 6], 'R5 只有年月 → 年月(以前掉成只有年)')
  A.deepEqual(T.dateParts('2017-6-2', ''), [2017, 6, 2], 'R5 不补零也认(Zotero 常见形态)')
  A.deepEqual(T.dateParts('2024-13-45', ''), [2024], 'R5 非法月 → 降级成只有年,不出非法 CSL')
  A.deepEqual(T.dateParts('2024-02-45', ''), [2024, 2], 'R5 非法日 → 降到年月')
  A.deepEqual(T.dateParts('June 2017', '2017'), [2017], 'R5 认不出的形态回落到 year 字段')
  A.equal(T.dateParts('', ''), null, 'R5 两者都没有 → null(调用方整个省掉 issued)')
}

// [回归] url 里的空白(评审 Finding 4):bibtex 遇字段内空行即终止条目
{
  A.equal(T.bibVerbatim('https://ex.com/a\n\nb c'), 'https://ex.com/abc', 'R6 url 里的空白一律剥掉(URL 语义里本来就非法)')
  A.ok(!/\n/.test(T.bibVerbatim('https://ex.com/a\nb')), 'R6 产出里绝不留换行')
}

console.log(`check ok — ${reg.views.length} view / ${reg.commands.length} cmds / ${reg.settings.length} settings;fixture 解析+引用名序号+批注幂等(head 域+批次去重)+我的笔记保护+AI 速览节+引用块+连接降级+XSS+旧宿主复制降级+契约往返+loadPage 打开/回灌+哨兵消毒(含 frontmatter)+YAML 引号转义+索引身份校验+集合环救援+码点截断+双链字符消毒+zotero:// 降级复制+视图 mount/竞态/清理+collections limit+超时 signal+双语(键集合相等/切 en 不重挂即变/磁盘身份不随语言变:空标题·12 作者·跨语言认领/切语言保滚动位置与 AI 进度/占位符渲染时兜底/术语与版本号单源)+严格引文导出(LaTeX 转义全表/大括号恒平衡/大小写保护/法人与 von-Jr 姓名分段/cite key 含 CJK 与 a-b-c 冲突/两种格式键同源/确定性逐字节/类型映射全表/读失败中止/不覆写另存 -2/活动页让位/序号耗尽不兜底/零页面写入·零网络/产物字节不随语言变/列表头按钮三态/t() 单趟替换)全部通过`)
