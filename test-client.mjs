/**
 * dsh-plugin-catalog — Browser half 的自测（假 window/document/React/ModuleLoader）。
 * 运行：node test-client.mjs
 */
import assert from "node:assert/strict";

/* ─────────────── 假浏览器环境 ─────────────── */

let capturedDefinition;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			capturedDefinition = definition;
		}
	}
};

const styleElements = [];
globalThis.document = {
	head: { appendChild(element) { styleElements.push(element); } },
	createElement() {
		return {
			id: "",
			textContent: "",
			setAttribute() {},
			remove() {
				const index = styleElements.indexOf(this);
				if (index !== -1) styleElements.splice(index, 1);
			}
		};
	},
	getElementById(id) {
		return styleElements.find((element) => element.id === id) ?? null;
	}
};

/* ─────────────── 假 React ─────────────── */

let hookSlots = [];
let hookIndex = 0;
let effectQueue = [];

const React = {
	createElement(type, props, ...children) {
		return {
			type,
			props: { ...(props ?? {}), children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
		};
	},
	useState(initial) {
		const index = hookIndex++;
		if (!(index in hookSlots)) hookSlots[index] = typeof initial === "function" ? initial() : initial;
		const set = (next) => {
			hookSlots[index] = typeof next === "function" ? next(hookSlots[index]) : next;
		};
		return [hookSlots[index], set];
	},
	useEffect(effect) {
		effectQueue.push(effect);
	},
	useCallback(fn) {
		return fn;
	},
	useRef(value) {
		const index = hookIndex++;
		if (!(index in hookSlots)) hookSlots[index] = { current: value };
		return hookSlots[index];
	}
};

/** 让 factory 只拿到我们准备好的 React；其他模块一律报错，证明没有第三方依赖。 */
/** 假的原语图标组件：名字写进元素类型，方便断言。 */
function artwork(name) {
	return function FakeArtwork(props) {
		return { type: `artwork:${name}`, props };
	};
}

function requireStub(name) {
	if (name === "react") return React;
	if (name === "@deepseek-ai/dsh-client-ui-primitives") {
		return {
			PluginArtworkDefault: artwork("default"),
			PluginArtworkTerminal: artwork("terminal"),
			PluginArtworkLoop: artwork("loop"),
			PluginArtworkSubagent: artwork("subagent"),
			PluginArtworkSearch: artwork("search")
		};
	}
	throw new Error(`unexpected require: ${name}`);
}

/* ─────────────── 载入浏览器半身 ─────────────── */

await import("./client.js");
assert.equal(typeof capturedDefinition?.factory, "function", "ModuleLoader.load was called");
const plugin = capturedDefinition.factory(requireStub);
const test = plugin.__test;
assert.ok(test, "test hooks exported");

let passed = 0;
function check(name, fn) {
	fn();
	passed += 1;
	console.log(`ok ${passed} - ${name}`);
}
async function checkAsync(name, fn) {
	await fn();
	passed += 1;
	console.log(`ok ${passed} - ${name}`);
}

/* ─────────────── 测试数据 ─────────────── */

function makeApi(overrides = {}) {
	return {
		language: () => "zh",
		resolveText(value) {
			if (typeof value === "string") return value;
			if (value !== null && typeof value === "object") return value.zh ?? value.en ?? "";
			return "";
		},
		subscribe: () => () => {},
		dispose() {},
		listBundles: async () => [],
		listBuiltins: () => [],
		listIndexes: async () => [],
		search: async () => ({ entries: [] }),
		readSnapshot: async () => test.EMPTY_STATE,
		capture: async () => test.EMPTY_STATE,
		setBundleEnabled: async () => ({}),
		...overrides
	};
}

const api = makeApi();

const bundles = [
	{
		name: "dsh-cost-meter",
		version: "1.9.15",
		installed: true,
		official: false,
		enabled: true,
		meta: { title: { zh: "费用计量" }, description: { zh: "记录用量与费用" } },
		description: ""
	},
	{
		name: "dsh-pet",
		version: "0.3.7",
		installed: true,
		official: false,
		enabled: true,
		meta: { title: { zh: "桌面宠物" } },
		description: "桌宠"
	},
	{
		name: "dsh-armory",
		version: "2.1.0",
		installed: true,
		official: false,
		enabled: false,
		meta: { title: { zh: "军火库" } },
		description: "工具集"
	},
	{
		name: "@deepseek-ai/dsh-base",
		version: "0.2.1-rc.2",
		installed: true,
		official: true,
		enabled: true,
		meta: { title: { zh: "基础" } }
	},
	{
		name: "dsh-local-only",
		version: "0.0.1",
		installed: true,
		official: false,
		enabled: true,
		meta: { title: { zh: "本地插件" } },
		description: "本地安装、市场未收录"
	}
];

const snapshot = {
	version: 1,
	updatedAt: 1792600000000,
	categories: { usage: { zh: "用量与计费", en: "Usage" }, tools: { zh: "工具与能力" }, fun: { zh: "娱乐" } },
	categoryOrder: ["usage", "tools", "fun"],
	packages: {
		"dsh-cost-meter": {
			name: "dsh-cost-meter",
			listed: true,
			categoryId: "usage",
			category: { zh: "用量与计费" },
			version: "1.9.15",
			keywords: ["cost", "billing"],
			author: "acme"
		},
		"dsh-pet": { name: "dsh-pet", listed: true, categoryId: "fun", category: { zh: "娱乐" }, version: "0.3.7", keywords: ["pet"] },
		"dsh-armory": { name: "dsh-armory", listed: true, categoryId: "tools", version: "2.1.0" }
	}
};

/* ─────────────── 纯函数 ─────────────── */

check("shortName strips scope and dsh prefixes", () => {
	assert.equal(test.shortName("@scope/dsh-foo"), "foo");
	assert.equal(test.shortName("dsh-armory"), "armory");
	assert.equal(test.shortName("@deepseek-ai/dsh-client-ui-chat"), "ui-chat");
	assert.equal(test.shortName("plain"), "plain");
});

check("searchTerms normalizes and splits", () => {
	assert.deepEqual(test.searchTerms("  DSH  Pet "), ["dsh", "pet"]);
	assert.deepEqual(test.searchTerms(""), []);
	assert.deepEqual(test.searchTerms("用量"), ["用量"]);
});

check("groupBundles groups by recorded category, in market order", () => {
	const { groups, matched } = test.groupBundles(bundles, snapshot, "", api);
	assert.equal(matched, 5);
	assert.deepEqual(
		groups.map((group) => group.id),
		["usage", "tools", "fun", "__experimental__", "__uncategorized__"]
	);
	assert.equal(groups[0].title.zh, "用量与计费");
	assert.equal(groups[0].items[0].bundle.name, "dsh-cost-meter");
	assert.equal(groups[1].items[0].bundle.name, "dsh-armory");
	assert.equal(groups[2].items[0].bundle.name, "dsh-pet");
	assert.equal(groups[3].items[0].bundle.name, "@deepseek-ai/dsh-base");
	assert.equal(groups[4].items[0].bundle.name, "dsh-local-only");
});

check("official bundles go to Experimental and plugins.item entries go to Built-in", () => {
	const builtins = [
		{ id: "agent-loop", title: "Agent 循环", order: 30 },
		{ id: "web-search", title: "网页搜索", order: 20 }
	];
	const { groups, matched } = test.groupBundles(bundles, snapshot, "", api, {
		builtins,
		labels: { builtin: "内置", experimental: "实验性" }
	});
	assert.equal(matched, 7);
	const builtin = groups.find((group) => group.id === "__builtin__");
	assert.ok(builtin);
	assert.equal(builtin.title, "内置");
	const builtinTitles = builtin.items.map((item) => item.title);
	assert.ok(builtinTitles.includes("Agent 循环"));
	assert.ok(builtinTitles.includes("网页搜索"));
	assert.deepEqual(
		builtin.items.map((item) => item.id),
		["web-search", "agent-loop"],
		"built-in items keep their registration order"
	);
	assert.equal(builtin.items[0].kind, "item");
	const experimental = groups.find((group) => group.id === "__experimental__");
	assert.ok(experimental);
	assert.equal(experimental.title, "实验性");
	assert.equal(experimental.items[0].bundle.name, "@deepseek-ai/dsh-base");
});

check("search covers built-in labels and experimental titles", () => {
	const builtins = [{ id: "agent-loop", title: "Agent 循环", order: 30 }];
	const options = { builtins, labels: { builtin: "内置", experimental: "实验性" } };
	assert.equal(test.groupBundles(bundles, snapshot, "循环", api, options).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "基础", api, options).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "实验性", api, options).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "内置", api, options).matched, 1);
});

check("groupBundles searches names, titles, descriptions, keywords and categories", () => {
	assert.equal(test.groupBundles(bundles, snapshot, "cost", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "桌面", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "billing", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "娱乐", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "工具集", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "zzz", api).matched, 0);
	assert.deepEqual(test.groupBundles(bundles, snapshot, "zzz", api).groups, []);
});

check("groupBundles requires every search term", () => {
	assert.equal(test.groupBundles(bundles, snapshot, "dsh pet", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "dsh cost", api).matched, 1);
	assert.equal(test.groupBundles(bundles, snapshot, "dsh zzz", api).matched, 0);
});

check("a record without a category falls into Uncategorized", () => {
	const partial = { ...snapshot, packages: { ...snapshot.packages, "dsh-pet": { ...snapshot.packages["dsh-pet"], categoryId: null, listed: false } } };
	const { groups } = test.groupBundles(bundles, partial, "pet", api);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].id, "__uncategorized__");
});

/* ─────────────── 市场分类抓取 ─────────────── */

await checkAsync("captureCategories records found, unlisted and skips unanswered packages", async () => {
	let posted;
	let calls = 0;
	const captureApi = makeApi({
		listIndexes: async () => [{ url: "https://market.test/index.json" }, { url: "https://broken.test/index.json", error: "bad" }],
		search: async (url, text) => {
			calls += 1;
			assert.equal(url, "https://market.test/index.json");
			if (text === "dsh-pet") throw new Error("network down");
			if (text === "dsh-cost-meter") {
				return {
					title: { zh: "插件市场" },
					metadata: { categories: { usage: { title: { zh: "用量与计费", en: "Usage & Billing" } } } },
					entries: [{ name: "dsh-cost-meter", author: "acme", metadata: { category: "usage", keywords: ["cost"] } }]
				};
			}
			if (text === "dsh-armory") {
				return { title: { zh: "插件市场" }, metadata: { categories: { usage: { title: { zh: "用量与计费" } } } }, entries: [] };
			}
			return { title: { zh: "插件市场" }, metadata: {}, entries: [] };
		},
		capture: async (body) => {
			posted = body;
			return { version: 1, updatedAt: 1, categories: body.categories, categoryOrder: body.categoryOrder, packages: {} };
		}
	});
	const outcome = await test.captureCategories(captureApi, bundles.slice(0, 3), "capture", "backfill");
	assert.equal(outcome.unavailable, false);
	assert.equal(calls, 3, "only usable indexes are queried; each package asked once");
	assert.equal(posted.mode, "capture");
	assert.equal(posted.packages.length, 2);
	const cost = posted.packages.find((record) => record.name === "dsh-cost-meter");
	assert.equal(cost.listed, true);
	assert.equal(cost.categoryId, "usage");
	assert.equal(cost.author, "acme");
	assert.deepEqual(cost.keywords, ["cost"]);
	assert.equal(cost.source, "backfill");
	const armory = posted.packages.find((record) => record.name === "dsh-armory");
	assert.equal(armory.listed, false);
	assert.equal(armory.categoryId, null);
	assert.equal(posted.packages.find((record) => record.name === "dsh-pet"), undefined, "an unanswered package is not marked unlisted");
	assert.deepEqual(posted.categoryOrder, ["usage"]);
	assert.equal(posted.categories.usage.zh, "用量与计费");
});

await checkAsync("captureCategories reports unavailable without a usable index", async () => {
	let posted = false;
	const captureApi = makeApi({
		listIndexes: async () => [],
		capture: async () => {
			posted = true;
			return test.EMPTY_STATE;
		}
	});
	const outcome = await test.captureCategories(captureApi, bundles, "capture", "download");
	assert.equal(outcome.unavailable, true);
	assert.equal(posted, false);
});

/* ─────────────── 渲染 ─────────────── */

function flatten(tree, output = []) {
	if (tree === null || tree === undefined) return output;
	if (typeof tree === "string" || typeof tree === "number") {
		output.push(String(tree));
		return output;
	}
	if (Array.isArray(tree)) {
		for (const child of tree) flatten(child, output);
		return output;
	}
	if (typeof tree.type === "function") {
		flatten(tree.type(tree.props), output);
		return output;
	}
	output.push(tree);
	flatten(tree.props?.children, output);
	return output;
}

check("PluginCard renders title, name, tags and description", () => {
	const item = { bundle: bundles[0], record: snapshot.packages["dsh-cost-meter"], title: "费用计量", haystack: "" };
	const tree = test.PluginCard({ item, t: (key) => key, api, onOpenBundle() {} });
	const nodes = flatten(tree);
	const texts = nodes.filter((node) => typeof node === "string");
	assert.ok(texts.includes("费用计量"));
	assert.ok(texts.includes("dsh-cost-meter"));
	assert.ok(texts.includes("v1.9.15"));
	assert.ok(texts.includes("记录用量与费用"));
	const button = nodes.find((node) => node.type === "button");
	assert.equal(button.props.className, "dshpc-cardOpen");
	assert.ok(button.props["aria-label"].includes("费用计量"));
	const toggle = nodes.find((node) => node.props?.role === "switch");
	assert.ok(toggle, "the card keeps an enable switch");
	assert.equal(toggle.props["aria-checked"], true);
});

check("PluginCard marks disabled, official and error bundles", () => {
	const item = { bundle: { ...bundles[2], official: true, enabled: false, error: { code: "not-bundle" } }, title: "军火库", haystack: "" };
	const nodes = flatten(test.PluginCard({ item, t: (key) => key, api, onOpenBundle() {} }));
	const texts = nodes.filter((node) => typeof node === "string");
	assert.ok(texts.includes("experimentalTag"));
	assert.ok(texts.includes("disabled"));
	assert.ok(texts.includes("errorTag"));
	const toggle = nodes.find((node) => node.props?.role === "switch");
	assert.equal(toggle.props["aria-checked"], false);
});

check("PluginCard renders a built-in item without a switch", () => {
	const item = { kind: "item", id: "agent-loop", title: "Agent 循环", haystack: "" };
	const nodes = flatten(test.PluginCard({ item, t: (key) => key, api, onOpenItem() {}, onOpenBundle() {} }));
	const button = nodes.find((node) => node.type === "button");
	assert.equal(button.props.className, "dshpc-cardOpen");
	assert.ok(button.props["aria-label"].includes("Agent 循环"));
	assert.equal(nodes.some((node) => node.props?.role === "switch"), false);
});

check("cards use official artwork and fall back to the default art", () => {
	const itemNodes = flatten(
		test.PluginCard({
			item: { kind: "item", id: "agent-loop", title: "Agent 循环", haystack: "" },
			t: (key) => key,
			api,
			onOpenItem() {},
			onOpenBundle() {}
		})
	);
	assert.ok(itemNodes.some((node) => node.type === "artwork:loop"), "built-in item uses its own artwork");
	const bundleNodes = flatten(
		test.PluginCard({
			item: { kind: "bundle", bundle: { name: "dsh-x", meta: {}, version: "1.0.0", enabled: true }, title: "X", haystack: "" },
			t: (key) => key,
			api,
			onOpenItem() {},
			onOpenBundle() {}
		})
	);
	assert.ok(bundleNodes.some((node) => node.type === "artwork:default"), "a bundle without an icon gets the default art");
	const iconNodes = flatten(
		test.PluginCard({
			item: {
				kind: "bundle",
				bundle: { name: "dsh-y", meta: { icon: "data:image/svg+xml;base64,AAAA" }, version: "1.0.0", enabled: true },
				title: "Y",
				haystack: ""
			},
			t: (key) => key,
			api,
			onOpenItem() {},
			onOpenBundle() {}
		})
	);
	assert.ok(iconNodes.some((node) => node.type === "img" && String(node.props.src).startsWith("data:")), "a data icon renders as an image");
});

check("GroupSection renders a collapsible header and its cards", () => {
	const group = { id: "usage", title: { zh: "用量与计费" }, items: [{ bundle: bundles[0], title: "费用计量", haystack: "" }] };
	const tree = test.GroupSection({ group, t: (key) => key, api, onOpenBundle() {}, busyNames: new Set(), onToggleBundle() {}, collapsed: new Set(), onToggle() {} });
	const nodes = flatten(tree);
	const buttons = nodes.filter((node) => node.type === "button");
	assert.equal(buttons[0].props["aria-expanded"], true);
	assert.ok(nodes.some((node) => node.type === "ul"));
	const texts = nodes.filter((node) => typeof node === "string");
	assert.ok(texts.includes("用量与计费"));
});

check("GroupSection hides the list when collapsed", () => {
	const group = { id: "usage", title: { zh: "用量与计费" }, items: [{ bundle: bundles[0], title: "费用计量", haystack: "" }] };
	const tree = test.GroupSection({ group, t: (key) => key, api, onOpenBundle() {}, busyNames: new Set(), onToggleBundle() {}, collapsed: new Set(["usage"]), onToggle() {} });
	const buttons = flatten(tree).filter((node) => node.type === "button");
	assert.equal(buttons[0].props["aria-expanded"], false);
	assert.equal(flatten(tree).some((node) => node.type === "ul"), false);
});

check("Uncategorized group title comes from the dictionary", () => {
	const group = { id: "__uncategorized__", title: "", items: [{ bundle: bundles[3], title: "基础", haystack: "" }] };
	const texts = flatten(test.GroupSection({ group, t: (key) => key, api, onOpenBundle() {}, busyNames: new Set(), onToggleBundle() {}, collapsed: new Set(), onToggle() {} })).filter(
		(node) => typeof node === "string"
	);
	assert.ok(texts.includes("uncategorized"));
	assert.ok(texts.includes("uncategorizedHint"));
});

/* ─────────────── 整页挂载（假 hooks + effect 循环） ─────────────── */

await checkAsync("InstalledOverview loads, renders groups and the search box", async () => {
	const mountApi = makeApi({
		listBundles: async () => bundles,
		listBuiltins: () => [{ id: "agent-loop", title: "Agent 循环", order: 30 }],
		readSnapshot: async () => snapshot
	});
	hookSlots = [];
	hookIndex = 0;
	effectQueue = [];
	const props = { t: (key) => key, api: mountApi, onOpenBundle() {}, onOpenItem() {} };
	let tree = test.InstalledOverview(props);
	for (let pass = 0; pass < 6; pass += 1) {
		const pending = effectQueue;
		effectQueue = [];
		for (const effect of pending) effect();
		await new Promise((resolve) => setTimeout(resolve, 10));
		hookIndex = 0;
		tree = test.InstalledOverview(props);
	}
	const nodes = flatten(tree);
	const input = nodes.find((node) => node.type === "input");
	assert.ok(input, "search input rendered");
	assert.equal(input.props.type, "search");
	assert.equal(input.props.placeholder, "searchPlaceholder");
	assert.equal(input.props["aria-label"], "searchLabel");
	const texts = nodes.filter((node) => typeof node === "string");
	assert.ok(texts.includes("用量与计费"));
	assert.ok(texts.includes("工具与能力"));
	assert.ok(texts.includes("娱乐"));
	assert.ok(texts.includes("uncategorized"));
	assert.ok(texts.includes("experimentalCategory"));
	assert.ok(texts.includes("builtinCategory"));
	assert.ok(texts.includes("Agent 循环"));
	assert.ok(texts.includes("dsh-cost-meter"));
});

/* ─────────────── 注册 ─────────────── */

check("apply registers the installed overview and injects a stable face", () => {
	let injectedSlot;
	const registrations = [];
	const effects = [];
	let dictionaries;
	const ctx = {
		locale: {
			register(namespace, dictionary) {
				dictionaries = { namespace, dictionary };
				return () => {};
			},
			bind(namespace) {
				return (key) => `${namespace}.${key}`;
			}
		},
		effect(fn, label) {
			effects.push({ label, dispose: fn() });
		},
		slots: {
			inject(slot, register) {
				injectedSlot = slot;
				register();
			},
			register(options, component) {
				registrations.push({ options, component });
				return () => {};
			}
		},
		remote: {
			$on() {
				return () => {};
			},
			pluginManager: { listBundles: async () => ({ ok: true, value: [] }) },
			pluginMarket: { listIndexes: async () => ({ ok: true, value: [] }), search: async () => ({ ok: true, value: { entries: [] } }) }
		}
	};
	plugin.apply(ctx);
	assert.equal(injectedSlot, "plugins.overview");
	assert.equal(registrations.length, 1);
	const { options, component } = registrations[0];
	assert.equal(options.name, "plugins.overview");
	assert.equal(options.id, "catalog");
	assert.equal(options.order, 1);
	assert.equal(options.locale, "pluginCatalog");
	assert.equal(options.label, undefined, "an overview entry is not a tab");
	assert.equal(component, test.InstalledOverview);
	const face = options.inject();
	assert.equal(typeof face.api.capture, "function");
	assert.equal(typeof face.api.setBundleEnabled, "function");
	assert.equal(options.inject(), face, "the same face object keeps the renderer cache stable");
	assert.equal(dictionaries.namespace, "pluginCatalog");
	assert.ok(dictionaries.dictionary.zh.installedTitle === "已安装插件");
	assert.equal(styleElements.length, 1, "one stylesheet installed");
	// 生命周期 effect 的清理不应抛错
	for (const effect of effects) effect.dispose?.();
});

check("apply degrades gracefully without slots", () => {
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (message) => warnings.push(String(message));
	try {
		plugin.apply({
			locale: { register: () => () => {}, bind: () => (key) => key },
			effect(fn) {
				fn();
			},
			remote: {}
		});
	} finally {
		console.warn = originalWarn;
	}
	assert.ok(warnings.some((message) => message.includes("slots")));
});

console.log(`\n${passed} assertions passed`);
