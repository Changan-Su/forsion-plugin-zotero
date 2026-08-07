/**
 * 文献工作台 —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 连接本机 Zotero 7(localhost 本地 API,零云依赖):
 *   plugin:zotero:library —— 单视图两栏:左=连接状态+集合树+检索;右=条目列表→条目详情
 *   (阅读笔记 / 导入划线批注 / 插入引用 / 打开 PDF / AI 读文献)。
 * 数据契约:阅读笔记 = <workFolder>/<引用名>.md(frontmatter zt_*;「## 划线与批注」幂等增量,
 *   哨兵 <!-- zann:key -->;「## 我的笔记」自由区导入永不触碰);索引 .zotero-index.json 打开时自愈。
 * 安全:Zotero API 响应全按不可信输入处理 —— 一切外来字符串进 DOM 只走 createElement+textContent,
 *   innerHTML 只含编译期字面量。PDF 阅读在 Zotero 内完成(zotero:// 协议唤起)。
 * AI:「AI 读文献」把阅读笔记文本 POST /agent/runs(纯文本,默认助手),模型回 ```litreview 块,
 *   插件解析后自己写进笔记「## AI 速览」节(位于「我的笔记」之上)。
 */
const PLUGIN_ID = 'zotero'
const APP_ID = 'tangu'
const DEFAULT_PORT = 23119
const DEFAULT_FOLDER = '文献工作台'

ctx.registerSetting({ key: 'port', label: 'Zotero 本地 API 端口', type: 'number', default: DEFAULT_PORT, min: 1, max: 65535, description: 'Zotero 7 本地 API 端口(默认 23119)。改了 Zotero 的端口才需要改这里。' })
ctx.registerSetting({ key: 'noteNameStyle', label: '阅读笔记命名风格', type: 'text', default: 'author-year', description: '目前仅支持 author-year(首作者姓+年份+标题 slug),预留扩展。' })

// ── 纯函数(经文末 __ZOTERO_TEST__ 暴露给 check.mjs) ────────────────────────

const getSetting = (k, d) => { try { return localStorage.getItem(`plugin.${PLUGIN_ID}.${k}`) || d } catch { return d } }
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
function portOf() {
  const n = parseInt(getSetting('port', ''), 10)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT
}
function today() {
  const d = new Date(Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** frontmatter 值:折叠换行/空白(标题带换行会拆坏 YAML 行)。 */
const fmVal = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
const oneLine = fmVal
/** 哨兵字面消毒:批注/AI 文本里若嵌了「<!-- zann:KEY -->」字面,extractZannKeys 全文扫描会把它
 *  当成已导入哨兵 → 那个 KEY 的真批注永远 added=0(幂等被字面污染)。在「<!」与「--」之间
 *  插零宽空格打断注释开头(视觉不变,\s 不匹配 U+200B,正则不再命中)。 */
const ZWSP = String.fromCharCode(0x200b)
const stripZann = (s) => String(s == null ? '' : s).replace(/<!(--\s*zann:)/gi, '<!' + ZWSP + '$1')
/** frontmatter 值 → 双引号 YAML 标量。裸写外来标题是毁损链:带冒号的标题(学术常态,如
 *  「BERT: Pre-training…」)让宿主属性面板 YAML 解析抛错落原文模式,该模式下「添加属性」一点
 *  即把整段 zt_* 覆盖没;` #` 开头的尾巴则被 YAML 注释语义静默截断后回写永久丢失。
 *  一律引号包裹并转义 \\ 与 ";残余控制字符置空格(YAML 双引号标量不许裸控制字符);
 *  先过 stripZann——frontmatter 也是外来面,标题嵌哨兵字面同样会污染批注幂等。 */
const fmQ = (v) => '"' + stripZann(fmVal(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
function safeHref(u) {
  const s = String(u || '').trim()
  return /^(https?:\/\/|#|mailto:)/i.test(s) ? s : ''
}
function sanitizeFileName(name) {
  // 字符类须为 [[wiki 双链]] 消毒:作者姓含 ]]、#、^、| 会提前闭合/拆坏引用块里的 [[引用名]]。
  // 截断按码点(Array.from),slice 码元会切断代理对留孤立高代理(落盘变 U+FFFD,索引/双链字面不一致)。
  return Array.from(String(name || '').replace(/[\\/:*?"<>|[\]#^]/g, '_').replace(/\s+/g, ' ').trim()).slice(0, 80).join('')
}

// ── Zotero 响应解析(全按不可信输入:缺字段容错,类型强转) ──
const yearOf = (date) => { const m = /(1\d{3}|2\d{3})/.exec(String(date || '')); return m ? m[1] : '' }
const lastNameOf = (c) => fmVal((c && (c.lastName || c.name || c.firstName)) || '')
function joinCreators(creators) {
  const names = (Array.isArray(creators) ? creators : []).map(lastNameOf).filter(Boolean)
  if (!names.length) return ''
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} 等` : names.join(', ')
}
function firstAuthorLast(creators) {
  const list = Array.isArray(creators) ? creators : []
  const au = list.find((c) => c && c.creatorType === 'author' && lastNameOf(c)) || list.find((c) => lastNameOf(c))
  return au ? lastNameOf(au) : ''
}
/** 引用式作者短写:1 人=姓;2 人=A & B;3+ =A et al.。 */
function authorCite(creators) {
  const names = (Array.isArray(creators) ? creators : []).map(lastNameOf).filter(Boolean)
  if (!names.length) return 'Anon'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} et al.`
}
/** 标题 → slug(前 20 字符;CJK 保留,拉丁转小写)。 */
function slugTitle(title) {
  const s = String(title || '').toLowerCase()
    .replace(/[\\/:*?"<>|#%^{}()'"“”‘’「」『』《》【】\[\]]/g, ' ')
    .trim().replace(/\s+/g, '-')
  // 按码点截前 20:slice 码元会从代理对中间切断(emoji 标题 → 文件名尾一枚孤立高代理,
  // 落盘被转成 U+FFFD,磁盘文件名/索引 path/[[双链]] 三者字面不一致)。
  const cut = Array.from(s).slice(0, 20).join('').replace(/-+$/, '')
  return cut || 'untitled'
}
/** 引用名(citekey 近似)= <首作者姓><年份>-<标题前20字符slug>;重名序号由 ensureNote 探测加。 */
function citeName(item) {
  const head = (firstAuthorLast(item.creators) || 'Anon') + (item.year || '')
  return `${sanitizeFileName(head)}-${slugTitle(item.title)}`
}
function parseItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = r.data && typeof r.data === 'object' ? r.data : {}
  const creators = Array.isArray(d.creators) ? d.creators.filter((c) => c && typeof c === 'object') : []
  return {
    key: fmVal(r.key || d.key || ''),
    itemType: fmVal(d.itemType || ''),
    title: fmVal(d.title || '') || '(无标题)',
    creators,
    authors: joinCreators(creators),
    year: yearOf(d.date),
    journal: fmVal(d.publicationTitle || ''),
    doi: fmVal(d.DOI || ''),
    url: String(d.url || '').trim(),
    abstract: String(d.abstractNote || '').trim(),
    dateAdded: fmVal(d.dateAdded || ''),
  }
}
/** 条目列表解析:滤掉无 key 项与 Zotero 独立笔记/批注(列表已 itemType=-attachment,再兜一层)。 */
function parseItems(arr) {
  return (Array.isArray(arr) ? arr : []).map(parseItem)
    .filter((i) => i.key && i.itemType !== 'note' && i.itemType !== 'annotation' && i.itemType !== 'attachment')
}
function parseCollections(arr) {
  const out = []
  for (const raw of Array.isArray(arr) ? arr : []) {
    const r = raw && typeof raw === 'object' ? raw : {}
    const d = r.data && typeof r.data === 'object' ? r.data : {}
    const key = fmVal(r.key || d.key || '')
    if (!key) continue
    out.push({ key, name: fmVal(d.name || '') || '(未命名)', parent: typeof d.parentCollection === 'string' ? d.parentCollection : '' })
  }
  return out
}
/** 集合 → 带缩进深度的有序平铺(孤儿提顶层不弄丢;防环)。 */
function collectionTree(cols) {
  const byParent = new Map()
  const keys = new Set(cols.map((c) => c.key))
  for (const c of cols) { const p = c.parent || ''; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(c) }
  const out = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const c of (byParent.get(parent) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      if (seen.has(c.key)) continue
      seen.add(c.key)
      out.push({ key: c.key, name: c.name, depth })
      walk(c.key, depth + 1)
    }
  }
  walk('', 0)
  // 救援:凡没被根遍历走到的一律提顶层——孤儿(parent 不在前 100 条里)和 parentCollection
  // 互指成环的都在此列;只救孤儿会让环整组静默消失(环成员的 parent 都在 keys 里)。
  for (const c of cols) if (!seen.has(c.key)) { seen.add(c.key); out.push({ key: c.key, name: c.name, depth: 0 }); walk(c.key, 1) }
  return out
}
function parseAnnotations(children) {
  const out = []
  for (const raw of Array.isArray(children) ? children : []) {
    const r = raw && typeof raw === 'object' ? raw : {}
    const d = r.data && typeof r.data === 'object' ? r.data : {}
    if (d.itemType !== 'annotation') continue
    if (d.annotationType !== 'highlight' && d.annotationType !== 'note') continue
    // key 白名单:必须与 extractZannKeys 读回字符集一致,否则哨兵写得进读不回,幂等失效
    // (每次导入重复追加);含 --> 还会提前闭合 HTML 注释。真 Zotero key 是 8 位字母数字,
    // 畸形/恶意响应直接丢弃该条。
    const key = fmVal(r.key || '')
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue
    out.push({
      key,
      type: d.annotationType,
      text: oneLine(d.annotationText || ''),
      comment: oneLine(d.annotationComment || ''),
      color: fmVal(d.annotationColor || ''),
      pageLabel: oneLine(d.annotationPageLabel || ''),
    })
  }
  return out
}
function findPdfAttachment(children) {
  for (const raw of Array.isArray(children) ? children : []) {
    const r = raw && typeof raw === 'object' ? raw : {}
    const d = r.data && typeof r.data === 'object' ? r.data : {}
    if (d.itemType === 'attachment' && d.contentType === 'application/pdf' && r.key) return String(r.key)
  }
  return ''
}
const ANN_COLORS = { '#ffd400': 'yellow', '#ff6666': 'red', '#5fb236': 'green', '#2ea8e5': 'blue', '#a28ae5': 'purple', '#e56eee': 'magenta', '#f19837': 'orange', '#aaaaaa': 'gray' }
const colorName = (hex) => ANN_COLORS[String(hex || '').toLowerCase()] || String(hex || '')

// ── 阅读笔记数据契约(钉死;详见 README) ──
function buildNoteMd(item) {
  // 回跳行补一份行内代码纯文本 URI:Electron 宿主的链接白名单只放 http(s),
  // markdown 链接形式的 zotero:// 点了是死链,代码片形式方便用户手动复制到 Zotero/浏览器。
  const zuri = `zotero://select/library/items/${encodeURIComponent(item.key)}`
  return [
    '---',
    `zt_key: ${fmQ(item.key)}`,
    `zt_title: ${fmQ(item.title)}`,
    `zt_authors: ${fmQ(item.authors)}`,
    `zt_year: ${fmQ(item.year)}`,
    `zt_doi: ${fmQ(item.doi)}`,
    '---',
    '',
    `> [在 Zotero 中打开](${zuri}) \`${zuri}\``,
    '',
    '## 划线与批注',
    '',
    '## 我的笔记',
    '',
  ].join('\n')
}
function parseNoteMeta(md) {
  const meta = {}
  const m = /^---\n([\s\S]*?)\n---/.exec(String(md || ''))
  if (!m) return meta
  for (const line of m[1].split('\n')) {
    const mm = /^(zt_[a-z]+):[ \t]*(.*)$/.exec(line)
    if (!mm) continue
    let v = mm[2].trim()
    // 新格式一律双引号标量:剥一层引号并反转义;旧笔记的裸值(不带引号)原样兼容。
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1')
    meta[mm[1]] = v
  }
  return meta
}
function extractZannKeys(md) {
  const out = new Set()
  const re = /<!--\s*zann:([A-Za-z0-9_-]+)\s*-->/g
  let m
  while ((m = re.exec(String(md || '')))) out.add(m[1])
  return out
}
/** 在「## 我的笔记」标题处切开:tail(该节以下)是用户自由区,导入/AI 写入永不触碰。 */
function splitMyNotes(md) {
  const src = String(md || '')
  const m = /^## 我的笔记[ \t]*$/m.exec(src)
  if (!m) return { head: src, tail: '' }
  return { head: src.slice(0, m.index), tail: src.slice(m.index) }
}
/** 一条批注 → 契约行 + 哨兵行。highlight:`- 「引文」(p.3, yellow) — 我的评论`;note:`- (批注 p.3) 评论`。
 *  整行(text/comment/pageLabel 全是外来面)过 stripZann 再拼真哨兵,防批注文本嵌他条哨兵字面。 */
function annLines(a) {
  const meta = [a.pageLabel ? `p.${a.pageLabel}` : '', a.color ? colorName(a.color) : ''].filter(Boolean).join(', ')
  let line
  if (a.type === 'note') {
    line = `- (批注${meta ? ' ' + meta : ''}) ${a.comment || a.text || '(空)'}`
  } else {
    line = `- 「${a.text}」${meta ? `(${meta})` : ''}`
    if (a.comment) line += ` — ${a.comment}`
  }
  return `${stripZann(line)}\n<!-- zann:${a.key} -->`
}
/** 批注幂等合并:按哨兵 key 去重只追加新条;追加点=「划线与批注」**节内**末尾——
 *  即节标题之后、head 里下一个「## 」标题(如已存在的「## AI 速览」)之前;head 内无后续标题才落 head 末。
 *  「我的笔记」节(tail)逐字节原样保留。节标题被用户删了就自愈补回。
 *  去重范围只看 head(导入区):用户把批注行连哨兵复制/剪切进「我的笔记」自由区是自然动作,
 *  自由区不得反向抑制导入(否则该条在导入区永远补不回还报「都已导入过」)。
 *  批次内部也按 key 去重:畸形 /children 响应回重复子项时只写一行一枚哨兵。 */
function mergeAnnotations(md, anns) {
  const sp = splitMyNotes(md)
  const have = extractZannKeys(sp.head)
  const seen = new Set()
  const fresh = (Array.isArray(anns) ? anns : []).filter((a) => a && a.key && !have.has(a.key) && !seen.has(a.key) && (seen.add(a.key), true))
  if (!fresh.length) return { md: String(md || ''), added: 0 }
  let head = sp.head
  if (!/^## 划线与批注[ \t]*$/m.test(head)) head = head.replace(/\s*$/, '\n\n## 划线与批注\n')
  const block = fresh.map(annLines).join('\n')
  const hm = /^## 划线与批注[ \t]*$/m.exec(head)
  const nextHd = head.indexOf('\n## ', hm.index + hm[0].length)
  const newHead = nextHd >= 0
    ? head.slice(0, nextHd).replace(/\s*$/, '\n\n') + block + '\n' + head.slice(nextHd)
    : head.replace(/\s*$/, '\n\n') + block + '\n\n'
  return { md: newHead + sp.tail, added: fresh.length }
}
/** 「## AI 速览」写入/替换:永远位于「我的笔记」之上;tail 逐字节不动。
 *  节边界一律**行锚定**——裸子串匹配会误命中批注行内的字面「## AI 速览」(整节被切),
 *  或把旧 AI 正文里的 markdown 标题当节尾(旧正文残留)。
 *  写入文本先消毒:行首「## 」降一级为「### 」,防模型输出伪造节边界/污染「我的笔记」切分;
 *  再过 stripZann,防模型产出里嵌哨兵字面污染批注幂等。 */
function upsertAiSection(md, text) {
  const clean = stripZann(String(text || '').trim().split('\n').map((l) => (/^##[ \t]/.test(l) ? '#' + l : l)).join('\n'))
  const body = `## AI 速览\n\n${clean}\n`
  const sp = splitMyNotes(md)
  let head = sp.head
  const hm = /^## AI 速览[ \t]*$/m.exec(head)
  if (hm) {
    const restStart = hm.index + hm[0].length
    const nm = /^## /m.exec(head.slice(restStart))
    const rest = nm ? head.slice(restStart + nm.index) : ''
    head = head.slice(0, hm.index) + body + '\n' + (rest ? rest.replace(/\s*$/, '\n\n') : '')
  } else {
    head = head.replace(/\s*$/, '\n\n') + body + '\n'
  }
  return head.replace(/\n{3,}$/, '\n\n') + sp.tail
}
/** 引用块(契约钉死,作者与年份之间不带空格):`> 作者(年). 标题. 期刊. [Zotero](zotero://…) · [[阅读笔记文件名]]`。 */
function buildCitation(item, noteName) {
  const title = fmVal(item.title).replace(/[.。]$/, '')
  const jr = item.journal ? ` ${fmVal(item.journal).replace(/[.。]$/, '')}.` : ''
  return `> ${authorCite(item.creators)}(${item.year || 'n.d.'}). ${title}.${jr} [Zotero](zotero://select/library/items/${encodeURIComponent(item.key)}) · [[${noteName}]]`
}

// ── Zotero 本地 API(响应不可信;网络错不抛,回 {ok:false}) ──
const apiBase = (port) => `http://localhost:${port}/api/users/0`
const qConn = () => '/items?limit=1'
const qAllItems = () => '/items?itemType=-attachment&limit=100'
const qSearch = (q) => `/items?q=${encodeURIComponent(q)}&itemType=-attachment&limit=100`
// 集合端点也要显式 limit:Zotero 本地 API 沿用 web API v3 语义,多对象端点默认只回 25 条,
// 不带参数集合树会静默截断(>100 个集合仍截断,列真机验收项;v1 不翻页)。
const qCollections = () => '/collections?limit=100'
const qColItems = (key) => `/collections/${encodeURIComponent(key)}/items?itemType=-attachment&limit=100`
const qChildren = (key) => `/items/${encodeURIComponent(key)}/children`
async function ztGet(path) {
  const url = apiBase(portOf()) + path
  try {
    // 5s 超时闸:端口被防火墙 DROP 时 fetch 挂起而非拒绝,没有闸「正在连接」会永远转圈。
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
    if (!res || !res.ok) return { ok: false, error: `HTTP ${res ? res.status : '??'}` }
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data)) return { ok: false, error: '响应不是数组(不是 Zotero 本地 API?)' }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

// ── 引擎接入(照 bluebird:getConfig → POST /agent/runs → SSE;纯文本,默认助手,不传 agentSlug/execMode) ──
async function getCfg() {
  try {
    const c = await (globalThis.window && window.tangu && window.tangu.getConfig ? window.tangu.getConfig() : null)
    if (c && c.backendUrl) return { backendUrl: c.backendUrl, token: c.token || '', modelId: c.modelId || '' }
  } catch { /* web 回退 */ }
  try { return { backendUrl: location.origin + '/api', token: localStorage.getItem('forsion_token') || '', modelId: '' } } catch { /* ignore */ }
  return { backendUrl: '', token: '', modelId: '' }
}
async function runAgent(cfg, sessionId, message, onTick, signal) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }
  const start = await fetch(`${cfg.backendUrl}/agent/runs`, {
    method: 'POST', headers: h, signal,
    body: JSON.stringify({ session_id: sessionId, model_id: cfg.modelId || undefined, app_id: APP_ID, message, attachments: [] }),
  })
  if (!start.ok) throw new Error((await start.text().catch(() => '')) || `起 run 失败 HTTP ${start.status}`)
  const { runId } = await start.json()
  if (!runId) throw new Error('引擎未返回 runId')
  const res = await fetch(`${cfg.backendUrl}/agent/runs/${encodeURIComponent(runId)}/events?fromSeq=0`, { headers: h, signal })
  if (!res.ok || !res.body) throw new Error(`订阅事件失败 HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let lastSeq = 0
  let content = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const line of parts) {
      const s = line.trim()
      if (!s || s.startsWith(':') || !s.startsWith('data:')) continue
      const data = s.slice(5).replace(/^ /, '')
      if (!data) continue
      let ev
      try { ev = JSON.parse(data) } catch { continue }
      if (typeof ev.seq === 'number') { if (ev.seq <= lastSeq) continue; lastSeq = ev.seq }
      if (ev.type === 'token') { const d = ev.payload && ev.payload.delta; if (d) { content += d; if (onTick) onTick(content) } continue }
      if (ev.type === 'done') return (ev.payload && ev.payload.content) || content
      if (ev.type === 'error') throw new Error((ev.payload && ev.payload.error) || 'AI 生成失败')
    }
  }
  throw new Error('与引擎的连接中断,未收到完成事件(可重试)')
}
/** 模型指令(英文,BRIEF 语言纪律):只依据摘要与已导入划线总结贡献/方法/局限,禁编造,回 ```litreview 块。 */
function buildLitreviewMessage(noteText, abstract) {
  return `You are a literature-review assistant helping a researcher digest ONE paper.
Below is the researcher's material for this paper: bibliographic frontmatter, the abstract, and the highlights/annotations they imported from Zotero.

Task: summarize the paper's contribution, method, and limitations, based ONLY on the abstract and the highlights below.
Rules:
- Never fabricate facts, numbers, datasets, or results that are not present in the material.
- If the material is not sufficient for a section, say so explicitly instead of guessing.
- Write the review in Simplified Chinese.
- Reply with exactly ONE fenced code block tagged litreview and nothing else, shaped like:

\`\`\`litreview
**贡献**:...
**方法**:...
**局限**:...
\`\`\`

Abstract:
${String(abstract || '').trim() || '(none)'}

Reading note (frontmatter + imported highlights):
${String(noteText || '').trim()}`
}
/** 解析模型产出:取 ```litreview 块;没按格式回就整段兜底(剥一层通用围栏)。 */
function parseLitreview(out) {
  const raw = String(out || '')
  const m = /```litreview\s*\n([\s\S]*?)```/i.exec(raw)
  if (m) return m[1].trim()
  const w = /^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(raw.trim())
  return (w ? w[1] : raw).trim()
}

// ── vault:工作文件夹 + 映射索引(.zotero-index.json,打开时自愈) ──
const wf = () => { try { return (ctx.app.workFolder ? ctx.app.workFolder() : '') || DEFAULT_FOLDER } catch { return DEFAULT_FOLDER } }
const indexPath = () => `${wf()}/.zotero-index.json`
const baseNameOf = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '')
async function readIndex() {
  try {
    if (!ctx.app.readFile) return { notes: {} }
    const t = await ctx.app.readFile(indexPath())
    const j = t ? JSON.parse(t) : null
    return j && j.notes && typeof j.notes === 'object' ? { notes: j.notes } : { notes: {} }
  } catch { return { notes: {} } }
}
const writeIndex = (idx) => ctx.app.writeFile(indexPath(), JSON.stringify(idx, null, 2))
/** 自愈:剔掉指向已不存在文件、或 zt_key 身份不符的索引项。
 *  .zotero-index.json 是用户库里的普通 JSON(会被同步、可手改、路径可被改名后复用),
 *  只验「文件存在」不够——身份不符的项会把导入/AI 写进无关笔记。
 *  文件没有 zt_key(用户删过 frontmatter 的老笔记)放行。 */
async function healIndex() {
  if (!ctx.app.readFile) return { notes: {} }
  const idx = await readIndex()
  let dropped = 0
  for (const k of Object.keys(idx.notes)) {
    const e = idx.notes[k]
    const t = e && typeof e.path === 'string' ? await ctx.app.readFile(e.path) : null
    const mk = t != null ? parseNoteMeta(t).zt_key : ''
    if (t == null || (mk && mk !== k)) { delete idx.notes[k]; dropped++ }
  }
  if (dropped) await writeIndex(idx).catch(() => { /* 只读环境不阻塞 */ })
  return idx
}
/** 有则复用无则建(引用名重名加序号;索引丢了按文件 zt_key 认领)。 */
async function ensureNote(item) {
  if (!ctx.app.readFile || !ctx.app.writeFile) throw new Error('当前宿主版本不支持文件读写,无法创建阅读笔记')
  const idx = await readIndex()
  const e = idx.notes[item.key]
  if (e && typeof e.path === 'string') {
    // 快路径同样验身份:索引可被同步/手改/路径复用,zt_key 不符就掉进下面的认领循环,
    // 绝不把导入/AI 写进别人的笔记。无 zt_key 的老笔记(用户删过 frontmatter)放行。
    const t = await ctx.app.readFile(e.path)
    if (t != null) {
      const mk = parseNoteMeta(t).zt_key
      if (!mk || mk === item.key) return { path: e.path, name: baseNameOf(e.path), created: false }
    }
  }
  const base = citeName(item)
  let name = ''
  for (let n = 1; n <= 99; n++) {
    const cand = n === 1 ? base : `${base}-${n}`
    const p = `${wf()}/${cand}.md`
    const txt = await ctx.app.readFile(p)
    if (txt == null) { name = cand; break }
    if (parseNoteMeta(txt).zt_key === item.key) {
      idx.notes[item.key] = { path: p, title: item.title, touched: Date.now() }
      await writeIndex(idx)
      return { path: p, name: cand, created: false }
    }
  }
  // 序号耗尽绝不落盘:兜底写会覆盖属于别的条目的既有笔记(用户「我的笔记」被抹)
  if (!name) throw new Error(`同名笔记过多(「${base}」序号已占满),请清理重名文件或改标题后重试`)
  const path = `${wf()}/${name}.md`
  await writeNote(path, buildNoteMd(item))
  idx.notes[item.key] = { path, title: item.title, touched: Date.now() }
  await writeIndex(idx)
  return { path, name, created: true }
}
/** 打开阅读笔记(普通 .md)只走 ctx.app.loadPage(载入宿主编辑器)。
 *  ⚠️ 绝不能用 ctx.app.openFile:宿主对非插件文件类型回落系统默认程序(types.ts 明写
 *  「falls back to the OS default app for non-plugin files」),.md 会被 TextEdit/VS Code 抢走。 */
function openNoteInEditor(path) {
  if (ctx.app.loadPage) { try { ctx.app.loadPage(path); return true } catch { /* ignore */ } }
  return false
}
/** 写阅读笔记统一入口:宿主单活动页模型 + 自写台账让 watcher 忽略本应用写入 —— 目标恰是当前
 *  活动页时编辑器内存副本不回灌,用户一落键防抖保存就用陈旧全文把刚导入的内容抹掉。
 *  写完盘发现目标=活动页 → 立即 loadPage 强制回灌(loadPage 内部先 flush 未落盘的用户编辑
 *  再重读;残余竞态与分屏限制见 README「已知限制」)。 */
async function writeNote(path, text) {
  await ctx.app.writeFile(path, text)
  try {
    const active = ctx.app.getActivePage ? ctx.app.getActivePage() : null
    if (active === path) openNoteInEditor(path)
  } catch { /* ignore */ }
}
/** 导入划线批注:GET children → highlight/note 幂等追加。返回 {added,total,note}。 */
async function importAnnotations(item) {
  const r = await ztGet(qChildren(item.key))
  if (!r.ok) throw new Error(`取批注失败:${r.error}`)
  const anns = parseAnnotations(r.data)
  if (!anns.length) return { added: 0, total: 0, note: null }
  const note = await ensureNote(item)
  const md = (await ctx.app.readFile(note.path)) || buildNoteMd(item)
  const merged = mergeAnnotations(md, anns)
  if (merged.added) {
    await writeNote(note.path, merged.md)
    const idx = await readIndex()
    if (idx.notes[item.key]) { idx.notes[item.key].touched = Date.now(); await writeIndex(idx).catch(() => { /* ignore */ }) }
  }
  return { added: merged.added, total: anns.length, note }
}

// ── 插入引用(块表面;令牌纪律:每次点击现取 getPage,绝不缓存 token) ──
const say = (m, o) => (ctx.notify ? ctx.notify(m, o) : ctx.app.notify(m))
/** zotero:// 协议唤起。Electron 宿主对一切 window.open 走 setWindowOpenHandler,非 http(s)
 *  一律 deny(window.open 返回 null),不能装作打开成功——deny 时回落复制 URI 到剪贴板并提示,
 *  用户粘到浏览器/Zotero 地址栏即可。浏览器直跑(window.open 回真窗口代理)仍走协议唤起。 */
async function openZoteroUri(uri) {
  let w = null
  try { w = globalThis.window && window.open ? window.open(uri) : null } catch { w = null }
  if (w) return 'opened'
  try {
    if (!(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText)) throw new Error('无剪贴板')
    await navigator.clipboard.writeText(uri)
    say(`当前宿主不能直接唤起 Zotero,已复制链接,请粘到 Zotero 或浏览器地址栏:${uri}`, { level: 'warning' })
    return 'copied'
  } catch {
    say(`当前宿主不能直接唤起 Zotero,请手动打开:${uri}`, { level: 'warning' })
    return 'blocked'
  }
}
const hasBlockSurface = () => typeof ctx.app.getPage === 'function' && typeof ctx.app.insertBlockAfter === 'function'
async function insertCite(item, noteName) {
  const block = buildCitation(item, noteName)
  if (!hasBlockSurface()) {
    // 旧宿主无块表面 → 降级为复制引用到剪贴板
    try {
      if (!(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText)) throw new Error('无剪贴板')
      await navigator.clipboard.writeText(block)
      say('已复制引用到剪贴板(当前宿主版本不支持直接插入)', { level: 'success' })
      return 'copied'
    } catch { say('复制引用失败', { level: 'error' }); return 'copyfail' }
  }
  const page = ctx.app.getPage()
  if (!page || !page.path) { say('先在编辑器里打开一篇笔记,再插入引用', { level: 'warning' }); return 'nopage' }
  const id = ctx.app.insertBlockAfter(page.token, null, block)
  if (id == null) { say('插入失败:页面已切换,请重试', { level: 'error' }); return 'stale' }
  if (ctx.activity && ctx.activity.log) ctx.activity.log('cite', { key: item.key, text: fmVal(item.title).slice(0, 80) })
  say('已插入引用', { level: 'success' })
  return 'inserted'
}

// ── 浮层容器(检索选择浮层挂它,不挂裸 body;fixed+pointer-events:none 根,子元素恢复 auto) ──
let _layer = null
let _styleEl = null
let _pickerTimer = null
function ensureStyle() {
  if (!globalThis.document || !document.head) return
  if (_styleEl && _styleEl.isConnected) return
  _styleEl = document.createElement('style')
  _styleEl.textContent = STYLE
  document.head.appendChild(_styleEl)
}
function layer() {
  if (!globalThis.document || !document.body) return null
  if (_layer && _layer.isConnected) return _layer
  ensureStyle()
  _layer = document.createElement('div')
  _layer.className = 'zt-layer'
  document.body.appendChild(_layer)
  return _layer
}
function closeOverlays() {
  if (_pickerTimer) { clearTimeout(_pickerTimer); _pickerTimer = null }
  if (_layer) { try { _layer.textContent = '' } catch { /* ignore */ } }
}

// ── 主题:吃宿主 token(--bg-card/--border/--accent/--on-accent…),缺哪个才从计算样式派生(照 bluebird) ──
let _probe = null
function parseColor(css) {
  const s = (css || '').trim()
  if (!s) return null
  if (!_probe) { const c = document.createElement('canvas'); c.width = c.height = 1; _probe = c.getContext('2d', { willReadFrequently: true }) }
  if (!_probe) return null
  _probe.fillStyle = '#000000'; _probe.fillStyle = s
  const a = _probe.fillStyle
  _probe.fillStyle = '#ffffff'; _probe.fillStyle = s
  if (a === '#000000' && _probe.fillStyle === '#ffffff') return null
  _probe.clearRect(0, 0, 1, 1); _probe.fillRect(0, 0, 1, 1)
  const d = _probe.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2], d[3] / 255]
}
function opaqueBgOf(start) {
  for (let n = start; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor)
    if (c && c[3] > 0.95) return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`
  }
  return null
}
const relL = (c) => { const g = (v) => { const x = v / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4) }; return .2126 * g(c[0]) + .7152 * g(c[1]) + .0722 * g(c[2]) }
const contrast = (a, b) => { const x = relL(a), y = relL(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
/** 强调色上的字色兜底:白 / 近黑取对比高者(宿主没给 --on-accent 时)。 */
const onColorOf = (accent) => (contrast(accent, [255, 255, 255]) >= contrast(accent, [22, 22, 26]) ? '#ffffff' : '#16161a')
/** 强调色当前景(链接/选中态)用:与底色对比不足就朝文字色掺,到 3:1 为止。 */
function readableOn(fg, bg, text, min = 3) {
  let c = [fg[0], fg[1], fg[2]]
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = c.map((v, k) => v + (text[k] - v) * .18)
  return `rgb(${c.map((v) => Math.round(v)).join(',')})`
}
/** 铺全套 --zt-*(view 根 + 浮层容器),自动跟随 LCL 深浅与配色。src 可以是 .zt-root 或 body(命令浮层单开时)。 */
function syncTheme(src) {
  const cs = getComputedStyle(src)
  const tok = (n) => (cs.getPropertyValue(n) || '').trim()
  const rgb = parseColor(tok('--text')) || parseColor(cs.color) || [40, 40, 40, 1]
  const dark = relL(rgb) > .5
  const bgc = parseColor(tok('--bg')) || parseColor(opaqueBgOf(src.parentElement || src) || '') || (dark ? [23, 24, 28] : [255, 255, 255])
  const rd = (n) => Math.round(n)
  const f = (a) => `rgba(${rd(rgb[0])},${rd(rgb[1])},${rd(rgb[2])},${a})`
  const accent = tok('--accent') || tok('--am-accent') || (dark ? '#cfc9ff' : '#4C2585')
  const arc = parseColor(accent) || [76, 37, 133, 1]
  const af = (a) => `rgba(${rd(arc[0])},${rd(arc[1])},${rd(arc[2])},${a})`
  const isRoot = typeof src.className === 'string' && src.className.indexOf('zt-root') >= 0
  const targets = [isRoot ? src : null, layer()].filter(Boolean)
  const set = (k, v) => targets.forEach((t) => t.style.setProperty(`--zt-${k}`, v))
  targets.forEach((t) => { t.style.colorScheme = dark ? 'dark' : 'light' })
  set('text', tok('--text') || `rgb(${rd(rgb[0])},${rd(rgb[1])},${rd(rgb[2])})`)
  set('text-sec', tok('--text-light') || f(.72))
  set('text-muted', tok('--text-muted') || f(.5))
  set('text-subtle', tok('--text-faint') || f(.32))
  set('bg', tok('--bg') || `rgb(${rd(bgc[0])},${rd(bgc[1])},${rd(bgc[2])})`)
  set('elev', tok('--bg-card') || tok('--bg') || `rgb(${rd(bgc[0])},${rd(bgc[1])},${rd(bgc[2])})`)
  set('surf', tok('--bg-card') || f(.045))
  set('surf-sub', tok('--overlay-subtle') || f(.025))
  set('sidebar', tok('--sidebar-bg') || f(.03))
  set('input', tok('--overlay-light') || f(.05))
  set('hover', tok('--overlay-medium') || f(.08))
  set('border', tok('--border') || f(.16))
  set('border-sub', tok('--overlay-medium') || f(.09))
  set('fill', accent)
  set('fill-hover', tok('--accent-hover') || accent)
  set('on-fill', tok('--on-accent') || onColorOf(arc))
  set('primary', readableOn(arc, bgc, rgb))
  set('glow', af(.22))
  set('tint', tok('--accent-light') || af(.13))
  set('danger', tok('--danger') || (dark ? '#e08a7d' : '#b03a2e'))
  set('ok', dark ? '#8fc7a0' : '#2e7d4f')
  set('shadow', tok('--card-shadow') || (dark ? '0 4px 20px rgba(0,0,0,.4)' : '0 2px 12px rgba(0,0,0,.08)'))
}
function themeObserver(root) {
  syncTheme(root)
  const ob = new MutationObserver(() => syncTheme(root))
  for (let n = root.parentElement; n; n = n.parentElement) ob.observe(n, { attributes: true, attributeFilter: ['class', 'data-mode', 'data-theme', 'style'] })
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
  const onMq = () => syncTheme(root)
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq)
  return () => { ob.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq) }
}

const STYLE = `
.zt-root{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;background:var(--zt-bg);font-size:13px;line-height:1.5}
.zt-root *,.zt-layer *{box-sizing:border-box}
.zt-root ::-webkit-scrollbar{width:6px;height:6px}.zt-root ::-webkit-scrollbar-thumb{background:var(--zt-border);border-radius:3px}
.zt-cols{flex:1;min-height:0;display:flex}
.zt-side{flex:0 0 252px;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--zt-border-sub);background:var(--zt-sidebar);overflow:auto;padding:10px}
.zt-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto;padding:14px}
.zt-btn{padding:7px 12px;font:inherit;color:var(--zt-text-sec);border:1px solid var(--zt-border);border-radius:11px;background:var(--zt-surf);cursor:pointer;transition:background .2s,border-color .2s,color .2s;white-space:nowrap}
.zt-btn:hover:not(:disabled){background:var(--zt-tint);border-color:var(--zt-primary);color:var(--zt-primary)}
.zt-btn:active:not(:disabled){transform:scale(.98)}
.zt-btn:disabled{opacity:.5;cursor:default}
.zt-btn.primary{color:var(--zt-on-fill);background:var(--zt-fill);border-color:transparent;font-weight:500}
.zt-btn.primary:hover:not(:disabled){background:var(--zt-fill-hover);color:var(--zt-on-fill);border-color:transparent}
.zt-btn.ghost{background:transparent;color:var(--zt-text-sec);border-color:transparent}
.zt-btn.ghost:hover:not(:disabled){background:var(--zt-hover);color:var(--zt-text);border-color:transparent}
.zt-btn.sm{padding:4px 9px;font-size:12px;border-radius:8px}
.zt-input{width:100%;padding:8px 11px;font:inherit;color:var(--zt-text);background:var(--zt-input);border:1.5px solid var(--zt-border);border-radius:11px;outline:none;transition:border-color .2s,box-shadow .2s}
.zt-input::placeholder{color:var(--zt-text-subtle)}
.zt-input:focus{border-color:var(--zt-primary);box-shadow:0 0 0 3px var(--zt-glow)}
.zt-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--zt-text-muted);margin:12px 2px 6px}
.zt-muted{color:var(--zt-text-muted)}
.zt-empty{padding:30px 12px;text-align:center;color:var(--zt-text-subtle);font-size:12.5px}
.zt-conn{border-radius:12px;border:1px solid var(--zt-border-sub);background:var(--zt-surf);padding:10px 11px;font-size:12px}
.zt-conn .hd{display:flex;align-items:center;gap:7px}
.zt-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--zt-text-subtle)}
.zt-dot.ok{background:var(--zt-ok)}
.zt-dot.bad{background:var(--zt-danger)}
.zt-dot.spin{border:2px solid var(--zt-border);border-top-color:var(--zt-primary);background:transparent;animation:ztspin 1s linear infinite}
@keyframes ztspin{to{transform:rotate(360deg)}}
.zt-conn .steps{margin:8px 0 0;padding-left:16px;color:var(--zt-text-muted);font-size:11.5px}
.zt-conn .steps li{margin:3px 0}
.zt-conn .err{margin-top:6px;color:var(--zt-danger);font-size:11px;word-break:break-all}
.zt-fold{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:9px;cursor:pointer;color:var(--zt-text-sec);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zt-fold:hover{background:var(--zt-hover)}
.zt-fold.active{background:var(--zt-tint);color:var(--zt-primary)}
.zt-fold .nm{overflow:hidden;text-overflow:ellipsis}
.zt-item{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border-radius:12px;border:1px solid var(--zt-border-sub);background:var(--zt-surf);cursor:pointer;margin-top:8px;transition:border-color .2s,background .2s}
.zt-item:hover{border-color:var(--zt-primary);background:var(--zt-tint)}
.zt-item .mid{flex:1;min-width:0}
.zt-item .ttl{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}
.zt-item .sub{font-size:11px;color:var(--zt-text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zt-badge{display:inline-block;flex:0 0 auto;font-size:10px;font-weight:600;padding:1px 8px;border-radius:9999px;white-space:nowrap;background:var(--zt-tint);color:var(--zt-primary)}
.zt-listhd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.zt-listhd .cap{font-weight:600;font-size:14px}
.zt-warn{margin-top:8px;font-size:11.5px;color:var(--zt-text-muted);background:var(--zt-surf-sub);border:1px solid var(--zt-border-sub);border-radius:9px;padding:5px 9px}
.zt-dhd{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.zt-dhd .ttl{flex:1;min-width:0;font-weight:600;font-size:15px;line-height:1.4}
.zt-metacard{border-radius:12px;border:1px solid var(--zt-border-sub);background:var(--zt-surf);padding:10px 12px;margin-bottom:12px}
.zt-metarow{display:flex;gap:10px;padding:2.5px 0;font-size:12.5px}
.zt-metarow .lbl{flex:0 0 44px;color:var(--zt-text-muted)}
.zt-metarow .val{flex:1;min-width:0;word-break:break-word}
.zt-metarow a{color:var(--zt-primary)}
.zt-abs{border-radius:12px;border:1px solid var(--zt-border-sub);background:var(--zt-surf-sub);padding:10px 12px;margin-bottom:12px;font-size:12.5px;line-height:1.65;color:var(--zt-text-sec);max-height:180px;overflow:auto;white-space:pre-wrap}
.zt-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.zt-annline{margin-top:10px;font-size:11.5px;color:var(--zt-text-muted)}
.zt-aiprog{margin-top:10px;font-size:11.5px;color:var(--zt-text-muted);font-variant-numeric:tabular-nums}
.zt-aiprog.err{color:var(--zt-danger)}
.zt-layer{position:fixed;inset:0;z-index:9999;pointer-events:none;color:var(--zt-text);font-size:13px;line-height:1.5}
.zt-backdrop{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.25)}
.zt-modal{position:absolute;left:50%;top:10%;transform:translateX(-50%);width:min(600px,92vw);max-height:74vh;display:flex;flex-direction:column;pointer-events:auto;background:var(--zt-elev);border:1px solid var(--zt-border);border-radius:14px;box-shadow:var(--zt-shadow);padding:14px}
.zt-modal .zt-label{margin-top:0}
.zt-picklist{flex:1;min-height:0;overflow:auto;margin-top:4px}
.zt-pickhint{margin-top:8px;font-size:11.5px;color:var(--zt-text-subtle)}
`

// ── XSS 安全的 DOM 拼装(Zotero 数据一律 textContent;check.mjs 直测这两个) ──
function buildItemRow(item, opts) {
  const o = opts || {}
  const row = document.createElement('div')
  row.className = 'zt-item'
  const mid = document.createElement('div')
  mid.className = 'mid'
  const ttl = document.createElement('div')
  ttl.className = 'ttl'
  ttl.textContent = item.title
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = [item.authors, item.year, item.journal].filter(Boolean).join(' · ') || item.itemType || ''
  mid.appendChild(ttl)
  mid.appendChild(sub)
  row.appendChild(mid)
  if (o.hasNote) {
    const b = document.createElement('span')
    b.className = 'zt-badge'
    b.textContent = '笔记'
    row.appendChild(b)
  }
  if (o.onClick) row.addEventListener('click', o.onClick)
  return row
}
function buildDetailCard(item) {
  const card = document.createElement('div')
  card.className = 'zt-metacard'
  const add = (label, value, href) => {
    if (!value) return
    const r = document.createElement('div')
    r.className = 'zt-metarow'
    const l = document.createElement('span')
    l.className = 'lbl'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'val'
    const h = safeHref(href || '')
    if (h) {
      const a = document.createElement('a')
      a.textContent = value
      a.setAttribute('href', h)
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
      v.appendChild(a)
    } else v.textContent = value
    r.appendChild(l)
    r.appendChild(v)
    card.appendChild(r)
  }
  add('作者', item.authors)
  add('年份', item.year)
  add('期刊', item.journal)
  add('DOI', item.doi, item.doi ? 'https://doi.org/' + encodeURI(item.doi) : '')
  add('链接', item.url, item.url)
  add('收录', (item.dateAdded || '').slice(0, 10))
  add('类型', item.itemType)
  return card
}

// ══ 工作台视图(单视图两栏) ═══════════════════════════════════════════════
function mountLibrary(el) {
  el.innerHTML = ''
  ensureStyle()
  const root = document.createElement('div')
  root.className = 'zt-root'
  el.appendChild(root)
  const offTheme = themeObserver(root)

  const S = {
    conn: 'checking', connErr: '',
    cols: [], colKey: '', colName: '全部条目',
    query: '', items: [], loading: true, listErr: '', truncated: false,
    detail: null, children: null, childrenLoading: false, childrenErr: '',
    noteState: null, // {hasNote, notePath, noteName, imported}
    index: { notes: {} },
    aiBusy: false,
  }
  let reqSeq = 0
  let childSeq = 0
  let noteSeq = 0
  let connSeq = 0
  let searchTimer = null
  let aiController = null

  root.innerHTML = `
<div class="zt-cols">
  <div class="zt-side">
    <div class="zt-conn" data-conn></div>
    <div class="zt-label">检索</div>
    <input class="zt-input" data-search placeholder="标题 / 作者…" />
    <div class="zt-label">集合</div>
    <div data-cols></div>
  </div>
  <div class="zt-main" data-main></div>
</div>`
  const $ = (s) => root.querySelector(s)
  const connEl = $('[data-conn]')
  const colsEl = $('[data-cols]')
  const mainEl = $('[data-main]')
  const searchEl = $('[data-search]')

  // ── 左栏:连接状态卡 ──
  function renderConn() {
    connEl.textContent = ''
    const hd = document.createElement('div')
    hd.className = 'hd'
    const dot = document.createElement('span')
    dot.className = 'zt-dot ' + (S.conn === 'ok' ? 'ok' : S.conn === 'down' ? 'bad' : 'spin')
    const tx = document.createElement('span')
    tx.textContent = S.conn === 'ok' ? `已连接 Zotero(端口 ${portOf()})` : S.conn === 'down' ? '未连接 Zotero' : '正在连接 Zotero…'
    hd.appendChild(dot)
    hd.appendChild(tx)
    connEl.appendChild(hd)
    if (S.conn === 'down') {
      const steps = document.createElement('ol')
      steps.className = 'steps'
      for (const s of ['打开 Zotero 7 桌面端', '设置 → 高级 → 勾选「允许本机其他应用与 Zotero 通信」', '端口改过的话,到本插件设置里同步改(当前 ' + portOf() + ')']) {
        const li = document.createElement('li')
        li.textContent = s
        steps.appendChild(li)
      }
      connEl.appendChild(steps)
      if (S.connErr) {
        const er = document.createElement('div')
        er.className = 'err'
        er.textContent = S.connErr
        connEl.appendChild(er)
      }
    }
    // checking 态也给按钮:ztGet 已有 5s 超时闸,但恢复入口不该依赖它(connSeq 保证重入安全)
    const btn = document.createElement('button')
    btn.className = 'zt-btn sm'
    btn.textContent = S.conn === 'ok' ? '刷新' : '重试连接'
    btn.style.marginTop = '8px'
    btn.addEventListener('click', refreshConn)
    connEl.appendChild(btn)
  }

  // ── 左栏:集合树 ──
  function renderCols() {
    colsEl.textContent = ''
    const mk = (key, name, depth, active) => {
      const d = document.createElement('div')
      d.className = 'zt-fold' + (active ? ' active' : '')
      d.style.paddingLeft = `${8 + depth * 14}px`
      const nm = document.createElement('span')
      nm.className = 'nm'
      nm.textContent = name
      d.appendChild(nm)
      d.addEventListener('click', () => {
        S.colKey = key
        S.colName = name
        S.query = ''
        searchEl.value = ''
        renderCols()
        loadItems()
      })
      return d
    }
    colsEl.appendChild(mk('', '全部条目', 0, !S.colKey && !S.query))
    for (const c of collectionTree(S.cols)) colsEl.appendChild(mk(c.key, c.name, c.depth + 1, S.colKey === c.key && !S.query))
    if (!S.cols.length && S.conn === 'ok') {
      const d = document.createElement('div')
      d.className = 'zt-empty'
      d.textContent = 'Zotero 里还没有集合'
      colsEl.appendChild(d)
    }
  }

  // ── 右栏 ──
  function renderMain() {
    if (S.detail) { renderDetail(); return }
    mainEl.textContent = ''
    if (S.conn === 'checking') { emptyMain('正在连接本机 Zotero…'); return }
    if (S.conn === 'down') {
      const box = document.createElement('div')
      box.className = 'zt-empty'
      const b1 = document.createElement('div')
      b1.textContent = '未连接到本机 Zotero'
      const b2 = document.createElement('div')
      b2.className = 'zt-muted'
      b2.textContent = '按左栏步骤开启 Zotero 的本地 API 后点「重试连接」。文献数据全程只在本机流动。'
      b2.style.marginTop = '6px'
      box.appendChild(b1)
      box.appendChild(b2)
      mainEl.appendChild(box)
      return
    }
    // 列表头
    const hd = document.createElement('div')
    hd.className = 'zt-listhd'
    const cap = document.createElement('span')
    cap.className = 'cap'
    cap.textContent = S.query ? `检索「${S.query}」` : S.colName
    hd.appendChild(cap)
    const cnt = document.createElement('span')
    cnt.className = 'zt-muted'
    cnt.textContent = S.loading ? '加载中…' : `${S.items.length} 条`
    hd.appendChild(cnt)
    mainEl.appendChild(hd)
    if (S.listErr) { warnLine(`加载失败:${S.listErr}`); return }
    if (S.loading) return
    if (S.truncated) warnLine('只显示前 100 条,请用检索缩小范围(v1 不翻页)。')
    if (!S.items.length) { emptyMain(S.query ? '没有找到匹配的文献' : '此集合暂无条目'); return }
    for (const it of S.items) {
      mainEl.appendChild(buildItemRow(it, { hasNote: !!S.index.notes[it.key], onClick: () => openDetail(it) }))
    }
  }
  function emptyMain(text) {
    const d = document.createElement('div')
    d.className = 'zt-empty'
    d.textContent = text
    mainEl.appendChild(d)
  }
  function warnLine(text) {
    const w = document.createElement('div')
    w.className = 'zt-warn'
    w.textContent = text
    mainEl.appendChild(w)
  }

  // ── 条目详情 ──
  function openDetail(item) {
    S.detail = item
    S.children = null
    S.childrenLoading = true
    S.childrenErr = ''
    S.noteState = null
    renderMain()
    const seq = ++childSeq
    ztGet(qChildren(item.key)).then((r) => {
      if (seq !== childSeq || S.detail !== item) return
      S.childrenLoading = false
      S.children = r.ok ? r.data : null
      S.childrenErr = r.ok ? '' : r.error
      renderMain()
    })
    loadNoteState(item)
  }
  async function loadNoteState(item) {
    const seq = ++noteSeq
    const idx = await readIndex()
    let st = { hasNote: false, notePath: '', noteName: '', imported: 0 }
    const e = idx.notes[item.key]
    if (e && typeof e.path === 'string' && ctx.app.readFile) {
      const t = await ctx.app.readFile(e.path)
      if (t != null) st = { hasNote: true, notePath: e.path, noteName: baseNameOf(e.path), imported: extractZannKeys(t).size }
    }
    if (seq !== noteSeq || S.detail !== item) return
    S.index = idx
    S.noteState = st
    renderMain()
  }
  function renderDetail() {
    const item = S.detail
    mainEl.textContent = ''
    const hd = document.createElement('div')
    hd.className = 'zt-dhd'
    const back = document.createElement('button')
    back.className = 'zt-btn ghost sm'
    back.textContent = '← 返回'
    back.addEventListener('click', () => { S.detail = null; renderMain() })
    const ttl = document.createElement('div')
    ttl.className = 'ttl'
    ttl.textContent = item.title
    hd.appendChild(back)
    hd.appendChild(ttl)
    mainEl.appendChild(hd)
    mainEl.appendChild(buildDetailCard(item))
    // 摘要
    const absLabel = document.createElement('div')
    absLabel.className = 'zt-label'
    absLabel.textContent = '摘要'
    mainEl.appendChild(absLabel)
    const abs = document.createElement('div')
    abs.className = 'zt-abs'
    abs.textContent = item.abstract || '(无摘要)'
    mainEl.appendChild(abs)
    // 动作行
    const acts = document.createElement('div')
    acts.className = 'zt-acts'
    mainEl.appendChild(acts)
    const st = S.noteState
    const btn = (label, cls, fn) => {
      const b = document.createElement('button')
      b.className = `zt-btn ${cls || ''}`.trim()
      b.textContent = label
      b.addEventListener('click', () => fn(b))
      acts.appendChild(b)
      return b
    }
    btn(st && st.hasNote ? '打开阅读笔记' : '创建阅读笔记', 'primary', actNote)
    btn('导入划线批注', '', actImport)
    btn(hasBlockSurface() ? '插入引用' : '复制引用', '', actCite)
    const pdfKey = findPdfAttachment(S.children)
    if (pdfKey) btn('在 Zotero 打开 PDF', '', () => { openZoteroUri(`zotero://open-pdf/library/items/${encodeURIComponent(pdfKey)}`) })
    // AI 读文献:有阅读笔记,且(已导入批注 或 有摘要)才可点
    const aiReady = !!(st && st.hasNote && (st.imported > 0 || item.abstract))
    const aiBtn = btn(S.aiBusy ? 'AI 生成中…' : 'AI 读文献', '', actAi)
    aiBtn.disabled = S.aiBusy || !aiReady
    if (!aiReady) aiBtn.title = st && st.hasNote ? '先「导入划线批注」(或该文献需要有摘要)' : '先创建阅读笔记并导入批注'
    // 批注/笔记状态行
    const info = document.createElement('div')
    info.className = 'zt-annline'
    const annCount = S.children ? parseAnnotations(S.children).length : 0
    const parts = []
    parts.push(S.childrenLoading ? '正在读取附件与批注…' : S.childrenErr ? `附件读取失败:${S.childrenErr}` : `Zotero 内划线/批注 ${annCount} 条${pdfKey ? ' · 有 PDF 附件' : ' · 无 PDF 附件'}`)
    if (st) parts.push(st.hasNote ? `阅读笔记:${st.noteName}(已导入 ${st.imported} 条)` : '还没有阅读笔记')
    info.textContent = parts.join(' ｜ ')
    mainEl.appendChild(info)
    const prog = document.createElement('div')
    prog.className = 'zt-aiprog'
    prog.setAttribute('data-aiprog', '')
    mainEl.appendChild(prog)
  }

  // ── 动作 ──
  async function actNote(b) {
    b.disabled = true
    try {
      const n = await ensureNote(S.detail)
      const shown = openNoteInEditor(n.path) // 绝不 openFile:裸 .md 会被系统默认程序抢走
      say(n.created ? `已创建阅读笔记「${n.name}」` : shown ? '已在编辑器打开阅读笔记' : `阅读笔记在 ${n.path}`, { level: 'success' })
      loadNoteState(S.detail)
    } catch (e) {
      say(`阅读笔记失败:${(e && e.message) || e}`, { level: 'error' })
    } finally { b.disabled = false }
  }
  async function actImport(b) {
    b.disabled = true
    const old = b.textContent
    b.textContent = '导入中…'
    try {
      const r = await importAnnotations(S.detail)
      if (!r.total) say('这条文献在 Zotero 里还没有划线/批注(先在 Zotero 里读 PDF 划几条)', { level: 'warning' })
      else if (r.added) say(`新增 ${r.added} 条划线批注`, { level: 'success' })
      else say('没有新增,划线批注都已导入过', { level: 'info' })
      loadNoteState(S.detail)
    } catch (e) {
      say(`导入失败:${(e && e.message) || e}`, { level: 'error' })
    } finally { b.disabled = false; b.textContent = old }
  }
  async function actCite(b) {
    b.disabled = true
    try {
      const st = S.noteState
      await insertCite(S.detail, st && st.hasNote ? st.noteName : citeName(S.detail))
    } finally { b.disabled = false }
  }
  async function actAi() {
    if (S.aiBusy) return
    const item = S.detail
    const st = S.noteState
    if (!st || !st.hasNote) return
    S.aiBusy = true
    renderMain()
    const prog = mainEl.querySelector('[data-aiprog]')
    const setP = (t, err) => { const p = mainEl.querySelector('[data-aiprog]') || prog; if (p) { p.textContent = t; p.className = 'zt-aiprog' + (err ? ' err' : '') } }
    if (aiController) aiController.abort()
    aiController = new AbortController()
    const sig = aiController.signal
    try {
      setP('正在把摘要与划线交给 AI…')
      const cfg = await getCfg()
      if (!cfg.backendUrl || !cfg.token) throw new Error(cfg.backendUrl ? '请先登录 Forsion' : '未连接到 Tangu 引擎')
      const noteText = (await ctx.app.readFile(st.notePath)) || ''
      const out = await runAgent(cfg, uuid(), buildLitreviewMessage(noteText, item.abstract), (full) => setP(`AI 生成中… ${full.length} 字`), sig)
      const review = parseLitreview(out)
      if (!review.trim()) throw new Error('模型没有返回内容')
      const md = (await ctx.app.readFile(st.notePath)) || ''
      await writeNote(st.notePath, upsertAiSection(md, `${review}\n\n> 由 Forsion AI 于 ${today()} 生成,仅基于摘要与已导入划线。`))
      say('AI 速览已写入阅读笔记', { level: 'success' })
      setP('')
      openNoteInEditor(st.notePath) // 绝不 openFile:裸 .md 会被系统默认程序抢走
    } catch (e) {
      if (!sig.aborted) { const msg = (e && e.message) || String(e); say(`AI 读文献失败:${msg}`, { level: 'error' }); setP(`失败:${msg}`, true) }
    } finally {
      S.aiBusy = false
      // 运行中可能已切去另一条文献的详情:只要还在详情页就重渲染(渲染读的是当前 S.detail,
      // 不会串台),否则新详情的 AI 按钮会停在「AI 生成中…」disabled 态直到用户离开再回来。
      if (S.detail) { renderMain(); loadNoteState(S.detail) }
    }
  }

  // ── 数据加载 ──
  async function refreshConn() {
    const seq = ++connSeq // 重入安全:checking 态也有重试按钮,迟到的旧结果不得覆盖新一轮
    S.conn = 'checking'
    S.connErr = ''
    renderConn()
    renderMain()
    const r = await ztGet(qConn())
    if (seq !== connSeq) return
    S.conn = r.ok ? 'ok' : 'down'
    S.connErr = r.ok ? '' : r.error
    renderConn()
    if (r.ok) {
      loadCollections()
      loadItems()
    } else {
      S.items = []
      S.loading = false
      renderMain()
    }
  }
  async function loadCollections() {
    // 与本轮 refreshConn 同号:连点「重试连接/刷新」时,迟到的旧集合响应(尤其失败的)
    // 不得覆盖新一轮结果——refreshConn 的 connSeq 只挡它自身,挡不到派生的这条。
    const seq = connSeq
    const r = await ztGet(qCollections())
    if (seq !== connSeq) return
    S.cols = r.ok ? parseCollections(r.data) : []
    renderCols()
  }
  async function loadItems() {
    const seq = ++reqSeq
    S.loading = true
    S.listErr = ''
    S.detail = null
    renderMain()
    const path = S.query ? qSearch(S.query) : S.colKey ? qColItems(S.colKey) : qAllItems()
    const r = await ztGet(path)
    if (seq !== reqSeq) return
    S.loading = false
    if (!r.ok) {
      S.items = []
      S.truncated = false
      S.listErr = r.error
    } else {
      S.items = parseItems(r.data)
      S.truncated = r.data.length >= 100
    }
    renderMain()
  }

  searchEl.addEventListener('input', () => {
    S.query = searchEl.value.trim()
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { if (S.conn === 'ok') { renderCols(); loadItems() } }, 300)
  })
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; S.query = ''; renderCols(); if (S.conn === 'ok') loadItems() }
  })

  renderConn()
  renderCols()
  renderMain()
  healIndex().then((idx) => { S.index = idx; if (!S.detail) renderMain() }) // 打开时索引自愈
  refreshConn()

  return () => {
    offTheme()
    if (searchTimer) clearTimeout(searchTimer)
    if (aiController) aiController.abort()
    reqSeq++; childSeq++; noteSeq++; connSeq++
  }
}

// ══ 插入引用(检索)命令:检索选择浮层(.zt-layer) ══════════════════════════
function openCitePicker() {
  const ly = layer()
  if (!ly) return
  closeOverlays()
  syncTheme((globalThis.document && document.querySelector && document.querySelector('.zt-root')) || document.body)
  const backdrop = document.createElement('div')
  backdrop.className = 'zt-backdrop'
  backdrop.addEventListener('click', closeOverlays)
  ly.appendChild(backdrop)
  const box = document.createElement('div')
  box.className = 'zt-modal'
  const cap = document.createElement('div')
  cap.className = 'zt-label'
  cap.textContent = hasBlockSurface() ? '插入引用 · 检索 Zotero' : '复制引用 · 检索 Zotero(当前宿主不支持直接插入)'
  const inp = document.createElement('input')
  inp.className = 'zt-input'
  inp.placeholder = '标题 / 作者…(Enter 检索,Esc 关闭)'
  const list = document.createElement('div')
  list.className = 'zt-picklist'
  const hint = document.createElement('div')
  hint.className = 'zt-pickhint'
  hint.textContent = '输入检索词,选中一条即插入引用块到当前打开的笔记。'
  let seq = 0
  async function search() {
    const q = inp.value.trim()
    if (!q) { hint.textContent = '输入检索词后回车。'; return }
    const my = ++seq
    hint.textContent = '检索中…'
    list.textContent = ''
    const r = await ztGet(qSearch(q))
    if (my !== seq) return
    if (!r.ok) { hint.textContent = `未连接 Zotero:${r.error}(先开 Zotero → 设置 → 高级 → 允许本地 API)`; return }
    const items = parseItems(r.data)
    if (!items.length) { hint.textContent = '没有找到匹配的文献。'; return }
    hint.textContent = r.data.length >= 100 ? '结果超过 100 条,只显示前 50,请再缩小检索词。' : `${items.length} 条结果,点选即插入。`
    for (const it of items.slice(0, 50)) {
      list.appendChild(buildItemRow(it, {
        onClick: async () => {
          closeOverlays()
          const idx = await readIndex()
          const e = idx.notes[it.key]
          await insertCite(it, e && e.path ? baseNameOf(e.path) : citeName(it))
        },
      }))
    }
  }
  inp.addEventListener('input', () => {
    if (_pickerTimer) clearTimeout(_pickerTimer)
    _pickerTimer = setTimeout(search, 350)
  })
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search()
    if (e.key === 'Escape') closeOverlays()
  })
  box.appendChild(cap)
  box.appendChild(inp)
  box.appendChild(list)
  box.appendChild(hint)
  ly.appendChild(box)
  try { inp.focus() } catch { /* ignore */ }
}

// ── 注册(id 全按 SPEC 钉死) ──
ctx.registerView?.({ id: 'library', title: '文献工作台', mount: mountLibrary, singleton: true })
ctx.registerCommand({
  id: 'zotero-open', title: '文献工作台:打开', keywords: 'zotero 文献 literature 论文 paper 引用 cite',
  run: () => { if (ctx.openView) ctx.openView('library'); else say('当前宿主版本过旧,不支持工作台视图', { level: 'warning' }) },
})
ctx.registerCommand({
  id: 'zotero-cite', title: '文献工作台:插入引用(检索)', keywords: 'zotero cite 引用 文献 citation',
  run: () => openCitePicker(),
})

if (globalThis.__ZOTERO_TEST__) {
  Object.assign(globalThis.__ZOTERO_TEST__, {
    fmVal, yearOf, lastNameOf, joinCreators, firstAuthorLast, authorCite, slugTitle, sanitizeFileName, citeName,
    parseItem, parseItems, parseCollections, collectionTree, parseAnnotations, findPdfAttachment, colorName, annLines,
    buildNoteMd, parseNoteMeta, extractZannKeys, splitMyNotes, mergeAnnotations, upsertAiSection, buildCitation,
    buildLitreviewMessage, parseLitreview, today, safeHref, portOf, apiBase, qConn, qAllItems, qSearch, qCollections, qColItems, qChildren,
    ztGet, readIndex, writeIndex, healIndex, ensureNote, importAnnotations, insertCite, hasBlockSurface, baseNameOf,
    stripZann, openNoteInEditor, writeNote, openZoteroUri, fmQ,
    buildItemRow, buildDetailCard, onColorOf, readableOn, contrast,
  })
}

return () => {
  closeOverlays()
  try { if (_layer && _layer.remove) _layer.remove() } catch { /* ignore */ }
  _layer = null
  try { if (_styleEl && _styleEl.remove) _styleEl.remove() } catch { /* ignore */ }
  _styleEl = null
}
