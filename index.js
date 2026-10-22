/**
 * dsh-plugin-catalog — Host half.
 *
 * 只做一件事：把「插件下载时属于哪个市场分类」这份快照持久化下来，供浏览器半身
 * （client.js）读写。
 *
 *   GET  /dsh-plugin-catalog/state     当前快照（JSON）
 *   POST /dsh-plugin-catalog/capture   记录一批分类（JSON body）
 *   GET  /dsh-plugin-catalog/status    状态摘要（目录、条目数、更新时间）
 *
 * 分类由浏览器半身从插件市场（`ctx.remote.pluginMarket`）取到；宿主半身不联网、
 * 不读插件市场，只负责把结果原子写进 `$DSH_HOME/dsh-plugin-catalog/state.json`，
 * 所以插件市场不可用时，上一次记录仍然可用。
 *
 * 设计约束（与 dsh-custom-style 同口径）：
 *   - 只用 `node:` 内置模块，没有任何第三方运行时依赖。
 *   - 只有一个固定文件，请求体里不携带任何路径，因此没有路径穿越面。
 *   - 先写临时文件再 rename，避免半截 JSON 被读到。
 *   - 「首次记录为准」：同一版本的插件不会被后来的市场改分类覆盖；升级到新版本
 *     视为一次新的下载，才允许更新。显式 resync 才会整体覆盖。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Loader 条目名（cordis.patch.yml 的 insert 用它绑定浏览器半身）。 */
export const name = "plugin-catalog";

/** 需要宿主提供的服务：只用于注册路由。 */
export const inject = ["webServer"];

/** 路由前缀；浏览器半侧按它读写快照。 */
export const ROUTE_PREFIX = "/dsh-plugin-catalog";

/** 快照格式版本。 */
export const STATE_VERSION = 1;

/** 请求体上限（一次最多记录 2000 个插件，远小于这个体积）。 */
const MAX_BODY_BYTES = 1024 * 1024;

/** 一次请求最多处理的包数。 */
const MAX_PACKAGES = 2000;

/** 单个文本字段上限。 */
const MAX_TEXT = 512;

/** `$DSH_HOME`，回退 `~/.dsh`（与 dsh-custom-style、dsh-pet 等同口径）。 */
function resolveDshHome() {
	const fromEnv = process.env.DSH_HOME;
	return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : join(homedir(), ".dsh");
}

/** 快照目录：`$DSH_HOME/dsh-plugin-catalog`。 */
export function catalogDir() {
	return join(resolveDshHome(), "dsh-plugin-catalog");
}

/** 快照文件：`$DSH_HOME/dsh-plugin-catalog/state.json`。 */
export function statePath() {
	return join(catalogDir(), "state.json");
}

/** 一份空快照。 */
export function emptyState() {
	return {
		version: STATE_VERSION,
		updatedAt: 0,
		categories: {},
		categoryOrder: [],
		packages: {}
	};
}

/** 截断并去空白；空串当作缺失。 */
function text(value, max = MAX_TEXT) {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

/** 本地化文本：市场里是 `{ zh, en }`，也容忍裸字符串。 */
function localized(value, max = 120) {
	if (typeof value === "string") {
		const one = text(value, max);
		return one === undefined ? undefined : { en: one };
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const out = {};
	for (const language of ["zh", "en"]) {
		const member = text(value[language], max);
		if (member !== undefined) out[language] = member;
	}
	return Object.keys(out).length === 0 ? undefined : out;
}

/** 关键词数组：去重、限长、限个数。 */
function keywords(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		const word = text(item, 80);
		if (word === undefined || out.includes(word)) continue;
		out.push(word);
		if (out.length >= 32) break;
	}
	return out;
}

/**
 * 把一条请求记录规范成快照条目。
 * @param raw - 浏览器半身提交的一条记录。
 * @param fallbackSource - 记录里没写 source 时用的来源标记。
 * @returns 快照条目，或 null（记录无效）。
 */
export function normalizeRecord(raw, fallbackSource = "download") {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const packageName = text(raw.name, 214);
	if (packageName === undefined) return null;
	const categoryId = text(raw.categoryId, 120);
	const category = localized(raw.category);
	const listed = raw.listed === true;
	const source = raw.source === "backfill" || raw.source === "download" || raw.source === "resync" ? raw.source : fallbackSource;
	return {
		name: packageName,
		listed,
		categoryId: listed && categoryId !== undefined ? categoryId : null,
		category: listed && category !== undefined ? category : null,
		indexUrl: text(raw.indexUrl, 512) ?? null,
		marketTitle: localized(raw.marketTitle) ?? null,
		author: text(raw.author, 120) ?? null,
		keywords: keywords(raw.keywords),
		version: text(raw.version, 64) ?? null,
		source,
		capturedAt: Number.isFinite(raw.capturedAt) ? Math.trunc(raw.capturedAt) : Date.now()
	};
}

/** 读磁盘上的快照；文件缺失或损坏时返回空快照（不覆盖坏文件）。 */
export function readStateFile(file = statePath()) {
	try {
		if (!existsSync(file)) return emptyState();
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
		const state = emptyState();
		state.updatedAt = Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0;
		if (parsed.categories !== null && typeof parsed.categories === "object" && !Array.isArray(parsed.categories)) {
			for (const [id, value] of Object.entries(parsed.categories)) {
				const title = localized(value);
				if (id !== "" && title !== undefined) state.categories[id] = title;
			}
		}
		if (Array.isArray(parsed.categoryOrder)) {
			for (const id of parsed.categoryOrder) {
				if (typeof id === "string" && id !== "" && !state.categoryOrder.includes(id)) state.categoryOrder.push(id);
			}
		}
		if (parsed.packages !== null && typeof parsed.packages === "object" && !Array.isArray(parsed.packages)) {
			for (const value of Object.values(parsed.packages)) {
				const record = normalizeRecord(value, "download");
				if (record !== null) state.packages[record.name] = record;
			}
		}
		return state;
	} catch {
		return emptyState();
	}
}

/** 原子写快照。 */
export function writeStateFile(state, file = statePath()) {
	const dir = catalogDir();
	mkdirSync(dir, { recursive: true });
	const temporary = join(dir, `.state.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
		renameSync(temporary, file);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {
			/* 清理失败不改变原始错误 */
		}
		throw error;
	}
}

/**
 * 合并一批分类记录。
 *
 * - `mode: "capture"`（默认）：首次记录为准；同一版本不覆盖；版本变化视为一次新的
 *   下载，允许更新；之前「未收录」的插件后来出现在市场里，也允许补上分类。
 * - `mode: "resync"`：全部按提交值覆盖（用户显式要求按当前市场重新分类）。
 *
 * @param state - 当前快照。
 * @param payload - `{ mode, packages, categories, categoryOrder }`。
 * @returns `{ state, changed }`。
 */
export function mergeCapture(state, payload) {
	const mode = payload?.mode === "resync" ? "resync" : "capture";
	const incoming = Array.isArray(payload?.packages) ? payload.packages.slice(0, MAX_PACKAGES) : [];
	const next = {
		version: STATE_VERSION,
		updatedAt: state.updatedAt,
		categories: { ...state.categories },
		categoryOrder: [...state.categoryOrder],
		packages: { ...state.packages }
	};
	let changed = 0;

	// 市场声明的分类（含中英文标题与声明顺序）。
	const declarations = payload?.categories;
	if (declarations !== null && typeof declarations === "object" && !Array.isArray(declarations)) {
		for (const [id, value] of Object.entries(declarations)) {
			const title = localized(value?.title ?? value);
			if (id === "" || title === undefined) continue;
			next.categories[id] = { ...(next.categories[id] ?? {}), ...title };
		}
	}
	if (Array.isArray(payload?.categoryOrder)) {
		for (const id of payload.categoryOrder) {
			if (typeof id !== "string" || id === "" || next.categoryOrder.includes(id)) continue;
			next.categoryOrder.push(id);
		}
	}

	for (const raw of incoming) {
		const record = normalizeRecord(raw, mode === "resync" ? "resync" : "download");
		if (record === null) continue;
		const existing = next.packages[record.name];
		if (mode === "resync") {
			next.packages[record.name] = { ...record, source: "resync" };
			changed += 1;
			continue;
		}
		if (existing === undefined) {
			next.packages[record.name] = record;
			changed += 1;
			continue;
		}
		const versionChanged = record.version !== null && existing.version !== null && record.version !== existing.version;
		const newlyListed = existing.listed === false && record.listed === true;
		if (versionChanged || newlyListed) {
			next.packages[record.name] = { ...record, source: "update" };
			changed += 1;
		}
	}

	next.updatedAt = Date.now();
	return { state: next, changed };
}

/** 发送文本。 */
function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}

/** 发送 JSON。 */
function sendJson(res, status, value) {
	sendText(res, status, `${JSON.stringify(value)}\n`, "application/json; charset=utf-8");
}

/** 读取请求体（带体积上限与超时）。 */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value);
		};
		const timer = setTimeout(() => finish(new Error("request body timed out")), 5000);
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				finish(new Error("request body too large"));
				req.destroy?.();
				return;
			}
			chunks.push(Buffer.from(chunk));
		});
		req.on("end", () => finish(undefined, Buffer.concat(chunks).toString("utf8")));
		req.on("error", (error) => finish(error));
	});
}

/**
 * 处理一个请求；返回 Promise（宿主忽略它，离屏测试可以 await 到响应写完）。
 * @param req - IncomingMessage。
 * @param res - ServerResponse。
 * @param pathname - 已解析的路径。
 */
export async function handleRequest(req, res, pathname) {
	const method = (req.method ?? "GET").toUpperCase();

	if (pathname === `${ROUTE_PREFIX}/state`) {
		if (method !== "GET" && method !== "HEAD") {
			sendText(res, 405, "dsh-plugin-catalog: only GET/HEAD\n");
			return;
		}
		const state = readStateFile();
		if (method === "HEAD") {
			res.writeHead(200, { "cache-control": "no-store" });
			res.end();
			return;
		}
		sendJson(res, 200, { ok: true, state });
		return;
	}

	if (pathname === `${ROUTE_PREFIX}/capture`) {
		if (method !== "POST") {
			sendText(res, 405, "dsh-plugin-catalog: only POST\n");
			return;
		}
		let payload;
		try {
			const raw = await readBody(req);
			payload = raw.trim() === "" ? {} : JSON.parse(raw);
		} catch (error) {
			sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
			return;
		}
		const current = readStateFile();
		const { state, changed } = mergeCapture(current, payload);
		writeStateFile(state);
		sendJson(res, 200, { ok: true, changed, state });
		return;
	}

	if (method === "GET" && (pathname === ROUTE_PREFIX || pathname === `${ROUTE_PREFIX}/` || pathname === `${ROUTE_PREFIX}/status`)) {
		const state = readStateFile();
		sendJson(res, 200, {
			ok: true,
			dir: catalogDir(),
			version: state.version,
			packages: Object.keys(state.packages).length,
			categories: Object.keys(state.categories).length,
			updatedAt: state.updatedAt
		});
		return;
	}

	sendJson(res, 404, { ok: false, error: "not-found" });
}

/**
 * 挂载宿主半身。
 * @param ctx - 宿主插件上下文
 */
export function apply(ctx) {
	try {
		mkdirSync(catalogDir(), { recursive: true });
		ctx.logger?.info?.(`[dsh-plugin-catalog] 分类快照：${statePath()}`);
	} catch (error) {
		ctx.logger?.warn?.(`[dsh-plugin-catalog] 无法创建快照目录：${error instanceof Error ? error.message : String(error)}`);
	}

	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "prefix",
				path: ROUTE_PREFIX,
				handler: (req, res) => {
					const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
					return handleRequest(req, res, pathname).catch((error) => {
						sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
					});
				}
			}),
		"dsh-plugin-catalog: state route"
	);
}
