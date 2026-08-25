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
 * 双语:UI 文案全部走 MSG/t(),ctx.subscribeLocale 即时重渲(视图不重挂也变);
 *   **笔记数据契约恒中文**(节标题「## 划线与批注」/「## 我的笔记」/「## AI 速览」、批注行、引用块)——
 *   它们是磁盘格式与正则锚点,跟语言走会毁掉已有笔记的幂等与解析。
 */
const PLUGIN_ID = 'zotero'
const APP_ID = 'tangu'
const DEFAULT_PORT = 23119
const DEFAULT_FOLDER = '文献工作台'

// ── 双语词表(两侧键集合必须完全相等;check.mjs 断言它) ────────────────────────
// 占位符一律 {name} 形式(英文语序与中文不同,不能靠模板串拼)。
const MSG = {
  zh: {
    view_title: '文献工作台',
    cmd_open: '文献工作台:打开',
    cmd_cite: '文献工作台:插入引用(检索)',
    set_port_label: 'Zotero 本地 API 端口',
    set_port_desc: 'Zotero 7 本地 API 端口(默认 23119)。改了 Zotero 的端口才需要改这里。',
    set_style_label: '阅读笔记命名风格',
    set_style_desc: '目前仅支持 author-year(首作者姓+年份+标题 slug),预留扩展。',
    lbl_search: '检索',
    lbl_collections: '集合',
    search_ph: '标题 / 作者…',
    all_items: '全部条目',
    no_collections: 'Zotero 里还没有集合',
    conn_ok: '已连接 Zotero(端口 {port})',
    conn_down: '未连接 Zotero',
    conn_checking: '正在连接 Zotero…',
    conn_step1: '打开 Zotero 7 桌面端',
    conn_step2: '设置 → 高级 → 勾选「允许本机其他应用与 Zotero 通信」',
    conn_step3: '端口改过的话,到本插件设置里同步改(当前 {port})',
    btn_refresh: '刷新',
    btn_retry: '重试连接',
    main_connecting: '正在连接本机 Zotero…',
    main_down_title: '未连接到本机 Zotero',
    main_down_hint: '按左栏步骤开启 Zotero 的本地 API 后点「重试连接」。文献数据全程只在本机流动。',
    list_search_cap: '检索「{q}」',
    list_loading: '加载中…',
    list_count: '{n} 条',
    list_err: '加载失败:{msg}',
    list_truncated: '只显示前 100 条,请用检索缩小范围。',
    list_nohit: '没有找到匹配的文献',
    list_empty_col: '此集合暂无条目',
    badge_note: '笔记',
    btn_back: '← 返回',
    lbl_abstract: '摘要',
    no_abstract: '(无摘要)',
    meta_authors: '作者',
    meta_year: '年份',
    meta_journal: '期刊',
    meta_doi: 'DOI',
    meta_url: '链接',
    meta_added: '收录',
    meta_type: '类型',
    btn_open_note: '打开阅读笔记',
    btn_new_note: '创建阅读笔记',
    btn_import: '导入划线批注',
    btn_importing: '导入中…',
    btn_cite: '插入引用',
    btn_copy_cite: '复制引用',
    btn_copy_bib: '复制 BibTeX',
    btn_copy_csl: '复制 CSL-JSON',
    btn_export: '导出 .bib / .csl.json',
    btn_exporting: '导出中…',
    btn_open_pdf: '在 Zotero 打开 PDF',
    btn_ai: 'AI 读文献',
    btn_ai_busy: 'AI 生成中…',
    ai_tip_need_import: '先「导入划线批注」(或该文献需要有摘要)',
    ai_tip_need_note: '先创建阅读笔记并导入批注',
    info_children_loading: '正在读取附件与批注…',
    info_children_err: '附件读取失败:{msg}',
    info_ann_count: 'Zotero 内划线/批注 {n} 条',
    info_has_pdf: ' · 有 PDF 附件',
    info_no_pdf: ' · 无 PDF 附件',
    info_note: '阅读笔记:{name}(已导入 {n} 条)',
    info_no_note: '还没有阅读笔记',
    info_sep: ' ｜ ',
    msg_note_created: '已创建阅读笔记「{name}」',
    msg_note_opened: '已在编辑器打开阅读笔记',
    msg_note_at: '阅读笔记在 {path}',
    msg_note_fail: '阅读笔记失败:{msg}',
    msg_no_ann: '这条文献在 Zotero 里还没有划线/批注(先在 Zotero 里读 PDF 划几条)',
    msg_ann_added: '新增 {n} 条划线批注',
    msg_ann_none_new: '没有新增,划线批注都已导入过',
    msg_ann_truncated: 'Zotero 只回了前 100 条子对象(上限,不是总数):这篇的划线批注可能还有没导进来的,本版不翻页。',
    msg_import_fail: '导入失败:{msg}',
    msg_cite_inserted: '已插入引用',
    msg_cite_copied: '已复制引用到剪贴板(当前宿主版本不支持直接插入)',
    msg_cite_copyfail: '复制引用失败',
    msg_cite_nopage: '先在编辑器里打开一篇笔记,再插入引用',
    msg_cite_stale: '插入失败:页面已切换,请重试',
    msg_bib_copied: '已复制 BibTeX 到剪贴板',
    msg_csl_copied: '已复制 CSL-JSON 到剪贴板',
    msg_copy_fail: '复制失败:{msg}',
    msg_export_done: '已导出 {n} 条到 {bib} 与 {csl}',
    msg_export_same: '内容没有变化,{bib} 已是最新',
    msg_export_fail: '导出失败:{msg}',
    msg_export_readfail: '读不出已有的导出文件,已中止(没有覆写任何文件):{msg}',
    msg_note_readfail: '读不出这篇笔记({path}),已中止(没有覆写任何文件):{msg}',
    err_read_listed: '文件在库里,但这一刻读不回来',
    msg_export_nofs: '当前宿主版本不支持文件读写,无法导出',
    msg_export_taken: '同名导出文件过多(「{base}」序号已占满),请清理后重试',
    export_truncated_hint: '当前列表已截断到前 100 条,导出的也只有这 100 条。',
    msg_view_unsupported: '当前宿主版本过旧,不支持工作台视图',
    msg_uri_copied: '当前宿主不能直接唤起 Zotero,已复制链接,请粘到 Zotero 或浏览器地址栏:{uri}',
    msg_uri_blocked: '当前宿主不能直接唤起 Zotero,请手动打开:{uri}',
    ai_start: '正在把摘要与划线交给 AI…',
    ai_streaming: 'AI 生成中… {n} 字',
    ai_done: 'AI 速览已写入阅读笔记',
    ai_fail: 'AI 读文献失败:{msg}',
    ai_fail_short: '失败:{msg}',
    ai_footer: '> 由 Forsion AI 于 {date} 生成,仅基于摘要与已导入划线。',
    err_login: '请先登录 Forsion',
    err_engine: '未连接到 Tangu 引擎',
    err_empty_model: '模型没有返回内容',
    err_run_start: '起 run 失败 HTTP {code}',
    err_no_runid: '引擎未返回 runId',
    err_sub: '订阅事件失败 HTTP {code}',
    err_ai_generic: 'AI 生成失败',
    err_stream_cut: '与引擎的连接中断,未收到完成事件(可重试)',
    err_no_fs: '当前宿主版本不支持文件读写,无法创建阅读笔记',
    err_name_taken: '同名笔记过多(「{base}」序号已占满),请清理重名文件或改标题后重试',
    err_ann_fetch: '取批注失败:{msg}',
    err_not_array: '响应不是数组(不是 Zotero 本地 API?)',
    err_no_clipboard: '无剪贴板',
    pick_cap_insert: '插入引用 · 检索 Zotero',
    pick_cap_copy: '复制引用 · 检索 Zotero(当前宿主不支持直接插入)',
    pick_ph: '标题 / 作者…(Enter 检索,Esc 关闭)',
    pick_hint: '输入检索词,选中一条即插入引用块到当前打开的笔记。',
    pick_hint_enter: '输入检索词后回车。',
    pick_searching: '检索中…',
    pick_err: '未连接 Zotero:{msg}(先开 Zotero → 设置 → 高级 → 允许本地 API)',
    pick_nohit: '没有找到匹配的文献。',
    pick_truncated: '结果超过 100 条,只显示前 50,请再缩小检索词。',
    pick_count: '{n} 条结果,点选即插入。',
    untitled: '(无标题)',
    unnamed_col: '(未命名)',
    authors_more: '{names} 等',
  },
  en: {
    view_title: 'Literature Workbench',
    cmd_open: 'Literature Workbench: Open',
    cmd_cite: 'Literature Workbench: Insert Citation (Search)',
    set_port_label: 'Zotero local API port',
    set_port_desc: 'Port of the Zotero 7 local API (23119 by default). Change this only if you changed the port inside Zotero.',
    set_style_label: 'Reading note naming style',
    set_style_desc: 'Only author-year is supported for now (first author surname + year + title slug); reserved for future styles.',
    lbl_search: 'Search',
    lbl_collections: 'Collections',
    search_ph: 'Title or author…',
    all_items: 'All Items',
    no_collections: 'No collections in Zotero yet',
    conn_ok: 'Connected to Zotero (port {port})',
    conn_down: 'Zotero not connected',
    conn_checking: 'Connecting to Zotero…',
    conn_step1: 'Open the Zotero 7 desktop app',
    conn_step2: 'Settings → Advanced → tick "Allow other applications on this computer to communicate with Zotero"',
    conn_step3: 'If you changed the port, update it in this plugin’s settings (currently {port})',
    btn_refresh: 'Refresh',
    btn_retry: 'Retry',
    main_connecting: 'Connecting to Zotero on this computer…',
    main_down_title: 'Not connected to Zotero',
    main_down_hint: 'Follow the steps on the left to turn on Zotero’s local API, then hit Retry. Your library data never leaves this computer.',
    list_search_cap: 'Search: {q}',
    list_loading: 'Loading…',
    list_count: '{n} item(s)',
    list_err: 'Load failed: {msg}',
    list_truncated: 'Showing the first 100 items — narrow it down with search.',
    list_nohit: 'No matching items',
    list_empty_col: 'This collection is empty',
    badge_note: 'Note',
    btn_back: '← Back',
    lbl_abstract: 'Abstract',
    no_abstract: '(No abstract)',
    meta_authors: 'Authors',
    meta_year: 'Year',
    meta_journal: 'Journal',
    meta_doi: 'DOI',
    meta_url: 'Link',
    meta_added: 'Added',
    meta_type: 'Type',
    btn_open_note: 'Open Reading Note',
    btn_new_note: 'Create Reading Note',
    btn_import: 'Import Highlights',
    btn_importing: 'Importing…',
    btn_cite: 'Insert Citation',
    btn_copy_cite: 'Copy Citation',
    btn_copy_bib: 'Copy BibTeX',
    btn_copy_csl: 'Copy CSL-JSON',
    btn_export: 'Export .bib / .csl.json',
    btn_exporting: 'Exporting…',
    btn_open_pdf: 'Open PDF in Zotero',
    btn_ai: 'AI Digest',
    btn_ai_busy: 'AI is writing…',
    ai_tip_need_import: 'Import highlights first (or the item needs an abstract)',
    ai_tip_need_note: 'Create a reading note and import highlights first',
    info_children_loading: 'Loading attachments and annotations…',
    info_children_err: 'Could not load attachments: {msg}',
    info_ann_count: '{n} highlight(s)/note(s) in Zotero',
    info_has_pdf: ' · PDF attached',
    info_no_pdf: ' · no PDF attached',
    info_note: 'Reading note: {name} ({n} imported)',
    info_no_note: 'No reading note yet',
    info_sep: ' | ',
    msg_note_created: 'Reading note “{name}” created',
    msg_note_opened: 'Reading note opened in the editor',
    msg_note_at: 'Reading note is at {path}',
    msg_note_fail: 'Reading note failed: {msg}',
    msg_no_ann: 'This item has no highlights or notes in Zotero yet — read the PDF in Zotero and highlight a few passages first',
    msg_ann_added: '{n} new highlight(s) imported',
    msg_ann_none_new: 'Nothing new — every highlight was already imported',
    msg_ann_truncated: 'Zotero returned only the first 100 child objects (a cap, not a total) — this item may have more highlights that were not imported; this version does not paginate.',
    msg_import_fail: 'Import failed: {msg}',
    msg_cite_inserted: 'Citation inserted',
    msg_cite_copied: 'Citation copied to the clipboard (this host version cannot insert directly)',
    msg_cite_copyfail: 'Could not copy the citation',
    msg_cite_nopage: 'Open a note in the editor first, then insert the citation',
    msg_cite_stale: 'Insert failed: the page changed — please try again',
    msg_bib_copied: 'BibTeX copied to the clipboard',
    msg_csl_copied: 'CSL-JSON copied to the clipboard',
    msg_copy_fail: 'Copy failed: {msg}',
    msg_export_done: 'Exported {n} item(s) to {bib} and {csl}',
    msg_export_same: 'Nothing changed — {bib} is already up to date',
    msg_export_fail: 'Export failed: {msg}',
    msg_export_readfail: 'Could not read the existing export file — export aborted, nothing was overwritten: {msg}',
    msg_note_readfail: 'Could not read this note ({path}) — aborted, nothing was overwritten: {msg}',
    err_read_listed: 'The file is in the vault but cannot be read right now',
    msg_export_nofs: 'This host version cannot write files, so export is unavailable',
    msg_export_taken: 'Too many export files share this name — “{base}” has run out of suffixes. Clean them up and retry.',
    export_truncated_hint: 'The list is capped at the first 100 items — the export contains only those 100.',
    msg_view_unsupported: 'This host version is too old for the workbench view',
    msg_uri_copied: 'This host cannot launch Zotero directly. The link is copied — paste it into Zotero or your browser address bar: {uri}',
    msg_uri_blocked: 'This host cannot launch Zotero directly. Please open it manually: {uri}',
    ai_start: 'Sending the abstract and highlights to the AI…',
    ai_streaming: 'AI is writing… {n} char(s)',
    ai_done: 'AI digest written into the reading note',
    ai_fail: 'AI digest failed: {msg}',
    ai_fail_short: 'Failed: {msg}',
    ai_footer: '> Generated by Forsion AI on {date}, from the abstract and imported highlights only.',
    err_login: 'Sign in to Forsion first',
    err_engine: 'Not connected to the Tangu engine',
    err_empty_model: 'The model returned nothing',
    err_run_start: 'Could not start the run (HTTP {code})',
    err_no_runid: 'The engine returned no runId',
    err_sub: 'Could not subscribe to run events (HTTP {code})',
    err_ai_generic: 'AI generation failed',
    err_stream_cut: 'The connection to the engine dropped before the run finished (you can retry)',
    err_no_fs: 'This host version cannot read or write files, so reading notes are unavailable',
    err_name_taken: 'Too many notes share this name (“{base}” has run out of suffixes) — clean up the duplicates or change the title, then retry',
    err_ann_fetch: 'Could not load annotations: {msg}',
    err_not_array: 'Response is not an array (is this really the Zotero local API?)',
    err_no_clipboard: 'No clipboard available',
    pick_cap_insert: 'Insert Citation · Search Zotero',
    pick_cap_copy: 'Copy Citation · Search Zotero (this host cannot insert directly)',
    pick_ph: 'Title or author… (Enter to search, Esc to close)',
    pick_hint: 'Type a query, then pick a result to insert a citation block into the note you have open.',
    pick_hint_enter: 'Type a query and press Enter.',
    pick_searching: 'Searching…',
    pick_err: 'Zotero not connected: {msg} (open Zotero → Settings → Advanced → allow the local API)',
    pick_nohit: 'No matching items.',
    pick_truncated: 'More than 100 results — showing the first 50. Please narrow your query.',
    pick_count: '{n} result(s) — click one to insert.',
    untitled: '(Untitled)',
    unnamed_col: '(Unnamed)',
    authors_more: '{names} et al.',
  },
}
/** 当前语言;旧宿主没有 getLocale → 回退中文(canonical)。 */
const L = () => { try { return ctx.getLocale && ctx.getLocale() === 'en' ? 'en' : 'zh' } catch { return 'zh' } }
function t(k, vars) {
  const d = MSG[L()] || MSG.zh
  let s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  // 英文复数:词表里写「{n} item(s)」,n===1 时抹掉 (s) 尾巴(中文侧不用量词分支,天然不受影响)。
  // ⚠️ 必须在变量代入**之前**做:{name}/{base} 代进来的是用户数据(笔记文件名由作者姓拼成,
  // 可能含 ASCII 括号),代入后再替会把用户数据里的「(abc)」也改写掉。
  if (vars && vars.n != null) s = s.replace(/\(([a-z]+)\)/g, Number(vars.n) === 1 ? '' : '$1')
  // ⚠️ **单趟**正则,未知键原样留着(BRIEF 铁律)。逐个 split/join 是错的:先替进去的值会被后面
  // 那一轮再扫一遍 —— 导出提示里的 {bib} 是由集合名/检索词拼出来的路径,用户把集合命名成
  // 「{csl}」时,他自己的数据就会被当成占位符吃掉(1.2.0 修)。
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m))
  return s
}
/** UI 里显示日期一律按当前语言格式化(磁盘上的 today() 仍是 ISO,不随语言变)。 */
function fmtDate(v) {
  const raw = String(v || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  try {
    const d = new Date(`${raw}T00:00:00`)
    if (isNaN(d.getTime())) return raw
    return d.toLocaleDateString(L() === 'zh' ? 'zh-CN' : 'en-US')
  } catch { return raw }
}
// 语言重渲注册表:切语言时视图**不重挂**也要变(BRIEF 判定标准)。
const rerenders = new Set()
const rerenderAll = () => { rerenders.forEach((f) => { try { f() } catch { /* ignore */ } }) }
const offLocale = ctx.subscribeLocale ? ctx.subscribeLocale(() => rerenderAll()) : null

// 贡献点标题是宿主单字符串面,注册时取**当时**语言;宿主不做运行时重解析(已知缺口,见 README)。
ctx.registerSetting({ key: 'port', label: t('set_port_label'), type: 'number', default: DEFAULT_PORT, min: 1, max: 65535, description: t('set_port_desc') })
ctx.registerSetting({ key: 'noteNameStyle', label: t('set_style_label'), type: 'text', default: 'author-year', description: t('set_style_desc') })

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
/** ⚠️ 语言泄漏防线(本插件最重要的不变式):**凡是会落到磁盘的串,一律不许调 t()**。
 *  文件名 / frontmatter / 引用块 / 索引 里的占位文案跟着界面语言变 = 同一条文献在中英下拥有
 *  两套磁盘身份:①索引丢失后按 citeName 认领笔记会认不到中文那篇,凭空建出第二篇,此后导入
 *  批注与 AI 速览写进新那篇,用户写在旧那篇「## 我的笔记」里的东西再也看不到;②还没建笔记就
 *  「插入引用」时,[[双链]] 用的是当时语言的名字,切回另一门语言建出的笔记名对不上 → 永久死链。
 *  所以磁盘面钉死 v1.0.0 的中文常量(与存量笔记逐字节兼容),UI 面另走 uiTitle/uiAuthors。 */
const UNTITLED_DISK = '(无标题)'
const AUTHORS_MORE_DISK = ' 等'
/** 导出产物的文件名段(同一防线):UI 面另有 t('unnamed_col') / t('all_items'),**绝不许**拿来拼文件名 ——
 *  否则英文界面导出的是 `Export-All Items.bib`、中文界面是 `导出-全部条目.bib`,同一个库里冒出两套文件,
 *  第二次导出永远撞不上第一次那份,`-2/-3` 无限增殖(1.1.1 修过的那类 bug 的第二张脸)。 */
const UNNAMED_COL_DISK = '(未命名)'
const EXPORT_PREFIX_DISK = '导出'
const EXPORT_ALL_DISK = '全部条目'
const EXPORT_SEARCH_DISK = '检索'
/** 作者串(**磁盘面**:落 zt_authors)。>8 人的省略后缀恒中文,不随界面语言变。 */
function joinCreators(creators) {
  const names = (Array.isArray(creators) ? creators : []).map(lastNameOf).filter(Boolean)
  if (!names.length) return ''
  return names.length > 8 ? `${names.slice(0, 8).join(', ')}${AUTHORS_MORE_DISK}` : names.join(', ')
}
/** 作者串(**UI 面**:跟随界面语言,英文侧 et al.)。姓名之间恒 ", " —— 文献著录惯例,中英一致,
 *  也与 zt_authors 同形,用户在界面看到的与 frontmatter 里的对得上。 */
function uiAuthors(item) {
  const names = (Array.isArray(item && item.creators) ? item.creators : []).map(lastNameOf).filter(Boolean)
  if (!names.length) return ''
  return names.length > 8 ? t('authors_more', { names: names.slice(0, 8).join(', ') }) : names.join(', ')
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
/** 标题(**磁盘面**:文件名 / zt_title / 引用块 / 索引都用它)。空标题占位恒中文常量。 */
const diskTitle = (item) => fmVal(item && item.title) || UNTITLED_DISK
/** 标题(**UI 面**:跟随界面语言)。解析时存原始值、渲染时才兜底,所以切语言即变,不必重载列表。 */
const uiTitle = (item) => fmVal(item && item.title) || t('untitled')
/** 引用名(citekey 近似)= <首作者姓><年份>-<标题前20字符slug>;重名序号由 ensureNote 探测加。 */
function citeName(item) {
  const head = (firstAuthorLast(item.creators) || 'Anon') + (item.year || '')
  return `${sanitizeFileName(head)}-${slugTitle(diskTitle(item))}`
}
function parseItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const d = r.data && typeof r.data === 'object' ? r.data : {}
  const creators = Array.isArray(d.creators) ? d.creators.filter((c) => c && typeof c === 'object') : []
  return {
    key: fmVal(r.key || d.key || ''),
    itemType: fmVal(d.itemType || ''),
    // 存**原始值**(可能是空串):占位符由 uiTitle()(界面)与 diskTitle()(磁盘)各自兜底。
    // 在这里烘 t() 有两个后果:界面语言泄进磁盘身份(见 UNTITLED_DISK 注释),且 S.items 是
    // 加载那一刻解析好的,切语言后 rerender 只重画不重解析 → 占位符卡在旧语言直到重新加载。
    title: fmVal(d.title || ''),
    creators,
    authors: joinCreators(creators),
    year: yearOf(d.date),
    journal: fmVal(d.publicationTitle || ''),
    doi: fmVal(d.DOI || ''),
    url: String(d.url || '').trim(),
    abstract: String(d.abstractNote || '').trim(),
    dateAdded: fmVal(d.dateAdded || ''),
    // ── 严格引文导出(1.2.0)才需要的字段。**只喂 .bib / .csl.json,一个都不许进 zt_* frontmatter** ——
    //    frontmatter 是存量笔记的磁盘契约(check 里逐字钉死键集合),加一个键就是改所有人的笔记形状。
    //    ⚠️ date 存**原始日期串**:既有的 year 是 yearOf() 抓出的 4 位年,丢了月/日,而 CSL-JSON 的
    //    issued.date-parts 要 [[2017, 6, 12]]。year 字段保持原样(引用名 / zt_year / buildCitation 全靠它)。
    date: fmVal(d.date || ''),
    volume: fmVal(d.volume || ''),
    issue: fmVal(d.issue || ''),
    pages: fmVal(d.pages || ''),
    publisher: fmVal(d.publisher || ''),
    place: fmVal(d.place || ''),
    isbn: fmVal(d.ISBN || ''),
    bookTitle: fmVal(d.bookTitle || ''),
    proceedingsTitle: fmVal(d.proceedingsTitle || ''),
    university: fmVal(d.university || ''),
    institution: fmVal(d.institution || ''),
    edition: fmVal(d.edition || ''),
    accessDate: fmVal(d.accessDate || ''),
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
    // 同 parseItem:名字存原始值(可能空串),「(未命名)」占位由 renderCols 按当时语言兜底。
    out.push({ key, name: fmVal(d.name || ''), parent: typeof d.parentCollection === 'string' ? d.parentCollection : '' })
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
    `zt_title: ${fmQ(diskTitle(item))}`,
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
  const title = diskTitle(item).replace(/[.。]$/, '')
  const jr = item.journal ? ` ${fmVal(item.journal).replace(/[.。]$/, '')}.` : ''
  return `> ${authorCite(item.creators)}(${item.year || 'n.d.'}). ${title}.${jr} [Zotero](zotero://select/library/items/${encodeURIComponent(item.key)}) · [[${noteName}]]`
}

// ══ 严格引文导出(BibTeX / CSL-JSON)—— 纯映射 + 转义,不调 AI、不联网、无副作用 ══════════════
// 全段无 t()、无 DOM:产物是要进 .bib / .csl.json 的磁盘面,跟界面语言变一个字节都不行。

/** LaTeX 转义表。⚠️大括号必须是 \textbraceleft{} / \textbraceright{} 而**不是** \{ / \}:
 *  bibtex 的字段分词器逐字符数大括号层级、**不看反斜杠** —— 标题里一个落单的 `{` 写成 `\{` 之后层级
 *  仍然不平衡,整份 .bib 在解析阶段就坏掉,而插件已经弹过「导出成功」。\textbraceleft{} 自身左右括号
 *  成对,恒平衡。 */
const BIB_ESC = {
  '\\': '\\textbackslash{}', '{': '\\textbraceleft{}', '}': '\\textbraceright{}',
  '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_',
  '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
}
/** 单趟字符类替换(替换用函数,免得替换串里的 $ 被当成 $& 之类的插值指令)。
 *  非 ASCII 一律原样保留 UTF-8:现代 biblatex 吃得下,LaTeX 音标转义是另一件事(README 写明不做)。 */
const escapeBib = (s) => String(s == null ? '' : s).replace(/[\\{}&%$#_~^]/g, (ch) => BIB_ESC[ch])
/** url / doi 专用:biblatex 里这两个是 **verbatim** 字段,转义会把 `\_` 原样印在参考文献表里。
 *  只把会拆坏字段边界的三个字符做合法百分号编码(URL 语义不变)。 */
const bibVerbatim = (s) => String(s == null ? '' : s).replace(/\s+/g, '').replace(/[{}\\]/g, (ch) => (ch === '{' ? '%7B' : ch === '}' ? '%7D' : '%5C'))
/** 标题大小写保护:token 的**首字符之后**还出现大写字母(BERT / iPhone / DNA)就整词 {} 包住,
 *  否则 bibtex 的样式会把它降成小写。只有 title 走这条,journal/publisher 等按普通字段转义。 */
function protectCase(raw) {
  return String(raw == null ? '' : raw).split(/\s+/).filter(Boolean).map((tok) => {
    const rest = Array.from(tok).slice(1).join('')
    return /\p{Lu}/u.test(rest) ? `{${escapeBib(tok)}}` : escapeBib(tok)
  }).join(' ')
}
/** 按 creatorType 取 creator。author 取不到时回落「其余有姓名的 creator」,但**排除 editor** ——
 *  编著书(只有编者)把编者写成 author 是错误著录,那类条目该只出 editor 字段。 */
function pickCreators(creators, type) {
  const list = (Array.isArray(creators) ? creators : []).filter((c) => c && typeof c === 'object')
  const exact = list.filter((c) => c.creatorType === type && lastNameOf(c))
  if (exact.length || type !== 'author') return exact
  return list.filter((c) => c.creatorType !== 'editor' && lastNameOf(c))
}
/** BibTeX 姓名段:`Last, First` 逗号形式(von / Jr 由 bibtex 自己按 `von Last, Jr, First` 分段),
 *  多人 ` and ` 连接;单字段 name(法人作者)整体 {} 保护,否则 bibtex 会把末词当姓、其余当名。 */
function bibNames(creators, type) {
  return pickCreators(creators, type).map((c) => {
    const last = fmVal(c.lastName || '')
    const first = fmVal(c.firstName || '')
    if (last && first) return `${escapeBib(last)}, ${escapeBib(first)}`
    if (last) return escapeBib(last)
    return `{${escapeBib(fmVal(c.name || '') || first)}}`
  }).join(' and ')
}
/** CSL-JSON 姓名段:{family,given};单字段(法人)走 {literal}。值不做任何 LaTeX 转义。 */
function cslNames(creators, type) {
  return pickCreators(creators, type).map((c) => {
    const last = fmVal(c.lastName || '')
    const first = fmVal(c.firstName || '')
    if (last && first) return { family: last, given: first }
    if (last) return { family: last }
    return { literal: fmVal(c.name || '') || first }
  })
}
/** CSL 的 issued.date-parts:数字三元组(不是字符串)。两者都没有 → null,调用方整个省掉 issued。 */
function dateParts(raw, year) {
  // Zotero 的 data.date 是**用户原样输入串**:`2017-06`(只有年月)、`2017-6-2`(不补零)都很常见。
  // 只认 `YYYY-MM-DD` 会让月/日无声丢失;反过来 `2024-13-45` 原样透传又不合 CSL schema。
  // 口径:能确定几段就出几段,越界的整条降级成只有年(宁可少一截,不可出非法 CSL)。
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(String(raw == null ? '' : raw))
  if (m) {
    const y = Number(m[1])
    const mo = m[2] == null ? null : Number(m[2])
    const d = m[3] == null ? null : Number(m[3])
    if (mo == null || mo < 1 || mo > 12) return [y]
    if (d == null) return [y, mo]
    return d < 1 || d > 31 ? [y, mo] : [y, mo, d]
  }
  const y = parseInt(String(year == null ? '' : year), 10)
  return Number.isInteger(y) ? [y] : null
}
/** 页码:BibTeX 的连接号是 `--`(en dash);CSL-JSON 用普通 `-`。无连接号的(e12345)原样。 */
const bibPages = (s) => fmVal(s).replace(/\s*[-–—]+\s*/g, '--')
const cslPages = (s) => fmVal(s).replace(/\s*[-–—]+\s*/g, '-')
/** DOI 归一为裸 10.x(Zotero 里手输的常带前缀)。 */
const bareDoi = (s) => fmVal(s).replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '')
/** urldate 要的是日期不是时间戳:accessDate 常是 2024-01-02T03:04:05Z,截到 10 位。 */
const urlDate = (s) => { const v = fmVal(s); return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v }
// entry type / CSL type 映射(SPEC 钉死;未知类型分别落 misc / document)
const BIB_TYPES = { journalArticle: 'article', book: 'book', bookSection: 'incollection', conferencePaper: 'inproceedings', thesis: 'phdthesis', webpage: 'online', report: 'techreport' }
const CSL_TYPES = { journalArticle: 'article-journal', book: 'book', bookSection: 'chapter', conferencePaper: 'paper-conference', thesis: 'thesis', webpage: 'webpage', report: 'report' }
const entryType = (itemType) => BIB_TYPES[String(itemType || '')] || 'misc'
const cslType = (itemType) => CSL_TYPES[String(itemType || '')] || 'document'

/** cite key 的一段:小写 → 只留字母数字 → **按码点**截前 12(与 slugTitle 同款纪律,不切断代理对)
 *  → 空则用兜底。12 是钉死的常量:8 太紧(attention 就有 9 个码点,截成 attentio 认不出来)。 */
const KEY_SEG = 12
function keySeg(raw, fallback) {
  const s = String(raw == null ? '' : raw).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return Array.from(s).slice(0, KEY_SEG).join('') || fallback
}
/** 基键 = <姓><年><题首词>,三段直连无分隔符。规则写在 README(用户会照着手改 \cite{})。
 *  ⚠️题首词取**原始** title 而不是 diskTitle():diskTitle 的空标题兜底是「(无标题)」,那会让
 *  没标题的条目拿到 anonnd无标题 而不是约定的 anonnduntitled。原始标题是用户数据,恒不随语言变。 */
function bibKeyBase(item) {
  const it = item && typeof item === 'object' ? item : {}
  const firstWord = fmVal(it.title).split(/\s+/).filter(Boolean)[0] || ''
  return keySeg(firstAuthorLast(it.creators), 'anon') + keySeg(it.year, 'nd') + keySeg(firstWord, 'untitled')
}
/** 冲突后缀:0→a … 25→z, 26→aa, 27→ab …(26 进制展开)。 */
function suffixLetters(n) {
  let i = Math.max(0, Math.floor(Number(n) || 0))
  let out = ''
  for (;;) {
    out = String.fromCharCode(97 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
    if (i < 0) return out
  }
}
const keyCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
/** **唯一的键分配入口**:两个序列化器都调它 → .bib 的 key 与 .csl.json 的 id 必然一致。
 *  禁止在 toBibtex / toCslJson 里各写一套。
 *  同一基键 >1 条时**全员**加 -a/-b/-c(按 Zotero 条目 key 升序,与传入顺序无关)。
 *  ⚠️刻意不让「组内第一个保留裸键」:那样 A 单独导出时拿裸键,后来 A+A′ 同批时若 A′ 排序更靠前,
 *  裸键会**改指到 A′** —— 用户正文里的 \cite{裸键} 悄悄引到了另一篇论文。全员加后缀时,同一个陈旧
 *  引用变成 missing reference,编译时大声报错。**宁可断,不可错指。** */
function assignKeys(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === 'object')
  const groups = new Map()
  for (const it of list) {
    const b = bibKeyBase(it)
    if (!groups.has(b)) groups.set(b, [])
    groups.get(b).push(it)
  }
  const pairs = []
  for (const [base, members] of groups) {
    const sorted = members.slice().sort((x, y) => keyCmp(String(x.key || ''), String(y.key || '')))
    sorted.forEach((it, i) => { pairs.push({ item: it, key: members.length > 1 ? `${base}-${suffixLetters(i)}` : base }) })
  }
  return pairs.sort((a, b) => keyCmp(a.key, b.key))
}

/** BibTeX 序列化。字段顺序钉死、空字段不出、最后一个字段行不带逗号。
 *  转义分工:title 走 protectCase(内部已 escapeBib),url/doi 走 bibVerbatim,其余一律 escapeBib。
 *  每个字段只经过这三条路里的一条 —— 混用会双重转义。 */
function toBibtex(pairs) {
  return (Array.isArray(pairs) ? pairs : []).map((p) => {
    const item = (p && p.item) || {}
    const type = entryType(item.itemType)
    const rows = []
    const put = (name, val) => { const v = String(val == null ? '' : val); if (v) rows.push(`  ${name} = {${v}}`) }
    put('author', bibNames(item.creators, 'author'))
    put('editor', bibNames(item.creators, 'editor'))
    put('title', protectCase(diskTitle(item)))
    put('booktitle', escapeBib(type === 'incollection' ? item.bookTitle : type === 'inproceedings' ? item.proceedingsTitle : ''))
    put('journal', escapeBib(item.journal))
    put('publisher', escapeBib(item.publisher))
    put('school', escapeBib(item.university))
    put('institution', escapeBib(item.institution))
    put('address', escapeBib(item.place))
    put('edition', escapeBib(item.edition))
    put('volume', escapeBib(item.volume))
    put('number', escapeBib(item.issue))
    put('pages', escapeBib(bibPages(item.pages)))
    put('year', escapeBib(item.year))
    put('doi', bibVerbatim(bareDoi(item.doi)))
    put('isbn', escapeBib(item.isbn))
    put('url', bibVerbatim(item.url))
    put('urldate', escapeBib(urlDate(item.accessDate)))
    return `@${type}{${(p && p.key) || ''},\n${rows.join(',\n')}\n}`
  }).join('\n\n')
}
/** CSL-JSON 序列化(官方 schema 字段名)。值保留原始 UTF-8,**不做任何 LaTeX 转义**。 */
function toCslJson(pairs) {
  const arr = (Array.isArray(pairs) ? pairs : []).map((p) => {
    const item = (p && p.item) || {}
    const o = { id: (p && p.key) || '', type: cslType(item.itemType) }
    const title = diskTitle(item)
    if (title) o.title = title
    const au = cslNames(item.creators, 'author')
    if (au.length) o.author = au
    const ed = cslNames(item.creators, 'editor')
    if (ed.length) o.editor = ed
    const dp = dateParts(item.date, item.year)
    if (dp) o.issued = { 'date-parts': [dp] }
    const container = fmVal(item.journal) || fmVal(item.bookTitle) || fmVal(item.proceedingsTitle)
    if (container) o['container-title'] = container
    if (fmVal(item.volume)) o.volume = fmVal(item.volume)
    if (fmVal(item.issue)) o.issue = fmVal(item.issue)
    if (cslPages(item.pages)) o.page = cslPages(item.pages)
    if (bareDoi(item.doi)) o.DOI = bareDoi(item.doi)
    if (String(item.url || '').trim()) o.URL = String(item.url).trim()
    if (fmVal(item.publisher)) o.publisher = fmVal(item.publisher)
    if (fmVal(item.isbn)) o.ISBN = fmVal(item.isbn)
    return o
  })
  return JSON.stringify(arr, null, 2)
}
/** 整份文件。⚠️**没有时间戳、没有「生成于」注释头**:同一批条目重复导出必须逐字节相同,
 *  否则「内容没变就不写盘」那条判定永远不成立,-2/-3 无限增殖。 */
const bibFile = (items) => `% Encoding: UTF-8\n\n${toBibtex(assignKeys(items))}\n`
const cslFile = (items) => `${toCslJson(assignKeys(items))}\n`
/** 导出文件基名。**全部走磁盘常量,一个 t() 都不许有**(见 UNNAMED_COL_DISK 那段注释)。
 *  三态优先级与 loadItems 的取数路径一致:检索 > 集合 > 全部。 */
function exportBaseName(scope) {
  const s = scope && typeof scope === 'object' ? scope : {}
  const raw = s.query
    ? `${EXPORT_PREFIX_DISK}-${EXPORT_SEARCH_DISK}-${s.query}`
    : s.colKey
      ? `${EXPORT_PREFIX_DISK}-${fmVal(s.colName) || UNNAMED_COL_DISK}`
      : `${EXPORT_PREFIX_DISK}-${EXPORT_ALL_DISK}`
  return sanitizeFileName(raw)
}

// ── Zotero 本地 API(响应不可信;网络错不抛,回 {ok:false}) ──
const apiBase = (port) => `http://localhost:${port}/api/users/0`
const qConn = () => '/items?limit=1'
const qAllItems = () => '/items?itemType=-attachment&limit=100'
const qSearch = (q) => `/items?q=${encodeURIComponent(q)}&itemType=-attachment&limit=100`
// 集合端点与子对象端点也要显式 limit:Zotero 本地 API 沿用 web API v3 语义,多对象端点默认只回 25 条,
// 不带参数集合树/子对象会静默截断(>100 仍截断,列真机验收项;v1 不翻页,改命中上限时提示用户)。
const qCollections = () => '/collections?limit=100'
const qColItems = (key) => `/collections/${encodeURIComponent(key)}/items?itemType=-attachment&limit=100`
const qChildren = (key) => `/items/${encodeURIComponent(key)}/children?limit=100`
async function ztGet(path) {
  const url = apiBase(portOf()) + path
  try {
    // 5s 超时闸:端口被防火墙 DROP 时 fetch 挂起而非拒绝,没有闸「正在连接」会永远转圈。
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
    if (!res || !res.ok) return { ok: false, error: `HTTP ${res ? res.status : '??'}` }
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data)) return { ok: false, error: t('err_not_array') }
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
  if (!start.ok) throw new Error((await start.text().catch(() => '')) || t('err_run_start', { code: start.status }))
  const { runId } = await start.json()
  if (!runId) throw new Error(t('err_no_runid'))
  const res = await fetch(`${cfg.backendUrl}/agent/runs/${encodeURIComponent(runId)}/events?fromSeq=0`, { headers: h, signal })
  if (!res.ok || !res.body) throw new Error(t('err_sub', { code: res.status }))
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
      if (ev.type === 'error') throw new Error((ev.payload && ev.payload.error) || t('err_ai_generic'))
    }
  }
  throw new Error(t('err_stream_cut'))
}
/** 模型指令(英文,BRIEF 语言纪律):只依据摘要与已导入划线总结贡献/方法/局限,禁编造,回 ```litreview 块。
 *  产出语言随 UI 语言(BRIEF:要模型用哪种语言输出必须在指令里显式写),模板小标题同步换,
 *  否则英文用户会拿到「中文小标题 + 英文正文」的夹生货。 */
function buildLitreviewMessage(noteText, abstract) {
  const en = L() === 'en'
  const langRule = en ? 'Write the review in English.' : 'Write the review in Simplified Chinese.'
  const shape = en
    ? '**Contribution**: ...\n**Method**: ...\n**Limitations**: ...'
    : '**贡献**:...\n**方法**:...\n**局限**:...'
  return `You are a literature-review assistant helping a researcher digest ONE paper.
Below is the researcher's material for this paper: bibliographic frontmatter, the abstract, and the highlights/annotations they imported from Zotero.

Task: summarize the paper's contribution, method, and limitations, based ONLY on the abstract and the highlights below.
Rules:
- Never fabricate facts, numbers, datasets, or results that are not present in the material.
- If the material is not sufficient for a section, say so explicitly instead of guessing.
- ${langRule}
- Reply with exactly ONE fenced code block tagged litreview and nothing else, shaped like:

\`\`\`litreview
${shape}
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
/** 路径**存在性**的第二信源。宿主 `readFile` 对「文件不存在」「fs 读失败(EACCES/EPERM/EBUSY/EIO、
 *  网络卷与云盘占位)」「库根未就位」**一律返回 null**(真源 electron/amadeus/ipc.ts:981-989),
 *  单靠它分不出三态 —— 把读失败当「还没有」再 writeFile,就是当场抹掉用户已有文件。
 *  只读枚举面不经文件内容,读不了的文件照样枚举得到:`.md` 走 listPages,其余走 listFiles。
 *  ⚠️`.zotero-index.json` 是点文件,`collectFiles` 明确跳过点开头(vaultManager.ts:81)——
 *     枚举不到,所以索引那条只能靠 readIndex 自己的三态(见下)。
 *  枚举面缺席 / 抛错 / 给空数组 = 判不了,返回 null(调用方退回现状,别拿它当「不存在」)。 */
async function pathListed(path) {
  const p = String(path || '')
  const fn = /\.md$/i.test(p) ? ctx.app.listPages : ctx.app.listFiles
  if (typeof fn !== 'function') return null
  let xs = null
  try { xs = await fn.call(ctx.app) } catch { return null }
  if (!Array.isArray(xs) || !xs.length) return null
  return xs.indexOf(p) >= 0
}
/** 三态读:`{st:'ok',text}` / `{st:'missing'}` / `{st:'error'}`。null + 枚举面说它在 = 读失败。 */
async function readTri(path) {
  let raw = null // ⚠️ 别叫 t —— 会遮住词表函数 t()
  try { raw = await ctx.app.readFile(path) } catch (e) { return { st: 'error', msg: (e && e.message) || String(e) } }
  if (raw != null) return { st: 'ok', text: raw }
  return (await pathListed(path)) === true ? { st: 'error', msg: t('err_read_listed') } : { st: 'missing' }
}
/** 三态。⚠️ `ok:false` = 读失败 / 坏 JSON —— 折叠成「还没有索引」再 writeIndex,
 *  等于把「读不出来」持久化成「这些笔记不存在」,而它又是 ensureNote 认领循环的上游。 */
async function readIndex() {
  if (!ctx.app.readFile) return { notes: {}, ok: false }
  let t = null
  try { t = await ctx.app.readFile(indexPath()) } catch { return { notes: {}, ok: false } }
  if (t == null) return { notes: {}, ok: true } // 还没建过索引:正常初始态
  try {
    const j = JSON.parse(t)
    return j && j.notes && typeof j.notes === 'object' ? { notes: j.notes, ok: true } : { notes: {}, ok: false }
  } catch { return { notes: {}, ok: false } } // 写了半截的坏 JSON:绝不当成「没有映射」
}
const writeIndex = (idx) => (idx && idx.ok === false
  ? Promise.resolve() // 读失败态一律不落盘,别把缩水后的映射写死
  : ctx.app.writeFile(indexPath(), JSON.stringify({ notes: (idx && idx.notes) || {} }, null, 2)))
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
    const r = e && typeof e.path === 'string' ? await readTri(e.path) : { st: 'missing' }
    // ⚠️ 只剔「明确不存在」与「身份不符」。读失败(st==='error')一律**保留** ——
    //    剔了就把「这一刻读不出来」写死成「文件已删」,下次打开也回不来(README 承诺的是前者)。
    if (r.st === 'error') continue
    const mk = r.st === 'ok' ? parseNoteMeta(r.text).zt_key : ''
    if (r.st === 'missing' || (mk && mk !== k)) { delete idx.notes[k]; dropped++ }
  }
  if (dropped) await writeIndex(idx).catch(() => { /* 只读环境不阻塞 */ })
  return idx
}
/** 有则复用无则建(引用名重名加序号;索引丢了按文件 zt_key 认领)。 */
async function ensureNote(item) {
  if (!ctx.app.readFile || !ctx.app.writeFile) throw new Error(t('err_no_fs'))
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
    const r = await readTri(p)
    // 读失败绝不当空位:下一行就是 writeNote 整篇覆写(P0 模板 1)
    if (r.st === 'error') throw new Error(t('msg_note_readfail', { path: p, msg: r.msg || '' }))
    if (r.st === 'missing') { name = cand; break }
    const txt = r.text
    if (parseNoteMeta(txt).zt_key === item.key) {
      idx.notes[item.key] = { path: p, title: diskTitle(item), touched: Date.now() }
      await writeIndex(idx)
      return { path: p, name: cand, created: false }
    }
  }
  // 序号耗尽绝不落盘:兜底写会覆盖属于别的条目的既有笔记(用户「我的笔记」被抹)
  if (!name) throw new Error(t('err_name_taken', { base }))
  const path = `${wf()}/${name}.md`
  await writeNote(path, buildNoteMd(item))
  idx.notes[item.key] = { path, title: diskTitle(item), touched: Date.now() }
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
/** 导出当前结果集 → <工作文件夹>/<基名>.bib + <基名>.csl.json。回 {skipped,bib,csl,n}。
 *  ⚠️三条不许退让的规矩(20260821 BRIEF 的三条 P0 模板,逐条对应):
 *  ①**读失败 ≠ 文件不存在**:readFile 抛错一律立刻中止,绝不折叠成「还没有」然后写一份新的
 *    —— 那是当场抹掉用户已有的导出。
 *  ②**同名产物绝不无声覆写**:内容相同就不写盘(回 skipped,也不产 -2 垃圾);内容不同另存 -2/-3。
 *    .bib 与 .csl.json 是一对(同一批、同一套 key),**必须一起 bump** —— 各自找空位会出现
 *    x.bib + x-2.csl.json 这种错配的一对,用户按文件名根本认不出来。
 *  ③**导出路径撞上当前活动页就让位**:writeFile 是整文件覆写,写活动页 = 拿陈旧快照盖掉用户
 *    正在敲的字。这里不走 insertMarkdown(导出是独立产物文件,不是往笔记里插内容),直接让到 -2。
 *  序号耗尽抛错、绝不兜底覆写(照 ensureNote 的既有纪律)。 */
async function exportBib(items, baseName) {
  if (!ctx.app.readFile || !ctx.app.writeFile) throw new Error(t('msg_export_nofs'))
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === 'object')
  const bibText = bibFile(list)
  const cslText = cslFile(list)
  let active = null
  try { active = ctx.app.getActivePage ? ctx.app.getActivePage() : null } catch { active = null }
  // 三态探测:free(不存在)/ same(逐字节相同)/ taken(被别的内容占着)/ busy(是当前活动页)
  const probe = async (path, text) => {
    if (active && path === active) return 'busy'
    // ⚠️ 宿主的读失败形态是 **return null** 而不是 throw —— 只接 throw 的话,
    //    「读不出既有导出文件一律中止」这条 README 承诺在真宿主上等于没写。
    const r = await readTri(path)
    if (r.st === 'error') throw new Error(t('msg_export_readfail', { msg: r.msg || '' }))
    if (r.st === 'missing') return 'free'
    return String(r.text) === text ? 'same' : 'taken'
  }
  const base = sanitizeFileName(baseName) || exportBaseName({})
  for (let n = 1; n <= 99; n++) {
    const cand = n === 1 ? base : `${base}-${n}`
    const pB = `${wf()}/${cand}.bib`
    const pC = `${wf()}/${cand}.csl.json`
    const sB = await probe(pB, bibText)
    const sC = await probe(pC, cslText)
    const okB = sB === 'free' || sB === 'same'
    const okC = sC === 'free' || sC === 'same'
    if (!okB || !okC) continue
    if (sB === 'same' && sC === 'same') return { skipped: true, bib: pB, csl: pC, n: list.length }
    if (sB !== 'same') await ctx.app.writeFile(pB, bibText)
    if (sC !== 'same') await ctx.app.writeFile(pC, cslText)
    return { skipped: false, bib: pB, csl: pC, n: list.length }
  }
  throw new Error(t('msg_export_taken', { base }))
}

/** 导入划线批注:GET children → highlight/note 幂等追加。返回 {added,total,note}。 */
async function importAnnotations(item) {
  const r = await ztGet(qChildren(item.key))
  if (!r.ok) throw new Error(t('err_ann_fetch', { msg: r.error }))
  // 100 = 端点上限而非总数(见 qChildren 那段)。判据用**子对象条数**不是批注条数:
  // 满 100 条附件、零条批注一样是截断,而那正是最容易被当成「这篇没划线」的一种。
  const truncated = r.data.length >= 100
  const anns = parseAnnotations(r.data)
  if (!anns.length) return { added: 0, total: 0, note: null, truncated }
  const note = await ensureNote(item)
  // ⚠️ ensureNote 上一行刚证明过这个路径的归属,此处的 null 只可能是读失败 ——
  //    折叠成「还没有」再 buildNoteMd 写回去,用户「## 我的笔记」里几个月的正文当场没了。
  const rd = await readTri(note.path)
  if (rd.st === 'error') throw new Error(t('msg_note_readfail', { path: note.path, msg: rd.msg || '' }))
  const md = rd.st === 'ok' ? rd.text : buildNoteMd(item)
  const merged = mergeAnnotations(md, anns)
  if (merged.added) {
    await writeNote(note.path, merged.md)
    const idx = await readIndex()
    if (idx.notes[item.key]) { idx.notes[item.key].touched = Date.now(); await writeIndex(idx).catch(() => { /* ignore */ }) }
  }
  return { added: merged.added, total: anns.length, note, truncated }
}

// ── 插入引用(块表面;令牌纪律:每次点击现取 getPage,绝不缓存 token) ──
const say = (m, o) => (ctx.notify ? ctx.notify(m, o) : ctx.app.notify(m))
/** 复制纯文本到剪贴板(严格引文导出的两个「复制」按钮共用)。无剪贴板面就抛,调用方转成提示。 */
async function copyText(text, okKey) {
  if (!(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText)) throw new Error(t('err_no_clipboard'))
  await navigator.clipboard.writeText(String(text == null ? '' : text))
  say(t(okKey), { level: 'success' })
}
/** zotero:// 协议唤起。Electron 宿主对一切 window.open 走 setWindowOpenHandler,非 http(s)
 *  一律 deny(window.open 返回 null),不能装作打开成功——deny 时回落复制 URI 到剪贴板并提示,
 *  用户粘到浏览器/Zotero 地址栏即可。浏览器直跑(window.open 回真窗口代理)仍走协议唤起。 */
async function openZoteroUri(uri) {
  let w = null
  try { w = globalThis.window && window.open ? window.open(uri) : null } catch { w = null }
  if (w) return 'opened'
  try {
    if (!(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText)) throw new Error(t('err_no_clipboard'))
    await navigator.clipboard.writeText(uri)
    say(t('msg_uri_copied', { uri }), { level: 'warning' })
    return 'copied'
  } catch {
    say(t('msg_uri_blocked', { uri }), { level: 'warning' })
    return 'blocked'
  }
}
const hasBlockSurface = () => typeof ctx.app.getPage === 'function'
  && (typeof ctx.app.insertMarkdown === 'function' || typeof ctx.app.insertBlockAfter === 'function')
async function insertCite(item, noteName) {
  const block = buildCitation(item, noteName)
  if (!hasBlockSurface()) {
    // 旧宿主无块表面 → 降级为复制引用到剪贴板
    try {
      if (!(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText)) throw new Error(t('err_no_clipboard'))
      await navigator.clipboard.writeText(block)
      say(t('msg_cite_copied'), { level: 'success' })
      return 'copied'
    } catch { say(t('msg_cite_copyfail'), { level: 'error' }); return 'copyfail' }
  }
  const page = ctx.app.getPage()
  if (!page || !page.path) { say(t('msg_cite_nopage'), { level: 'warning' }); return 'nopage' }
  // v4/unified 笔记没有块模型(page.model === 'text'):insertBlockAfter 在那上面一律返 null,
  // 走两条路由都成立的 insertMarkdown。老宿主没有它 → 退回块口(此前唯一的路)。
  const ok = typeof ctx.app.insertMarkdown === 'function'
    ? ctx.app.insertMarkdown(page.token, block, 'start')
    : ctx.app.insertBlockAfter(page.token, null, block) != null
  if (!ok) { say(t('msg_cite_stale'), { level: 'error' }); return 'stale' }
  if (ctx.activity && ctx.activity.log) ctx.activity.log('cite', { key: item.key, text: diskTitle(item).slice(0, 80) })
  say(t('msg_cite_inserted'), { level: 'success' })
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
let _pickerRefresh = null
function closeOverlays() {
  if (_pickerTimer) { clearTimeout(_pickerTimer); _pickerTimer = null }
  if (_pickerRefresh) { rerenders.delete(_pickerRefresh); _pickerRefresh = null }
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
.zt-metacard.en .zt-metarow .lbl{flex:0 0 74px}
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
  ttl.textContent = uiTitle(item)
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = [uiAuthors(item), item.year, item.journal].filter(Boolean).join(' · ') || item.itemType || ''
  mid.appendChild(ttl)
  mid.appendChild(sub)
  row.appendChild(mid)
  if (o.hasNote) {
    const b = document.createElement('span')
    b.className = 'zt-badge'
    b.textContent = t('badge_note')
    row.appendChild(b)
  }
  if (o.onClick) row.addEventListener('click', o.onClick)
  return row
}
function buildDetailCard(item) {
  const card = document.createElement('div')
  // 英文标签比中文宽,标签列同步放宽,否则「Journal」被挤成两行
  card.className = 'zt-metacard' + (L() === 'en' ? ' en' : '')
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
  add(t('meta_authors'), uiAuthors(item))
  add(t('meta_year'), item.year)
  add(t('meta_journal'), item.journal)
  add(t('meta_doi'), item.doi, item.doi ? 'https://doi.org/' + encodeURI(item.doi) : '')
  add(t('meta_url'), item.url, item.url)
  add(t('meta_added'), fmtDate(item.dateAdded))
  add(t('meta_type'), item.itemType)
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
    // colName 只存**用户数据**(真集合名);「全部条目」是 UI 文案,渲染时按当时语言取,
    // 否则切语言后列表头会卡在挂载时那门语言。
    cols: [], colKey: '', colName: '',
    query: '', items: [], loading: true, listErr: '', truncated: false,
    exporting: false,
    detail: null, children: null, childrenLoading: false, childrenErr: '',
    noteState: null, // {hasNote, notePath, noteName, imported}
    index: { notes: {} },
    aiBusy: false,
    // AI 进度行进 state:renderDetail 每次都新建一个空的 .zt-aiprog,不回填的话
    // 「ai_start 到首 token 之间切语言」那行会一直空着(要等下一个回调才补)。
    // aiProgKey = 这条进度属于哪条文献,防止串到另一条文献的详情页上。
    aiProg: '', aiProgErr: false, aiProgKey: '',
  }
  let reqSeq = 0
  let childSeq = 0
  let noteSeq = 0
  let connSeq = 0
  let searchTimer = null
  let aiController = null

  // 模板只铺骨架,一切文案由 renderStatics 填 —— 骨架里写死中文的话切语言时它们不会变
  // (renderConn/renderCols/renderMain 都不碰这几个节点);也绝不能在切语言时重跑 innerHTML:
  // connEl/colsEl/mainEl/searchEl 是挂载时一次取到的引用,重铺骨架后它们全成游离节点。
  root.innerHTML = `
<div class="zt-cols">
  <div class="zt-side">
    <div class="zt-conn" data-conn></div>
    <div class="zt-label" data-lbl-search></div>
    <input class="zt-input" data-search />
    <div class="zt-label" data-lbl-cols></div>
    <div data-cols></div>
  </div>
  <div class="zt-main" data-main></div>
</div>`
  const $ = (s) => root.querySelector(s)
  const connEl = $('[data-conn]')
  const colsEl = $('[data-cols]')
  const mainEl = $('[data-main]')
  const searchEl = $('[data-search]')
  const lblSearchEl = $('[data-lbl-search]')
  const lblColsEl = $('[data-lbl-cols]')

  // ── 静态文案(骨架里那几个不重建的节点) ──
  function renderStatics() {
    if (lblSearchEl) lblSearchEl.textContent = t('lbl_search')
    if (lblColsEl) lblColsEl.textContent = t('lbl_collections')
    if (searchEl) searchEl.placeholder = t('search_ph')
  }

  // ── 左栏:连接状态卡 ──
  function renderConn() {
    connEl.textContent = ''
    const hd = document.createElement('div')
    hd.className = 'hd'
    const dot = document.createElement('span')
    dot.className = 'zt-dot ' + (S.conn === 'ok' ? 'ok' : S.conn === 'down' ? 'bad' : 'spin')
    const tx = document.createElement('span')
    tx.textContent = S.conn === 'ok' ? t('conn_ok', { port: portOf() }) : S.conn === 'down' ? t('conn_down') : t('conn_checking')
    hd.appendChild(dot)
    hd.appendChild(tx)
    connEl.appendChild(hd)
    if (S.conn === 'down') {
      const steps = document.createElement('ol')
      steps.className = 'steps'
      for (const s of [t('conn_step1'), t('conn_step2'), t('conn_step3', { port: portOf() })]) {
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
    btn.textContent = S.conn === 'ok' ? t('btn_refresh') : t('btn_retry')
    btn.style.marginTop = '8px'
    btn.addEventListener('click', refreshConn)
    connEl.appendChild(btn)
  }

  // ── 左栏:集合树 ──
  function renderCols() {
    colsEl.textContent = ''
    // label = 上屏文案(可能是「(未命名)」这种 UI 占位),raw = 真集合名(可能空串)。
    // 存进 S.colName 的必须是 raw:存 label 会把占位符的语言烘进 state,切语言后列表头卡在旧语言。
    const mk = (key, label, depth, active, raw) => {
      const d = document.createElement('div')
      d.className = 'zt-fold' + (active ? ' active' : '')
      d.style.paddingLeft = `${8 + depth * 14}px`
      const nm = document.createElement('span')
      nm.className = 'nm'
      nm.textContent = label
      d.appendChild(nm)
      d.addEventListener('click', () => {
        S.colKey = key
        S.colName = key ? String(raw || '') : '' // 「全部条目」不入 state,渲染时按当时语言取
        S.query = ''
        searchEl.value = ''
        renderCols()
        loadItems()
      })
      return d
    }
    colsEl.appendChild(mk('', t('all_items'), 0, !S.colKey && !S.query, ''))
    for (const c of collectionTree(S.cols)) colsEl.appendChild(mk(c.key, c.name || t('unnamed_col'), c.depth + 1, S.colKey === c.key && !S.query, c.name))
    if (!S.cols.length && S.conn === 'ok') {
      const d = document.createElement('div')
      d.className = 'zt-empty'
      d.textContent = t('no_collections')
      colsEl.appendChild(d)
    }
  }

  // ── 右栏 ──
  function renderMain() {
    if (S.detail) { renderDetail(); return }
    mainEl.textContent = ''
    if (S.conn === 'checking') { emptyMain(t('main_connecting')); return }
    if (S.conn === 'down') {
      const box = document.createElement('div')
      box.className = 'zt-empty'
      const b1 = document.createElement('div')
      b1.textContent = t('main_down_title')
      const b2 = document.createElement('div')
      b2.className = 'zt-muted'
      b2.textContent = t('main_down_hint')
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
    // 未命名集合的占位符按**当时**语言取(S.colName 存的是原始名,空串即未命名)
    cap.textContent = S.query ? t('list_search_cap', { q: S.query }) : (S.colKey ? (S.colName || t('unnamed_col')) : t('all_items'))
    hd.appendChild(cap)
    const cnt = document.createElement('span')
    cnt.className = 'zt-muted'
    cnt.textContent = S.loading ? t('list_loading') : t('list_count', { n: S.items.length })
    hd.appendChild(cnt)
    // 导出按钮:只在「真有东西可导」时出现 —— 加载中/报错/空列表下画出来,点了必炸
    if (!S.loading && !S.listErr && S.items.length) {
      const ex = document.createElement('button')
      ex.className = 'zt-btn sm ghost'
      ex.style.marginLeft = 'auto'
      ex.textContent = S.exporting ? t('btn_exporting') : t('btn_export')
      ex.disabled = !!S.exporting
      ex.addEventListener('click', () => { actExport() })
      hd.appendChild(ex)
    }
    mainEl.appendChild(hd)
    if (S.listErr) { warnLine(t('list_err', { msg: S.listErr })); return }
    if (S.loading) return
    if (S.truncated) warnLine(t('list_truncated'))
    if (!S.items.length) { emptyMain(S.query ? t('list_nohit') : t('list_empty_col')); return }
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
    // 重新打开详情页 = 干净起步:抹掉上一轮 AI 进度/失败提示。但正在跑的那条不许抹
    // (用户从列表点回同一条文献时,进行中的进度应当还在)。
    if (!S.aiBusy || S.aiProgKey !== item.key) { S.aiProg = ''; S.aiProgErr = false; S.aiProgKey = '' }
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
    back.textContent = t('btn_back')
    back.addEventListener('click', () => { S.detail = null; renderMain() })
    const ttl = document.createElement('div')
    ttl.className = 'ttl'
    ttl.textContent = uiTitle(item)
    hd.appendChild(back)
    hd.appendChild(ttl)
    mainEl.appendChild(hd)
    mainEl.appendChild(buildDetailCard(item))
    // 摘要
    const absLabel = document.createElement('div')
    absLabel.className = 'zt-label'
    absLabel.textContent = t('lbl_abstract')
    mainEl.appendChild(absLabel)
    const abs = document.createElement('div')
    abs.className = 'zt-abs'
    abs.textContent = item.abstract || t('no_abstract')
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
    btn(st && st.hasNote ? t('btn_open_note') : t('btn_new_note'), 'primary', actNote)
    btn(t('btn_import'), '', actImport)
    btn(hasBlockSurface() ? t('btn_cite') : t('btn_copy_cite'), '', actCite)
    btn(t('btn_copy_bib'), '', actCopyBib)
    btn(t('btn_copy_csl'), '', actCopyCsl)
    const pdfKey = findPdfAttachment(S.children)
    if (pdfKey) btn(t('btn_open_pdf'), '', () => { openZoteroUri(`zotero://open-pdf/library/items/${encodeURIComponent(pdfKey)}`) })
    // AI 读文献:有阅读笔记,且(已导入批注 或 有摘要)才可点
    const aiReady = !!(st && st.hasNote && (st.imported > 0 || item.abstract))
    const aiBtn = btn(S.aiBusy ? t('btn_ai_busy') : t('btn_ai'), '', actAi)
    aiBtn.disabled = S.aiBusy || !aiReady
    if (!aiReady) aiBtn.title = st && st.hasNote ? t('ai_tip_need_import') : t('ai_tip_need_note')
    // 批注/笔记状态行
    const info = document.createElement('div')
    info.className = 'zt-annline'
    const annCount = S.children ? parseAnnotations(S.children).length : 0
    const parts = []
    parts.push(S.childrenLoading
      ? t('info_children_loading')
      : S.childrenErr
        ? t('info_children_err', { msg: S.childrenErr })
        : t('info_ann_count', { n: annCount }) + (pdfKey ? t('info_has_pdf') : t('info_no_pdf')))
    if (st) parts.push(st.hasNote ? t('info_note', { name: st.noteName, n: st.imported }) : t('info_no_note'))
    info.textContent = parts.join(t('info_sep'))
    mainEl.appendChild(info)
    // 回填:切语言(或任何重渲)不得把进行中的 AI 进度/失败提示清空。只回填属于本条文献的。
    const mine = S.aiProgKey === item.key
    const prog = document.createElement('div')
    prog.className = 'zt-aiprog' + (mine && S.aiProgErr ? ' err' : '')
    prog.setAttribute('data-aiprog', '')
    if (mine) prog.textContent = S.aiProg
    mainEl.appendChild(prog)
  }

  // ── 动作 ──
  async function actNote(b) {
    b.disabled = true
    try {
      const n = await ensureNote(S.detail)
      const shown = openNoteInEditor(n.path) // 绝不 openFile:裸 .md 会被系统默认程序抢走
      say(n.created ? t('msg_note_created', { name: n.name }) : shown ? t('msg_note_opened') : t('msg_note_at', { path: n.path }), { level: 'success' })
      loadNoteState(S.detail)
    } catch (e) {
      say(t('msg_note_fail', { msg: (e && e.message) || e }), { level: 'error' })
    } finally { b.disabled = false }
  }
  async function actImport(b) {
    b.disabled = true
    const old = b.textContent
    b.textContent = t('btn_importing')
    try {
      const r = await importAnnotations(S.detail)
      if (!r.total) say(t('msg_no_ann'), { level: 'warning' })
      else if (r.added) say(t('msg_ann_added', { n: r.added }), { level: 'success' })
      else say(t('msg_ann_none_new'), { level: 'info' })
      if (r.truncated) say(t('msg_ann_truncated'), { level: 'warning' })
      loadNoteState(S.detail)
    } catch (e) {
      say(t('msg_import_fail', { msg: (e && e.message) || e }), { level: 'error' })
    } finally { b.disabled = false; b.textContent = old }
  }
  async function actCite(b) {
    b.disabled = true
    try {
      const st = S.noteState
      await insertCite(S.detail, st && st.hasNote ? st.noteName : citeName(S.detail))
    } finally { b.disabled = false }
  }
  // 单条复制:走 bibFile/cslFile 同一条路径(键生成与批量导出完全同源,不另写一套)
  async function actCopyBib(b) {
    b.disabled = true
    try { await copyText(bibFile([S.detail]), 'msg_bib_copied') } catch (e) { say(t('msg_copy_fail', { msg: (e && e.message) || e }), { level: 'error' }) } finally { b.disabled = false }
  }
  async function actCopyCsl(b) {
    b.disabled = true
    try { await copyText(cslFile([S.detail]), 'msg_csl_copied') } catch (e) { say(t('msg_copy_fail', { msg: (e && e.message) || e }), { level: 'error' }) } finally { b.disabled = false }
  }
  /** 导出当前结果集。按钮引用不留:renderMain 一重建就是游离节点,忙态一律走 S.exporting。 */
  async function actExport() {
    if (S.exporting) return
    // 列表被截断时先说清楚:导出的只有这 100 条,不许让用户以为导了全部
    if (S.truncated) say(t('export_truncated_hint'), { level: 'warning' })
    S.exporting = true
    renderMain()
    try {
      const r = await exportBib(S.items, exportBaseName({ colKey: S.colKey, colName: S.colName, query: S.query }))
      if (r.skipped) say(t('msg_export_same', { bib: r.bib }), { level: 'info' })
      else {
        say(t('msg_export_done', { n: r.n, bib: r.bib, csl: r.csl }), { level: 'success' })
        if (ctx.activity && ctx.activity.log) ctx.activity.log('export', { n: r.n, scope: S.query ? 'search' : S.colKey ? 'collection' : 'all' })
      }
    } catch (e) {
      say(t('msg_export_fail', { msg: (e && e.message) || e }), { level: 'error' })
    } finally {
      S.exporting = false
      renderMain()
    }
  }
  async function actAi() {
    if (S.aiBusy) return
    const item = S.detail
    const st = S.noteState
    if (!st || !st.hasNote) return
    S.aiBusy = true
    renderMain()
    const prog = mainEl.querySelector('[data-aiprog]')
    const runKey = item.key
    // 进度既写 DOM 也写 state:重渲(切语言/loadNoteState 回来)时 renderDetail 才能原样回填。
    const setP = (txt, err) => {
      S.aiProg = String(txt || ''); S.aiProgErr = !!err; S.aiProgKey = S.aiProg ? runKey : ''
      const p = mainEl.querySelector('[data-aiprog]') || prog
      if (p) { p.textContent = S.aiProg; p.className = 'zt-aiprog' + (err ? ' err' : '') }
    }
    if (aiController) aiController.abort()
    aiController = new AbortController()
    const sig = aiController.signal
    try {
      setP(t('ai_start'))
      const cfg = await getCfg()
      if (!cfg.backendUrl || !cfg.token) throw new Error(cfg.backendUrl ? t('err_login') : t('err_engine'))
      const rd0 = await readTri(st.notePath)
      if (rd0.st !== 'ok') throw new Error(t('msg_note_readfail', { path: st.notePath, msg: rd0.msg || '' }))
      const noteText = rd0.text
      const out = await runAgent(cfg, uuid(), buildLitreviewMessage(noteText, item.abstract), (full) => setP(t('ai_streaming', { n: full.length })), sig)
      const review = parseLitreview(out)
      if (!review.trim()) throw new Error(t('err_empty_model'))
      // 生成期间用户可能改过这篇,所以重读一次;读不到就中止 ——
      // 拿 '' 去 upsertAiSection 会把整篇笔记替换成「只剩一节 AI 速览」。
      const rd1 = await readTri(st.notePath)
      if (rd1.st !== 'ok') throw new Error(t('msg_note_readfail', { path: st.notePath, msg: rd1.msg || '' }))
      const md = rd1.text
      // 落款行随生成当时的语言(正文语言也是那时定的);节标题「## AI 速览」是磁盘契约,恒中文
      await writeNote(st.notePath, upsertAiSection(md, `${review}\n\n${t('ai_footer', { date: fmtDate(today()) })}`))
      say(t('ai_done'), { level: 'success' })
      setP('')
      openNoteInEditor(st.notePath) // 绝不 openFile:裸 .md 会被系统默认程序抢走
    } catch (e) {
      if (!sig.aborted) { const msg = (e && e.message) || String(e); say(t('ai_fail', { msg }), { level: 'error' }); setP(t('ai_fail_short', { msg }), true) }
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

  // 切语言只重画,不重挂:S 原样留着(选中的集合/检索词/打开的详情/AI 进度全不丢)
  // 语言重渲专用:renderMain/renderCols 整清重建 → 两栏 scrollTop 归零。切语言只换文案,
  // 不该把用户滚到的位置弹回顶部;切集合 / 开详情等正常路径仍然该回顶,所以只在这一条路径上补。
  const sideEl = root.querySelector('.zt-side')
  const rerender = () => {
    const mTop = (mainEl && mainEl.scrollTop) || 0
    const sTop = (sideEl && sideEl.scrollTop) || 0
    renderStatics(); renderConn(); renderCols(); renderMain()
    try { if (mainEl) mainEl.scrollTop = mTop; if (sideEl) sideEl.scrollTop = sTop } catch { /* ignore */ }
  }
  rerenders.add(rerender)

  rerender()
  healIndex().then((idx) => { S.index = idx; if (!S.detail) renderMain() }) // 打开时索引自愈
  refreshConn()

  return () => {
    rerenders.delete(rerender)
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
  const inp = document.createElement('input')
  inp.className = 'zt-input'
  const list = document.createElement('div')
  list.className = 'zt-picklist'
  const hint = document.createElement('div')
  hint.className = 'zt-pickhint'
  // 浮层里已输入的检索词不能因为切语言被丢掉:只换静态文案,不重建浮层
  let hintKey = 'pick_hint'
  let hintVars = null
  const refresh = () => {
    cap.textContent = hasBlockSurface() ? t('pick_cap_insert') : t('pick_cap_copy')
    inp.placeholder = t('pick_ph')
    hint.textContent = t(hintKey, hintVars)
  }
  const setHint = (k, vars) => { hintKey = k; hintVars = vars || null; hint.textContent = t(k, vars) }
  _pickerRefresh = refresh
  rerenders.add(refresh)
  refresh()
  let seq = 0
  async function search() {
    const q = inp.value.trim()
    if (!q) { setHint('pick_hint_enter'); return }
    const my = ++seq
    setHint('pick_searching')
    list.textContent = ''
    const r = await ztGet(qSearch(q))
    if (my !== seq) return
    if (!r.ok) { setHint('pick_err', { msg: r.error }); return }
    const items = parseItems(r.data)
    if (!items.length) { setHint('pick_nohit'); return }
    if (r.data.length >= 100) setHint('pick_truncated')
    else setHint('pick_count', { n: items.length })
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
// 贡献点标题是宿主单字符串面(无运行时重解析):这里取的是**注册那一刻**的语言,
// 用户切语言后命令面板/视图标签页标题要等宿主重启才跟上(已知缺口,README 有记)。
ctx.registerView?.({ id: 'library', title: t('view_title'), mount: mountLibrary, singleton: true })
ctx.registerCommand({
  id: 'zotero-open', title: t('cmd_open'), keywords: 'zotero 文献 literature 论文 paper 引用 cite',
  run: () => { if (ctx.openView) ctx.openView('library'); else say(t('msg_view_unsupported'), { level: 'warning' }) },
})
ctx.registerCommand({
  id: 'zotero-cite', title: t('cmd_cite'), keywords: 'zotero cite 引用 文献 citation',
  run: () => openCitePicker(),
})

if (globalThis.__ZOTERO_TEST__) {
  Object.assign(globalThis.__ZOTERO_TEST__, {
    fmVal, yearOf, lastNameOf, joinCreators, uiAuthors, diskTitle, uiTitle, firstAuthorLast, authorCite, slugTitle, sanitizeFileName, citeName,
    parseItem, parseItems, parseCollections, collectionTree, parseAnnotations, findPdfAttachment, colorName, annLines,
    buildNoteMd, parseNoteMeta, extractZannKeys, splitMyNotes, mergeAnnotations, upsertAiSection, buildCitation,
    buildLitreviewMessage, parseLitreview, today, safeHref, portOf, apiBase, qConn, qAllItems, qSearch, qCollections, qColItems, qChildren,
    ztGet, readIndex, writeIndex, healIndex, ensureNote, importAnnotations, insertCite, hasBlockSurface, baseNameOf,
    stripZann, openNoteInEditor, writeNote, openZoteroUri, fmQ,
    escapeBib, bibVerbatim, protectCase, pickCreators, bibNames, cslNames, bibPages, cslPages, bareDoi, urlDate, dateParts,
    entryType, cslType, keySeg, bibKeyBase, suffixLetters, assignKeys, toBibtex, toCslJson, bibFile, cslFile,
    exportBaseName, exportBib, copyText,
    buildItemRow, buildDetailCard, onColorOf, readableOn, contrast,
    MSG, L, t, fmtDate, mountLibrary, openCitePicker,
  })
}

return () => {
  if (offLocale) { try { offLocale() } catch { /* ignore */ } }
  rerenders.clear()
  closeOverlays()
  try { if (_layer && _layer.remove) _layer.remove() } catch { /* ignore */ }
  _layer = null
  try { if (_styleEl && _styleEl.remove) _styleEl.remove() } catch { /* ignore */ }
  _styleEl = null
}
