import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/pages/admin/returnRoute.tsx", import.meta.url),
  "utf8",
);

test("联通线路选择使用 CUG 名称且不再暴露独立 10099", () => {
  assert.match(
    source,
    /unicom:\s*\["CUG VIP",\s*"CUG 优化",\s*"9929",\s*"4837"\]/,
  );
  assert.doesNotMatch(source, /unicom:\s*\[[^\]]*"10099"/);
});

test("编辑表单只在打开弹窗时读取任务数据", () => {
  assert.match(
    source,
    /const handleOpenChange = \(nextOpen: boolean\) => \{\s*if \(nextOpen\) \{\s*setForm\(toTaskForm\(task\)\);\s*setSelectedClients\(task\?\.client \? \[task\.client\] : \[\]\);\s*\}\s*setOpen\(nextOpen\);\s*\};/,
  );
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => setForm\(toTaskForm\(task\)\), \[task, open\]\)/,
  );
});

test("新建任务使用原选择框外观进行节点多选", () => {
  assert.match(source, /const \[selectedClients, setSelectedClients\] = useState<string\[]>/);
  assert.match(source, /function MultiNodeSelect/);
  assert.match(source, /rt-reset rt-SelectTrigger rt-r-size-2 rt-variant-surface w-full/);
  assert.match(source, /padding: 4,[\s\S]*rounded-md px-2 py-2/);
  assert.match(source, /aria-hidden="true"[\s\S]*\{checked \? <Check size=\{16\} strokeWidth=\{2\.5\} \/> : null\}/);
  assert.match(source, /role="listbox"[\s\S]*aria-multiselectable="true"/);
  assert.match(source, /role="option"[\s\S]*aria-selected=\{checked\}/);
  assert.match(source, /hover:bg-\[var\(--accent-9\)\][\s\S]*focus-visible:bg-\[var\(--accent-9\)\]/);
  assert.doesNotMatch(source, /data-\[state=checked\]:(?:bg|text)-/);
  assert.match(source, /ref=\{listboxRef\}[\s\S]*tabIndex=\{-1\}[\s\S]*focus:outline-none/);
  assert.match(source, /if \(event\.detail > 0\) \{\s*listboxRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /<MultiNodeSelect[\s\S]*value=\{selectedClients\}[\s\S]*onChange=\{setSelectedClients\}/);
  assert.doesNotMatch(source, /<NodeSelectorDialog/);
  assert.match(source, /for \(const client of clients\) \{[\s\S]*request\([\s\S]*"\/add"/);
  assert.match(source, /if \(task\?\.id\) \{\s*await request\("\/edit", toTaskPayload\(form\)\)/);
  assert.doesNotMatch(source, /find\([^\n]*carrier[^\n]*target/);
});

test("任务列表提供明确勾选和后端批量修改入口", () => {
  assert.match(source, /const \[selectedTaskIDs, setSelectedTaskIDs\] = useState<Set<number>>/);
  assert.match(source, /allVisibleTasksSelected \? "取消全选" : "全选"/);
  assert.match(source, /<span className="sr-only">选择<\/span>/);
  assert.doesNotMatch(source, /选择当前页全部任务/);
  assert.match(source, /<RouteTaskBatchDialog/);
  assert.match(source, />批量修改/);
  assert.match(source, /request\("\/edit\/batch", \{ ids, \.\.\.toTaskBatchPayload\(form\) \}\)/);
  assert.match(source, /任务名称和各自的探测节点保持不变/);
});

test("回程任务、记录和规则表格使用圆角边框并适配手机卡片", () => {
  assert.match(source, /admin-responsive-table-wrap overflow-hidden rounded-md border border-\[var\(--gray-a5\)\]/);
  assert.match(source, /className="admin-responsive-table w-full min-w-\[1120px\]/);
  assert.match(source, /data-label="任务 \/ 节点"/);
  assert.match(source, /data-label="线路变化"/);
  assert.match(source, /data-label="操作" className="p-3"><Flex justify="start"/);
  assert.match(source, /<th className="py-3 pl-6 pr-3">操作<\/th>/);
  assert.doesNotMatch(source, /<th className="p-3 text-right">操作<\/th>/);
});

test("手机端回程任务把同一字段的主次信息保持在同一内容列", () => {
  assert.match(source, /data-label="任务 \/ 节点"[\s\S]*return-route-cell-pair/);
  assert.match(source, /data-label="运营商 \/ 地区"[\s\S]*return-route-cell-pair/);
  assert.match(source, /data-label="线路"[\s\S]*return-route-cell-pair/);
  assert.match(source, /data-label="最后探测"[\s\S]*return-route-cell-pair/);
  assert.match(source, /data-label="状态"[\s\S]*return-route-cell-content/);
});

test("CN2 待确认不显示切线确认次数", () => {
  assert.match(source, /status\.candidate_line === "CN2 待确认" \? null/);
  assert.match(source, /status\.candidate_count\}\/\{needed\}/);
});
