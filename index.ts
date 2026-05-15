import * as fs from 'fs';
import * as path from 'path';

// ─── CLI args ────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags       = process.argv.slice(2).filter(a => a.startsWith('--'));
const projectRoot = path.resolve(args[0] || process.cwd());
const outputFile  = path.join(process.cwd(), args[1] || 'menu-architecture.md');
const outputEncoding: BufferEncoding = flags.includes('--utf8') ? 'utf8' : 'latin1';

const SIDEBAR  = path.join(projectRoot, 'web/src/main/webapp/layout/sidebar.xhtml');
const MESSAGES = path.join(projectRoot, 'web/src/main/properties/messages.properties');
const JAVA_ROOTS = [
    path.join(projectRoot, 'web/src/main/java'),
    path.join(projectRoot, 'core/src/main/java'),
    path.join(projectRoot, 'common/src/main/java'),
];

console.log('\n=== Java LLM Extractor ===');
console.log(`Project  : ${projectRoot}`);
console.log(`Output   : ${outputFile}`);
console.log(`Encoding : ${outputEncoding}\n`);

if (!fs.existsSync(projectRoot)) {
    console.error('ERROR: Project path does not exist.');
    process.exit(1);
}
if (!fs.existsSync(SIDEBAR)) {
    console.error(`ERROR: sidebar.xhtml not found at ${SIDEBAR}`);
    process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface MenuItem {
    label:      string;
    menuPath:   string;
    url:        string;
    permission: string;
}

// ─── Step 1: Load labels from messages.properties ────────────────────────────
console.log('[1/5] Loading messages.properties...');

const labels = new Map<string, string>();
if (fs.existsSync(MESSAGES)) {
    const lines = fs.readFileSync(MESSAGES, 'latin1').split('\n');
    for (const line of lines) {
        const m = line.match(/^\s*([^#=\s][^=]*)=(.*)/);
        if (m) labels.set(m[1].trim(), m[2].trim());
    }
}
console.log(`   ${labels.size} labels loaded.`);

// ─── Step 2: Parse sidebar.xhtml ─────────────────────────────────────────────
console.log('[2/5] Parsing sidebar.xhtml...');

function resolveLabel(expr: string): string {
    let m = expr.match(/#\{messages\[['"](.+?)['"]\]\}/);
    if (m) return labels.get(m[1]) ?? `[${m[1]}]`;
    m = expr.match(/#\{viewHelper\.getMessage\(['"](.+?)['"]\)\}/);
    if (m) return labels.get(m[1]) ?? `[${m[1]}]`;
    return expr;
}

const rawContent = fs.readFileSync(SIDEBAR, 'latin1');

// The file has two <po:menu> blocks: mobile (first) and desktop (second).
// We extract only the desktop block to avoid duplicate entries.
const poMenuRegex = /<po:menu\b[\s\S]*?<\/po:menu>/g;
const poMenuBlocks = [...rawContent.matchAll(poMenuRegex)];
const content = poMenuBlocks.length >= 2
    ? poMenuBlocks[1][0]
    : poMenuBlocks.length === 1 ? poMenuBlocks[0][0] : rawContent;

const menuItems: MenuItem[] = [];
const submenuStack: string[] = [];
const lines = content.split('\n');

let i = 0;
while (i < lines.length) {
    const line = lines[i];

    // Opening <p:submenu
    if (/<p:submenu\b/.test(line)) {
        const labelMatch = line.match(/\blabel="([^"]*)"/);
        const label = labelMatch ? resolveLabel(labelMatch[1]) : '(unnamed)';
        submenuStack.push(label || '(unnamed)');
        i++;
        continue;
    }

    // Closing </p:submenu>
    if (/<\/p:submenu>/.test(line)) {
        submenuStack.pop();
        i++;
        continue;
    }

    // <p:menuitem — may span multiple lines
    if (/<p:menuitem\b/.test(line)) {
        let block = line;
        while (!/\/>/.test(block) && i < lines.length - 1) {
            i++;
            block += ' ' + lines[i].trim();
        }

        // Skip mobile items
        const idMatch = block.match(/\bid="([^"]*)"/);
        if (idMatch && idMatch[1].startsWith('mobile_')) { i++; continue; }

        const valueMatch = block.match(/\bvalue="([^"]*)"/);
        const urlMatch   = block.match(/\burl="([^"]*)"/);
        const permMatch  = block.match(/userHasPermission\('([^']+)'/);

        const label      = valueMatch ? resolveLabel(valueMatch[1]) : '';
        const urlRaw     = urlMatch   ? urlMatch[1] : '';
        const permission = permMatch  ? permMatch[1] : '';
        const url        = urlRaw.replace('#{contextPath}', '').replace(/\?.*$/, '');
        const menuPath   = [...submenuStack].join(' > ');

        menuItems.push({ label, menuPath, url, permission });
    }

    i++;
}

console.log(`   ${menuItems.length} menu items found.`);

// ─── Step 3: Map URL → Java files ────────────────────────────────────────────
console.log('[3/5] Mapping URLs to Java classes...');

function getAllJavaFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
            results.push(...getAllJavaFiles(full));
        } else if (entry.endsWith('.java')) {
            results.push(full);
        }
    }
    return results;
}

// Build a directory-index so we can look up by package name quickly
const dirIndex = new Map<string, string[]>(); // dirName → [filePaths]
for (const root of JAVA_ROOTS) {
    const allFiles = getAllJavaFiles(root);
    for (const f of allFiles) {
        const dirName = path.basename(path.dirname(f));
        if (!dirIndex.has(dirName)) dirIndex.set(dirName, []);
        dirIndex.get(dirName)!.push(f);
    }
}

function findJavaFiles(url: string): string[] {
    if (!url) return [];

    // Strip file extension and leading slash
    const urlPath = url.replace(/\.jsf.*$/, '').replace(/^\//, '');
    const segments = urlPath.split('/');
    if (segments.length < 2) return [];

    const packageSegments = segments.slice(0, -1);   // drop page name
    const pageName        = segments[segments.length - 1]; // e.g. "Parametro" or "receber-modal-rodoviario"
    const packagePath     = packageSegments.join(path.sep);

    const found: string[] = [];

    for (const root of JAVA_ROOTS) {
        const dir = path.join(root, packagePath);
        if (fs.existsSync(dir)) {
            const filesInDir = fs.readdirSync(dir)
                .filter(f => f.endsWith('.java'))
                .map(f => path.join(dir, f));

            // Entity CRUD pages start with uppercase — filter to matching class
            const isEntityPage = /^[A-Z]/.test(pageName);
            if (isEntityPage) {
                const entityPrefix = pageName.replace(/-.*$/, '');
                const specific = filesInDir.filter(f =>
                    path.basename(f).startsWith(entityPrefix)
                );
                found.push(...(specific.length > 0 ? specific : filesInDir));
            } else {
                found.push(...filesInDir);
            }
        }
    }

    // Fallback: search by package directory name across the whole source tree
    if (found.length === 0 && segments.length >= 2) {
        const lastPackage = segments[segments.length - 2];
        const byDir = dirIndex.get(lastPackage) ?? [];
        found.push(...byDir);
    }

    // Deduplicate
    return [...new Set(found)];
}

// ─── Step 4: Extract business methods from Java source ───────────────────────
const SKIP_METHODS = new Set([
    'toString', 'hashCode', 'equals', 'init', 'preRender',
    'preDestroy', 'postConstruct', 'compareTo', 'clone',
]);
const GETTER_SETTER = /^(get|set|is)[A-Z]/;
// Match: public <returnType> <methodName>(
const METHOD_RE = /^\s{0,8}public\s+(?!class|interface|enum|abstract)[\w<>\[\],?\s]+\s+((?!get[A-Z]|set[A-Z]|is[A-Z])[a-z]\w+)\s*\(/gm;

function getBusinessMethods(filePath: string): string[] {
    const source = fs.readFileSync(filePath, 'latin1');
    const methods: string[] = [];
    let m: RegExpExecArray | null;
    METHOD_RE.lastIndex = 0;
    while ((m = METHOD_RE.exec(source)) !== null) {
        const name = m[1];
        if (!SKIP_METHODS.has(name) && !GETTER_SETTER.test(name)) {
            methods.push(name);
        }
    }
    return [...new Set(methods)];
}

// ─── Step 5: Generate Markdown ───────────────────────────────────────────────
console.log('[4/5] Generating Markdown...');

const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
const lines2: string[] = [
    `# Menu Architecture - LogOne`,
    ``,
    `> Generated on ${now} by java-llm-extractor`,
    ``,
    `---`,
    ``,
];

// Group by menu path and sort
const grouped = new Map<string, MenuItem[]>();
for (const item of menuItems) {
    if (!grouped.has(item.menuPath)) grouped.set(item.menuPath, []);
    grouped.get(item.menuPath)!.push(item);
}
const sortedPaths = [...grouped.keys()].sort();

let currentTop = '';
let currentSub = '';

for (const menuPath of sortedPaths) {
    const parts   = menuPath.split(' > ');
    const level1  = parts[0] ?? '';
    const level2  = parts[1] ?? '';
    const level3  = parts[2] ?? '';

    if (level1 !== currentTop) {
        currentTop = level1;
        currentSub = '';
        if (level1) { lines2.push('', `## ${level1}`, ''); }
    }
    if (level2 && level2 !== currentSub) {
        currentSub = level2;
        lines2.push(`### ${level2}`, '');
    }
    if (level3) {
        lines2.push(`#### ${level3}`, '');
    }

    for (const item of grouped.get(menuPath)!) {
        lines2.push(`##### ${item.label}`, '');
        if (item.url)        lines2.push(`- **URL:** \`${item.url}\``);
        if (item.permission) lines2.push(`- **Permission:** \`${item.permission}\``);

        const javaFiles = findJavaFiles(item.url);
        if (javaFiles.length > 0) {
            lines2.push(`- **Java Classes:**`);
            for (const jf of javaFiles) {
                const rel = path.relative(projectRoot, jf);
                lines2.push(`  - \`${rel}\``);
                const methods = getBusinessMethods(jf);
                if (methods.length > 0) {
                    lines2.push(`    - Operations: ${methods.join(', ')}`);
                }
            }
        }
        lines2.push('');
    }
}

// ─── Permission index ─────────────────────────────────────────────────────────
lines2.push('---', '', '## Permission Index', '');
lines2.push('| Permission | Function | Module |');
lines2.push('|------------|----------|--------|');

const withPerm = menuItems.filter(i => i.permission).sort((a, b) =>
    a.permission.localeCompare(b.permission)
);
for (const item of withPerm) {
    const module = item.menuPath.split(' > ')[0];
    lines2.push(`| \`${item.permission}\` | ${item.label} | ${module} |`);
}

// ─── Step 6: Write output ─────────────────────────────────────────────────────
console.log('[5/5] Writing output...');
fs.writeFileSync(outputFile, lines2.join('\n'), outputEncoding);

const withBean = menuItems.filter(i => findJavaFiles(i.url).length > 0).length;
console.log(`\nDone!`);
console.log(`  File    : ${outputFile}`);
console.log(`  Items   : ${menuItems.length} menu functions mapped`);
console.log(`  Matched : ${withBean} with Java class`);
console.log(`  Unmatched: ${menuItems.length - withBean} (external links / reports)`);
