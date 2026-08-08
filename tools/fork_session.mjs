#!/usr/bin/env node
// fork_session.mjs — instrumento M0: listar puntos de refine y extraer ramas ("rebobinar").
//
// Uso:
//   node tools/fork_session.mjs list <session.jsonl>
//   node tools/fork_session.mjs fork <session.jsonl> --at <entryId> --sessions-dir <dir> \
//        [--harness with|without] [--name <sufijo>]
//
// "fork --at X" crea un archivo de sesión nuevo cuyo último entry es X (el resto de la
// historia posterior no viaja), con id nuevo, y copia la carpeta de artefactos de la
// sesión original (harness state + kernel state) al id nuevo.
//   --harness with     deja harness_state.json como está (incluye la edición del refine)
//   --harness without  restaura el estado "before" del ÚLTIMO refinement registrado
//                      en refinements.jsonl anterior o igual al punto de corte
//
// Validación de oro: que `prime-agent --resume <archivo nuevo>` funcione.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

function loadEntries(file) {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));
}

function summarize(entry) {
	const t = entry.type;
	if (t === "session") return `session v${entry.version} id=${entry.id} cwd=${entry.cwd}`;
	if (t === "message") {
		const m = entry.message;
		const role = m.role;
		let text = "";
		if (typeof m.content === "string") text = m.content;
		else if (Array.isArray(m.content))
			text = m.content
				.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? `[tool:${c.name}]` : `[${c.type}]`))
				.join(" ");
		return `${role}: ${text.slice(0, 90).replace(/\n/g, " ")}`;
	}
	if (t === "custom") return `CUSTOM ${entry.customType}${entry.customType === "prime-agent.refinement" ? "  ← REFINE" : ""}`;
	return t;
}

function cmdList(file) {
	const entries = loadEntries(file);
	for (const e of entries) {
		const mark = e.type === "custom" && e.customType === "prime-agent.refinement" ? ">>> " : "    ";
		console.log(`${mark}${(e.id ?? "").padEnd(10)} parent=${(e.parentId ?? "-").toString().padEnd(10)} ${summarize(e)}`);
	}
}

function cmdFork(file, opts) {
	const entries = loadEntries(file);
	const byId = new Map(entries.map((e) => [e.id, e]));
	const header = entries.find((e) => e.type === "session");
	if (!header) throw new Error("la sesión no tiene header");
	const cut = byId.get(opts.at);
	if (!cut) throw new Error(`no existe el entry ${opts.at}`);

	// 1. Rama: caminar de --at hacia la raíz.
	const branch = [];
	let cur = cut;
	while (cur) {
		branch.unshift(cur);
		cur = cur.parentId ? byId.get(cur.parentId) : null;
	}

	// 2. Header nuevo con id nuevo; el archivo viejo queda como parentSession.
	const newId = randomUUID();
	const newHeader = { ...header, id: newId, parentSession: file, timestamp: new Date().toISOString() };

	// 3. Escribir el archivo nuevo.
	mkdirSync(opts.sessionsDir, { recursive: true });
	const suffix = opts.name ? `-${opts.name}` : "";
	const outFile = join(opts.sessionsDir, `${newId}${suffix}.jsonl`);
	const lines = [JSON.stringify(newHeader), ...branch.filter((e) => e.type !== "session").map((e) => JSON.stringify(e))];
	writeFileSync(outFile, lines.join("\n") + "\n");

	// 4. Copiar artefactos (por id del header, no por nombre de archivo).
	const srcArtifacts = join(dirname(dirname(file)), "session-artifacts", header.id);
	const srcArtifactsAlt = join(dirname(file), "..", "session-artifacts", header.id);
	const artifactsFrom = existsSync(srcArtifacts) ? srcArtifacts : srcArtifactsAlt;
	const artifactsTo = join(dirname(opts.sessionsDir), "session-artifacts", newId);
	if (existsSync(artifactsFrom)) {
		cpSync(artifactsFrom, artifactsTo, { recursive: true });
	} else {
		console.warn(`aviso: no encontré artefactos en ${artifactsFrom}`);
	}

	// 5. Variante del harness.
	if (opts.harness === "without") {
		const refFile = join(artifactsTo, "harness", "refinements.jsonl");
		if (!existsSync(refFile)) throw new Error("--harness without: no hay refinements.jsonl en los artefactos");
		const refs = loadEntries(refFile);
		if (refs.length === 0) throw new Error("refinements.jsonl vacío");
		const last = refs[refs.length - 1];
		const before = last.before ?? last.snapshotBefore ?? null;
		if (!before) throw new Error(`el último refinement no trae estado 'before'; claves: ${Object.keys(last)}`);
		writeFileSync(join(artifactsTo, "harness", "harness_state.json"), JSON.stringify(before, null, 2));
		console.log(`harness restaurado al estado previo al refinement ${last.id ?? "(último)"}`);
	}

	console.log(`rama extraída: ${outFile}`);
	console.log(`artefactos:    ${artifactsTo}`);
	console.log(`entries: ${branch.length} (de ${entries.length} totales)`);
	return outFile;
}

const [cmd, file, ...rest] = process.argv.slice(2);
const opts = { harness: "with", sessionsDir: null, at: null, name: null };
for (let i = 0; i < rest.length; i++) {
	if (rest[i] === "--at") opts.at = rest[++i];
	else if (rest[i] === "--sessions-dir") opts.sessionsDir = rest[++i];
	else if (rest[i] === "--harness") opts.harness = rest[++i];
	else if (rest[i] === "--name") opts.name = rest[++i];
}

if (cmd === "list" && file) cmdList(file);
else if (cmd === "fork" && file && opts.at && opts.sessionsDir) cmdFork(file, opts);
else {
	console.error("uso: fork_session.mjs list <s.jsonl> | fork <s.jsonl> --at <id> --sessions-dir <dir> [--harness with|without] [--name x]");
	process.exit(1);
}
