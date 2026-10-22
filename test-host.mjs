/**
 * dsh-plugin-catalog — Host half 的自测（假 ctx / 假 req-res / 临时 DSH_HOME）。
 * 运行：node test-host.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogDir, emptyState, handleRequest, mergeCapture, readStateFile, statePath, writeStateFile } from "./index.js";

const home = mkdtempSync(join(tmpdir(), "dsh-plugin-catalog-test-"));
process.env.DSH_HOME = home;

let passed = 0;
async function check(name, fn) {
	await fn();
	passed += 1;
	console.log(`ok ${passed} - ${name}`);
}

await check("empty state on a fresh home", () => {
	const state = readStateFile();
	assert.equal(state.version, 1);
	assert.deepEqual(state.packages, {});
	assert.equal(statePath(), join(home, "dsh-plugin-catalog", "state.json"));
});

await check("capture records a missing package", () => {
	const before = emptyState();
	const { state, changed } = mergeCapture(before, {
		mode: "capture",
		source: "backfill",
		categories: { usage: { title: { zh: "用量与计费", en: "Usage & Billing" } } },
		categoryOrder: ["usage"],
		packages: [
			{
				name: "dsh-cost-meter",
				listed: true,
				categoryId: "usage",
				category: { zh: "用量与计费", en: "Usage & Billing" },
				indexUrl: "https://example.test/index.json",
				marketTitle: { zh: "插件市场", en: "Market" },
				author: "someone",
				keywords: ["cost", "usage"],
				version: "1.9.15",
				source: "backfill"
			}
		]
	});
	assert.equal(changed, 1);
	const record = state.packages["dsh-cost-meter"];
	assert.equal(record.categoryId, "usage");
	assert.equal(record.source, "backfill");
	assert.equal(record.version, "1.9.15");
	assert.deepEqual(state.categories.usage, { zh: "用量与计费", en: "Usage & Billing" });
	assert.deepEqual(state.categoryOrder, ["usage"]);
});

await check("same version keeps the first recorded category", () => {
	const first = mergeCapture(emptyState(), {
		packages: [{ name: "dsh-cost-meter", listed: true, categoryId: "usage", category: { zh: "用量" }, version: "1.9.15" }]
	}).state;
	const { state, changed } = mergeCapture(first, {
		packages: [{ name: "dsh-cost-meter", listed: true, categoryId: "ui", category: { zh: "界面" }, version: "1.9.15" }]
	});
	assert.equal(changed, 0);
	assert.equal(state.packages["dsh-cost-meter"].categoryId, "usage");
});

await check("a new version counts as a new download", () => {
	const first = mergeCapture(emptyState(), {
		packages: [{ name: "dsh-cost-meter", listed: true, categoryId: "usage", version: "1.9.15" }]
	}).state;
	const { state, changed } = mergeCapture(first, {
		packages: [{ name: "dsh-cost-meter", listed: true, categoryId: "ui", version: "2.0.0" }]
	});
	assert.equal(changed, 1);
	assert.equal(state.packages["dsh-cost-meter"].categoryId, "ui");
	assert.equal(state.packages["dsh-cost-meter"].version, "2.0.0");
	assert.equal(state.packages["dsh-cost-meter"].source, "update");
});

await check("an unlisted package gains a category once the market lists it", () => {
	const first = mergeCapture(emptyState(), {
		packages: [{ name: "dsh-pet", listed: false, version: "0.3.7" }]
	}).state;
	const { state, changed } = mergeCapture(first, {
		packages: [{ name: "dsh-pet", listed: true, categoryId: "fun", version: "0.3.7" }]
	});
	assert.equal(changed, 1);
	assert.equal(state.packages["dsh-pet"].categoryId, "fun");
});

await check("resync overwrites every submitted record", () => {
	const first = mergeCapture(emptyState(), {
		packages: [{ name: "dsh-pet", listed: true, categoryId: "fun", version: "0.3.7" }]
	}).state;
	const { state, changed } = mergeCapture(first, {
		mode: "resync",
		packages: [{ name: "dsh-pet", listed: true, categoryId: "ui", version: "0.3.7" }]
	});
	assert.equal(changed, 1);
	assert.equal(state.packages["dsh-pet"].categoryId, "ui");
	assert.equal(state.packages["dsh-pet"].source, "resync");
});

await check("invalid records are ignored", () => {
	const { state, changed } = mergeCapture(emptyState(), {
		packages: [null, {}, { name: "" }, { name: "ok-plugin", listed: true, version: 3 }]
	});
	assert.equal(changed, 1);
	assert.ok(state.packages["ok-plugin"]);
	assert.equal(state.packages["ok-plugin"].version, null);
});

await check("state round-trips through the file", () => {
	const state = mergeCapture(emptyState(), {
		packages: [{ name: "dsh-pet", listed: true, categoryId: "fun", version: "0.3.7" }]
	}).state;
	writeStateFile(state);
	const read = readStateFile();
	assert.equal(read.packages["dsh-pet"].categoryId, "fun");
	const onDisk = JSON.parse(readFileSync(statePath(), "utf8"));
	assert.equal(onDisk.version, 1);
});

await check("a corrupt state file reads as empty without being overwritten", () => {
	writeFileSync(statePath(), "{not json", "utf8");
	const state = readStateFile();
	assert.deepEqual(state.packages, {});
	assert.equal(readFileSync(statePath(), "utf8"), "{not json");
});

/** 假请求。 */
function fakeRequest(method, body) {
	const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
	request.method = method;
	return request;
}

/** 假响应。 */
function fakeResponse() {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		writeHead(status, headers) {
			this.statusCode = status;
			this.headers = headers ?? {};
		},
		end(body) {
			if (body !== undefined) this.body += String(body);
		}
	};
}

await check("GET /state answers JSON", async () => {
	const response = fakeResponse();
	await handleRequest(fakeRequest("GET"), response, "/dsh-plugin-catalog/state");
	assert.equal(response.statusCode, 200);
	const payload = JSON.parse(response.body);
	assert.equal(payload.ok, true);
	assert.equal(payload.state.version, 1);
});

await check("POST /capture persists and answers the merged state", async () => {
	const response = fakeResponse();
	await handleRequest(
		fakeRequest(
			"POST",
			JSON.stringify({
				mode: "capture",
				source: "download",
				packages: [
					{
						name: "dsh-armory",
						listed: true,
						categoryId: "tools",
						category: { zh: "工具与能力", en: "Tools & Capabilities" },
						version: "2.1.0"
					}
				]
			})
		),
		response,
		"/dsh-plugin-catalog/capture"
	);
	assert.equal(response.statusCode, 200);
	const payload = JSON.parse(response.body);
	assert.equal(payload.ok, true);
	assert.equal(payload.changed, 1);
	assert.equal(payload.state.packages["dsh-armory"].categoryId, "tools");
	assert.equal(readStateFile().packages["dsh-armory"].version, "2.1.0");
});

await check("POST /capture rejects a bad body", async () => {
	const response = fakeResponse();
	await handleRequest(fakeRequest("POST", "{oops"), response, "/dsh-plugin-catalog/capture");
	assert.equal(response.statusCode, 400);
	assert.equal(JSON.parse(response.body).ok, false);
});

await check("wrong methods and unknown paths answer 405/404", async () => {
	const wrong = fakeResponse();
	await handleRequest(fakeRequest("POST"), wrong, "/dsh-plugin-catalog/state");
	assert.equal(wrong.statusCode, 405);
	const unknown = fakeResponse();
	await handleRequest(fakeRequest("GET"), unknown, "/dsh-plugin-catalog/nope");
	assert.equal(unknown.statusCode, 404);
	const status = fakeResponse();
	await handleRequest(fakeRequest("GET"), status, "/dsh-plugin-catalog/status");
	assert.equal(status.statusCode, 200);
	const payload = JSON.parse(status.body);
	assert.equal(payload.ok, true);
	assert.equal(payload.dir, catalogDir());
	assert.ok(payload.packages >= 1);
});

rmSync(home, { recursive: true, force: true });
console.log(`\n${passed} assertions passed`);
