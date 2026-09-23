export const SYSTEM_HTML = `You output a single, self-contained HTML file only.
Rules:
- Output ONLY raw HTML. No explanation, no markdown code fences.
- Inline all CSS and JS. External libraries ONLY from these CDNs:
  https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net, https://cdn.tailwindcss.com
- Include a <head> and put a Content-Security-Policy meta near the top of <head>
  (the server will also enforce/replace it, but include one anyway).
- The app must be genuinely interactive (clickable, inputs work, state updates).
- Do NOT reference external images or scripts outside the allowed CDNs.
- CRITICAL — the app runs inside a sandboxed iframe WITHOUT same-origin access. Therefore:
  - Do NOT use localStorage / sessionStorage / cookies / IndexedDB (they throw SecurityError). Keep all state in in-memory JavaScript variables (arrays/objects).
  - Do NOT rely on <form> submit for actions. Use <button type="button"> with JS click handlers (addEventListener or onclick). If you use a <form>, call event.preventDefault() so submission never navigates.
  - Do NOT try to persist across reload; the hosting platform handles persistence.`;

export function buildPlanPrompt(need: string): string {
  return `The user wants: "${need}".
Write a SHORT implementation plan as 3-5 steps in PLAIN language a non-technical person understands.
Do NOT use technical terms like flexbox, localStorage, DOM, API, div.
Example style: "Create an input area -> support add and delete -> save the task state -> check the phone layout".
Output just the steps, one per line, no numbering symbols required.`;
}

export function buildBuildPrompt(plan: string, need: string): string {
  return `User need: "${need}"
Plan:
${plan}

Now build the complete single-file HTML app that follows the plan. Output only the HTML.`;
}

export function buildEditPrompt(currentCode: string, change: string): string {
  return `Here is the current app HTML:
${currentCode}

The user wants this change: "${change}"
Return the COMPLETE updated HTML file (not a diff). Keep all unrelated structure and features intact. Output only the HTML.`;
}

export function buildRestylePrompt(currentCode: string, need: string): string {
  return `Here is the current working app HTML:
${currentCode}

The user's original need was: "${need}".
Rebuild this app with a DIFFERENT visual style and layout, but KEEP ALL existing functionality and features intact (including any edits already applied). Same behavior, fresh look.
Return the COMPLETE updated HTML file. Output only the HTML.`;
}

export function buildRepairPrompt(brokenCode: string, errors: string[]): string {
  return `The following generated HTML failed validation with these errors:
${errors.join("\n")}

HTML:
${brokenCode}

Fix the issues and return the COMPLETE corrected HTML file. Output only the HTML.`;
}
