import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../public/chat.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 1) throw new Error(`Expected one inline chat script, found ${scripts.length}.`);
new Function(scripts[0][1]);
console.log("Chat page inline JavaScript syntax OK.");
