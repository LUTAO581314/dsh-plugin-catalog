/**
 * dsh-plugin-catalog — Browser half.
 *
 * 在「插件 → 已安装」页贡献分类视图：
 *   1. 搜索已安装插件（名称、标题、描述、作者、关键词、分类都可搜）；
 *   2. 按插件下载时所属的插件市场分类分组。
 *
 * 分类来自宿主插件 `pluginMarket`（`ctx.remote.pluginMarket.search`），由宿主半身
 * 持久化在 `$DSH_HOME/dsh-plugin-catalog/state.json`：
 *   - 首次看到某个插件时记下它当时在市场里的分类（旧插件在首次打开本页时回填）；
 *   - 同一版本不会被后来的市场改分类覆盖；
 *   - 升级到新版本视为一次新的下载，才重新记录；
 *   - 用户可以显式「重新同步分类」。
 *
 * 这个视图注册进 `plugins.overview`，即插件页「已安装」列表的上方；它出现时用
 * `body:has(.dshpc-root) [data-plugin-group="bundles"]` 隐藏页面自带的「已安装插件」
 * 分组，避免两份列表。宽度与页面其它区块一致（max-width: 960px）。
 *
 * 与 dsh-custom-style 同口径：手写、无构建、只用 DOM/fetch/平台 React，
 * 样式通过自己的 <style data-plugin-css="dsh-plugin-catalog"> 注入。
 */

window.__ModuleLoader__.load({
	id: "@lutao581314/dsh-plugin-catalog",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		/** React 来自平台冻结的模块表；取不到时整个标签页降级为空。 */
		let react;
		try {
			react = require("react");
		} catch {
			react = undefined;
		}
		const R = react === undefined ? undefined : typeof react.useState === "function" ? react : react.default;
		const h = R === undefined ? undefined : R.createElement;
		const { useCallback, useEffect, useRef, useState } = R ?? {};

		/** 官方插件图标来自平台原语；取不到时退回首字。 */
		let primitives = {};
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives") ?? {};
		} catch {
			primitives = {};
		}
		const DefaultArtwork = typeof primitives.PluginArtworkDefault === "function" ? primitives.PluginArtworkDefault : undefined;
		const BUILTIN_ARTWORK = new Map([
			["shell", primitives.PluginArtworkTerminal],
			["agent-loop", primitives.PluginArtworkLoop],
			["subagent", primitives.PluginArtworkSubagent],
			["web-search", primitives.PluginArtworkSearch]
		]);

		/** 字典命名空间。 */
		const NS = "pluginCatalog";
		/** 宿主半身的路由前缀。 */
		const ROUTE = "/dsh-plugin-catalog";
		/** 样式表标记（与官方插件同一套 data-plugin-css 约定）。 */
		const STYLE_ID = "dsh-plugin-catalog";
		const STYLE_ELEMENT_ID = "dsh-plugin-catalog/style";
		/** 「未分类」分组的键。 */
		const UNCATEGORIZED = "__uncategorized__";
		/** 「内置」分组的键（plugins.item 贡献的官方配置项）。 */
		const BUILTIN = "__builtin__";
		/** 「实验性」分组的键（official bundle）。 */
		const EXPERIMENTAL = "__experimental__";
		/** 一次从插件市场查分类时并发数。 */
		const SEARCH_CONCURRENCY = 3;

		const zh = {
			installedTitle: "已安装插件",
			title: "已安装插件",
			intro: "按下载时插件市场的分类分组；搜索名称、描述、作者或关键词。",
			searchPlaceholder: "搜索已安装插件…",
			searchLabel: "搜索已安装插件",
			clearSearch: "清除搜索",
			refresh: "刷新",
			refreshing: "刷新中…",
			capturing: "正在读取插件市场分类…",
			summary: "共 {plugins} 个插件 · {categories} 个分类 · 匹配 {matched} 个",
			capturedAt: "分类记录于 {when}",
			resync: "重新同步分类",
			confirmSync: "确认按当前市场重新分类",
			cancel: "取消",
			uncategorized: "未分类",
			uncategorizedHint: "市场索引里没有收录这些第三方插件",
			builtinCategory: "内置",
			builtinHint: "DSH 自带插件的配置入口",
			experimentalCategory: "实验性",
			experimentalHint: "DSH 随附的可选组合包",
			builtinTag: "内置",
			experimentalTag: "实验性",
			noPlugins: "还没有已安装的插件。",
			noMatch: "没有匹配「{query}」的插件。",
			loadFailed: "读取插件列表失败：{error}",
			retry: "重试",
			official: "官方",
			disabled: "已停用",
			errorTag: "异常",
			open: "打开插件详情",
			enable: "启用插件",
			disable: "停用插件",
			toggleFailed: "切换插件启用状态失败：{error}",
			marketUnavailable: "插件市场索引不可用，分类沿用上一次记录。",
			captureFailed: "读取市场分类失败，稍后会自动重试。",
			sourceNote: "分类在插件从市场下载时记录；升级到新版本会重新记录。DSH 自带的插件归入「内置」或「实验性」，市场未收录的第三方插件归入「未分类」。",
			loading: "正在读取已安装插件…",
			groupCount: "{count} 个"
		};

		const en = {
			installedTitle: "Installed plugins",
			title: "Installed plugins",
			intro: "Grouped by the plugin-market category they were downloaded under. Search names, descriptions, authors or keywords.",
			searchPlaceholder: "Search installed plugins…",
			searchLabel: "Search installed plugins",
			clearSearch: "Clear search",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			capturing: "Reading market categories…",
			summary: "{plugins} plugins · {categories} categories · {matched} matching",
			capturedAt: "Categories recorded {when}",
			resync: "Re-sync categories",
			confirmSync: "Re-classify with the current market",
			cancel: "Cancel",
			uncategorized: "Uncategorized",
			uncategorizedHint: "These third-party plugins are not listed in the market index",
			builtinCategory: "Built-in",
			builtinHint: "Configuration entries for plugins that ship with DSH",
			experimentalCategory: "Experimental",
			experimentalHint: "Optional bundles that ship with DSH",
			builtinTag: "Built-in",
			experimentalTag: "Experimental",
			noPlugins: "No plugins are installed yet.",
			noMatch: "No plugin matches \u201c{query}\u201d.",
			loadFailed: "Could not read the plugin list: {error}",
			retry: "Retry",
			official: "Official",
			disabled: "Disabled",
			errorTag: "Error",
			open: "Open plugin details",
			enable: "Enable plugin",
			disable: "Disable plugin",
			toggleFailed: "Could not change the plugin state: {error}",
			marketUnavailable: "The plugin-market index is unavailable; categories keep their last recorded values.",
			captureFailed: "Could not read market categories. This will be retried later.",
			sourceNote: "A category is recorded when the plugin is downloaded from the market; a version update records it again. Plugins that ship with DSH are grouped as Built-in or Experimental; third-party plugins missing from the market are Uncategorized.",
			loading: "Reading installed plugins…",
			groupCount: "{count}"
		};

		/* ─────────────── 样式 ─────────────── */

		const CSS = [
			".dshpc-root{display:flex;flex-direction:column;gap:14px;width:100%;max-width:960px;box-sizing:border-box;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
			".dshpc-head{display:flex;flex-wrap:wrap;gap:10px 20px;justify-content:space-between;align-items:flex-end}",
			".dshpc-headCopy{min-width:0}",
			".dshpc-title{margin:0;font-size:15px;font-weight:600;line-height:22px}",
			".dshpc-intro{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dshpc-tools{display:flex;align-items:center;gap:8px;flex:none}",
			".dshpc-search{position:relative;display:inline-flex;align-items:center;width:248px;max-width:70vw}",
			".dshpc-search input{box-sizing:border-box;width:100%;height:32px;padding:0 28px 0 30px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;outline:none;appearance:none}",
			".dshpc-search input::placeholder{color:var(--dsw-alias-label-tertiary)}",
			".dshpc-search input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}",
			".dshpc-searchIcon{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:1;pointer-events:none}",
			".dshpc-clear{position:absolute;right:4px;width:22px;height:22px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}",
			".dshpc-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dshpc-btn{height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;white-space:nowrap}",
			".dshpc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dshpc-btn:disabled{opacity:.55;cursor:default}",
			".dshpc-btn:focus-visible,.dshpc-link:focus-visible,.dshpc-card:focus-visible,.dshpc-groupHead:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
			".dshpc-status{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dshpc-spacer{flex:1}",
			".dshpc-busy{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}",
			".dshpc-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dshpc-pulse 1.4s ease-in-out infinite}",
			"@keyframes dshpc-pulse{0%,100%{opacity:.35}50%{opacity:1}}",
			".dshpc-link{border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer;padding:0}",
			".dshpc-link:hover{text-decoration:underline}",
			".dshpc-confirm{display:inline-flex;align-items:center;gap:8px}",
			".dshpc-note{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".dshpc-groups{display:flex;flex-direction:column;gap:14px}",
			".dshpc-group{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".dshpc-groupHead{display:flex;align-items:center;gap:8px;width:100%;padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left}",
			".dshpc-groupHead:hover .dshpc-groupTitle{color:var(--dsw-alias-state-business-primary)}",
			".dshpc-chevron{width:12px;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;flex:none;font-size:10px}",
			".dshpc-groupHead[aria-expanded=\"true\"] .dshpc-chevron{transform:rotate(90deg)}",
			".dshpc-groupTitle{font-size:13.5px;font-weight:600;line-height:20px}",
			".dshpc-count{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}",
			".dshpc-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}",
			".dshpc-cards{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}",
			".dshpc-card{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;margin:0 -8px;padding:8px;border-radius:var(--dsw-radius-xl);background:transparent;color:inherit;min-width:0}",
			".dshpc-card:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dshpc-cardOpen{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:0;border:0;border-radius:var(--dsw-radius-lg);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
			".dshpc-cardOpen:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
			".dshpc-icon{width:40px;height:40px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);overflow:hidden;font-size:15px;font-weight:600}",
			".dshpc-icon img{width:100%;height:100%;object-fit:contain}",
			".dshpc-monogram{font-size:15px;font-weight:600;line-height:1}",
			".dshpc-cardMain{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}",
			".dshpc-titleRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}",
			".dshpc-cardTitle{font-size:13.5px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}",
			".dshpc-tag{padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px;white-space:nowrap}",
			".dshpc-tagOff{opacity:.8}",
			".dshpc-tagError{background:var(--dsw-alias-state-error-primary);color:#fff}",
			".dshpc-cardName{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshpc-cardDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}",
			".dshpc-arrow{flex:none;color:var(--dsw-alias-label-tertiary);font-size:16px;opacity:0;transition:opacity .12s}",
			".dshpc-card:hover .dshpc-arrow{opacity:1}",
			".dshpc-switch{position:relative;flex:none;width:34px;height:20px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;transition:background .15s ease,border-color .15s ease}",
			".dshpc-switch::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff);box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}",
			".dshpc-switch[aria-checked=\"true\"]{background:var(--dsw-alias-state-business-primary);border-color:transparent}",
			".dshpc-switch[aria-checked=\"true\"]::after{transform:translateX(14px)}",
			".dshpc-switch:disabled{opacity:.5;cursor:default}",
			".dshpc-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}",
			"body[data-dsh-catalog-ready=\"1\"] [data-plugin-group=\"bundles\"]{display:none !important}",
			"body[data-dsh-catalog-builtins=\"1\"] [data-plugin-group=\"basic\"]{display:none !important}",
			"body[data-dsh-catalog-experimental=\"1\"] [data-plugin-group=\"extensions\"]{display:none !important}",
			".dshpc-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:48px 0;text-align:center;color:var(--dsw-alias-label-tertiary)}",
			".dshpc-emptyTitle{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500}",
			".dshpc-skeleton{display:flex;align-items:center;gap:12px;padding:8px;margin:0 -8px}",
			".dshpc-skel{background:var(--dsw-alias-bg-skeleton);border-radius:var(--dsw-radius-xs);animation:dshpc-skel 2s ease-in-out infinite}",
			"@keyframes dshpc-skel{0%{opacity:1}40%{opacity:.55}80%,100%{opacity:1}}",
			".dshpc-skelIcon{width:40px;height:40px;border-radius:var(--dsw-radius-lg);flex:none}",
			".dshpc-skelLines{display:flex;flex-direction:column;gap:6px;flex:1}",
			".dshpc-skelLine{height:10px;width:60%;border-radius:4px}",
			".dshpc-skelLine.short{width:35%}",
			".dshpc-failure{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-state-error-primary);font-size:12.5px}",
			".dshpc-footNote{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin:0}",
			"@media (prefers-reduced-motion:reduce){.dshpc-dot,.dshpc-skel{animation:none}.dshpc-chevron,.dshpc-arrow{transition:none}}"
		].join("\n");

		/** 注入一次样式表。 */
		function installStyle() {
			if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ELEMENT_ID;
			style.setAttribute("data-plugin-css", STYLE_ID);
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		function removeStyle() {
			document.getElementById(STYLE_ELEMENT_ID)?.remove();
		}

		/* ─────────────── 纯函数 ─────────────── */

		const EMPTY_STATE = { version: 1, updatedAt: 0, categories: {}, categoryOrder: [], packages: {} };

		/** Remote 返回值解包：`{ ok, value }` / `{ ok:false, error }`，也容忍裸值。 */
		function unwrap(answer) {
			if (answer !== null && typeof answer === "object" && typeof answer.ok === "boolean" && ("value" in answer || "error" in answer)) {
				if (!answer.ok) {
					const error = answer.error;
					throw new Error(typeof error?.message === "string" ? error.message : typeof error?.code === "string" ? error.code : "remote call failed");
				}
				return answer.value;
			}
			return answer;
		}

		/** 同源 JSON 请求。 */
		async function requestJson(url, options) {
			const response = await fetch(url, {
				cache: "no-store",
				...options,
				headers: { accept: "application/json", ...(options?.headers ?? {}) }
			});
			if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
			const payload = await response.json();
			if (payload?.ok === false) throw new Error(typeof payload.error === "string" ? payload.error : "request refused");
			return payload;
		}

		/** 统一小写/兼容形式，供搜索比较。 */
		function normalize(value) {
			return typeof value === "string" ? value.normalize("NFKC").toLowerCase() : "";
		}

		/** 搜索词：空白分词，全部命中才算匹配。 */
		function searchTerms(query) {
			return normalize(query).split(/\s+/u).filter((term) => term !== "");
		}

		/** 去掉 scope 与 dsh 前缀的短名。 */
		function shortName(name) {
			const tail = typeof name === "string" ? name.slice(name.lastIndexOf("/") + 1) : "";
			const stripped = tail.replace(/^dsh(?:-host|-client)?-/u, "");
			return stripped === "" ? tail : stripped;
		}

		/** 并发受限的 map。 */
		async function mapLimit(items, limit, worker) {
			const results = new Array(items.length);
			let cursor = 0;
			const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
				for (;;) {
					const index = cursor;
					cursor += 1;
					if (index >= items.length) return;
					results[index] = await worker(items[index], index);
				}
			});
			await Promise.all(runners);
			return results;
		}

		/** 格式化时间。 */
		function formatTime(value, language) {
			if (!Number.isFinite(value) || value <= 0) return "";
			try {
				return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
			} catch {
				return new Date(value).toLocaleString();
			}
		}

		/** 分类标题：优先市场最新声明，其次记录时的标题，最后退回 id。 */
		function categoryLabel(snapshot, record) {
			if (record === undefined || record === null) return "";
			if (record.listed === false) return "";
			const id = record.categoryId;
			if (typeof id === "string" && id !== "") {
				const declared = snapshot.categories?.[id];
				if (declared !== undefined) return declared;
				if (record.category !== null && record.category !== undefined) return record.category;
				return id;
			}
			return "";
		}

		/** 插件的显示标题。 */
		function titleOf(bundle, api) {
			const fromMeta = api.resolveText(bundle.meta?.title);
			return fromMeta === "" ? shortName(bundle.name) || bundle.name : fromMeta;
		}

		/** 插件的显示描述。 */
		function descriptionOf(bundle, api) {
			const fromMeta = api.resolveText(bundle.meta?.description);
			if (fromMeta !== "") return fromMeta;
			return api.resolveText(bundle.description);
		}

		/** 一条卡片的搜索文本。 */
		function haystackOf(bundle, record, groupTitle, api) {
			const pieces = [
				bundle.name,
				shortName(bundle.name),
				api.resolveText(bundle.meta?.title),
				api.resolveText(bundle.description),
				api.resolveText(bundle.meta?.description),
				record?.author ?? "",
				...(Array.isArray(record?.keywords) ? record.keywords : []),
				typeof groupTitle === "string" ? groupTitle : api.resolveText(groupTitle)
			];
			return normalize(pieces.filter((piece) => typeof piece === "string" && piece !== "").join(" \u0000 "));
		}

		/**
		 * 把已安装插件、官方实验性组合包和内置配置项按分类分组并过滤。
		 * @param bundles - 社区插件与 official bundle 的混合列表。
		 * @param snapshot - 分类快照。
		 * @param query - 搜索词。
		 * @param api - 数据接口（resolveText/titleOf）。
		 * @param options - `{ builtins, labels }`：内置配置项与两个伪分类的标题。
		 * @returns `{ groups, matched }`；市场分类按声明顺序，其次是内置、实验性、未分类。
		 */
		function groupBundles(bundles, snapshot, query, api, options = {}) {
			const builtins = Array.isArray(options.builtins) ? options.builtins : [];
			const labels = options.labels ?? {};
			const terms = searchTerms(query);
			const records = snapshot.packages ?? {};
			const byCategory = new Map();
			const ensure = (key, title) => {
				let group = byCategory.get(key);
				if (group === undefined) {
					group = { id: key, title, items: [] };
					byCategory.set(key, group);
				}
				return group;
			};
			for (const bundle of bundles) {
				if (bundle.official === true) {
					const group = ensure(EXPERIMENTAL, labels.experimental ?? "");
					const title = titleOf(bundle, api);
					group.items.push({ kind: "bundle", bundle, title, haystack: haystackOf(bundle, undefined, group.title, api) });
					continue;
				}
				const record = records[bundle.name];
				const categoryId = typeof record?.categoryId === "string" && record.categoryId !== "" && record.listed !== false ? record.categoryId : null;
				const key = categoryId ?? UNCATEGORIZED;
				const group = ensure(key, categoryId === null ? "" : categoryLabel(snapshot, record));
				const title = titleOf(bundle, api);
				group.items.push({ kind: "bundle", bundle, record, title, haystack: haystackOf(bundle, record, group.title, api) });
			}
			for (const item of builtins) {
				const group = ensure(BUILTIN, labels.builtin ?? "");
				const title = item.title || item.id;
				group.items.push({
					kind: "item",
					id: item.id,
					title,
					order: Number.isFinite(item.order) ? item.order : 0,
					haystack: normalize([title, item.id, group.title].filter((piece) => typeof piece === "string" && piece !== "").join(" \u0000 "))
				});
			}
			const order = Array.isArray(snapshot.categoryOrder) ? snapshot.categoryOrder : [];
			const rank = (id) => {
				if (id === UNCATEGORIZED) return 300000;
				if (id === BUILTIN) return 200000;
				if (id === EXPERIMENTAL) return 200001;
				const index = order.indexOf(id);
				return index === -1 ? 100000 : index;
			};
			const groups = [];
			for (const group of byCategory.values()) {
				const items = group.items
					.filter((item) => terms.every((term) => item.haystack.includes(term)))
					.sort((left, right) => {
						if (left.kind === "item" && right.kind === "item") return (left.order ?? 0) - (right.order ?? 0);
						return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
					});
				if (items.length === 0) continue;
				groups.push({ ...group, items });
			}
			groups.sort((left, right) => {
				const delta = rank(left.id) - rank(right.id);
				if (delta !== 0) return delta;
				return String(left.id).localeCompare(String(right.id));
			});
			const matched = groups.reduce((sum, group) => sum + group.items.length, 0);
			return { groups, matched };
		}

		/* ─────────────── 数据接口 ─────────────── */

		function createApi(ctx) {
			const listeners = new Set();
			const disposers = [];
			const listen = (event, handler) => {
				try {
					const dispose = ctx.remote?.$on?.(event, handler);
					if (typeof dispose === "function") disposers.push(dispose);
				} catch {
					/* 事件不存在时忽略 */
				}
			};
			const notify = () => {
				for (const listener of [...listeners]) {
					try {
						listener();
					} catch {
						/* 单个订阅者的异常不影响其他人 */
					}
				}
			};
			listen("plugin-manager/changed", notify);
			listen("plugin-market/changed", notify);
			// 内置配置项由其它插件通过 plugins.item 贡献，注册完成时间不确定。
			try {
				const dispose = ctx.slots?.subscribe?.("plugins.item", notify);
				if (typeof dispose === "function") disposers.push(dispose);
			} catch {
				/* slots 订阅不可用时忽略 */
			}

			const language = () => {
				try {
					return ctx.locale?.getSnapshot?.().active ?? "zh";
				} catch {
					return "zh";
				}
			};

			const resolveLabel = (option) => {
				try {
					if (typeof option === "function") {
						const value = option();
						return typeof value === "string" ? value : "";
					}
					if (typeof option === "string") return option;
					if (option !== null && typeof option === "object") return option[language()] ?? option.en ?? option.zh ?? "";
				} catch {
					/* 标签求值失败时退回空串 */
				}
				return "";
			};

			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				dispose() {
					for (const dispose of disposers.splice(0)) {
						try {
							dispose();
						} catch {
							/* 卸载期间的失败忽略 */
						}
					}
					listeners.clear();
				},
				language,
				resolveText(value) {
					if (typeof value === "string") return value;
					try {
						const resolved = ctx.locale?.resolveText?.(value);
						if (typeof resolved === "string") return resolved;
					} catch {
						/* 回退到手工解析 */
					}
					if (value !== null && typeof value === "object") {
						const active = language();
						return value[active] ?? value.en ?? value.zh ?? "";
					}
					return "";
				},
				async listBundles() {
					const value = unwrap(await ctx.remote.pluginManager.listBundles());
					return Array.isArray(value) ? value : [];
				},
				listBuiltins() {
					try {
						const hidden = new Set(
							ctx.slots.entries("plugins.item.hidden").flatMap((entry) => (typeof entry.options.key === "string" ? [entry.options.key] : []))
						);
						return ctx.slots
							.entries("plugins.item")
							.filter((entry) => typeof entry.options.id === "string" && entry.options.id !== "" && !hidden.has(entry.options.id))
							.map((entry) => ({
								id: entry.options.id,
								title: resolveLabel(entry.options.label),
								order: Number.isFinite(entry.options.order) ? entry.options.order : 0
							}))
							.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
					} catch {
						return [];
					}
				},
				async listIndexes() {
					try {
						const value = unwrap(await ctx.remote.pluginMarket.listIndexes());
						return Array.isArray(value) ? value : [];
					} catch {
						return [];
					}
				},
				async search(url, text) {
					return unwrap(await ctx.remote.pluginMarket.search(url, { text, sort: { kind: "relevance" }, offset: 0, limit: 50 }));
				},
				async setBundleEnabled(name, enabled) {
					return unwrap(await ctx.remote.pluginManager.setBundleEnabled(name, enabled));
				},
				async readSnapshot() {
					const payload = await requestJson(`${ROUTE}/state`);
					return payload.state ?? EMPTY_STATE;
				},
				async capture(body) {
					const payload = await requestJson(`${ROUTE}/capture`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
					return payload.state ?? EMPTY_STATE;
				}
			};
		}

		/**
		 * 从插件市场读取一批插件的分类。
		 * @param api - 数据接口。
		 * @param bundles - 要查询的 bündle 列表。
		 * @param mode - `capture`（首次记录为准）或 `resync`（整体覆盖）。
		 * @param source - 新记录的来源标记：`download` / `backfill`。
		 * @returns `{ state?, changed?, unavailable }`。
		 */
		async function captureCategories(api, bundles, mode, source) {
			const indexes = (await api.listIndexes()).filter((index) => index !== null && typeof index === "object" && typeof index.url === "string" && index.error === undefined);
			if (indexes.length === 0) return { unavailable: true };
			const declarations = {};
			const declarationOrder = [];
			const results = await mapLimit(bundles, SEARCH_CONCURRENCY, async (bundle) => {
				let answered = false;
				for (const index of indexes) {
					let answer;
					try {
						answer = await api.search(index.url, bundle.name);
						answered = true;
					} catch {
						continue;
					}
					const meta = answer?.metadata;
					if (meta !== null && typeof meta === "object" && meta.categories !== null && typeof meta.categories === "object") {
						for (const [id, value] of Object.entries(meta.categories)) {
							if (id === "") continue;
							const title = value?.title ?? value;
							if (typeof title === "string" || (title !== null && typeof title === "object")) declarations[id] = title;
							if (!declarationOrder.includes(id)) declarationOrder.push(id);
						}
					}
					const entries = Array.isArray(answer?.entries) ? answer.entries : [];
					const entry = entries.find((candidate) => candidate?.name === bundle.name);
					if (entry === undefined) continue;
					const categoryId = typeof entry.metadata?.category === "string" ? entry.metadata.category : null;
					const category = categoryId === null ? null : (meta?.categories?.[categoryId]?.title ?? null);
					return {
						name: bundle.name,
						listed: true,
						categoryId,
						category,
						indexUrl: index.url,
						marketTitle: typeof answer?.title === "string" ? answer.title : null,
						author: typeof entry.author === "string" ? entry.author : null,
						keywords: Array.isArray(entry.metadata?.keywords) ? entry.metadata.keywords.filter((word) => typeof word === "string") : [],
						version: typeof bundle.version === "string" ? bundle.version : null,
						source
					};
				}
				// 所有索引都没有回答时不要下「未收录」的结论，避免把暂时失败写成永久记录。
				if (!answered) return null;
				return {
					name: bundle.name,
					listed: false,
					categoryId: null,
					category: null,
					indexUrl: indexes[0].url,
					version: typeof bundle.version === "string" ? bundle.version : null,
					source
				};
			});
			const packages = results.filter((record) => record !== null);
			if (packages.length === 0) return { unavailable: false, failed: true };
			const state = await api.capture({
				mode,
				source,
				categories: declarations,
				categoryOrder: declarationOrder,
				packages
			});
			return { state, unavailable: false };
		}

		/* ─────────────── 组件 ─────────────── */

		function Skeleton() {
			return h(
				"div",
				null,
				...Array.from({ length: 4 }, (_, index) =>
					h(
						"div",
						{ className: "dshpc-skeleton", key: `skel-${index}` },
						h("div", { className: "dshpc-skel dshpc-skelIcon" }),
						h(
							"div",
							{ className: "dshpc-skelLines" },
							h("div", { className: "dshpc-skel dshpc-skelLine" }),
							h("div", { className: "dshpc-skel dshpc-skelLine short" })
						)
					)
				)
			);
		}

		/** 插件图标：自带 data URL 优先，其次官方原语图标，最后退回标题首字。 */
		function Artwork(props) {
			const { src, itemId, title, size = 30 } = props;
			if (typeof src === "string" && src.startsWith("data:")) return h("img", { src, alt: "" });
			const Art = itemId === undefined ? undefined : BUILTIN_ARTWORK.get(itemId);
			if (typeof Art === "function") return h(Art, { size });
			if (typeof DefaultArtwork === "function") return h(DefaultArtwork, { size });
			return h("span", { className: "dshpc-monogram", "aria-hidden": "true" }, Array.from(title ?? "·")[0] ?? "·");
		}

		function PluginCard(props) {
			const { item, t, api, onOpenBundle, onOpenItem, busy, onToggle } = props;
			const { bundle, title, kind } = item;
			if (kind === "item") {
				return h(
					"li",
					null,
					h(
						"div",
						{ className: "dshpc-card" },
						h(
							"button",
							{
								type: "button",
								className: "dshpc-cardOpen",
								onClick: () => onOpenItem?.(item.id),
								"aria-label": `${t("open")}: ${title}`,
								title: `${title}\n${item.id}`
							},
							h("span", { className: "dshpc-icon", "aria-hidden": "true" }, h(Artwork, { itemId: item.id, title })),
							h(
								"span",
								{ className: "dshpc-cardMain" },
								h(
									"span",
									{ className: "dshpc-titleRow" },
									h("span", { className: "dshpc-cardTitle" }, title),
									h("span", { className: "dshpc-tag" }, t("builtinTag"))
								),
								h("span", { className: "dshpc-cardName" }, item.id)
							),
							h("span", { className: "dshpc-arrow", "aria-hidden": "true" }, "\u203a")
						)
					)
				);
			}
			const description = descriptionOf(bundle, api);
			const version = typeof bundle.version === "string" ? bundle.version : "";
			const icon = typeof bundle.meta?.icon === "string" ? bundle.meta.icon : "";
			const enabled = bundle.enabled !== false;
			const tags = [];
			if (version !== "") tags.push(h("span", { className: "dshpc-tag", key: "version" }, `v${version}`));
			if (bundle.official === true) tags.push(h("span", { className: "dshpc-tag", key: "official" }, t("experimentalTag")));
			if (!enabled) tags.push(h("span", { className: "dshpc-tag dshpc-tagOff", key: "off" }, t("disabled")));
			if (bundle.error !== undefined) tags.push(h("span", { className: "dshpc-tag dshpc-tagError", key: "error" }, t("errorTag")));
			return h(
				"li",
				null,
				h(
					"div",
					{ className: "dshpc-card" },
					h(
						"button",
						{
							type: "button",
							className: "dshpc-cardOpen",
							onClick: () => onOpenBundle?.(bundle.name),
							"aria-label": `${t("open")}: ${title}`,
							title: `${title}\n${bundle.name}`
						},
						h("span", { className: "dshpc-icon", "aria-hidden": "true" }, h(Artwork, { src: icon, title })),
						h(
							"span",
							{ className: "dshpc-cardMain" },
							h("span", { className: "dshpc-titleRow" }, h("span", { className: "dshpc-cardTitle" }, title), ...tags),
							h("span", { className: "dshpc-cardName" }, bundle.name),
							description === "" ? null : h("span", { className: "dshpc-cardDesc" }, description)
						),
						h("span", { className: "dshpc-arrow", "aria-hidden": "true" }, "\u203a")
					),
					h("button", {
						type: "button",
						role: "switch",
						className: "dshpc-switch",
						"aria-checked": enabled,
						"aria-label": `${enabled ? t("disable") : t("enable")}: ${title}`,
						title: enabled ? t("disable") : t("enable"),
						disabled: busy === true,
						onClick: () => onToggle?.(bundle)
					})
				)
			);
		}

		function GroupSection(props) {
			const { group, t, api, onOpenBundle, onOpenItem, busyNames, onToggleBundle, collapsed, onToggle } = props;
			const title = group.id === UNCATEGORIZED ? t("uncategorized") : api.resolveText(group.title) || group.id;
			const expanded = !collapsed.has(group.id);
			const bodyId = `dshpc-group-${group.id.replace(/[^A-Za-z0-9_-]/gu, "_")}`;
			const hint =
				group.id === UNCATEGORIZED
					? t("uncategorizedHint")
					: group.id === BUILTIN
						? t("builtinHint")
						: group.id === EXPERIMENTAL
							? t("experimentalHint")
							: "";
			return h(
				"section",
				{ className: "dshpc-group" },
				h(
					"button",
					{
						type: "button",
						className: "dshpc-groupHead",
						"aria-expanded": expanded,
						"aria-controls": bodyId,
						onClick: () => onToggle?.(group.id)
					},
					h("span", { className: "dshpc-chevron", "aria-hidden": "true" }, "\u25b8"),
					h("span", { className: "dshpc-groupTitle" }, title),
					h("span", { className: "dshpc-count" }, t("groupCount", { count: String(group.items.length) })),
					hint === "" ? null : h("span", { className: "dshpc-hint" }, hint)
				),
				expanded
					? h(
							"ul",
							{ className: "dshpc-cards", id: bodyId },
							...group.items.map((item) =>
								h(PluginCard, {
									key: item.kind === "item" ? `item:${item.id}` : item.bundle.name,
									item,
									t,
									api,
									onOpenBundle,
									onOpenItem,
									busy: item.kind === "bundle" && busyNames?.has(item.bundle.name) === true,
									onToggle: onToggleBundle
								})
							)
						)
					: null
			);
		}

		function InstalledOverview(props) {
			const t = props.t;
			const api = props.api;
			const onOpenBundle = props.onOpenBundle;
			const onOpenItem = props.onOpenItem;

			const [phase, setPhase] = useState("loading");
			const [failure, setFailure] = useState("");
			const [bundles, setBundles] = useState([]);
			const [builtins, setBuiltins] = useState([]);
			const [snapshot, setSnapshot] = useState(EMPTY_STATE);
			const [query, setQuery] = useState("");
			const [capturing, setCapturing] = useState(false);
			const [note, setNote] = useState("");
			const [toggleError, setToggleError] = useState("");
			const [busyNames, setBusyNames] = useState(() => new Set());
			const [collapsed, setCollapsed] = useState(() => new Set());
			const [confirmSync, setConfirmSync] = useState(false);

			const alive = useRef(true);
			const bundlesRef = useRef([]);
			const snapshotRef = useRef(EMPTY_STATE);
			const capturingRef = useRef(false);

			const applySnapshot = useCallback((next) => {
				snapshotRef.current = next;
				setSnapshot(next);
			}, []);

			const capturePending = useCallback(
				async (source, mode) => {
					if (capturingRef.current) return;
					const current = snapshotRef.current;
					const all = bundlesRef.current;
					const pending =
						mode === "resync"
							? all
							: all.filter((bundle) => {
									const record = current.packages?.[bundle.name];
									if (record === undefined) return true;
									return typeof record.version === "string" && typeof bundle.version === "string" && record.version !== bundle.version;
								});
					if (pending.length === 0) return;
					capturingRef.current = true;
					setCapturing(true);
					setNote("");
					try {
						const outcome = await captureCategories(api, pending, mode, source);
						if (!alive.current) return;
						if (outcome.unavailable) {
							setNote(t("marketUnavailable"));
							return;
						}
						if (outcome.failed) {
							setNote(t("captureFailed"));
							return;
						}
						if (outcome.state !== undefined) applySnapshot(outcome.state);
					} catch (error) {
						if (alive.current) {
							setNote(t("captureFailed"));
							console.warn("[dsh-plugin-catalog] capture failed:", error);
						}
					} finally {
						capturingRef.current = false;
						if (alive.current) setCapturing(false);
					}
				},
				[api, applySnapshot, t]
			);

			const refresh = useCallback(
				async (mode) => {
					try {
						const [list, snapshotValue, builtinItems] = await Promise.all([api.listBundles(), api.readSnapshot(), Promise.resolve(api.listBuiltins())]);
						if (!alive.current) return;
						// 社区插件参与市场分类；official bundle 归入「实验性」；plugins.item 归入「内置」。
						const installed = list.filter((bundle) => bundle?.installed === true && bundle.official !== true);
						const experimental = list.filter((bundle) => bundle?.official === true);
						bundlesRef.current = installed;
						snapshotRef.current = snapshotValue;
						setBundles([...installed, ...experimental]);
						setBuiltins(Array.isArray(builtinItems) ? builtinItems : []);
						setSnapshot(snapshotValue);
						setFailure("");
						setPhase("ready");
						void capturePending(mode === "mount" ? "backfill" : "download", "capture");
					} catch (error) {
						if (!alive.current) return;
						setFailure(String(error?.message ?? error));
						setPhase((previous) => (previous === "ready" ? "ready" : "error"));
					}
				},
				[api, capturePending]
			);

			useEffect(() => {
				alive.current = true;
				void refresh("mount");
				const dispose = api.subscribe(() => {
					void refresh("event");
				});
				return () => {
					alive.current = false;
					dispose();
				};
			}, [api, refresh]);

			// 只在对应列表真的被本视图接管时才隐藏页面自带分组，避免数据源失败时内容消失。
			useEffect(() => {
				const body = document.body;
				try {
					body.setAttribute("data-dsh-catalog-ready", phase === "ready" ? "1" : "0");
					body.setAttribute("data-dsh-catalog-builtins", builtins.length > 0 ? "1" : "0");
					body.setAttribute("data-dsh-catalog-experimental", bundles.some((bundle) => bundle.official === true) ? "1" : "0");
				} catch {
					/* 标记失败时保留页面自带分组 */
				}
				return () => {
					try {
						body.removeAttribute("data-dsh-catalog-ready");
						body.removeAttribute("data-dsh-catalog-builtins");
						body.removeAttribute("data-dsh-catalog-experimental");
					} catch {
						/* 卸载期间的失败忽略 */
					}
				};
			}, [phase, builtins, bundles]);

			const reSync = useCallback(async () => {
				setConfirmSync(false);
				await capturePending("download", "resync");
			}, [capturePending]);

			const toggleGroup = useCallback((id) => {
				setCollapsed((previous) => {
					const next = new Set(previous);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			}, []);

			const toggleBundle = useCallback(
				async (bundle) => {
					setToggleError("");
					setBusyNames((previous) => new Set(previous).add(bundle.name));
					try {
						await api.setBundleEnabled(bundle.name, bundle.enabled === false);
						await refresh("manual");
					} catch (error) {
						if (alive.current) setToggleError(t("toggleFailed", { error: String(error?.message ?? error) }));
					} finally {
						if (alive.current) {
							setBusyNames((previous) => {
								const next = new Set(previous);
								next.delete(bundle.name);
								return next;
							});
						}
					}
				},
				[api, refresh, t]
			);

			const language = api.language();
			const { groups, matched } = groupBundles(bundles, snapshot, query, api, {
				builtins,
				labels: { builtin: t("builtinCategory"), experimental: t("experimentalCategory") }
			});
			const categoryCount = groups.filter((group) => group.id !== UNCATEGORIZED).length;
			const totalCount = bundles.length + builtins.length;
			const communityCount = bundles.filter((bundle) => bundle.official !== true).length;
			const searching = query.trim() !== "";
			const recordedAt = formatTime(snapshot.updatedAt, language);

			const head = h(
				"header",
				{ className: "dshpc-head" },
				h(
					"div",
					{ className: "dshpc-headCopy" },
					h("h3", { className: "dshpc-title" }, t("installedTitle")),
					h("p", { className: "dshpc-intro" }, t("intro"))
				),
				h(
					"div",
					{ className: "dshpc-tools" },
					h(
						"label",
						{ className: "dshpc-search" },
						h("span", { className: "dshpc-searchIcon", "aria-hidden": "true" }, "\u2315"),
						h("input", {
							type: "search",
							value: query,
							placeholder: t("searchPlaceholder"),
							"aria-label": t("searchLabel"),
							onChange: (event) => setQuery(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Escape") setQuery("");
							}
						}),
						searching
							? h(
									"button",
									{ type: "button", className: "dshpc-clear", "aria-label": t("clearSearch"), onClick: () => setQuery("") },
									"\u00d7"
								)
							: null
					),
					h(
						"button",
						{
							type: "button",
							className: "dshpc-btn",
							onClick: () => {
								setPhase((previous) => (previous === "ready" ? previous : "loading"));
								void refresh("manual");
							},
							disabled: capturing
						},
						capturing ? t("refreshing") : t("refresh")
					)
				)
			);

			const status = h(
				"div",
				{ className: "dshpc-status" },
				h("span", null, t("summary", { plugins: String(totalCount), categories: String(categoryCount), matched: String(matched) })),
				capturing ? h("span", { className: "dshpc-busy" }, h("span", { className: "dshpc-dot", "aria-hidden": "true" }), t("capturing")) : null,
				recordedAt === "" ? null : h("span", null, t("capturedAt", { when: recordedAt })),
				h("span", { className: "dshpc-spacer" }),
				confirmSync
					? h(
							"span",
							{ className: "dshpc-confirm" },
							h("button", { type: "button", className: "dshpc-link", onClick: () => void reSync() }, t("confirmSync")),
							h("button", { type: "button", className: "dshpc-link", onClick: () => setConfirmSync(false) }, t("cancel"))
						)
					: h(
							"button",
							{
								type: "button",
								className: "dshpc-link",
								disabled: capturing || communityCount === 0,
								onClick: () => setConfirmSync(true)
							},
							t("resync")
						)
			);

			let body;
			if (phase === "loading") {
				body = h("div", null, h("p", { className: "dshpc-hint" }, t("loading")), h(Skeleton));
			} else if (phase === "error") {
				body = h(
					"div",
					{ className: "dshpc-failure" },
					h("span", null, t("loadFailed", { error: failure })),
					h(
						"button",
						{
							type: "button",
							className: "dshpc-btn",
							onClick: () => {
								setPhase("loading");
								void refresh("manual");
							}
						},
						t("retry")
					)
				);
			} else if (totalCount === 0) {
				body = h("div", { className: "dshpc-empty" }, h("p", { className: "dshpc-emptyTitle" }, t("noPlugins")));
			} else if (groups.length === 0) {
				body = h("div", { className: "dshpc-empty" }, h("p", { className: "dshpc-emptyTitle" }, t("noMatch", { query })));
			} else {
				body = h(
					"div",
					{ className: "dshpc-groups" },
					...groups.map((group) =>
						h(GroupSection, {
							key: group.id,
							group,
							t,
							api,
							onOpenBundle,
							onOpenItem,
							busyNames,
							onToggleBundle: toggleBundle,
							collapsed: searching ? new Set() : collapsed,
							onToggle: toggleGroup
						})
					)
				);
			}

			const notices = [];
			if (note !== "") notices.push(h("p", { className: "dshpc-note", role: "status", key: "note" }, note));
			if (toggleError !== "") notices.push(h("p", { className: "dshpc-note", role: "alert", key: "toggle" }, toggleError));
			return h(
				"section",
				{ className: "dshpc-root" },
				head,
				status,
				...notices,
				body,
				h("p", { className: "dshpc-footNote" }, t("sourceNote"))
			);
		}

		/** React 不可用时的空组件，保证不会因为缺 React 而崩。 */
		const Overview = R === undefined ? function EmptyOverview() { return null; } : InstalledOverview;

		/* ─────────────── Cordis 客户端插件 ─────────────── */

		const inject = ["slots", "locale", "remote", "remote.pluginManager", "remote.pluginMarket"];

		/**
		 * 挂载浏览器半身。
		 * @param ctx - 浏览器插件上下文
		 */
		function apply(ctx) {
			let t = (key) => (key in zh ? zh[key] : key);
			if (typeof ctx.locale?.register === "function" && typeof ctx.locale?.bind === "function") {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-plugin-catalog: dictionaries");
				t = ctx.locale.bind(NS);
			}
			if (R === undefined) {
				console.warn("[dsh-plugin-catalog] React 不可用：已安装插件的分类视图不会显示");
				return;
			}
			if (typeof ctx.slots?.inject !== "function" || typeof ctx.slots?.register !== "function") {
				console.warn("[dsh-plugin-catalog] slots 服务不可用：已安装插件的分类视图不会显示");
				return;
			}
			installStyle();
			const api = createApi(ctx);
			const face = { api };
			ctx.effect(() => () => {
				api.dispose();
				removeStyle();
			}, "dsh-plugin-catalog: lifecycle");
			ctx.slots.inject("plugins.overview", () =>
				ctx.slots.register(
					{
						name: "plugins.overview",
						id: "catalog",
						order: 1,
						...(ctx.locale === undefined ? {} : { locale: NS }),
						inject: () => face
					},
					Overview
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "plugin-catalog";
		exports.NS = NS;
		/** 供 node test-client.mjs 直接验证的纯函数与组件（浏览器运行时不使用）。 */
		exports.__test = {
			EMPTY_STATE,
			NS,
			searchTerms,
			shortName,
			categoryLabel,
			titleOf,
			descriptionOf,
			groupBundles,
			captureCategories,
			PluginCard,
			GroupSection,
			InstalledOverview
		};
		return module.exports;
	}
});
